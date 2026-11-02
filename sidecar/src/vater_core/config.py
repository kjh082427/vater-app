"""실행 환경 설정: 환경변수에서 토큰, 개발 모드, 데이터 폴더를 읽는다."""

import os
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Runtime:
    token: str
    dev: bool
    data_dir: Path


def resolve_data_dir(env: Mapping[str, str], platform: str) -> Path:
    """`VATER_DATA_DIR` > Windows `%APPDATA%\\Vater` > `~/.local/share/vater`."""
    if override := env.get("VATER_DATA_DIR"):
        return Path(override)
    if platform == "win32" and (appdata := env.get("APPDATA")):
        return Path(appdata) / "Vater"
    home = env.get("HOME") or str(Path.home())
    return Path(home) / ".local" / "share" / "vater"


def load_runtime(env: Mapping[str, str] | None = None, platform: str | None = None) -> Runtime:
    env = os.environ if env is None else env
    token = env.get("VATER_TOKEN", "")
    if not token:
        raise SystemExit("VATER_TOKEN is required")
    return Runtime(
        token=token,
        dev=env.get("VATER_DEV") == "1",
        data_dir=resolve_data_dir(env, platform or sys.platform),
    )
