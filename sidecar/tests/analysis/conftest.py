import json
import sqlite3
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any

import httpx
import pytest

from vater_core.kis.client import KisClient
from vater_core.kis.config import KisCredentials, KisServer
from vater_core.kis.ratelimit import PriorityRateLimiter
from vater_core.store.db import open_db

KIS_FIXTURES = Path(__file__).parents[1] / "kis" / "fixtures"


def load_kis_fixture(name: str) -> dict[str, Any]:
    """core/kis 실연동(2026-11-03)에서 받은 실제 응답."""
    data: dict[str, Any] = json.loads((KIS_FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
    return data


@pytest.fixture
def kis_fixture() -> Callable[[str], dict[str, Any]]:
    return load_kis_fixture


class StaticTokens:
    async def token(self) -> str:
        return "tok"

    async def invalidate(self, rejected: str | None = None) -> None:
        return None


@pytest.fixture
async def kis() -> AsyncIterator[KisClient]:
    creds = KisCredentials(app_key="ak", app_secret="as", hts_id=None)
    async with httpx.AsyncClient() as http:
        limiter = PriorityRateLimiter(1000)
        yield KisClient(http, StaticTokens(), creds, KisServer.PROD, limiter, retry_delays=(0,))


SYMBOLS = [
    ("KR", "005930", "KOSPI", "삼성전자", None, "stock"),
    ("KR", "247540", "KOSDAQ", "에코프로비엠", None, "stock"),
    ("US", "AAPL", "NAS", "애플", "APPLE INC", "stock"),
]


def seed_symbols(conn: sqlite3.Connection) -> None:
    conn.executemany(
        "INSERT INTO symbols (market, code, exchange, name, name_en, kind) VALUES (?,?,?,?,?,?)",
        SYMBOLS,
    )
    conn.commit()


@pytest.fixture
def db(tmp_path: Path) -> sqlite3.Connection:
    conn = open_db(tmp_path)
    seed_symbols(conn)
    return conn
