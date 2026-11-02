import subprocess
import sys

import pytest

from vater_core.llm.catalog import load_catalog
from vater_core.llm.hardware import (
    Gpu,
    Runner,
    detect_hardware,
    parse_nvidia_smi,
    total_ram_mb,
)


def runner_returning(stdout: str, seen: list[float] | None = None) -> Runner:
    def run(cmd: list[str], timeout: float) -> str:
        assert cmd[0] == "nvidia-smi"
        if seen is not None:
            seen.append(timeout)
        return stdout

    return run


def runner_raising(exc: BaseException) -> Runner:
    def run(cmd: list[str], timeout: float) -> str:
        raise exc

    return run


def test_parse_single_gpu() -> None:
    out = "NVIDIA GeForce RTX 3080 Laptop GPU, 8192\n"
    assert parse_nvidia_smi(out) == (Gpu("NVIDIA GeForce RTX 3080 Laptop GPU", 8192),)


def test_parse_skips_garbage() -> None:
    out = "foo\nNVIDIA A, 24576\nNVIDIA B, [N/A]\n\n"
    assert parse_nvidia_smi(out) == (Gpu("NVIDIA A", 24576),)


def test_detect_uses_largest_gpu() -> None:
    hw = detect_hardware(
        load_catalog(), run=runner_returning("NVIDIA A, 8192\nNVIDIA B, 24576\n"), ram=lambda: None
    )
    assert hw.tier == "nvidia_24"
    assert hw.best_gpu == Gpu("NVIDIA B", 24576)


def test_missing_nvidia_smi_is_integrated() -> None:
    hw = detect_hardware(
        load_catalog(), run=runner_raising(FileNotFoundError("nvidia-smi")), ram=lambda: None
    )
    assert hw.gpus == () and hw.tier == "integrated" and hw.best_gpu is None


def test_timeout_is_integrated() -> None:
    seen: list[float] = []
    ok = detect_hardware(load_catalog(), run=runner_returning("X, 8192", seen), ram=lambda: None)
    assert ok.tier == "nvidia_8" and seen == [5.0]  # 시간 제한 5초
    hw = detect_hardware(
        load_catalog(),
        run=runner_raising(subprocess.TimeoutExpired("nvidia-smi", 5.0)),
        ram=lambda: None,
    )
    assert hw.tier == "integrated"


def test_nonzero_exit_is_integrated() -> None:
    hw = detect_hardware(
        load_catalog(),
        run=runner_raising(subprocess.CalledProcessError(9, "nvidia-smi")),
        ram=lambda: None,
    )
    assert hw.tier == "integrated"


def test_ram_is_reported() -> None:
    hw = detect_hardware(load_catalog(), run=runner_returning(""), ram=lambda: 32768)
    assert hw.ram_mb == 32768 and hw.tier == "integrated"

    def broken() -> int | None:
        raise OSError("no meminfo")

    assert detect_hardware(load_catalog(), run=runner_returning(""), ram=broken).ram_mb is None


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="Linux /proc/meminfo")
def test_total_ram_linux() -> None:
    ram = total_ram_mb()
    assert ram is not None and ram > 0
