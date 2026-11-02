"""앱 전역 의존성. `create_app(deps)`로 주입하고 라우트에서는 `get_deps`로 꺼낸다."""

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import Request

from vater_core.secrets.store import SecretStore


def _noop() -> None:
    return None


@dataclass
class AppDeps:
    token: str
    dev: bool
    data_dir: Path
    db: sqlite3.Connection | None = None
    secrets: SecretStore | None = None
    events: Any = None  # EventBus (Task 6에서 타입 확정)
    shutdown: Callable[[], None] = field(default=_noop)


def get_deps(request: Request) -> AppDeps:
    deps: AppDeps = request.app.state.deps
    return deps
