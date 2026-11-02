"""한국투자증권 실연동 확인. 기본 실행에서 제외된다: `uv run pytest -m kis_live -q -s`

- 키는 저장소 루트 `.env`에서 **읽기만** 한다.
- 토큰·승인키 캐시는 `~/.local/share/vater/dev-kis-cache.env`에 둔다. 캐시를 재사용하므로
  발급(=알림톡)은 하루 1번을 넘지 않는다.
"""

import asyncio
from collections.abc import AsyncIterator
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import ClassVar
from zoneinfo import ZoneInfo

import httpx
import pytest

from vater_core.kis.auth import TokenManager
from vater_core.kis.client import KisClient
from vater_core.kis.config import KisServer, load_credentials
from vater_core.kis.fundamentals import financials, news_titles
from vater_core.kis.market import (
    fluctuation_rank,
    index_quote,
    investor_flows,
    overseas_index,
    sector_board,
    trading_value_rank,
)
from vater_core.kis.quotes import domestic_price, is_domestic_trading_day, overseas_price
from vater_core.kis.ratelimit import PriorityRateLimiter
from vater_core.kis.ws import KisRealtime, Tick
from vater_core.secrets.names import SecretName
from vater_core.secrets.store import EnvFileSecretStore

pytestmark = pytest.mark.kis_live

ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"
CACHE = Path.home() / ".local/share/vater/dev-kis-cache.env"
KST = ZoneInfo("Asia/Seoul")
NY = ZoneInfo("America/New_York")


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


def last_weekday() -> date:
    d = datetime.now(KST).date() - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


async def test_quotes(live: tuple[KisClient, TokenManager]) -> None:
    c, _ = live
    kr = await domestic_price(c, "005930")
    us = await overseas_price(c, "NAS", "AAPL")
    print(
        f"\n005930 {kr.price:,.0f} ({kr.change:+,.0f}, {kr.change_pct:+.2f}%)  "
        f"AAPL {us.price:.2f} ({us.change:+.2f}, {us.change_pct:+.2f}%)"
    )
    assert kr.price > 0 and us.price > 0
    assert (us.change >= 0) == (us.change_pct >= 0)  # 부호 코드 처리 확인


async def test_fundamentals_and_news(live: tuple[KisClient, TokenManager]) -> None:
    c, _ = live
    ratio = await financials(c, "005930", "financial_ratio", "year")
    news = await news_titles(c, "005930", limit=3)
    print(
        f"\nratio rows {len(ratio)} first {ratio[0].get('stac_yymm')};",
        f"news {[n.title[:20] for n in news]}",
    )
    assert ratio and news


async def test_market_data(live: tuple[KisClient, TokenManager]) -> None:
    c, _ = live
    day = last_weekday()
    kospi, kosdaq = await index_quote(c, "KOSPI"), await index_quote(c, "KOSDAQ")
    board = await sector_board(c, "KOSDAQ")
    down = await fluctuation_rank(c, "down", limit=5)
    up = await fluctuation_rank(c, "up", limit=5)
    value = await trading_value_rank(c, limit=5)
    flows_kq = await investor_flows(c, "KOSDAQ", day)
    spx = await overseas_index(c, "SPX", day - timedelta(days=10), day)
    comp = await overseas_index(c, "COMP", day - timedelta(days=10), day)
    ndx = await overseas_index(c, "NDX", day - timedelta(days=10), day)
    print(
        f"\nKOSPI {kospi.value} KOSDAQ {kosdaq.value} | KOSDAQ sectors {len(board.sectors)} "
        f"adv/dec {board.advancers}/{board.decliners}"
    )
    print(f"down {[(r.name, r.change_pct) for r in down[:3]]}")
    print(f"up {[(r.name, r.change_pct) for r in up[:3]]}")
    print(f"value {[r.name for r in value[:3]]} | KOSDAQ flows {flows_kq}")
    print(
        f"SPX {spx.quote.value} COMP {comp.quote.value} NDX {ndx.quote.value} bars {len(spx.bars)}"
    )
    assert kosdaq.value != kospi.value and board.sectors
    assert all(r.change_pct <= 0 for r in down) and all(r.change_pct >= 0 for r in up)
    assert spx.bars and comp.quote.value > 0 and ndx.quote.value > 1000


async def test_trading_day(live: tuple[KisClient, TokenManager]) -> None:
    c, _ = live
    today = datetime.now(KST).date()
    open_ = await is_domestic_trading_day(c, today)
    print(f"\n{today} domestic trading day: {open_}")
    assert open_ is (today.weekday() < 5) or not open_  # 평일이 아니면 반드시 False


async def test_us_realtime_ticks(live: tuple[KisClient, TokenManager]) -> None:
    _, tokens = live
    now_ny = datetime.now(NY)
    if now_ny.weekday() >= 5 or not (9 * 60 + 30 <= now_ny.hour * 60 + now_ny.minute < 16 * 60):
        pytest.skip(f"US regular session closed ({now_ny:%H:%M} NY)")
    ticks: list[Tick] = []
    states: list[str] = []
    rt = KisRealtime(tokens, KisServer.PROD, on_tick=ticks.append, on_state=states.append)
    await rt.subscribe("US", "AAPL", "NAS")
    task = asyncio.create_task(rt.run())
    await asyncio.sleep(60)
    task.cancel()
    print(f"\nAAPL ticks in 60s: {len(ticks)} states {states} sample {ticks[:2]}")
    assert "connected" in states
