"""Ollama 설치 흐름 (스펙 3-2-4).

공식 설치 파일을 받아 서명을 확인하고 실행한 뒤, Ollama가 켜질 때까지 기다린다.
무인 설치 옵션이 문서에 없어서 설치 창은 사용자가 직접 진행한다.
진행 상황은 `llm.install` 이벤트로 알린다.
"""

import asyncio
import json
import logging
import os
import re
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path, PureWindowsPath
from typing import Any, Protocol

import httpx

from vater_core.api.errors import VaterError
from vater_core.api.events import EventBus

logger = logging.getLogger(__name__)

INSTALLER_URL = "https://ollama.com/download/OllamaSetup.exe"
EVENT = "llm.install"
PROGRESS_STEP = 1024 * 1024  # 다운로드 진행 이벤트는 1MB마다 1번
SIGNER = "Ollama"

SignatureCheck = Callable[[Path], bool]

# 경로는 환경변수로 넘겨서 명령 문자열에 섞이지 않게 한다.
_PS_SCRIPT = (
    "$s = Get-AuthenticodeSignature -LiteralPath $env:VATER_INSTALLER; "
    "[pscustomobject]@{Status=[string]$s.Status; "
    "Subject=[string]$s.SignerCertificate.Subject} | ConvertTo-Json -Compress"
)


class VersionSource(Protocol):
    async def version(self) -> str | None: ...


_CN = re.compile(r'(?:^|,)\s*CN=(?:"([^"]*)"|([^,]*))')


def signer_common_name(subject: str) -> str | None:
    """인증서 주체 문자열(`CN=..., O=..., C=US`)에서 CN 값만 꺼낸다."""
    m = _CN.search(subject)
    if m is None:
        return None
    return (m.group(1) if m.group(1) is not None else m.group(2)).strip()


def _powershell(system_root: str) -> str:
    # 이름("powershell.exe")으로 찾으면 Windows는 앱 폴더와 현재 폴더를 먼저 뒤진다.
    return str(
        PureWindowsPath(system_root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    )


def verify_authenticode(
    path: Path,
    run: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    system_root: str | None = None,
) -> bool:
    """Windows 서명이 유효하고 서명자(CN)가 Ollama일 때만 True. 확인할 수 없으면 False."""
    root = system_root or os.environ.get("SYSTEMROOT", r"C:\Windows")
    try:
        done = run(
            [_powershell(root), "-NoProfile", "-NonInteractive", "-Command", _PS_SCRIPT],
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
            env={**os.environ, "VATER_INSTALLER": str(path)},
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        info = json.loads(done.stdout)
    except (OSError, subprocess.SubprocessError, ValueError):
        logger.warning("installer signature check could not run", exc_info=True)
        return False
    cn = signer_common_name(str(info.get("Subject", "")))
    ok = info.get("Status") == "Valid" and cn is not None and cn.startswith(SIGNER)
    if not ok:
        logger.warning("installer signature rejected: status=%s cn=%s", info.get("Status"), cn)
    return ok


def _launch(path: Path) -> None:
    os.startfile(path)  # type: ignore[attr-defined]  # noqa: S606 (Windows 전용, 서명 확인 후)


def _unsupported() -> VaterError:
    return VaterError(
        "OLLAMA_INSTALL_UNSUPPORTED",
        "자동 설치는 Windows에서만 지원합니다.",
        hint="https://ollama.com/download 에서 직접 설치하세요.",
        status=409,
    )


def require_windows(platform: str = sys.platform) -> None:
    if platform != "win32":
        raise _unsupported()


async def _download(
    http: httpx.AsyncClient, dest: Path, publish: Callable[[dict[str, Any]], None]
) -> None:
    part = dest.with_name(dest.name + ".part")
    async with http.stream("GET", INSTALLER_URL, follow_redirects=True, timeout=60.0) as r:
        r.raise_for_status()
        total = int(r.headers["content-length"]) if "content-length" in r.headers else None
        done, reported = 0, -PROGRESS_STEP
        with part.open("wb") as f:
            async for chunk in r.aiter_bytes():
                f.write(chunk)
                done += len(chunk)
                if done - reported >= PROGRESS_STEP:
                    publish({"stage": "download", "completed": done, "total": total})
                    reported = done
        publish({"stage": "download", "completed": done, "total": total})
    part.replace(dest)


async def install_ollama(
    http: httpx.AsyncClient,
    ollama: VersionSource,
    events: EventBus,
    cache_dir: Path,
    *,
    platform: str = sys.platform,
    verify: SignatureCheck = verify_authenticode,
    launch: Callable[[Path], None] = _launch,
    wait_sec: float = 900.0,
    poll_sec: float = 2.0,
) -> None:
    """Windows가 아니면 바로 409. 그 밖의 실패는 예외 대신 `error` 이벤트로 알린다."""
    require_windows(platform)

    def publish(data: dict[str, Any]) -> None:
        events.publish(EVENT, data)

    def fail(code: str, message: str, hint: str) -> None:
        publish({"stage": "error", "code": code, "message": message, "hint": hint})

    cache_dir.mkdir(parents=True, exist_ok=True)
    setup = cache_dir / "OllamaSetup.exe"
    try:
        await _download(http, setup, publish)
    except (httpx.HTTPError, OSError) as e:
        logger.warning("ollama installer download failed: %s", type(e).__name__)
        fail(
            "LLM_UNREACHABLE",
            "Ollama 설치 파일을 받지 못했습니다.",
            "인터넷 연결을 확인하고 다시 시도하세요.",
        )
        return

    publish({"stage": "verify"})
    if not await asyncio.to_thread(verify, setup):
        setup.unlink(missing_ok=True)
        fail(
            "OLLAMA_INSTALLER_UNTRUSTED",
            "받은 설치 파일의 서명을 확인할 수 없어 실행하지 않았습니다.",
            "https://ollama.com/download 에서 직접 설치하세요.",
        )
        return

    publish({"stage": "launch"})
    try:
        launch(setup)
    except OSError:
        logger.warning("ollama installer launch failed", exc_info=True)
        fail(
            "OLLAMA_ERROR",
            "설치 파일을 실행하지 못했습니다.",
            f"{setup} 을 직접 실행하세요.",
        )
        return

    publish({"stage": "waiting"})
    deadline = asyncio.get_running_loop().time() + wait_sec
    while True:
        version = await ollama.version()
        if version is not None:
            publish({"stage": "done", "version": version})
            return
        if asyncio.get_running_loop().time() >= deadline:
            fail(
                "OLLAMA_NOT_RUNNING",
                "Ollama 설치가 끝나지 않았거나 실행되지 않았습니다.",
                "열린 설치 창을 끝까지 진행한 뒤 다시 확인하세요.",
            )
            return
        await asyncio.sleep(poll_sec)
