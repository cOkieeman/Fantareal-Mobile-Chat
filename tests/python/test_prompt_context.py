from __future__ import annotations

import json
from typing import Any

import pytest
from conftest import character, context

from fantareal_mobile_chat.prompt_context import (
    HOST_CHAT_MESSAGE_CHAR_LIMIT,
    HOST_CHAT_MESSAGE_LIMIT,
    HOST_CHAT_TOTAL_CHAR_LIMIT,
    mobile_prompt_context,
    normalize_host_chat_context,
)
from fantareal_mobile_chat.service import MobileChatService

HOST_MARKER = "HOST_RECENT_STORY_MARKER"


def host_chat_context() -> dict[str, Any]:
    return {
        "available": True,
        "recentMessages": [
            {
                "messageId": "host-private-message-id",
                "role": "user",
                "content": HOST_MARKER,
                "createdAt": "2026-07-28T10:00:00Z",
            }
        ],
    }


def bind_host_context(service: MobileChatService) -> None:
    active = character()
    service.dispatch(
        "mobile.context.bind",
        {
            "context": context(),
            "activeCharacter": active,
            "characters": [active],
            "chatContext": host_chat_context(),
        },
    )


def serialized_request(request: dict[str, Any]) -> str:
    return json.dumps(request, ensure_ascii=False, separators=(",", ":"))


def test_host_chat_context_limits_messages_and_prioritizes_newest_content() -> None:
    messages = [
        {
            "role": "user" if index % 2 == 0 else "assistant",
            "content": f"{index:02d}-" + ("x" * 1_000),
        }
        for index in range(10)
    ]

    normalized = normalize_host_chat_context(
        {"available": True, "recentMessages": messages}
    )

    assert normalized["available"] is True
    assert len(normalized["recentMessages"]) <= HOST_CHAT_MESSAGE_LIMIT
    assert normalized["recentMessages"][-1]["content"].startswith("09-")
    assert all(
        len(item["content"]) <= HOST_CHAT_MESSAGE_CHAR_LIMIT
        for item in normalized["recentMessages"]
    )
    assert (
        sum(len(item["content"]) for item in normalized["recentMessages"])
        <= HOST_CHAT_TOTAL_CHAR_LIMIT
    )


@pytest.mark.parametrize(
    ("value", "available"),
    [
        (None, False),
        ({"available": False, "recentMessages": [{"role": "user", "content": "x"}]}, False),
        ({"available": True}, True),
        ({"recentMessages": []}, True),
    ],
)
def test_host_chat_context_honors_explicit_availability(
    value: Any,
    available: bool,
) -> None:
    normalized = normalize_host_chat_context(value)
    assert normalized == {"available": available, "recentMessages": []}


def test_mobile_prompt_context_keeps_unprovided_private_sources_explicit() -> None:
    prompt_context = mobile_prompt_context(
        "diary",
        character(),
        chat_context=host_chat_context(),
    )

    assert prompt_context["main_story_context"]["recent_main_chat"] == [
        {"role": "user", "content": HOST_MARKER}
    ]
    assert prompt_context["context_availability"] == {
        "main_story_context": "provided_by_host",
        "memory_context": "not_provided_by_host",
        "private_card_body": "not_provided_by_host",
        "rule": "不得猜测或声称读取未提供的主剧情、记忆、角色卡正文或隐私数据",
    }


@pytest.mark.parametrize(
    ("prepare_method", "prepare_params"),
    [
        ("mobile.diary.generate.prepare", {}),
        ("mobile.calendar.generate.prepare", {}),
        ("mobile.feed.generate.prepare", {}),
        ("mobile.forum.generate.prepare", {}),
        ("mobile.mail.generate.prepare", {}),
        ("mobile.phone.call.generate.prepare", {"contactId": "card_a", "content": "你好"}),
        ("mobile.live.generate.prepare", {}),
    ],
)
def test_generation_requests_receive_host_recent_chat(
    service: MobileChatService,
    prepare_method: str,
    prepare_params: dict[str, str],
) -> None:
    bind_host_context(service)

    prepared = service.dispatch(
        prepare_method,
        {"context": context(), **prepare_params},
    )
    request_text = serialized_request(prepared["request"])

    assert HOST_MARKER in request_text
    assert "provided_by_host" in request_text
    assert "host-private-message-id" not in request_text


def test_host_recent_chat_is_never_persisted_to_business_json(
    service: MobileChatService,
) -> None:
    bind_host_context(service)

    prepared = service.dispatch(
        "mobile.diary.generate.prepare",
        {"context": context()},
    )
    service.dispatch(
        "mobile.diary.generate.abort",
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "reason": "cancelled",
        },
    )

    assert service.store is not None
    persisted = "\n".join(
        path.read_text(encoding="utf-8")
        for path in service.store.data_root.rglob("*.json")
    )
    assert HOST_MARKER not in persisted
    assert "host-private-message-id" not in persisted
