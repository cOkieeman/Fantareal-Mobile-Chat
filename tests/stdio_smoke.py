from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path


def request(request_id: int, method: str, params: dict[str, object]) -> str:
    return json.dumps(
        {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="fantareal-mc-stdio-") as temporary:
        root = Path(temporary)
        data = root / "data"
        workspace = root / "workspace"
        data.mkdir()
        workspace.mkdir()
        payload = "\n".join(
            [
                request(
                    1,
                    "extension.initialize",
                    {
                        "storage": {"paths": {"data": str(data)}},
                        "workspace": str(workspace),
                        "permissions": ["storage.data"],
                        "locale": "zh-CN",
                    },
                ),
                request(2, "extension.health", {}),
                request(3, "extension.shutdown", {}),
                "",
            ]
        )
        completed = subprocess.run(
            [
                sys.executable,
                "-I",
                "-X",
                "utf8",
                "-m",
                "fantareal_mobile_chat.service",
            ],
            input=payload,
            capture_output=True,
            check=False,
            encoding="utf-8",
            timeout=15,
        )
        if completed.returncode != 0:
            raise SystemExit(completed.stderr or f"service exited with {completed.returncode}")
        responses = [json.loads(line) for line in completed.stdout.splitlines() if line.strip()]
        if [item.get("id") for item in responses] != [1, 2, 3]:
            raise SystemExit(f"unexpected response ids: {responses!r}")
        if responses[0].get("result") != {"ok": True, "locale": "zh-CN"}:
            raise SystemExit(f"initialize failed: {responses[0]!r}")
        health = responses[1].get("result")
        if not isinstance(health, dict) or health.get("ok") is not True:
            raise SystemExit(f"health failed: {responses[1]!r}")
        if responses[2].get("result") != {"ok": True}:
            raise SystemExit(f"shutdown failed: {responses[2]!r}")


if __name__ == "__main__":
    main()
