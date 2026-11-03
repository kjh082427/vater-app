import asyncio
import sqlite3
import time
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
            ("US", "AAPL", "NAS", "애플", "APPLE INC", "stock"),
        ],
    )
    conn.commit()
    return conn


def counts(status: dict[str, Any]) -> dict[str, Any]:
    """상태 중 감시 루프 개수 부분(markets·feeds는 따로 확인한다)."""
    return {k: status[k] for k in ("state", "realtime", "polling")}


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
        self.subscription_errors: dict[tuple[str, str], str] = {}  # 서버가 거부한 구독
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
        self.changes: dict[str, float] = {}  # 전일 대비 금액(REST 현재가에만 있음)
        self.price_calls: list[str] = []
        self.bar_calls: list[tuple[str, date]] = []
        self.closes: dict[tuple[str, date], float] = {}  # (종목, 날짜) → 그날 확정 종가
        self.fail: Exception | None = None
        self.fail_for: dict[str, Exception] = {}  # 종목별 오류

    async def price(self, item: WatchItem) -> Quote:
        self.price_calls.append(item.code)
        if self.fail is not None:
            raise self.fail
        if item.code in self.fail_for:
            raise self.fail_for[item.code]
        price = self.prices.get(item.code, 100.0)
        change = self.changes.get(item.code, 0.0)
        return Quote(item.market, item.code, price, change, 0.0, 1000)  # type: ignore[arg-type]

    async def bars(self, item: WatchItem, through: date) -> int:
        """refresh_bars처럼: 이미 `through`까지 있으면 한투를 부르지 않는다."""
        last = BarRepo(self.db).last_day(item.market, item.code)
        if last is not None and last >= through:
            return 0
        self.bar_calls.append((item.code, through))
        if self.fail is not None:
            raise self.fail
        if item.code in self.fail_for:
            raise self.fail_for[item.code]
        if (item.code, through) not in self.closes:
            return 1  # 예전 봉만 왔다(그날 확정 봉은 아직 없음)
        c = self.closes[(item.code, through)]
        return BarRepo(self.db).upsert(item.market, item.code, [Bar(through, c, c, c, c, 1000)])


class Notes:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str, str | None]] = []
        self.delay = 0.0  # 느린 컴퓨터(CI 서버) 흉내: 알림 1건 처리에 걸리는 실제 시간

    def __call__(self, title: str, body: str, route: str | None = None) -> None:
        time.sleep(self.delay)
        self.sent.append((title, body, route))


class Mono:
    """틱 1초 제한용 가짜 시계(초). 테스트가 직접 움직인다."""

    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


class Rig:
    def __init__(self, db: sqlite3.Connection, at: datetime, throttle: float = 0.05) -> None:
        self.mono = Mono()
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
            monotonic=self.mono,
        )

    def watch(
        self, code: str, kind: str = "price_above", market: str = "KR", **params: Any
    ) -> tuple[WatchItem, int]:
        repo = WatchlistRepo(self.db)
        item = next((w for w in repo.list() if w.code == code), None) or repo.add(
            resolve_target(self.db, market, code)
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
    assert counts(rig.monitor.status()) == {"state": "running", "realtime": 2, "polling": 1}


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
    rig.notes.delay = 0.1  # 평가가 1초(여기선 0.05초)보다 오래 걸려도 판단은 같아야 한다
    _, rule = rig.watch("005930")
    await rig.monitor.tick_once()
    assert rig.realtime is not None

    rig.realtime.on_tick(Tick("KR", "005930", 70000, 1.0, 1000, "100001"))
    assert rig.state(rule) is True and len(rig.notes.sent) == 1

    rig.mono.t += 0.01
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
    assert counts(rig.monitor.status()) == {"state": "running", "realtime": 0, "polling": 3}

    rig.realtime.state = "connected"
    rig.clock.at = KR_OPEN + timedelta(seconds=60)
    await rig.monitor.tick_once()
    assert len(rig.market.price_calls) == 3
    assert counts(rig.monitor.status()) == {"state": "running", "realtime": 3, "polling": 0}


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
    rig.market.closes[("000660", DAY)] = 20  # 확정 종가 20 > 3일 평균 13.33 → 돌파
    rig.market.closes[("005930", DAY - timedelta(days=1))] = 100
    rig.market.closes[("005930", DAY)] = 100
    await rig.monitor.tick_once()  # 장중: 실시간 구독, 전 세션(월요일) 종가 평가는 변화 없음
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
    assert counts(rig.monitor.status()) == {"state": "closed", "realtime": 0, "polling": 0}

    calls = len(rig.market.bar_calls)
    rig.clock.at = KR_AFTER + timedelta(minutes=5)
    await rig.monitor.tick_once()
    assert len(rig.market.bar_calls) == calls  # 시장별 하루 1번
    assert rt_item.code == "005930"


async def test_intraday_bars_stop_at_the_previous_day(db: sqlite3.Connection) -> None:
    # 장중에 오늘 일봉(미확정)을 저장하면 마감 후 갱신이 '이미 최신'으로 건너뛴다
    rig = Rig(db, KR_OPEN)
    rig.watch("005930")
    rig.market.closes[("005930", DAY - timedelta(days=1))] = 100
    await rig.monitor.tick_once()
    rig.clock.at = KR_OPEN + timedelta(seconds=30)
    await rig.monitor.tick_once()
    assert rig.market.bar_calls == [("005930", DAY - timedelta(days=1))]  # 하루 1번만


async def test_close_pass_retries_after_offline(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_AFTER)
    _, rule = rig.watch("000660", "ma_break", period=3)
    prior = [Bar(DAY - timedelta(days=d), 10, 10, 10, 10, 1000) for d in (4, 3, 2, 1)]
    BarRepo(db).upsert("KR", "000660", prior)
    rig.market.closes[("000660", DAY)] = 20

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


US_EVENING = datetime(2026, 11, 3, 11, 0, tzinfo=UTC)  # 화 20:00 KST = 06:00 뉴욕(장 전)
NY_MON = date(2026, 11, 2)


async def test_missed_us_close_is_caught_up_in_the_kst_evening(db: sqlite3.Connection) -> None:
    # 미국 마감 평가 창(06:10~14:00 KST)에 PC가 꺼져 있었어도 저녁에 켜면 따라잡는다
    rig = Rig(db, US_EVENING)
    _, rule = rig.watch("AAPL", "ma_break", market="US", period=3)
    prior = [Bar(date(2026, 10, d), 10, 10, 10, 10, 1000) for d in (28, 29, 30)]
    BarRepo(db).upsert("US", "AAPL", prior)
    rig.market.closes[("AAPL", NY_MON)] = 20

    await rig.monitor.tick_once()

    assert rig.market.bar_calls == [("AAPL", NY_MON)]
    assert rig.state(rule) is True
    assert rig.notes.sent[0][0] == "알림: 애플" and rig.notes.sent[0][2] == "/symbols/US/AAPL"
    fired = db.execute("SELECT fired_at FROM alert_events").fetchall()
    assert fired == [("2026-11-03T20:00:00+09:00",)]

    rig.clock.at = US_EVENING + timedelta(minutes=30)
    await rig.monitor.tick_once()
    assert len(rig.notes.sent) == 1


async def test_close_pass_waits_for_the_sessions_own_bar(db: sqlite3.Connection) -> None:
    # 받은 일봉에 오늘 봉이 없으면 어제 값으로 '오늘 종가'를 판정하지 않고 다시 시도한다
    rig = Rig(db, KR_AFTER)
    _, rule = rig.watch("000660", "ma_break", period=3)
    prior = [Bar(DAY - timedelta(days=d), c, c, c, c, 1000) for d, c in ((3, 10), (2, 10), (1, 20))]
    BarRepo(db).upsert("KR", "000660", prior)  # 어제까지로 판정하면 '돌파'가 참

    await rig.monitor.tick_once()
    assert rig.state(rule) is False and rig.notes.sent == []

    rig.clock.at = KR_AFTER + timedelta(minutes=1)
    await rig.monitor.tick_once()
    assert len(rig.market.bar_calls) == 1  # 몇 분 간격을 두고 다시 묻는다

    rig.market.closes[("000660", DAY)] = 30  # 오늘 확정 종가 30 > 3일 평균 20 → 돌파
    rig.clock.at = KR_AFTER + timedelta(minutes=5)
    await rig.monitor.tick_once()
    assert rig.state(rule) is True
    assert [n[1] for n in rig.notes.sent] == ["3일 이동평균(20.00) 돌파, 현재가 30.00"]


async def test_close_pass_retries_a_failed_symbol_the_same_day(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_AFTER)
    _, rule = rig.watch("000660", "ma_break", period=3)
    prior = [Bar(DAY - timedelta(days=d), 10, 10, 10, 10, 1000) for d in (3, 2, 1)]
    BarRepo(db).upsert("KR", "000660", prior)
    rig.market.closes[("000660", DAY)] = 20
    rig.market.fail_for["000660"] = KisApiError("EGW00500", "일시 오류")

    await rig.monitor.tick_once()
    assert rig.state(rule) is False

    del rig.market.fail_for["000660"]
    rig.clock.at = KR_AFTER + timedelta(minutes=5)
    await rig.monitor.tick_once()
    assert rig.state(rule) is True
    assert len(rig.market.bar_calls) == 2


async def test_bars_for_realtime_rules_are_retried_after_a_failure(db: sqlite3.Connection) -> None:
    # 장중 지표(신고가 등)가 어제 봉 없이 하루 종일 평가되지 않게 한다
    rig = Rig(db, KR_OPEN)
    rig.watch("005930")
    rig.market.closes[("005930", DAY - timedelta(days=1))] = 100
    rig.market.fail_for["005930"] = KisApiError("EGW00500", "일시 오류")
    await rig.monitor.tick_once()
    assert BarRepo(db).last_day("KR", "005930") is None

    del rig.market.fail_for["005930"]
    rig.clock.at = KR_OPEN + timedelta(minutes=5)
    await rig.monitor.tick_once()
    assert BarRepo(db).last_day("KR", "005930") == DAY - timedelta(days=1)


async def test_a_newer_tick_drops_the_pending_older_one(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_OPEN, throttle=0.05)
    _, rule = rig.watch("005930")
    await rig.monitor.tick_once()
    assert rig.realtime is not None

    rig.realtime.on_tick(Tick("KR", "005930", 59000, 0.0, 1000, "100001"))  # 바로 평가: 거짓
    rig.mono.t += 0.01
    rig.realtime.on_tick(Tick("KR", "005930", 61000, 0.0, 1100, "100001"))  # 1초 안: 미룸
    rig.mono.t += 0.05  # 루프가 미룬 틱을 처리하기 전에 1초(여기선 0.05초)가 지난다
    rig.realtime.on_tick(Tick("KR", "005930", 59000, 0.0, 1200, "100002"))  # 바로 평가: 거짓
    await asyncio.sleep(0.15)

    assert rig.state(rule) is False
    assert rig.notes.sent == []  # 지난 가격(61,000)으로 울리지 않는다


async def test_subscription_rejected_by_the_server_is_polled(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_OPEN)
    rig.watch("005930")
    rig.watch("000660")
    await rig.monitor.tick_once()
    assert rig.realtime is not None and rig.market.price_calls == []

    rig.realtime.subscription_errors[("H0STCNT0", "000660")] = "OPSP0008: 구독 한도 초과"
    rig.clock.at = KR_OPEN + timedelta(seconds=30)
    await rig.monitor.tick_once()

    assert rig.market.price_calls == ["000660"]
    assert counts(rig.monitor.status()) == {"state": "running", "realtime": 1, "polling": 1}


def quotes(events: list[Any]) -> list[dict[str, Any]]:
    return [e.data for e in events if e.type == "quote"]


def drained(sub: Any) -> list[Any]:
    out = []
    while not sub.queue.empty():
        out.append(sub.queue.get_nowait())
    return out


async def test_ticks_publish_quotes_at_most_once_per_second(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_OPEN, throttle=0.05)
    rig.watch("005930")
    await rig.monitor.tick_once()
    assert rig.realtime is not None
    sub = rig.bus.subscribe()

    rig.realtime.on_tick(Tick("KR", "005930", 70000, 1.0, 1000, "100001"))
    rig.mono.t += 0.01
    rig.realtime.on_tick(Tick("KR", "005930", 70100, 1.1, 1100, "100001"))  # 1초 안: 미룸
    got = quotes(drained(sub))
    assert got == [
        {
            "market": "KR",
            "code": "005930",
            "price": 70000.0,
            "change": None,  # 전일 종가를 아직 모른다: 지어내지 않는다
            "change_pct": 1.0,
            "at": "2026-11-03T10:00:00+09:00",
            "source": "realtime",
        }
    ]
    await asyncio.sleep(0.15)
    assert [q["price"] for q in quotes(drained(sub))] == [70100.0]


async def test_polled_quote_teaches_the_previous_close_for_ticks(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_OPEN)
    rig.watch("005930")
    rig.market.prices["005930"] = 70000.0
    rig.market.changes["005930"] = 1200.0  # 전일 종가 68,800
    await rig.monitor.tick_once()
    assert rig.realtime is not None
    rig.realtime.state = "reconnecting"  # 끊긴 동안: REST로 받는다
    sub = rig.bus.subscribe()
    rig.clock.at = KR_OPEN + timedelta(seconds=30)
    await rig.monitor.tick_once()
    polled = quotes(drained(sub))
    assert [(q["price"], q["change"], q["source"]) for q in polled] == [
        (70000.0, 1200.0, "polling")
    ]

    rig.realtime.state = "connected"
    rig.realtime.on_tick(Tick("KR", "005930", 69000, 0.29, 1000, "100500"))
    ticked = quotes(drained(sub))
    assert [(q["price"], q["change"], q["source"]) for q in ticked] == [
        (69000.0, 200.0, "realtime")
    ]
    assert rig.monitor.quotes()[("KR", "005930")].change == 200.0


async def test_status_reports_markets_and_per_symbol_feeds(db: sqlite3.Connection) -> None:
    SettingsRepo(db).update({"kis.ws_max_subscriptions": 2})
    rig = Rig(db, KR_OPEN)
    rig.watch("005930")  # 실시간
    rig.watch("000660")  # 실시간
    rig.watch("035420")  # 한도를 넘어 폴링
    rig.watch("005380", "ma_break", period=3)  # 실시간 규칙 없음: 장중 감시 안 함
    rig.watch("AAPL", market="US")  # 미국은 장 전
    await rig.monitor.tick_once()  # 첫 회차: 연결 중이라 모두 폴링
    await rig.monitor.tick_once()
    status = rig.monitor.status()
    assert status["markets"] == {"KR": "open", "US": "closed"}
    assert status["feeds"] == [
        {"market": "KR", "code": "005930", "feed": "realtime"},
        {"market": "KR", "code": "000660", "feed": "realtime"},
        {"market": "KR", "code": "035420", "feed": "polling"},
        {"market": "KR", "code": "005380", "feed": "idle"},
        {"market": "US", "code": "AAPL", "feed": "closed"},
    ]
    assert (status["state"], status["realtime"], status["polling"]) == ("running", 2, 1)


async def test_rejected_or_disconnected_symbols_show_polling(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_OPEN)
    rig.watch("005930")
    rig.watch("000660")
    await rig.monitor.tick_once()
    assert rig.realtime is not None
    rig.realtime.subscription_errors[("H0STCNT0", "000660")] = "거부"
    rig.clock.at = KR_OPEN + timedelta(seconds=30)
    await rig.monitor.tick_once()
    feeds = {f["code"]: f["feed"] for f in rig.monitor.status()["feeds"]}
    assert feeds == {"005930": "realtime", "000660": "polling"}

    rig.realtime.state = "reconnecting"
    rig.clock.at = KR_OPEN + timedelta(seconds=60)
    await rig.monitor.tick_once()
    feeds = {f["code"]: f["feed"] for f in rig.monitor.status()["feeds"]}
    assert feeds == {"005930": "polling", "000660": "polling"}


async def test_offline_marks_every_symbol_offline(db: sqlite3.Connection) -> None:
    SettingsRepo(db).update({"kis.ws_max_subscriptions": 1})
    rig = Rig(db, KR_OPEN)
    rig.watch("005930")
    rig.watch("000660")
    rig.market.fail = VaterError("KIS_UNREACHABLE", "끊김", status=503)
    await rig.monitor.tick_once()
    status = rig.monitor.status()
    assert status["state"] == "offline"
    assert {f["feed"] for f in status["feeds"]} == {"offline"}


async def test_removed_symbol_leaves_quotes_and_feeds(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_OPEN)
    item, _ = rig.watch("005930")
    await rig.monitor.tick_once()
    assert rig.realtime is not None
    rig.realtime.on_tick(Tick("KR", "005930", 70000, 1.0, 1000, "100001"))
    assert ("KR", "005930") in rig.monitor.quotes()

    WatchlistRepo(db).remove(item.id)
    rig.clock.at = KR_OPEN + timedelta(seconds=30)
    await rig.monitor.tick_once()
    assert rig.monitor.quotes() == {}
    assert rig.monitor.status()["feeds"] == []
