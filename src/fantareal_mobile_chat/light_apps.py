from __future__ import annotations

import json
from datetime import date
from importlib.resources import files
from typing import Any

from .domain import (
    ID_PATTERN,
    DomainError,
    mapping,
    model_payload,
    new_id,
    normalize_member,
    now_iso,
    sequence,
    text,
)

DIARY_ID_PREFIX = "diary"
CALENDAR_ID_PREFIX = "calendar"
NOTIFICATION_ID_PREFIX = "notification"
CALENDAR_STATUSES = {"planned", "completed", "cancelled"}
NOTIFICATION_SOURCES = {
    "system",
    "diary",
    "calendar",
    "feed",
    "forum",
    "mail",
    "phone",
    "live",
    "import",
}
PROMPTS = {
    purpose: (
        files("fantareal_mobile_chat")
        .joinpath("prompts", f"{purpose}.md")
        .read_text(encoding="utf-8")
        .strip()
    )
    for purpose in ("diary", "calendar")
}


def iso_date(value: Any, *, field: str, required: bool = True) -> str:
    result = text(value, 10, required=required, field=field)
    if not result:
        return ""
    try:
        return date.fromisoformat(result).isoformat()
    except ValueError as exc:
        raise DomainError("invalid_params", f"{field} 必须是 YYYY-MM-DD") from exc


def tags(value: Any) -> list[str]:
    result: list[str] = []
    for item in value if isinstance(value, list) else []:
        tag = text(item, 40)
        if tag and tag not in result and len(result) < 12:
            result.append(tag)
    return result


def resource_id(value: Any, prefix: str, *, field: str) -> str:
    result = text(value, 160) or new_id(prefix)
    if not result.startswith(f"{prefix}_") or not ID_PATTERN.fullmatch(result):
        raise DomainError("invalid_params", f"{field} 格式无效")
    return result


def normalize_diary_entry(
    value: Any,
    *,
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    source = {**(existing or {}), **mapping(value, field="diaryEntry")}
    created_at = text(source.get("createdAt"), 80) or now_iso()
    author_id = text(
        source.get("authorId"),
        160,
        required=True,
        field="diaryEntry.authorId",
    )
    if not ID_PATTERN.fullmatch(author_id):
        raise DomainError("invalid_params", "diaryEntry.authorId 格式无效")
    return {
        "entryId": resource_id(source.get("entryId"), DIARY_ID_PREFIX, field="entryId"),
        "title": text(source.get("title"), 120, required=True, field="diaryEntry.title"),
        "content": text(
            source.get("content"),
            8_000,
            required=True,
            field="diaryEntry.content",
        ),
        "entryDate": iso_date(
            source.get("entryDate") or created_at[:10],
            field="diaryEntry.entryDate",
        ),
        "mood": text(source.get("mood"), 40),
        "authorId": author_id,
        "authorName": text(source.get("authorName"), 120) or "当前角色",
        "tags": tags(source.get("tags")),
        "source": content_source(source.get("source")),
        "createdAt": created_at,
        "updatedAt": text(source.get("updatedAt"), 80) or now_iso(),
    }


def normalize_calendar_event(
    value: Any,
    *,
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    source = {**(existing or {}), **mapping(value, field="calendarEvent")}
    starts_on = iso_date(source.get("startsOn"), field="calendarEvent.startsOn")
    ends_on = iso_date(
        source.get("endsOn"),
        field="calendarEvent.endsOn",
        required=False,
    )
    if ends_on and ends_on < starts_on:
        raise DomainError("invalid_params", "calendarEvent.endsOn 不能早于 startsOn")
    status = text(source.get("status"), 20).lower() or "planned"
    if status not in CALENDAR_STATUSES:
        raise DomainError("invalid_params", "calendarEvent.status 无效")
    participants: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in sequence(source.get("participants", []), field="calendarEvent.participants"):
        participant = normalize_member(item)
        if participant["roleId"] not in seen:
            participants.append(participant)
            seen.add(participant["roleId"])
        if len(participants) == 32:
            break
    created_at = text(source.get("createdAt"), 80) or now_iso()
    return {
        "eventId": resource_id(source.get("eventId"), CALENDAR_ID_PREFIX, field="eventId"),
        "title": text(source.get("title"), 120, required=True, field="calendarEvent.title"),
        "description": text(source.get("description"), 2_000),
        "startsOn": starts_on,
        "endsOn": ends_on,
        "allDay": bool(source.get("allDay", True)),
        "status": status,
        "participants": participants,
        "location": text(source.get("location"), 200),
        "tags": tags(source.get("tags")),
        "source": content_source(source.get("source")),
        "createdAt": created_at,
        "updatedAt": text(source.get("updatedAt"), 80) or now_iso(),
    }


def normalize_notification(
    value: Any,
    *,
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    source = {**(existing or {}), **mapping(value, field="notification")}
    notification_source = text(source.get("source"), 20).lower() or "system"
    if notification_source not in NOTIFICATION_SOURCES:
        raise DomainError("invalid_params", "notification.source 无效")
    source_id = text(source.get("sourceId"), 160)
    if source_id and not ID_PATTERN.fullmatch(source_id):
        raise DomainError("invalid_params", "notification.sourceId 格式无效")
    return {
        "notificationId": resource_id(
            source.get("notificationId"),
            NOTIFICATION_ID_PREFIX,
            field="notificationId",
        ),
        "title": text(source.get("title"), 120, required=True, field="notification.title"),
        "content": text(source.get("content"), 1_000),
        "source": notification_source,
        "sourceId": source_id,
        "isRead": bool(source.get("isRead", False)),
        "createdAt": text(source.get("createdAt"), 80) or now_iso(),
    }


def build_light_app_request(
    purpose: str,
    active_character: dict[str, Any],
    existing: list[dict[str, Any]],
) -> dict[str, Any]:
    if purpose not in PROMPTS:
        raise DomainError("invalid_generation_purpose", "不支持的轻应用生成 purpose")
    compact_existing = []
    if purpose == "diary":
        compact_existing = [
            {
                "title": item["title"],
                "entryDate": item["entryDate"],
                "mood": item["mood"],
            }
            for item in existing[:12]
        ]
    if purpose == "calendar":
        compact_existing = [
            {
                "title": item["title"],
                "startsOn": item["startsOn"],
                "endsOn": item["endsOn"],
                "status": item["status"],
            }
            for item in existing[:12]
        ]
    context = json.dumps(
        {
            "today": now_iso()[:10],
            "activeCharacter": active_character,
            "existing": compact_existing,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return {
        "purpose": f"mobile-chat.{purpose}",
        "messages": [
            {"role": "system", "content": PROMPTS[purpose][:16_384]},
            {
                "role": "user",
                "content": (
                    "根据当前角色资料生成 1 条新内容。不要照抄 existing，也不要虚构用户隐私。"
                    f"\nContext JSON:\n{context}"
                ),
            },
        ],
        "temperature": 0.8,
        "maxOutputTokens": 1600 if purpose == "diary" else 1200,
        "responseFormat": "json_object",
    }


def parse_generated_diary(
    raw: str,
    active_character: dict[str, Any],
) -> list[dict[str, Any]]:
    payload = model_payload(raw)
    rows = payload.get("entries") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise DomainError("parse_failed", "模型返回缺少 entries array")
    result = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        try:
            result.append(
                normalize_diary_entry(
                    {
                        **item,
                        "authorId": active_character["cardUid"],
                        "authorName": active_character["name"],
                        "source": "model",
                    }
                )
            )
        except DomainError:
            continue
        if len(result) == 4:
            break
    if not result:
        raise DomainError("parse_failed", "模型没有返回可用日记")
    return result


def parse_generated_calendar(
    raw: str,
    active_character: dict[str, Any],
) -> list[dict[str, Any]]:
    payload = model_payload(raw)
    rows = payload.get("events") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise DomainError("parse_failed", "模型返回缺少 events array")
    participant = {
        "roleId": active_character["cardUid"],
        "displayName": active_character["name"],
        "kind": "character",
        "summary": active_character.get("description", ""),
    }
    result = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        try:
            result.append(
                normalize_calendar_event(
                    {
                        **item,
                        "participants": [participant],
                        "status": item.get("status") or "planned",
                        "source": "model",
                    }
                )
            )
        except DomainError:
            continue
        if len(result) == 4:
            break
    if not result:
        raise DomainError("parse_failed", "模型没有返回可用日程")
    return result


def content_source(value: Any) -> str:
    result = text(value, 20).lower() or "manual"
    if result not in {"manual", "model", "import"}:
        raise DomainError("invalid_params", "source 无效")
    return result
