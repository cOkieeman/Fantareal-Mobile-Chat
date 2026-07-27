from __future__ import annotations

import json
from importlib.resources import files
from typing import Any

from .domain import ID_PATTERN, DomainError, mapping, model_payload, now_iso, sequence, text
from .light_apps import content_source, resource_id

PHONE_STATES = {"ongoing", "ended", "missed"}
PHONE_DIRECTIONS = {"sent", "received"}
LIVE_STATES = {"live", "ended"}
LIVE_AUTHOR_TYPES = {"user", "character", "viewer"}
PROMPTS = {
    purpose: (
        files("fantareal_mobile_chat")
        .joinpath("prompts", f"{purpose}.md")
        .read_text(encoding="utf-8")
        .strip()
    )
    for purpose in ("phone", "live")
}


def normalize_phone_line(value: Any) -> dict[str, Any]:
    source = mapping(value, field="phoneLine")
    direction = text(source.get("direction"), 20).lower()
    if direction not in PHONE_DIRECTIONS:
        raise DomainError("invalid_params", "phoneLine.direction 无效")
    return {
        "lineId": resource_id(source.get("lineId"), "callline", field="lineId"),
        "direction": direction,
        "authorId": _safe_id(source.get("authorId"), "phoneLine.authorId"),
        "authorName": text(
            source.get("authorName"),
            120,
            required=True,
            field="phoneLine.authorName",
        ),
        "content": text(
            source.get("content"),
            500,
            required=True,
            field="phoneLine.content",
        ),
        "mood": text(source.get("mood"), 40),
        "source": content_source(source.get("source")),
        "createdAt": text(source.get("createdAt"), 80) or now_iso(),
    }


def normalize_phone_session(
    value: Any,
    *,
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    source = {**(existing or {}), **mapping(value, field="phoneSession")}
    lines = []
    seen = set()
    for item in sequence(source.get("lines", []), field="phoneSession.lines"):
        line = normalize_phone_line(item)
        if line["lineId"] not in seen:
            lines.append(line)
            seen.add(line["lineId"])
        if len(lines) == 120:
            break
    if not lines:
        raise DomainError("invalid_params", "phoneSession.lines 不能为空")
    status = text(source.get("status"), 20).lower() or "ongoing"
    if status not in PHONE_STATES:
        raise DomainError("invalid_params", "phoneSession.status 无效")
    ended_by = text(source.get("endedBy"), 20).lower()
    if ended_by not in {"", "user", "character"}:
        raise DomainError("invalid_params", "phoneSession.endedBy 无效")
    return {
        "sessionId": resource_id(source.get("sessionId"), "call", field="sessionId"),
        "contactId": _safe_id(source.get("contactId"), "phoneSession.contactId"),
        "contactName": text(
            source.get("contactName"),
            120,
            required=True,
            field="phoneSession.contactName",
        ),
        "status": status,
        "endedBy": ended_by,
        "lines": lines,
        "source": content_source(source.get("source")),
        "startedAt": text(source.get("startedAt"), 80) or now_iso(),
        "updatedAt": text(source.get("updatedAt"), 80) or now_iso(),
        "endedAt": text(source.get("endedAt"), 80),
    }


def build_phone_request(
    contact: dict[str, Any],
    session: dict[str, Any] | None,
    user_line: str,
) -> dict[str, Any]:
    context = json.dumps(
        {
            "contact": contact,
            "recentLines": (session or {}).get("lines", [])[-20:],
            "userLine": user_line,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return {
        "purpose": "mobile-chat.phone-call",
        "messages": [
            {"role": "system", "content": PROMPTS["phone"][:16_384]},
            {
                "role": "user",
                "content": (
                    "继续一次前台文本模拟通话。只扮演联系人，不要虚构用户隐私，"
                    "不要提及插件、API 或 JSON。\nContext JSON:\n"
                    f"{context}"
                ),
            },
        ],
        "temperature": 0.8,
        "maxOutputTokens": 800,
        "responseFormat": "json_object",
    }


def parse_phone_response(
    raw: str,
    contact: dict[str, Any],
) -> tuple[list[dict[str, Any]], str]:
    payload = model_payload(raw)
    rows = payload.get("lines") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise DomainError("parse_failed", "模型返回缺少 lines array")
    result = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        try:
            result.append(
                normalize_phone_line(
                    {
                        **item,
                        "direction": "received",
                        "authorId": contact["cardUid"],
                        "authorName": contact["name"],
                        "source": "model",
                    }
                )
            )
        except DomainError:
            continue
        if len(result) == 3:
            break
    if not result:
        raise DomainError("parse_failed", "模型没有返回可用电话台词")
    status = text(payload.get("callState"), 20).lower() or "ongoing"
    if status not in PHONE_STATES:
        status = "ongoing"
    return result, status


def normalize_live_message(value: Any) -> dict[str, Any]:
    source = mapping(value, field="liveMessage")
    author_type = text(source.get("authorType"), 20).lower() or "viewer"
    if author_type not in LIVE_AUTHOR_TYPES:
        raise DomainError("invalid_params", "liveMessage.authorType 无效")
    return {
        "messageId": resource_id(source.get("messageId"), "livemsg", field="messageId"),
        "authorId": _safe_id(source.get("authorId"), "liveMessage.authorId"),
        "authorName": text(
            source.get("authorName"),
            120,
            required=True,
            field="liveMessage.authorName",
        ),
        "authorType": author_type,
        "content": text(
            source.get("content"),
            240,
            required=True,
            field="liveMessage.content",
        ),
        "mood": text(source.get("mood"), 40),
        "highlight": bool(source.get("highlight", False)),
        "source": content_source(source.get("source")),
        "createdAt": text(source.get("createdAt"), 80) or now_iso(),
    }


def normalize_live_segment(value: Any) -> dict[str, Any]:
    source = mapping(value, field="liveSegment")
    return {
        "segmentId": resource_id(
            source.get("segmentId"),
            "liveseg",
            field="segmentId",
        ),
        "content": text(
            source.get("content"),
            2_000,
            required=True,
            field="liveSegment.content",
        ),
        "createdAt": text(source.get("createdAt"), 80) or now_iso(),
    }


def normalize_live_stream(
    value: Any,
    *,
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    source = {**(existing or {}), **mapping(value, field="liveStream")}
    segments = [
        normalize_live_segment(item)
        for item in sequence(source.get("segments", []), field="liveStream.segments")
    ][-40:]
    if not segments:
        raise DomainError("invalid_params", "liveStream.segments 不能为空")
    messages = []
    seen = set()
    for item in sequence(source.get("messages", []), field="liveStream.messages"):
        message = normalize_live_message(item)
        if message["messageId"] not in seen:
            messages.append(message)
            seen.add(message["messageId"])
        if len(messages) == 100:
            break
    status = text(source.get("status"), 20).lower() or "live"
    if status not in LIVE_STATES:
        raise DomainError("invalid_params", "liveStream.status 无效")
    return {
        "streamId": resource_id(source.get("streamId"), "live", field="streamId"),
        "hostId": _safe_id(source.get("hostId"), "liveStream.hostId"),
        "hostName": text(
            source.get("hostName"),
            120,
            required=True,
            field="liveStream.hostName",
        ),
        "title": text(
            source.get("title"),
            120,
            required=True,
            field="liveStream.title",
        ),
        "status": status,
        "segments": segments,
        "messages": messages,
        "viewerCount": _metric(source.get("viewerCount"), "viewerCount"),
        "likeCount": _metric(source.get("likeCount"), "likeCount"),
        "userLiked": bool(source.get("userLiked", False)),
        "source": content_source(source.get("source")),
        "createdAt": text(source.get("createdAt"), 80) or now_iso(),
        "updatedAt": text(source.get("updatedAt"), 80) or now_iso(),
        "endedAt": text(source.get("endedAt"), 80),
    }


def build_live_request(
    purpose: str,
    active_character: dict[str, Any],
    existing: list[dict[str, Any]],
    *,
    stream: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if purpose not in {"live", "live-tick"}:
        raise DomainError("invalid_generation_purpose", "不支持的直播生成 purpose")
    compact_existing = [
        {
            "title": item["title"],
            "hostName": item["hostName"],
            "status": item["status"],
        }
        for item in existing[:8]
    ]
    context = json.dumps(
        {
            "activeCharacter": active_character,
            "existing": compact_existing,
            "stream": stream or {},
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    task = (
        "创建 1 个由当前角色主持的前台模拟直播。"
        if purpose == "live"
        else "为当前模拟直播继续 1 个短片段，并生成少量观众弹幕。"
    )
    return {
        "purpose": f"mobile-chat.{purpose}",
        "messages": [
            {"role": "system", "content": PROMPTS["live"][:16_384]},
            {
                "role": "user",
                "content": (
                    f"{task} 不要声称真实联网或真实观众，不要提及插件、API 或 JSON。"
                    f"\nContext JSON:\n{context}"
                ),
            },
        ],
        "temperature": 0.85,
        "maxOutputTokens": 1_800,
        "responseFormat": "json_object",
    }


def parse_live_stream(
    raw: str,
    active_character: dict[str, Any],
) -> dict[str, Any]:
    payload = model_payload(raw)
    if not isinstance(payload, dict):
        raise DomainError("parse_failed", "模型返回不是直播 object")
    segment = text(payload.get("content"), 2_000)
    if not segment:
        raise DomainError("parse_failed", "模型返回缺少直播 content")
    messages = _generated_live_messages(payload.get("messages"), active_character)
    return normalize_live_stream(
        {
            "hostId": active_character["cardUid"],
            "hostName": active_character["name"],
            "title": payload.get("title"),
            "status": "live",
            "segments": [{"content": segment}],
            "messages": messages,
            "viewerCount": payload.get("viewerCount", 0),
            "likeCount": payload.get("likeCount", 0),
            "userLiked": False,
            "source": "model",
        }
    )


def parse_live_tick(
    raw: str,
    stream: dict[str, Any],
) -> dict[str, Any]:
    payload = model_payload(raw)
    if not isinstance(payload, dict):
        raise DomainError("parse_failed", "模型返回不是直播更新 object")
    segment = normalize_live_segment({"content": payload.get("content")})
    messages = _generated_live_messages(
        payload.get("messages"),
        {"cardUid": stream["hostId"], "name": stream["hostName"]},
    )
    status = text(payload.get("status"), 20).lower() or "live"
    if status not in LIVE_STATES:
        status = "live"
    return {
        "segment": segment,
        "messages": messages,
        "status": status,
        "viewerCount": _metric(payload.get("viewerCount"), "viewerCount"),
        "likeCount": _metric(payload.get("likeCount"), "likeCount"),
    }


def _generated_live_messages(
    value: Any,
    active_character: dict[str, Any],
) -> list[dict[str, Any]]:
    result = []
    for index, item in enumerate(value if isinstance(value, list) else []):
        if not isinstance(item, dict):
            continue
        author_type = text(item.get("authorType"), 20).lower() or "viewer"
        is_character = author_type == "character"
        try:
            result.append(
                normalize_live_message(
                    {
                        **item,
                        "authorId": (
                            active_character["cardUid"]
                            if is_character
                            else item.get("authorId") or f"viewer_{index + 1}"
                        ),
                        "authorName": (
                            active_character["name"]
                            if is_character
                            else item.get("authorName") or "观众"
                        ),
                        "source": "model",
                    }
                )
            )
        except DomainError:
            continue
        if len(result) == 12:
            break
    return result


def _metric(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        value = 0
    result = int(value)
    if result < 0 or result > 10_000_000:
        raise DomainError("invalid_params", f"{field} 超出范围")
    return result


def _safe_id(value: Any, field: str) -> str:
    result = text(value, 160, required=True, field=field)
    if not ID_PATTERN.fullmatch(result):
        raise DomainError("invalid_params", f"{field} 格式无效")
    return result
