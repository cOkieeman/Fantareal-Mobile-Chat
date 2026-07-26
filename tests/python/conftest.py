from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from fantareal_mobile_chat.service import MobileChatService


def context(card_uid: str = "card_a", revision: str = "revision_a") -> dict[str, str]:
    return {
        "cardUid": card_uid,
        "contextRevision": revision,
        "sessionId": "session_a",
    }

def character(card_uid: str = "card_a", name: str = "Alice") -> dict[str, Any]:
    return {
        "cardUid": card_uid,
        "name": name,
        "description": f"{name} description",
        "personality": "calm",
        "scenario": "rainy night",
        "tags": ["fixture"],
    }


@pytest.fixture
def service(tmp_path: Path) -> MobileChatService:
    data_root = tmp_path / "data"
    workspace_root = tmp_path / "workspace"
    data_root.mkdir()
    workspace_root.mkdir()
    instance = MobileChatService()
    instance.dispatch(
        "extension.initialize",
        {
            "workspace": str(workspace_root),
            "locale": "zh-CN",
            "permissions": ["storage.data"],
            "storage": {
                "paths": {"data": str(data_root)},
                "quotas": {"data": 64 * 1024 * 1024},
            },
        },
    )
    active = character()
    instance.dispatch(
        "mobile.context.bind",
        {
            "context": context(),
            "activeCharacter": active,
            "characters": [active],
        },
    )
    return instance


@pytest.fixture
def group_payload() -> dict[str, Any]:
    return {
        "title": "Rain Watch",
        "description": "Wait for the rain to stop.",
        "members": [
            {
                "roleId": "user",
                "displayName": "Me",
                "kind": "user",
                "summary": "",
            },
            {
                "roleId": "card_a",
                "displayName": "Alice",
                "kind": "character",
                "summary": "calm",
            },
        ],
        "replyCount": 2,
        "allowRoleToRoleReply": True,
    }
