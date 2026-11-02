import json
import os
import subprocess
import sys
from pathlib import Path

import httpx

from vater_core.config import resolve_data_dir


def test_resolve_data_dir_windows() -> None:
    appdata = r"C:\Users\u\AppData\Roaming"
    assert resolve_data_dir({"APPDATA": appdata}, "win32") == Path(appdata) / "Vater"


def test_resolve_data_dir_override(tmp_path: Path) -> None:
    assert resolve_data_dir({"VATER_DATA_DIR": str(tmp_path)}, "linux") == tmp_path


def test_resolve_data_dir_linux_default() -> None:
    assert resolve_data_dir({"HOME": "/home/u"}, "linux") == Path("/home/u/.local/share/vater")


def test_entrypoint_announces_port_and_serves(tmp_path: Path) -> None:
    env = {
        **os.environ,
        "VATER_TOKEN": "t0k",
        "VATER_DATA_DIR": str(tmp_path),
        "VATER_BACKGROUND_JOBS": "0",
    }  # 테스트에서 인터넷(종목 마스터)을 쓰지 않는다
    p = subprocess.Popen(
        [sys.executable, "-m", "vater_core"], env=env, stdout=subprocess.PIPE, text=True
    )
    try:
        assert p.stdout is not None
        ready = json.loads(p.stdout.readline())
        assert ready["type"] == "ready" and ready["port"] > 0
        base = f"http://127.0.0.1:{ready['port']}"
        auth = {"Authorization": "Bearer t0k"}
        assert httpx.get(f"{base}/health", headers=auth, timeout=10).status_code == 200
        assert httpx.post(f"{base}/shutdown", headers=auth, timeout=10).status_code == 202
        assert p.wait(timeout=10) == 0
    finally:
        p.kill()


def test_entrypoint_requires_token(tmp_path: Path) -> None:
    env = {k: v for k, v in os.environ.items() if k != "VATER_TOKEN"}
    env["VATER_DATA_DIR"] = str(tmp_path)
    r = subprocess.run(
        [sys.executable, "-m", "vater_core"], env=env, capture_output=True, text=True, timeout=10
    )
    assert r.returncode != 0 and "VATER_TOKEN" in r.stderr
