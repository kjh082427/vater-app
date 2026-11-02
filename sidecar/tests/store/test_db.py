import sqlite3
from pathlib import Path

import pytest

from vater_core.api.errors import VaterError
from vater_core.store import db
from vater_core.store.db import migrate, open_db

TABLES = {"settings", "watchlist", "alert_rules", "alert_events", "analyses", "briefings"}


def test_open_db_creates_missing_dir(tmp_path: Path) -> None:
    conn = open_db(tmp_path / "new" / "dir")
    assert (tmp_path / "new" / "dir" / "vater.db").exists()
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"


def test_pragmas(tmp_path: Path) -> None:
    conn = open_db(tmp_path)
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 5000


def test_migrate_is_idempotent(tmp_path: Path) -> None:
    conn = open_db(tmp_path)
    v1 = migrate(conn)
    v2 = migrate(conn)
    assert v1 == v2 == 1


def test_reopen_keeps_version(tmp_path: Path) -> None:
    open_db(tmp_path).close()
    assert migrate(open_db(tmp_path)) == 1


def test_failed_migration_rolls_back(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """깨진 마이그레이션이 트랜잭션을 연 채로 남기면 안 된다 (리뷰 Important #5)."""
    conn = open_db(tmp_path)
    good = db._migrations()
    broken = (2, "CREATE TABLE half_done (x INTEGER);\nTHIS IS NOT SQL;")
    monkeypatch.setattr(db, "_migrations", lambda: [*good, broken])
    with pytest.raises(VaterError) as e:
        migrate(conn)
    assert e.value.code == "DB_MIGRATION_FAILED"
    assert not conn.in_transaction
    assert conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0] == 1
    names = {r[0] for r in conn.execute("select name from sqlite_master where type='table'")}
    assert "half_done" not in names


def test_tables_exist(tmp_path: Path) -> None:
    rows = open_db(tmp_path).execute("select name from sqlite_master where type='table'")
    assert {r[0] for r in rows} >= TABLES


def test_watchlist_market_check(tmp_path: Path) -> None:
    conn = open_db(tmp_path)
    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        conn.execute("insert into watchlist(market, code) values ('JP', '7203')")
