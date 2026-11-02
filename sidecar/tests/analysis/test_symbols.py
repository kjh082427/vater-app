import sqlite3

import pytest

from vater_core.analysis.symbols import analysts_for, resolve_target
from vater_core.api.errors import VaterError


@pytest.mark.parametrize(
    ("market", "code", "ticker", "domestic"),
    [
        ("KR", "005930", "005930.KS", True),
        ("KR", "247540", "247540.KQ", True),
        ("US", "AAPL", "AAPL", False),
    ],
)
def test_kospi_kosdaq_us_tickers(
    db: sqlite3.Connection, market: str, code: str, ticker: str, domestic: bool
) -> None:
    t = resolve_target(db, market, code)
    assert (t.ticker, t.domestic) == (ticker, domestic)


def test_target_carries_name_and_exchange(db: sqlite3.Connection) -> None:
    t = resolve_target(db, "KR", "005930")
    assert (t.name, t.exchange) == ("삼성전자", "KOSPI")


def test_unknown_symbol(db: sqlite3.Connection) -> None:
    with pytest.raises(VaterError) as e:
        resolve_target(db, "KR", "999999")
    assert (e.value.code, e.value.status) == ("SYMBOL_UNKNOWN", 404)


def test_analysts_for(db: sqlite3.Connection) -> None:
    assert analysts_for(resolve_target(db, "KR", "005930")) == ("market", "news", "fundamentals")
    assert analysts_for(resolve_target(db, "US", "AAPL")) == (
        "market",
        "social",
        "news",
        "fundamentals",
    )
