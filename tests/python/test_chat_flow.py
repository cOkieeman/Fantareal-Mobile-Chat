from __future__ import annotations

from typing import Any

import pytest
from conftest import character, context

from fantareal_mobile_chat.domain import DomainError
from fantareal_mobile_chat.service import MobileChatService


def create_group(service: MobileChatService, payload: dict[str, Any]) -> str:
    return service.dispatch(
        "mobile.groups.create",
        {"context": context(), "group": payload},
    )["group"]["groupId"]


def test_prepare_commit_is_atomic_and_builds_host_llm_request(
    service: MobileChatService,
    group_payload: dict[str, Any],
) -> None:
    group_id = create_group(service, group_payload)
    prepared = service.dispatch(
        "mobile.chat.prepare",
        {
            "context": context(),
            "groupId": group_id,
            "mode": "user_message",
            "content": "Are you still there?",
        },
    )
    assert prepared["request"]["purpose"] == "mobile-chat.group-reply"
    assert prepared["request"]["responseFormat"] == "json_object"
    assert service.dispatch(
        "mobile.messages.list",
        {"context": context(), "groupId": group_id},
    )["messages"] == []

    committed = service.dispatch(
        "mobile.chat.commit",
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "content": (
                '{"messages":[{"speakerId":"card_a","speakerName":"Alice",'
                '"type":"text","content":"I am here."}]}'
            ),
        },
    )
    assert [item["source"] for item in committed["messages"]] == ["user", "ai"]
    stored = service.dispatch(
        "mobile.messages.list",
        {"context": context(), "groupId": group_id},
    )["messages"]
    assert [item["content"] for item in stored] == ["Are you still there?", "I am here."]


def test_group_prompt_only_contains_member_roles_host_chat_and_workbench(
    service: MobileChatService,
) -> None:
    alice = character()
    bob = character("card_b", "Bob")
    carol = character("card_c", "Carol")
    service.dispatch(
        "mobile.context.bind",
        {
            "context": context(),
            "activeCharacter": alice,
            "characters": [alice, bob, carol],
            "chatContext": {
                "available": True,
                "recentMessages": [
                    {
                        "messageId": "host-message-secret",
                        "role": "assistant",
                        "content": "HOST_GROUP_STORY_MARKER",
                    }
                ],
            },
        },
    )
    group_id = create_group(
        service,
        {
            "title": "Bob only",
            "description": "Only Bob may answer.",
            "members": [
                {
                    "roleId": "user",
                    "displayName": "Me",
                    "kind": "user",
                    "summary": "",
                },
                {
                    "roleId": "card_b",
                    "displayName": "Bob",
                    "kind": "character",
                    "summary": "calm",
                },
            ],
            "replyCount": 1,
            "allowRoleToRoleReply": True,
        },
    )
    service.dispatch(
        "mobile.workbench.update",
        {
            "context": context(),
            "profile": {
                "scope": "group_chat",
                "enabled": True,
                "instruction": "GROUP_WORKBENCH_MARKER",
            },
        },
    )

    prepared = service.dispatch(
        "mobile.chat.prepare",
        {
            "context": context(),
            "groupId": group_id,
            "content": "Hello Bob",
        },
    )
    request_text = str(prepared["request"])

    assert "Bob description" in request_text
    assert "HOST_GROUP_STORY_MARKER" in request_text
    assert "GROUP_WORKBENCH_MARKER" in request_text
    assert "Alice description" not in request_text
    assert "Carol description" not in request_text
    assert "host-message-secret" not in request_text


def test_parse_failure_then_abort_persists_user_and_retryable_error(
    service: MobileChatService,
    group_payload: dict[str, Any],
) -> None:
    group_id = create_group(service, group_payload)
    prepared = service.dispatch(
        "mobile.chat.prepare",
        {
            "context": context(),
            "groupId": group_id,
            "content": "Hello?",
        },
    )
    with pytest.raises(DomainError, match="可用的群聊消息") as parse_failure:
        service.dispatch(
            "mobile.chat.commit",
            {
                "context": context(),
                "operationId": prepared["operationId"],
                "content": '{"messages":[{"speakerId":"unknown","content":"No"}]}',
            },
        )
    assert parse_failure.value.code == "parse_failed"

    aborted = service.dispatch(
        "mobile.chat.abort",
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "reason": "error",
            "message": "模型返回内容无法解析，请重试。",
        },
    )
    assert [item["type"] for item in aborted["messages"]] == ["text", "error"]
    assert prepared["operationId"] not in service.pending


@pytest.mark.parametrize("reason", ["cancelled", "timeout", "error"])
def test_generation_abort_reasons(
    service: MobileChatService,
    group_payload: dict[str, Any],
    reason: str,
) -> None:
    group_id = create_group(service, group_payload)
    prepared = service.dispatch(
        "mobile.chat.prepare",
        {
            "context": context(),
            "groupId": group_id,
            "content": reason,
        },
    )
    result = service.dispatch(
        "mobile.chat.abort",
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "reason": reason,
        },
    )
    assert result["reason"] == reason
    assert result["messages"][-1]["type"] == "error"


def test_role_switch_rejects_late_commit(
    service: MobileChatService,
    group_payload: dict[str, Any],
) -> None:
    group_id = create_group(service, group_payload)
    prepared = service.dispatch(
        "mobile.chat.prepare",
        {
            "context": context(),
            "groupId": group_id,
            "content": "Old role request",
        },
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
    assert prepared["operationId"] not in service.pending
    with pytest.raises(DomainError, match="角色或 Extension session 已变化") as stale:
        service.dispatch(
            "mobile.chat.commit",
            {
                "context": context(),
                "operationId": prepared["operationId"],
                "content": (
                    '{"messages":[{"speakerId":"card_a","speakerName":"Alice",'
                    '"type":"text","content":"Late reply"}]}'
                ),
            },
        )
    assert stale.value.code == "context_stale"
    assert service.dispatch("mobile.groups.list", {"context": context_b})["groups"] == []


def test_commit_accepts_common_model_aliases(
    service: MobileChatService,
    group_payload: dict[str, Any],
) -> None:
    group_id = create_group(service, group_payload)
    prepared = service.dispatch(
        "mobile.chat.prepare",
        {
            "context": context(),
            "groupId": group_id,
            "content": "Alias response",
        },
    )
    committed = service.dispatch(
        "mobile.chat.commit",
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "content": '{"messages":[{"author":"Alice","body":"Accepted."}]}',
        },
    )
    assert [item["content"] for item in committed["messages"]] == [
        "Alias response",
        "Accepted.",
    ]
