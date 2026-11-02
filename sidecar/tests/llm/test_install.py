import json
import subprocess
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx

from vater_core.api.errors import VaterError
from vater_core.api.events import EventBus, Subscription
from vater_core.llm.install import INSTALLER_URL, install_ollama, verify_authenticode


class FakeOllama:
    def __init__(self, versions: list[str | None]) -> None:
        self._versions = versions

    async def version(self) -> str | None:
        return self._versions.pop(0) if len(self._versions) > 1 else self._versions[0]


def drain(sub: Subscription) -> list[dict[str, Any]]:
    out = []
    while not sub.queue.empty():
        ev = sub.queue.get_nowait()
        assert ev.type == "llm.install"
        out.append(ev.data)
    return out


def stages(events: list[dict[str, Any]]) -> list[str]:
    seq: list[str] = []
    for e in events:
        if not seq or seq[-1] != e["stage"]:
            seq.append(e["stage"])
    return seq


@pytest.fixture
async def http() -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient() as c:
        yield c


def fake_powershell(stdout: str, seen: list[list[str]]) -> Any:
    def run(argv: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        seen.append(argv)
        return subprocess.CompletedProcess(argv, 0, stdout=stdout, stderr="")

    return run


def signature(status: str, subject: str) -> str:
    return json.dumps({"Status": status, "Subject": subject})


def test_verify_uses_system_powershell_by_absolute_path(tmp_path: Path) -> None:
    """리뷰 Important #3: 이름으로 찾으면 앱 폴더의 가짜 powershell.exe가 먼저 잡힌다."""
    seen: list[list[str]] = []
    ok = verify_authenticode(
        tmp_path / "OllamaSetup.exe",
        run=fake_powershell(signature("Valid", "CN=Ollama Inc., O=Ollama Inc., C=US"), seen),
        system_root=r"C:\Windows",
    )
    assert ok is True
    assert seen[0][0] == r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"


@pytest.mark.parametrize(
    ("status", "subject", "ok"),
    [
        ("Valid", "CN=Ollama Inc., O=Ollama Inc., L=Palo Alto, S=California, C=US", True),
        ("Valid", 'CN="Ollama, Inc.", O="Ollama, Inc.", C=US', True),
        ("Valid", "CN=Evil Corp, O=Ollama Fans Ltd, C=US", False),  # 서명자(CN)가 아니면 안 된다
        ("Valid", "CN=Evil Corp, OU=Ollama", False),
        ("NotSigned", "CN=Ollama Inc.", False),
        ("HashMismatch", "CN=Ollama Inc.", False),
    ],
)
def test_signer_must_be_ollama(tmp_path: Path, status: str, subject: str, ok: bool) -> None:
    seen: list[list[str]] = []
    result = verify_authenticode(
        tmp_path / "OllamaSetup.exe",
        run=fake_powershell(signature(status, subject), seen),
        system_root=r"C:\Windows",
    )
    assert result is ok


@respx.mock
async def test_non_windows_is_unsupported(http: httpx.AsyncClient, tmp_path: Path) -> None:
    route = respx.get(INSTALLER_URL).respond(content=b"MZ")
    bus = EventBus()
    sub = bus.subscribe()
    with pytest.raises(VaterError) as e:
        await install_ollama(http, FakeOllama([None]), bus, tmp_path, platform="linux")
    assert e.value.code == "OLLAMA_INSTALL_UNSUPPORTED" and e.value.status == 409
    assert route.call_count == 0 and drain(sub) == []


@respx.mock
async def test_happy_path_events_in_order(http: httpx.AsyncClient, tmp_path: Path) -> None:
    respx.get(INSTALLER_URL).respond(content=b"MZ" + b"\0" * 100)
    launched: list[Path] = []
    bus = EventBus()
    sub = bus.subscribe()
    await install_ollama(
        http,
        FakeOllama([None, "0.40.13"]),
        bus,
        tmp_path,
        platform="win32",
        verify=lambda p: True,
        launch=launched.append,
        poll_sec=0.01,
    )
    events = drain(sub)
    assert stages(events) == ["download", "verify", "launch", "waiting", "done"]
    assert events[-1] == {"stage": "done", "version": "0.40.13"}
    setup = tmp_path / "OllamaSetup.exe"
    assert launched == [setup] and setup.read_bytes().startswith(b"MZ")
    assert not (tmp_path / "OllamaSetup.exe.part").exists()


@respx.mock
async def test_untrusted_installer_is_not_launched(http: httpx.AsyncClient, tmp_path: Path) -> None:
    respx.get(INSTALLER_URL).respond(content=b"MZ evil")
    launched: list[Path] = []
    bus = EventBus()
    sub = bus.subscribe()
    await install_ollama(
        http,
        FakeOllama([None]),
        bus,
        tmp_path,
        platform="win32",
        verify=lambda p: False,
        launch=launched.append,
        poll_sec=0.01,
    )
    last = drain(sub)[-1]
    assert last["stage"] == "error" and last["code"] == "OLLAMA_INSTALLER_UNTRUSTED"
    assert launched == [] and not (tmp_path / "OllamaSetup.exe").exists()


@respx.mock
async def test_download_failure_reports_error(http: httpx.AsyncClient, tmp_path: Path) -> None:
    respx.get(INSTALLER_URL).respond(503)
    launched: list[Path] = []
    bus = EventBus()
    sub = bus.subscribe()
    await install_ollama(
        http,
        FakeOllama([None]),
        bus,
        tmp_path,
        platform="win32",
        verify=lambda p: True,
        launch=launched.append,
        poll_sec=0.01,
    )
    last = drain(sub)[-1]
    assert last["stage"] == "error" and last["code"] == "LLM_UNREACHABLE"
    assert launched == []


@respx.mock
async def test_wait_timeout_reports_error(http: httpx.AsyncClient, tmp_path: Path) -> None:
    respx.get(INSTALLER_URL).respond(content=b"MZ")
    bus = EventBus()
    sub = bus.subscribe()
    await install_ollama(
        http,
        FakeOllama([None]),
        bus,
        tmp_path,
        platform="win32",
        verify=lambda p: True,
        launch=lambda p: None,
        wait_sec=0.05,
        poll_sec=0.01,
    )
    last = drain(sub)[-1]
    assert last["stage"] == "error" and last["code"] == "OLLAMA_NOT_RUNNING"
    assert "설치 창" in last["hint"]
