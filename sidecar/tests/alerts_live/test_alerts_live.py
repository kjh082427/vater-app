"""알림 실연동 확인. 기본 실행에서 제외된다: `uv run pytest -m kis_live tests/alerts_live -q -s`

- 키는 저장소 루트 `.env`에서 **읽기만** 한다. 토큰·승인키 캐시는
  `~/.local/share/vater/dev-kis-cache.env`(core/kis 실연동과 같은 파일)에 둔다.
- 국내 실시간 체결 확인은 국내 장중(09:00~15:30 KST)에만 돈다. 장 외 시간이면 사유를 남기고 skip.
"""

import asyncio
import sqlite3
import time
from collections.abc import AsyncIterator
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import ClassVar
from zoneinfo import ZoneInfo

import httpx
import pytest

from vater_core.alerts.bars import refresh_bars
from vater_core.alerts.clock import MarketClock
from vater_core.alerts.evaluator import Evaluator
from vater_core.alerts.rules import Live
from vater_core.alerts.store import BarRepo, RuleRepo, WatchlistRepo
from vater_core.analysis.symbols import resolve_target
from vater_core.api.events import EventBus
from vater_core.kis.auth import TokenManager
from vater_core.kis.client import KisClient
from vater_core.kis.config import KisServer, load_credentials
from vater_core.kis.quotes import domestic_price, is_domestic_trading_day
from vater_core.kis.ratelimit import PriorityRateLimiter
from vater_core.kis.ws import KisRealtime, Tick
from vater_core.secrets.names import SecretName
from vater_core.secrets.store import EnvFileSecretStore
from vater_core.store.db import open_db

pytestmark = pytest.mark.kis_live

ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"
CACHE = Path.home() / ".local/share/vater/dev-kis-cache.env"
KST = ZoneInfo("Asia/Seoul")
CODE = "005930"


class DevStore:
    """키는 루트 .env에서 읽고(쓰지 않음), 토큰 캐시는 별도 파일에 쓴다."""

    CACHE_NAMES: ClassVar[frozenset[SecretName]] = frozenset(
        {SecretName.KIS_ACCESS_TOKEN, SecretName.KIS_WS_APPROVAL_KEY}
    )

    def __init__(self) -> None:
        self.keys = EnvFileSecretStore(ROOT_ENV)
        self.cache = EnvFileSecretStore(CACHE)

    def get(self, name: SecretName) -> str | None:
        return (self.cache if name in self.CACHE_NAMES else self.keys).get(name)

    def set(self, name: SecretName, value: str) -> None:
        assert name in self.CACHE_NAMES, "live tests must never write keys"
        self.cache.set(name, value)

    def delete(self, name: SecretName) -> None:
        if name in self.CACHE_NAMES:
            self.cache.delete(name)

    def known_values(self) -> list[str]:
        return self.keys.known_values() + self.cache.known_values()


@pytest.fixture
async def live() -> AsyncIterator[tuple[KisClient, TokenManager]]:
    if not ROOT_ENV.exists():
        pytest.skip("no root .env")
    store = DevStore()
    creds = load_credentials(store)
    async with httpx.AsyncClient(timeout=15) as http:
        tokens = TokenManager(http, store, creds, KisServer.PROD)
        yield KisClient(http, tokens, creds, KisServer.PROD, PriorityRateLimiter(5)), tokens


@pytest.fixture
def db(tmp_path: Path) -> sqlite3.Connection:
    conn = open_db(tmp_path)
    conn.execute(
        "INSERT INTO symbols (market, code, exchange, name, name_en, kind) VALUES (?,?,?,?,?,?)",
        ("KR", CODE, "KOSPI", "삼성전자", None, "stock"),
    )
    conn.commit()
    return conn


async def test_domestic_realtime_fields(live: tuple[KisClient, TokenManager]) -> None:
    """국내 실시간 체결(H0STCNT0)의 필드 위치가 맞는지 REST 현재가와 비교한다."""
    c, tokens = live

    async def trading_day(day: date) -> bool:
        return await is_domestic_trading_day(c, day)

    if not await MarketClock(trading_day).is_open("KR"):
        now = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
        pytest.skip(f"국내 장 외 시간이라 실시간 체결을 받을 수 없습니다 ({now} KST)")

    rest = await domestic_price(c, CODE)
    ticks: list[Tick] = []
    rt = KisRealtime(tokens, KisServer.PROD, on_tick=ticks.append)
    await rt.subscribe("KR", CODE)
    task = asyncio.create_task(rt.run())
    deadline = time.monotonic() + 90
    while len(ticks) < 10 and time.monotonic() < deadline:
        await asyncio.sleep(0.5)
    task.cancel()
    after = await domestic_price(c, CODE)

    print(
        f"\nREST {rest.price:,.0f} ({rest.change_pct:+.2f}%) vol {rest.volume:,} → "
        f"{after.price:,.0f} vol {after.volume:,}\n"
        f"ticks {len(ticks)}: first {ticks[:1]} last {ticks[-1:]}"
    )
    assert len(ticks) >= 10, f"only {len(ticks)} ticks in 90s"
    assert {t.code for t in ticks} == {CODE}
    low, high = min(rest.price, after.price), max(rest.price, after.price)
    for t in ticks:
        assert low * 0.99 <= t.price <= high * 1.01, t
        assert abs(t.change_pct - rest.change_pct) <= 0.5 + abs(after.change_pct - rest.change_pct)
    volumes = [t.volume for t in ticks]
    assert volumes == sorted(volumes) and volumes[-1] > volumes[0]  # 누적 거래량


async def test_price_rule_end_to_end(
    live: tuple[KisClient, TokenManager], db: sqlite3.Connection
) -> None:
    """실제 현재가·일봉으로: 첫 평가는 기준값만, 거짓→참에서 1번 발생, 이력 1행."""
    c, _ = live
    item = WatchlistRepo(db).add(resolve_target(db, "KR", CODE))
    today = datetime.now(KST).date()
    saved = await refresh_bars(c, BarRepo(db), item, today - timedelta(days=1))
    history = BarRepo(db).history("KR", CODE)
    quote = await domestic_price(c, CODE)
    print(f"\nbars saved {saved}, history {len(history.days)} days, price {quote.price:,.0f}")
    assert len(history.days) >= 200

    rules = RuleRepo(db)
    rule = rules.create(item.id, "price_above", {"price": quote.price * 0.5}, "realtime", True)
    sent: list[tuple[str, str, str | None]] = []

    def note(title: str, body: str, route: str | None = None) -> None:
        sent.append((title, body, route))

    ev = Evaluator(db, EventBus(), note)
    live_price = Live(
        day=today, price=quote.price, change_pct=quote.change_pct, volume=quote.volume
    )

    assert ev.evaluate(item, [rules.get(rule.id)], history, live_price, today) == []
    assert rules.get(rule.id).last_state is True and sent == []

    rules.set_state(rule.id, False)  # 직전에 조건 밖에 있었다고 가정
    fired = ev.evaluate(item, [rules.get(rule.id)], history, live_price, today)
    again = ev.evaluate(item, [rules.get(rule.id)], history, live_price, today)

    print(f"fired: {fired[0].message} / notify {sent}")
    assert len(fired) == 1 and again == []
    assert sent == [("알림: 삼성전자", sent[0][1], "/symbols/KR/005930")]
    assert db.execute("SELECT count(*) FROM alert_events").fetchone()[0] == 1


async def test_monitor_one_tick_with_real_kis(db: sqlite3.Connection, tmp_path: Path) -> None:
    """실제 키로 감시 루프 1회: 전 세션 일봉 따라잡기, (장중이면) 실시간 구독과 틱 평가."""
    if not ROOT_ENV.exists():
        pytest.skip("no root .env")
    from typing import cast

    from vater_core.alerts.monitor import get_alerts
    from vater_core.api.deps import AppDeps
    from vater_core.secrets.store import SecretStore

    deps = AppDeps(
        token="t",
        dev=True,
        data_dir=tmp_path,
        db=db,
        secrets=cast(SecretStore, DevStore()),
        events=EventBus(),
    )
    item = WatchlistRepo(db).add(resolve_target(db, "KR", CODE))
    rules = RuleRepo(db)
    live_rule = rules.create(item.id, "price_above", {"price": 1000.0}, "realtime", True)
    close_rule = rules.create(item.id, "ma_break", {"period": 20}, "close", True)
    monitor = get_alerts(deps)
    try:
        await monitor.tick_once()
        clock = monitor._clock  # 테스트에서만 들여다본다
        last = await clock.last_closed_session("KR")
        is_open = await clock.is_open("KR")
        first = monitor.status()  # 첫 회차에는 WebSocket이 아직 연결 중이라 폴링으로 감시한다
        if is_open:
            # 첫 회차의 폴링이 기준값을 먼저 잡을 수 있으므로, 기준값이 아니라 연결을 기다린다
            for _ in range(40):  # 최대 20초
                rt = monitor._rt  # 테스트에서만 들여다본다
                if rt is not None and rt.state == "connected":
                    break
                await asyncio.sleep(0.5)
            await monitor.tick_once()  # 연결된 뒤: 실시간으로 넘어간다
            for _ in range(20):  # 실제 틱으로 평가될 때까지 최대 10초
                if rules.get(live_rule.id).last_state is not None:
                    break
                await asyncio.sleep(0.5)
        status = monitor.status()
        print(
            f"\nlast closed KR session {last}, open={is_open}, first {first}, status {status}, "
            f"bars through {BarRepo(db).last_day('KR', CODE)}, "
            f"close rule state {rules.get(close_rule.id).last_state}, "
            f"live rule state {rules.get(live_rule.id).last_state}"
        )
        assert BarRepo(db).last_day("KR", CODE) == last
        assert rules.get(close_rule.id).last_state is not None  # 전 세션 종가로 기준값
        if is_open:
            assert (status["state"], status["realtime"], status["polling"]) == ("running", 1, 0)
            assert status["feeds"] == [{"market": "KR", "code": CODE, "feed": "realtime"}]
            assert rules.get(live_rule.id).last_state is True  # 틱(현재가 > 1,000원)으로 기준값
        else:
            assert status["state"] == "closed"
    finally:
        await monitor.stop()
        if deps.http is not None:
            await deps.http.aclose()


async def test_watch_quotes_with_real_kis(db: sqlite3.Connection, tmp_path: Path) -> None:
    """실제 키: 홈 화면 시세(REST 보충), 장중이면 실제 틱의 SSE quote와 전일 대비."""
    if not ROOT_ENV.exists():
        pytest.skip("no root .env")
    from typing import cast

    from vater_core.alerts.monitor import get_alerts
    from vater_core.api.deps import AppDeps
    from vater_core.secrets.store import SecretStore

    bus = EventBus()
    deps = AppDeps(
        token="t",
        dev=True,
        data_dir=tmp_path,
        db=db,
        secrets=cast(SecretStore, DevStore()),
        events=bus,
    )
    item = WatchlistRepo(db).add(resolve_target(db, "KR", CODE))
    RuleRepo(db).create(item.id, "price_above", {"price": 1000.0}, "realtime", True)
    monitor = get_alerts(deps)
    try:
        rest = (await monitor.watch_quotes())[0]
        print(f"\nREST quote: {rest}")
        assert rest["price"] and rest["price"] > 0 and rest["change"] is not None
        assert rest["source"] == "rest"

        await monitor.tick_once()
        if not await monitor._clock.is_open("KR"):  # 테스트에서만 들여다본다
            print("KR market closed: realtime quote check skipped")
            return
        for _ in range(40):
            rt = monitor._rt
            if rt is not None and rt.state == "connected":
                break
            await asyncio.sleep(0.5)
        await monitor.tick_once()
        sub = bus.subscribe()
        tick = None
        for _ in range(40):
            while not sub.queue.empty():
                ev = sub.queue.get_nowait()
                if ev.type == "quote" and ev.data["source"] == "realtime":
                    tick = ev.data
            if tick is not None:
                break
            await asyncio.sleep(0.5)
        status = monitor.status()
        print(f"realtime quote: {tick}\nstatus markets {status['markets']} feeds {status['feeds']}")
        assert tick is not None and tick["change"] is not None
        prev_close = rest["price"] - rest["change"]
        assert abs(tick["change"] - (tick["price"] - prev_close)) < 1  # 전일 종가가 REST와 같다
        assert status["markets"]["KR"] == "open"
        assert status["feeds"] == [{"market": "KR", "code": CODE, "feed": "realtime"}]
    finally:
        await monitor.stop()
        if deps.http is not None:
            await deps.http.aclose()
