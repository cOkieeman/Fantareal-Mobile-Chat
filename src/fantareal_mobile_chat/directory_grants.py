from __future__ import annotations

import json
import os
import re
import stat
from dataclasses import dataclass
from pathlib import Path

from .domain import DomainError

TOKEN_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


@dataclass(frozen=True, slots=True)
class DirectoryGrant:
    token: str
    root: Path
    name: str


def is_link_or_reparse(path: Path) -> bool:
    try:
        info = os.lstat(path)
    except OSError:
        return True
    attributes = getattr(info, "st_file_attributes", 0)
    return stat.S_ISLNK(info.st_mode) or bool(
        attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    )


def resolve_directory_grant(workspace_root: Path, token: str) -> DirectoryGrant:
    if not TOKEN_PATTERN.fullmatch(token):
        raise DomainError("invalid_grant", "directoryToken 格式无效")
    grant_path = workspace_root / "input-directory-grants" / f"{token}.json"
    if is_link_or_reparse(grant_path):
        raise DomainError("invalid_grant", "目录授权记录不存在或不安全")
    try:
        grant = json.loads(grant_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DomainError("invalid_grant", "目录授权不存在或无效") from exc
    if (
        not isinstance(grant, dict)
        or set(grant) != {"kind", "schemaVersion", "token", "path", "name", "readOnly"}
        or grant.get("kind") != "fantareal.directory-grant"
        or grant.get("schemaVersion") != 1
        or grant.get("token") != token
        or grant.get("readOnly") is not True
        or not isinstance(grant.get("path"), str)
        or not isinstance(grant.get("name"), str)
    ):
        raise DomainError("invalid_grant", "目录授权不存在或无效")
    selected = Path(grant["path"])
    if is_link_or_reparse(selected):
        raise DomainError("invalid_grant", "授权目录不能是符号链接或 junction")
    try:
        resolved = selected.resolve(strict=True)
    except OSError as exc:
        raise DomainError("invalid_grant", "授权目录已不可用") from exc
    if not resolved.is_dir():
        raise DomainError("invalid_grant", "授权目录已不可用")
    return DirectoryGrant(token=token, root=resolved, name=grant["name"][:240])
