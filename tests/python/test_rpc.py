from __future__ import annotations

from pathlib import Path

from fantareal_mobile_chat.domain import DEFAULT_SYSTEM_PROMPT
from fantareal_mobile_chat.service import JsonRpcServer


def test_packaged_group_chat_prompt_is_loaded() -> None:
    assert "只允许 group.members 中 kind 为 character 的成员发言" in DEFAULT_SYSTEM_PROMPT
    assert "speakerId" in DEFAULT_SYSTEM_PROMPT


def test_json_rpc_initialize_health_and_typed_error(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    assets_root = tmp_path / "assets"
    workspace_root = tmp_path / "workspace"
    data_root.mkdir()
    assets_root.mkdir()
    workspace_root.mkdir()
    server = JsonRpcServer()

    initialized = server.handle(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "extension.initialize",
            "params": {
                "workspace": str(workspace_root),
                "locale": "zh-CN",
                "permissions": ["storage.data", "storage.assets"],
                "storage": {
                    "paths": {"data": str(data_root), "assets": str(assets_root)},
                    "quotas": {
                        "data": 64 * 1024 * 1024,
                        "assets": 64 * 1024 * 1024,
                    },
                },
            },
        }
    )
    assert initialized["result"]["ok"] is True

    health = server.handle(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "extension.health",
            "params": {},
        }
    )
    assert health["result"]["service"] == "fantareal-mobile-chat"

    error = server.handle(
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "mobile.groups.list",
            "params": {"context": {}},
        }
    )
    assert error["error"]["data"]["code"] == "invalid_params"
    assert "cardUid" in error["error"]["message"]
