from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from pathlib import Path
from typing import Any
from uuid import uuid4

from .directory_grants import is_link_or_reparse, resolve_directory_grant
from .domain import (
    ContextRef,
    DomainError,
    mapping,
    normalize_appearance,
    normalize_character,
    normalize_context,
    normalize_group,
    normalize_message,
    now_iso,
    sequence,
    text,
)
from .filesystem import atomic_write_json
from .interactive_apps import (
    normalize_live_message,
    normalize_live_stream,
    normalize_phone_line,
    normalize_phone_session,
)
from .light_apps import (
    normalize_calendar_event,
    normalize_diary_entry,
    normalize_notification,
)
from .mail_apps import normalize_mail_message, normalize_mail_thread
from .prompt_context import normalize_host_chat_context
from .social_apps import (
    normalize_feed_post,
    normalize_forum_reply,
    normalize_forum_thread,
)
from .workbench import (
    PROMPT_SCOPES,
    normalize_character_draft,
    normalize_prompt_diagnostic,
    normalize_prompt_profile,
)


class MobileStore:
    """Atomic, context-bound storage under the Host-provided data root."""

    def __init__(self, data_root: Path, workspace_root: Path) -> None:
        self.data_root = data_root.resolve()
        self.workspace_root = workspace_root.resolve()
        self.cards_root = self.data_root / "cards"
        self.cards_root.mkdir(parents=True, exist_ok=True)
        self.active_context: ContextRef | None = None
        self.characters: list[dict[str, Any]] = []
        self.active_character: dict[str, Any] = {}
        self.chat_context = normalize_host_chat_context(None)

    def bind_context(
        self,
        value: Any,
        characters: Any,
        active_character: Any,
        chat_context: Any = None,
    ) -> dict[str, Any]:
        context = normalize_context(value)
        normalized_characters = []
        seen = set()
        for item in characters if isinstance(characters, list) else []:
            character = normalize_character(item)
            if character["cardUid"] not in seen:
                normalized_characters.append(character)
                seen.add(character["cardUid"])
        normalized_active = normalize_character(active_character)
        if normalized_active["cardUid"] != context.card_uid:
            raise DomainError("context_mismatch", "activeCharacter 与 cardUid 不一致")
        if normalized_active["cardUid"] not in seen:
            normalized_characters.append(normalized_active)
        self.active_context = context
        self.characters = normalized_characters
        self.active_character = normalized_active
        self.chat_context = normalize_host_chat_context(chat_context)
        self._ensure_card_layout(context.card_uid)
        return {
            "context": context.to_dict(),
            "activeCharacter": normalized_active,
            "characters": normalized_characters,
        }

    def require_context(self, value: Any) -> ContextRef:
        context = normalize_context(value)
        if self.active_context is None or context != self.active_context:
            raise DomainError("context_stale", "角色或 Extension session 已变化，请重新加载")
        return context

    def list_groups(self, context: Any) -> list[dict[str, Any]]:
        ref = self.require_context(context)
        payload = self._read_json(
            self._groups_path(ref.card_uid),
            {"schemaVersion": 1, "groups": []},
        )
        rows = payload.get("groups", []) if isinstance(payload, dict) else []
        groups = []
        for item in rows if isinstance(rows, list) else []:
            try:
                group = normalize_group(item)
            except DomainError:
                continue
            messages = self.list_messages(ref.to_dict(), group["groupId"])
            groups.append({**group, "lastMessage": messages[-1] if messages else None})
        return sorted(
            groups,
            key=lambda item: (
                item["lastMessage"]["createdAt"]
                if item["lastMessage"] is not None
                else item["updatedAt"]
            ),
            reverse=True,
        )

    def get_group(self, context: Any, group_id: str) -> dict[str, Any]:
        for group in self.list_groups(context):
            if group["groupId"] == group_id:
                group.pop("lastMessage", None)
                return group
        raise DomainError("not_found", "群聊不存在")

    def create_group(self, context: Any, value: Any) -> dict[str, Any]:
        ref = self.require_context(context)
        group = normalize_group(value)
        groups = [self._without_last(item) for item in self.list_groups(ref.to_dict())]
        if any(item["groupId"] == group["groupId"] for item in groups):
            raise DomainError("conflict", "群聊 ID 已存在")
        groups.append(group)
        self._write_groups(ref.card_uid, groups)
        return group

    def update_group(self, context: Any, group_id: str, value: Any) -> dict[str, Any]:
        ref = self.require_context(context)
        groups = [self._without_last(item) for item in self.list_groups(ref.to_dict())]
        index = next(
            (index for index, item in enumerate(groups) if item["groupId"] == group_id),
            None,
        )
        if index is None:
            raise DomainError("not_found", "群聊不存在")
        merged = normalize_group(
            {**dict(value), "groupId": group_id, "updatedAt": now_iso()},
            existing=groups[index],
        )
        groups[index] = merged
        self._write_groups(ref.card_uid, groups)
        return merged

    def delete_group(self, context: Any, group_id: str) -> None:
        ref = self.require_context(context)
        groups = [self._without_last(item) for item in self.list_groups(ref.to_dict())]
        remaining = [item for item in groups if item["groupId"] != group_id]
        if len(remaining) == len(groups):
            raise DomainError("not_found", "群聊不存在")
        self._write_groups(ref.card_uid, remaining)
        self._messages_path(ref.card_uid, group_id).unlink(missing_ok=True)

    def list_messages(self, context: Any, group_id: str) -> list[dict[str, Any]]:
        ref = self.require_context(context)
        self._validate_group_id(group_id)
        payload = self._read_json(
            self._messages_path(ref.card_uid, group_id),
            {"schemaVersion": 1, "messages": []},
        )
        rows = payload.get("messages", []) if isinstance(payload, dict) else []
        result = []
        for item in rows if isinstance(rows, list) else []:
            try:
                result.append(normalize_message(item))
            except DomainError:
                continue
        return result

    def append_messages(
        self,
        context: Any,
        group_id: str,
        entries: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        ref = self.require_context(context)
        self.get_group(ref.to_dict(), group_id)
        normalized = [normalize_message(item) for item in entries]
        current = self.list_messages(ref.to_dict(), group_id)
        self._write_messages(ref.card_uid, group_id, [*current, *normalized])
        return normalized

    def clear_messages(self, context: Any, group_id: str) -> None:
        ref = self.require_context(context)
        self.get_group(ref.to_dict(), group_id)
        self._write_messages(ref.card_uid, group_id, [])

    def get_appearance(self, context: Any) -> dict[str, Any]:
        ref = self.require_context(context)
        return normalize_appearance(
            self._read_json(self._appearance_path(ref.card_uid), {})
        )

    def update_appearance(self, context: Any, value: Any) -> dict[str, Any]:
        ref = self.require_context(context)
        current = self.get_appearance(ref.to_dict())
        source = mapping(value, field="appearance")
        appearance = normalize_appearance({**current, **source})
        self._write_json(self._appearance_path(ref.card_uid), appearance)
        return appearance

    def export_card(self, context: Any) -> dict[str, Any]:
        ref = self.require_context(context)
        groups = [
            self._without_last(item) for item in self.list_groups(ref.to_dict())
        ]
        data = {
            "groups": groups,
            "messages": {
                group["groupId"]: self.list_messages(
                    ref.to_dict(),
                    group["groupId"],
                )
                for group in groups
            },
            "diary": self.list_diary_entries(ref.to_dict()),
            "calendar": self.list_calendar_events(ref.to_dict()),
            "feed": self.list_feed_posts(ref.to_dict()),
            "forum": self.list_forum_threads(ref.to_dict()),
            "mail": self.list_mail_threads(ref.to_dict()),
            "phone": self.list_phone_sessions(ref.to_dict()),
            "live": self.list_live_streams(ref.to_dict()),
            "assistant": self.list_character_drafts(ref.to_dict()),
            "notifications": self.list_notifications(ref.to_dict()),
            "promptProfiles": self.list_prompt_profiles(ref.to_dict()),
            "promptDiagnostics": self.list_prompt_diagnostics(ref.to_dict()),
            "appearance": self.get_appearance(ref.to_dict()),
        }
        return {
            "schemaVersion": 1,
            "kind": "fantareal.mobile-chat.backup",
            "sourceCardUid": ref.card_uid,
            "exportedAt": now_iso(),
            "includes": [
                "groups",
                "messages",
                "lightApps",
                "notifications",
                "promptProfiles",
                "appearanceReferences",
            ],
            "excludes": ["resourceAssetBytes", "apiKeys", "hostPrivateData"],
            "data": data,
        }

    def preview_restore(self, context: Any, directory_token: str) -> dict[str, Any]:
        ref = self.require_context(context)
        raw, digest = self._read_backup(directory_token)
        backup = self._normalize_backup(raw, ref.card_uid)
        return {
            **self._backup_summary(backup),
            "directoryToken": directory_token,
            "contentDigest": digest,
        }

    def apply_restore(
        self,
        context: Any,
        directory_token: str,
        expected_digest: str,
    ) -> dict[str, Any]:
        ref = self.require_context(context)
        raw, digest = self._read_backup(directory_token)
        if not expected_digest or digest != expected_digest:
            raise DomainError(
                "backup_changed",
                "备份在预览后发生变化，请重新选择并确认",
            )
        backup = self._normalize_backup(raw, ref.card_uid)
        self._replace_card_data(ref.card_uid, backup["data"])
        return self._backup_summary(backup)

    def reset_card(self, context: Any) -> dict[str, Any]:
        ref = self.require_context(context)
        self._replace_card_data(ref.card_uid, self._empty_card_data())
        return {
            "reset": True,
            "cardUid": ref.card_uid,
            "retained": ["resourcePacks"],
        }

    def list_diary_entries(self, context: Any) -> list[dict[str, Any]]:
        ref = self.require_context(context)
        entries = self._read_collection(
            self._diary_path(ref.card_uid),
            "entries",
            normalize_diary_entry,
        )
        return sorted(
            entries,
            key=lambda item: (item["entryDate"], item["createdAt"]),
            reverse=True,
        )

    def create_diary_entry(self, context: Any, value: Any) -> dict[str, Any]:
        return self.create_diary_entries(context, [value])[0]

    def create_diary_entries(
        self,
        context: Any,
        values: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        ref = self.require_context(context)
        created = [normalize_diary_entry(value) for value in values]
        entries = self.list_diary_entries(ref.to_dict())
        known = {item["entryId"] for item in entries}
        for entry in created:
            if entry["entryId"] in known:
                raise DomainError("conflict", "日记 ID 已存在")
            known.add(entry["entryId"])
        self._write_collection(
            self._diary_path(ref.card_uid),
            "entries",
            [*entries, *created],
        )
        return created

    def update_diary_entry(
        self,
        context: Any,
        entry_id: str,
        value: Any,
    ) -> dict[str, Any]:
        ref = self.require_context(context)
        entries = self.list_diary_entries(ref.to_dict())
        index = self._index_of(entries, "entryId", entry_id, "日记")
        updated = normalize_diary_entry(
            {**dict(value), "entryId": entry_id, "updatedAt": now_iso()},
            existing=entries[index],
        )
        entries[index] = updated
        self._write_collection(self._diary_path(ref.card_uid), "entries", entries)
        return updated

    def delete_diary_entry(self, context: Any, entry_id: str) -> None:
        ref = self.require_context(context)
        entries = self.list_diary_entries(ref.to_dict())
        index = self._index_of(entries, "entryId", entry_id, "日记")
        entries.pop(index)
        self._write_collection(self._diary_path(ref.card_uid), "entries", entries)

    def list_calendar_events(self, context: Any) -> list[dict[str, Any]]:
        ref = self.require_context(context)
        events = self._read_collection(
            self._calendar_path(ref.card_uid),
            "events",
            normalize_calendar_event,
        )
        return sorted(
            events,
            key=lambda item: (
                item["status"] != "planned",
                item["startsOn"],
                item["createdAt"],
            ),
        )

    def create_calendar_event(self, context: Any, value: Any) -> dict[str, Any]:
        return self.create_calendar_events(context, [value])[0]

    def create_calendar_events(
        self,
        context: Any,
        values: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        ref = self.require_context(context)
        created = [normalize_calendar_event(value) for value in values]
        events = self.list_calendar_events(ref.to_dict())
        known = {item["eventId"] for item in events}
        for event in created:
            if event["eventId"] in known:
                raise DomainError("conflict", "日程 ID 已存在")
            known.add(event["eventId"])
        self._write_collection(
            self._calendar_path(ref.card_uid),
            "events",
            [*events, *created],
        )
        return created

    def update_calendar_event(
        self,
        context: Any,
        event_id: str,
        value: Any,
    ) -> dict[str, Any]:
        ref = self.require_context(context)
        events = self.list_calendar_events(ref.to_dict())
        index = self._index_of(events, "eventId", event_id, "日程")
        updated = normalize_calendar_event(
            {**dict(value), "eventId": event_id, "updatedAt": now_iso()},
            existing=events[index],
        )
        events[index] = updated
        self._write_collection(self._calendar_path(ref.card_uid), "events", events)
        return updated

    def delete_calendar_event(self, context: Any, event_id: str) -> None:
        ref = self.require_context(context)
        events = self.list_calendar_events(ref.to_dict())
        index = self._index_of(events, "eventId", event_id, "日程")
        events.pop(index)
        self._write_collection(self._calendar_path(ref.card_uid), "events", events)

    def list_feed_posts(self, context: Any) -> list[dict[str, Any]]:
        ref = self.require_context(context)
        posts = self._read_collection(
            self._feed_path(ref.card_uid),
            "posts",
            normalize_feed_post,
        )
        return sorted(posts, key=lambda item: item["createdAt"], reverse=True)

    def create_feed_post(self, context: Any, value: Any) -> dict[str, Any]:
        return self.create_feed_posts(context, [value])[0]

    def create_feed_posts(
        self,
        context: Any,
        values: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        ref = self.require_context(context)
        created = [normalize_feed_post(value) for value in values]
        posts = self.list_feed_posts(ref.to_dict())
        known = {item["postId"] for item in posts}
        for post in created:
            if post["postId"] in known:
                raise DomainError("conflict", "动态 ID 已存在")
            known.add(post["postId"])
        self._write_collection(
            self._feed_path(ref.card_uid),
            "posts",
            [*posts, *created],
        )
        return created

    def update_feed_post(
        self,
        context: Any,
        post_id: str,
        value: Any,
    ) -> dict[str, Any]:
        ref = self.require_context(context)
        posts = self.list_feed_posts(ref.to_dict())
        index = self._index_of(posts, "postId", post_id, "动态")
        updated = normalize_feed_post(
            {**dict(value), "postId": post_id, "updatedAt": now_iso()},
            existing=posts[index],
        )
        posts[index] = updated
        self._write_collection(self._feed_path(ref.card_uid), "posts", posts)
        return updated

    def delete_feed_post(self, context: Any, post_id: str) -> None:
        ref = self.require_context(context)
        posts = self.list_feed_posts(ref.to_dict())
        index = self._index_of(posts, "postId", post_id, "动态")
        posts.pop(index)
        self._write_collection(self._feed_path(ref.card_uid), "posts", posts)

    def toggle_feed_like(self, context: Any, post_id: str) -> dict[str, Any]:
        ref = self.require_context(context)
        posts = self.list_feed_posts(ref.to_dict())
        index = self._index_of(posts, "postId", post_id, "动态")
        current = posts[index]
        liked = not current["liked"]
        posts[index] = normalize_feed_post(
            {
                **current,
                "liked": liked,
                "likeCount": max(0, current["likeCount"] + (1 if liked else -1)),
                "updatedAt": now_iso(),
            }
        )
        self._write_collection(self._feed_path(ref.card_uid), "posts", posts)
        return posts[index]

    def list_forum_threads(self, context: Any) -> list[dict[str, Any]]:
        ref = self.require_context(context)
        threads = self._read_collection(
            self._forum_path(ref.card_uid),
            "threads",
            normalize_forum_thread,
        )
        return sorted(threads, key=lambda item: item["updatedAt"], reverse=True)

    def create_forum_thread(self, context: Any, value: Any) -> dict[str, Any]:
        return self.create_forum_threads(context, [value])[0]

    def create_forum_threads(
        self,
        context: Any,
        values: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        ref = self.require_context(context)
        created = [normalize_forum_thread(value) for value in values]
        threads = self.list_forum_threads(ref.to_dict())
        known = {item["threadId"] for item in threads}
        for thread in created:
            if thread["threadId"] in known:
                raise DomainError("conflict", "论坛主题 ID 已存在")
            known.add(thread["threadId"])
        self._write_collection(
            self._forum_path(ref.card_uid),
            "threads",
            [*threads, *created],
        )
        return created

    def update_forum_thread(
        self,
        context: Any,
        thread_id: str,
        value: Any,
    ) -> dict[str, Any]:
        ref = self.require_context(context)
        threads = self.list_forum_threads(ref.to_dict())
        index = self._index_of(threads, "threadId", thread_id, "论坛主题")
        updated = normalize_forum_thread(
            {**dict(value), "threadId": thread_id, "updatedAt": now_iso()},
            existing=threads[index],
        )
        threads[index] = updated
        self._write_collection(self._forum_path(ref.card_uid), "threads", threads)
        return updated

    def delete_forum_thread(self, context: Any, thread_id: str) -> None:
        ref = self.require_context(context)
        threads = self.list_forum_threads(ref.to_dict())
        index = self._index_of(threads, "threadId", thread_id, "论坛主题")
        threads.pop(index)
        self._write_collection(self._forum_path(ref.card_uid), "threads", threads)

    def create_forum_reply(
        self,
        context: Any,
        thread_id: str,
        value: Any,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        ref = self.require_context(context)
        threads = self.list_forum_threads(ref.to_dict())
        index = self._index_of(threads, "threadId", thread_id, "论坛主题")
        reply = normalize_forum_reply(value)
        if any(item["replyId"] == reply["replyId"] for item in threads[index]["replies"]):
            raise DomainError("conflict", "论坛回复 ID 已存在")
        updated = normalize_forum_thread(
            {
                **threads[index],
                "replies": [*threads[index]["replies"], reply],
                "updatedAt": now_iso(),
            }
        )
        threads[index] = updated
        self._write_collection(self._forum_path(ref.card_uid), "threads", threads)
        return updated, reply

    def delete_forum_reply(
        self,
        context: Any,
        thread_id: str,
        reply_id: str,
    ) -> dict[str, Any]:
        ref = self.require_context(context)
        threads = self.list_forum_threads(ref.to_dict())
        index = self._index_of(threads, "threadId", thread_id, "论坛主题")
        replies = threads[index]["replies"]
        reply_index = self._index_of(replies, "replyId", reply_id, "论坛回复")
        replies.pop(reply_index)
        updated = normalize_forum_thread(
            {
                **threads[index],
                "replies": replies,
                "updatedAt": now_iso(),
            }
        )
        threads[index] = updated
        self._write_collection(self._forum_path(ref.card_uid), "threads", threads)
        return updated

    def list_mail_threads(self, context: Any) -> list[dict[str, Any]]:
        ref = self.require_context(context)
        threads = self._read_collection(
            self._mail_path(ref.card_uid),
            "threads",
            normalize_mail_thread,
        )
        return sorted(threads, key=lambda item: item["updatedAt"], reverse=True)

    def get_mail_thread(self, context: Any, thread_id: str) -> dict[str, Any]:
        threads = self.list_mail_threads(context)
        index = self._index_of(threads, "threadId", thread_id, "邮件线程")
        return threads[index]

    def create_mail_thread(self, context: Any, value: Any) -> dict[str, Any]:
        return self.create_mail_threads(context, [value])[0]

    def create_mail_threads(
        self,
        context: Any,
        values: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        ref = self.require_context(context)
        created = [normalize_mail_thread(value) for value in values]
        threads = self.list_mail_threads(ref.to_dict())
        known = {item["threadId"] for item in threads}
        for thread in created:
            if thread["threadId"] in known:
                raise DomainError("conflict", "邮件线程 ID 已存在")
            known.add(thread["threadId"])
        self._write_collection(
            self._mail_path(ref.card_uid),
            "threads",
            [*threads, *created],
        )
        return created

    def update_mail_thread(
        self,
        context: Any,
        thread_id: str,
        value: Any,
    ) -> dict[str, Any]:
        ref = self.require_context(context)
        threads = self.list_mail_threads(ref.to_dict())
        index = self._index_of(threads, "threadId", thread_id, "邮件线程")
        updated = normalize_mail_thread(
            {**dict(value), "threadId": thread_id, "updatedAt": now_iso()},
            existing=threads[index],
        )
        threads[index] = updated
        self._write_collection(self._mail_path(ref.card_uid), "threads", threads)
        return updated

    def mark_mail_thread(
        self,
        context: Any,
        thread_id: str,
        is_read: bool,
    ) -> dict[str, Any]:
        return self.update_mail_thread(context, thread_id, {"isRead": is_read})

    def delete_mail_thread(self, context: Any, thread_id: str) -> None:
        ref = self.require_context(context)
        threads = self.list_mail_threads(ref.to_dict())
        index = self._index_of(threads, "threadId", thread_id, "邮件线程")
        threads.pop(index)
        self._write_collection(self._mail_path(ref.card_uid), "threads", threads)

    def append_mail_messages(
        self,
        context: Any,
        thread_id: str,
        values: list[dict[str, Any]],
        *,
        is_read: bool,
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        ref = self.require_context(context)
        threads = self.list_mail_threads(ref.to_dict())
        index = self._index_of(threads, "threadId", thread_id, "邮件线程")
        created = [normalize_mail_message(value) for value in values]
        known = {item["messageId"] for item in threads[index]["messages"]}
        for message in created:
            if message["messageId"] in known:
                raise DomainError("conflict", "邮件消息 ID 已存在")
            known.add(message["messageId"])
        updated = normalize_mail_thread(
            {
                **threads[index],
                "messages": [*threads[index]["messages"], *created],
                "isRead": is_read,
                "updatedAt": now_iso(),
            }
        )
        threads[index] = updated
        self._write_collection(self._mail_path(ref.card_uid), "threads", threads)
        return updated, created

    def list_phone_sessions(self, context: Any) -> list[dict[str, Any]]:
        ref = self.require_context(context)
        sessions = self._read_collection(
            self._phone_path(ref.card_uid),
            "sessions",
            normalize_phone_session,
        )
        return sorted(sessions, key=lambda item: item["updatedAt"], reverse=True)

    def get_phone_session(self, context: Any, session_id: str) -> dict[str, Any]:
        sessions = self.list_phone_sessions(context)
        return sessions[self._index_of(sessions, "sessionId", session_id, "通话")]

    def commit_phone_session(
        self,
        context: Any,
        *,
        session_id: str,
        contact: dict[str, Any],
        user_line: str,
        generated_lines: list[dict[str, Any]],
        status: str,
    ) -> dict[str, Any]:
        ref = self.require_context(context)
        sessions = self.list_phone_sessions(ref.to_dict())
        index = next(
            (
                item_index
                for item_index, item in enumerate(sessions)
                if item["sessionId"] == session_id
            ),
            None,
        )
        existing = sessions[index] if index is not None else None
        if existing and existing["status"] != "ongoing":
            raise DomainError("conflict", "已结束的通话不能继续")
        if existing and existing["contactId"] != contact["cardUid"]:
            raise DomainError("context_mismatch", "通话联系人已变化")
        added = []
        if user_line:
            added.append(
                normalize_phone_line(
                    {
                        "direction": "sent",
                        "authorId": "user",
                        "authorName": "我",
                        "content": user_line,
                        "mood": "speaking",
                        "source": "manual",
                    }
                )
            )
        added.extend(generated_lines)
        ended = status in {"ended", "missed"}
        session = normalize_phone_session(
            {
                "sessionId": session_id,
                "contactId": contact["cardUid"],
                "contactName": contact["name"],
                "status": status,
                "endedBy": "character" if ended else "",
                "endedAt": now_iso() if ended else "",
                "lines": [*(existing or {}).get("lines", []), *added],
                "source": (existing or {}).get("source", "model"),
                "startedAt": (existing or {}).get("startedAt", now_iso()),
                "updatedAt": now_iso(),
            }
        )
        if index is None:
            sessions.append(session)
        else:
            sessions[index] = session
        self._write_collection(self._phone_path(ref.card_uid), "sessions", sessions)
        return session

    def hangup_phone_session(self, context: Any, session_id: str) -> dict[str, Any]:
        ref = self.require_context(context)
        sessions = self.list_phone_sessions(ref.to_dict())
        index = self._index_of(sessions, "sessionId", session_id, "通话")
        if sessions[index]["status"] != "ongoing":
            return sessions[index]
        updated = normalize_phone_session(
            {
                **sessions[index],
                "status": "ended",
                "endedBy": "user",
                "endedAt": now_iso(),
                "updatedAt": now_iso(),
            }
        )
        sessions[index] = updated
        self._write_collection(self._phone_path(ref.card_uid), "sessions", sessions)
        return updated

    def delete_phone_session(self, context: Any, session_id: str) -> None:
        ref = self.require_context(context)
        sessions = self.list_phone_sessions(ref.to_dict())
        sessions.pop(self._index_of(sessions, "sessionId", session_id, "通话"))
        self._write_collection(self._phone_path(ref.card_uid), "sessions", sessions)

    def list_live_streams(self, context: Any) -> list[dict[str, Any]]:
        ref = self.require_context(context)
        streams = self._read_collection(
            self._live_path(ref.card_uid),
            "streams",
            normalize_live_stream,
        )
        return sorted(streams, key=lambda item: item["updatedAt"], reverse=True)

    def get_live_stream(self, context: Any, stream_id: str) -> dict[str, Any]:
        streams = self.list_live_streams(context)
        return streams[self._index_of(streams, "streamId", stream_id, "直播")]

    def create_live_stream(self, context: Any, value: Any) -> dict[str, Any]:
        ref = self.require_context(context)
        stream = normalize_live_stream(value)
        streams = self.list_live_streams(ref.to_dict())
        if any(item["streamId"] == stream["streamId"] for item in streams):
            raise DomainError("conflict", "直播 ID 已存在")
        self._write_collection(
            self._live_path(ref.card_uid),
            "streams",
            [*streams, stream],
        )
        return stream

    def apply_live_tick(
        self,
        context: Any,
        stream_id: str,
        tick: dict[str, Any],
    ) -> dict[str, Any]:
        ref = self.require_context(context)
        streams = self.list_live_streams(ref.to_dict())
        index = self._index_of(streams, "streamId", stream_id, "直播")
        current = streams[index]
        if current["status"] != "live":
            raise DomainError("conflict", "已结束的直播不能继续")
        status = tick["status"]
        updated = normalize_live_stream(
            {
                **current,
                "segments": [*current["segments"], tick["segment"]],
                "messages": [*current["messages"], *tick["messages"]],
                "status": status,
                "viewerCount": tick["viewerCount"],
                "likeCount": max(current["likeCount"], tick["likeCount"]),
                "fanCount": max(current["fanCount"], tick["fanCount"]),
                "innerThought": tick["innerThought"] or current["innerThought"],
                "updatedAt": now_iso(),
                "endedAt": now_iso() if status == "ended" else "",
            }
        )
        streams[index] = updated
        self._write_collection(self._live_path(ref.card_uid), "streams", streams)
        return updated

    def append_live_message(
        self,
        context: Any,
        stream_id: str,
        value: Any,
    ) -> dict[str, Any]:
        ref = self.require_context(context)
        streams = self.list_live_streams(ref.to_dict())
        index = self._index_of(streams, "streamId", stream_id, "直播")
        current = streams[index]
        if current["status"] != "live":
            raise DomainError("conflict", "已结束的直播不能发送弹幕")
        message = normalize_live_message(value)
        updated = normalize_live_stream(
            {
                **current,
                "messages": [*current["messages"], message],
                "updatedAt": now_iso(),
            }
        )
        streams[index] = updated
        self._write_collection(self._live_path(ref.card_uid), "streams", streams)
        return updated

    def toggle_live_like(self, context: Any, stream_id: str) -> dict[str, Any]:
        ref = self.require_context(context)
        streams = self.list_live_streams(ref.to_dict())
        index = self._index_of(streams, "streamId", stream_id, "直播")
        current = streams[index]
        liked = not current["userLiked"]
        count = max(0, current["likeCount"] + (1 if liked else -1))
        updated = normalize_live_stream(
            {
                **current,
                "userLiked": liked,
                "likeCount": count,
                "updatedAt": now_iso(),
            }
        )
        streams[index] = updated
        self._write_collection(self._live_path(ref.card_uid), "streams", streams)
        return updated

    def end_live_stream(self, context: Any, stream_id: str) -> dict[str, Any]:
        ref = self.require_context(context)
        streams = self.list_live_streams(ref.to_dict())
        index = self._index_of(streams, "streamId", stream_id, "直播")
        updated = normalize_live_stream(
            {
                **streams[index],
                "status": "ended",
                "updatedAt": now_iso(),
                "endedAt": streams[index]["endedAt"] or now_iso(),
            }
        )
        streams[index] = updated
        self._write_collection(self._live_path(ref.card_uid), "streams", streams)
        return updated

    def delete_live_stream(self, context: Any, stream_id: str) -> None:
        ref = self.require_context(context)
        streams = self.list_live_streams(ref.to_dict())
        streams.pop(self._index_of(streams, "streamId", stream_id, "直播"))
        self._write_collection(self._live_path(ref.card_uid), "streams", streams)

    def list_character_drafts(self, context: Any) -> list[dict[str, Any]]:
        ref = self.require_context(context)
        drafts = self._read_collection(
            self._assistant_path(ref.card_uid),
            "drafts",
            normalize_character_draft,
        )
        return sorted(drafts, key=lambda item: item["updatedAt"], reverse=True)

    def create_character_drafts(
        self,
        context: Any,
        values: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        ref = self.require_context(context)
        created = [normalize_character_draft(value) for value in values]
        drafts = self.list_character_drafts(ref.to_dict())
        known = {item["draftId"] for item in drafts}
        for draft in created:
            if draft["draftId"] in known:
                raise DomainError("conflict", "人物草稿 ID 已存在")
            known.add(draft["draftId"])
        self._write_collection(
            self._assistant_path(ref.card_uid),
            "drafts",
            [*drafts, *created],
        )
        return created

    def update_character_draft(
        self,
        context: Any,
        draft_id: str,
        value: Any,
    ) -> dict[str, Any]:
        ref = self.require_context(context)
        drafts = self.list_character_drafts(ref.to_dict())
        index = self._index_of(drafts, "draftId", draft_id, "人物草稿")
        updated = normalize_character_draft(
            {**dict(value), "draftId": draft_id, "updatedAt": now_iso()},
            existing=drafts[index],
        )
        drafts[index] = updated
        self._write_collection(self._assistant_path(ref.card_uid), "drafts", drafts)
        return updated

    def delete_character_draft(self, context: Any, draft_id: str) -> None:
        ref = self.require_context(context)
        drafts = self.list_character_drafts(ref.to_dict())
        drafts.pop(self._index_of(drafts, "draftId", draft_id, "人物草稿"))
        self._write_collection(self._assistant_path(ref.card_uid), "drafts", drafts)

    def list_prompt_profiles(self, context: Any) -> list[dict[str, Any]]:
        ref = self.require_context(context)
        payload = self._read_json(
            self._workbench_path(ref.card_uid),
            {"schemaVersion": 1, "profiles": [], "diagnostics": []},
        )
        rows = payload.get("profiles", []) if isinstance(payload, dict) else []
        saved = {}
        for item in rows if isinstance(rows, list) else []:
            try:
                profile = normalize_prompt_profile(item)
            except DomainError:
                continue
            saved[profile["scope"]] = profile
        return [
            saved.get(
                scope,
                normalize_prompt_profile(
                    {
                        "scope": scope,
                        "enabled": False,
                        "instruction": "",
                        "updatedAt": "1970-01-01T00:00:00Z",
                    }
                ),
            )
            for scope in PROMPT_SCOPES
        ]

    def get_prompt_profile(self, context: Any, scope: str) -> dict[str, Any]:
        profiles = self.list_prompt_profiles(context)
        return profiles[self._index_of(profiles, "scope", scope, "Prompt scope")]

    def update_prompt_profile(self, context: Any, value: Any) -> dict[str, Any]:
        ref = self.require_context(context)
        profile = normalize_prompt_profile(value)
        profile["updatedAt"] = now_iso()
        profiles = self.list_prompt_profiles(ref.to_dict())
        index = self._index_of(profiles, "scope", profile["scope"], "Prompt scope")
        profiles[index] = profile
        diagnostics = self.list_prompt_diagnostics(ref.to_dict())
        self._write_workbench(ref.card_uid, profiles, diagnostics)
        return profile

    def reset_prompt_profile(self, context: Any, scope: str) -> dict[str, Any]:
        return self.update_prompt_profile(
            context,
            {"scope": scope, "enabled": False, "instruction": ""},
        )

    def list_prompt_diagnostics(self, context: Any) -> list[dict[str, Any]]:
        ref = self.require_context(context)
        payload = self._read_json(
            self._workbench_path(ref.card_uid),
            {"schemaVersion": 1, "profiles": [], "diagnostics": []},
        )
        rows = payload.get("diagnostics", []) if isinstance(payload, dict) else []
        result = []
        for item in rows if isinstance(rows, list) else []:
            try:
                result.append(normalize_prompt_diagnostic(item))
            except DomainError:
                continue
        return sorted(result, key=lambda item: item["createdAt"], reverse=True)[:20]

    def create_prompt_diagnostic(self, context: Any, value: Any) -> dict[str, Any]:
        ref = self.require_context(context)
        diagnostic = normalize_prompt_diagnostic(value)
        profiles = self.list_prompt_profiles(ref.to_dict())
        diagnostics = [diagnostic, *self.list_prompt_diagnostics(ref.to_dict())][:20]
        self._write_workbench(ref.card_uid, profiles, diagnostics)
        return diagnostic

    def list_notifications(self, context: Any) -> list[dict[str, Any]]:
        ref = self.require_context(context)
        notifications = self._read_collection(
            self._notifications_path(ref.card_uid),
            "notifications",
            normalize_notification,
        )
        return sorted(notifications, key=lambda item: item["createdAt"], reverse=True)

    def create_notification(self, context: Any, value: Any) -> dict[str, Any]:
        return self.create_notifications(context, [value])[0]

    def create_notifications(
        self,
        context: Any,
        values: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        ref = self.require_context(context)
        created = [normalize_notification(value) for value in values]
        notifications = self.list_notifications(ref.to_dict())
        known = {item["notificationId"] for item in notifications}
        for notification in created:
            if notification["notificationId"] in known:
                raise DomainError("conflict", "通知 ID 已存在")
            known.add(notification["notificationId"])
        self._write_collection(
            self._notifications_path(ref.card_uid),
            "notifications",
            [*notifications, *created],
        )
        return created

    def mark_notification(
        self,
        context: Any,
        notification_id: str,
        is_read: bool,
    ) -> dict[str, Any]:
        ref = self.require_context(context)
        notifications = self.list_notifications(ref.to_dict())
        index = self._index_of(
            notifications,
            "notificationId",
            notification_id,
            "通知",
        )
        updated = normalize_notification(
            {
                **notifications[index],
                "notificationId": notification_id,
                "isRead": is_read,
            }
        )
        notifications[index] = updated
        self._write_collection(
            self._notifications_path(ref.card_uid),
            "notifications",
            notifications,
        )
        return updated

    def mark_all_notifications_read(self, context: Any) -> int:
        ref = self.require_context(context)
        notifications = self.list_notifications(ref.to_dict())
        unread_count = sum(not item["isRead"] for item in notifications)
        if unread_count:
            notifications = [{**item, "isRead": True} for item in notifications]
            self._write_collection(
                self._notifications_path(ref.card_uid),
                "notifications",
                notifications,
            )
        return unread_count

    def clear_notifications(self, context: Any) -> int:
        ref = self.require_context(context)
        notifications = self.list_notifications(ref.to_dict())
        self._write_collection(
            self._notifications_path(ref.card_uid),
            "notifications",
            [],
        )
        return len(notifications)

    def remove_notifications_for_source(
        self,
        context: Any,
        source: str,
        source_id: str,
    ) -> int:
        ref = self.require_context(context)
        notifications = self.list_notifications(ref.to_dict())
        remaining = [
            item
            for item in notifications
            if item["source"] != source or item["sourceId"] != source_id
        ]
        removed = len(notifications) - len(remaining)
        if removed:
            self._write_collection(
                self._notifications_path(ref.card_uid),
                "notifications",
                remaining,
            )
        return removed

    def preview_import(self, context: Any, directory_token: str) -> dict[str, Any]:
        ref = self.require_context(context)
        root = self._legacy_root(directory_token, ref.card_uid)
        groups, messages = self._read_legacy(root)
        return {
            "directoryToken": directory_token,
            "groupCount": len(groups),
            "messageCount": sum(len(items) for items in messages.values()),
            "groups": [
                {
                    "groupId": item["groupId"],
                    "title": item["title"],
                    "messageCount": len(messages.get(item["groupId"], [])),
                }
                for item in groups
            ],
        }

    def apply_import(self, context: Any, directory_token: str, mode: str) -> dict[str, int]:
        ref = self.require_context(context)
        if mode not in {"merge", "replace"}:
            raise DomainError("invalid_params", "导入 mode 只支持 merge 或 replace")
        root = self._legacy_root(directory_token, ref.card_uid)
        imported_groups, imported_messages = self._read_legacy(root)
        if mode == "replace":
            merged_groups = imported_groups
        else:
            by_id = {
                item["groupId"]: self._without_last(item)
                for item in self.list_groups(ref.to_dict())
            }
            by_id.update({item["groupId"]: item for item in imported_groups})
            merged_groups = list(by_id.values())
        self._write_groups(ref.card_uid, merged_groups)
        imported_message_count = 0
        for group in imported_groups:
            group_id = group["groupId"]
            incoming = imported_messages.get(group_id, [])
            imported_message_count += len(incoming)
            if mode == "replace":
                combined = incoming
            else:
                current = self.list_messages(ref.to_dict(), group_id)
                by_id = {item["messageId"]: item for item in current}
                by_id.update({item["messageId"]: item for item in incoming})
                combined = list(by_id.values())
            self._write_messages(ref.card_uid, group_id, combined)
        if mode == "replace":
            retained = {f"{item['groupId']}.json" for item in imported_groups}
            for path in (self._card_root(ref.card_uid) / "messages").glob("*.json"):
                if path.name not in retained:
                    path.unlink()
        return {"groupCount": len(imported_groups), "messageCount": imported_message_count}

    def _read_backup(self, directory_token: str) -> tuple[Any, str]:
        grant = resolve_directory_grant(self.workspace_root, directory_token)
        path = grant.root / "mobile-chat-backup.json"
        if (
            not path.is_file()
            or is_link_or_reparse(path)
            or path.stat().st_size > 64 * 1024 * 1024
        ):
            raise DomainError(
                "backup_invalid",
                "所选目录中没有安全的 mobile-chat-backup.json",
            )
        try:
            payload = path.read_bytes()
            value = json.loads(payload.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise DomainError("backup_invalid", "备份文件无法读取或解析") from exc
        return value, hashlib.sha256(payload).hexdigest()

    @staticmethod
    def _normalize_backup(value: Any, card_uid: str) -> dict[str, Any]:
        source = mapping(value, field="backup")
        allowed = {
            "schemaVersion",
            "kind",
            "sourceCardUid",
            "exportedAt",
            "includes",
            "excludes",
            "data",
        }
        if (
            set(source) - allowed
            or source.get("schemaVersion") != 1
            or source.get("kind") != "fantareal.mobile-chat.backup"
            or source.get("sourceCardUid") != card_uid
        ):
            raise DomainError(
                "backup_invalid",
                "备份格式无效或不属于当前角色",
            )
        data = mapping(source.get("data"), field="backup.data")
        required = {
            "groups",
            "messages",
            "diary",
            "calendar",
            "feed",
            "forum",
            "mail",
            "phone",
            "live",
            "assistant",
            "notifications",
            "promptProfiles",
            "promptDiagnostics",
            "appearance",
        }
        if set(data) != required:
            raise DomainError("backup_invalid", "备份数据字段不完整")

        groups = [normalize_group(item) for item in sequence(data["groups"], field="groups")]
        group_ids = [item["groupId"] for item in groups]
        if len(set(group_ids)) != len(group_ids):
            raise DomainError("backup_invalid", "备份群聊 ID 重复")
        raw_messages = mapping(data["messages"], field="messages")
        if set(raw_messages) - set(group_ids):
            raise DomainError("backup_invalid", "备份包含未知群聊消息")
        messages = {
            group_id: [
                normalize_message(item)
                for item in sequence(raw_messages.get(group_id, []), field="messages")
            ]
            for group_id in group_ids
        }

        def rows(key: str, normalizer: Any) -> list[dict[str, Any]]:
            return [
                normalizer(item)
                for item in sequence(data[key], field=f"backup.data.{key}")
            ]

        normalized_data = {
            "groups": groups,
            "messages": messages,
            "diary": rows("diary", normalize_diary_entry),
            "calendar": rows("calendar", normalize_calendar_event),
            "feed": rows("feed", normalize_feed_post),
            "forum": rows("forum", normalize_forum_thread),
            "mail": rows("mail", normalize_mail_thread),
            "phone": rows("phone", normalize_phone_session),
            "live": rows("live", normalize_live_stream),
            "assistant": rows("assistant", normalize_character_draft),
            "notifications": rows("notifications", normalize_notification),
            "promptProfiles": rows("promptProfiles", normalize_prompt_profile),
            "promptDiagnostics": rows(
                "promptDiagnostics",
                normalize_prompt_diagnostic,
            ),
            "appearance": normalize_appearance(data["appearance"]),
        }
        return {
            "schemaVersion": 1,
            "kind": "fantareal.mobile-chat.backup",
            "sourceCardUid": card_uid,
            "exportedAt": text(source.get("exportedAt"), 80),
            "includes": source.get("includes", []),
            "excludes": source.get("excludes", []),
            "data": normalized_data,
        }

    @staticmethod
    def _backup_summary(backup: dict[str, Any]) -> dict[str, Any]:
        data = backup["data"]
        return {
            "sourceCardUid": backup["sourceCardUid"],
            "exportedAt": backup["exportedAt"],
            "groupCount": len(data["groups"]),
            "messageCount": sum(len(items) for items in data["messages"].values()),
            "lightAppItemCount": sum(
                len(data[key])
                for key in (
                    "diary",
                    "calendar",
                    "feed",
                    "forum",
                    "mail",
                    "phone",
                    "live",
                    "assistant",
                    "notifications",
                )
            ),
            "includes": backup.get("includes", []),
            "excludes": backup.get("excludes", []),
        }

    @staticmethod
    def _empty_card_data() -> dict[str, Any]:
        return {
            "groups": [],
            "messages": {},
            "diary": [],
            "calendar": [],
            "feed": [],
            "forum": [],
            "mail": [],
            "phone": [],
            "live": [],
            "assistant": [],
            "notifications": [],
            "promptProfiles": [],
            "promptDiagnostics": [],
            "appearance": normalize_appearance(None),
        }

    def _replace_card_data(self, card_uid: str, data: dict[str, Any]) -> None:
        root = self._card_root(card_uid)
        nonce = uuid4().hex
        stage = self.cards_root / f".{card_uid}.{nonce}.stage"
        backup = self.cards_root / f".{card_uid}.{nonce}.backup"
        self._remove_owned_tree(stage)
        self._remove_owned_tree(backup)
        (stage / "messages").mkdir(parents=True)
        try:
            self._write_card_data(stage, data)
            os.replace(root, backup)
            try:
                os.replace(stage, root)
            except OSError as exc:
                os.replace(backup, root)
                raise DomainError(
                    "storage_write_failed",
                    "无法原子替换当前角色数据",
                ) from exc
            self._remove_owned_tree(backup)
        except Exception:
            self._remove_owned_tree(stage)
            if backup.exists() and not root.exists():
                os.replace(backup, root)
            raise

    @staticmethod
    def _write_card_data(root: Path, data: dict[str, Any]) -> None:
        atomic_write_json(
            root / "groups.json",
            {"schemaVersion": 1, "groups": data["groups"]},
        )
        for group_id, messages in data["messages"].items():
            atomic_write_json(
                root / "messages" / f"{group_id}.json",
                {"schemaVersion": 1, "messages": messages},
            )
        for filename, key, data_key in (
            ("diary.json", "entries", "diary"),
            ("calendar.json", "events", "calendar"),
            ("feed.json", "posts", "feed"),
            ("forum.json", "threads", "forum"),
            ("mail.json", "threads", "mail"),
            ("phone.json", "sessions", "phone"),
            ("live.json", "streams", "live"),
            ("assistant.json", "drafts", "assistant"),
            ("notifications.json", "notifications", "notifications"),
        ):
            atomic_write_json(
                root / filename,
                {"schemaVersion": 1, key: data[data_key]},
            )
        atomic_write_json(
            root / "prompt-workbench.json",
            {
                "schemaVersion": 1,
                "profiles": data["promptProfiles"],
                "diagnostics": data["promptDiagnostics"],
            },
        )
        atomic_write_json(root / "appearance.json", data["appearance"])

    def _remove_owned_tree(self, path: Path) -> None:
        resolved_parent = path.parent.resolve()
        if resolved_parent != self.cards_root or not path.name.startswith("."):
            raise DomainError("storage_unsafe", "临时数据路径越界")
        if os.path.lexists(path):
            shutil.rmtree(path)

    def _legacy_root(self, directory_token: str, card_uid: str) -> Path:
        selected = resolve_directory_grant(self.workspace_root, directory_token).root
        candidates = [
            selected / "cards" / card_uid,
            selected / card_uid,
            selected,
        ]
        root = next((item for item in candidates if (item / "groups.json").is_file()), None)
        if root is None:
            raise DomainError("import_invalid", "所选目录中未找到当前角色的 groups.json")
        return root

    def _read_legacy(
        self,
        root: Path,
    ) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
        payload = self._read_json(root / "groups.json", [])
        rows = payload.get("groups", []) if isinstance(payload, dict) else payload
        groups = []
        for item in rows if isinstance(rows, list) else []:
            try:
                groups.append(normalize_group(item))
            except DomainError:
                continue
        messages: dict[str, list[dict[str, Any]]] = {}
        for group in groups:
            message_payload = self._read_json(root / "messages" / f"{group['groupId']}.json", [])
            message_rows = (
                message_payload.get("messages", [])
                if isinstance(message_payload, dict)
                else message_payload
            )
            normalized = []
            for item in message_rows if isinstance(message_rows, list) else []:
                try:
                    converted = normalize_message(
                        {**item, "source": item.get("source") or "import"}
                    )
                except DomainError:
                    continue
                normalized.append(converted)
            messages[group["groupId"]] = normalized
        if not groups:
            raise DomainError("import_invalid", "所选目录没有可导入的群聊")
        return groups, messages

    def _ensure_card_layout(self, card_uid: str) -> None:
        root = self._card_root(card_uid)
        (root / "messages").mkdir(parents=True, exist_ok=True)
        groups = self._groups_path(card_uid)
        if not groups.exists():
            self._write_json(groups, {"schemaVersion": 1, "groups": []})
        for path, key in (
            (self._diary_path(card_uid), "entries"),
            (self._calendar_path(card_uid), "events"),
            (self._feed_path(card_uid), "posts"),
            (self._forum_path(card_uid), "threads"),
            (self._mail_path(card_uid), "threads"),
            (self._phone_path(card_uid), "sessions"),
            (self._live_path(card_uid), "streams"),
            (self._assistant_path(card_uid), "drafts"),
            (self._notifications_path(card_uid), "notifications"),
        ):
            if not path.exists():
                self._write_collection(path, key, [])
        workbench = self._workbench_path(card_uid)
        if not workbench.exists():
            self._write_workbench(card_uid, [], [])
        appearance = self._appearance_path(card_uid)
        if not appearance.exists():
            self._write_json(appearance, normalize_appearance(None))

    def _card_root(self, card_uid: str) -> Path:
        root = (self.cards_root / card_uid).resolve()
        try:
            root.relative_to(self.cards_root)
        except ValueError as exc:
            raise DomainError("invalid_card_uid", "cardUid 路径越界") from exc
        return root

    def _groups_path(self, card_uid: str) -> Path:
        return self._card_root(card_uid) / "groups.json"

    def _messages_path(self, card_uid: str, group_id: str) -> Path:
        self._validate_group_id(group_id)
        return self._card_root(card_uid) / "messages" / f"{group_id}.json"

    def _diary_path(self, card_uid: str) -> Path:
        return self._card_root(card_uid) / "diary.json"

    def _calendar_path(self, card_uid: str) -> Path:
        return self._card_root(card_uid) / "calendar.json"

    def _feed_path(self, card_uid: str) -> Path:
        return self._card_root(card_uid) / "feed.json"

    def _forum_path(self, card_uid: str) -> Path:
        return self._card_root(card_uid) / "forum.json"

    def _mail_path(self, card_uid: str) -> Path:
        return self._card_root(card_uid) / "mail.json"

    def _phone_path(self, card_uid: str) -> Path:
        return self._card_root(card_uid) / "phone.json"

    def _live_path(self, card_uid: str) -> Path:
        return self._card_root(card_uid) / "live.json"

    def _assistant_path(self, card_uid: str) -> Path:
        return self._card_root(card_uid) / "assistant.json"

    def _workbench_path(self, card_uid: str) -> Path:
        return self._card_root(card_uid) / "prompt-workbench.json"

    def _notifications_path(self, card_uid: str) -> Path:
        return self._card_root(card_uid) / "notifications.json"

    def _appearance_path(self, card_uid: str) -> Path:
        return self._card_root(card_uid) / "appearance.json"

    @staticmethod
    def _validate_group_id(group_id: str) -> None:
        if not re.fullmatch(r"group_[a-z0-9][a-z0-9_-]{5,79}", group_id):
            raise DomainError("invalid_group", "groupId 格式无效")

    @staticmethod
    def _read_json(path: Path, default: Any) -> Any:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return default
        except (OSError, json.JSONDecodeError) as exc:
            raise DomainError("storage_corrupt", f"无法读取 {path.name}") from exc

    _write_json = staticmethod(atomic_write_json)

    def _write_groups(self, card_uid: str, groups: list[dict[str, Any]]) -> None:
        self._write_json(self._groups_path(card_uid), {"schemaVersion": 1, "groups": groups})

    def _write_messages(
        self,
        card_uid: str,
        group_id: str,
        messages: list[dict[str, Any]],
    ) -> None:
        self._write_json(
            self._messages_path(card_uid, group_id),
            {"schemaVersion": 1, "messages": messages},
        )

    def _read_collection(self, path: Path, key: str, normalizer: Any) -> list[dict[str, Any]]:
        payload = self._read_json(path, {"schemaVersion": 1, key: []})
        rows = payload.get(key, []) if isinstance(payload, dict) else []
        result = []
        for item in rows if isinstance(rows, list) else []:
            try:
                result.append(normalizer(item))
            except DomainError:
                continue
        return result

    def _write_collection(self, path: Path, key: str, items: list[dict[str, Any]]) -> None:
        self._write_json(path, {"schemaVersion": 1, key: items})

    def _write_workbench(
        self,
        card_uid: str,
        profiles: list[dict[str, Any]],
        diagnostics: list[dict[str, Any]],
    ) -> None:
        self._write_json(
            self._workbench_path(card_uid),
            {
                "schemaVersion": 1,
                "profiles": profiles,
                "diagnostics": diagnostics,
            },
        )

    @staticmethod
    def _index_of(
        items: list[dict[str, Any]],
        key: str,
        value: str,
        label: str,
    ) -> int:
        index = next((index for index, item in enumerate(items) if item[key] == value), None)
        if index is None:
            raise DomainError("not_found", f"{label}不存在")
        return index

    @staticmethod
    def _without_last(group: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in group.items() if key != "lastMessage"}
