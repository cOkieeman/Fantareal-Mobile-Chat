from __future__ import annotations

from typing import Any

import pytest
from conftest import character, context

from fantareal_mobile_chat.domain import DomainError
from fantareal_mobile_chat.service import MobileChatService


def message_payload(**overrides: Any) -> dict[str, Any]:
    return {
        "direction": "received",
        "authorId": "card_a",
        "authorName": "Alice",
        "content": "雨停后，要不要去河边走走？",
        "mood": "期待",
        "source": "manual",
        **overrides,
    }


def thread_payload(**overrides: Any) -> dict[str, Any]:
    return {
        "subject": "雨停之后",
        "counterpartyId": "card_a",
        "counterpartyName": "Alice",
        "messages": [message_payload()],
        "isRead": False,
        "source": "manual",
        **overrides,
    }


def generated_mail() -> str:
    return (
        '{"threads":[{"subject":"窗外的雨","content":"雨小了，我还在等你的回信。",'
        '"mood":"安静"}]}'
    )


def generated_reply() -> str:
    return '{"messages":[{"content":"好，我会在旧书店门口等你。","mood":"期待"}]}'


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


def test_mail_crud_mark_and_notification_lifecycle(
    service: MobileChatService,
) -> None:
    created = service.dispatch(
        "mobile.mail.create",
        {"context": context(), "thread": thread_payload()},
    )
    thread = created["thread"]
    assert thread["threadId"].startswith("mail_")
    assert created["notification"]["source"] == "mail"
    assert created["notification"]["sourceId"] == thread["threadId"]

    marked = service.dispatch(
        "mobile.mail.mark",
        {"context": context(), "threadId": thread["threadId"], "isRead": True},
    )["thread"]
    assert marked["isRead"] is True
    assert marked["messages"] == thread["messages"]

    updated = service.dispatch(
        "mobile.mail.update",
        {
            "context": context(),
            "threadId": thread["threadId"],
            "thread": {"subject": "雨停后的约定"},
        },
    )["thread"]
    assert updated["subject"] == "雨停后的约定"

    service.dispatch(
        "mobile.mail.delete",
        {"context": context(), "threadId": thread["threadId"]},
    )
    assert service.dispatch("mobile.mail.list", {"context": context()})["threads"] == []
    assert (
        service.dispatch("mobile.notifications.list", {"context": context()})[
            "notifications"
        ]
        == []
    )


def test_receive_mail_generation_is_atomic_and_notifies(
    service: MobileChatService,
) -> None:
    prepared = service.dispatch(
        "mobile.mail.generate.prepare",
        {"context": context()},
    )
    assert prepared["request"]["purpose"] == "mobile-chat.mail"
    committed = service.dispatch(
        "mobile.mail.generate.commit",
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "content": generated_mail(),
        },
    )
    thread = committed["threads"][0]
    assert thread["messages"][0]["direction"] == "received"
    assert thread["messages"][0]["source"] == "model"
    assert thread["isRead"] is False
    assert committed["notifications"][0]["sourceId"] == thread["threadId"]
    assert not list(service.store.data_root.rglob("*.tmp"))


def test_compose_and_reply_commit_user_and_model_messages_together(
    service: MobileChatService,
) -> None:
    bind_two_characters(service)
    composed = service.dispatch(
        "mobile.mail.compose.generate.prepare",
        {
            "context": context(),
            "recipientId": "card_b",
            "subject": "旧书店",
            "content": "明天下午有空吗？",
        },
    )
    assert composed["request"]["purpose"] == "mobile-chat.mail-compose"
    committed = service.dispatch(
        "mobile.mail.compose.generate.commit",
        {
            "context": context(),
            "operationId": composed["operationId"],
            "content": generated_reply(),
        },
    )
    thread = committed["threads"][0]
    assert thread["counterpartyId"] == "card_b"
    assert [item["direction"] for item in thread["messages"]] == ["sent", "received"]
    assert thread["messages"][0]["content"] == "明天下午有空吗？"

    replied = service.dispatch(
        "mobile.mail.reply.generate.prepare",
        {
            "context": context(),
            "threadId": thread["threadId"],
            "content": "那就两点见。",
        },
    )
    result = service.dispatch(
        "mobile.mail.reply.generate.commit",
        {
            "context": context(),
            "operationId": replied["operationId"],
            "content": generated_reply(),
        },
    )
    messages = result["threads"][0]["messages"]
    assert [item["direction"] for item in messages] == [
        "sent",
        "received",
        "sent",
        "received",
    ]
    assert messages[2]["content"] == "那就两点见。"


@pytest.mark.parametrize(
    ("prepare_method", "prepare_params", "commit_method"),
    [
        (
            "mobile.mail.compose.generate.prepare",
            {
                "recipientId": "card_a",
                "subject": "不会保存",
                "content": "生成失败时不应写入。",
            },
            "mobile.mail.compose.generate.commit",
        ),
        (
            "mobile.mail.generate.prepare",
            {},
            "mobile.mail.generate.commit",
        ),
    ],
)
def test_mail_parse_failure_can_abort_without_partial_write(
    service: MobileChatService,
    prepare_method: str,
    prepare_params: dict[str, str],
    commit_method: str,
) -> None:
    prepared = service.dispatch(
        prepare_method,
        {"context": context(), **prepare_params},
    )
    with pytest.raises(DomainError) as parse_failure:
        service.dispatch(
            commit_method,
            {
                "context": context(),
                "operationId": prepared["operationId"],
                "content": "{}",
            },
        )
    assert parse_failure.value.code == "parse_failed"
    purpose = "mail-compose" if ".compose." in prepare_method else "mail"
    assert service.abort_light_app(
        purpose,
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "reason": "error",
        },
    ) == {"ok": True, "reason": "error"}
    assert service.dispatch("mobile.mail.list", {"context": context()})["threads"] == []


def test_mail_is_per_card_and_rejects_cross_purpose_operation(
    service: MobileChatService,
) -> None:
    prepared = service.dispatch(
        "mobile.mail.generate.prepare",
        {"context": context()},
    )
    with pytest.raises(DomainError) as wrong_purpose:
        service.dispatch(
            "mobile.mail.compose.generate.commit",
            {
                "context": context(),
                "operationId": prepared["operationId"],
                "content": generated_reply(),
            },
        )
    assert wrong_purpose.value.code == "operation_not_found"

    service.dispatch(
        "mobile.mail.generate.abort",
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "reason": "cancelled",
        },
    )
    service.dispatch(
        "mobile.mail.create",
        {"context": context(), "thread": thread_payload()},
    )
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
    assert service.dispatch("mobile.mail.list", {"context": context_b})["threads"] == []
