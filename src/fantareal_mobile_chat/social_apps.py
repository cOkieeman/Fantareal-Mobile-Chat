from __future__ import annotations

import json
from importlib.resources import files
from typing import Any

from .domain import ID_PATTERN, DomainError, mapping, model_payload, now_iso, sequence, text
from .light_apps import content_source, resource_id, tags
from .prompt_context import mobile_prompt_context

FEED_ID_PREFIX = "feed"
THREAD_ID_PREFIX = "thread"
REPLY_ID_PREFIX = "reply"
PROMPTS = {
    purpose: (
        files("fantareal_mobile_chat")
        .joinpath("prompts", f"{purpose}.md")
        .read_text(encoding="utf-8")
        .strip()
    )
    for purpose in ("feed", "forum")
}


def normalize_feed_post(
    value: Any,
    *,
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    source = {**(existing or {}), **mapping(value, field="feedPost")}
    author_id = _safe_author_id(source.get("authorId"), "feedPost.authorId")
    created_at = text(source.get("createdAt"), 80) or now_iso()
    content = text(
        source.get("content"),
        2_000,
        required=True,
        field="feedPost.content",
    )
    like_count = source.get("likeCount", 0)
    if isinstance(like_count, bool) or not isinstance(like_count, int):
        raise DomainError("invalid_params", "feedPost.likeCount 必须是 integer")
    return {
        "postId": resource_id(source.get("postId"), FEED_ID_PREFIX, field="postId"),
        "title": text(source.get("title"), 120) or content[:40],
        "content": content,
        "authorId": author_id,
        "authorName": text(source.get("authorName"), 120) or "当前角色",
        "eventType": text(source.get("eventType"), 60).lower() or "status",
        "tags": tags(source.get("tags")),
        "metadata": normalize_feed_metadata(source.get("metadata")),
        "liked": bool(source.get("liked", False)),
        "likeCount": min(max(like_count, 0), 1_000_000),
        "source": content_source(source.get("source")),
        "createdAt": created_at,
        "updatedAt": text(source.get("updatedAt"), 80) or now_iso(),
    }


def normalize_feed_metadata(value: Any) -> dict[str, Any]:
    source = mapping(value or {}, field="feedPost.metadata")
    views = source.get("views", 0)
    comment_count = source.get("commentCount", source.get("comment_count", 0))
    for field, count in (("views", views), ("commentCount", comment_count)):
        if isinstance(count, bool) or not isinstance(count, int):
            raise DomainError("invalid_params", f"feedPost.metadata.{field} 必须是 integer")
    return {
        "mood": text(source.get("mood"), 80),
        "location": text(source.get("location"), 120),
        "mediaHint": text(source.get("mediaHint") or source.get("media_hint"), 240),
        "views": min(max(views, 0), 1_000_000),
        "commentCount": min(max(comment_count, 0), 1_000_000),
    }


def normalize_forum_reply(value: Any) -> dict[str, Any]:
    source = mapping(value, field="forumReply")
    return {
        "replyId": resource_id(source.get("replyId"), REPLY_ID_PREFIX, field="replyId"),
        "content": text(
            source.get("content"),
            2_000,
            required=True,
            field="forumReply.content",
        ),
        "authorId": _safe_author_id(source.get("authorId"), "forumReply.authorId"),
        "authorName": text(source.get("authorName"), 120) or "当前角色",
        "source": content_source(source.get("source")),
        "createdAt": text(source.get("createdAt"), 80) or now_iso(),
    }


def normalize_forum_thread(
    value: Any,
    *,
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    source = {**(existing or {}), **mapping(value, field="forumThread")}
    replies = []
    seen = set()
    for item in sequence(source.get("replies", []), field="forumThread.replies"):
        reply = normalize_forum_reply(item)
        if reply["replyId"] not in seen:
            replies.append(reply)
            seen.add(reply["replyId"])
        if len(replies) == 200:
            break
    created_at = text(source.get("createdAt"), 80) or now_iso()
    return {
        "threadId": resource_id(
            source.get("threadId"),
            THREAD_ID_PREFIX,
            field="threadId",
        ),
        "title": text(
            source.get("title"),
            120,
            required=True,
            field="forumThread.title",
        ),
        "body": text(
            source.get("body"),
            8_000,
            required=True,
            field="forumThread.body",
        ),
        "category": text(source.get("category"), 60) or "闲聊",
        "authorId": _safe_author_id(source.get("authorId"), "forumThread.authorId"),
        "authorName": text(source.get("authorName"), 120) or "当前角色",
        "replies": replies,
        "source": content_source(source.get("source")),
        "createdAt": created_at,
        "updatedAt": text(source.get("updatedAt"), 80) or now_iso(),
    }


def build_social_app_request(
    purpose: str,
    active_character: dict[str, Any],
    existing: list[dict[str, Any]],
    *,
    characters: list[dict[str, Any]] | None = None,
    groups: list[dict[str, Any]] | None = None,
    chat_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if purpose not in PROMPTS:
        raise DomainError("invalid_generation_purpose", "不支持的社交应用生成 purpose")
    compact_existing = [
        {
            "title": item.get("title", ""),
            "content": item.get("content", item.get("body", ""))[:280],
            "category": item.get("category", ""),
        }
        for item in existing[:12]
    ]
    if purpose in {"feed", "forum"}:
        role_rows = characters or [active_character]
        mobile_context = mobile_prompt_context(
            purpose,
            active_character,
            characters=role_rows,
            groups=groups,
            chat_context=chat_context,
            recent_events=[
                {
                    "title": item.get("title", ""),
                    "author_name": item.get("authorName", ""),
                    "content": item.get("content", "")[:160],
                    "event_type": item.get("eventType", "status"),
                    "tags": item.get("tags", [])[:3],
                }
                for item in existing[:8]
            ],
        )
        context_payload = {
            "current_date": mobile_context["current_date"],
            "current_datetime": mobile_context["current_datetime"],
            "activeCharacter": active_character,
            "mobile_context": mobile_context,
        }
        instruction = (
            (
                "根据 Context JSON 生成 1 条新的角色动态。"
                if purpose == "feed"
                else "根据 Context JSON 生成 1 个论坛主题和 2 条自然的楼层回复。"
            )
            + "作者必须来自 mobile_context.roles，并遵守 role_app_policy；"
            "不要照抄最近内容，不要冒充用户，也不要补写 "
            "context_availability 标记为未提供的资料。"
        )
    else:
        context_payload = {
            "activeCharacter": active_character,
            "existing": compact_existing,
        }
        instruction = (
            "根据当前角色资料生成 1 条新内容。不要照抄 existing，"
            "不要冒充用户，也不要虚构用户隐私。"
        )
    context = json.dumps(
        context_payload,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return {
        "purpose": f"mobile-chat.{purpose}",
        "messages": [
            {"role": "system", "content": PROMPTS[purpose][:16_384]},
            {
                "role": "user",
                "content": f"{instruction}\nContext JSON:\n{context}",
            },
        ],
        "temperature": 0.85,
        "maxOutputTokens": 1_200 if purpose == "feed" else 1_800,
        "responseFormat": "json_object",
    }


def parse_generated_feed(
    raw: str,
    active_character: dict[str, Any],
    characters: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    payload = model_payload(raw)
    rows = payload.get("events") if isinstance(payload, dict) else None
    if rows is None and isinstance(payload, dict):
        rows = payload.get("posts")
    if not isinstance(rows, list):
        raise DomainError("parse_failed", "模型返回缺少 events array")
    candidates = characters or [active_character]
    by_id = {item.get("cardUid"): item for item in candidates}
    by_name = {item.get("name"): item for item in candidates}
    result = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        raw_metadata = item.get("metadata")
        author_id = (
            item.get("author_id")
            or (raw_metadata.get("author_id") if isinstance(raw_metadata, dict) else "")
        )
        author_name = item.get("author_name")
        author = by_id.get(author_id) or by_name.get(author_name)
        if author is None and not author_id and not author_name:
            author = active_character
        if author is None:
            continue
        try:
            result.append(
                normalize_feed_post(
                    {
                        **item,
                        "title": item.get("title"),
                        "eventType": item.get("event_type") or item.get("eventType"),
                        "authorId": author["cardUid"],
                        "authorName": author["name"],
                        "liked": False,
                        "likeCount": 0,
                        "source": "model",
                    }
                )
            )
        except DomainError:
            continue
        if len(result) == 4:
            break
    if not result:
        raise DomainError("parse_failed", "模型没有返回可用动态")
    return result


def parse_generated_forum(
    raw: str,
    active_character: dict[str, Any],
    characters: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    payload = model_payload(raw)
    rows = payload.get("threads") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise DomainError("parse_failed", "模型返回缺少 threads array")
    result = []
    candidates = characters or [active_character]
    by_id = {item.get("cardUid"): item for item in candidates}
    by_name = {item.get("name"): item for item in candidates}
    for thread_index, item in enumerate(rows):
        if not isinstance(item, dict):
            continue
        author = (
            by_id.get(item.get("author_id") or item.get("authorId"))
            or by_name.get(item.get("author_name") or item.get("authorName"))
            or active_character
        )
        replies = []
        for reply_index, reply in enumerate(item.get("replies", [])[:6]):
            if not isinstance(reply, dict):
                continue
            reply_author = (
                by_id.get(reply.get("author_id") or reply.get("authorId"))
                or by_name.get(reply.get("author_name") or reply.get("authorName"))
            )
            reply_name = (
                reply_author.get("name")
                if reply_author
                else text(reply.get("author_name") or reply.get("authorName"), 120)
                or "论坛路人"
            )
            replies.append(
                {
                    "content": reply.get("content"),
                    "authorId": (
                        reply_author.get("cardUid")
                        if reply_author
                        else f"forum_guest_{thread_index + 1}_{reply_index + 1}"
                    ),
                    "authorName": reply_name,
                    "source": "model",
                }
            )
        try:
            result.append(
                normalize_forum_thread(
                    {
                        **item,
                        "authorId": author["cardUid"],
                        "authorName": author["name"],
                        "replies": replies,
                        "source": "model",
                    }
                )
            )
        except DomainError:
            continue
        if len(result) == 4:
            break
    if not result:
        raise DomainError("parse_failed", "模型没有返回可用论坛主题")
    return result


def _safe_author_id(value: Any, field: str) -> str:
    result = text(value, 160, required=True, field=field)
    if not ID_PATTERN.fullmatch(result):
        raise DomainError("invalid_params", f"{field} 格式无效")
    return result
