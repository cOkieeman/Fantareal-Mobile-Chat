from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import shutil
import struct
import zlib
from collections import Counter
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any
from uuid import uuid4

from .directory_grants import is_link_or_reparse, resolve_directory_grant
from .domain import ID_PATTERN, DomainError
from .filesystem import atomic_write_bytes, atomic_write_json

PACK_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:[.-][a-z0-9]+)*$")
ASSET_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$")
VERSION_PATTERN = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-[0-9A-Za-z.-]+)?$"
)
ALLOWED_KINDS = {"sticker", "background", "avatar-decoration"}
ALLOWED_MEDIA_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
TOP_LEVEL_KEYS = {
    "schemaVersion",
    "id",
    "name",
    "version",
    "description",
    "license",
    "assets",
}
LICENSE_KEYS = {"name", "source", "redistributionAllowed", "url", "attribution"}
ASSET_KEYS = {"id", "kind", "path", "mediaType", "alt"}
MAX_MANIFEST_BYTES = 256 * 1024
MAX_ASSET_BYTES = 32 * 1024 * 1024
MAX_ASSETS = 4000
MAX_INLINE_BYTES = 256 * 1024
MAX_PREVIEW_ASSETS = 8


@dataclass(frozen=True, slots=True)
class ScannedAsset:
    asset_id: str
    kind: str
    relative_path: str
    media_type: str
    alt: str
    source: Path
    size_bytes: int
    digest: str

    def metadata(self) -> dict[str, Any]:
        return {
            "id": self.asset_id,
            "kind": self.kind,
            "path": self.relative_path,
            "mediaType": self.media_type,
            "alt": self.alt,
            "sizeBytes": self.size_bytes,
            "sha256": self.digest,
        }


@dataclass(frozen=True, slots=True)
class ScannedPack:
    root: Path
    manifest: dict[str, Any]
    assets: tuple[ScannedAsset, ...]
    content_digest: str
    installed_size_bytes: int


class ResourcePackManager:
    """Strict, per-card resource-pack storage under Host-provided assets."""

    def __init__(self, assets_root: Path, workspace_root: Path, quota_bytes: int) -> None:
        self.assets_root = assets_root.resolve()
        self.workspace_root = workspace_root.resolve()
        self.quota_bytes = max(0, int(quota_bytes))
        if (
            not self.assets_root.is_dir()
            or is_link_or_reparse(self.assets_root)
            or not self.workspace_root.is_dir()
        ):
            raise DomainError("storage_unavailable", "Host assets storage 或 workspace 不可用")
        self.cards_root = self.assets_root / "cards"
        self.cards_root.mkdir(parents=True, exist_ok=True)

    def preview(self, card_uid: str, directory_token: str) -> dict[str, Any]:
        self._card_root(card_uid)
        grant = resolve_directory_grant(self.workspace_root, directory_token)
        pack = self._scan_pack(grant.root)
        usage = self._tree_usage(self.assets_root)
        target = self._pack_root(card_uid, pack.manifest["id"])
        replaced_bytes = self._tree_usage(target) if os.path.lexists(target) else 0
        final_usage = usage - replaced_bytes + pack.installed_size_bytes
        return {
            **self._summary(pack),
            "directoryToken": directory_token,
            "directoryName": grant.name,
            "currentUsageBytes": usage,
            "replacedBytes": replaced_bytes,
            "finalUsageBytes": final_usage,
            "quotaBytes": self.quota_bytes,
            "fitsQuota": self.quota_bytes > 0 and final_usage <= self.quota_bytes,
            "previewAssets": self._preview_assets(pack),
        }

    def import_pack(
        self,
        card_uid: str,
        directory_token: str,
        expected_digest: str,
    ) -> dict[str, Any]:
        grant = resolve_directory_grant(self.workspace_root, directory_token)
        pack = self._scan_pack(grant.root)
        if not expected_digest or pack.content_digest != expected_digest:
            raise DomainError(
                "resource_pack_changed",
                "资源包在预览后发生变化，请重新选择并确认",
            )
        packs_root = self._packs_root(card_uid)
        packs_root.mkdir(parents=True, exist_ok=True)
        target = self._pack_root(card_uid, pack.manifest["id"])
        usage = self._tree_usage(self.assets_root)
        replaced_bytes = self._tree_usage(target) if os.path.lexists(target) else 0
        final_usage = usage - replaced_bytes + pack.installed_size_bytes
        if self.quota_bytes <= 0:
            raise DomainError(
                "assets_quota_unconfigured",
                "Host 尚未为插件设置 assets quota",
            )
        if final_usage > self.quota_bytes:
            raise DomainError(
                "assets_quota_exceeded",
                f"导入后资源占用将超过 quota（{final_usage} > {self.quota_bytes} bytes）",
            )

        nonce = uuid4().hex
        stage = packs_root / f".{pack.manifest['id']}.{nonce}.stage"
        backup = packs_root / f".{pack.manifest['id']}.{nonce}.backup"
        stage.mkdir()
        try:
            for asset in pack.assets:
                destination = stage.joinpath(*PurePosixPath(asset.relative_path).parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                payload = self._read_verified_asset(asset)
                atomic_write_bytes(destination, payload)
            atomic_write_json(stage / "resource-pack.json", pack.manifest)
            if os.path.lexists(target):
                os.replace(target, backup)
            try:
                os.replace(stage, target)
            except OSError as exc:
                if os.path.lexists(backup) and not os.path.lexists(target):
                    os.replace(backup, target)
                raise DomainError("storage_write_failed", "无法原子安装资源包") from exc
            self._remove_tree(backup)
        except Exception:
            self._remove_tree(stage)
            if os.path.lexists(backup) and not os.path.lexists(target):
                os.replace(backup, target)
            raise
        installed = self._scan_pack(target)
        return self._summary(installed)

    def list_packs(self, card_uid: str) -> dict[str, Any]:
        packs_root = self._packs_root(card_uid)
        packs: list[dict[str, Any]] = []
        if packs_root.exists():
            for entry in sorted(packs_root.iterdir(), key=lambda item: item.name):
                if entry.name.startswith("."):
                    continue
                try:
                    pack = self._scan_pack(entry)
                    packs.append(
                        {
                            **self._summary(pack),
                            "status": "ready",
                            "previewAssets": self._preview_assets(pack),
                        }
                    )
                except DomainError as exc:
                    packs.append(
                        {
                            "id": entry.name[:120],
                            "name": entry.name[:80],
                            "version": "",
                            "status": "damaged",
                            "error": exc.message,
                            "assetCount": 0,
                            "totalSizeBytes": self._tree_usage(entry, reject_links=False),
                            "kindCounts": {},
                            "previewAssets": [],
                        }
                    )
        return {
            "packs": packs,
            "usageBytes": self._tree_usage(self.assets_root),
            "quotaBytes": self.quota_bytes,
        }

    def delete_pack(self, card_uid: str, pack_id: str) -> dict[str, Any]:
        target = self._pack_root(card_uid, self._pack_id(pack_id))
        if not os.path.lexists(target):
            raise DomainError("resource_pack_not_found", "资源包不存在")
        removed_bytes = self._tree_usage(target, reject_links=False)
        self._remove_tree(target)
        return {"deleted": True, "packId": pack_id, "removedBytes": removed_bytes}

    def clear_packs(self, card_uid: str) -> dict[str, Any]:
        root = self._packs_root(card_uid)
        removed_bytes = self._tree_usage(root, reject_links=False)
        self._remove_tree(root)
        return {"deleted": True, "removedBytes": removed_bytes}

    def get_asset(
        self,
        card_uid: str,
        pack_id: str,
        asset_id: str,
        *,
        expected_kind: str | None = None,
    ) -> dict[str, Any]:
        pack = self._scan_pack(self._pack_root(card_uid, self._pack_id(pack_id)))
        asset = next((item for item in pack.assets if item.asset_id == asset_id), None)
        if asset is None or (expected_kind is not None and asset.kind != expected_kind):
            raise DomainError("resource_asset_not_found", "资源已不存在或用途不匹配")
        payload = self._read_verified_asset(asset)
        return {
            **asset.metadata(),
            "packId": pack.manifest["id"],
            "packName": pack.manifest["name"],
            "dataUrl": (
                f"data:{asset.media_type};base64,"
                f"{base64.b64encode(payload).decode('ascii')}"
            ),
        }

    def list_assets(
        self,
        card_uid: str,
        kind: str,
        *,
        offset: int = 0,
        limit: int = 48,
    ) -> dict[str, Any]:
        if kind not in ALLOWED_KINDS:
            raise DomainError("invalid_params", "资源 kind 无效")
        if isinstance(offset, bool) or not isinstance(offset, int):
            raise DomainError("invalid_params", "offset 必须是 integer")
        if isinstance(limit, bool) or not isinstance(limit, int):
            raise DomainError("invalid_params", "limit 必须是 integer")
        assets: list[tuple[ScannedPack, ScannedAsset]] = []
        root = self._packs_root(card_uid)
        if root.exists():
            for entry in sorted(root.iterdir(), key=lambda item: item.name):
                if entry.name.startswith("."):
                    continue
                try:
                    pack = self._scan_pack(entry)
                except DomainError:
                    continue
                assets.extend(
                    (pack, asset) for asset in pack.assets if asset.kind == kind
                )
        safe_offset = max(0, offset)
        safe_limit = min(96, max(1, limit))
        page = []
        for pack, asset in assets[safe_offset : safe_offset + safe_limit]:
            item = {
                **asset.metadata(),
                "packId": pack.manifest["id"],
                "packName": pack.manifest["name"],
            }
            if asset.size_bytes <= MAX_INLINE_BYTES:
                payload = self._read_verified_asset(asset)
                item["dataUrl"] = (
                    f"data:{asset.media_type};base64,"
                    f"{base64.b64encode(payload).decode('ascii')}"
                )
            page.append(item)
        return {
            "kind": kind,
            "offset": safe_offset,
            "limit": safe_limit,
            "total": len(assets),
            "assets": page,
        }

    def _scan_pack(self, root: Path) -> ScannedPack:
        if not root.is_dir() or is_link_or_reparse(root):
            raise DomainError("resource_pack_unsafe", "资源包根目录不是普通目录")
        manifest_path = root / "resource-pack.json"
        if (
            not manifest_path.is_file()
            or is_link_or_reparse(manifest_path)
            or manifest_path.stat().st_size > MAX_MANIFEST_BYTES
        ):
            raise DomainError("resource_pack_invalid", "resource-pack.json 缺失或大小无效")
        try:
            raw_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise DomainError("resource_pack_invalid", "resource-pack.json 无法解析") from exc
        manifest = self._normalize_manifest(raw_manifest)
        scanned_assets = tuple(
            self._scan_asset(root, asset) for asset in manifest["assets"]
        )
        canonical_manifest = json.dumps(
            manifest,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        digest = hashlib.sha256(canonical_manifest)
        for asset in scanned_assets:
            digest.update(asset.relative_path.encode("utf-8"))
            digest.update(bytes.fromhex(asset.digest))
        installed_size = len(
            json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        ) + sum(asset.size_bytes for asset in scanned_assets)
        return ScannedPack(
            root=root,
            manifest=manifest,
            assets=scanned_assets,
            content_digest=digest.hexdigest(),
            installed_size_bytes=installed_size,
        )

    def _scan_asset(self, root: Path, asset: dict[str, Any]) -> ScannedAsset:
        relative = PurePosixPath(asset["path"])
        source = root.joinpath(*relative.parts)
        for parent in (source, *source.parents):
            if parent == root.parent:
                break
            if is_link_or_reparse(parent):
                raise DomainError(
                    "resource_pack_unsafe",
                    f"资源路径含符号链接或 junction：{asset['path']}",
                )
            if parent == root:
                break
        try:
            resolved = source.resolve(strict=True)
            resolved.relative_to(root.resolve(strict=True))
        except (OSError, ValueError) as exc:
            raise DomainError(
                "resource_pack_unsafe",
                f"资源路径越界或不存在：{asset['path']}",
            ) from exc
        if not resolved.is_file() or is_link_or_reparse(resolved):
            raise DomainError("resource_pack_unsafe", f"资源不是普通文件：{asset['path']}")
        size = resolved.stat().st_size
        if size <= 0 or size > MAX_ASSET_BYTES:
            raise DomainError(
                "resource_pack_invalid",
                f"资源大小必须位于 1 byte 到 {MAX_ASSET_BYTES} bytes：{asset['path']}",
            )
        payload = resolved.read_bytes()
        self._validate_media(payload, asset["mediaType"], asset["path"])
        return ScannedAsset(
            asset_id=asset["id"],
            kind=asset["kind"],
            relative_path=asset["path"],
            media_type=asset["mediaType"],
            alt=asset.get("alt", ""),
            source=resolved,
            size_bytes=size,
            digest=hashlib.sha256(payload).hexdigest(),
        )

    @classmethod
    def _normalize_manifest(cls, value: Any) -> dict[str, Any]:
        if not isinstance(value, dict) or set(value) - TOP_LEVEL_KEYS:
            raise DomainError("resource_pack_invalid", "资源包 manifest 字段无效")
        required = {"schemaVersion", "id", "name", "version", "license", "assets"}
        if not required.issubset(value) or type(value.get("schemaVersion")) is not int:
            raise DomainError("resource_pack_invalid", "资源包 manifest 缺少必填字段")
        if value["schemaVersion"] != 1:
            raise DomainError("resource_pack_invalid", "不支持的资源包 schemaVersion")
        pack_id = cls._string(value.get("id"), 120, "id")
        if not PACK_ID_PATTERN.fullmatch(pack_id):
            raise DomainError("resource_pack_invalid", "资源包 id 格式无效")
        name = cls._string(value.get("name"), 80, "name")
        version = cls._string(value.get("version"), 80, "version")
        if not VERSION_PATTERN.fullmatch(version):
            raise DomainError("resource_pack_invalid", "资源包 version 格式无效")
        description = cls._string(value.get("description", ""), 500, "description", False)
        license_value = value.get("license")
        if not isinstance(license_value, dict) or set(license_value) - LICENSE_KEYS:
            raise DomainError("resource_pack_invalid", "资源包 license 字段无效")
        if not {"name", "source", "redistributionAllowed"}.issubset(license_value):
            raise DomainError("resource_pack_invalid", "资源包缺少授权信息")
        if type(license_value.get("redistributionAllowed")) is not bool:
            raise DomainError("resource_pack_invalid", "redistributionAllowed 必须是 boolean")
        license_info = {
            "name": cls._string(license_value.get("name"), 120, "license.name"),
            "source": cls._string(license_value.get("source"), 240, "license.source"),
            "redistributionAllowed": license_value["redistributionAllowed"],
        }
        for field, limit in (("url", 500), ("attribution", 500)):
            if field in license_value:
                license_info[field] = cls._string(
                    license_value[field],
                    limit,
                    f"license.{field}",
                    False,
                )
        raw_assets = value.get("assets")
        if not isinstance(raw_assets, list) or len(raw_assets) > MAX_ASSETS:
            raise DomainError("resource_pack_invalid", "资源包 assets 数量无效")
        assets = []
        asset_ids: set[str] = set()
        asset_paths: set[str] = set()
        for index, raw_asset in enumerate(raw_assets):
            if not isinstance(raw_asset, dict) or set(raw_asset) - ASSET_KEYS:
                raise DomainError("resource_pack_invalid", f"assets[{index}] 字段无效")
            if not {"id", "kind", "path", "mediaType"}.issubset(raw_asset):
                raise DomainError("resource_pack_invalid", f"assets[{index}] 缺少必填字段")
            asset_id = cls._string(raw_asset["id"], 120, f"assets[{index}].id")
            kind = cls._string(raw_asset["kind"], 40, f"assets[{index}].kind")
            path = cls._string(raw_asset["path"], 240, f"assets[{index}].path")
            media_type = cls._string(
                raw_asset["mediaType"],
                80,
                f"assets[{index}].mediaType",
            )
            relative = PurePosixPath(path)
            if (
                not ASSET_ID_PATTERN.fullmatch(asset_id)
                or kind not in ALLOWED_KINDS
                or media_type not in ALLOWED_MEDIA_TYPES
                or "\\" in path
                or relative.is_absolute()
                or len(relative.parts) < 2
                or relative.parts[0] != "assets"
                or any(part in {"", ".", ".."} for part in relative.parts)
                or not all(re.fullmatch(r"[A-Za-z0-9._-]+", part) for part in relative.parts)
            ):
                raise DomainError("resource_pack_invalid", f"assets[{index}] 值无效")
            extension = relative.suffix.lower()
            expected_extensions = {
                "image/png": {".png"},
                "image/jpeg": {".jpg", ".jpeg"},
                "image/webp": {".webp"},
                "image/gif": {".gif"},
            }[media_type]
            if extension not in expected_extensions:
                raise DomainError(
                    "resource_pack_invalid",
                    f"assets[{index}] 扩展名与 mediaType 不匹配",
                )
            if asset_id in asset_ids or path in asset_paths:
                raise DomainError("resource_pack_invalid", "资源 asset id 或 path 重复")
            asset_ids.add(asset_id)
            asset_paths.add(path)
            asset = {
                "id": asset_id,
                "kind": kind,
                "path": path,
                "mediaType": media_type,
            }
            if "alt" in raw_asset:
                asset["alt"] = cls._string(
                    raw_asset["alt"],
                    120,
                    f"assets[{index}].alt",
                    False,
                )
            assets.append(asset)
        result = {
            "schemaVersion": 1,
            "id": pack_id,
            "name": name,
            "version": version,
            "license": license_info,
            "assets": assets,
        }
        if description:
            result["description"] = description
        return result

    @staticmethod
    def _string(value: Any, limit: int, field: str, required: bool = True) -> str:
        if not isinstance(value, str):
            raise DomainError("resource_pack_invalid", f"{field} 必须是 string")
        result = value.strip()
        if len(result) > limit or (required and not result):
            raise DomainError("resource_pack_invalid", f"{field} 长度无效")
        return result

    @staticmethod
    def _validate_media(payload: bytes, media_type: str, path: str) -> None:
        valid = False
        if media_type == "image/png":
            valid = ResourcePackManager._valid_png(payload)
        elif media_type == "image/jpeg":
            valid = (
                len(payload) >= 8
                and payload.startswith(b"\xff\xd8\xff")
                and b"\xff\xda" in payload
                and payload.endswith(b"\xff\xd9")
            )
        elif media_type == "image/webp":
            valid = (
                len(payload) >= 20
                and payload[:4] == b"RIFF"
                and payload[8:12] == b"WEBP"
                and struct.unpack("<I", payload[4:8])[0] == len(payload) - 8
                and payload[12:16] in {b"VP8 ", b"VP8L", b"VP8X"}
            )
        elif media_type == "image/gif":
            valid = (
                len(payload) >= 14
                and payload[:6] in {b"GIF87a", b"GIF89a"}
                and payload.endswith(b";")
            )
        if not valid:
            raise DomainError("resource_pack_corrupt", f"资源文件损坏或类型不符：{path}")

    @staticmethod
    def _valid_png(payload: bytes) -> bool:
        if not payload.startswith(b"\x89PNG\r\n\x1a\n"):
            return False
        offset = 8
        seen_ihdr = False
        seen_iend = False
        while offset + 12 <= len(payload):
            length = struct.unpack(">I", payload[offset : offset + 4])[0]
            chunk_type = payload[offset + 4 : offset + 8]
            end = offset + 12 + length
            if end > len(payload):
                return False
            chunk_data = payload[offset + 8 : offset + 8 + length]
            expected_crc = struct.unpack(">I", payload[offset + 8 + length : end])[0]
            actual_crc = zlib.crc32(chunk_type)
            actual_crc = zlib.crc32(chunk_data, actual_crc) & 0xFFFFFFFF
            if expected_crc != actual_crc:
                return False
            if chunk_type == b"IHDR":
                seen_ihdr = offset == 8 and length == 13
            if chunk_type == b"IEND":
                seen_iend = length == 0 and end == len(payload)
                break
            offset = end
        return seen_ihdr and seen_iend

    @staticmethod
    def _summary(pack: ScannedPack) -> dict[str, Any]:
        counts = Counter(asset.kind for asset in pack.assets)
        return {
            "id": pack.manifest["id"],
            "name": pack.manifest["name"],
            "version": pack.manifest["version"],
            "description": pack.manifest.get("description", ""),
            "license": pack.manifest["license"],
            "assetCount": len(pack.assets),
            "totalSizeBytes": pack.installed_size_bytes,
            "kindCounts": dict(counts),
            "contentDigest": pack.content_digest,
        }

    @staticmethod
    def _preview_assets(pack: ScannedPack) -> list[dict[str, Any]]:
        result = []
        for asset in pack.assets:
            if len(result) >= MAX_PREVIEW_ASSETS:
                break
            item = asset.metadata()
            if asset.size_bytes <= MAX_INLINE_BYTES:
                payload = ResourcePackManager._read_verified_asset(asset)
                item["dataUrl"] = (
                    f"data:{asset.media_type};base64,"
                    f"{base64.b64encode(payload).decode('ascii')}"
                )
            result.append(item)
        return result

    @staticmethod
    def _read_verified_asset(asset: ScannedAsset) -> bytes:
        try:
            payload = asset.source.read_bytes()
        except OSError as exc:
            raise DomainError(
                "resource_pack_changed",
                f"资源文件 {asset.relative_path} 在扫描后不可用",
            ) from exc
        if (
            len(payload) != asset.size_bytes
            or hashlib.sha256(payload).hexdigest() != asset.digest
        ):
            raise DomainError(
                "resource_pack_changed",
                f"资源文件 {asset.relative_path} 在扫描后发生变化",
            )
        return payload

    def _card_root(self, card_uid: str) -> Path:
        if not ID_PATTERN.fullmatch(card_uid):
            raise DomainError("invalid_card_uid", "cardUid 格式不安全")
        root = (self.cards_root / card_uid).resolve()
        try:
            root.relative_to(self.cards_root)
        except ValueError as exc:
            raise DomainError("invalid_card_uid", "cardUid 路径越界") from exc
        return root

    def _packs_root(self, card_uid: str) -> Path:
        return self._card_root(card_uid) / "resource-packs"

    def _pack_root(self, card_uid: str, pack_id: str) -> Path:
        root = (self._packs_root(card_uid) / self._pack_id(pack_id)).resolve()
        try:
            root.relative_to(self._packs_root(card_uid).resolve())
        except ValueError as exc:
            raise DomainError("resource_pack_invalid", "资源包路径越界") from exc
        return root

    @staticmethod
    def _pack_id(value: str) -> str:
        if not isinstance(value, str) or not PACK_ID_PATTERN.fullmatch(value):
            raise DomainError("resource_pack_invalid", "资源包 id 格式无效")
        return value

    @classmethod
    def _tree_usage(cls, root: Path, *, reject_links: bool = True) -> int:
        if not os.path.lexists(root):
            return 0
        if is_link_or_reparse(root):
            if reject_links:
                raise DomainError("storage_unsafe", "资源 storage 含符号链接或 junction")
            return 0
        if root.is_file():
            return root.stat().st_size
        total = 0
        for entry in root.iterdir():
            total += cls._tree_usage(entry, reject_links=reject_links)
        return total

    @staticmethod
    def _remove_tree(path: Path) -> None:
        if not os.path.lexists(path):
            return
        if is_link_or_reparse(path):
            try:
                path.unlink()
            except OSError:
                os.rmdir(path)
            return
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink(missing_ok=True)
