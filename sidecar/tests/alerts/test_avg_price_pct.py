"""평단가 기준 알림 (v2 설계 13장). 평단가는 합산 평단가이고, 보유가 없으면 울리지 않는다."""

import sqlite3
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import httpx
import pytest

from vater_core.alerts.evaluator import Evaluator
from vater_core.alerts.rules import History, Live, condition, parse_rule
from vater_core.alerts.store import EventRepo, RuleRepo, WatchItem, WatchlistRepo
from vater_core.analysis.symbols import resolve_target
from vater_core.api.deps import AppDeps
from vater_core.api.errors import VaterError
from vater_core.store.db import open_db
from vater_core.store.holdings import HoldingRow, HoldingsRepo

DAY = date(2026, 11, 3)
AT = "2026-11-03T00:00:00Z"
EMPTY = History((), (), (), (), (), ())
DOWN10 = {"pct": 10, "direction": "down"}


@pytest.fixture
def db(tmp_path: Path) -> sqlite3.Connection:
    conn = open_db(tmp_path)
    conn.execute(
        "INSERT INTO symbols (market, code, exchange, name, name_en, kind) "
        "VALUES ('KR','005930','KOSPI','삼성전자',NULL,'stock')"
    )
    conn.commit()
    return conn


def hold(db: sqlite3.Connection, qty: int, avg: int | None, broker: str = "samsung") -> None:
    row = HoldingRow(
        "KR", "005930", "삼성전자", Decimal(qty), None if avg is None else Decimal(avg), "KRW"
    )
    HoldingsRepo(db).manual_upsert(broker, row, AT)


def live(price: float, day: date = DAY) -> Live:
    return Live(day=day, price=price, change_pct=0.0, volume=1)


class Notes:
    def __init__(self) -> None:
        self.sent: list[str] = []

    def __call__(self, title: str, body: str, route: str | None = None) -> None:
        self.sent.append(body)


class Clock:
    at = datetime(2026, 11, 3, 1, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.at


def setup(
    db: sqlite3.Connection, params: dict[str, object] = DOWN10
) -> tuple[WatchItem, int, Evaluator, Notes]:
    item = WatchlistRepo(db).add(resolve_target(db, "KR", "005930"))
    rule = RuleRepo(db).create(item.id, "avg_price_pct", params, "realtime", True)
    notes = Notes()
    return item, rule.id, Evaluator(db, None, notes, Clock()), notes


def tick(
    db: sqlite3.Connection, ev: Evaluator, item: WatchItem, price: float, day: date = DAY
) -> int:
    return len(ev.evaluate(item, RuleRepo(db).list(item.id), EMPTY, live(price, day), day))


def test_params_are_validated() -> None:
    assert parse_rule("avg_price_pct", {}).model_dump() == {"pct": 10.0, "direction": "down"}
    for bad in ({"pct": 0}, {"pct": 101}, {"direction": "both"}, {"x": 1}):
        with pytest.raises(VaterError):
            parse_rule("avg_price_pct", bad)


def test_condition_is_pure_percent_of_average() -> None:
    p = parse_rule("avg_price_pct", DOWN10)
    down = condition(p, EMPTY, live(90), 100.0)
    assert (down.state, down.value) == (True, pytest.approx(-10.0))
    assert condition(p, EMPTY, live(90.5), 100.0).state is False
    up = parse_rule("avg_price_pct", {"pct": 10, "direction": "up"})
    assert condition(up, EMPTY, live(110), 100.0).state is True
    assert condition(up, EMPTY, live(90), 100.0).state is False
    assert condition(p, EMPTY, live(90), None).state is None
    assert condition(p, EMPTY, live(90), 0.0).state is None
    assert condition(p, EMPTY, live(0), 100.0).state is None  # 시세 없음은 -100%가 아니다
    assert condition(p, EMPTY, live(-1), 100.0).state is None


def test_fires_once_when_it_reaches_minus_ten_percent(db: sqlite3.Connection) -> None:
    hold(db, 15, 100)
    item, _, ev, notes = setup(db)
    assert tick(db, ev, item, 95) == 0  # 기준값만 저장
    assert tick(db, ev, item, 89) == 1
    assert tick(db, ev, item, 88) == 0  # 참 → 참
    assert tick(db, ev, item, 95) == 0  # 거짓으로 돌아갔다
    assert tick(db, ev, item, 89) == 0  # 하루 1번
    assert tick(db, ev, item, 95, DAY + timedelta(1)) == 0
    assert tick(db, ev, item, 89, DAY + timedelta(1)) == 1  # 다음 날은 다시
    events = EventRepo(db).list(10)
    assert len(events) == 2
    event = events[0]
    assert event.kind == "avg_price_pct" and "평단가 대비" in event.message
    assert "100" not in event.message  # 평단가 값은 알림 글에 넣지 않는다
    assert len(notes.sent) == 2


def test_uses_the_summed_average_of_all_brokers(db: sqlite3.Connection) -> None:
    hold(db, 10, 100, "samsung")
    hold(db, 10, 200, "kiwoom")  # 합산 평단가 150
    item, _, ev, _ = setup(db)
    assert tick(db, ev, item, 140) == 0
    assert tick(db, ev, item, 134) == 1  # 150의 -10% = 135


def test_not_held_or_no_average_never_fires(db: sqlite3.Connection) -> None:
    item, rid, ev, _ = setup(db)
    assert tick(db, ev, item, 1) == 0  # 보유 없음
    hold(db, 10, None)
    assert tick(db, ev, item, 1) == 0  # 평단가 없음
    assert RuleRepo(db).get(rid).last_state is None


def test_selling_everything_resets_the_baseline(db: sqlite3.Connection) -> None:
    hold(db, 10, 100)
    item, rid, ev, _ = setup(db)
    tick(db, ev, item, 95)
    assert RuleRepo(db).get(rid).last_state is False
    hold(db, 0, 100)  # 전량 매도
    assert tick(db, ev, item, 50) == 0
    assert RuleRepo(db).get(rid).last_state is None
    hold(db, 5, 100)  # 다시 사면 이미 참이어도 기준값부터 저장
    assert tick(db, ev, item, 50) == 0
    assert RuleRepo(db).get(rid).last_state is True


async def test_bulk_apply_is_allowed(client: httpx.AsyncClient, deps: AppDeps) -> None:
    assert deps.db is not None
    deps.db.execute(
        "INSERT INTO symbols (market, code, exchange, name, name_en, kind) "
        "VALUES ('KR','005930','KOSPI','삼성전자',NULL,'stock')"
    )
    deps.db.commit()
    r = await client.post(
        "/holdings/watch",
        json={
            "items": [{"market": "KR", "code": "005930"}],
            "rule": {"kind": "avg_price_pct", "params": {"pct": 15, "direction": "down"}},
        },
    )
    assert (r.status_code, r.json()["rules"]) == (200, 1)
    [rule] = (await client.get("/alerts/rules")).json()
    assert (rule["kind"], rule["timing"], rule["params"]) == (
        "avg_price_pct",
        "realtime",
        {"pct": 15.0, "direction": "down"},
    )
    kinds = {k["kind"]: k for k in (await client.get("/alerts/kinds")).json()}
    assert kinds["avg_price_pct"]["timing"] == "realtime"
    assert kinds["avg_price_pct"]["required"] == []


def test_alerts_never_reach_the_llm() -> None:
    """알림은 평단가를 다루므로 AI(llm, 분석 엔진)를 부르는 코드를 가져오면 안 된다 (스펙 8-1)."""
    import re

    src = Path(__file__).parents[2] / "src/vater_core/alerts"
    for f in src.glob("*.py"):
        text = f.read_text(encoding="utf-8")
        assert not re.search(
            r"^\s*(from|import) vater_core\.(llm|briefing|analysis\.(engine|runner|queue))",
            text,
            re.M,
        ), f.name


def test_zero_price_neither_fires_nor_loses_the_baseline(db: sqlite3.Connection) -> None:
    hold(db, 10, 100)
    item, rid, ev, _ = setup(db)
    tick(db, ev, item, 95)
    assert tick(db, ev, item, 0) == 0
    assert RuleRepo(db).get(rid).last_state is False
    assert tick(db, ev, item, 89) == 1


def test_correcting_the_average_alone_does_not_fire(db: sqlite3.Connection) -> None:
    hold(db, 10, 100)
    item, rid, ev, _ = setup(db)
    assert tick(db, ev, item, 95) == 0  # 거짓
    hold(db, 10, 120)  # 시세는 그대로인데 평단가를 고쳤다: -20.8%로 참이 된다
    assert tick(db, ev, item, 95) == 0
    assert RuleRepo(db).get(rid).last_state is True
    assert RuleRepo(db).get(rid).last_avg == 120
    assert tick(db, ev, item, 110) == 0  # 새 평단가로 거짓
    assert tick(db, ev, item, 100) == 1  # 시세가 움직여 도달하면 울린다


def test_average_correction_while_the_app_was_off_does_not_fire(db: sqlite3.Connection) -> None:
    hold(db, 10, 100)
    item, _, ev, notes = setup(db)
    tick(db, ev, item, 95)
    hold(db, 10, 120)
    assert tick(db, Evaluator(db, None, notes, Clock()), item, 95) == 0  # 기준은 DB에 남아 있다
