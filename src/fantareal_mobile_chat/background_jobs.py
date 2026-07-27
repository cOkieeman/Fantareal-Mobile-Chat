from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .domain import DomainError, mapping, text


@dataclass(frozen=True, slots=True)
class BackgroundJobSpec:
    purpose: str
    job_id: str
    title: str
    description: str
    default_interval_seconds: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "purpose": self.purpose,
            "jobId": self.job_id,
            "title": self.title,
            "description": self.description,
            "defaultIntervalSeconds": self.default_interval_seconds,
        }


BACKGROUND_JOB_SPECS = (
    BackgroundJobSpec(
        "feed",
        "auto-feed",
        "角色动态",
        "低频生成一条角色动态，并写入对应通知。",
        21_600,
    ),
    BackgroundJobSpec(
        "forum",
        "auto-forum",
        "论坛主题",
        "低频生成一个角色论坛主题，并写入对应通知。",
        43_200,
    ),
    BackgroundJobSpec(
        "mail",
        "auto-mail",
        "角色来信",
        "低频生成一封角色来信，并写入对应通知。",
        43_200,
    ),
    BackgroundJobSpec(
        "diary",
        "auto-diary",
        "角色日记",
        "低频生成一篇角色日记，并写入对应通知。",
        86_400,
    ),
    BackgroundJobSpec(
        "calendar",
        "auto-calendar",
        "角色日程",
        "低频生成一条角色日程，并写入对应通知。",
        86_400,
    ),
)
BACKGROUND_JOB_BY_PURPOSE = {item.purpose: item for item in BACKGROUND_JOB_SPECS}


def background_catalog() -> list[dict[str, Any]]:
    return [item.to_dict() for item in BACKGROUND_JOB_SPECS]


def background_spec(value: Any) -> BackgroundJobSpec:
    purpose = text(value, 40, required=True, field="purpose").lower()
    spec = BACKGROUND_JOB_BY_PURPOSE.get(purpose)
    if spec is None:
        raise DomainError("invalid_generation_purpose", "不支持的后台生成 purpose")
    return spec


def background_execution(value: Any) -> tuple[str, str, dict[str, Any]]:
    source = mapping(value, field="backgroundExecution")
    execution_id = text(
        source.get("executionId"),
        160,
        required=True,
        field="backgroundExecution.executionId",
    )
    job_id = text(
        source.get("jobId"),
        80,
        required=True,
        field="backgroundExecution.jobId",
    )
    binding = mapping(source.get("binding"), field="backgroundExecution.binding")
    return execution_id, job_id, binding
