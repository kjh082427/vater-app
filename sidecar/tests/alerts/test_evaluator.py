import asyncio
import sqlite3
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from vater_core.alerts.evaluator import Evaluator, record_event_alerts
from vater_core.alerts.rules import History, Live
from vater_core.alerts.store import EventRepo, RuleRepo, WatchItem, WatchlistRepo
from vater_core.analysis.store import AnalysisRepo
from vater_core.analysis.symbols import resolve_target
from vater_core.api.events import Event, EventBus
from vater_core.store.db import open_db

KR_DAY = date(2026, 11, 3)


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


class Notes:
    """Tauri로 나가는 Windows 알림 요청을 기록한다."""

    def __init__(self) -> None:
        self.sent: list[tuple[str, str, str | None]] = []

    def __call__(self, title: str, body: str, route: str | None = None) -> None:
        self.sent.append((title, body, route))


class Clock:
    def __init__(self, at: datetime) -> None:
        self.at = at

    def __call__(self) -> datetime:
        return self.at


EMPTY = History((), (), (), (), (), ())


def closes(values: list[float], end: date = KR_DAY) -> History:
    days = tuple(end - timedelta(days=len(values) - i) for i in range(len(values)))
    v = tuple(float(x) for x in values)
    return History(days, v, v, v, v, tuple(1000.0 for _ in values))


def live(price: float, day: date = KR_DAY) -> Live:
    return Live(day=day, price=price, change_pct=0.0, volume=1000)


def watch(db: sqlite3.Connection, market: str = "KR", code: str = "005930") -> WatchItem:
    return WatchlistRepo(db).add(resolve_target(db, market, code))


def make(
    db: sqlite3.Connection, at: datetime | None = None
) -> tuple[Evaluator, Notes, Clock, EventBus]:
    notes = Notes()
    clock = Clock(at or datetime(2026, 11, 3, 1, 0, tzinfo=UTC))  # 10:00 KST
    bus = EventBus()
    return Evaluator(db, bus, notes, clock), notes, clock, bus


def rows(db: sqlite3.Connection) -> list[tuple[Any, ...]]:
    return db.execute("SELECT rule_id, fired_at, value, message FROM alert_events").fetchall()


def test_first_evaluation_only_stores_baseline(db: sqlite3.Connection) -> None:
    item = watch(db)
    rules = RuleRepo(db)
    rule = rules.create(item.id, "price_above", {"price": 60000}, "realtime", True)
    ev, notes, _, _ = make(db)

    fired = ev.evaluate(item, [rule], EMPTY, live(70000), KR_DAY)

    assert fired == []
    assert notes.sent == []
    assert rows(db) == []
    assert rules.get(rule.id).last_state is True


async def test_false_to_true_fires_once_with_notify_sse_and_row(db: sqlite3.Connection) -> None:
    item = watch(db)
    rules = RuleRepo(db)
    rule = rules.create(item.id, "price_above", {"price": 60000}, "realtime", True)
    rules.set_state(rule.id, False)
    ev, notes, _, bus = make(db)
    sub = bus.subscribe()

    fired = ev.evaluate(item, [rules.get(rule.id)], EMPTY, live(70000), KR_DAY)

    condition_text = "현재가 70,000 — 목표가 60,000 이상"
    assert notes.sent == [("알림: 삼성전자", condition_text, "/symbols/KR/005930")]
    assert rows(db) == [
        (rule.id, "2026-11-03T10:00:00+09:00", 70000.0, f"삼성전자 {condition_text}")
    ]
    assert len(fired) == 1
    e = fired[0]
    assert (e.rule_id, e.market, e.code, e.name, e.kind) == (
        rule.id,
        "KR",
        "005930",
        "삼성전자",
        "price_above",
    )
    sse: Event = await asyncio.wait_for(anext(sub), 1)
    assert sse.type == "alert.fired"
    assert sse.data["id"] == e.id and sse.data["message"] == e.message
    after = rules.get(rule.id)
    assert after.last_state is True
    assert after.last_fired_at == "2026-11-03T10:00:00+09:00"


def test_flicker_within_a_day_fires_only_once(db: sqlite3.Connection) -> None:
    item = watch(db)
    rules = RuleRepo(db)
    rule = rules.create(item.id, "price_above", {"price": 60000}, "realtime", True)
    rules.set_state(rule.id, False)
    ev, notes, clock, _ = make(db)

    for minute, price in enumerate([70000, 59000, 71000, 58000, 72000]):
        clock.at = datetime(2026, 11, 3, 1, minute, tzinfo=UTC)
        ev.evaluate(item, [rules.get(rule.id)], EMPTY, live(price), KR_DAY)

    assert len(notes.sent) == 1
    assert len(rows(db)) == 1
    assert rules.get(rule.id).last_state is True  # 상태는 계속 따라간다


def test_next_session_day_can_fire_again(db: sqlite3.Connection) -> None:
    item = watch(db)
    rules = RuleRepo(db)
    rule = rules.create(item.id, "price_above", {"price": 60000}, "realtime", True)
    rules.set_state(rule.id, False)
    ev, notes, clock, _ = make(db)
    ev.evaluate(item, [rules.get(rule.id)], EMPTY, live(70000), KR_DAY)

    nxt = date(2026, 11, 4)
    clock.at = datetime(2026, 11, 4, 1, 0, tzinfo=UTC)
    ev.evaluate(item, [rules.get(rule.id)], EMPTY, live(59000, nxt), nxt)
    ev.evaluate(item, [rules.get(rule.id)], EMPTY, live(70000, nxt), nxt)

    assert len(notes.sent) == 2


def test_us_cooldown_uses_new_york_date(db: sqlite3.Connection) -> None:
    # 뉴욕 11/3 15:00 = 한국 11/4 05:00. 같은 뉴욕 세션 안에서는 다시 울리지 않는다.
    item = watch(db, "US", "AAPL")
    rules = RuleRepo(db)
    rule = rules.create(item.id, "price_above", {"price": 200}, "realtime", True)
    rules.set_state(rule.id, False)
    ny_day = date(2026, 11, 3)
    ev, notes, clock, _ = make(db, datetime(2026, 11, 3, 20, 0, tzinfo=UTC))  # 15:00 NY
    ev.evaluate(item, [rules.get(rule.id)], EMPTY, live(210, ny_day), ny_day)
    assert rules.get(rule.id).last_fired_at == "2026-11-04T05:00:00+09:00"

    clock.at = datetime(2026, 11, 3, 20, 30, tzinfo=UTC)  # 15:30 NY, 같은 세션
    ev.evaluate(item, [rules.get(rule.id)], EMPTY, live(190, ny_day), ny_day)
    ev.evaluate(item, [rules.get(rule.id)], EMPTY, live(211, ny_day), ny_day)
    assert len(notes.sent) == 1

    ny_next = date(2026, 11, 4)
    clock.at = datetime(2026, 11, 4, 15, 0, tzinfo=UTC)  # 10:00 NY 다음 세션
    ev.evaluate(item, [rules.get(rule.id)], EMPTY, live(190, ny_next), ny_next)
    ev.evaluate(item, [rules.get(rule.id)], EMPTY, live(212, ny_next), ny_next)
    assert len(notes.sent) == 2
    assert notes.sent[-1][2] == "/symbols/US/AAPL"


@pytest.mark.parametrize("previous", [None, False, True])
def test_unknown_reading_leaves_state_untouched(
    db: sqlite3.Connection, previous: bool | None
) -> None:
    # 신규 상장처럼 일봉이 부족하면 계산 불가 → 상태를 바꾸지도 울리지도 않는다
    item = watch(db)
    rules = RuleRepo(db)
    rule = rules.create(item.id, "ma_cross", {"fast": 5, "slow": 20}, "close", True)
    if previous is not None:
        rules.set_state(rule.id, previous)
    ev, notes, _, _ = make(db)

    fired = ev.evaluate(item, [rules.get(rule.id)], closes([100, 101, 102]), None, KR_DAY)

    assert fired == [] and notes.sent == []
    assert rules.get(rule.id).last_state is previous


def test_live_evaluates_realtime_rules_and_close_pass_evaluates_close_rules(
    db: sqlite3.Connection,
) -> None:
    item = watch(db)
    rules = RuleRepo(db)
    rt = rules.create(item.id, "price_above", {"price": 15}, "realtime", True)
    cl = rules.create(item.id, "ma_break", {"period": 3, "direction": "above"}, "close", True)
    rules.set_state(rt.id, False)
    rules.set_state(cl.id, False)
    ev, notes, _, _ = make(db)
    history = closes([10, 10, 10, 10, 20])  # 마지막 종가 20 > 3일 평균 13.33

    ev.evaluate(item, rules.list(item.id), history, live(20), KR_DAY)
    assert rules.get(rt.id).last_state is True
    assert rules.get(cl.id).last_state is False
    assert len(notes.sent) == 1

    rules.set_state(rt.id, False)
    ev.evaluate(item, rules.list(item.id), history, None, KR_DAY)
    assert rules.get(cl.id).last_state is True
    assert rules.get(rt.id).last_state is False
    assert len(notes.sent) == 2
    assert notes.sent[1][1].startswith("3일 이동평균")


def test_disabled_rule_is_skipped(db: sqlite3.Connection) -> None:
    item = watch(db)
    rules = RuleRepo(db)
    rule = rules.create(item.id, "price_above", {"price": 60000}, "realtime", False)
    rules.set_state(rule.id, False)
    ev, notes, _, _ = make(db)

    ev.evaluate(item, [rules.get(rule.id)], EMPTY, live(70000), KR_DAY)

    assert notes.sent == []
    assert rules.get(rule.id).last_state is False


def test_broken_stored_params_do_not_block_other_rules(db: sqlite3.Connection) -> None:
    item = watch(db)
    rules = RuleRepo(db)
    broken = rules.create(item.id, "price_above", {}, "realtime", True)  # 필수 price 없음
    good = rules.create(item.id, "price_above", {"price": 60000}, "realtime", True)
    rules.set_state(broken.id, False)
    rules.set_state(good.id, False)
    ev, notes, _, _ = make(db)

    ev.evaluate(item, rules.list(item.id), EMPTY, live(70000), KR_DAY)

    assert len(notes.sent) == 1
    assert rules.get(broken.id).last_state is False


async def test_analysis_results_are_recorded_as_event_alerts(db: sqlite3.Connection) -> None:
    analyses = AnalysisRepo(db)
    aid = analyses.create(resolve_target(db, "KR", "005930"), "2026-11-03", "cloud")
    bid = analyses.create(resolve_target(db, "US", "AAPL"), "2026-11-03", "cloud")
    bus = EventBus()
    stop = record_event_alerts(bus, db, now=Clock(datetime(2026, 11, 3, 7, 0, tzinfo=UTC)))

    bus.publish("analysis.status", {"id": aid, "status": "running"})
    bus.publish("analysis.status", {"id": aid, "status": "done", "decision": "Overweight"})
    error = {"code": "X", "message": "한도 초과", "hint": None}
    bus.publish("analysis.status", {"id": bid, "status": "failed", "error": error})
    await asyncio.sleep(0.05)
    stop()
    bus.publish("analysis.status", {"id": aid, "status": "done", "decision": "Buy"})
    await asyncio.sleep(0.05)

    assert rows(db) == [
        (None, "2026-11-03T16:00:00+09:00", None, "AI 분석 완료: 삼성전자 — 비중확대"),
        (None, "2026-11-03T16:00:00+09:00", None, "AI 분석 실패: 애플 — 한도 초과"),
    ]
    assert [e.kind for e in EventRepo(db).list()] == [None, None]
    assert bus.subscriber_count == 0
