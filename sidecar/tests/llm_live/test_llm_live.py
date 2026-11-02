"""실제 GPU·Ollama·클라우드 키로 확인한다.

기본 실행에서 제외된다: `uv run pytest -m llm tests/llm_live -q -s`

- 키는 저장소 루트 `.env`에서 **읽기만** 한다(이 테스트는 비밀키를 쓰지 않는다).
- Ollama나 키가 없으면 해당 테스트는 건너뛴다(실패가 아니다).
"""

from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest

from vater_core.api.app import create_app
from vater_core.api.deps import AppDeps
from vater_core.api.events import EventBus
from vater_core.llm.catalog import load_catalog
from vater_core.llm.cloud import check_cloud_key
from vater_core.llm.hardware import detect_hardware
from vater_core.llm.ollama import OllamaClient
from vater_core.secrets.names import SecretName
from vater_core.secrets.store import EnvFileSecretStore
from vater_core.store.db import open_db
from vater_core.store.settings import SettingsRepo

pytestmark = pytest.mark.llm

ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"
MODEL = "qwen3.5:4b"


@pytest.fixture
async def http() -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient() as c:
        yield c


async def require_ollama(http: httpx.AsyncClient) -> OllamaClient:
    client = OllamaClient(http)
    if await client.version() is None:
        pytest.skip("Ollama is not running")
    return client


def google_key() -> EnvFileSecretStore:
    store = EnvFileSecretStore(ROOT_ENV)
    if not store.get(SecretName.LLM_GOOGLE_KEY):
        pytest.skip("LLM_GOOGLE_KEY is not set in the root .env")
    return store


def test_live_hardware() -> None:
    hw = detect_hardware(load_catalog())
    print(hw)
    assert hw.best_gpu is not None and "RTX" in hw.best_gpu.name
    assert hw.tier == "nvidia_8" and (hw.ram_mb or 0) > 0


async def test_live_ollama_status(http: httpx.AsyncClient) -> None:
    status = await (await require_ollama(http)).status()
    print(status.version, [m.name for m in status.models])
    assert status.running and MODEL in {m.name for m in status.models}


async def test_live_create_variant_idempotent(http: httpx.AsyncClient) -> None:
    client = await require_ollama(http)
    model = load_catalog().local(MODEL)
    assert await client.create_variant(model) == "qwen3.5:4b-16k"
    await client.require_model("qwen3.5:4b-16k")


async def test_live_google_key(http: httpx.AsyncClient) -> None:
    result = await check_cloud_key(http, load_catalog().cloud["google"], google_key())
    print(result)
    assert result.ok and result.defaults_available


async def test_live_check_mixed(http: httpx.AsyncClient, tmp_path: Path) -> None:
    await require_ollama(http)
    deps = AppDeps(
        token="t",
        dev=False,
        data_dir=tmp_path,
        db=open_db(tmp_path),
        secrets=google_key(),
        events=EventBus(),
        http=http,
    )
    assert deps.db is not None
    SettingsRepo(deps.db).update({"llm.local_model": MODEL})
    transport = httpx.ASGITransport(app=create_app(deps))
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test", headers={"Authorization": "Bearer t"}
    ) as c:
        r = await c.get("/llm/check", params={"preset": "mixed"})
    print(r.json())
    assert r.status_code == 200
    assert r.json()["quick"] == {"provider": "ollama", "model": "qwen3.5:4b-16k"}
