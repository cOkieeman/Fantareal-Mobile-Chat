from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from importlib.resources import files
from typing import Any
from uuid import uuid4

ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$")
APPEARANCE_PRESETS = {"modern", "social", "xianxia", "apocalypse"}
APPEARANCE_TONES = {"midnight", "mist"}
GROUP_ID_PATTERN = re.compile(r"^group_[a-z0-9][a-z0-9_-]{5,79}$")
FENCE_PATTERN = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)
THINK_PATTERN = re.compile(r"<think>[\s\S]*?</think>", re.IGNORECASE)


class DomainError(Exception):
    """A stable service-domain failure."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True, slots=True)
class ContextRef:
    card_uid: str
    revision: str
    session_id: str

    def to_dict(self) -> dict[str, str]:
        return {
            "cardUid": self.card_uid,
            "contextRevision": self.revision,
            "sessionId": self.session_id,
        }


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:16]}"


def text(value: Any, maximum: int, *, required: bool = False, field: str = "value") -> str:
    if not isinstance(value, str):
        value = ""
    result = value.strip()[:maximum]
    if required and not result:
        raise DomainError("invalid_params", f"{field} 不能为空")
    return result


def mapping(value: Any, *, field: str = "value") -> dict[str, Any]:
    if not isinstance(value, dict):
        raise DomainError("invalid_params", f"{field} 必须是 object")
    return value


def sequence(value: Any, *, field: str = "value") -> list[Any]:
    if not isinstance(value, list):
        raise DomainError("invalid_params", f"{field} 必须是 array")
    return value


def normalize_context(value: Any) -> ContextRef:
    source = mapping(value, field="context")
    card_uid = text(source.get("cardUid"), 160, required=True, field="cardUid")
    revision = text(
        source.get("contextRevision"),
        160,
        required=True,
        field="contextRevision",
    )
    session_id = text(source.get("sessionId"), 160, required=True, field="sessionId")
    if not ID_PATTERN.fullmatch(card_uid):
        raise DomainError("invalid_card_uid", "cardUid 格式不安全")
    if not ID_PATTERN.fullmatch(revision) or not ID_PATTERN.fullmatch(session_id):
        raise DomainError("invalid_context", "contextRevision 或 sessionId 格式无效")
    return ContextRef(card_uid, revision, session_id)


def normalize_character(value: Any) -> dict[str, Any]:
    source = mapping(value, field="character")
    card_uid = text(source.get("cardUid"), 160, required=True, field="character.cardUid")
    if not ID_PATTERN.fullmatch(card_uid):
        raise DomainError("invalid_card_uid", "character.cardUid 格式不安全")
    tags = []
    raw_tags = source.get("tags", [])
    for item in raw_tags if isinstance(raw_tags, list) else []:
        tag = text(item, 80)
        if tag and tag not in tags and len(tags) < 32:
            tags.append(tag)
    return {
        "cardUid": card_uid,
        "name": text(source.get("name"), 120) or "未命名角色",
        "description": text(source.get("description"), 4000),
        "personality": text(source.get("personality"), 4000),
        "scenario": text(source.get("scenario"), 4000),
        "tags": tags,
    }


def normalize_member(value: Any) -> dict[str, str]:
    source = mapping(value, field="member")
    role_id = text(
        source.get("roleId") or source.get("role_id"),
        160,
        required=True,
        field="member.roleId",
    )
    if not ID_PATTERN.fullmatch(role_id):
        raise DomainError("invalid_member", "member.roleId 格式无效")
    kind = text(source.get("kind") or source.get("type"), 20).lower()
    if kind not in {"user", "character"}:
        raise DomainError("invalid_member", "member.kind 只支持 user 或 character")
    display_name = text(
        source.get("displayName") or source.get("name"),
        120,
        required=True,
        field="member.displayName",
    )
    return {
        "roleId": role_id,
        "displayName": display_name,
        "kind": kind,
        "summary": text(source.get("summary"), 1000),
    }


def normalize_group(value: Any, *, existing: dict[str, Any] | None = None) -> dict[str, Any]:
    source = {**(existing or {}), **mapping(value, field="group")}
    group_id = text(source.get("groupId") or source.get("group_id"), 86)
    if not group_id:
        group_id = new_id("group")
    if not GROUP_ID_PATTERN.fullmatch(group_id):
        raise DomainError("invalid_group", "groupId 格式无效")

    members: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in sequence(source.get("members", []), field="group.members"):
        member = normalize_member(item)
        if member["roleId"] in seen:
            continue
        members.append(member)
        seen.add(member["roleId"])
    if not any(item["kind"] == "character" for item in members):
        raise DomainError("invalid_group", "群聊至少需要一名角色成员")

    reply_count = source.get("replyCount", source.get("reply_count", 2))
    if isinstance(reply_count, str) and reply_count == "1-2":
        reply_count = 2
    if reply_count not in {1, 2, "1", "2"}:
        raise DomainError("invalid_group", "replyCount 只支持 1 或 2")
    created_at = text(source.get("createdAt") or source.get("created_at"), 80) or now_iso()
    return {
        "groupId": group_id,
        "title": text(
            source.get("title") or source.get("name"),
            80,
            required=True,
            field="group.title",
        ),
        "description": text(source.get("description"), 500),
        "members": members,
        "replyCount": int(reply_count),
        "allowRoleToRoleReply": bool(
            source.get(
                "allowRoleToRoleReply",
                source.get("allow_role_to_role_reply", True),
            )
        ),
        "createdAt": created_at,
        "updatedAt": text(source.get("updatedAt") or source.get("updated_at"), 80) or now_iso(),
    }


def normalize_resource_ref(value: Any, *, kind: str = "resource") -> dict[str, str]:
    source = mapping(value, field=kind)
    pack_id = text(source.get("packId"), 120)
    asset_id = text(source.get("assetId"), 120)
    alt = text(source.get("alt"), 120) or "未命名"
    if not ID_PATTERN.fullmatch(pack_id) or not ID_PATTERN.fullmatch(asset_id):
        raise DomainError("invalid_resource_ref", f"{kind} 引用无效")
    return {"packId": pack_id, "assetId": asset_id, "alt": alt}


def normalize_appearance(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    preset = text(source.get("preset"), 24).lower()
    tone = text(source.get("tone"), 24).lower()
    background = source.get("background")
    try:
        normalized_background = (
            normalize_resource_ref(background, kind="appearance.background")
            if background is not None
            else None
        )
    except DomainError:
        normalized_background = None
    return {
        "schemaVersion": 1,
        "preset": preset if preset in APPEARANCE_PRESETS else "modern",
        "tone": tone if tone in APPEARANCE_TONES else "midnight",
        "background": normalized_background,
    }


def normalize_message(value: Any) -> dict[str, Any]:
    source = mapping(value, field="message")
    message_type = text(source.get("type"), 20).lower() or "text"
    if message_type not in {"text", "error", "sticker"}:
        raise DomainError("invalid_message", "message.type 只支持 text、error 或 sticker")
    source_kind = text(source.get("source"), 20).lower() or "system"
    if source_kind not in {"user", "ai", "system", "import"}:
        raise DomainError("invalid_message", "message.source 无效")
    speaker_id = text(
        source.get("speakerId") or source.get("speaker_id"),
        160,
        required=True,
        field="message.speakerId",
    )
    if not ID_PATTERN.fullmatch(speaker_id):
        raise DomainError("invalid_message", "message.speakerId 格式无效")
    message_id = text(source.get("messageId") or source.get("message_id"), 160)
    if message_id and not ID_PATTERN.fullmatch(message_id):
        message_id = ""
    result: dict[str, Any] = {
        "messageId": message_id or new_id("msg"),
        "speakerId": speaker_id,
        "speakerName": text(
            source.get("speakerName") or source.get("speaker_name"),
            120,
        )
        or "系统",
        "type": message_type,
        "createdAt": text(source.get("createdAt") or source.get("created_at"), 80) or now_iso(),
        "source": source_kind,
    }
    if message_type == "sticker":
        sticker = normalize_resource_ref(source.get("sticker"), kind="message.sticker")
        result["sticker"] = sticker
        result["content"] = f"[表情：{sticker['alt']}]"
    else:
        result["content"] = text(
            source.get("content"),
            16_384,
            required=True,
            field="message.content",
        )
    return result


def user_message(group: dict[str, Any], content: str) -> dict[str, Any]:
    user = next((item for item in group["members"] if item["kind"] == "user"), None)
    return normalize_message(
        {
            "speakerId": user["roleId"] if user else "user",
            "speakerName": user["displayName"] if user else "我",
            "type": "text",
            "content": text(content, 500, required=True, field="content"),
            "source": "user",
        }
    )


def user_sticker_message(group: dict[str, Any], sticker: Any) -> dict[str, Any]:
    user = next((item for item in group["members"] if item["kind"] == "user"), None)
    return normalize_message(
        {
            "speakerId": user["roleId"] if user else "user",
            "speakerName": user["displayName"] if user else "我",
            "type": "sticker",
            "sticker": sticker,
            "source": "user",
        }
    )


def system_error_message(content: str) -> dict[str, Any]:
    return normalize_message(
        {
            "speakerId": "system",
            "speakerName": "系统",
            "type": "error",
            "content": text(content, 500, required=True, field="error"),
            "source": "system",
        }
    )


DEFAULT_SYSTEM_PROMPT = (
    files("fantareal_mobile_chat")
    .joinpath("prompts", "group-chat.md")
    .read_text(encoding="utf-8")
    .strip()
)


def build_llm_request(
    group: dict[str, Any],
    recent_messages: list[dict[str, Any]],
    active_character: dict[str, Any],
    *,
    content: str = "",
    mode: str = "user_message",
    system_prompt: str = DEFAULT_SYSTEM_PROMPT,
    prompt_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if mode not in {"user_message", "continue"}:
        raise DomainError("invalid_generation_mode", "mode 只支持 user_message 或 continue")
    content = (
        text(content, 500, required=True, field="content")
        if mode == "user_message"
        else ""
    )
    context = {
        "group": {
            "groupId": group["groupId"],
            "title": group["title"],
            "description": group["description"],
            "members": group["members"],
            "replyCount": group["replyCount"],
            "allowRoleToRoleReply": group["allowRoleToRoleReply"],
        },
        "activeCharacter": active_character,
        "recentMessages": [
            {
                "speakerId": item["speakerId"],
                "speakerName": item["speakerName"],
                "type": item["type"],
                "content": item["content"],
            }
            for item in recent_messages[-30:]
            if item["type"] in {"text", "sticker"}
        ],
        "mobile_context": prompt_context or {},
        "mode": mode,
        "userMessage": content,
    }
    instruction = (
        "用户刚刚发言，请让群内角色自然回复。"
        if mode == "user_message"
        else "用户本轮没有发言，请让角色基于最近对话自然续聊，不要替用户发言。"
    )
    serialized_context = json.dumps(
        context,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return {
        "purpose": "mobile-chat.group-reply",
        "messages": [
            {"role": "system", "content": system_prompt.strip()[:16_384]},
            {
                "role": "user",
                "content": (
                    f"{instruction}\n"
                    "严格使用 group.members 中的 roleId 和 displayName 作为 speakerId/speakerName。"
                    f"\nContext JSON:\n{serialized_context}"
                ),
            },
        ],
        "temperature": 0.85,
        "maxOutputTokens": 1200,
        "responseFormat": "json_object",
    }


def model_payload(raw: str) -> Any:
    cleaned = THINK_PATTERN.sub("", text(raw, 65_536, required=True, field="content")).strip()
    fenced = FENCE_PATTERN.search(cleaned)
    if fenced:
        cleaned = fenced.group(1).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(cleaned[start : end + 1])
            except json.JSONDecodeError as exc:
                raise DomainError("parse_failed", "模型返回内容不是合法 JSON") from exc
        raise DomainError("parse_failed", "模型返回内容不是合法 JSON") from None


def parse_llm_messages(raw: str, group: dict[str, Any]) -> list[dict[str, str]]:
    payload = model_payload(raw)
    if not isinstance(payload, dict) or not isinstance(payload.get("messages"), list):
        raise DomainError("parse_failed", "模型返回缺少 messages array")
    characters = [item for item in group["members"] if item["kind"] == "character"]
    by_id = {item["roleId"]: item for item in characters}
    by_name = {item["displayName"].casefold(): item for item in characters}
    result: list[dict[str, str]] = []
    for item in payload["messages"]:
        if not isinstance(item, dict):
            continue
        speaker_id = text(
            item.get("speakerId")
            or item.get("speaker_id")
            or item.get("roleId")
            or item.get("role_id")
            or item.get("authorId")
            or item.get("author_id"),
            160,
        )
        speaker_name = text(
            item.get("speakerName")
            or item.get("speaker_name")
            or item.get("speaker")
            or item.get("name")
            or item.get("author")
            or item.get("authorName")
            or item.get("author_name"),
            120,
        )
        member = by_id.get(speaker_id) or by_name.get(speaker_name.casefold())
        content = text(
            item.get("content") or item.get("text") or item.get("body"),
            500,
        )
        message_type = text(item.get("type"), 20).lower() or "text"
        if member is None or not content or message_type != "text":
            continue
        result.append(
            normalize_message(
                {
                    "speakerId": member["roleId"],
                    "speakerName": member["displayName"],
                    "type": "text",
                    "content": content,
                    "source": "ai",
                }
            )
        )
        if len(result) >= group["replyCount"]:
            break
    if not result:
        raise DomainError("parse_failed", "模型没有返回可用的群聊消息")
    return result
