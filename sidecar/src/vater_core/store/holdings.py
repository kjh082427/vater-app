"""증권사·연결·보유 내역 저장소 (004_holdings.sql, v2 설계 1, 2, 5장).

쓰기는 이벤트 루프 스레드에서만 부른다.
"""

import sqlite3
from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

from vater_core.api.errors import VaterError

ConnStatus = Literal["ok", "lost", "disconnected"]
Source = Literal["api", "manual", "csv"]
OTHER_MARKET = "OTHER"
MANUAL_CONNECTION = 0
MAX_BROKER_NAME = 20
CUSTOM_COLORS = ("#2E8B57", "#138D90", "#7D3C98", "#6B8E23", "#B8860B")


@dataclass(frozen=True)
class Broker:
    id: str
    name: str
    color: str
    kind: Literal["api", "manual"]
    builtin: bool


@dataclass(frozen=True)
class Connection:
    id: int
    broker_id: str
    account_mask: str
    status: ConnStatus
    last_synced_at: str | None
    last_error: str | None


@dataclass(frozen=True)
class HoldingRow:
    """어댑터·수동 입력이 넘기는 한 종목. `market=None`은 지원하지 않는 시장이다."""

    market: Literal["KR", "US"] | None
    code: str
    name: str
    quantity: Decimal
    avg_price: Decimal | None
    currency: str


@dataclass(frozen=True)
class Holding:
    broker_id: str
    connection_id: int
    market: Literal["KR", "US"] | None
    code: str
    name: str
    quantity: Decimal
    avg_price: Decimal | None
    currency: str
    source: Source
    updated_at: str

    @property
    def supported(self) -> bool:
        return self.market is not None


def _invalid(message: str, hint: str) -> VaterError:
    return VaterError("HOLDING_INVALID", message, hint, status=422)


def _holding(r: sqlite3.Row | tuple) -> Holding:  # type: ignore[type-arg]
    market = None if r[2] == OTHER_MARKET else r[2]
    avg = Decimal(r[6]) if r[6] is not None else None
    return Holding(r[0], r[1], market, r[3], r[4], Decimal(r[5]), avg, r[7], r[8], r[9])


_SELECT = (
    "SELECT broker_id, connection_id, market, code, name, quantity, avg_price, currency, "
    "source, updated_at FROM holdings "
)


class HoldingsRepo:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    # ---- 증권사 -----------------------------------------------------------

    def brokers(self) -> list[Broker]:
        rows = self._conn.execute(
            "SELECT id, name, color, kind, builtin FROM brokers ORDER BY builtin DESC, rowid"
        )
        return [Broker(r[0], r[1], r[2], r[3], bool(r[4])) for r in rows]

    def broker(self, broker_id: str) -> Broker | None:
        return next((b for b in self.brokers() if b.id == broker_id), None)

    def add_broker(self, name: str) -> Broker:
        clean = name.strip()
        if not 1 <= len(clean) <= MAX_BROKER_NAME:
            raise _invalid(
                "증권사 이름이 올바르지 않습니다.", f"1~{MAX_BROKER_NAME}자로 입력해 주세요."
            )
        existing = self.brokers()
        if any(b.name == clean for b in existing):
            raise _invalid("이미 있는 증권사입니다.", "목록에서 골라 주세요.")
        count = sum(1 for b in existing if not b.builtin)
        broker = Broker(
            f"c{count + 1}", clean, CUSTOM_COLORS[count % len(CUSTOM_COLORS)], "manual", False
        )
        with self._conn:
            self._conn.execute(
                "INSERT INTO brokers (id, name, color, kind, builtin) "
                "VALUES (?, ?, ?, 'manual', 0)",
                (broker.id, broker.name, broker.color),
            )
        return broker

    # ---- 연결 -------------------------------------------------------------

    def connections(self) -> list[Connection]:
        rows = self._conn.execute(
            "SELECT id, broker_id, account_mask, status, last_synced_at, last_error "
            "FROM connections ORDER BY id"
        )
        return [Connection(*r) for r in rows]

    def connection(self, conn_id: int) -> Connection | None:
        return next((c for c in self.connections() if c.id == conn_id), None)

    def add_connection(self, broker_id: str, account_mask: str) -> Connection:
        with self._conn:
            cur = self._conn.execute(
                "INSERT INTO connections (broker_id, account_mask) VALUES (?, ?)",
                (broker_id, account_mask),
            )
        return Connection(int(cur.lastrowid or 0), broker_id, account_mask, "ok", None, None)

    def set_status(self, conn_id: int, status: ConnStatus, error: str | None = None) -> None:
        with self._conn:
            self._conn.execute(
                "UPDATE connections SET status = ?, last_error = ? WHERE id = ?",
                (status, error, conn_id),
            )

    def remove_connection(self, conn_id: int) -> None:
        """연결과 그 보유 내역을 지운다."""
        with self._conn:
            self._conn.execute("DELETE FROM holdings WHERE connection_id = ?", (conn_id,))
            self._conn.execute("DELETE FROM connections WHERE id = ?", (conn_id,))

    # ---- 보유 내역 --------------------------------------------------------

    def _upsert(
        self, broker_id: str, connection_id: int, row: HoldingRow, source: Source, at: str
    ) -> None:
        self._conn.execute(
            "INSERT INTO holdings (broker_id, connection_id, market, code, name, quantity, "
            "avg_price, currency, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT (broker_id, connection_id, market, code) DO UPDATE SET "
            "name = excluded.name, quantity = excluded.quantity, avg_price = excluded.avg_price, "
            "currency = excluded.currency, source = excluded.source, "
            "updated_at = excluded.updated_at",
            (
                broker_id,
                connection_id,
                row.market or OTHER_MARKET,
                row.code,
                row.name,
                str(row.quantity),
                str(row.avg_price) if row.avg_price is not None else None,
                row.currency,
                source,
                at,
            ),
        )

    def replace_api(self, conn_id: int, rows: list[HoldingRow], at: str) -> None:
        """그 연결의 보유 내역을 응답 그대로 바꾼다. 응답에 없는 종목은 판 것이다."""
        conn = self.connection(conn_id)
        if conn is None:
            raise VaterError("CONNECTION_NOT_FOUND", "연결을 찾을 수 없습니다.", status=404)
        with self._conn:
            self._conn.execute("DELETE FROM holdings WHERE connection_id = ?", (conn_id,))
            for row in rows:
                self._upsert(conn.broker_id, conn_id, row, "api", at)
            self._conn.execute(
                "UPDATE connections SET status = 'ok', last_error = NULL, last_synced_at = ? "
                "WHERE id = ?",
                (at, conn_id),
            )

    def manual_upsert(
        self, broker_id: str, row: HoldingRow, at: str, source: Source = "manual"
    ) -> None:
        with self._conn:
            self._upsert(broker_id, MANUAL_CONNECTION, row, source, at)

    def manual_delete(self, broker_id: str, market: str, code: str) -> None:
        with self._conn:
            self._conn.execute(
                "DELETE FROM holdings WHERE broker_id = ? AND connection_id = 0 "
                "AND market = ? AND code = ?",
                (broker_id, market, code),
            )

    def replace_manual(
        self, broker_id: str, rows: list[HoldingRow], source: Source, at: str
    ) -> None:
        """그 증권사의 수동 항목을 통째로 바꾼다. 한 트랜잭션이다."""
        with self._conn:
            self._conn.execute(
                "DELETE FROM holdings WHERE broker_id = ? AND connection_id = 0", (broker_id,)
            )
            for row in rows:
                self._upsert(broker_id, MANUAL_CONNECTION, row, source, at)

    def delete_broker_data(self, broker_id: str) -> None:
        with self._conn:
            self._conn.execute("DELETE FROM holdings WHERE broker_id = ?", (broker_id,))

    def all(self) -> list[Holding]:
        rows = self._conn.execute(_SELECT + "ORDER BY market, code, broker_id")
        return [_holding(r) for r in rows]

    def by_symbol(self, market: str, code: str) -> list[Holding]:
        rows = self._conn.execute(
            _SELECT + "WHERE market = ? AND code = ? ORDER BY broker_id",
            (market, code),
        )
        return [_holding(r) for r in rows]
