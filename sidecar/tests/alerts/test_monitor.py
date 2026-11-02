import asyncio
import sqlite3
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest

from vater_core.alerts.clock import MarketClock
from vater_core.alerts.monitor import AlertMonitor
from vater_core.alerts.store import BarRepo, RuleRepo, WatchItem, WatchlistRepo
from vater_core.analysis.symbols import resolve_target
from vater_core.api.deps import AppDeps
from vater_core.api.errors import VaterError
from vater_core.api.events import EventBus
from vater_core.kis.client import KisApiError
from vater_core.kis.models import Bar, Quote
from vater_core.kis.ws import Tick
from vater_core.store.db import open_db
from vater_core.store.settings import SettingsRepo

KR_OPEN = datetime(2026, 11, 3, 1, 0, tzinfo=UTC)  # 화 10:00 KST, 뉴욕은 장 전
KR_AFTER = datetime(2026, 11, 3, 6, 41, tzinfo=UTC)  # 15:41 KST (마감 15:30 + 10분 지남)
KR_SETTLING = datetime(2026, 11, 3, 6, 35, tzinfo=UTC)  # 15:35 KST (마감했지만 확정 전)
DAY = date(2026, 11, 3)
CODES = ["005930", "000660", "035420"]


@pytest.fixture
def db(tmp_path: Path) -> sqlite3.Connection:
    conn = open_db(tmp_path)
    conn.executemany(
        "INSERT INTO symbols (market, code, exchange, name, name_en, kind) VALUES (?,?,?,?,?,?)",
        [
            ("KR", "005930", "KOSPI", "삼성전자", None, "stock"),
            ("KR", "000660", "KOSPI", "SK하이닉스", None, "stock"),
            ("KR", "035420", "KOSPI", "NAVER", None, "stock"),
            ("KR", "005380", "KOSPI", "현대차", None, "stock"),
        ],
    )
    conn.commit()
    return conn


class Clock:
    def __init__(self, at: datetime) -> None:
        self.at = at

    def __call__(self) -> datetime:
        return self.at


class FakeRealtime:
    """KisRealtime과 같은 모양: 한도 안에서만 구독을 받는다."""

    def __init__(
        self, on_tick: Callable[[Tick], None], on_state: Callable[[str], None], max_subs: int
    ) -> None:
        self.on_tick = on_tick
        self.on_state = on_state
        self.max = max_subs
        self.subs: list[tuple[str, str]] = []
        self.state = "connected"
        self.running = False
        self.cancelled = False

    async def subscribe(self, market: str, code: str, exchange: str | None = None) -> bool:
        if (market, code) in self.subs:
            return True
        if len(self.subs) >= self.max:
            return False
        self.subs.append((market, code))
        return True

    async def unsubscribe(self, market: str, code: str, exchange: str | None = None) -> None:
        if (market, code) in self.subs:
            self.subs.remove((market, code))

    @property
    def subscriptions(self) -> list[tuple[str, str]]:
        return list(self.subs)

    async def run(self) -> None:
        self.running = True
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.cancelled = True
            raise


class Market:
    """가짜 한투: 현재가와 일봉. `fail`에 예외를 넣으면 그 예외를 낸다."""

    def __init__(self, db: sqlite3.Connection) -> None:
        self.db = db
        self.prices: dict[str, float] = {}
        self.price_calls: list[str] = []
        self.bar_calls: list[tuple[str, date]] = []
        self.closes: dict[str, float] = {}  # through 날짜에 넣을 종가
        self.fail: Exception | None = None
        self.fail_for: dict[str, Exception] = {}  # 종목별 오류

    async def price(self, item: WatchItem) -> Quote:
        self.price_calls.append(item.code)
        if self.fail is not None:
            raise self.fail
        if item.code in self.fail_for:
            raise self.fail_for[item.code]
        return Quote("KR", item.code, self.prices.get(item.code, 100.0), 0.0, 0.0, 1000)

    async def bars(self, item: WatchItem, through: date) -> int:
        self.bar_calls.append((item.code, through))
        if self.fail is not None:
            raise self.fail
        if item.code in self.fail_for:
            raise self.fail_for[item.code]
        if item.code not in self.closes:
            return 0
        c = self.closes[item.code]
        return BarRepo(self.db).upsert(item.market, item.code, [Bar(through, c, c, c, c, 1000)])


class Notes:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str, str | None]] = []

    def __call__(self, title: str, body: str, route: str | None = None) -> None:
        self.sent.append((title, body, route))


class Rig:
    def __init__(self, db: sqlite3.Connection, at: datetime, throttle: float = 0.05) -> None:
        self.db = db
        self.clock = Clock(at)
        self.bus = EventBus()
        self.deps = AppDeps(token="t", dev=True, data_dir=Path("."), db=db, events=self.bus)
        self.market = Market(db)
        self.notes = Notes()
        self.realtime: FakeRealtime | None = None

        async def trading_day(_: date) -> bool:
            return True

        def factory(
            on_tick: Callable[[Tick], None], on_state: Callable[[str], None], max_subs: int
        ) -> FakeRealtime:
            self.realtime = FakeRealtime(on_tick, on_state, max_subs)
            return self.realtime

        self.sleeps: list[float] = []

        async def sleep(seconds: float) -> None:
            self.sleeps.append(seconds)
            await asyncio.sleep(0)

        self.monitor = AlertMonitor(
            self.deps,
            clock=MarketClock(trading_day, now=self.clock),
            realtime_factory=factory,
            price_fn=self.market.price,
            bars_fn=self.market.bars,
            sleep=sleep,
            notify_fn=self.notes,
            now=self.clock,
            throttle=throttle,
        )

    def watch(self, code: str, kind: str = "price_above", **params: Any) -> tuple[WatchItem, int]:
        repo = WatchlistRepo(self.db)
        item = next((w for w in repo.list() if w.code == code), None) or repo.add(
            resolve_target(self.db, "KR", code)
        )
        timing = "close" if kind == "ma_break" else "realtime"
        rule = RuleRepo(self.db).create(item.id, kind, params or {"price": 60000}, timing, True)
        RuleRepo(self.db).set_state(rule.id, False)
        return item, rule.id

    def state(self, rule_id: int) -> bool | None:
        return RuleRepo(self.db).get(rule_id).last_state


async def test_open_market_subscribes_up_to_limit_and_polls_the_rest(
    db: sqlite3.Connection,
) -> None:
    SettingsRepo(db).update({"kis.ws_max_subscriptions": 2})
    rig = Rig(db, KR_OPEN)
    for code in CODES:
        rig.watch(code)
    rig.watch("005380", "ma_break", period=3)  # 종가 규칙뿐인 종목은 장중에 건드리지 않는다

    await rig.monitor.tick_once()

    assert rig.realtime is not None and rig.realtime.subs == [("KR", "005930"), ("KR", "000660")]
    assert rig.market.price_calls == ["035420"]
    assert rig.monitor.status() == {"state": "running", "realtime": 2, "polling": 1}


async def test_polling_waits_for_the_poll_interval(db: sqlite3.Connection) -> None:
    SettingsRepo(db).update({"kis.ws_max_subscriptions": 1, "alerts.poll_interval_sec": 30})
    rig = Rig(db, KR_OPEN)
    rig.watch("005930")
    rig.watch("000660")

    await rig.monitor.tick_once()
    rig.clock.at = KR_OPEN + timedelta(seconds=10)
    await rig.monitor.tick_once()
    assert rig.market.price_calls == ["000660"]

    rig.clock.at = KR_OPEN + timedelta(seconds=30)
    await rig.monitor.tick_once()
    assert rig.market.price_calls == ["000660", "000660"]


async def test_polled_price_fires_alert(db: sqlite3.Connection) -> None:
    SettingsRepo(db).update({"kis.ws_max_subscriptions": 1})
    rig = Rig(db, KR_OPEN)
    rig.watch("005930")
    _, rule = rig.watch("000660")
    rig.market.prices["000660"] = 70000

    await rig.monitor.tick_once()

    assert rig.state(rule) is True
    assert rig.notes.sent == [
        ("알림: SK하이닉스", "현재가 70,000 — 목표가 60,000 이상", "/symbols/KR/000660")
    ]


async def test_tick_fires_and_is_throttled_then_flushed(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_OPEN, throttle=0.05)
    _, rule = rig.watch("005930")
    await rig.monitor.tick_once()
    assert rig.realtime is not None

    rig.realtime.on_tick(Tick("KR", "005930", 70000, 1.0, 1000, "100001"))
    assert rig.state(rule) is True and len(rig.notes.sent) == 1

    rig.realtime.on_tick(Tick("KR", "005930", 50000, -1.0, 1100, "100001"))
    assert rig.state(rule) is True  # 1초(여기선 0.05초) 안의 틱은 바로 평가하지 않는다

    await asyncio.sleep(0.15)
    assert rig.state(rule) is False  # 미뤄 둔 최신가로 평가된다


async def test_ticks_for_unwatched_symbols_are_ignored(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_OPEN)
    _, rule = rig.watch("005930")
    await rig.monitor.tick_once()
    assert rig.realtime is not None
    rig.realtime.on_tick(Tick("KR", "000660", 70000, 1.0, 1000, "100001"))
    assert rig.state(rule) is False and rig.notes.sent == []


async def test_reconnecting_websocket_falls_back_to_polling(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_OPEN)
    for code in CODES:
        rig.watch(code)
    await rig.monitor.tick_once()
    assert rig.realtime is not None and rig.market.price_calls == []

    rig.realtime.state = "reconnecting"
    rig.clock.at = KR_OPEN + timedelta(seconds=30)
    await rig.monitor.tick_once()
    assert sorted(rig.market.price_calls) == sorted(CODES)
    assert rig.monitor.status() == {"state": "running", "realtime": 0, "polling": 3}

    rig.realtime.state = "connected"
    rig.clock.at = KR_OPEN + timedelta(seconds=60)
    await rig.monitor.tick_once()
    assert len(rig.market.price_calls) == 3
    assert rig.monitor.status() == {"state": "running", "realtime": 3, "polling": 0}


@pytest.mark.parametrize(
    "error",
    [
        VaterError("KIS_UNREACHABLE", "한국투자증권 서버에 연결할 수 없습니다.", status=503),
        httpx.ConnectError("no route"),
    ],
)
async def test_offline_is_reported_and_recovers(db: sqlite3.Connection, error: Exception) -> None:
    SettingsRepo(db).update({"kis.ws_max_subscriptions": 1})
    rig = Rig(db, KR_OPEN)
    rig.watch("005930")
    _, rule = rig.watch("000660")
    rig.market.prices["000660"] = 70000
    sub = rig.bus.subscribe()

    rig.market.fail = error
    await rig.monitor.tick_once()
    assert rig.monitor.status()["state"] == "offline"
    event = await asyncio.wait_for(anext(sub), 1)
    assert (event.type, event.data["state"]) == ("alerts.state", "offline")

    rig.market.fail = None
    rig.clock.at = KR_OPEN + timedelta(seconds=30)
    await rig.monitor.tick_once()
    assert rig.monitor.status()["state"] == "running"
    assert rig.state(rule) is True


async def test_after_close_refreshes_bars_and_evaluates_close_rules_once(
    db: sqlite3.Connection,
) -> None:
    rig = Rig(db, KR_OPEN)
    rt_item, _ = rig.watch("005930")
    _, rule = rig.watch("000660", "ma_break", period=3)
    prior = [Bar(DAY - timedelta(days=d), 10, 10, 10, 10, 1000) for d in (4, 3, 2, 1)]
    BarRepo(db).upsert("KR", "000660", prior)
    rig.market.closes["000660"] = 20  # 확정 종가 20 > 3일 평균 13.33 → 돌파
    await rig.monitor.tick_once()  # 장중: 실시간 구독
    assert rig.realtime is not None and rig.realtime.subs == [("KR", "005930")]

    rig.clock.at = KR_SETTLING
    await rig.monitor.tick_once()
    assert rig.realtime.subs == []  # 장이 닫히면 구독을 푼다
    assert rig.state(rule) is False and ("000660", DAY) not in rig.market.bar_calls

    rig.clock.at = KR_AFTER
    await rig.monitor.tick_once()
    assert ("000660", DAY) in rig.market.bar_calls and ("005930", DAY) in rig.market.bar_calls
    assert rig.state(rule) is True
    assert [n[0] for n in rig.notes.sent] == ["알림: SK하이닉스"]
    assert rig.monitor.status() == {"state": "closed", "realtime": 0, "polling": 0}

    calls = len(rig.market.bar_calls)
    rig.clock.at = KR_AFTER + timedelta(minutes=5)
    await rig.monitor.tick_once()
    assert len(rig.market.bar_calls) == calls  # 시장별 하루 1번
    assert rt_item.code == "005930"


async def test_intraday_bars_stop_at_the_previous_day(db: sqlite3.Connection) -> None:
    # 장중에 오늘 일봉(미확정)을 저장하면 마감 후 갱신이 '이미 최신'으로 건너뛴다
    rig = Rig(db, KR_OPEN)
    rig.watch("005930")
    await rig.monitor.tick_once()
    rig.clock.at = KR_OPEN + timedelta(seconds=30)
    await rig.monitor.tick_once()
    assert rig.market.bar_calls == [("005930", DAY - timedelta(days=1))]  # 하루 1번만


async def test_close_pass_retries_after_offline(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_AFTER)
    _, rule = rig.watch("000660", "ma_break", period=3)
    prior = [Bar(DAY - timedelta(days=d), 10, 10, 10, 10, 1000) for d in (4, 3, 2, 1)]
    BarRepo(db).upsert("KR", "000660", prior)
    rig.market.closes["000660"] = 20

    rig.market.fail = VaterError("KIS_UNREACHABLE", "끊김", status=503)
    await rig.monitor.tick_once()
    assert rig.monitor.status()["state"] == "offline" and rig.state(rule) is False

    rig.market.fail = None
    await rig.monitor.tick_once()
    assert rig.state(rule) is True


async def test_paused_monitor_does_nothing_until_resumed(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_OPEN)
    _, rule = rig.watch("005930")
    await rig.monitor.tick_once()
    assert rig.realtime is not None

    rig.monitor.pause()
    rig.realtime.on_tick(Tick("KR", "005930", 70000, 1.0, 1000, "100001"))
    rig.clock.at = KR_OPEN + timedelta(seconds=30)
    await rig.monitor.tick_once()
    assert rig.state(rule) is False and rig.notes.sent == []
    assert rig.monitor.status()["state"] == "paused"

    rig.monitor.resume()
    rig.realtime.on_tick(Tick("KR", "005930", 70000, 1.0, 1000, "100002"))
    assert rig.state(rule) is True


async def test_start_runs_the_loop_and_stop_closes_realtime(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_OPEN)
    rig.watch("005930")
    rig.monitor.start()
    for _ in range(20):
        await asyncio.sleep(0)
    assert rig.realtime is not None and rig.realtime.running
    assert rig.sleeps and rig.sleeps[0] <= 30

    await rig.monitor.stop()
    assert rig.realtime.cancelled


async def test_one_symbol_error_does_not_stop_the_others(db: sqlite3.Connection) -> None:
    SettingsRepo(db).update({"kis.ws_max_subscriptions": 1})
    rig = Rig(db, KR_OPEN)
    rig.watch("005930")
    rig.watch("000660")
    _, rule = rig.watch("035420")
    rig.market.fail_for["000660"] = KisApiError("EGW00000", "조회할 수 없는 종목")
    rig.market.prices["035420"] = 70000

    await rig.monitor.tick_once()

    assert rig.market.price_calls == ["000660", "035420"]
    assert rig.state(rule) is True
    assert rig.monitor.status()["state"] == "running"


async def test_missing_keys_leave_the_monitor_idle(db: sqlite3.Connection) -> None:
    SettingsRepo(db).update({"kis.ws_max_subscriptions": 1})
    rig = Rig(db, KR_OPEN)
    rig.watch("005930")
    rig.watch("000660")
    rig.market.fail_for["000660"] = VaterError("KIS_NOT_CONFIGURED", "키 없음", status=409)

    await rig.monitor.tick_once()  # 예외 없이 끝난다

    assert rig.monitor.status()["state"] != "offline"


async def test_close_pass_skips_rules_when_bars_fail(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_AFTER)
    _, rule = rig.watch("000660", "ma_break", period=3)
    prior = [Bar(DAY - timedelta(days=d), c, c, c, c, 1000) for d, c in ((3, 10), (2, 10), (1, 20))]
    BarRepo(db).upsert("KR", "000660", prior)  # 어제까지 데이터로는 '돌파'가 참이 된다
    rig.market.fail_for["000660"] = KisApiError("EGW00000", "일봉 조회 실패")

    await rig.monitor.tick_once()

    assert rig.state(rule) is False and rig.notes.sent == []


async def test_get_alerts_without_kis_keys_stays_idle(db: sqlite3.Connection) -> None:
    from vater_core.alerts.monitor import get_alerts

    deps = AppDeps(token="t", dev=True, data_dir=Path("."), db=db, events=EventBus())
    WatchlistRepo(db).add(resolve_target(db, "KR", "005930"))
    monitor = get_alerts(deps)
    assert get_alerts(deps) is monitor and deps.alerts is monitor

    await monitor.tick_once()  # 장중이든 장 후든 키가 없으면 조용히 쉰다

    assert monitor.status()["state"] != "offline"
    await monitor.stop()
