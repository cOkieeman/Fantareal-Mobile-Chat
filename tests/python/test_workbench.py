from __future__ import annotations

import pytest
from conftest import character, context

from fantareal_mobile_chat.domain import DomainError
from fantareal_mobile_chat.service import MobileChatService
from fantareal_mobile_chat.workbench import PROMPT_SCOPES, apply_custom_instruction


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


def generated_drafts(name: str = "Mira") -> str:
    return (
        '{"drafts":[{"name":"'
        f'{name}","summary":"安静的夜班电台主持人。","personality":"耐心",'
        '"scenario":"雨夜电台","chatStyle":"简短温和","tags":["电台"]}]}'
    )


def test_character_assistant_create_extract_update_and_delete(
    service: MobileChatService,
) -> None:
    bind_two_characters(service)
    created_prepare = service.dispatch(
        "mobile.assistant.generate.prepare",
        {
            "context": context(),
            "mode": "create",
            "notes": "创建一位夜班电台主持人。",
        },
    )
    assert created_prepare["request"]["purpose"] == "mobile-chat.assistant-create"
    created = service.dispatch(
        "mobile.assistant.generate.commit",
        {
            "context": context(),
            "operationId": created_prepare["operationId"],
            "content": generated_drafts(),
        },
    )["drafts"][0]
    assert created["mode"] == "create"
    assert created["sourceCharacterId"] == ""

    extract_prepare = service.dispatch(
        "mobile.assistant.generate.prepare",
        {
            "context": context(),
            "mode": "extract",
            "sourceCharacterId": "card_b",
            "notes": "只基于白名单摘要整理。",
        },
    )
    request_text = extract_prepare["request"]["messages"][-1]["content"]
    assert '"cardUid":"card_b"' in request_text
    assert "private" not in request_text.lower()
    extracted = service.dispatch(
        "mobile.assistant.generate.commit",
        {
            "context": context(),
            "operationId": extract_prepare["operationId"],
            "content": generated_drafts("Bob Side"),
        },
    )["drafts"][0]
    assert extracted["mode"] == "extract"
    assert extracted["sourceCharacterId"] == "card_b"

    updated = service.dispatch(
        "mobile.assistant.update",
        {
            "context": context(),
            "draftId": created["draftId"],
            "draft": {"summary": "更新后的内部草稿，不写回角色卡。"},
        },
    )["draft"]
    assert updated["summary"].startswith("更新后")

    service.dispatch(
        "mobile.assistant.delete",
        {"context": context(), "draftId": extracted["draftId"]},
    )
    drafts = service.dispatch("mobile.assistant.list", {"context": context()})["drafts"]
    assert [item["draftId"] for item in drafts] == [created["draftId"]]
    assert not list(service.store.workspace_root.rglob("*"))
    assert not list(service.store.data_root.rglob("*.tmp"))


def test_character_assistant_guards_source_and_abort_is_atomic(
    service: MobileChatService,
) -> None:
    with pytest.raises(DomainError) as missing_source:
        service.dispatch(
            "mobile.assistant.generate.prepare",
            {"context": context(), "mode": "extract"},
        )
    assert missing_source.value.code == "invalid_params"

    with pytest.raises(DomainError) as private_source:
        service.dispatch(
            "mobile.assistant.generate.prepare",
            {
                "context": context(),
                "mode": "extract",
                "sourceCharacterId": "private_card",
            },
        )
    assert private_source.value.code == "not_found"

    prepared = service.dispatch(
        "mobile.assistant.generate.prepare",
        {
            "context": context(),
            "mode": "create",
            "notes": "这个失败结果不能保存。",
        },
    )
    with pytest.raises(DomainError) as parse_failure:
        service.dispatch(
            "mobile.assistant.generate.commit",
            {
                "context": context(),
                "operationId": prepared["operationId"],
                "content": "{}",
            },
        )
    assert parse_failure.value.code == "parse_failed"
    service.dispatch(
        "mobile.assistant.generate.abort",
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "reason": "cancelled",
        },
    )
    assert (
        service.dispatch("mobile.assistant.list", {"context": context()})["drafts"]
        == []
    )


def test_prompt_profiles_have_stable_defaults_update_preview_and_reset(
    service: MobileChatService,
) -> None:
    first = service.dispatch("mobile.workbench.get", {"context": context()})
    second = service.dispatch("mobile.workbench.get", {"context": context()})
    assert [item["scope"] for item in first["profiles"]] == list(PROMPT_SCOPES)
    assert first["profiles"] == second["profiles"]
    assert {item["updatedAt"] for item in first["profiles"]} == {
        "1970-01-01T00:00:00Z"
    }

    updated = service.dispatch(
        "mobile.workbench.update",
        {
            "context": context(),
            "profile": {
                "scope": "diary",
                "enabled": True,
                "instruction": "语气更克制，但仍必须返回既定 JSON。",
                "updatedAt": "2000-01-01T00:00:00Z",
            },
        },
    )["profile"]
    assert updated["enabled"] is True
    assert updated["updatedAt"] != "2000-01-01T00:00:00Z"

    preview = service.dispatch(
        "mobile.workbench.preview",
        {"context": context(), "scope": "diary"},
    )["preview"]
    assert preview["packagePrompt"] == "prompts/diary.md"
    assert preview["mode"] == "append"
    assert preview["effective"] is True
    assert "JSON object" in preview["lockedContract"]

    reset = service.dispatch(
        "mobile.workbench.reset",
        {"context": context(), "scope": "diary"},
    )["profile"]
    assert reset["enabled"] is False
    assert reset["instruction"] == ""

    group_preview = service.dispatch(
        "mobile.workbench.preview",
        {"context": context(), "scope": "group_chat"},
    )["preview"]
    assert group_preview["packagePrompt"] == "prompts/group-chat.md"
    assert group_preview["mode"] == "append"


def test_custom_instruction_is_appended_without_changing_request_contract(
    service: MobileChatService,
) -> None:
    service.dispatch(
        "mobile.workbench.update",
        {
            "context": context(),
            "profile": {
                "scope": "diary",
                "enabled": True,
                "instruction": "日记正文使用第一人称。",
            },
        },
    )
    prepared = service.dispatch(
        "mobile.diary.generate.prepare",
        {"context": context()},
    )
    request = prepared["request"]
    assert request["purpose"] == "mobile-chat.diary"
    assert request["responseFormat"] == "json_object"
    assert "日记正文使用第一人称。" in request["messages"][-1]["content"]
    assert "不得覆盖 JSON 输出契约" in request["messages"][-1]["content"]
    service.dispatch(
        "mobile.diary.generate.abort",
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "reason": "cancelled",
        },
    )

    unchanged = {"purpose": "fixture", "messages": []}
    assert apply_custom_instruction(unchanged, "不会添加") is unchanged


def test_workbench_success_parse_failure_abort_and_purpose_isolation(
    service: MobileChatService,
) -> None:
    service.dispatch(
        "mobile.workbench.update",
        {
            "context": context(),
            "profile": {
                "scope": "phone",
                "enabled": True,
                "instruction": "回复保持简短。",
            },
        },
    )
    prepared = service.dispatch(
        "mobile.workbench.generate.prepare",
        {"context": context(), "scope": "phone", "input": "测试一句"},
    )
    assert prepared["request"]["purpose"] == "mobile-chat.workbench-phone"
    assert "回复保持简短。" in prepared["request"]["messages"][-1]["content"]

    with pytest.raises(DomainError) as wrong_purpose:
        service.dispatch(
            "mobile.phone.call.generate.commit",
            {
                "context": context(),
                "operationId": prepared["operationId"],
                "content": '{"lines":[{"content":"hi"}]}',
            },
        )
    assert wrong_purpose.value.code == "operation_not_found"

    committed = service.dispatch(
        "mobile.workbench.generate.commit",
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "content": '{"ok":true,"sample":"short"}',
        },
    )
    assert committed["keys"] == ["ok", "sample"]
    assert committed["diagnostic"]["status"] == "success"

    failed = service.dispatch(
        "mobile.workbench.generate.prepare",
        {"context": context(), "scope": "phone", "input": "坏 JSON"},
    )
    with pytest.raises(DomainError) as parse_failure:
        service.dispatch(
            "mobile.workbench.generate.commit",
            {
                "context": context(),
                "operationId": failed["operationId"],
                "content": "not json",
            },
        )
    assert parse_failure.value.code == "parse_failed"
    aborted = service.dispatch(
        "mobile.workbench.generate.abort",
        {
            "context": context(),
            "operationId": failed["operationId"],
            "reason": "error",
            "message": "模型返回无法解析。",
        },
    )
    assert aborted["diagnostic"]["status"] == "error"
    diagnostics = service.dispatch(
        "mobile.workbench.get",
        {"context": context()},
    )["diagnostics"]
    assert {item["status"] for item in diagnostics} == {"success", "error"}
    assert not service.pending
    assert not list(service.store.data_root.rglob("*.tmp"))
