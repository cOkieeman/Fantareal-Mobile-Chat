from __future__ import annotations

import json
import sys
from dataclasses import dataclass
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
from .store import MobileStore


@dataclass(slots=True)
class PendingChat:
    operation_id: str
    context: ContextRef
    group_id: str
    mode: str
    user_entry: dict[str, str] | None


class MobileChatService:
    def __init__(self) -> None:
        self.store: MobileStore | None = None
        self.locale = "zh-CN"
        self.pending: dict[str, PendingChat] = {}

    def dispatch(self, method: str, params: dict[str, Any]) -> Any:
        if method == "extension.initialize":
            return self.initialize(params)
        if method == "extension.health":
            return {
                "ok": self.store is not None,
                "service": "fantareal-mobile-chat",
                "version": "0.4.0.dev1",
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
            item.group_id == group_id and item.context == context
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
        if operation is None:
            raise DomainError("operation_not_found", "生成事务不存在或已结束")
        if operation.context != context:
            raise DomainError("context_stale", "生成事务所属角色或 session 已变化")
        return operation

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
