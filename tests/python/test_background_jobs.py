from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from conftest import character, context

from fantareal_mobile_chat.domain import DomainError
from fantareal_mobile_chat.service import MobileChatService


def background_params(purpose: str, execution_id: str = "execution_a") -> dict[str, Any]:
    job_id = {
        "feed": "auto-feed",
        "forum": "auto-forum",
        "mail": "auto-mail",
        "diary": "auto-diary",
        "calendar": "auto-calendar",
    }[purpose]
    return {
        "purpose": purpose,
        "context": context(),
        "activeCharacter": character(),
        "backgroundExecution": {
            "jobId": job_id,
            "executionId": execution_id,
            "scheduledAt": "2026-07-27T12:00:00Z",
            "binding": context(),
        },
    }


def fresh_service(tmp_path: Path) -> MobileChatService:
    data_root = tmp_path / "data"
    assets_root = tmp_path / "assets"
    workspace_root = tmp_path / "workspace"
    data_root.mkdir()
    assets_root.mkdir()
    workspace_root.mkdir()
    service = MobileChatService()
    service.dispatch(
        "extension.initialize",
        {
            "workspace": str(workspace_root),
            "locale": "zh-CN",
            "permissions": [
                "storage.data",
                "storage.assets",
                "llm.generate",
                "background.jobs",
            ],
            "storage": {
                "paths": {"data": str(data_root), "assets": str(assets_root)},
                "quotas": {
                    "data": 64 * 1024 * 1024,
                    "assets": 64 * 1024 * 1024,
                },
            },
        },
    )
    return service


def test_background_catalog_has_bounded_low_frequency_jobs(service: MobileChatService) -> None:
    jobs = service.dispatch("mobile.background.catalog", {})["jobs"]

    assert [item["purpose"] for item in jobs] == [
        "feed",
        "forum",
        "mail",
        "diary",
        "calendar",
    ]
    assert len({item["jobId"] for item in jobs}) == len(jobs)
    assert all(item["defaultIntervalSeconds"] >= 21_600 for item in jobs)


def test_background_prepare_binds_independent_session_and_reuses_feed_transaction(
    tmp_path: Path,
) -> None:
    service = fresh_service(tmp_path)
    prepared = service.dispatch("mobile.background.prepare", background_params("feed"))
    generation = prepared["generation"]

    assert generation["commitMethod"] == "mobile.background.commit"
    assert generation["abortMethod"] == "mobile.background.abort"
    assert generation["request"]["purpose"] == "mobile-chat.feed"
    operation = service.pending[generation["operationId"]]
    assert operation.background_execution_id == "execution_a"
    assert operation.background_job_id == "auto-feed"
    assert service.store is not None
    assert service.store.active_context is not None
    assert service.store.active_context.to_dict() == context()

    committed = service.dispatch(
        "mobile.background.commit",
        {
            "operationId": generation["operationId"],
            "executionId": "execution_a",
            "jobId": "auto-feed",
            "result": {
                "content": json.dumps(
                    {
                        "posts": [
                            {
                                "content": "雨停以后，窗台像重新亮了一次。",
                                "mood": "calm",
                            }
                        ]
                    },
                    ensure_ascii=False,
                )
            },
        },
    )

    assert committed["purpose"] == "feed"
    assert committed["posts"][0]["authorId"] == "card_a"
    assert committed["posts"][0]["source"] == "model"
    assert committed["notifications"][0]["sourceId"] == committed["posts"][0]["postId"]
    assert generation["operationId"] not in service.pending
    assert not list(service.store.data_root.rglob("*.tmp"))


def test_background_rejects_stale_binding_and_late_execution(tmp_path: Path) -> None:
    service = fresh_service(tmp_path)
    stale = background_params("diary")
    stale["backgroundExecution"]["binding"] = context(revision="revision_b")
    with pytest.raises(DomainError, match="绑定角色") as binding_error:
        service.dispatch("mobile.background.prepare", stale)
    assert binding_error.value.code == "context_stale"

    prepared = service.dispatch("mobile.background.prepare", background_params("diary"))
    generation = prepared["generation"]
    with pytest.raises(DomainError, match="execution") as execution_error:
        service.dispatch(
            "mobile.background.commit",
            {
                "operationId": generation["operationId"],
                "executionId": "execution_late",
                "jobId": "auto-diary",
                "result": {"content": "{}"},
            },
        )
    assert execution_error.value.code == "context_stale"
    assert generation["operationId"] in service.pending


def test_background_abort_reuses_existing_atomic_abort(tmp_path: Path) -> None:
    service = fresh_service(tmp_path)
    prepared = service.dispatch("mobile.background.prepare", background_params("mail"))
    generation = prepared["generation"]

    aborted = service.dispatch(
        "mobile.background.abort",
        {
            "operationId": generation["operationId"],
            "executionId": "execution_a",
            "jobId": "auto-mail",
            "error": {"code": "llm_timeout", "message": "timeout"},
        },
    )

    assert aborted == {"purpose": "mail", "ok": True, "reason": "timeout"}
    assert generation["operationId"] not in service.pending
    assert service.store is not None
    assert service.store.list_mail_threads(context()) == []
