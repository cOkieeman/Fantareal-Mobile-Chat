from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, TextIO

from .domain import (
    ContextRef,
    DomainError,
    build_llm_request,
    mapping,
    new_id,
    parse_llm_messages,
    system_error_message,
    text,
    user_message,
)
from .interactive_apps import (
    build_live_request,
    build_phone_request,
    parse_live_stream,
    parse_live_tick,
    parse_phone_response,
)
from .light_apps import (
    build_light_app_request,
    parse_generated_calendar,
    parse_generated_diary,
)
from .mail_apps import (
    build_mail_request,
    parse_generated_mail_messages,
    parse_generated_mail_threads,
)
from .social_apps import (
    build_social_app_request,
    parse_generated_feed,
    parse_generated_forum,
)
from .store import MobileStore
from .workbench import (
    apply_custom_instruction,
    build_assistant_request,
    build_workbench_request,
    parse_character_drafts,
    parse_workbench_result,
    prompt_preview,
)


@dataclass(slots=True)
class PendingChat:
    operation_id: str
    context: ContextRef
    group_id: str
    mode: str
    user_entry: dict[str, str] | None


@dataclass(slots=True)
class PendingLightApp:
    operation_id: str
    context: ContextRef
    purpose: str
    payload: dict[str, Any] = field(default_factory=dict)


class MobileChatService:
    def __init__(self) -> None:
        self.store: MobileStore | None = None
        self.locale = "zh-CN"
        self.pending: dict[str, PendingChat | PendingLightApp] = {}

    def dispatch(self, method: str, params: dict[str, Any]) -> Any:
        if method == "extension.initialize":
            return self.initialize(params)
        if method == "extension.health":
            return {
                "ok": self.store is not None,
                "service": "fantareal-mobile-chat",
                "version": "0.6.0.dev1",
            }
        if method == "extension.shutdown":
            self.pending.clear()
            return {"ok": True}
        store = self._store()

        if method == "mobile.context.bind":
            result = store.bind_context(
                params.get("context"),
                params.get("characters", []),
                params.get("activeCharacter"),
            )
            self.pending.clear()
            return {**result, "groups": store.list_groups(result["context"])}
        context = params.get("context")
        if method == "mobile.groups.list":
            return {"groups": store.list_groups(context)}
        if method == "mobile.groups.create":
            return {"group": store.create_group(context, params.get("group"))}
        if method == "mobile.groups.update":
            return {
                "group": store.update_group(
                    context,
                    text(params.get("groupId"), 86, required=True, field="groupId"),
                    mapping(params.get("group"), field="group"),
                )
            }
        if method == "mobile.groups.delete":
            store.delete_group(
                context,
                text(params.get("groupId"), 86, required=True, field="groupId"),
            )
            return {"ok": True}
        if method == "mobile.messages.list":
            return {
                "messages": store.list_messages(
                    context,
                    text(params.get("groupId"), 86, required=True, field="groupId"),
                )
            }
        if method == "mobile.messages.clear":
            store.clear_messages(
                context,
                text(params.get("groupId"), 86, required=True, field="groupId"),
            )
            return {"ok": True}
        if method == "mobile.diary.list":
            return {"entries": store.list_diary_entries(context)}
        if method == "mobile.diary.create":
            entry = store.create_diary_entry(
                context,
                mapping(params.get("entry"), field="entry"),
            )
            notification = store.create_notification(
                context,
                {
                    "title": "新日记",
                    "content": entry["title"],
                    "source": "diary",
                    "sourceId": entry["entryId"],
                },
            )
            return {"entry": entry, "notification": notification}
        if method == "mobile.diary.update":
            return {
                "entry": store.update_diary_entry(
                    context,
                    text(params.get("entryId"), 160, required=True, field="entryId"),
                    mapping(params.get("entry"), field="entry"),
                )
            }
        if method == "mobile.diary.delete":
            entry_id = text(params.get("entryId"), 160, required=True, field="entryId")
            store.delete_diary_entry(context, entry_id)
            store.remove_notifications_for_source(context, "diary", entry_id)
            return {"ok": True}
        if method == "mobile.diary.generate.prepare":
            return self.prepare_light_app("diary", params)
        if method == "mobile.diary.generate.commit":
            return self.commit_light_app("diary", params)
        if method == "mobile.diary.generate.abort":
            return self.abort_light_app("diary", params)
        if method == "mobile.calendar.list":
            return {"events": store.list_calendar_events(context)}
        if method == "mobile.calendar.create":
            event = store.create_calendar_event(
                context,
                mapping(params.get("event"), field="event"),
            )
            notification = store.create_notification(
                context,
                {
                    "title": "新日程",
                    "content": f"{event['startsOn']} · {event['title']}",
                    "source": "calendar",
                    "sourceId": event["eventId"],
                },
            )
            return {"event": event, "notification": notification}
        if method == "mobile.calendar.update":
            return {
                "event": store.update_calendar_event(
                    context,
                    text(params.get("eventId"), 160, required=True, field="eventId"),
                    mapping(params.get("event"), field="event"),
                )
            }
        if method == "mobile.calendar.delete":
            event_id = text(params.get("eventId"), 160, required=True, field="eventId")
            store.delete_calendar_event(context, event_id)
            store.remove_notifications_for_source(context, "calendar", event_id)
            return {"ok": True}
        if method == "mobile.calendar.generate.prepare":
            return self.prepare_light_app("calendar", params)
        if method == "mobile.calendar.generate.commit":
            return self.commit_light_app("calendar", params)
        if method == "mobile.calendar.generate.abort":
            return self.abort_light_app("calendar", params)
        if method == "mobile.feed.list":
            return {"posts": store.list_feed_posts(context)}
        if method == "mobile.feed.create":
            post = store.create_feed_post(
                context,
                mapping(params.get("post"), field="post"),
            )
            notification = store.create_notification(
                context,
                {
                    "title": "新动态",
                    "content": post["content"][:120],
                    "source": "feed",
                    "sourceId": post["postId"],
                },
            )
            return {"post": post, "notification": notification}
        if method == "mobile.feed.update":
            return {
                "post": store.update_feed_post(
                    context,
                    text(params.get("postId"), 160, required=True, field="postId"),
                    mapping(params.get("post"), field="post"),
                )
            }
        if method == "mobile.feed.delete":
            post_id = text(params.get("postId"), 160, required=True, field="postId")
            store.delete_feed_post(context, post_id)
            store.remove_notifications_for_source(context, "feed", post_id)
            return {"ok": True}
        if method == "mobile.feed.like.toggle":
            return {
                "post": store.toggle_feed_like(
                    context,
                    text(params.get("postId"), 160, required=True, field="postId"),
                )
            }
        if method == "mobile.feed.generate.prepare":
            return self.prepare_light_app("feed", params)
        if method == "mobile.feed.generate.commit":
            return self.commit_light_app("feed", params)
        if method == "mobile.feed.generate.abort":
            return self.abort_light_app("feed", params)
        if method == "mobile.forum.list":
            return {"threads": store.list_forum_threads(context)}
        if method == "mobile.forum.create":
            thread = store.create_forum_thread(
                context,
                mapping(params.get("thread"), field="thread"),
            )
            notification = store.create_notification(
                context,
                {
                    "title": "新论坛主题",
                    "content": thread["title"],
                    "source": "forum",
                    "sourceId": thread["threadId"],
                },
            )
            return {"thread": thread, "notification": notification}
        if method == "mobile.forum.update":
            return {
                "thread": store.update_forum_thread(
                    context,
                    text(params.get("threadId"), 160, required=True, field="threadId"),
                    mapping(params.get("thread"), field="thread"),
                )
            }
        if method == "mobile.forum.delete":
            thread_id = text(
                params.get("threadId"),
                160,
                required=True,
                field="threadId",
            )
            store.delete_forum_thread(context, thread_id)
            store.remove_notifications_for_source(context, "forum", thread_id)
            return {"ok": True}
        if method == "mobile.forum.reply.create":
            thread, reply = store.create_forum_reply(
                context,
                text(params.get("threadId"), 160, required=True, field="threadId"),
                mapping(params.get("reply"), field="reply"),
            )
            return {"thread": thread, "reply": reply}
        if method == "mobile.forum.reply.delete":
            thread = store.delete_forum_reply(
                context,
                text(params.get("threadId"), 160, required=True, field="threadId"),
                text(params.get("replyId"), 160, required=True, field="replyId"),
            )
            return {"thread": thread}
        if method == "mobile.forum.generate.prepare":
            return self.prepare_light_app("forum", params)
        if method == "mobile.forum.generate.commit":
            return self.commit_light_app("forum", params)
        if method == "mobile.forum.generate.abort":
            return self.abort_light_app("forum", params)
        if method == "mobile.mail.list":
            return {"threads": store.list_mail_threads(context)}
        if method == "mobile.mail.create":
            thread = store.create_mail_thread(
                context,
                mapping(params.get("thread"), field="thread"),
            )
            notification = store.create_notification(
                context,
                {
                    "title": "新邮件",
                    "content": thread["subject"],
                    "source": "mail",
                    "sourceId": thread["threadId"],
                },
            )
            return {"thread": thread, "notification": notification}
        if method == "mobile.mail.update":
            return {
                "thread": store.update_mail_thread(
                    context,
                    text(params.get("threadId"), 160, required=True, field="threadId"),
                    mapping(params.get("thread"), field="thread"),
                )
            }
        if method == "mobile.mail.mark":
            is_read = params.get("isRead")
            if not isinstance(is_read, bool):
                raise DomainError("invalid_params", "isRead 必须是 boolean")
            return {
                "thread": store.mark_mail_thread(
                    context,
                    text(params.get("threadId"), 160, required=True, field="threadId"),
                    is_read,
                )
            }
        if method == "mobile.mail.delete":
            thread_id = text(
                params.get("threadId"),
                160,
                required=True,
                field="threadId",
            )
            store.delete_mail_thread(context, thread_id)
            store.remove_notifications_for_source(context, "mail", thread_id)
            return {"ok": True}
        if method == "mobile.mail.message.create":
            thread, messages = store.append_mail_messages(
                context,
                text(params.get("threadId"), 160, required=True, field="threadId"),
                [mapping(params.get("message"), field="message")],
                is_read=bool(params.get("isRead", True)),
            )
            return {"thread": thread, "message": messages[0]}
        if method == "mobile.mail.generate.prepare":
            return self.prepare_mail("mail", params)
        if method == "mobile.mail.generate.commit":
            return self.commit_mail("mail", params)
        if method == "mobile.mail.generate.abort":
            return self.abort_light_app("mail", params)
        if method == "mobile.mail.compose.generate.prepare":
            return self.prepare_mail("mail-compose", params)
        if method == "mobile.mail.compose.generate.commit":
            return self.commit_mail("mail-compose", params)
        if method == "mobile.mail.compose.generate.abort":
            return self.abort_light_app("mail-compose", params)
        if method == "mobile.mail.reply.generate.prepare":
            return self.prepare_mail("mail-reply", params)
        if method == "mobile.mail.reply.generate.commit":
            return self.commit_mail("mail-reply", params)
        if method == "mobile.mail.reply.generate.abort":
            return self.abort_light_app("mail-reply", params)
        if method == "mobile.phone.list":
            return {"sessions": store.list_phone_sessions(context)}
        if method == "mobile.phone.hangup":
            return {
                "session": store.hangup_phone_session(
                    context,
                    text(
                        params.get("sessionId"),
                        160,
                        required=True,
                        field="sessionId",
                    ),
                )
            }
        if method == "mobile.phone.delete":
            store.delete_phone_session(
                context,
                text(
                    params.get("sessionId"),
                    160,
                    required=True,
                    field="sessionId",
                ),
            )
            return {"ok": True}
        if method == "mobile.phone.call.generate.prepare":
            return self.prepare_phone(params)
        if method == "mobile.phone.call.generate.commit":
            return self.commit_phone(params)
        if method == "mobile.phone.call.generate.abort":
            return self.abort_light_app("phone", params)
        if method == "mobile.live.list":
            return {"streams": store.list_live_streams(context)}
        if method == "mobile.live.message.create":
            stream = store.append_live_message(
                context,
                text(
                    params.get("streamId"),
                    160,
                    required=True,
                    field="streamId",
                ),
                {
                    "authorId": "user",
                    "authorName": "我",
                    "authorType": "user",
                    "content": text(
                        params.get("content"),
                        240,
                        required=True,
                        field="content",
                    ),
                    "mood": text(params.get("mood"), 40),
                    "highlight": False,
                    "source": "manual",
                },
            )
            return {"stream": stream}
        if method == "mobile.live.like.toggle":
            return {
                "stream": store.toggle_live_like(
                    context,
                    text(
                        params.get("streamId"),
                        160,
                        required=True,
                        field="streamId",
                    ),
                )
            }
        if method == "mobile.live.end":
            return {
                "stream": store.end_live_stream(
                    context,
                    text(
                        params.get("streamId"),
                        160,
                        required=True,
                        field="streamId",
                    ),
                )
            }
        if method == "mobile.live.delete":
            stream_id = text(
                params.get("streamId"),
                160,
                required=True,
                field="streamId",
            )
            store.delete_live_stream(context, stream_id)
            store.remove_notifications_for_source(context, "live", stream_id)
            return {"ok": True}
        if method == "mobile.live.generate.prepare":
            return self.prepare_live("live", params)
        if method == "mobile.live.generate.commit":
            return self.commit_live("live", params)
        if method == "mobile.live.generate.abort":
            return self.abort_light_app("live", params)
        if method == "mobile.live.tick.generate.prepare":
            return self.prepare_live("live-tick", params)
        if method == "mobile.live.tick.generate.commit":
            return self.commit_live("live-tick", params)
        if method == "mobile.live.tick.generate.abort":
            return self.abort_light_app("live-tick", params)
        if method == "mobile.assistant.list":
            return {"drafts": store.list_character_drafts(context)}
        if method == "mobile.assistant.update":
            return {
                "draft": store.update_character_draft(
                    context,
                    text(
                        params.get("draftId"),
                        160,
                        required=True,
                        field="draftId",
                    ),
                    mapping(params.get("draft"), field="draft"),
                )
            }
        if method == "mobile.assistant.delete":
            store.delete_character_draft(
                context,
                text(
                    params.get("draftId"),
                    160,
                    required=True,
                    field="draftId",
                ),
            )
            return {"ok": True}
        if method == "mobile.assistant.generate.prepare":
            return self.prepare_assistant(params)
        if method == "mobile.assistant.generate.commit":
            return self.commit_assistant(params)
        if method == "mobile.assistant.generate.abort":
            return self.abort_light_app("assistant", params)
        if method == "mobile.workbench.get":
            return {
                "profiles": store.list_prompt_profiles(context),
                "diagnostics": store.list_prompt_diagnostics(context),
            }
        if method == "mobile.workbench.update":
            return {
                "profile": store.update_prompt_profile(
                    context,
                    mapping(params.get("profile"), field="profile"),
                )
            }
        if method == "mobile.workbench.reset":
            return {
                "profile": store.reset_prompt_profile(
                    context,
                    text(
                        params.get("scope"),
                        40,
                        required=True,
                        field="scope",
                    ),
                )
            }
        if method == "mobile.workbench.preview":
            profile = store.get_prompt_profile(
                context,
                text(
                    params.get("scope"),
                    40,
                    required=True,
                    field="scope",
                ),
            )
            return {"preview": prompt_preview(profile)}
        if method == "mobile.workbench.generate.prepare":
            return self.prepare_workbench(params)
        if method == "mobile.workbench.generate.commit":
            return self.commit_workbench(params)
        if method == "mobile.workbench.generate.abort":
            return self.abort_workbench(params)
        if method == "mobile.notifications.list":
            return {"notifications": store.list_notifications(context)}
        if method == "mobile.notifications.mark":
            is_read = params.get("isRead")
            if not isinstance(is_read, bool):
                raise DomainError("invalid_params", "isRead 必须是 boolean")
            return {
                "notification": store.mark_notification(
                    context,
                    text(
                        params.get("notificationId"),
                        160,
                        required=True,
                        field="notificationId",
                    ),
                    is_read,
                )
            }
        if method == "mobile.notifications.readAll":
            return {"updatedCount": store.mark_all_notifications_read(context)}
        if method == "mobile.notifications.clear":
            return {"deletedCount": store.clear_notifications(context)}
        if method == "mobile.chat.prepare":
            return self.prepare_chat(params)
        if method == "mobile.chat.commit":
            return self.commit_chat(params)
        if method == "mobile.chat.abort":
            return self.abort_chat(params)
        if method == "mobile.import.preview":
            return store.preview_import(
                context,
                text(
                    params.get("directoryToken"),
                    80,
                    required=True,
                    field="directoryToken",
                ),
            )
        if method == "mobile.import.apply":
            return store.apply_import(
                context,
                text(
                    params.get("directoryToken"),
                    80,
                    required=True,
                    field="directoryToken",
                ),
                text(params.get("mode"), 20) or "merge",
            )
        raise DomainError("method_not_found", f"不支持的 service method：{method[:120]}")

    def initialize(self, params: dict[str, Any]) -> dict[str, Any]:
        storage = mapping(params.get("storage"), field="storage")
        paths = mapping(storage.get("paths"), field="storage.paths")
        data_path = Path(text(paths.get("data"), 1024, required=True, field="storage.paths.data"))
        workspace = Path(
            text(params.get("workspace"), 1024, required=True, field="workspace")
        )
        permissions = params.get("permissions", [])
        if "storage.data" not in permissions:
            raise DomainError("permission_denied", "service 需要 storage.data 权限")
        if not data_path.is_dir() or not workspace.is_dir():
            raise DomainError("storage_unavailable", "Host storage 或 workspace 不可用")
        self.locale = text(params.get("locale"), 32) or "zh-CN"
        self.store = MobileStore(data_path, workspace)
        self.pending.clear()
        return {"ok": True, "locale": self.locale}

    def prepare_chat(self, params: dict[str, Any]) -> dict[str, Any]:
        store = self._store()
        context = store.require_context(params.get("context"))
        group_id = text(params.get("groupId"), 86, required=True, field="groupId")
        mode = text(params.get("mode"), 20) or "user_message"
        if any(
            isinstance(item, PendingChat)
            and item.group_id == group_id
            and item.context == context
            for item in self.pending.values()
        ):
            raise DomainError("generation_busy", "该群聊已有生成请求")
        group = store.get_group(context.to_dict(), group_id)
        history = store.list_messages(context.to_dict(), group_id)
        content = text(params.get("content"), 500)
        entry = user_message(group, content) if mode == "user_message" else None
        request = build_llm_request(
            group,
            history,
            store.active_character,
            content=content,
            mode=mode,
        )
        operation_id = new_id("op")
        self.pending[operation_id] = PendingChat(
            operation_id,
            context,
            group_id,
            mode,
            entry,
        )
        while len(self.pending) > 16:
            self.pending.pop(next(iter(self.pending)))
        return {
            "operationId": operation_id,
            "request": request,
            "optimisticMessages": [entry] if entry else [],
        }

    def prepare_light_app(self, purpose: str, params: dict[str, Any]) -> dict[str, Any]:
        store = self._store()
        context = store.require_context(params.get("context"))
        list_existing = {
            "diary": store.list_diary_entries,
            "calendar": store.list_calendar_events,
            "feed": store.list_feed_posts,
            "forum": store.list_forum_threads,
        }.get(purpose)
        if list_existing is None:
            raise DomainError("invalid_generation_purpose", "不支持的轻应用生成 purpose")
        existing = list_existing(context.to_dict())
        build_request = (
            build_light_app_request
            if purpose in {"diary", "calendar"}
            else build_social_app_request
        )
        request = self._with_prompt_profile(
            context,
            purpose,
            build_request(
                purpose,
                store.active_character,
                existing,
            ),
        )
        operation_id = self._start_light_operation(purpose, context)
        return {
            "operationId": operation_id,
            "request": request,
        }

    def commit_light_app(self, purpose: str, params: dict[str, Any]) -> dict[str, Any]:
        store = self._store()
        context = store.require_context(params.get("context"))
        operation = self._light_operation(params, context, purpose)
        raw = text(params.get("content"), 65_536, required=True, field="content")
        if purpose == "diary":
            entries = parse_generated_diary(raw, store.active_character)
            created = store.create_diary_entries(context.to_dict(), entries)
            notifications = store.create_notifications(
                context.to_dict(),
                [
                    {
                        "title": "角色新日记",
                        "content": entry["title"],
                        "source": "diary",
                        "sourceId": entry["entryId"],
                    }
                    for entry in created
                ],
            )
            result = {"entries": created, "notifications": notifications}
        elif purpose == "calendar":
            events = parse_generated_calendar(raw, store.active_character)
            created = store.create_calendar_events(context.to_dict(), events)
            notifications = store.create_notifications(
                context.to_dict(),
                [
                    {
                        "title": "角色新日程",
                        "content": f"{event['startsOn']} · {event['title']}",
                        "source": "calendar",
                        "sourceId": event["eventId"],
                    }
                    for event in created
                ],
            )
            result = {"events": created, "notifications": notifications}
        elif purpose == "feed":
            posts = parse_generated_feed(raw, store.active_character)
            created = store.create_feed_posts(context.to_dict(), posts)
            notifications = store.create_notifications(
                context.to_dict(),
                [
                    {
                        "title": "角色新动态",
                        "content": post["content"][:120],
                        "source": "feed",
                        "sourceId": post["postId"],
                    }
                    for post in created
                ],
            )
            result = {"posts": created, "notifications": notifications}
        elif purpose == "forum":
            threads = parse_generated_forum(raw, store.active_character)
            created = store.create_forum_threads(context.to_dict(), threads)
            notifications = store.create_notifications(
                context.to_dict(),
                [
                    {
                        "title": "角色新论坛主题",
                        "content": thread["title"],
                        "source": "forum",
                        "sourceId": thread["threadId"],
                    }
                    for thread in created
                ],
            )
            result = {"threads": created, "notifications": notifications}
        else:
            raise DomainError("invalid_generation_purpose", "不支持的轻应用生成 purpose")
        self.pending.pop(operation.operation_id, None)
        return result

    def prepare_mail(self, purpose: str, params: dict[str, Any]) -> dict[str, Any]:
        store = self._store()
        context = store.require_context(params.get("context"))
        existing = store.list_mail_threads(context.to_dict())
        payload: dict[str, Any] = {}
        thread = None
        counterparty = store.active_character

        if purpose == "mail-compose":
            recipient_id = text(
                params.get("recipientId"),
                160,
                required=True,
                field="recipientId",
            )
            counterparty = self._mail_counterparty(recipient_id)
            payload = {
                "recipientId": counterparty["cardUid"],
                "recipientName": counterparty["name"],
                "subject": text(params.get("subject"), 120)
                or f"写给{counterparty['name']}的邮件",
                "content": text(
                    params.get("content"),
                    2_000,
                    required=True,
                    field="content",
                ),
            }
        elif purpose == "mail-reply":
            thread_id = text(
                params.get("threadId"),
                160,
                required=True,
                field="threadId",
            )
            thread = store.get_mail_thread(context.to_dict(), thread_id)
            counterparty = self._mail_counterparty(
                thread["counterpartyId"],
                fallback_name=thread["counterpartyName"],
            )
            payload = {
                "threadId": thread_id,
                "content": text(
                    params.get("content"),
                    2_000,
                    required=True,
                    field="content",
                ),
                "counterpartyId": counterparty["cardUid"],
                "counterpartyName": counterparty["name"],
            }
        elif purpose != "mail":
            raise DomainError("invalid_generation_purpose", "不支持的邮箱生成 purpose")

        request = self._with_prompt_profile(
            context,
            "mail",
            build_mail_request(
                purpose,
                counterparty,
                existing,
                draft=payload,
                thread=thread,
            ),
        )
        operation_id = self._start_light_operation(purpose, context, payload)
        return {
            "operationId": operation_id,
            "request": request,
        }

    def commit_mail(self, purpose: str, params: dict[str, Any]) -> dict[str, Any]:
        store = self._store()
        context = store.require_context(params.get("context"))
        operation = self._light_operation(params, context, purpose)
        raw = text(params.get("content"), 65_536, required=True, field="content")
        if purpose == "mail":
            threads = parse_generated_mail_threads(raw, store.active_character)
            created = store.create_mail_threads(context.to_dict(), threads)
        elif purpose == "mail-compose":
            counterparty = self._mail_counterparty(operation.payload["recipientId"])
            received = parse_generated_mail_messages(raw, counterparty)
            created = store.create_mail_threads(
                context.to_dict(),
                [
                    {
                        "subject": operation.payload["subject"],
                        "counterpartyId": counterparty["cardUid"],
                        "counterpartyName": counterparty["name"],
                        "messages": [
                            {
                                "direction": "sent",
                                "authorId": "user",
                                "authorName": "我",
                                "content": operation.payload["content"],
                                "mood": "sent",
                                "source": "manual",
                            },
                            *received,
                        ],
                        "isRead": False,
                        "source": "manual",
                    }
                ],
            )
        elif purpose == "mail-reply":
            counterparty = self._mail_counterparty(
                operation.payload["counterpartyId"],
                fallback_name=operation.payload["counterpartyName"],
            )
            received = parse_generated_mail_messages(raw, counterparty)
            thread, _messages = store.append_mail_messages(
                context.to_dict(),
                operation.payload["threadId"],
                [
                    {
                        "direction": "sent",
                        "authorId": "user",
                        "authorName": "我",
                        "content": operation.payload["content"],
                        "mood": "sent",
                        "source": "manual",
                    },
                    *received,
                ],
                is_read=False,
            )
            created = [thread]
        else:
            raise DomainError("invalid_generation_purpose", "不支持的邮箱生成 purpose")
        notifications = store.create_notifications(
            context.to_dict(),
            [
                {
                    "title": "角色新邮件",
                    "content": thread["subject"],
                    "source": "mail",
                    "sourceId": thread["threadId"],
                }
                for thread in created
            ],
        )
        self.pending.pop(operation.operation_id, None)
        return {"threads": created, "notifications": notifications}

    def prepare_phone(self, params: dict[str, Any]) -> dict[str, Any]:
        store = self._store()
        context = store.require_context(params.get("context"))
        session_id = text(params.get("sessionId"), 160)
        session = (
            store.get_phone_session(context.to_dict(), session_id)
            if session_id
            else None
        )
        if session is not None and session["status"] != "ongoing":
            raise DomainError("conflict", "已结束的通话不能继续")
        contact_id = text(params.get("contactId"), 160) or (
            session["contactId"] if session else ""
        )
        contact = self._character(
            contact_id,
            field="contactId",
            label="电话联系人",
        )
        if session is not None and session["contactId"] != contact["cardUid"]:
            raise DomainError("context_mismatch", "通话联系人已变化")
        user_line = text(
            params.get("content"),
            500,
            required=True,
            field="content",
        )
        session_id = session_id or new_id("call")
        request = self._with_prompt_profile(
            context,
            "phone",
            build_phone_request(contact, session, user_line),
        )
        operation_id = self._start_light_operation(
            "phone",
            context,
            {
                "sessionId": session_id,
                "contactId": contact["cardUid"],
                "userLine": user_line,
                "existingSession": session is not None,
            },
        )
        return {"operationId": operation_id, "request": request, "sessionId": session_id}

    def commit_phone(self, params: dict[str, Any]) -> dict[str, Any]:
        store = self._store()
        context = store.require_context(params.get("context"))
        operation = self._light_operation(params, context, "phone")
        if operation.payload["existingSession"]:
            store.get_phone_session(
                context.to_dict(),
                operation.payload["sessionId"],
            )
        contact = self._character(
            operation.payload["contactId"],
            field="contactId",
            label="电话联系人",
        )
        lines, status = parse_phone_response(
            text(params.get("content"), 65_536, required=True, field="content"),
            contact,
        )
        session = store.commit_phone_session(
            context.to_dict(),
            session_id=operation.payload["sessionId"],
            contact=contact,
            user_line=operation.payload["userLine"],
            generated_lines=lines,
            status=status,
        )
        self.pending.pop(operation.operation_id, None)
        return {"session": session}

    def prepare_live(self, purpose: str, params: dict[str, Any]) -> dict[str, Any]:
        store = self._store()
        context = store.require_context(params.get("context"))
        streams = store.list_live_streams(context.to_dict())
        payload: dict[str, Any] = {}
        stream = None
        if purpose == "live-tick":
            stream_id = text(
                params.get("streamId"),
                160,
                required=True,
                field="streamId",
            )
            stream = store.get_live_stream(context.to_dict(), stream_id)
            if stream["status"] != "live":
                raise DomainError("conflict", "已结束的直播不能继续")
            payload["streamId"] = stream_id
        elif purpose != "live":
            raise DomainError("invalid_generation_purpose", "不支持的直播生成 purpose")
        request = self._with_prompt_profile(
            context,
            "live",
            build_live_request(
                purpose,
                store.active_character,
                streams,
                stream=stream,
            ),
        )
        operation_id = self._start_light_operation(purpose, context, payload)
        return {"operationId": operation_id, "request": request}

    def commit_live(self, purpose: str, params: dict[str, Any]) -> dict[str, Any]:
        store = self._store()
        context = store.require_context(params.get("context"))
        operation = self._light_operation(params, context, purpose)
        raw = text(params.get("content"), 65_536, required=True, field="content")
        if purpose == "live":
            stream = store.create_live_stream(
                context.to_dict(),
                parse_live_stream(raw, store.active_character),
            )
            notification = store.create_notification(
                context.to_dict(),
                {
                    "title": "角色开播",
                    "content": stream["title"],
                    "source": "live",
                    "sourceId": stream["streamId"],
                },
            )
            result = {"stream": stream, "notification": notification}
        elif purpose == "live-tick":
            current = store.get_live_stream(
                context.to_dict(),
                operation.payload["streamId"],
            )
            stream = store.apply_live_tick(
                context.to_dict(),
                current["streamId"],
                parse_live_tick(raw, current),
            )
            result = {"stream": stream}
        else:
            raise DomainError("invalid_generation_purpose", "不支持的直播生成 purpose")
        self.pending.pop(operation.operation_id, None)
        return result

    def prepare_assistant(self, params: dict[str, Any]) -> dict[str, Any]:
        store = self._store()
        context = store.require_context(params.get("context"))
        mode = text(params.get("mode"), 20).lower() or "create"
        if mode not in {"create", "extract"}:
            raise DomainError("invalid_params", "人物辅助 mode 无效")
        notes = text(params.get("notes"), 2_000)
        source_id = text(params.get("sourceCharacterId"), 160)
        source_character = None
        if source_id:
            source_character = self._character(
                source_id,
                field="sourceCharacterId",
                label="来源角色",
            )
        if mode == "extract" and source_character is None:
            raise DomainError("invalid_params", "提取模式必须选择白名单来源角色")
        if mode == "create" and not notes:
            raise DomainError("invalid_params", "创建模式必须填写人物草稿说明")
        request = self._with_prompt_profile(
            context,
            "assistant",
            build_assistant_request(
                mode,
                store.active_character,
                notes,
                source_character,
            ),
        )
        operation_id = self._start_light_operation(
            "assistant",
            context,
            {
                "mode": mode,
                "sourceCharacterId": (
                    source_character["cardUid"] if source_character else ""
                ),
            },
        )
        return {"operationId": operation_id, "request": request}

    def commit_assistant(self, params: dict[str, Any]) -> dict[str, Any]:
        store = self._store()
        context = store.require_context(params.get("context"))
        operation = self._light_operation(params, context, "assistant")
        drafts = parse_character_drafts(
            text(params.get("content"), 65_536, required=True, field="content"),
            mode=operation.payload["mode"],
            source_character_id=operation.payload["sourceCharacterId"],
        )
        created = store.create_character_drafts(context.to_dict(), drafts)
        self.pending.pop(operation.operation_id, None)
        return {"drafts": created}

    def prepare_workbench(self, params: dict[str, Any]) -> dict[str, Any]:
        store = self._store()
        context = store.require_context(params.get("context"))
        scope = text(
            params.get("scope"),
            40,
            required=True,
            field="scope",
        ).lower()
        profile = store.get_prompt_profile(context.to_dict(), scope)
        request = build_workbench_request(
            profile,
            text(params.get("input"), 1_000),
        )
        operation_id = self._start_light_operation(
            "workbench",
            context,
            {"scope": scope},
        )
        return {"operationId": operation_id, "request": request}

    def commit_workbench(self, params: dict[str, Any]) -> dict[str, Any]:
        store = self._store()
        context = store.require_context(params.get("context"))
        operation = self._light_operation(params, context, "workbench")
        result = parse_workbench_result(
            text(params.get("content"), 65_536, required=True, field="content"),
            operation.payload["scope"],
        )
        diagnostic = store.create_prompt_diagnostic(
            context.to_dict(),
            result["diagnostic"],
        )
        self.pending.pop(operation.operation_id, None)
        return {**result, "diagnostic": diagnostic}

    def abort_workbench(self, params: dict[str, Any]) -> dict[str, Any]:
        store = self._store()
        context = store.require_context(params.get("context"))
        operation = self._light_operation(params, context, "workbench")
        reason = text(params.get("reason"), 40) or "error"
        if reason not in {"cancelled", "timeout", "error"}:
            raise DomainError("invalid_params", "reason 只支持 cancelled、timeout 或 error")
        diagnostic = store.create_prompt_diagnostic(
            context.to_dict(),
            {
                "scope": operation.payload["scope"],
                "status": reason,
                "summary": text(params.get("message"), 500),
            },
        )
        self.pending.pop(operation.operation_id, None)
        return {"ok": True, "reason": reason, "diagnostic": diagnostic}

    def abort_light_app(self, purpose: str, params: dict[str, Any]) -> dict[str, Any]:
        store = self._store()
        context = store.require_context(params.get("context"))
        operation = self._light_operation(params, context, purpose)
        reason = text(params.get("reason"), 40) or "error"
        if reason not in {"cancelled", "timeout", "error"}:
            raise DomainError("invalid_params", "reason 只支持 cancelled、timeout 或 error")
        self.pending.pop(operation.operation_id, None)
        return {"ok": True, "reason": reason}

    def commit_chat(self, params: dict[str, Any]) -> dict[str, Any]:
        store = self._store()
        context = store.require_context(params.get("context"))
        operation = self._operation(params, context)
        group = store.get_group(context.to_dict(), operation.group_id)
        messages = parse_llm_messages(
            text(params.get("content"), 65_536, required=True, field="content"),
            group,
        )
        entries = ([operation.user_entry] if operation.user_entry else []) + messages
        stored = store.append_messages(context.to_dict(), operation.group_id, entries)
        self.pending.pop(operation.operation_id, None)
        return {"messages": stored, "groupId": operation.group_id}

    def abort_chat(self, params: dict[str, Any]) -> dict[str, Any]:
        store = self._store()
        context = store.require_context(params.get("context"))
        operation = self._operation(params, context)
        reason = text(params.get("reason"), 40) or "error"
        if reason not in {"cancelled", "timeout", "error"}:
            raise DomainError("invalid_params", "reason 只支持 cancelled、timeout 或 error")
        default_message = {
            "cancelled": "本次生成已取消。",
            "timeout": "模型生成超时，请重试。",
            "error": "模型生成失败，请重试。",
        }[reason]
        error_entry = system_error_message(text(params.get("message"), 500) or default_message)
        entries = ([operation.user_entry] if operation.user_entry else []) + [error_entry]
        stored = store.append_messages(context.to_dict(), operation.group_id, entries)
        self.pending.pop(operation.operation_id, None)
        return {"messages": stored, "groupId": operation.group_id, "reason": reason}

    def _operation(self, params: dict[str, Any], context: ContextRef) -> PendingChat:
        operation_id = text(
            params.get("operationId"),
            80,
            required=True,
            field="operationId",
        )
        operation = self.pending.get(operation_id)
        if operation is None or not isinstance(operation, PendingChat):
            raise DomainError("operation_not_found", "生成事务不存在或已结束")
        if operation.context != context:
            raise DomainError("context_stale", "生成事务所属角色或 session 已变化")
        return operation

    def _light_operation(
        self,
        params: dict[str, Any],
        context: ContextRef,
        purpose: str,
    ) -> PendingLightApp:
        operation_id = text(
            params.get("operationId"),
            80,
            required=True,
            field="operationId",
        )
        operation = self.pending.get(operation_id)
        if (
            operation is None
            or not isinstance(operation, PendingLightApp)
            or operation.purpose != purpose
        ):
            raise DomainError("operation_not_found", "轻应用生成事务不存在或已结束")
        if operation.context != context:
            raise DomainError("context_stale", "生成事务所属角色或 session 已变化")
        return operation

    def _start_light_operation(
        self,
        purpose: str,
        context: ContextRef,
        payload: dict[str, Any] | None = None,
    ) -> str:
        if any(
            isinstance(item, PendingLightApp)
            and item.context == context
            and item.purpose == purpose
            for item in self.pending.values()
        ):
            raise DomainError("generation_busy", f"{purpose} 已有生成请求")
        operation_id = new_id("op")
        self.pending[operation_id] = PendingLightApp(
            operation_id,
            context,
            purpose,
            payload or {},
        )
        while len(self.pending) > 16:
            self.pending.pop(next(iter(self.pending)))
        return operation_id

    def _with_prompt_profile(
        self,
        context: ContextRef,
        scope: str,
        request: dict[str, Any],
    ) -> dict[str, Any]:
        profile = self._store().get_prompt_profile(context.to_dict(), scope)
        return apply_custom_instruction(
            request,
            profile["instruction"] if profile["enabled"] else "",
        )

    def _character(
        self,
        card_uid: str,
        *,
        field: str,
        label: str,
    ) -> dict[str, Any]:
        character = next(
            (item for item in self._store().characters if item["cardUid"] == card_uid),
            None,
        )
        if character is None:
            if not card_uid:
                raise DomainError("invalid_params", f"{field} 不能为空")
            raise DomainError("not_found", f"{label}不在当前角色 Context 中")
        return character

    def _mail_counterparty(
        self,
        card_uid: str,
        *,
        fallback_name: str = "",
    ) -> dict[str, Any]:
        store = self._store()
        counterparty = next(
            (item for item in store.characters if item["cardUid"] == card_uid),
            None,
        )
        if counterparty is not None:
            return counterparty
        if fallback_name:
            return {
                "cardUid": card_uid,
                "name": fallback_name,
                "description": "",
                "personality": "",
                "scenario": "",
                "tags": [],
            }
        raise DomainError("not_found", "邮件收件人不在当前角色 Context 中")

    def _store(self) -> MobileStore:
        if self.store is None:
            raise DomainError("not_initialized", "service 尚未初始化")
        return self.store


class JsonRpcServer:
    def __init__(self, service: MobileChatService | None = None) -> None:
        self.service = service or MobileChatService()

    def handle(self, request: Any) -> dict[str, Any]:
        request_id = request.get("id") if isinstance(request, dict) else None
        try:
            if (
                not isinstance(request, dict)
                or request.get("jsonrpc") != "2.0"
                or not isinstance(request_id, int)
                or not isinstance(request.get("method"), str)
            ):
                raise DomainError("invalid_request", "JSON-RPC request 无效")
            params = request.get("params", {})
            if not isinstance(params, dict):
                raise DomainError("invalid_params", "params 必须是 object")
            result = self.service.dispatch(request["method"], params)
            return {"jsonrpc": "2.0", "id": request_id, "result": result}
        except DomainError as exc:
            return {
                "jsonrpc": "2.0",
                "id": request_id if isinstance(request_id, int) else 0,
                "error": {
                    "code": -32000,
                    "message": exc.message,
                    "data": {"code": exc.code},
                },
            }
        except Exception:
            return {
                "jsonrpc": "2.0",
                "id": request_id if isinstance(request_id, int) else 0,
                "error": {
                    "code": -32603,
                    "message": "service internal error",
                    "data": {"code": "internal_error"},
                },
            }

    def serve(self, source: TextIO, sink: TextIO) -> None:
        for line in source:
            if not line.strip():
                continue
            try:
                request = json.loads(line)
            except json.JSONDecodeError:
                response = {
                    "jsonrpc": "2.0",
                    "id": 0,
                    "error": {
                        "code": -32700,
                        "message": "parse error",
                        "data": {"code": "invalid_json"},
                    },
                }
            else:
                response = self.handle(request)
            sink.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
            sink.flush()
            if (
                isinstance(request, dict)
                and request.get("method") == "extension.shutdown"
                and "result" in response
            ):
                break


def main() -> None:
    JsonRpcServer().serve(sys.stdin, sys.stdout)


if __name__ == "__main__":
    main()
