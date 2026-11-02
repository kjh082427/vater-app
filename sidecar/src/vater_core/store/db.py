"""SQLite 연결과 순차 마이그레이션."""

import logging
import re
import sqlite3
from importlib import resources
from pathlib import Path

from vater_core.api.errors import VaterError

logger = logging.getLogger(__name__)
DB_FILE = "vater.db"
_MIGRATION_NAME = re.compile(r"^(\d{3})_[a-z0-9_]+\.sql$")


def _migrations() -> list[tuple[int, str]]:
    """`migrations/NNN_*.sql`을 번호 순서로 돌려준다.

    PyInstaller로 포장해도 읽히도록 파일 경로 대신 `importlib.resources`를 쓴다.
    """
    found = []
    for entry in resources.files("vater_core.store.migrations").iterdir():
        if m := _MIGRATION_NAME.match(entry.name):
            found.append((int(m.group(1)), entry.read_text(encoding="utf-8")))
    return sorted(found)


def migrate(conn: sqlite3.Connection) -> int:
    """아직 적용하지 않은 마이그레이션만 적용하고 현재 스키마 버전을 돌려준다."""
    conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
    row = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()
    current = int(row[0]) if row and row[0] is not None else 0
    for version, sql in _migrations():
        if version <= current:
            continue
        # executescript는 먼저 커밋하므로, 스크립트 자체를 한 트랜잭션으로 감싼다.
        try:
            conn.executescript(
                f"BEGIN;\n{sql}\nINSERT INTO schema_version (version) VALUES ({version});\nCOMMIT;"
            )
        except sqlite3.Error as e:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            logger.exception("migration %03d failed", version)
            raise VaterError(
                "DB_MIGRATION_FAILED",
                f"데이터베이스 업데이트({version:03d})에 실패했습니다.",
                "앱을 다시 설치하거나 로그 폴더를 확인해 주세요.",
                status=500,
            ) from e
        current = version
    return current


def open_db(data_dir: Path) -> sqlite3.Connection:
    data_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(data_dir / DB_FILE, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    migrate(conn)
    return conn
