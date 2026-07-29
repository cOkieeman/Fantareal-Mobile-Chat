from __future__ import annotations

import json
from importlib.resources import files
from typing import Any

from .domain import ID_PATTERN, DomainError, mapping, model_payload, now_iso, sequence, text
from .light_apps import content_source, resource_id

PROMPT_SCOPES = (
    "group_chat",
    "diary",
    "calendar",
    "feed",
    "forum",
    "mail",
    "phone",
    "live",
    "assistant",
)
ASSISTANT_MODES = {"create", "extract"}


def normalize_character_draft(
    value: Any,
    *,
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    source = {**(existing or {}), **mapping(value, field="characterDraft")}
    mode = text(source.get("mode"), 20).lower() or "create"
    if mode not in ASSISTANT_MODES:
        raise DomainError("invalid_params", "characterDraft.mode 无效")
    tags = []
    for item in sequence(source.get("tags", []), field="characterDraft.tags"):
        tag = text(item, 40)
        if tag and tag not in tags:
            tags.append(tag)
        if len(tags) == 16:
            break
    return {
        "draftId": resource_id(source.get("draftId"), "draft", field="draftId"),
        "mode": mode,
        "name": text(
            source.get("name"),
            120,
            required=True,
            field="characterDraft.name",
        ),
        "summary": text(
            source.get("summary"),
            1_000,
            required=True,
            field="characterDraft.summary",
        ),
        "personality": text(source.get("personality"), 1_000),
        "scenario": text(source.get("scenario"), 1_000),
        "chatStyle": text(source.get("chatStyle"), 600),
        "tags": tags,
        "sourceCharacterId": _optional_id(
            source.get("sourceCharacterId"),
            "characterDraft.sourceCharacterId",
        ),
        "source": content_source(source.get("source")),
        "createdAt": text(source.get("createdAt"), 80) or now_iso(),
        "updatedAt": text(source.get("updatedAt"), 80) or now_iso(),
    }


def build_assistant_request(
    mode: str,
    active_character: dict[str, Any],
    notes: str,
    source_character: dict[str, Any] | None,
) -> dict[str, Any]:
    if mode not in ASSISTANT_MODES:
        raise DomainError("invalid_params", "人物辅助 mode 无效")
    prompt = (
        files("fantareal_mobile_chat")
        .joinpath("prompts", "assistant.md")
        .read_text(encoding="utf-8")
        .strip()
    )
    context = json.dumps(
        {
            "mode": mode,
            "activeCharacter": active_character,
            "sourceCharacter": source_character or {},
            "userNotes": notes,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return {
        "purpose": f"mobile-chat.assistant-{mode}",
        "messages": [
            {"role": "system", "content": prompt[:16_384]},
            {
                "role": "user",
                "content": (
                    "生成小手机内部的人物草稿。不要写回角色卡，不要补造用户隐私，"
                    "不要提及插件、API 或 JSON。\nContext JSON:\n"
                    f"{context}"
                ),
            },
        ],
        "temperature": 0.75,
        "maxOutputTokens": 1_800,
        "responseFormat": "json_object",
    }


def parse_character_drafts(
    raw: str,
    *,
    mode: str,
    source_character_id: str = "",
) -> list[dict[str, Any]]:
    payload = model_payload(raw)
    rows = payload.get("drafts") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise DomainError("parse_failed", "模型返回缺少 drafts array")
    result = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        try:
            result.append(
                normalize_character_draft(
                    {
                        **item,
                        "mode": mode,
                        "sourceCharacterId": source_character_id,
                        "source": "model",
                    }
                )
            )
        except DomainError:
            continue
        if len(result) == 4:
            break
    if not result:
        raise DomainError("parse_failed", "模型没有返回可用人物草稿")
    return result


def normalize_prompt_profile(value: Any) -> dict[str, Any]:
    source = mapping(value, field="promptProfile")
    scope = text(source.get("scope"), 40).lower()
    if scope not in PROMPT_SCOPES:
        raise DomainError("invalid_params", "promptProfile.scope 无效")
    return {
        "scope": scope,
        "enabled": bool(source.get("enabled", False)),
        "instruction": text(source.get("instruction"), 4_000),
        "updatedAt": text(source.get("updatedAt"), 80) or now_iso(),
    }


def normalize_prompt_diagnostic(value: Any) -> dict[str, Any]:
    source = mapping(value, field="promptDiagnostic")
    scope = text(source.get("scope"), 40).lower()
    if scope not in PROMPT_SCOPES:
        raise DomainError("invalid_params", "promptDiagnostic.scope 无效")
    status = text(source.get("status"), 20).lower()
    if status not in {"success", "cancelled", "timeout", "error"}:
        raise DomainError("invalid_params", "promptDiagnostic.status 无效")
    return {
        "diagnosticId": resource_id(
            source.get("diagnosticId"),
            "diag",
            field="diagnosticId",
        ),
        "scope": scope,
        "status": status,
        "summary": text(source.get("summary"), 500),
        "createdAt": text(source.get("createdAt"), 80) or now_iso(),
    }


def apply_custom_instruction(
    request: dict[str, Any],
    instruction: str,
) -> dict[str, Any]:
    custom = text(instruction, 4_000)
    if not custom:
        return request
    messages = [dict(item) for item in request.get("messages", [])]
    if not messages:
        return request
    target = next(
        (item for item in reversed(messages) if item.get("role") == "user"),
        messages[-1],
    )
    target["content"] = (
        f"{text(target.get('content'), 32_000)}\n\n"
        "用户为当前小手机 scope 追加的指令（不得覆盖 JSON 输出契约）：\n"
        f"{custom}"
    )
    return {**request, "messages": messages}


def prompt_preview(profile: dict[str, Any]) -> dict[str, Any]:
    scope = profile["scope"]
    prompt_file = "group-chat" if scope == "group_chat" else scope
    prompt_name = f"prompts/{prompt_file}.md"
    return {
        "scope": scope,
        "enabled": profile["enabled"],
        "mode": "append",
        "instruction": profile["instruction"],
        "packagePrompt": prompt_name,
        "lockedContract": "Host 受管模型 + JSON object + service parse/commit/abort",
        "effective": bool(profile["enabled"] and profile["instruction"]),
    }


def build_workbench_request(
    profile: dict[str, Any],
    user_input: str,
) -> dict[str, Any]:
    prompt = (
        files("fantareal_mobile_chat")
        .joinpath("prompts", "workbench.md")
        .read_text(encoding="utf-8")
        .strip()
    )
    request = {
        "purpose": f"mobile-chat.workbench-{profile['scope']}",
        "messages": [
            {"role": "system", "content": prompt[:16_384]},
            {
                "role": "user",
                "content": (
                    f"Scope: {profile['scope']}\n"
                    f"Test input: {text(user_input, 1_000)}\n"
                    "只返回 JSON object，用于验证当前追加指令是否清晰。"
                ),
            },
        ],
        "temperature": 0.2,
        "maxOutputTokens": 800,
        "responseFormat": "json_object",
    }
    return apply_custom_instruction(
        request,
        profile["instruction"] if profile["enabled"] else "",
    )


def parse_workbench_result(raw: str, scope: str) -> dict[str, Any]:
    payload = model_payload(raw)
    if not isinstance(payload, dict):
        raise DomainError("parse_failed", "工作台模型返回不是 JSON object")
    keys = [text(item, 80) for item in payload][:20]
    summary = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))[:500]
    diagnostic = normalize_prompt_diagnostic(
        {
            "scope": scope,
            "status": "success",
            "summary": summary,
        }
    )
    return {"parsed": payload, "keys": keys, "diagnostic": diagnostic}


def _optional_id(value: Any, field: str) -> str:
    result = text(value, 160)
    if result and not ID_PATTERN.fullmatch(result):
        raise DomainError("invalid_params", f"{field} 格式无效")
    return result
