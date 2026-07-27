from __future__ import annotations

import json
from importlib.resources import files
from typing import Any

from .domain import ID_PATTERN, DomainError, mapping, model_payload, now_iso, sequence, text
from .light_apps import content_source, resource_id, tags

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
    like_count = source.get("likeCount", 0)
    if isinstance(like_count, bool) or not isinstance(like_count, int):
        raise DomainError("invalid_params", "feedPost.likeCount 必须是 integer")
    return {
        "postId": resource_id(source.get("postId"), FEED_ID_PREFIX, field="postId"),
        "content": text(
            source.get("content"),
            2_000,
            required=True,
            field="feedPost.content",
        ),
        "authorId": author_id,
        "authorName": text(source.get("authorName"), 120) or "当前角色",
        "tags": tags(source.get("tags")),
        "liked": bool(source.get("liked", False)),
        "likeCount": min(max(like_count, 0), 1_000_000),
        "source": content_source(source.get("source")),
        "createdAt": created_at,
        "updatedAt": text(source.get("updatedAt"), 80) or now_iso(),
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
    context = json.dumps(
        {
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
                    "根据当前角色资料生成 1 条新内容。不要照抄 existing，"
                    "不要冒充用户，也不要虚构用户隐私。"
                    f"\nContext JSON:\n{context}"
                ),
            },
        ],
        "temperature": 0.85,
        "maxOutputTokens": 1_200 if purpose == "feed" else 1_800,
        "responseFormat": "json_object",
    }


def parse_generated_feed(
    raw: str,
    active_character: dict[str, Any],
) -> list[dict[str, Any]]:
    payload = model_payload(raw)
    rows = payload.get("posts") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise DomainError("parse_failed", "模型返回缺少 posts array")
    result = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        try:
            result.append(
                normalize_feed_post(
                    {
                        **item,
                        "authorId": active_character["cardUid"],
                        "authorName": active_character["name"],
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
) -> list[dict[str, Any]]:
    payload = model_payload(raw)
    rows = payload.get("threads") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise DomainError("parse_failed", "模型返回缺少 threads array")
    result = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        try:
            result.append(
                normalize_forum_thread(
                    {
                        **item,
                        "authorId": active_character["cardUid"],
                        "authorName": active_character["name"],
                        "replies": [],
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
