"""Build and audit a deterministic Fantareal Mobile Chat Extension bundle."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import stat
import tomllib
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROOT_FILES = (
    "CHANGELOG.md",
    "README.md",
    "fantareal-extension.json",
    "pyproject.toml",
    "uv.lock",
)
SOURCE_DIRECTORIES = ("docs", "resources", "schemas", "src", "web")
FORBIDDEN_NAMES = {
    ".env",
    "conversations.json",
    "current_role_card.json",
    "settings.json",
}
MAX_SOURCE_FILE_SIZE = 1024 * 1024
FIXED_ZIP_TIMESTAMP = (2026, 1, 1, 0, 0, 0)


def pep440_version(version: str) -> str:
    match = re.fullmatch(
        r"(?P<base>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)"
        r"(?:-(?P<label>rc|dev)\.(?P<number>0|[1-9]\d*))?",
        version,
    )
    if match is None:
        raise ValueError(f"unsupported Extension version: {version}")
    base = f"{match['base']}.{match['minor']}.{match['patch']}"
    if match["label"] == "rc":
        return f"{base}rc{match['number']}"
    if match["label"] == "dev":
        return f"{base}.dev{match['number']}"
    return base


def declared_version() -> tuple[str, str]:
    manifest = json.loads((ROOT / "fantareal-extension.json").read_text(encoding="utf-8"))
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    init_source = (ROOT / "src/fantareal_mobile_chat/__init__.py").read_text(
        encoding="utf-8"
    )
    service_source = (ROOT / "src/fantareal_mobile_chat/service.py").read_text(
        encoding="utf-8"
    )

    extension_version = manifest["version"]
    python_version = pep440_version(extension_version)
    init_match = re.search(r'^__version__ = "([^"]+)"$', init_source, re.MULTILINE)
    service_match = re.search(r'"version": "([^"]+)"', service_source)
    actual = {
        "package.json": package["version"],
        "pyproject.toml": pyproject["project"]["version"],
        "__init__.py": init_match.group(1) if init_match else "",
        "service.py": service_match.group(1) if service_match else "",
    }
    expected = {
        "package.json": extension_version,
        "pyproject.toml": python_version,
        "__init__.py": python_version,
        "service.py": python_version,
    }
    mismatches = [
        f"{name}: expected {expected[name]}, got {value}"
        for name, value in actual.items()
        if value != expected[name]
    ]
    if mismatches:
        raise ValueError("version mismatch: " + "; ".join(mismatches))
    return extension_version, python_version


def bundle_files() -> list[Path]:
    candidates = [ROOT / name for name in ROOT_FILES]
    for directory in SOURCE_DIRECTORIES:
        candidates.extend(path for path in (ROOT / directory).rglob("*") if path.is_file())

    files: list[Path] = []
    for path in sorted(candidates, key=lambda item: item.as_posix()):
        relative = path.relative_to(ROOT)
        if "__pycache__" in relative.parts or path.suffix.lower() in {".pyc", ".pyo"}:
            continue
        if path.is_symlink():
            raise ValueError(f"bundle source may not be a link: {relative.as_posix()}")
        if path.name in FORBIDDEN_NAMES:
            raise ValueError(f"private runtime file is forbidden: {relative.as_posix()}")
        if path.stat().st_size > MAX_SOURCE_FILE_SIZE:
            raise ValueError(f"bundle source exceeds 1 MiB: {relative.as_posix()}")
        files.append(path)

    required = {
        "fantareal-extension.json",
        "src/fantareal_mobile_chat/service.py",
        "uv.lock",
        "web/index.html",
    }
    present = {path.relative_to(ROOT).as_posix() for path in files}
    missing = sorted(required - present)
    if missing:
        raise ValueError(f"bundle is missing required files: {', '.join(missing)}")
    return files


def write_bundle(output_directory: Path) -> tuple[Path, Path]:
    version, _ = declared_version()
    files = bundle_files()
    output_directory.mkdir(parents=True, exist_ok=True)
    archive = output_directory / f"Fantareal-Mobile-Chat-{version}.zip"
    checksum = output_directory / f"Fantareal-Mobile-Chat-{version}.sha256"
    prefix = f"Fantareal-Mobile-Chat-{version}"

    archive.unlink(missing_ok=True)
    checksum.unlink(missing_ok=True)
    with zipfile.ZipFile(
        archive,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as bundle:
        for source in files:
            relative = source.relative_to(ROOT).as_posix()
            info = zipfile.ZipInfo(f"{prefix}/{relative}", FIXED_ZIP_TIMESTAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            bundle.writestr(info, source.read_bytes(), compresslevel=9)

    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    checksum.write_text(f"{digest}  {archive.name}\n", encoding="ascii", newline="\n")
    return archive, checksum


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Build the deterministic Extension archive into this directory.",
    )
    args = parser.parse_args()

    extension_version, python_version = declared_version()
    files = bundle_files()
    print(
        f"release audit ok: extension={extension_version} "
        f"python={python_version} files={len(files)}"
    )
    if args.output_dir is not None:
        archive, checksum = write_bundle(args.output_dir.resolve())
        print(f"archive={archive}")
        print(f"checksum={checksum}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
