"""감시 종목·알림 규칙·발생 이력·일봉 저장소 (001_init.sql, 003_daily_bars.sql).

쓰기는 이벤트 루프 스레드에서만 부른다.
"""

import builtins
import json
import sqlite3
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from vater_core.alerts.rules import History
from vater_core.analysis.symbols import Target
from vater_core.api.errors import VaterError
from vater_core.kis.models import Bar

BAR_HISTORY = 260  # 지표 계산에 쓰는 최근 거래일 수 (스펙 4-2)


@dataclass(frozen=True)
class WatchItem:
    id: int
    market: str
    code: str
    exchange: str
    name: str
    created_at: str


@dataclass(frozen=True)
class Rule:
    id: int
    watchlist_id: int
    kind: str
    params: dict[str, Any]
    timing: str
    enabled: bool
    last_state: bool | None
    last_fired_at: str | None
    last_avg: float | None = None  # 평단가 규칙이 마지막으로 본 평단가. AI에 보내지 않는다


@dataclass(frozen=True)
class AlertEvent:
    id: int
    rule_id: int | None
    fired_at: str
    value: float | None
    message: str
    market: str | None
    code: str | None
    name: str | None
    kind: str | None


class WatchlistRepo:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def _row(self, r: tuple[Any, ...]) -> WatchItem:
        return WatchItem(r[0], r[1], r[2], r[3] or "", r[4] or r[2], r[5])

    def list(self) -> list[WatchItem]:
        rows = self._conn.execute(
            "SELECT id, market, code, exchange, name, created_at FROM watchlist ORDER BY id"
        ).fetchall()
        return [self._row(r) for r in rows]

    def get(self, id: int) -> WatchItem:
        r = self._conn.execute(
            "SELECT id, market, code, exchange, name, created_at FROM watchlist WHERE id = ?", (id,)
        ).fetchone()
        if r is None:
            raise VaterError("WATCHLIST_NOT_FOUND", f"감시 종목이 없습니다: {id}", status=404)
        return self._row(r)

    def add(self, target: Target) -> WatchItem:
        try:
            with self._conn:
                cur = self._conn.execute(
                    "INSERT INTO watchlist (market, code, exchange, name) VALUES (?, ?, ?, ?)",
                    (target.market, target.code, target.exchange, target.name),
                )
        except sqlite3.IntegrityError as e:
            raise VaterError(
                "WATCHLIST_DUPLICATE", f"이미 감시 중인 종목입니다: {target.name}", status=409
            ) from e
        if cur.lastrowid is None:
            raise RuntimeError("watchlist insert returned no row id")
        return self.get(cur.lastrowid)

    def remove(self, id: int) -> None:
        self.get(id)
        with self._conn:
            self._conn.execute("DELETE FROM watchlist WHERE id = ?", (id,))


_RULE_COLUMNS = (
    "id, watchlist_id, kind, params, timing, enabled, last_state, last_fired_at, last_avg"
)


class RuleRepo:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    @staticmethod
    def _row(r: tuple[Any, ...]) -> Rule:
        return Rule(
            id=r[0],
            watchlist_id=r[1],
            kind=r[2],
            params=json.loads(r[3]),
            timing=r[4],
            enabled=bool(r[5]),
            last_state=None if r[6] is None else bool(r[6]),
            last_fired_at=r[7],
            last_avg=r[8],
        )

    def list(self, watchlist_id: int | None = None, enabled_only: bool = False) -> list[Rule]:
        where, args = [], []
        if watchlist_id is not None:
            where.append("watchlist_id = ?")
            args.append(watchlist_id)
        if enabled_only:
            where.append("enabled = 1")
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        rows = self._conn.execute(
            f"SELECT {_RULE_COLUMNS} FROM alert_rules {clause} ORDER BY id",  # noqa: S608
            args,
        ).fetchall()
        return [self._row(r) for r in rows]

    def get(self, id: int) -> Rule:
        r = self._conn.execute(
            f"SELECT {_RULE_COLUMNS} FROM alert_rules WHERE id = ?",  # noqa: S608
            (id,),
        ).fetchone()
        if r is None:
            raise VaterError("ALERT_RULE_NOT_FOUND", f"알림 규칙이 없습니다: {id}", status=404)
        return self._row(r)

    def create(
        self, watchlist_id: int, kind: str, params: dict[str, Any], timing: str, enabled: bool
    ) -> Rule:
        with self._conn:
            cur = self._conn.execute(
                "INSERT INTO alert_rules (watchlist_id, kind, params, timing, enabled) "
                "VALUES (?, ?, ?, ?, ?)",
                (watchlist_id, kind, json.dumps(params), timing, int(enabled)),
            )
        if cur.lastrowid is None:
            raise RuntimeError("alert_rules insert returned no row id")
        return self.get(cur.lastrowid)

    def update(
        self,
        id: int,
        params: dict[str, Any] | None = None,
        timing: str | None = None,
        enabled: bool | None = None,
    ) -> Rule:
        before = self.get(id)
        with self._conn:
            if params is not None:  # 조건이 바뀌면 기준값을 다시 잡는다
                self._conn.execute(
                    "UPDATE alert_rules SET params = ?, last_state = NULL WHERE id = ?",
                    (json.dumps(params), id),
                )
            if timing is not None:
                self._conn.execute(
                    "UPDATE alert_rules SET timing = ?, last_state = NULL WHERE id = ?",
                    (timing, id),
                )
            if enabled is not None:
                self._conn.execute(
                    "UPDATE alert_rules SET enabled = ? WHERE id = ?", (int(enabled), id)
                )
            if enabled and not before.enabled:  # 다시 켜면 꺼 둔 동안의 변화로 바로 울리지 않게
                self._conn.execute("UPDATE alert_rules SET last_state = NULL WHERE id = ?", (id,))
        return self.get(id)

    def delete(self, id: int) -> None:
        self.get(id)
        with self._conn:
            self._conn.execute("DELETE FROM alert_rules WHERE id = ?", (id,))

    def set_state(self, id: int, state: bool | None) -> None:
        with self._conn:
            self._conn.execute(
                "UPDATE alert_rules SET last_state = ? WHERE id = ?",
                (None if state is None else int(state), id),
            )

    def reset_avg(self, id: int, avg: float | None) -> None:
        """평단가가 바뀌었다. 기준값을 비워 다음 평가가 새 평단가의 기준값부터 저장하게 한다."""
        with self._conn:
            self._conn.execute(
                "UPDATE alert_rules SET last_avg = ?, last_state = NULL WHERE id = ?", (avg, id)
            )

    def mark_fired(self, id: int, at: str) -> None:
        with self._conn:
            self._conn.execute("UPDATE alert_rules SET last_fired_at = ? WHERE id = ?", (at, id))


_EVENT_SELECT = (
    "SELECT e.id, e.rule_id, e.fired_at, e.value, e.message, w.market, w.code, w.name, r.kind "
    "FROM alert_events e "
    "LEFT JOIN alert_rules r ON r.id = e.rule_id "
    "LEFT JOIN watchlist w ON w.id = r.watchlist_id "
)


class EventRepo:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def add(self, rule_id: int | None, fired_at: str, value: float | None, message: str) -> int:
        with self._conn:
            cur = self._conn.execute(
                "INSERT INTO alert_events (rule_id, fired_at, value, message) VALUES (?, ?, ?, ?)",
                (rule_id, fired_at, value, message),
            )
        if cur.lastrowid is None:
            raise RuntimeError("alert_events insert returned no row id")
        return cur.lastrowid

    def list(self, limit: int = 100) -> list[AlertEvent]:
        rows = self._conn.execute(_EVENT_SELECT + "ORDER BY e.id DESC LIMIT ?", (limit,))
        return [AlertEvent(*r) for r in rows.fetchall()]

    def on_day(self, day: date) -> builtins.list[AlertEvent]:
        """그 날짜(발생 시각의 현지 날짜 부분)에 생긴 이력. 오래된 것부터 (브리핑용)."""
        rows = self._conn.execute(
            _EVENT_SELECT + "WHERE substr(e.fired_at, 1, 10) = ? ORDER BY e.id", (day.isoformat(),)
        )
        return [AlertEvent(*r) for r in rows.fetchall()]


class BarRepo:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def upsert(self, market: str, code: str, bars: list[Bar]) -> int:
        with self._conn:
            self._conn.executemany(
                "INSERT INTO daily_bars (market, code, day, open, high, low, close, volume) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(market, code, day) DO UPDATE SET open = excluded.open, "
                "high = excluded.high, low = excluded.low, close = excluded.close, "
                "volume = excluded.volume",
                [
                    (market, code, b.day.isoformat(), b.open, b.high, b.low, b.close, b.volume)
                    for b in bars
                ],
            )
        return len(bars)

    def history(self, market: str, code: str, limit: int = BAR_HISTORY) -> History:
        rows = self._conn.execute(
            "SELECT day, open, high, low, close, volume FROM daily_bars "
            "WHERE market = ? AND code = ? ORDER BY day DESC LIMIT ?",
            (market, code, limit),
        ).fetchall()[::-1]
        return History(
            days=tuple(date.fromisoformat(r[0]) for r in rows),
            open=tuple(float(r[1]) for r in rows),
            high=tuple(float(r[2]) for r in rows),
            low=tuple(float(r[3]) for r in rows),
            close=tuple(float(r[4]) for r in rows),
            volume=tuple(float(r[5]) for r in rows),
        )

    def closes_since(self, market: str, code: str, after: date) -> list[tuple[date, float]]:
        """그 날짜 다음 날부터의 (날짜, 종가). 오래된 것부터."""
        rows = self._conn.execute(
            "SELECT day, close FROM daily_bars WHERE market = ? AND code = ? AND day > ? "
            "ORDER BY day",
            (market, code, after.isoformat()),
        ).fetchall()
        return [(date.fromisoformat(r[0]), float(r[1])) for r in rows]

    def close_on(self, market: str, code: str, day: date) -> float | None:
        r = self._conn.execute(
            "SELECT close FROM daily_bars WHERE market = ? AND code = ? AND day = ?",
            (market, code, day.isoformat()),
        ).fetchone()
        return float(r[0]) if r else None

    def recent_close(self, market: str, code: str, day: date, within: int) -> float | None:
        """그 날짜 전 `within`일 안의 가장 최근 종가(거래정지 종목용)."""
        r = self._conn.execute(
            "SELECT close FROM daily_bars WHERE market = ? AND code = ? AND day < ? AND day >= ? "
            "AND close > 0 ORDER BY day DESC LIMIT 1",
            (market, code, day.isoformat(), (day - timedelta(days=within)).isoformat()),
        ).fetchone()
        return float(r[0]) if r else None

    def close_before(self, market: str, code: str, day: date) -> float | None:
        """그 날짜 전의 가장 최근 종가(실시간 틱의 전일 대비 계산용)."""
        r = self._conn.execute(
            "SELECT close FROM daily_bars WHERE market = ? AND code = ? AND day < ? "
            "ORDER BY day DESC LIMIT 1",
            (market, code, day.isoformat()),
        ).fetchone()
        return float(r[0]) if r else None

    def last_day(self, market: str, code: str) -> date | None:
        r = self._conn.execute(
            "SELECT max(day) FROM daily_bars WHERE market = ? AND code = ?", (market, code)
        ).fetchone()
        return date.fromisoformat(r[0]) if r and r[0] else None
