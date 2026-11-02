"""Ollama HTTP 클라이언트: 상태, 시작, 모델 받기·변형·삭제 (스펙 3-2, 8장).

Ollama가 없거나 꺼져 있는 것은 오류가 아니라 '상태'다. `status()`는 예외 없이 그대로 알려준다.
"""

import asyncio
import json
import os
import shutil
import subprocess
import sys
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import httpx

from vater_core.api.errors import VaterError
from vater_core.llm.catalog import LocalModel

OLLAMA_URL = "http://localhost:11434"
OLLAMA_V1 = OLLAMA_URL + "/v1"  # OpenAI 호환 주소 (TradingAgents의 ollama 제공자가 쓴다)
VERSION_TIMEOUT = 3.0
REQUEST_TIMEOUT = 30.0


class OllamaError(VaterError):
    def __init__(
        self,
        message: str,
        hint: str | None = None,
        code: str = "OLLAMA_ERROR",
        status: int = 502,
        http_status: int | None = None,
    ) -> None:
        super().__init__(code, message, hint, status)
        self.http_status = http_status  # Ollama가 돌려준 HTTP 상태 (있으면)


def not_running() -> VaterError:
    return VaterError(
        "OLLAMA_NOT_RUNNING",
        "로컬 AI(Ollama)가 실행 중이 아닙니다.",
        hint="설정 > 로컬 AI에서 '시작'을 누르거나 Ollama를 실행하세요.",
        status=503,
    )


@dataclass(frozen=True)
class InstalledModel:
    name: str
    size: int


@dataclass(frozen=True)
class LoadedModel:
    name: str
    size: int
    size_vram: int

    @property
    def offloaded(self) -> bool:
        """일부가 CPU로 넘어갔으면 True. 분석이 매우 느려진다 (S1: 9b on 8GB)."""
        return self.size_vram < self.size


@dataclass(frozen=True)
class OllamaStatus:
    installed: bool
    running: bool
    version: str | None
    models: tuple[InstalledModel, ...]
    loaded: tuple[LoadedModel, ...]


@dataclass(frozen=True)
class PullProgress:
    status: str
    completed: int | None
    total: int | None


class OllamaApi(Protocol):
    """라우트와 분석 엔진이 쓰는 부분. 테스트에서는 가짜로 바꿔 끼운다."""

    async def version(self) -> str | None: ...
    async def status(self) -> OllamaStatus: ...
    async def models(self) -> tuple[InstalledModel, ...]: ...
    async def loaded(self) -> tuple[LoadedModel, ...]: ...
    def pull(self, tag: str) -> AsyncIterator[PullProgress]: ...
    async def create_variant(self, model: LocalModel) -> str: ...
    async def delete(self, name: str, missing_ok: bool = False) -> None: ...
    async def start(self) -> bool: ...
    async def require_model(self, name: str) -> None: ...


def default_exe_candidates() -> list[Path]:
    if sys.platform == "win32":
        local = os.environ.get("LOCALAPPDATA")
        if not local:
            return []
        base = Path(local) / "Programs" / "Ollama"
        return [base / "ollama app.exe", base / "ollama.exe"]
    found = shutil.which("ollama")
    return [Path(found)] if found else []


def _spawn_detached(exe: Path) -> None:
    """트레이 앱(`ollama app.exe`)은 그대로, CLI는 `serve`로 띄운다. Vater가 꺼져도 남는다."""
    args = [str(exe)] if exe.name.lower() == "ollama app.exe" else [str(exe), "serve"]
    flags: int = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(
        subprocess, "CREATE_NO_WINDOW", 0
    )
    subprocess.Popen(  # noqa: S603 (설치 경로의 Ollama 실행 파일만 실행한다)
        args,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=flags,
        start_new_session=True,
    )


def _error_text(body: bytes) -> str:
    try:
        data = json.loads(body)
    except ValueError:
        return body.decode(errors="replace")[:200]
    return str(data.get("error", data)) if isinstance(data, dict) else str(data)[:200]


class OllamaClient:
    def __init__(
        self,
        http: httpx.AsyncClient,
        base_url: str = OLLAMA_URL,
        exe_candidates: Callable[[], list[Path]] = default_exe_candidates,
    ) -> None:
        self._http = http
        self._base = base_url.rstrip("/")
        self._exe_candidates = exe_candidates

    async def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        try:
            r = await self._http.request(
                method, self._base + path, json=body, timeout=REQUEST_TIMEOUT
            )
        except httpx.ConnectError as e:
            raise not_running() from e
        except httpx.HTTPError as e:
            raise OllamaError(f"Ollama 요청 실패: {type(e).__name__}") from e
        if r.status_code >= 400:
            raise OllamaError(f"Ollama 오류: {_error_text(r.content)}", http_status=r.status_code)
        return r.json() if r.content else None

    async def version(self) -> str | None:
        try:
            r = await self._http.get(self._base + "/api/version", timeout=VERSION_TIMEOUT)
            r.raise_for_status()
            return str(r.json()["version"])
        except (httpx.HTTPError, ValueError, KeyError):
            return None

    def _exe(self) -> Path | None:
        return next((p for p in self._exe_candidates() if p.exists()), None)

    async def status(self) -> OllamaStatus:
        version = await self.version()
        if version is None:
            return OllamaStatus(self._exe() is not None, False, None, (), ())
        try:
            models, loaded = await self.models(), await self.loaded()
        except VaterError:  # 확인하는 사이에 꺼짐
            models, loaded = (), ()
        return OllamaStatus(True, True, version, models, loaded)

    async def models(self) -> tuple[InstalledModel, ...]:
        data = await self._request("GET", "/api/tags")
        return tuple(InstalledModel(m["name"], int(m["size"])) for m in data.get("models", []))

    async def loaded(self) -> tuple[LoadedModel, ...]:
        data = await self._request("GET", "/api/ps")
        return tuple(
            LoadedModel(m["name"], int(m["size"]), int(m["size_vram"]))
            for m in data.get("models", [])
        )

    async def pull(self, tag: str) -> AsyncIterator[PullProgress]:
        """진행 상황을 한 줄씩 돌려준다. 끊기면 `OllamaError` (다시 받으면 Ollama가 이어 받는다)."""
        try:
            async with self._http.stream(
                "POST",
                self._base + "/api/pull",
                json={"model": tag, "stream": True},
                timeout=httpx.Timeout(10.0, read=None),
            ) as r:
                if r.status_code >= 400:
                    raise OllamaError(f"모델 받기 실패: {_error_text(await r.aread())}")
                async for line in r.aiter_lines():
                    if not line.strip():
                        continue
                    data = json.loads(line)
                    if "error" in data:
                        raise OllamaError(f"모델 받기 실패: {data['error']}")
                    yield PullProgress(
                        str(data.get("status", "")), data.get("completed"), data.get("total")
                    )
        except httpx.ConnectError as e:
            raise not_running() from e
        except httpx.HTTPError as e:
            raise OllamaError(
                "모델을 받는 중 연결이 끊겼습니다.",
                hint="다시 받기를 누르면 받은 부분부터 이어서 받습니다.",
            ) from e

    async def create_variant(self, model: LocalModel) -> str:
        await self._request(
            "POST",
            "/api/create",
            {
                "model": model.variant,
                "from": model.tag,
                "parameters": {"num_ctx": model.num_ctx},
                "stream": False,
            },
        )
        return model.variant

    async def delete(self, name: str, missing_ok: bool = False) -> None:
        try:
            await self._request("DELETE", "/api/delete", {"model": name})
        except OllamaError as e:
            if not (missing_ok and e.http_status == 404):
                raise

    async def start(
        self,
        spawn: Callable[[Path], None] = _spawn_detached,
        wait_sec: float = 20.0,
        poll_sec: float = 0.5,
    ) -> bool:
        if await self.version() is not None:
            return True
        exe = self._exe()
        if exe is None:
            return False
        spawn(exe)
        deadline = asyncio.get_running_loop().time() + wait_sec
        while asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(poll_sec)
            if await self.version() is not None:
                return True
        return False

    async def require_model(self, name: str) -> None:
        if await self.version() is None:
            raise not_running()
        if name not in {m.name for m in await self.models()}:
            raise VaterError(
                "LLM_LOCAL_MODEL_MISSING",
                f"로컬 모델 '{name}'이 설치되어 있지 않습니다.",
                hint="설정 > 로컬 AI에서 모델을 받으세요.",
                status=409,
            )
