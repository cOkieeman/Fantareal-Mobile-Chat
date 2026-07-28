from __future__ import annotations

import json
from importlib.resources import files
from typing import Any

from .domain import ID_PATTERN, DomainError, mapping, model_payload, now_iso, sequence, text
from .light_apps import content_source, resource_id
from .prompt_context import mobile_prompt_context

MAIL_THREAD_PREFIX = "mail"
MAIL_MESSAGE_PREFIX = "mailmsg"
MAIL_DIRECTIONS = {"sent", "received"}
PROMPTS = {
    purpose: (
        files("fantareal_mobile_chat")
        .joinpath("prompts", f"{purpose}.md")
        .read_text(encoding="utf-8")
        .strip()
    )
    for purpose in ("mail", "mail-reply")
}


def normalize_mail_message(value: Any) -> dict[str, Any]:
    source = mapping(value, field="mailMessage")
    direction = text(source.get("direction"), 20).lower()
    if direction not in MAIL_DIRECTIONS:
        raise DomainError("invalid_params", "mailMessage.direction 无效")
    return {
        "messageId": resource_id(
            source.get("messageId"),
            MAIL_MESSAGE_PREFIX,
            field="messageId",
        ),
        "direction": direction,
        "authorId": _safe_id(source.get("authorId"), "mailMessage.authorId"),
        "authorName": text(
            source.get("authorName"),
            120,
            required=True,
            field="mailMessage.authorName",
        ),
        "content": text(
            source.get("content"),
            2_000,
            required=True,
            field="mailMessage.content",
        ),
        "mood": text(source.get("mood"), 40),
        "source": content_source(source.get("source")),
        "createdAt": text(source.get("createdAt"), 80) or now_iso(),
    }


def normalize_mail_thread(
    value: Any,
    *,
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    source = {**(existing or {}), **mapping(value, field="mailThread")}
    messages = []
    seen = set()
    for item in sequence(source.get("messages", []), field="mailThread.messages"):
        message = normalize_mail_message(item)
        if message["messageId"] not in seen:
            messages.append(message)
            seen.add(message["messageId"])
        if len(messages) == 100:
            break
    if not messages:
        raise DomainError("invalid_params", "mailThread.messages 不能为空")
    created_at = text(source.get("createdAt"), 80) or now_iso()
    return {
        "threadId": resource_id(
            source.get("threadId"),
            MAIL_THREAD_PREFIX,
            field="threadId",
        ),
        "subject": text(
            source.get("subject"),
            120,
            required=True,
            field="mailThread.subject",
        ),
        "counterpartyId": _safe_id(
            source.get("counterpartyId"),
            "mailThread.counterpartyId",
        ),
        "counterpartyName": text(
            source.get("counterpartyName"),
            120,
            required=True,
            field="mailThread.counterpartyName",
        ),
        "messages": messages,
        "isRead": bool(source.get("isRead", False)),
        "source": content_source(source.get("source")),
        "createdAt": created_at,
        "updatedAt": text(source.get("updatedAt"), 80) or now_iso(),
    }


def build_mail_request(
    purpose: str,
    active_character: dict[str, Any],
    existing: list[dict[str, Any]],
    *,
    draft: dict[str, Any] | None = None,
    thread: dict[str, Any] | None = None,
    characters: list[dict[str, Any]] | None = None,
    groups: list[dict[str, Any]] | None = None,
    chat_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if purpose not in {"mail", "mail-compose", "mail-reply"}:
        raise DomainError("invalid_generation_purpose", "不支持的邮箱生成 purpose")
    prompt_key = "mail" if purpose == "mail" else "mail-reply"
    compact_existing = [
        {
            "subject": item["subject"],
            "counterpartyName": item["counterpartyName"],
            "latest": item["messages"][-1]["content"][:240],
        }
        for item in existing[:12]
    ]
    context = json.dumps(
        {
            "activeCharacter": active_character,
            "existing": compact_existing,
            "draft": draft or {},
            "thread": thread or {},
            "mobile_context": mobile_prompt_context(
                "mail",
                active_character,
                characters=characters,
                groups=groups,
                chat_context=chat_context,
                recent_events=compact_existing,
            ),
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    task = {
        "mail": "生成 1 封当前角色写给用户的新邮件。",
        "mail-compose": "用户刚给当前角色写了一封新邮件，请生成 1 封角色回信。",
        "mail-reply": "用户刚回复了当前邮件线程，请生成 1 封角色回信。",
    }[purpose]
    return {
        "purpose": f"mobile-chat.{purpose}",
        "messages": [
            {"role": "system", "content": PROMPTS[prompt_key][:16_384]},
            {
                "role": "user",
                "content": (
                    f"{task} 不要虚构用户隐私，不要提及插件、API 或 JSON。"
                    f"\nContext JSON:\n{context}"
                ),
            },
        ],
        "temperature": 0.8,
        "maxOutputTokens": 3_200,
        "responseFormat": "json_object",
    }


def parse_generated_mail_threads(
    raw: str,
    active_character: dict[str, Any],
) -> list[dict[str, Any]]:
    payload = model_payload(raw)
    rows = payload.get("threads") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise DomainError("parse_failed", "模型返回缺少 threads array")
    result = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        content = text(item.get("content"), 2_000)
        if not content:
            continue
        try:
            result.append(
                normalize_mail_thread(
                    {
                        "subject": item.get("subject"),
                        "counterpartyId": active_character["cardUid"],
                        "counterpartyName": active_character["name"],
                        "messages": [
                            {
                                "direction": "received",
                                "authorId": active_character["cardUid"],
                                "authorName": active_character["name"],
                                "content": content,
                                "mood": item.get("mood", ""),
                                "source": "model",
                            }
                        ],
                        "isRead": False,
                        "source": "model",
                    }
                )
            )
        except DomainError:
            continue
        if len(result) == 4:
            break
    if not result:
        raise DomainError("parse_failed", "模型没有返回可用邮件")
    return result


def parse_generated_mail_messages(
    raw: str,
    counterparty: dict[str, Any],
) -> list[dict[str, Any]]:
    payload = model_payload(raw)
    rows = payload.get("messages") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise DomainError("parse_failed", "模型返回缺少 messages array")
    result = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        try:
            result.append(
                normalize_mail_message(
                    {
                        **item,
                        "direction": "received",
                        "authorId": counterparty["cardUid"],
                        "authorName": counterparty["name"],
                        "source": "model",
                    }
                )
            )
        except DomainError:
            continue
        if len(result) == 2:
            break
    if not result:
        raise DomainError("parse_failed", "模型没有返回可用邮件回复")
    return result


def _safe_id(value: Any, field: str) -> str:
    result = text(value, 160, required=True, field=field)
    if not ID_PATTERN.fullmatch(result):
        raise DomainError("invalid_params", f"{field} 格式无效")
    return result
