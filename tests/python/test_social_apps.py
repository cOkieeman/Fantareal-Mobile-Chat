from __future__ import annotations

from typing import Any

import pytest
from conftest import character, context

from fantareal_mobile_chat.domain import DomainError
from fantareal_mobile_chat.service import MobileChatService
from fantareal_mobile_chat.social_apps import normalize_feed_post


def feed_payload(**overrides: Any) -> dict[str, Any]:
    return {
        "content": "雨停了，窗外的路灯还亮着。",
        "authorId": "card_a",
        "authorName": "Alice",
        "tags": ["雨夜"],
        "source": "manual",
        **overrides,
    }


def forum_payload(**overrides: Any) -> dict[str, Any]:
    return {
        "title": "雨夜适合读什么书？",
        "body": "想找一本适合安静雨夜的短篇集。",
        "category": "闲聊",
        "authorId": "card_a",
        "authorName": "Alice",
        "replies": [],
        "source": "manual",
        **overrides,
    }


def reply_payload(**overrides: Any) -> dict[str, Any]:
    return {
        "content": "可以试试那本旧诗集。",
        "authorId": "card_a",
        "authorName": "Alice",
        "source": "manual",
        **overrides,
    }


def generated_feed() -> str:
    return (
        '{"events":[{"title":"雨声渐停","content":"雨声变小了，适合把窗开一条缝。",'
        '"author_name":"Alice","event_type":"moment","tags":["雨夜"],'
        '"metadata":{"mood":"安静","media_hint":"沾着雨滴的窗玻璃",'
        '"views":37,"comment_count":2}}]}'
    )


def generated_forum() -> str:
    return (
        '{"threads":[{"title":"雨停之后去哪里？",'
        '"body":"想在天亮前出去走一小段路。","category":"闲聊"}]}'
    )


def generated_forum_with_replies() -> str:
    return (
        '{"threads":[{"title":"雨停之后去哪里？",'
        '"body":"想在天亮前出去走一小段路。","category":"闲聊",'
        '"author_name":"Bob","replies":['
        '{"author_name":"Alice","content":"沿河走一段吧。"},'
        '{"author_name":"夜班店员","content":"旧书店还亮着灯。"}]}]}'
    )


def test_feed_crud_like_and_notification_lifecycle(
    service: MobileChatService,
) -> None:
    created = service.dispatch(
        "mobile.feed.create",
        {"context": context(), "post": feed_payload()},
    )
    post = created["post"]
    notification = created["notification"]
    assert post["postId"].startswith("feed_")
    assert notification["source"] == "feed"
    assert notification["sourceId"] == post["postId"]

    liked = service.dispatch(
        "mobile.feed.like.toggle",
        {"context": context(), "postId": post["postId"]},
    )["post"]
    assert liked["liked"] is True
    assert liked["likeCount"] == 1

    unliked = service.dispatch(
        "mobile.feed.like.toggle",
        {"context": context(), "postId": post["postId"]},
    )["post"]
    assert unliked["liked"] is False
    assert unliked["likeCount"] == 0

    updated = service.dispatch(
        "mobile.feed.update",
        {
            "context": context(),
            "postId": post["postId"],
            "post": {"content": "雨停后，路面映着灯。"},
        },
    )["post"]
    assert updated["content"] == "雨停后，路面映着灯。"
    assert updated["authorId"] == "card_a"

    service.dispatch(
        "mobile.feed.delete",
        {"context": context(), "postId": post["postId"]},
    )
    assert service.dispatch("mobile.feed.list", {"context": context()})["posts"] == []
    assert (
        service.dispatch("mobile.notifications.list", {"context": context()})[
            "notifications"
        ]
        == []
    )
    assert not list(service.store.data_root.rglob("*.tmp"))


def test_feed_legacy_post_is_upgraded_without_a_destructive_migration() -> None:
    post = normalize_feed_post(feed_payload())

    assert post["title"] == "雨停了，窗外的路灯还亮着。"
    assert post["eventType"] == "status"
    assert post["metadata"] == {
        "mood": "",
        "location": "",
        "mediaHint": "",
        "views": 0,
        "commentCount": 0,
    }


def test_forum_thread_reply_crud_and_notification_lifecycle(
    service: MobileChatService,
) -> None:
    created = service.dispatch(
        "mobile.forum.create",
        {"context": context(), "thread": forum_payload()},
    )
    thread = created["thread"]
    assert created["notification"]["sourceId"] == thread["threadId"]

    replied = service.dispatch(
        "mobile.forum.reply.create",
        {
            "context": context(),
            "threadId": thread["threadId"],
            "reply": reply_payload(),
        },
    )
    reply = replied["reply"]
    assert replied["thread"]["replies"] == [reply]
    assert reply["replyId"].startswith("reply_")

    updated = service.dispatch(
        "mobile.forum.update",
        {
            "context": context(),
            "threadId": thread["threadId"],
            "thread": {"title": "雨夜读书清单"},
        },
    )["thread"]
    assert updated["title"] == "雨夜读书清单"
    assert updated["replies"] == [reply]

    without_reply = service.dispatch(
        "mobile.forum.reply.delete",
        {
            "context": context(),
            "threadId": thread["threadId"],
            "replyId": reply["replyId"],
        },
    )["thread"]
    assert without_reply["replies"] == []

    service.dispatch(
        "mobile.forum.delete",
        {"context": context(), "threadId": thread["threadId"]},
    )
    assert service.dispatch("mobile.forum.list", {"context": context()})["threads"] == []
    assert (
        service.dispatch("mobile.notifications.list", {"context": context()})[
            "notifications"
        ]
        == []
    )


@pytest.mark.parametrize(
    ("purpose", "content", "result_key", "id_key"),
    [
        ("feed", generated_feed(), "posts", "postId"),
        ("forum", generated_forum(), "threads", "threadId"),
    ],
)
def test_social_generation_prepare_commit_is_atomic_and_notifies(
    service: MobileChatService,
    purpose: str,
    content: str,
    result_key: str,
    id_key: str,
) -> None:
    prepared = service.dispatch(
        f"mobile.{purpose}.generate.prepare",
        {"context": context()},
    )
    assert prepared["request"]["purpose"] == f"mobile-chat.{purpose}"
    assert "Alice" in prepared["request"]["messages"][-1]["content"]

    committed = service.dispatch(
        f"mobile.{purpose}.generate.commit",
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "content": content,
        },
    )
    item = committed[result_key][0]
    assert item["authorId"] == "card_a"
    assert item["source"] == "model"
    assert committed["notifications"][0]["sourceId"] == item[id_key]
    assert prepared["operationId"] not in service.pending
    assert not list(service.store.data_root.rglob("*.tmp"))


def test_feed_generation_uses_available_world_context_and_whitelisted_author(
    service: MobileChatService,
) -> None:
    alice = character()
    bob = character("card_b", "Bob")
    service.dispatch(
        "mobile.context.bind",
        {
            "context": context(),
            "activeCharacter": alice,
            "characters": [alice, bob],
        },
    )
    service.dispatch(
        "mobile.groups.create",
        {
            "context": context(),
            "group": {
                "title": "雨夜闲聊",
                "description": "大家聊聊窗外的雨。",
                "members": [
                    {"roleId": "card_a", "displayName": "Alice", "kind": "character"},
                    {"roleId": "card_b", "displayName": "Bob", "kind": "character"},
                ],
            },
        },
    )

    prepared = service.dispatch(
        "mobile.feed.generate.prepare",
        {"context": context()},
    )
    user_prompt = prepared["request"]["messages"][-1]["content"]
    system_prompt = prepared["request"]["messages"][0]["content"]
    for marker in [
        '"current_date"',
        '"current_datetime"',
        '"role_app_policy"',
        '"roles"',
        '"groups"',
        '"recent_channel_events"',
        '"context_availability"',
        "Alice",
        "Bob",
        "雨夜闲聊",
    ]:
        assert marker in user_prompt
    assert '"events"' in system_prompt
    assert "author_name" in system_prompt
    assert "event_type" in system_prompt
    assert "metadata" in system_prompt

    committed = service.dispatch(
        "mobile.feed.generate.commit",
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "content": (
                '{"events":[{"title":"换个地方读书","content":"咖啡还热着。",'
                '"author_name":"Bob","event_type":"status","tags":["咖啡"],'
                '"metadata":{"author_id":"card_b","mood":"放松","views":19}}]}'
            ),
        },
    )
    post = committed["posts"][0]
    assert post["authorId"] == "card_b"
    assert post["authorName"] == "Bob"
    assert post["title"] == "换个地方读书"
    assert post["eventType"] == "status"
    assert post["metadata"]["mood"] == "放松"
    assert post["metadata"]["views"] == 19


def test_forum_generation_keeps_whitelisted_author_and_two_thread_local_replies(
    service: MobileChatService,
) -> None:
    alice = character()
    bob = character("card_b", "Bob")
    service.dispatch(
        "mobile.context.bind",
        {
            "context": context(),
            "activeCharacter": alice,
            "characters": [alice, bob],
        },
    )
    prepared = service.dispatch("mobile.forum.generate.prepare", {"context": context()})
    committed = service.dispatch(
        "mobile.forum.generate.commit",
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "content": generated_forum_with_replies(),
        },
    )
    thread = committed["threads"][0]
    assert thread["authorId"] == "card_b"
    assert thread["authorName"] == "Bob"
    assert len(thread["replies"]) == 2
    assert thread["replies"][0]["authorId"] == "card_a"
    assert thread["replies"][1]["authorId"].startswith("forum_guest_")
    assert thread["replies"][1]["authorName"] == "夜班店员"


def test_social_parse_failure_can_abort_and_cannot_cross_purpose(
    service: MobileChatService,
) -> None:
    prepared = service.dispatch(
        "mobile.feed.generate.prepare",
        {"context": context()},
    )
    with pytest.raises(DomainError, match="事务不存在") as wrong_purpose:
        service.dispatch(
            "mobile.forum.generate.commit",
            {
                "context": context(),
                "operationId": prepared["operationId"],
                "content": generated_forum(),
            },
        )
    assert wrong_purpose.value.code == "operation_not_found"

    with pytest.raises(DomainError, match="可用动态") as parse_failure:
        service.dispatch(
            "mobile.feed.generate.commit",
            {
                "context": context(),
                "operationId": prepared["operationId"],
                "content": '{"posts":[]}',
            },
        )
    assert parse_failure.value.code == "parse_failed"
    assert service.dispatch("mobile.feed.list", {"context": context()})["posts"] == []

    assert service.dispatch(
        "mobile.feed.generate.abort",
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "reason": "error",
        },
    ) == {"ok": True, "reason": "error"}


def test_social_apps_are_per_card_and_reject_stale_context(
    service: MobileChatService,
) -> None:
    service.dispatch(
        "mobile.feed.create",
        {"context": context(), "post": feed_payload()},
    )
    card_b = character("card_b", "Bob")
    context_b = context("card_b", "revision_b")
    service.dispatch(
        "mobile.context.bind",
        {
            "context": context_b,
            "activeCharacter": card_b,
            "characters": [card_b],
        },
    )
    assert service.dispatch("mobile.feed.list", {"context": context_b})["posts"] == []
    assert service.dispatch("mobile.forum.list", {"context": context_b})["threads"] == []
    with pytest.raises(DomainError, match="角色或 Extension session 已变化") as stale:
        service.dispatch(
            "mobile.forum.create",
            {"context": context(), "thread": forum_payload()},
        )
    assert stale.value.code == "context_stale"
