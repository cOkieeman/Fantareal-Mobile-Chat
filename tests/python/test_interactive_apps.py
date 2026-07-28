from __future__ import annotations

from typing import Any

import pytest
from conftest import character, context

from fantareal_mobile_chat.domain import DomainError
from fantareal_mobile_chat.service import MobileChatService


def bind_two_characters(service: MobileChatService) -> None:
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


def phone_response(content: str, *, state: str = "ongoing") -> str:
    return (
        '{"lines":[{"content":"'
        f'{content}","mood":"温和"}}],"callState":"{state}"'
        "}"
    )


def live_response(**overrides: Any) -> str:
    values = {
        "title": "雨夜电台",
        "content": "窗外的雨还没有停，我们先聊一会儿。",
        "messages": [
            {
                "authorId": "viewer_1",
                "authorName": "小雨",
                "authorType": "viewer",
                "content": "晚上好！",
            }
        ],
        "viewerCount": 12,
        "likeCount": 2,
        **overrides,
    }
    import json

    return json.dumps(values, ensure_ascii=False)


def test_phone_call_commits_user_and_character_lines_atomically(
    service: MobileChatService,
) -> None:
    bind_two_characters(service)
    prepared = service.dispatch(
        "mobile.phone.call.generate.prepare",
        {
            "context": context(),
            "contactId": "card_b",
            "content": "你还醒着吗？",
        },
    )
    assert prepared["request"]["purpose"] == "mobile-chat.phone-call"
    assert "你还醒着吗？" in prepared["request"]["messages"][-1]["content"]

    first = service.dispatch(
        "mobile.phone.call.generate.commit",
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "content": phone_response("嗯，我在听。"),
        },
    )["session"]
    assert first["sessionId"] == prepared["sessionId"]
    assert [line["direction"] for line in first["lines"]] == ["sent", "received"]
    assert [line["content"] for line in first["lines"]] == [
        "你还醒着吗？",
        "嗯，我在听。",
    ]

    continued = service.dispatch(
        "mobile.phone.call.generate.prepare",
        {
            "context": context(),
            "sessionId": first["sessionId"],
            "content": "只是想和你说声晚安。",
        },
    )
    second = service.dispatch(
        "mobile.phone.call.generate.commit",
        {
            "context": context(),
            "operationId": continued["operationId"],
            "content": phone_response("晚安，明天见。", state="ended"),
        },
    )["session"]
    assert second["status"] == "ended"
    assert second["endedBy"] == "character"
    assert len(second["lines"]) == 4
    assert not list(service.store.data_root.rglob("*.tmp"))


def test_phone_hangup_delete_and_closed_call_guard(
    service: MobileChatService,
) -> None:
    prepared = service.dispatch(
        "mobile.phone.call.generate.prepare",
        {
            "context": context(),
            "contactId": "card_a",
            "content": "能听见吗？",
        },
    )
    session = service.dispatch(
        "mobile.phone.call.generate.commit",
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "content": phone_response("听得很清楚。"),
        },
    )["session"]
    hung_up = service.dispatch(
        "mobile.phone.hangup",
        {"context": context(), "sessionId": session["sessionId"]},
    )["session"]
    assert hung_up["status"] == "ended"
    assert hung_up["endedBy"] == "user"

    with pytest.raises(DomainError) as closed:
        service.dispatch(
            "mobile.phone.call.generate.prepare",
            {
                "context": context(),
                "sessionId": session["sessionId"],
                "content": "不应继续。",
            },
        )
    assert closed.value.code == "conflict"

    service.dispatch(
        "mobile.phone.delete",
        {"context": context(), "sessionId": session["sessionId"]},
    )
    assert service.dispatch("mobile.phone.list", {"context": context()})["sessions"] == []


def test_phone_parse_failure_abort_and_whitelist_guard(
    service: MobileChatService,
) -> None:
    with pytest.raises(DomainError) as denied:
        service.dispatch(
            "mobile.phone.call.generate.prepare",
            {
                "context": context(),
                "contactId": "private_card",
                "content": "不应读取。",
            },
        )
    assert denied.value.code == "not_found"

    prepared = service.dispatch(
        "mobile.phone.call.generate.prepare",
        {
            "context": context(),
            "contactId": "card_a",
            "content": "这句话不能留下半成品。",
        },
    )
    with pytest.raises(DomainError) as parse_failure:
        service.dispatch(
            "mobile.phone.call.generate.commit",
            {
                "context": context(),
                "operationId": prepared["operationId"],
                "content": "{}",
            },
        )
    assert parse_failure.value.code == "parse_failed"
    assert service.dispatch(
        "mobile.phone.call.generate.abort",
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "reason": "cancelled",
        },
    ) == {"ok": True, "reason": "cancelled"}
    assert service.dispatch("mobile.phone.list", {"context": context()})["sessions"] == []


def test_live_start_tick_message_like_end_and_delete(
    service: MobileChatService,
) -> None:
    prepared = service.dispatch("mobile.live.generate.prepare", {"context": context()})
    started = service.dispatch(
        "mobile.live.generate.commit",
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "content": live_response(),
        },
    )
    stream = started["stream"]
    assert stream["status"] == "live"
    assert started["notification"]["source"] == "live"
    assert stream["messages"][0]["authorType"] == "viewer"
    assert stream["fanCount"] == 0
    assert stream["innerThought"] == ""

    messaged = service.dispatch(
        "mobile.live.message.create",
        {
            "context": context(),
            "streamId": stream["streamId"],
            "content": "我也在看。",
        },
    )["stream"]
    assert messaged["messages"][-1]["authorType"] == "user"

    liked = service.dispatch(
        "mobile.live.like.toggle",
        {"context": context(), "streamId": stream["streamId"]},
    )["stream"]
    assert liked["userLiked"] is True
    assert liked["likeCount"] == 3

    tick = service.dispatch(
        "mobile.live.tick.generate.prepare",
        {"context": context(), "streamId": stream["streamId"]},
    )
    updated = service.dispatch(
        "mobile.live.tick.generate.commit",
        {
            "context": context(),
            "operationId": tick["operationId"],
            "content": live_response(
                content="接下来读一小段故事。",
                messages=[],
                viewerCount=9,
                likeCount=1,
                fanCount=28,
                innerThought="希望这段故事能让大家安静一点。",
                status="live",
            ),
        },
    )["stream"]
    assert updated["viewerCount"] == 9
    assert updated["likeCount"] == 3
    assert updated["fanCount"] == 28
    assert updated["innerThought"] == "希望这段故事能让大家安静一点。"
    assert len(updated["segments"]) == 2

    ended = service.dispatch(
        "mobile.live.end",
        {"context": context(), "streamId": stream["streamId"]},
    )["stream"]
    assert ended["status"] == "ended"
    service.dispatch(
        "mobile.live.delete",
        {"context": context(), "streamId": stream["streamId"]},
    )
    assert service.dispatch("mobile.live.list", {"context": context()})["streams"] == []
    assert (
        service.dispatch("mobile.notifications.list", {"context": context()})[
            "notifications"
        ]
        == []
    )
    assert not list(service.store.data_root.rglob("*.tmp"))


@pytest.mark.parametrize(
    ("prepare_method", "commit_method", "abort_method", "prepare_params"),
    [
        (
            "mobile.live.generate.prepare",
            "mobile.live.generate.commit",
            "mobile.live.generate.abort",
            {},
        ),
        (
            "mobile.phone.call.generate.prepare",
            "mobile.phone.call.generate.commit",
            "mobile.phone.call.generate.abort",
            {"contactId": "card_a", "content": "不要留下半成品。"},
        ),
    ],
)
def test_interactive_parse_failure_can_abort_without_partial_write(
    service: MobileChatService,
    prepare_method: str,
    commit_method: str,
    abort_method: str,
    prepare_params: dict[str, str],
) -> None:
    prepared = service.dispatch(
        prepare_method,
        {"context": context(), **prepare_params},
    )
    with pytest.raises(DomainError) as failure:
        service.dispatch(
            commit_method,
            {
                "context": context(),
                "operationId": prepared["operationId"],
                "content": "{}",
            },
        )
    assert failure.value.code == "parse_failed"
    service.dispatch(
        abort_method,
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "reason": "error",
        },
    )
    assert service.dispatch("mobile.phone.list", {"context": context()})["sessions"] == []
    assert service.dispatch("mobile.live.list", {"context": context()})["streams"] == []


def test_live_is_per_card_and_context_switch_cancels_pending(
    service: MobileChatService,
) -> None:
    prepared = service.dispatch("mobile.live.generate.prepare", {"context": context()})
    bob = character("card_b", "Bob")
    context_b = context("card_b", "revision_b")
    service.dispatch(
        "mobile.context.bind",
        {
            "context": context_b,
            "activeCharacter": bob,
            "characters": [bob],
        },
    )
    with pytest.raises(DomainError) as stale:
        service.dispatch(
            "mobile.live.generate.commit",
            {
                "context": context(),
                "operationId": prepared["operationId"],
                "content": live_response(),
            },
        )
    assert stale.value.code in {"context_stale", "operation_not_found"}
    assert service.dispatch("mobile.live.list", {"context": context_b})["streams"] == []
