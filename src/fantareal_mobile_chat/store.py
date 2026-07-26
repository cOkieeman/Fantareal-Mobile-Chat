from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

from .domain import (
    ContextRef,
    DomainError,
    normalize_character,
    normalize_context,
    normalize_group,
    normalize_message,
    now_iso,
)

TOKEN_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
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

    def bind_context(
        self,
        value: Any,
        characters: Any,
        active_character: Any,
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

    def list_messages(self, context: Any, group_id: str) -> list[dict[str, str]]:
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
    ) -> list[dict[str, str]]:
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

    def _legacy_root(self, directory_token: str, card_uid: str) -> Path:
        if not TOKEN_PATTERN.fullmatch(directory_token):
            raise DomainError("invalid_grant", "directoryToken 格式无效")
        grant_path = self.workspace_root / "input-directory-grants" / f"{directory_token}.json"
        grant = self._read_json(grant_path, {})
        if (
            not isinstance(grant, dict)
            or grant.get("kind") != "fantareal.directory-grant"
            or grant.get("token") != directory_token
            or grant.get("readOnly") is not True
        ):
            raise DomainError("invalid_grant", "目录授权不存在或无效")
        selected = Path(str(grant.get("path", ""))).resolve()
        if not selected.is_dir():
            raise DomainError("invalid_grant", "授权目录已不可用")
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
    ) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, str]]]]:
        payload = self._read_json(root / "groups.json", [])
        rows = payload.get("groups", []) if isinstance(payload, dict) else payload
        groups = []
        for item in rows if isinstance(rows, list) else []:
            try:
                groups.append(normalize_group(item))
            except DomainError:
                continue
        messages: dict[str, list[dict[str, str]]] = {}
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

    @staticmethod
    def _write_json(path: Path, value: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{path.name}.",
            suffix=".tmp",
            dir=path.parent,
        )
        temporary_path = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, path)
        except OSError as exc:
            temporary_path.unlink(missing_ok=True)
            raise DomainError("storage_write_failed", f"无法写入 {path.name}") from exc

    def _write_groups(self, card_uid: str, groups: list[dict[str, Any]]) -> None:
        self._write_json(self._groups_path(card_uid), {"schemaVersion": 1, "groups": groups})

    def _write_messages(
        self,
        card_uid: str,
        group_id: str,
        messages: list[dict[str, str]],
    ) -> None:
        self._write_json(
            self._messages_path(card_uid, group_id),
            {"schemaVersion": 1, "messages": messages},
        )

    @staticmethod
    def _without_last(group: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in group.items() if key != "lastMessage"}
