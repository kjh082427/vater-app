"""증권사·연결·보유 내역 저장소 (v2 설계 1, 2, 5장)."""

import sqlite3
from decimal import Decimal
from pathlib import Path

import pytest

from vater_core.api.errors import VaterError
from vater_core.store.db import _migrations, migrate, open_db
from vater_core.store.holdings import (
    CUSTOM_COLORS,
    HoldingRow,
    HoldingsRepo,
)

AT = "2026-11-05T01:00:00Z"


def row(code: str = "005930", qty: str = "10", avg: str | None = "60000") -> HoldingRow:
    return HoldingRow("KR", code, "삼성전자", Decimal(qty), Decimal(avg) if avg else None, "KRW")


@pytest.fixture
def repo(tmp_path: Path) -> HoldingsRepo:
    return HoldingsRepo(open_db(tmp_path))


def test_builtin_brokers_and_colors(repo: HoldingsRepo) -> None:
    got = {b.id: (b.name, b.color, b.kind) for b in repo.brokers()}
    assert got == {
        "kis": ("한국투자", "#7B634F", "api"),
        "meritz": ("메리츠", "#D14C34", "api"),
        "kiwoom": ("키움", "#D4467D", "api"),
        "samsung": ("삼성", "#1C2FA7", "manual"),
        "mirae": ("미래에셋", "#D97A00", "manual"),
    }


def test_add_broker_assigns_palette_in_order_and_wraps(repo: HoldingsRepo) -> None:
    colors = [repo.add_broker(f"증권{i}").color for i in range(len(CUSTOM_COLORS) + 1)]
    assert colors[: len(CUSTOM_COLORS)] == list(CUSTOM_COLORS)
    assert colors[-1] == CUSTOM_COLORS[0]
    assert repo.add_broker("  신한  ").name == "신한"


@pytest.mark.parametrize("name", ["", "   ", "가" * 21, "메리츠", "  키움 "])
def test_add_broker_rejects_blank_long_or_duplicate(repo: HoldingsRepo, name: str) -> None:
    with pytest.raises(VaterError) as e:
        repo.add_broker(name)
    assert e.value.code == "HOLDING_INVALID" and e.value.status == 422


def test_custom_broker_ids_stay_unique_after_data_delete(repo: HoldingsRepo) -> None:
    a = repo.add_broker("A증권")
    b = repo.add_broker("B증권")
    assert a.id != b.id


def test_connection_round_trip(repo: HoldingsRepo) -> None:
    c = repo.add_connection("kiwoom", "****1234")
    assert (c.broker_id, c.account_mask, c.status, c.last_synced_at) == (
        "kiwoom",
        "****1234",
        "ok",
        None,
    )
    repo.set_status(c.id, "lost", "BROKER_AUTH_INVALID")
    got = repo.connections()[0]
    assert (got.status, got.last_error) == ("lost", "BROKER_AUTH_INVALID")


def test_replace_api_adds_updates_and_removes_sold(repo: HoldingsRepo) -> None:
    c = repo.add_connection("kiwoom", "****1")
    repo.replace_api(c.id, [row("005930", "10"), row("000660", "3")], AT)
    repo.replace_api(c.id, [row("005930", "12")], AT)
    assert [(h.code, h.quantity) for h in repo.all()] == [("005930", Decimal("12"))]
    assert repo.connections()[0].last_synced_at == AT


def test_replace_api_keeps_other_connections_and_manual(repo: HoldingsRepo) -> None:
    a = repo.add_connection("kiwoom", "****1")
    b = repo.add_connection("meritz", "****2")
    repo.replace_api(a.id, [row(qty="1")], AT)
    repo.replace_api(b.id, [row(qty="2")], AT)
    repo.manual_upsert("samsung", row(qty="3"), AT)
    repo.replace_api(a.id, [], AT)
    assert sorted(h.broker_id for h in repo.all()) == ["meritz", "samsung"]


def test_decimal_round_trip_for_fractional_shares(repo: HoldingsRepo) -> None:
    c = repo.add_connection("kis", "****1")
    repo.replace_api(c.id, [HoldingRow("US", "AAPL", "애플", Decimal("0.123456"), None, "USD")], AT)
    h = repo.by_symbol("US", "AAPL")[0]
    assert h.quantity == Decimal("0.123456") and h.avg_price is None and h.currency == "USD"


def test_unsupported_market_is_stored_but_flagged(repo: HoldingsRepo) -> None:
    c = repo.add_connection("kis", "****1")
    repo.replace_api(c.id, [HoldingRow(None, "7203", "토요타", Decimal("1"), None, "JPY")], AT)
    h = repo.all()[0]
    assert h.market is None and h.supported is False


def test_manual_upsert_updates_and_deletes(repo: HoldingsRepo) -> None:
    repo.manual_upsert("samsung", row(qty="3"), AT)
    repo.manual_upsert("samsung", row(qty="4"), AT)
    assert [h.quantity for h in repo.by_symbol("KR", "005930")] == [Decimal("4")]
    assert repo.all()[0].source == "manual"
    repo.manual_delete("samsung", "KR", "005930")
    assert repo.all() == []


def test_delete_broker_data_only_touches_that_broker(repo: HoldingsRepo) -> None:
    repo.manual_upsert("samsung", row(), AT)
    repo.manual_upsert("mirae", row(), AT)
    repo.delete_broker_data("mirae")
    assert [h.broker_id for h in repo.all()] == ["samsung"]


def test_upgrading_a_v0_1_0_database_keeps_watchlist_and_rules(tmp_path: Path) -> None:
    conn = sqlite3.connect(tmp_path / "old.db")
    conn.execute("CREATE TABLE schema_version (version INTEGER NOT NULL)")
    for version, sql in _migrations():
        if version <= 3:
            conn.executescript(sql)
            conn.execute("INSERT INTO schema_version VALUES (?)", (version,))
    conn.execute("INSERT INTO watchlist (market, code) VALUES ('KR', '005930')")
    conn.execute(
        "INSERT INTO alert_rules (watchlist_id, kind, params, timing) "
        "VALUES (1, 'rsi', '{}', 'close')"
    )
    conn.commit()
    migrate(conn)
    assert conn.execute("SELECT COUNT(*) FROM watchlist").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM alert_rules").fetchone()[0] == 1
    assert len(HoldingsRepo(conn).brokers()) == 5
