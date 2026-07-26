from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from conftest import character, context

from fantareal_mobile_chat.domain import DomainError
from fantareal_mobile_chat.service import MobileChatService


def test_group_crud_and_atomic_messages(
    service: MobileChatService,
    group_payload: dict[str, Any],
) -> None:
    created = service.dispatch(
        "mobile.groups.create",
        {"context": context(), "group": group_payload},
    )["group"]
    group_id = created["groupId"]
    assert group_id.startswith("group_")

    listed = service.dispatch("mobile.groups.list", {"context": context()})["groups"]
    assert [item["groupId"] for item in listed] == [group_id]
    assert listed[0]["lastMessage"] is None

    updated = service.dispatch(
        "mobile.groups.update",
        {
            "context": context(),
            "groupId": group_id,
            "group": {"title": "After Rain"},
        },
    )["group"]
    assert updated["title"] == "After Rain"
    assert updated["description"] == group_payload["description"]

    service.store.append_messages(
        context(),
        group_id,
        [
            {
                "speakerId": "user",
                "speakerName": "Me",
                "type": "text",
                "content": "Hello",
                "source": "user",
            }
        ],
    )
    messages = service.dispatch(
        "mobile.messages.list",
        {"context": context(), "groupId": group_id},
    )["messages"]
    assert [item["content"] for item in messages] == ["Hello"]
    assert not list(service.store.data_root.rglob("*.tmp"))

    service.dispatch(
        "mobile.groups.delete",
        {"context": context(), "groupId": group_id},
    )
    assert service.dispatch("mobile.groups.list", {"context": context()})["groups"] == []


def test_card_isolation_and_stale_write_rejection(
    service: MobileChatService,
    group_payload: dict[str, Any],
) -> None:
    created = service.dispatch(
        "mobile.groups.create",
        {"context": context(), "group": group_payload},
    )["group"]

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
    assert service.dispatch("mobile.groups.list", {"context": context_b})["groups"] == []

    with pytest.raises(DomainError, match="角色或 Extension session 已变化") as stale:
        service.dispatch(
            "mobile.groups.create",
            {"context": context(), "group": group_payload},
        )
    assert stale.value.code == "context_stale"

    active = character()
    service.dispatch(
        "mobile.context.bind",
        {
            "context": context(),
            "activeCharacter": active,
            "characters": [active],
        },
    )
    restored = service.dispatch("mobile.groups.list", {"context": context()})["groups"]
    assert [item["groupId"] for item in restored] == [created["groupId"]]


def test_explicit_legacy_import_preview_and_apply(
    service: MobileChatService,
    tmp_path: Path,
    group_payload: dict[str, Any],
) -> None:
    existing = service.dispatch(
        "mobile.groups.create",
        {"context": context(), "group": group_payload},
    )["group"]
    service.store.append_messages(
        context(),
        existing["groupId"],
        [
            {
                "speakerId": "user",
                "speakerName": "Me",
                "type": "text",
                "content": "Remove on replace",
                "source": "user",
            }
        ],
    )
    existing_messages_path = (
        service.store.data_root
        / "cards"
        / "card_a"
        / "messages"
        / f"{existing['groupId']}.json"
    )
    assert existing_messages_path.is_file()

    selected = tmp_path / "legacy-mobile-chat"
    legacy_card = selected / "cards" / "card_a"
    (legacy_card / "messages").mkdir(parents=True)
    group_id = "group_legacy"
    (legacy_card / "groups.json").write_text(
        json.dumps(
            [
                {
                    "group_id": group_id,
                    "name": "Legacy Group",
                    "description": "Imported explicitly.",
                    "members": [
                        {"role_id": "user", "name": "Me", "type": "user"},
                        {"role_id": "card_a", "name": "Alice", "type": "character"},
                    ],
                    "reply_count": "1",
                    "allow_role_to_role_reply": True,
                }
            ]
        ),
        encoding="utf-8",
    )
    (legacy_card / "messages" / f"{group_id}.json").write_text(
        json.dumps(
            [
                {
                    "message_id": "msg_0123456789",
                    "speaker_id": "card_a",
                    "speaker_name": "Alice",
                    "type": "text",
                    "content": "Imported message",
                    "source": "ai",
                }
            ]
        ),
        encoding="utf-8",
    )

    token = str(UUID("11111111-2222-3333-4444-555555555555"))
    grants = service.store.workspace_root / "input-directory-grants"
    grants.mkdir()
    (grants / f"{token}.json").write_text(
        json.dumps(
            {
                "kind": "fantareal.directory-grant",
                "schemaVersion": 1,
                "token": token,
                "path": str(selected),
                "name": selected.name,
                "readOnly": True,
            }
        ),
        encoding="utf-8",
    )

    preview = service.dispatch(
        "mobile.import.preview",
        {"context": context(), "directoryToken": token},
    )
    assert preview["groupCount"] == 1
    assert preview["messageCount"] == 1

    applied = service.dispatch(
        "mobile.import.apply",
        {"context": context(), "directoryToken": token, "mode": "merge"},
    )
    assert applied == {"groupCount": 1, "messageCount": 1}
    assert existing_messages_path.is_file()
    messages = service.dispatch(
        "mobile.messages.list",
        {"context": context(), "groupId": group_id},
    )["messages"]
    assert [item["content"] for item in messages] == ["Imported message"]
    assert messages[0]["messageId"] == "msg_0123456789"

    replaced = service.dispatch(
        "mobile.import.apply",
        {"context": context(), "directoryToken": token, "mode": "replace"},
    )
    assert replaced == {"groupCount": 1, "messageCount": 1}
    assert not existing_messages_path.exists()
    groups = service.dispatch("mobile.groups.list", {"context": context()})["groups"]
    assert [item["groupId"] for item in groups] == [group_id]
