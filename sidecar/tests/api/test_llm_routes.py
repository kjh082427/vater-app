"""LLM 관리 API. Ollama와 GPU 감지는 가짜로 바꿔 끼운다."""

import asyncio
from collections.abc import AsyncIterator, Sequence
from typing import Any

import httpx
import pytest

from vater_core.api.deps import AppDeps
from vater_core.api.events import Subscription
from vater_core.llm.catalog import Catalog, LocalModel, load_catalog
from vater_core.llm.hardware import Gpu, Hardware
from vater_core.llm.ollama import (
    InstalledModel,
    LoadedModel,
    OllamaError,
    OllamaStatus,
    PullProgress,
    not_running,
)
from vater_core.llm.state import LlmState
from vater_core.secrets.names import SecretName
from vater_core.store.settings import SettingsRepo


class FakeOllama:
    def __init__(
        self,
        running: bool = True,
        models: Sequence[str] = (),
        loaded: Sequence[LoadedModel] = (),
        pull_lines: Sequence[PullProgress] = (),
        pull_error: Exception | None = None,
        gate: asyncio.Event | None = None,
    ) -> None:
        self.running = running
        self._models = tuple(InstalledModel(m, 1) for m in models)
        self._loaded = tuple(loaded)
        self._lines = list(pull_lines)
        self._error = pull_error
        self._gate = gate
        self.calls: list[tuple[str, str]] = []

    async def version(self) -> str | None:
        await asyncio.sleep(0)  # 실제 클라이언트처럼 HTTP 왕복 동안 다른 요청이 끼어들 수 있다
        return "0.40.13" if self.running else None

    async def status(self) -> OllamaStatus:
        if not self.running:
            return OllamaStatus(False, False, None, (), ())
        return OllamaStatus(True, True, "0.40.13", self._models, self._loaded)

    async def models(self) -> tuple[InstalledModel, ...]:
        if not self.running:
            raise not_running()
        return self._models

    async def loaded(self) -> tuple[LoadedModel, ...]:
        return self._loaded

    async def pull(self, tag: str) -> AsyncIterator[PullProgress]:
        self.calls.append(("pull", tag))
        if self._gate is not None:
            await self._gate.wait()
        for line in self._lines:
            yield line
        if self._error is not None:
            raise self._error

    async def create_variant(self, model: LocalModel) -> str:
        self.calls.append(("create", model.variant))
        return model.variant

    async def delete(self, name: str, missing_ok: bool = False) -> None:
        self.calls.append(("delete", name))

    async def start(self) -> bool:
        return self.running

    async def require_model(self, name: str) -> None:
        if not self.running:
            raise not_running()
        if name not in {m.name for m in self._models}:
            from vater_core.api.errors import VaterError

            raise VaterError("LLM_LOCAL_MODEL_MISSING", "missing", status=409)


LINES = [
    PullProgress("pulling manifest", None, None),
    PullProgress("pulling abc", 10, 100),
    PullProgress("pulling abc", 10, 100),  # 같은 진행률은 다시 보내지 않는다
    PullProgress("pulling abc", 100, 100),
    PullProgress("success", None, None),
]


def install(deps: AppDeps, ollama: FakeOllama, gpus: tuple[Gpu, ...] = ()) -> list[int]:
    detected: list[int] = []

    def detect(catalog: Catalog) -> Hardware:
        detected.append(1)
        best = max((g.vram_mb for g in gpus), default=None)
        return Hardware(gpus, 16384, catalog.tier_for_vram(best).id)

    deps.llm = LlmState(load_catalog(), ollama, detect=detect, platform="linux")
    return detected


async def next_pull_event(sub: Subscription) -> dict[str, Any]:
    while True:
        ev = await asyncio.wait_for(anext(sub), timeout=2)
        if ev.type == "llm.pull":
            return ev.data


async def pull_events_until_end(sub: Subscription) -> list[dict[str, Any]]:
    out = []
    while True:
        data = await next_pull_event(sub)
        out.append(data)
        if data["status"] in ("done", "error"):
            return out


def settings(deps: AppDeps) -> SettingsRepo:
    assert deps.db is not None
    return SettingsRepo(deps.db)


async def test_hardware_route(client: httpx.AsyncClient, deps: AppDeps) -> None:
    detected = install(deps, FakeOllama(), gpus=(Gpu("NVIDIA GeForce RTX 3080 Laptop GPU", 8192),))
    body = (await client.get("/llm/hardware")).json()
    assert body["tier"] == "nvidia_8" and body["ram_mb"] == 16384
    assert body["recommended"]["tag"] == "qwen3.5:4b"
    assert body["recommended"]["variant"] == "qwen3.5:4b-16k"
    assert body["gpus"] == [{"name": "NVIDIA GeForce RTX 3080 Laptop GPU", "vram_mb": 8192}]
    await client.get("/llm/hardware")
    assert len(detected) == 1  # 감지 결과는 캐시한다
    await client.get("/llm/hardware", params={"refresh": "true"})
    assert len(detected) == 2


async def test_hardware_integrated_has_no_recommendation(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    install(deps, FakeOllama())
    body = (await client.get("/llm/hardware")).json()
    assert body["tier"] == "integrated" and body["recommended"] is None
    assert body["default_preset"] == "cloud"


async def test_catalog_route(client: httpx.AsyncClient, deps: AppDeps) -> None:
    install(deps, FakeOllama())
    body = (await client.get("/llm/catalog")).json()
    assert len(body["tiers"]) == 4 and set(body["cloud"]) == {
        "google",
        "anthropic",
        "openai",
        "compat",
    }
    assert body["cloud"]["google"]["secret"] == "LLM_GOOGLE_KEY"


async def test_status_route_not_running(client: httpx.AsyncClient, deps: AppDeps) -> None:
    install(deps, FakeOllama(running=False))
    r = await client.get("/llm/ollama/status")
    assert r.status_code == 200 and r.json()["running"] is False


async def test_status_route_reports_offload(client: httpx.AsyncClient, deps: AppDeps) -> None:
    loaded = [LoadedModel("qwen3.5:9b-16k", 6690000000, 5590000000)]
    install(deps, FakeOllama(models=["qwen3.5:9b-16k"], loaded=loaded))
    body = (await client.get("/llm/ollama/status")).json()
    assert body["loaded"][0]["offloaded"] is True


async def test_start_route(client: httpx.AsyncClient, deps: AppDeps) -> None:
    install(deps, FakeOllama(running=True))
    assert (await client.post("/llm/ollama/start")).json() == {"running": True}


async def test_pull_emits_progress_then_done(client: httpx.AsyncClient, deps: AppDeps) -> None:
    ollama = FakeOllama(pull_lines=LINES)
    install(deps, ollama)
    assert deps.events is not None
    sub = deps.events.subscribe()
    r = await client.post("/llm/models/qwen3.5:4b/pull")
    assert r.status_code == 202 and r.json() == {"started": True, "variant": "qwen3.5:4b-16k"}
    events = await pull_events_until_end(sub)
    assert [(e["status"], e.get("percent")) for e in events] == [
        ("pulling manifest", None),
        ("pulling abc", 10),
        ("pulling abc", 100),
        ("success", None),
        ("done", None),
    ]
    assert events[-1] == {"tag": "qwen3.5:4b", "status": "done", "variant": "qwen3.5:4b-16k"}
    assert ollama.calls == [("pull", "qwen3.5:4b"), ("create", "qwen3.5:4b-16k")]
    assert settings(deps).get("llm.local_model") == "qwen3.5:4b"


async def test_pull_keeps_existing_local_model(client: httpx.AsyncClient, deps: AppDeps) -> None:
    install(deps, FakeOllama(pull_lines=LINES))
    settings(deps).update({"llm.local_model": "qwen3.5:9b"})
    assert deps.events is not None
    sub = deps.events.subscribe()
    await client.post("/llm/models/qwen3.5:4b/pull")
    await pull_events_until_end(sub)
    assert settings(deps).get("llm.local_model") == "qwen3.5:9b"


async def test_pull_error_event_and_retry(client: httpx.AsyncClient, deps: AppDeps) -> None:
    install(deps, FakeOllama(pull_lines=LINES[:2], pull_error=OllamaError("연결이 끊겼습니다.")))
    assert deps.events is not None
    sub = deps.events.subscribe()
    await client.post("/llm/models/qwen3.5:4b/pull")
    last = (await pull_events_until_end(sub))[-1]
    assert last["status"] == "error" and last["code"] == "OLLAMA_ERROR"
    assert settings(deps).get("llm.local_model") == ""
    again = await client.post("/llm/models/qwen3.5:4b/pull")
    assert again.status_code == 202  # 실패한 작업은 목록에서 빠져서 다시 받을 수 있다
    await pull_events_until_end(sub)


async def test_duplicate_pull_conflict(client: httpx.AsyncClient, deps: AppDeps) -> None:
    gate = asyncio.Event()
    install(deps, FakeOllama(pull_lines=LINES, gate=gate))
    assert deps.events is not None
    sub = deps.events.subscribe()
    assert (await client.post("/llm/models/qwen3.5:4b/pull")).status_code == 202
    r = await client.post("/llm/models/qwen3.5:4b/pull")
    assert r.status_code == 409 and r.json()["code"] == "LLM_PULL_IN_PROGRESS"
    gate.set()
    await pull_events_until_end(sub)


async def test_concurrent_pull_requests_start_one_job(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    """리뷰 Important #1: 두 번 눌러도 받기 작업은 하나만 시작한다."""
    gate = asyncio.Event()
    ollama = FakeOllama(pull_lines=LINES, gate=gate)
    install(deps, ollama)
    assert deps.events is not None
    sub = deps.events.subscribe()
    first, second = await asyncio.gather(
        client.post("/llm/models/qwen3.5:4b/pull"), client.post("/llm/models/qwen3.5:4b/pull")
    )
    assert sorted([first.status_code, second.status_code]) == [202, 409]
    gate.set()
    await pull_events_until_end(sub)
    assert ollama.calls.count(("pull", "qwen3.5:4b")) == 1


async def test_pull_slot_released_when_ollama_off(client: httpx.AsyncClient, deps: AppDeps) -> None:
    ollama = FakeOllama(running=False)
    install(deps, ollama)
    assert (await client.post("/llm/models/qwen3.5:4b/pull")).status_code == 503
    ollama.running = True
    assert deps.llm is not None and deps.llm.pulls == set()


async def test_concurrent_install_requests_start_one_job(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    gate = asyncio.Event()
    started: list[int] = []

    async def fake_install(*args: Any) -> None:
        started.append(1)
        await gate.wait()

    install(deps, FakeOllama(running=False))
    assert deps.llm is not None
    deps.llm.platform = "win32"
    deps.llm.install = fake_install
    first, second = await asyncio.gather(
        client.post("/llm/ollama/install"), client.post("/llm/ollama/install")
    )
    assert sorted([first.status_code, second.status_code]) == [202, 409]
    gate.set()
    await asyncio.gather(*deps.llm.tasks)
    assert started == [1] and deps.llm.installing is False


async def test_install_slot_released_when_already_running(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    install(deps, FakeOllama(running=True))
    assert deps.llm is not None
    deps.llm.platform = "win32"
    r = await client.post("/llm/ollama/install")
    assert r.json() == {"started": False} and deps.llm.installing is False


async def test_pull_unknown_tag(client: httpx.AsyncClient, deps: AppDeps) -> None:
    install(deps, FakeOllama())
    r = await client.post("/llm/models/evil:1b/pull")
    assert r.status_code == 404 and r.json()["code"] == "LLM_MODEL_UNKNOWN"


async def test_pull_when_ollama_off(client: httpx.AsyncClient, deps: AppDeps) -> None:
    install(deps, FakeOllama(running=False))
    r = await client.post("/llm/models/qwen3.5:4b/pull")
    assert r.status_code == 503 and r.json()["code"] == "OLLAMA_NOT_RUNNING"


async def test_delete_resets_setting(client: httpx.AsyncClient, deps: AppDeps) -> None:
    ollama = FakeOllama(models=["qwen3.5:4b", "qwen3.5:4b-16k"])
    install(deps, ollama)
    settings(deps).update({"llm.local_model": "qwen3.5:4b"})
    r = await client.delete("/llm/models/qwen3.5:4b")
    assert r.status_code == 204
    assert ollama.calls == [("delete", "qwen3.5:4b-16k"), ("delete", "qwen3.5:4b")]
    assert settings(deps).get("llm.local_model") == ""


async def test_delete_unknown_tag(client: httpx.AsyncClient, deps: AppDeps) -> None:
    install(deps, FakeOllama())
    assert (await client.delete("/llm/models/evil:1b")).status_code == 404


async def test_check_cloud_missing_key(client: httpx.AsyncClient, deps: AppDeps) -> None:
    install(deps, FakeOllama())
    r = await client.get("/llm/check", params={"preset": "cloud"})
    assert r.status_code == 409 and r.json()["code"] == "LLM_KEY_MISSING"


async def test_check_local_not_running(client: httpx.AsyncClient, deps: AppDeps) -> None:
    install(deps, FakeOllama(running=False))
    settings(deps).update({"llm.local_model": "qwen3.5:4b"})
    r = await client.get("/llm/check", params={"preset": "local"})
    assert r.status_code == 503 and r.json()["code"] == "OLLAMA_NOT_RUNNING"


async def test_check_mixed_ok_reports_offload(client: httpx.AsyncClient, deps: AppDeps) -> None:
    loaded = [LoadedModel("qwen3.5:4b-16k", 100, 90)]
    install(deps, FakeOllama(models=["qwen3.5:4b-16k"], loaded=loaded))
    settings(deps).update({"llm.local_model": "qwen3.5:4b"})
    assert deps.secrets is not None
    deps.secrets.set(SecretName.LLM_GOOGLE_KEY, "g-key-123")
    r = await client.get("/llm/check", params={"preset": "mixed"})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["preset"] == "mixed" and body["offloaded"] is True
    assert body["deep"] == {"provider": "google", "model": "gemini-3.8-flash"}
    assert body["quick"] == {"provider": "ollama", "model": "qwen3.5:4b-16k"}
    assert "g-key-123" not in r.text


async def test_check_uses_setting_preset(client: httpx.AsyncClient, deps: AppDeps) -> None:
    install(deps, FakeOllama())
    assert deps.secrets is not None
    deps.secrets.set(SecretName.LLM_GOOGLE_KEY, "g-key-123")
    body = (await client.get("/llm/check")).json()
    assert body["preset"] == "cloud" and body["offloaded"] is None


async def test_install_unsupported_on_linux(client: httpx.AsyncClient, deps: AppDeps) -> None:
    install(deps, FakeOllama(running=False))
    r = await client.post("/llm/ollama/install")
    assert r.status_code == 409 and r.json()["code"] == "OLLAMA_INSTALL_UNSUPPORTED"


async def test_cloud_test_route_missing_key(client: httpx.AsyncClient, deps: AppDeps) -> None:
    install(deps, FakeOllama())
    r = await client.post("/settings/llm/test", params={"provider": "anthropic"})
    assert r.status_code == 409 and r.json()["code"] == "LLM_KEY_MISSING"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/llm/hardware"),
        ("GET", "/llm/catalog"),
        ("GET", "/llm/ollama/status"),
        ("POST", "/llm/ollama/start"),
        ("POST", "/llm/ollama/install"),
        ("POST", "/llm/models/qwen3.5:4b/pull"),
        ("DELETE", "/llm/models/qwen3.5:4b"),
        ("GET", "/llm/check"),
        ("POST", "/settings/llm/test"),
    ],
)
async def test_llm_routes_require_token(
    anon_client: httpx.AsyncClient, deps: AppDeps, method: str, path: str
) -> None:
    install(deps, FakeOllama())
    assert (await anon_client.request(method, path)).status_code == 401
