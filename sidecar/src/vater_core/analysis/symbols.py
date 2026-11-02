"""앱의 종목(시장 + 코드) → TradingAgents 티커 (스펙 2-5).

국내는 한투 종목 마스터의 거래소로 접미사를 정한다: 코스피 `.KS`, 코스닥 `.KQ`.
"""

import sqlite3
from dataclasses import dataclass
from typing import Literal, cast

from vater_core.api.errors import VaterError

MarketId = Literal["KR", "US"]
_SUFFIX = {"KOSPI": ".KS", "KOSDAQ": ".KQ"}
DOMESTIC_ANALYSTS = ("market", "news", "fundamentals")  # 소셜 데이터가 거의 없다 (스펙 5장)
US_ANALYSTS = ("market", "social", "news", "fundamentals")


@dataclass(frozen=True)
class Target:
    market: MarketId
    code: str
    exchange: str
    name: str
    ticker: str

    @property
    def domestic(self) -> bool:
        return self.market == "KR"


def resolve_target(conn: sqlite3.Connection, market: str, code: str) -> Target:
    row = conn.execute(
        "SELECT market, code, exchange, name FROM symbols WHERE market = ? AND code = ?",
        (market, code),
    ).fetchone()
    if row is None:
        raise VaterError(
            "SYMBOL_UNKNOWN",
            f"종목을 찾을 수 없습니다: {market} {code}",
            hint="종목 검색에서 다시 골라 주세요. 방금 상장한 종목이면 내일 다시 시도하세요.",
            status=404,
        )
    m, c, exchange, name = row
    ticker = f"{c}{_SUFFIX.get(exchange, '')}" if m == "KR" else c
    return Target(cast(MarketId, m), c, exchange, name, ticker)


def analysts_for(target: Target) -> tuple[str, ...]:
    return DOMESTIC_ANALYSTS if target.domestic else US_ANALYSTS
