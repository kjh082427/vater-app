"""LLM 관리 상태: 진행 중인 모델 받기·설치 작업, 하드웨어 감지 캐시.

`AppDeps.llm`에 하나만 둔다. 백그라운드 작업은 이벤트 루프에서 돌고(SQLite 쓰기도 루프에서만),
참조를 `tasks`에 잡아 두어 중간에 사라지지 않게 한다.
"""

import asyncio
import logging
import sys
from collections.abc import Awaitable, Callable, Coroutine
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from vater_core.api.deps import AppDeps
from vater_core.api.events import EventBus
from vater_core.llm.catalog import Catalog, load_catalog
from vater_core.llm.hardware import Hardware, detect_hardware
from vater_core.llm.install import VersionSource, install_ollama
from vater_core.llm.ollama import OllamaApi, OllamaClient

logger = logging.getLogger(__name__)
HTTP_TIMEOUT = 15.0

InstallFn = Callable[[httpx.AsyncClient, VersionSource, EventBus, Path], Awaitable[None]]


@dataclass
class LlmState:
    catalog: Catalog
    ollama: OllamaApi
    detect: Callable[[Catalog], Hardware] = detect_hardware
    install: InstallFn = install_ollama
    platform: str = sys.platform
    pulls: set[str] = field(default_factory=set)
    installing: bool = False
    hardware: Hardware | None = None
    tasks: set[asyncio.Task[None]] = field(default_factory=set)

    def spawn(self, job: Coroutine[Any, Any, None]) -> None:
        task = asyncio.create_task(job)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)


def http_client(deps: AppDeps) -> httpx.AsyncClient:
    if deps.http is None:
        deps.http = httpx.AsyncClient(timeout=HTTP_TIMEOUT)
    return deps.http


def get_llm(deps: AppDeps) -> LlmState:
    if deps.llm is None:
        deps.llm = LlmState(load_catalog(), OllamaClient(http_client(deps)))
    return deps.llm
