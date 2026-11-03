"""브리핑 실연동 확인. 기본 실행에서 제외된다.

- 수집: `uv run pytest -m kis_live tests/briefing_live -q -s`
- 만들기(실제 LLM 1회): `uv run pytest -m llm tests/briefing_live -q -s`
- 키는 저장소 루트 `.env`에서 **읽기만** 한다. 토큰 캐시는 `~/.local/share/vater/dev-kis-cache.env`.
- LLM 호출 한도 같은 LLM 문제면 사유를 남기고 skip한다(사용자 규칙: LLM 문제는 건너뛰고 진행).
"""

import json
import re
import sqlite3
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime
from pathlib import Path
from typing import ClassVar, cast

import httpx
import pytest

from vater_core.alerts.clock import MarketClock
from vater_core.api.deps import AppDeps
from vater_core.api.events import EventBus
from vater_core.briefing.collect import KisFeeds, collect
from vater_core.briefing.schedule import BriefingMarket
from vater_core.briefing.service import get_briefing
from vater_core.briefing.store import BriefingRepo
from vater_core.kis.auth import TokenManager
from vater_core.kis.client import KisClient
from vater_core.kis.config import KisServer, load_credentials
from vater_core.kis.quotes import is_domestic_trading_day
from vater_core.kis.ratelimit import PriorityRateLimiter
from vater_core.secrets.names import SecretName
from vater_core.secrets.store import EnvFileSecretStore, SecretStore
from vater_core.store.db import open_db

ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"
CACHE = Path.home() / ".local/share/vater/dev-kis-cache.env"


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
async def client() -> AsyncIterator[KisClient]:
    if not ROOT_ENV.exists():
        pytest.skip("no root .env")
    store = DevStore()
    creds = load_credentials(store)
    async with httpx.AsyncClient(timeout=15) as http:
        tokens = TokenManager(http, store, creds, KisServer.PROD)
        yield KisClient(http, tokens, creds, KisServer.PROD, PriorityRateLimiter(5))


@pytest.fixture
def db(tmp_path: Path) -> sqlite3.Connection:
    return open_db(tmp_path)


@pytest.mark.kis_live
async def test_collect_both_markets(client: KisClient, db: sqlite3.Connection) -> None:
    async def trading_day(day: date) -> bool:
        return await is_domestic_trading_day(client, day)

    clock = MarketClock(trading_day)
    now = datetime.now(UTC)
    markets: tuple[BriefingMarket, ...] = ("KR", "US")
    for market in markets:
        session = await clock.last_closed_session(market)
        assert session is not None
        got = await collect(market, session, KisFeeds(client), db, alerts_until=now)
        d = got.data
        print(f"\n{market} {session} missing={got.missing}")
        for idx in d.get("indices", []):
            extra = f", closes {len(idx['closes'])}" if "closes" in idx else ""
            print(f"  {idx['name']} {idx['value']:,.2f} ({idx['change_pct']:+.2f}%){extra}")
        if market == "KR":
            for m, board in d["sectors"].items():
                up, down, n = board["advancers"], board["decliners"], len(board["sectors"])
                print(f"  {m} 상승 {up} 하락 {down} 업종 {n}")
            top_up, top_value = d["movers"]["up"][0]["name"], d["movers"]["value"][0]["name"]
            print(f"  상승률 1위 {top_up}, 거래대금 1위 {top_value}")
            print(f"  수급 {d['flows']}")
        assert got.missing == []
        if market == "KR":
            assert len(d["indices"]) == 2 and set(d["sectors"]) == {"KOSPI", "KOSDAQ"}
            assert all(len(d["movers"][k]) > 0 for k in ("up", "down", "value"))
            assert set(d["flows"]) == {"KOSPI", "KOSDAQ"}
        else:
            assert [i["code"] for i in d["indices"]] == ["SPX", "COMP", "NDX"]
            assert all(len(i["closes"]) == 30 for i in d["indices"])


@pytest.mark.llm
async def test_generate_a_real_briefing(tmp_path: Path, db: sqlite3.Connection) -> None:
    if not ROOT_ENV.exists():
        pytest.skip("no root .env")
    store = DevStore()
    if not store.get(SecretName.LLM_GOOGLE_KEY):
        pytest.skip("root .env has no Gemini key")
    deps = AppDeps(
        token="t",
        dev=True,
        data_dir=tmp_path,
        db=db,
        secrets=cast(SecretStore, store),
        events=EventBus(),
    )
    service = get_briefing(deps)
    try:
        session = await service._clock.last_closed_session("KR")  # 테스트에서만 들여다본다
        assert session is not None
        bid = await service.generate("KR", session)
    finally:
        await service.stop()
        if deps.http is not None:
            await deps.http.aclose()
    b = BriefingRepo(db).get(bid)
    print(
        json.dumps(
            {"status": b.status, "missing": b.missing, "text": b.text}, ensure_ascii=False, indent=1
        )
    )
    if "interpretation" in b.missing:
        pytest.skip("LLM 해석 실패(호출 한도 등): 데이터만 저장됨 — 로그에서 원인 확인")
    assert b.status == "done" and b.text is not None
    assert set(b.text) == {"headline", "market", "sectors", "flows", "notable", "watchlist"}
    assert b.text["headline"]
    assert not any(re.search(r"\d", v) for v in b.text.values())
