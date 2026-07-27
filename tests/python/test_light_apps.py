from __future__ import annotations

from typing import Any

import pytest
from conftest import character, context

from fantareal_mobile_chat.domain import DomainError
from fantareal_mobile_chat.service import MobileChatService


def diary_payload(**overrides: Any) -> dict[str, Any]:
    return {
        "title": "雨停之前",
        "content": "窗边的灯一直亮着。",
        "entryDate": "2026-07-26",
        "mood": "安静",
        "authorId": "card_a",
        "authorName": "Alice",
        "tags": ["雨夜"],
        "source": "manual",
        **overrides,
    }


def calendar_payload(**overrides: Any) -> dict[str, Any]:
    return {
        "title": "去旧书店",
        "description": "下午一起找那本绝版诗集。",
        "startsOn": "2026-07-28",
        "endsOn": "",
        "allDay": True,
        "status": "planned",
        "participants": [
            {
                "roleId": "card_a",
                "displayName": "Alice",
                "kind": "character",
                "summary": "calm",
            }
        ],
        "location": "河边旧书店",
        "tags": ["约定"],
        "source": "manual",
        **overrides,
    }


def generated_diary() -> str:
    return (
        '{"entries":[{"title":"雨后的窗","content":"雨声停下后，房间显得更安静。",'
        '"entryDate":"2026-07-26","mood":"平静","tags":["雨夜"]}]}'
    )


def generated_calendar() -> str:
    return (
        '{"events":[{"title":"去旧书店","description":"找一本绝版诗集。",'
        '"startsOn":"2026-07-28","endsOn":"","location":"河边","tags":["约定"]}]}'
    )


def test_diary_crud_creates_and_removes_source_notification(
    service: MobileChatService,
) -> None:
    created = service.dispatch(
        "mobile.diary.create",
        {"context": context(), "entry": diary_payload()},
    )
    entry = created["entry"]
    notification = created["notification"]
    assert entry["entryId"].startswith("diary_")
    assert notification["source"] == "diary"
    assert notification["sourceId"] == entry["entryId"]

    updated = service.dispatch(
        "mobile.diary.update",
        {
            "context": context(),
            "entryId": entry["entryId"],
            "entry": {"title": "雨停以后"},
        },
    )["entry"]
    assert updated["title"] == "雨停以后"
    assert updated["content"] == diary_payload()["content"]
    assert service.dispatch("mobile.diary.list", {"context": context()})["entries"] == [
        updated
    ]

    service.dispatch(
        "mobile.diary.delete",
        {"context": context(), "entryId": entry["entryId"]},
    )
    assert service.dispatch("mobile.diary.list", {"context": context()})["entries"] == []
    assert (
        service.dispatch("mobile.notifications.list", {"context": context()})[
            "notifications"
        ]
        == []
    )
    assert not list(service.store.data_root.rglob("*.tmp"))


def test_diary_generation_prepare_commit_is_atomic_and_notifies(
    service: MobileChatService,
) -> None:
    prepared = service.dispatch(
        "mobile.diary.generate.prepare",
        {"context": context()},
    )
    assert prepared["request"]["purpose"] == "mobile-chat.diary"
    assert prepared["request"]["responseFormat"] == "json_object"
    assert "Alice" in prepared["request"]["messages"][-1]["content"]
    assert service.dispatch("mobile.diary.list", {"context": context()})["entries"] == []

    committed = service.dispatch(
        "mobile.diary.generate.commit",
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "content": generated_diary(),
        },
    )
    assert [entry["title"] for entry in committed["entries"]] == ["雨后的窗"]
    assert committed["entries"][0]["authorId"] == "card_a"
    assert committed["entries"][0]["source"] == "model"
    assert committed["notifications"][0]["sourceId"] == committed["entries"][0]["entryId"]
    assert prepared["operationId"] not in service.pending
    assert service.dispatch("mobile.diary.list", {"context": context()})["entries"] == (
        committed["entries"]
    )
    assert not list(service.store.data_root.rglob("*.tmp"))


def test_calendar_generation_commit_persists_event_and_notification(
    service: MobileChatService,
) -> None:
    prepared = service.dispatch(
        "mobile.calendar.generate.prepare",
        {"context": context()},
    )
    assert prepared["request"]["purpose"] == "mobile-chat.calendar"

    committed = service.dispatch(
        "mobile.calendar.generate.commit",
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "content": generated_calendar(),
        },
    )
    event = committed["events"][0]
    assert event["title"] == "去旧书店"
    assert event["participants"][0]["roleId"] == "card_a"
    assert event["source"] == "model"
    assert committed["notifications"][0]["sourceId"] == event["eventId"]
    assert service.dispatch("mobile.calendar.list", {"context": context()})["events"] == [
        event
    ]


def test_light_app_parse_failure_can_abort_without_writing(
    service: MobileChatService,
) -> None:
    prepared = service.dispatch(
        "mobile.diary.generate.prepare",
        {"context": context()},
    )
    with pytest.raises(DomainError, match="可用日记") as parse_failure:
        service.dispatch(
            "mobile.diary.generate.commit",
            {
                "context": context(),
                "operationId": prepared["operationId"],
                "content": '{"entries":[]}',
            },
        )
    assert parse_failure.value.code == "parse_failed"
    assert prepared["operationId"] in service.pending
    assert service.dispatch("mobile.diary.list", {"context": context()})["entries"] == []

    aborted = service.dispatch(
        "mobile.diary.generate.abort",
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "reason": "error",
        },
    )
    assert aborted == {"ok": True, "reason": "error"}
    assert prepared["operationId"] not in service.pending
    assert service.dispatch(
        "mobile.notifications.list",
        {"context": context()},
    )["notifications"] == []


@pytest.mark.parametrize("reason", ["cancelled", "timeout", "error"])
def test_light_app_generation_abort_reasons(
    service: MobileChatService,
    reason: str,
) -> None:
    prepared = service.dispatch(
        "mobile.calendar.generate.prepare",
        {"context": context()},
    )
    result = service.dispatch(
        "mobile.calendar.generate.abort",
        {
            "context": context(),
            "operationId": prepared["operationId"],
            "reason": reason,
        },
    )
    assert result == {"ok": True, "reason": reason}
    assert service.dispatch(
        "mobile.calendar.list",
        {"context": context()},
    )["events"] == []


def test_light_app_operation_cannot_be_consumed_by_another_purpose(
    service: MobileChatService,
) -> None:
    prepared = service.dispatch(
        "mobile.diary.generate.prepare",
        {"context": context()},
    )
    with pytest.raises(DomainError, match="事务不存在") as wrong_purpose:
        service.dispatch(
            "mobile.calendar.generate.commit",
            {
                "context": context(),
                "operationId": prepared["operationId"],
                "content": generated_calendar(),
            },
        )
    assert wrong_purpose.value.code == "operation_not_found"
    assert prepared["operationId"] in service.pending


def test_chat_prepare_handles_a_pending_light_app_without_type_confusion(
    service: MobileChatService,
    group_payload: dict[str, Any],
) -> None:
    group_id = service.dispatch(
        "mobile.groups.create",
        {"context": context(), "group": group_payload},
    )["group"]["groupId"]
    diary = service.dispatch(
        "mobile.diary.generate.prepare",
        {"context": context()},
    )
    chat = service.dispatch(
        "mobile.chat.prepare",
        {
            "context": context(),
            "groupId": group_id,
            "mode": "continue",
            "content": "",
        },
    )
    assert diary["operationId"] in service.pending
    assert chat["operationId"] in service.pending


def test_light_app_role_switch_rejects_late_commit(
    service: MobileChatService,
) -> None:
    prepared = service.dispatch(
        "mobile.diary.generate.prepare",
        {"context": context()},
    )
    card_b = character("card_b", "Bob")
    context_b = context("card_b", "revision_b")
    service.dispatch(
        "mobile.context.bind",
        {
            "context": context_b,
            "activeCharacter": card_b,
            "characters": [card_b],
        },
    )
    assert prepared["operationId"] not in service.pending
    with pytest.raises(DomainError, match="角色或 Extension session 已变化") as stale:
        service.dispatch(
            "mobile.diary.generate.commit",
            {
                "context": context(),
                "operationId": prepared["operationId"],
                "content": generated_diary(),
            },
        )
    assert stale.value.code == "context_stale"
    assert service.dispatch("mobile.diary.list", {"context": context_b})["entries"] == []


def test_calendar_crud_and_notification_read_lifecycle(
    service: MobileChatService,
) -> None:
    created = service.dispatch(
        "mobile.calendar.create",
        {"context": context(), "event": calendar_payload()},
    )
    event = created["event"]
    notification = created["notification"]
    assert event["eventId"].startswith("calendar_")
    assert notification["sourceId"] == event["eventId"]

    completed = service.dispatch(
        "mobile.calendar.update",
        {
            "context": context(),
            "eventId": event["eventId"],
            "event": {"status": "completed"},
        },
    )["event"]
    assert completed["status"] == "completed"
    assert completed["location"] == calendar_payload()["location"]

    marked = service.dispatch(
        "mobile.notifications.mark",
        {
            "context": context(),
            "notificationId": notification["notificationId"],
            "isRead": True,
        },
    )["notification"]
    assert marked["isRead"] is True
    assert service.dispatch(
        "mobile.notifications.readAll",
        {"context": context()},
    ) == {"updatedCount": 0}
    assert service.dispatch(
        "mobile.notifications.clear",
        {"context": context()},
    ) == {"deletedCount": 1}


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (calendar_payload(startsOn="2026-02-30"), "必须是 YYYY-MM-DD"),
        (
            calendar_payload(startsOn="2026-07-30", endsOn="2026-07-29"),
            "不能早于 startsOn",
        ),
        (calendar_payload(status="unknown"), "status 无效"),
    ],
)
def test_calendar_rejects_invalid_contract(
    service: MobileChatService,
    payload: dict[str, Any],
    message: str,
) -> None:
    with pytest.raises(DomainError, match=message) as failure:
        service.dispatch(
            "mobile.calendar.create",
            {"context": context(), "event": payload},
        )
    assert failure.value.code == "invalid_params"


def test_light_apps_are_per_card_and_reject_stale_context(
    service: MobileChatService,
) -> None:
    service.dispatch(
        "mobile.diary.create",
        {"context": context(), "entry": diary_payload()},
    )
    card_b = character("card_b", "Bob")
    context_b = context("card_b", "revision_b")
    service.dispatch(
        "mobile.context.bind",
        {
            "context": context_b,
            "activeCharacter": card_b,
            "characters": [card_b],
        },
    )
    assert service.dispatch("mobile.diary.list", {"context": context_b})["entries"] == []
    assert (
        service.dispatch("mobile.notifications.list", {"context": context_b})[
            "notifications"
        ]
        == []
    )
    with pytest.raises(DomainError, match="角色或 Extension session 已变化") as stale:
        service.dispatch(
            "mobile.diary.create",
            {"context": context(), "entry": diary_payload(title="不应写入")},
        )
    assert stale.value.code == "context_stale"
