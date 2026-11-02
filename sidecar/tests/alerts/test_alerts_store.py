import sqlite3
from datetime import date
from pathlib import Path

import pytest

from vater_core.alerts.store import BarRepo, EventRepo, RuleRepo, WatchlistRepo
from vater_core.analysis.symbols import resolve_target
from vater_core.api.errors import VaterError
from vater_core.kis.models import Bar
from vater_core.store.db import open_db


@pytest.fixture
def db(tmp_path: Path) -> sqlite3.Connection:
    conn = open_db(tmp_path)
    conn.executemany(
        "INSERT INTO symbols (market, code, exchange, name, name_en, kind) VALUES (?,?,?,?,?,?)",
        [
            ("KR", "005930", "KOSPI", "삼성전자", None, "stock"),
            ("US", "AAPL", "NAS", "애플", "APPLE INC", "stock"),
        ],
    )
    conn.commit()
    return conn


def test_migration_creates_daily_bars(db: sqlite3.Connection) -> None:
    cols = {r[1] for r in db.execute("PRAGMA table_info(daily_bars)")}
    assert cols == {"market", "code", "day", "open", "high", "low", "close", "volume"}


def test_watchlist_add_list_remove(db: sqlite3.Connection) -> None:
    repo = WatchlistRepo(db)
    a = repo.add(resolve_target(db, "KR", "005930"))
    b = repo.add(resolve_target(db, "US", "AAPL"))
    assert (a.market, a.code, a.exchange, a.name) == ("KR", "005930", "KOSPI", "삼성전자")
    assert [w.code for w in repo.list()] == ["005930", "AAPL"]
    assert repo.get(b.id).exchange == "NAS"
    with pytest.raises(VaterError) as e:
        repo.add(resolve_target(db, "KR", "005930"))
    assert (e.value.code, e.value.status) == ("WATCHLIST_DUPLICATE", 409)
    repo.remove(a.id)
    assert [w.code for w in repo.list()] == ["AAPL"]
    with pytest.raises(VaterError) as e:
        repo.get(a.id)
    assert (e.value.code, e.value.status) == ("WATCHLIST_NOT_FOUND", 404)
    with pytest.raises(VaterError):
        repo.remove(a.id)


def test_rules_crud_and_cascade(db: sqlite3.Connection) -> None:
    w = WatchlistRepo(db).add(resolve_target(db, "KR", "005930"))
    rules = RuleRepo(db)
    r = rules.create(w.id, "rsi", {"period": 14}, "close", True)
    assert (r.kind, r.params, r.timing, r.enabled, r.last_state) == (
        "rsi",
        {"period": 14},
        "close",
        True,
        None,
    )
    rules.set_state(r.id, True)
    rules.mark_fired(r.id, "2026-11-03T10:00:00+09:00")
    got = rules.get(r.id)
    assert got.last_state is True and got.last_fired_at == "2026-11-03T10:00:00+09:00"
    # 조건을 바꾸면 기준값을 다시 잡는다
    changed = rules.update(r.id, params={"period": 9})
    assert changed.params == {"period": 9} and changed.last_state is None
    off = rules.update(r.id, enabled=False)
    assert off.enabled is False and off.params == {"period": 9}
    assert rules.list(enabled_only=True) == []
    assert [x.id for x in rules.list(watchlist_id=w.id)] == [r.id]
    WatchlistRepo(db).remove(w.id)  # 감시 종목을 지우면 규칙도 지워진다
    assert rules.list() == []
    with pytest.raises(VaterError) as e:
        rules.get(r.id)
    assert (e.value.code, e.value.status) == ("ALERT_RULE_NOT_FOUND", 404)


def test_events_newest_first_with_symbol(db: sqlite3.Connection) -> None:
    w = WatchlistRepo(db).add(resolve_target(db, "KR", "005930"))
    r = RuleRepo(db).create(w.id, "price_above", {"price": 1}, "realtime", True)
    events = EventRepo(db)
    first = events.add(
        r.id, "2026-11-03T09:10:00+09:00", 230000.0, "현재가 230,000 — 목표가 1 이상"
    )
    second = events.add(None, "2026-11-03T09:20:00+09:00", None, "AI 분석 완료: 삼성전자")
    got = events.list()
    assert [e.id for e in got] == [second, first]
    assert (got[1].market, got[1].code, got[1].name, got[1].kind) == (
        "KR",
        "005930",
        "삼성전자",
        "price_above",
    )
    assert got[0].rule_id is None and got[0].kind is None
    assert [e.id for e in events.list(limit=1)] == [second]
    assert [e.id for e in events.on_day(date(2026, 11, 3))] == [first, second]


def test_bars_upsert_history_last_day(db: sqlite3.Connection) -> None:
    bars = BarRepo(db)
    assert bars.last_day("KR", "005930") is None
    rows = [
        Bar(date(2026, 10, 30), 100, 110, 90, 105, 1000),
        Bar(date(2026, 11, 2), 105, 115, 95, 112, 2000),
    ]
    assert bars.upsert("KR", "005930", rows) == 2
    bars.upsert("KR", "005930", [Bar(date(2026, 11, 2), 105, 116, 95, 113, 2100)])  # 덮어쓰기
    h = bars.history("KR", "005930")
    assert h.days == (date(2026, 10, 30), date(2026, 11, 2))
    assert h.close == (105.0, 113.0) and h.volume == (1000.0, 2100.0)
    assert bars.last_day("KR", "005930") == date(2026, 11, 2)
    assert bars.history("KR", "005930", limit=1).days == (date(2026, 11, 2),)


def test_re_enabling_a_rule_resets_its_baseline(db: sqlite3.Connection) -> None:
    # 꺼 둔 동안 조건이 참이 됐어도, 다시 켜는 순간 바로 울리지 않게 기준값을 새로 잡는다
    item = WatchlistRepo(db).add(resolve_target(db, "KR", "005930"))
    rules = RuleRepo(db)
    r = rules.create(item.id, "price_above", {"price": 1}, "realtime", True)
    rules.set_state(r.id, False)
    rules.update(r.id, enabled=False)
    assert rules.get(r.id).last_state is False  # 끌 때는 그대로

    assert rules.update(r.id, enabled=True).last_state is None
    rules.set_state(r.id, True)
    assert rules.update(r.id, enabled=True).last_state is True  # 이미 켜진 규칙은 그대로
