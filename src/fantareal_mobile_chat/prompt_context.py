from __future__ import annotations

from typing import Any

from .domain import now_iso

HOST_CHAT_MESSAGE_LIMIT = 8
HOST_CHAT_MESSAGE_CHAR_LIMIT = 800
HOST_CHAT_TOTAL_CHAR_LIMIT = 4_800


def normalize_host_chat_context(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    source_messages = source.get("recentMessages")
    messages = source_messages if isinstance(source_messages, list) else []
    declared_available = source.get("available")
    available = (
        declared_available
        if isinstance(declared_available, bool)
        else isinstance(source_messages, list)
    )
    remaining = HOST_CHAT_TOTAL_CHAR_LIMIT
    recent_messages: list[dict[str, str]] = []
    for item in reversed(messages[-HOST_CHAT_MESSAGE_LIMIT:] if available else []):
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role not in {"user", "assistant"} or not isinstance(content, str):
            continue
        clipped = content.strip()[: min(HOST_CHAT_MESSAGE_CHAR_LIMIT, remaining)]
        if not clipped:
            continue
        recent_messages.append({"role": role, "content": clipped})
        remaining -= len(clipped)
        if remaining <= 0:
            break
    recent_messages.reverse()
    return {
        "available": available,
        "recentMessages": recent_messages,
    }


def mobile_prompt_context(
    target_app: str,
    active_character: dict[str, Any],
    *,
    characters: list[dict[str, Any]] | None = None,
    groups: list[dict[str, Any]] | None = None,
    recent_events: list[dict[str, Any]] | None = None,
    chat_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    role_rows = [active_character] if characters is None else characters
    names = {item.get("cardUid"): item.get("name", "") for item in role_rows}
    current_datetime = now_iso()
    normalized_chat = normalize_host_chat_context(chat_context)
    chat_available = normalized_chat["available"]
    return {
        "target_app": target_app,
        "current_date": current_datetime[:10],
        "current_datetime": current_datetime,
        "active_character_id": active_character.get("cardUid", ""),
        "role_app_policy": {
            "allowed_authors": "roles 中的白名单角色",
            "selection": "按角色资料、关系和当前情境选择自然参与者",
            "user_impersonation": "forbidden",
            "unknown_people": "只能作为当前内容内的世界路人，不得创建角色 ID",
        },
        "roles": [
            {
                "card_uid": item.get("cardUid", ""),
                "display_name": item.get("name", ""),
                "summary": item.get("description", ""),
                "personality": item.get("personality", ""),
                "scenario": item.get("scenario", ""),
                "tags": item.get("tags", []),
                "usage_in_target_app": "allowed",
            }
            for item in role_rows[:12]
        ],
        "groups": [
            {
                "name": item.get("title", ""),
                "description": item.get("description", ""),
                "members": [
                    names.get(member.get("roleId"), member.get("displayName", ""))
                    for member in item.get("members", [])
                    if member.get("kind") == "character"
                ][:8],
            }
            for item in (groups or [])[:8]
        ],
        "recent_channel_events": (recent_events or [])[:12],
        "main_story_context": {
            "source": (
                "host_sanitized_recent_chat"
                if chat_available
                else "not_provided_by_host"
            ),
            "instruction": (
                "把 recent_main_chat 视为主 Chat 的最新白名单片段，只用于保持已经明确出现的"
                "关系、事件与语气连续性；不得扩写未提供的剧情或秘密。"
            ),
            "recent_main_chat": normalized_chat["recentMessages"],
        },
        "context_availability": {
            "main_story_context": (
                "provided_by_host" if chat_available else "not_provided_by_host"
            ),
            "memory_context": "not_provided_by_host",
            "private_card_body": "not_provided_by_host",
            "rule": "不得猜测或声称读取未提供的主剧情、记忆、角色卡正文或隐私数据",
        },
    }
