from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
import respx

from vater_core.api.errors import VaterError
from vater_core.llm.catalog import load_catalog
from vater_core.llm.cloud import check_cloud_key as cloud_key_test
from vater_core.secrets.names import SecretName
from vater_core.secrets.store import EnvFileSecretStore

GOOGLE = "https://generativelanguage.googleapis.com/v1beta/models"
ANTHROPIC = "https://api.anthropic.com/v1/models"
OPENAI = "https://api.openai.com/v1/models"
SECRET = "sk-test-SECRET-value"


@pytest.fixture
async def http() -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient() as c:
        yield c


def secrets(tmp_path: Path, **values: str) -> EnvFileSecretStore:
    s = EnvFileSecretStore(tmp_path / ".env")
    for name, value in values.items():
        s.set(SecretName(name), value)
    return s


@respx.mock
async def test_google_request_shape(http: httpx.AsyncClient, tmp_path: Path) -> None:
    route = respx.get(GOOGLE).respond(
        json={
            "models": [
                {"name": "models/gemini-3.8-flash"},
                {"name": "models/gemini-3.5-flash-lite"},
            ]
        }
    )
    provider = load_catalog().cloud["google"]
    result = await cloud_key_test(http, provider, secrets(tmp_path, LLM_GOOGLE_KEY=SECRET))
    assert (result.ok, result.model_count, result.defaults_available) == (True, 2, True)
    request = route.calls[0].request
    assert SECRET not in str(request.url)
    assert request.headers["x-goog-api-key"] == SECRET


@respx.mock
async def test_anthropic_headers(http: httpx.AsyncClient, tmp_path: Path) -> None:
    route = respx.get(url__startswith=ANTHROPIC).respond(
        json={"data": [{"id": "claude-sonnet-5-5"}, {"id": "claude-haiku-5-5"}]}
    )
    provider = load_catalog().cloud["anthropic"]
    result = await cloud_key_test(http, provider, secrets(tmp_path, LLM_ANTHROPIC_KEY=SECRET))
    assert result.ok and result.defaults_available
    headers = route.calls[0].request.headers
    assert headers["x-api-key"] == SECRET and headers["anthropic-version"] == "2023-06-01"


@respx.mock
async def test_openai_missing_default(http: httpx.AsyncClient, tmp_path: Path) -> None:
    route = respx.get(OPENAI).respond(json={"data": [{"id": "gpt-6-luna"}]})
    provider = load_catalog().cloud["openai"]
    result = await cloud_key_test(http, provider, secrets(tmp_path, LLM_OPENAI_KEY=SECRET))
    assert (result.ok, result.defaults_available) == (True, False)
    assert route.calls[0].request.headers["authorization"] == f"Bearer {SECRET}"


@respx.mock
async def test_compat_uses_base_url(http: httpx.AsyncClient, tmp_path: Path) -> None:
    route = respx.get("https://llm.example/v1/models").respond(json={"data": [{"id": "m"}]})
    provider = load_catalog().cloud["compat"]
    store = secrets(tmp_path, LLM_COMPAT_KEY=SECRET, LLM_COMPAT_BASE_URL="https://llm.example/v1/")
    result = await cloud_key_test(http, provider, store)
    assert result.ok and result.defaults_available and route.called


async def expect_error(http: httpx.AsyncClient, tmp_path: Path, code: str) -> VaterError:
    provider = load_catalog().cloud["openai"]
    with pytest.raises(VaterError) as e:
        await cloud_key_test(http, provider, secrets(tmp_path, LLM_OPENAI_KEY=SECRET))
    assert e.value.code == code
    assert SECRET not in e.value.message and SECRET not in (e.value.hint or "")
    return e.value


@respx.mock
async def test_invalid_key(http: httpx.AsyncClient, tmp_path: Path) -> None:
    respx.get(OPENAI).respond(401, json={"error": {"message": f"Incorrect API key {SECRET}"}})
    assert (await expect_error(http, tmp_path, "LLM_KEY_INVALID")).status == 400


GOOGLE_BAD_KEY = {
    "error": {
        "code": 400,
        "message": "API key not valid. Please pass a valid API key.",
        "status": "INVALID_ARGUMENT",
        "details": [
            {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                "reason": "API_KEY_INVALID",
                "domain": "googleapis.com",
                "metadata": {"service": "generativelanguage.googleapis.com"},
            }
        ],
    }
}


@respx.mock
async def test_google_invalid_key_is_400(http: httpx.AsyncClient, tmp_path: Path) -> None:
    """리뷰 Important #2: Google은 틀린 키에 401이 아니라 400 API_KEY_INVALID를 준다."""
    respx.get(GOOGLE).respond(400, json=GOOGLE_BAD_KEY)
    provider = load_catalog().cloud["google"]
    with pytest.raises(VaterError) as e:
        await cloud_key_test(http, provider, secrets(tmp_path, LLM_GOOGLE_KEY=SECRET))
    assert (e.value.code, e.value.status) == ("LLM_KEY_INVALID", 400)


@respx.mock
async def test_google_other_400_is_unreachable(http: httpx.AsyncClient, tmp_path: Path) -> None:
    respx.get(GOOGLE).respond(400, text="<html>bad request</html>")
    provider = load_catalog().cloud["google"]
    with pytest.raises(VaterError) as e:
        await cloud_key_test(http, provider, secrets(tmp_path, LLM_GOOGLE_KEY=SECRET))
    assert e.value.code == "LLM_UNREACHABLE"


@respx.mock
async def test_unreachable(http: httpx.AsyncClient, tmp_path: Path) -> None:
    respx.get(OPENAI).mock(side_effect=httpx.ConnectError("no route"))
    assert (await expect_error(http, tmp_path, "LLM_UNREACHABLE")).status == 503


@respx.mock
async def test_server_error_is_unreachable(http: httpx.AsyncClient, tmp_path: Path) -> None:
    respx.get(OPENAI).respond(503, text="maintenance")
    await expect_error(http, tmp_path, "LLM_UNREACHABLE")


async def test_missing_key(http: httpx.AsyncClient, tmp_path: Path) -> None:
    provider = load_catalog().cloud["google"]
    with pytest.raises(VaterError) as e:
        await cloud_key_test(http, provider, secrets(tmp_path))
    assert (e.value.code, e.value.status) == ("LLM_KEY_MISSING", 409)
