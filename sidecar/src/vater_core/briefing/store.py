"""`briefings` 테이블 (001_init.sql). 쓰기는 이벤트 루프 스레드에서만 부른다.

같은 시장·날짜는 하나만 둔다: 다시 만들면 덮어쓴다(id는 그대로).
"""

import builtins
import json
import sqlite3
from dataclasses import dataclass
from datetime import date
from typing import Any

from vater_core.api.errors import VaterError

_COLUMNS = "id, market, date, data, text, status, missing, created_at, my_assets"


@dataclass(frozen=True)
class Briefing:
    id: int
    market: str
    date: str
    data: dict[str, Any]
    text: dict[str, str] | None  # LLM 해석 문장. 해석이 실패하면 None
    status: str  # done | partial
    missing: list[str]
    created_at: str
    my_assets: dict[str, Any] | None = None  # 앱이 계산한 내 자산 구역. AI에 보내지 않는다


def _row(r: tuple[Any, ...]) -> Briefing:
    return Briefing(
        id=r[0],
        market=r[1],
        date=r[2],
        data=json.loads(r[3]) if r[3] else {},
        text=json.loads(r[4]) if r[4] else None,
        status=r[5],
        missing=json.loads(r[6]) if r[6] else [],
        created_at=r[7],
        my_assets=json.loads(r[8]) if r[8] else None,
    )


class BriefingRepo:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def save(
        self,
        market: str,
        day: date,
        data: dict[str, Any],
        text: dict[str, str] | None,
        missing: builtins.list[str],
        my_assets: dict[str, Any] | None = None,
    ) -> int:
        status = "partial" if missing else "done"
        with self._conn:
            self._conn.execute(
                "INSERT INTO briefings (market, date, data, text, status, missing, my_assets) "
                "VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(market, date) DO UPDATE SET data = excluded.data, "
                "text = excluded.text, status = excluded.status, missing = excluded.missing, "
                "my_assets = excluded.my_assets, "
                "created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
                (
                    market,
                    day.isoformat(),
                    json.dumps(data, ensure_ascii=False),
                    None if text is None else json.dumps(text, ensure_ascii=False),
                    status,
                    json.dumps(missing),
                    None if my_assets is None else json.dumps(my_assets, ensure_ascii=False),
                ),
            )
        found = self.find(market, day)
        if found is None:  # 방금 넣었으므로 일어나지 않는다
            raise RuntimeError("briefing upsert lost its row")
        return found.id

    def get(self, id: int) -> Briefing:
        r = self._conn.execute(
            f"SELECT {_COLUMNS} FROM briefings WHERE id = ?",  # noqa: S608
            (id,),
        ).fetchone()
        if r is None:
            raise VaterError("BRIEFING_NOT_FOUND", f"브리핑이 없습니다: {id}", status=404)
        return _row(r)

    def find(self, market: str, day: date) -> Briefing | None:
        r = self._conn.execute(
            f"SELECT {_COLUMNS} FROM briefings WHERE market = ? AND date = ?",  # noqa: S608
            (market, day.isoformat()),
        ).fetchone()
        return None if r is None else _row(r)

    def list(self, market: str | None = None, limit: int = 30) -> builtins.list[Briefing]:
        where, args = ("WHERE market = ?", [market]) if market else ("", [])
        rows = self._conn.execute(
            f"SELECT {_COLUMNS} FROM briefings {where} "  # noqa: S608
            "ORDER BY date DESC, id DESC LIMIT ?",
            [*args, limit],
        ).fetchall()
        return [_row(r) for r in rows]
