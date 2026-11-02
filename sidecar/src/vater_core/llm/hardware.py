"""GPU·RAM 감지와 하드웨어 등급 (스펙 3-2-2).

`nvidia-smi`가 있으면 NVIDIA GPU 이름과 VRAM을 읽고, 없거나 실패하면 내장 GPU로 본다.
"""

import ctypes
import logging
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from vater_core.llm.catalog import Catalog, TierId

logger = logging.getLogger(__name__)

NVIDIA_SMI = ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]
TIMEOUT_SEC = 5.0

# (명령, 시간 제한 초) → stdout. 실패는 예외로 알린다.
Runner = Callable[[list[str], float], str]


@dataclass(frozen=True)
class Gpu:
    name: str
    vram_mb: int


@dataclass(frozen=True)
class Hardware:
    gpus: tuple[Gpu, ...]
    ram_mb: int | None
    tier: TierId

    @property
    def best_gpu(self) -> Gpu | None:
        return max(self.gpus, key=lambda g: g.vram_mb, default=None)


def parse_nvidia_smi(stdout: str) -> tuple[Gpu, ...]:
    gpus = []
    for line in stdout.splitlines():
        name, sep, vram = line.rpartition(",")
        if not sep or not name.strip():
            continue
        try:
            gpus.append(Gpu(name.strip(), int(vram.strip())))
        except ValueError:  # "[N/A]" 같은 값
            continue
    return tuple(gpus)


def _run(cmd: list[str], timeout: float) -> str:
    flags: int = getattr(subprocess, "CREATE_NO_WINDOW", 0)  # Windows: 콘솔 창을 띄우지 않는다
    # 고정된 인자로 nvidia-smi만 실행한다(사용자 입력 없음).
    done = subprocess.run(  # noqa: S603
        cmd, capture_output=True, text=True, timeout=timeout, check=True, creationflags=flags
    )
    return done.stdout


def total_ram_mb() -> int | None:
    if sys.platform == "win32":

        class MemoryStatusEx(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        status = MemoryStatusEx()
        status.dwLength = ctypes.sizeof(MemoryStatusEx)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return None
        return int(status.ullTotalPhys // (1024 * 1024))
    meminfo = Path("/proc/meminfo")
    if meminfo.exists():
        for line in meminfo.read_text().splitlines():
            if line.startswith("MemTotal:"):
                return int(line.split()[1]) // 1024  # kB → MB
    return None


def detect_hardware(
    catalog: Catalog, run: Runner = _run, ram: Callable[[], int | None] = total_ram_mb
) -> Hardware:
    try:
        gpus = parse_nvidia_smi(run(NVIDIA_SMI, TIMEOUT_SEC))
    except (OSError, subprocess.SubprocessError) as e:  # 없음, 시간 초과, 오류 종료
        logger.info("nvidia-smi unavailable (%s): treating as integrated GPU", type(e).__name__)
        gpus = ()
    try:
        ram_mb = ram()
    except (OSError, ValueError):
        ram_mb = None
    best = max((g.vram_mb for g in gpus), default=None)
    return Hardware(gpus=gpus, ram_mb=ram_mb, tier=catalog.tier_for_vram(best).id)
