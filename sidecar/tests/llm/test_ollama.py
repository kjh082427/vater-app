"""Ollama 클라이언트. 응답 본문은 실제 Ollama 0.40.13(2026-11-03)의 형식이다."""

import json
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
import respx

from vater_core.api.errors import VaterError
from vater_core.llm.catalog import load_catalog
from vater_core.llm.ollama import (
    OLLAMA_URL,
    InstalledModel,
    LoadedModel,
    OllamaClient,
    OllamaError,
    PullProgress,
)

TAGS = {
    "models": [
        {"name": "qwen3.5:4b", "model": "qwen3.5:4b", "size": 3317000000, "details": {}},
        {"name": "qwen3.5:4b-16k", "model": "qwen3.5:4b-16k", "size": 3317000000, "details": {}},
    ]
}
PS = {
    "models": [
        {
            "name": "qwen3.5:4b-16k",
            "model": "qwen3.5:4b-16k",
            "size": 3650124512,
            "size_vram": 3650124512,
            "context_length": 16384,
        }
    ]
}


def ndjson(*lines: dict[str, object]) -> bytes:
    return b"".join(json.dumps(line).encode() + b"\n" for line in lines)


class CutStream(httpx.AsyncByteStream):
    """몇 줄을 보낸 뒤 연결이 끊기는 스트림."""

    def __init__(self, data: bytes) -> None:
        self._data = data

    async def __aiter__(self) -> AsyncIterator[bytes]:
        yield self._data
        raise httpx.ReadError("connection reset")


def no_exe() -> list[Path]:
    return []


@pytest.fixture
async def http() -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient() as c:
        yield c


@respx.mock
async def test_status_when_not_running(http: httpx.AsyncClient, tmp_path: Path) -> None:
    respx.route(host="localhost").mock(side_effect=httpx.ConnectError("refused"))
    status = await OllamaClient(http, exe_candidates=no_exe).status()
    assert (status.installed, status.running, status.version) == (False, False, None)
    assert status.models == () and status.loaded == ()

    exe = tmp_path / "ollama.exe"
    exe.write_bytes(b"")
    installed = await OllamaClient(http, exe_candidates=lambda: [exe]).status()
    assert installed.installed is True and installed.running is False


@respx.mock
async def test_status_running(http: httpx.AsyncClient) -> None:
    respx.get(f"{OLLAMA_URL}/api/version").respond(json={"version": "0.40.13"})
    respx.get(f"{OLLAMA_URL}/api/tags").respond(json=TAGS)
    respx.get(f"{OLLAMA_URL}/api/ps").respond(json=PS)
    status = await OllamaClient(http, exe_candidates=no_exe).status()
    assert status.installed and status.running and status.version == "0.40.13"
    assert status.models == (
        InstalledModel("qwen3.5:4b", 3317000000),
        InstalledModel("qwen3.5:4b-16k", 3317000000),
    )
    assert status.loaded == (LoadedModel("qwen3.5:4b-16k", 3650124512, 3650124512),)


def test_offloaded() -> None:
    assert LoadedModel("qwen3.5:9b-16k", 6690000000, 5590000000).offloaded is True
    assert LoadedModel("qwen3.5:4b-16k", 3650124512, 3650124512).offloaded is False


@respx.mock
async def test_pull_streams_progress(http: httpx.AsyncClient) -> None:
    route = respx.post(f"{OLLAMA_URL}/api/pull").respond(
        content=ndjson(
            {"status": "pulling manifest"},
            {"status": "pulling abc", "digest": "sha256:abc", "total": 100, "completed": 40},
            {"status": "verifying sha256 digest"},
            {"status": "success"},
        )
    )
    got = [p async for p in OllamaClient(http).pull("qwen3.5:4b")]
    assert got == [
        PullProgress("pulling manifest", None, None),
        PullProgress("pulling abc", 40, 100),
        PullProgress("verifying sha256 digest", None, None),
        PullProgress("success", None, None),
    ]
    assert json.loads(route.calls[0].request.content) == {"model": "qwen3.5:4b", "stream": True}


@respx.mock
async def test_pull_error_line_raises(http: httpx.AsyncClient) -> None:
    respx.post(f"{OLLAMA_URL}/api/pull").respond(
        content=ndjson(
            {"status": "pulling manifest"},
            {"error": "pull model manifest: file does not exist"},
        )
    )
    with pytest.raises(OllamaError) as e:
        _ = [p async for p in OllamaClient(http).pull("qwen3.5:4b")]
    assert "file does not exist" in e.value.message


@respx.mock
async def test_pull_connection_cut_raises(http: httpx.AsyncClient) -> None:
    respx.post(f"{OLLAMA_URL}/api/pull").mock(
        return_value=httpx.Response(200, stream=CutStream(ndjson({"status": "pulling abc"})))
    )
    with pytest.raises(OllamaError):
        _ = [p async for p in OllamaClient(http).pull("qwen3.5:4b")]


@respx.mock
async def test_create_variant_payload(http: httpx.AsyncClient) -> None:
    route = respx.post(f"{OLLAMA_URL}/api/create").respond(json={"status": "success"})
    name = await OllamaClient(http).create_variant(load_catalog().local("qwen3.5:4b"))
    assert name == "qwen3.5:4b-16k"
    assert json.loads(route.calls[0].request.content) == {
        "model": "qwen3.5:4b-16k",
        "from": "qwen3.5:4b",
        "parameters": {"num_ctx": 16384},
        "stream": False,
    }


@respx.mock
async def test_delete_missing_ok(http: httpx.AsyncClient) -> None:
    route = respx.delete(f"{OLLAMA_URL}/api/delete").respond(
        404, json={"error": "model 'x' not found"}
    )
    await OllamaClient(http).delete("qwen3.5:4b-16k", missing_ok=True)
    assert json.loads(route.calls[0].request.content) == {"model": "qwen3.5:4b-16k"}
    with pytest.raises(OllamaError):
        await OllamaClient(http).delete("qwen3.5:4b-16k")


@respx.mock
async def test_start_spawns_and_waits(http: httpx.AsyncClient, tmp_path: Path) -> None:
    respx.get(f"{OLLAMA_URL}/api/version").mock(
        side_effect=[
            httpx.ConnectError("refused"),
            httpx.ConnectError("refused"),
            httpx.Response(200, json={"version": "0.40.13"}),
        ]
    )
    exe = tmp_path / "ollama app.exe"
    exe.write_bytes(b"")
    spawned: list[Path] = []
    client = OllamaClient(http, exe_candidates=lambda: [exe])
    assert await client.start(spawn=spawned.append, wait_sec=5, poll_sec=0.01) is True
    assert spawned == [exe]


@respx.mock
async def test_start_without_exe(http: httpx.AsyncClient) -> None:
    respx.get(f"{OLLAMA_URL}/api/version").mock(side_effect=httpx.ConnectError("refused"))
    spawned: list[Path] = []
    client = OllamaClient(http, exe_candidates=no_exe)
    assert await client.start(spawn=spawned.append, wait_sec=5, poll_sec=0.01) is False
    assert spawned == []


@respx.mock
async def test_require_model(http: httpx.AsyncClient) -> None:
    version = respx.get(f"{OLLAMA_URL}/api/version")
    version.mock(side_effect=httpx.ConnectError("refused"))
    client = OllamaClient(http, exe_candidates=no_exe)
    with pytest.raises(VaterError) as e:
        await client.require_model("qwen3.5:4b-16k")
    assert e.value.code == "OLLAMA_NOT_RUNNING" and e.value.status == 503

    version.mock(side_effect=None, return_value=httpx.Response(200, json={"version": "0.40.13"}))
    respx.get(f"{OLLAMA_URL}/api/tags").respond(json=TAGS)
    with pytest.raises(VaterError) as e:
        await client.require_model("qwen3.5:9b-16k")
    assert e.value.code == "LLM_LOCAL_MODEL_MISSING" and e.value.status == 409
    await client.require_model("qwen3.5:4b-16k")
