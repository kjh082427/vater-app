import sqlite3
from pathlib import Path

import pytest

from vater_core.store.db import open_db

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
