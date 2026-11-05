"""브리핑의 내 자산 구역 (v2 설계 15장). 앱이 직접 계산하고 AI를 거치지 않는다."""

from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, cast

import httpx
import pytest

from vater_core.alerts.clock import MarketClock
from vater_core.alerts.store import BarRepo
from vater_core.api.deps import AppDeps
from vater_core.briefing.collect import Collected
from vater_core.briefing.service import BriefingService
from vater_core.briefing.store import BriefingRepo
from vater_core.kis.models import Bar
from vater_core.llm.presets import LlmRun, TierChoice
from vater_core.market.fx import FxRepo
from vater_core.portfolio.daily import DailyRecorder, DailyRepo
from vater_core.store.db import open_db
from vater_core.store.holdings import HoldingRow, HoldingsRepo

FRI, MON, TUE = date(2026, 10, 30), date(2026, 11, 2), date(2026, 11, 3)
NOW = datetime(2026, 11, 3, 8, 0, tzinfo=UTC)  # 화 17:00 KST: 국내는 화, 뉴욕은 월 세션까지 끝남
AT = "2026-11-03T00:00:00Z"
TIER = TierChoice("google", "m", None)
TEXT = {k: "문장." for k in ("headline", "market", "sectors", "flows", "notable", "watchlist")}


class Rig:
    def __init__(self, deps: AppDeps) -> None:
        assert deps.db is not None
        self.deps, self.db = deps, deps.db
        self.refreshed: list[tuple[str, str, date]] = []
        self.fx: dict[date, float] = {TUE: 1400.0}

        async def kr_day(day: date) -> bool:
            return day.weekday() < 5

        async def refresh(market: str, code: str, through: date) -> None:
            self.refreshed.append((market, code, through))

        async def fetch_fx(start: date, end: date) -> dict[date, float]:
            return self.fx

        self.clock = MarketClock(kr_day, now=lambda: NOW)
        self.recorder = DailyRecorder(
            deps, clock=self.clock, refresh=refresh, fetch_fx=fetch_fx, now=lambda: NOW
        )

    def hold(self, market: str, code: str, qty: int, *closes: tuple[date, float]) -> None:
        row = HoldingRow(
            cast(Any, market),
            code,
            f"{code}이름",
            Decimal(qty),
            Decimal(1),
            "KRW" if market == "KR" else "USD",
        )
        HoldingsRepo(self.db).manual_upsert("samsung", row, AT)
        BarRepo(self.db).upsert(market, code, [Bar(d, 1, 1, 1, c, 1) for d, c in closes])

    def prior_record(self) -> None:
        DailyRepo(self.db).fill(MON, 1.0, 1.0, 0.0, 0.0, None, backfilled=False)


@pytest.fixture
def rig(deps: AppDeps) -> Rig:
    return Rig(deps)


async def test_no_holdings_has_no_section(rig: Rig) -> None:
    assert await rig.recorder.my_assets("KR", TUE) is None
    assert rig.refreshed == []


async def test_biggest_and_smallest_contribution(rig: Rig) -> None:
    rig.prior_record()
    rig.hold("KR", "A", 10, (MON, 100.0), (TUE, 110.0))  # +100
    rig.hold("KR", "B", 1, (MON, 1000.0), (TUE, 1300.0))  # +300
    rig.hold("KR", "C", 5, (MON, 200.0), (TUE, 180.0))  # -100
    got = await rig.recorder.my_assets("KR", TUE)
    assert got is not None
    assert got["top"] == {"code": "B", "name": "B이름", "amount": 300.0, "currency": "KRW"}
    assert got["bottom"] == {"code": "C", "name": "C이름", "amount": -100.0, "currency": "KRW"}
    assert got["change_krw"] == 300.0
    assert got["change_pct"] == pytest.approx(300 / 3000 * 100)
    assert got["currencies"] == {"KRW": {"change": 300.0, "change_pct": pytest.approx(10.0)}}
    assert ("KR", "A", TUE) in rig.refreshed  # 감시 종목이 아니어도 그 세션 일봉을 받는다


async def test_all_gains_have_no_bottom(rig: Rig) -> None:
    rig.prior_record()
    rig.hold("KR", "A", 10, (MON, 100.0), (TUE, 110.0))
    rig.hold("KR", "B", 10, (MON, 100.0), (TUE, 101.0))
    got = await rig.recorder.my_assets("KR", TUE)
    assert got is not None
    assert got["top"]["code"] == "A"
    assert got["bottom"] is None  # 오른 종목을 "가장 많이 빠진 종목"이라 하지 않는다


async def test_all_losses_have_no_top(rig: Rig) -> None:
    rig.prior_record()
    rig.hold("KR", "A", 10, (MON, 110.0), (TUE, 100.0))
    rig.hold("KR", "B", 10, (MON, 101.0), (TUE, 100.0))
    got = await rig.recorder.my_assets("KR", TUE)
    assert got is not None
    assert got["top"] is None
    assert got["bottom"]["code"] == "A"


async def test_flat_symbol_is_neither(rig: Rig) -> None:
    rig.prior_record()
    rig.hold("KR", "A", 10, (MON, 100.0), (TUE, 100.0))
    got = await rig.recorder.my_assets("KR", TUE)
    assert got is not None
    assert (got["top"], got["bottom"]) == (None, None)


async def test_no_previous_record_has_null_changes(rig: Rig) -> None:
    rig.hold("KR", "A", 10, (MON, 100.0), (TUE, 110.0))
    rig.hold("US", "AAPL", 1, (FRI, 100.0), (MON, 110.0))
    DailyRepo(rig.db).fill(
        TUE, 1.0, 1.0, 0.0, 0.0, None, backfilled=False
    )  # 오늘 행은 전일이 아니다
    got = await rig.recorder.my_assets("KR", TUE)
    assert got == {
        "change_krw": None,
        "change_pct": None,
        "currencies": {
            "KRW": {"change": None, "change_pct": None},
            "USD": {"change": None, "change_pct": None},
        },
        "top": None,
        "bottom": None,
    }


async def test_currencies_stay_apart_and_total_uses_the_rate(rig: Rig) -> None:
    rig.prior_record()
    rig.hold("KR", "A", 10, (MON, 100.0), (TUE, 110.0))  # +100원
    rig.hold("US", "AAPL", 2, (FRI, 100.0), (MON, 105.0), (TUE, 999.0))  # +10달러, 화 세션은 미확정
    got = await rig.recorder.my_assets("KR", TUE)
    assert got is not None
    assert got["currencies"]["KRW"]["change"] == 100.0
    assert got["currencies"]["USD"]["change"] == 10.0
    assert got["currencies"]["USD"]["change_pct"] == pytest.approx(5.0)
    assert got["change_krw"] == 100.0 + 10.0 * 1400
    assert got["change_pct"] == pytest.approx((100 + 14000) / (1000 + 200 * 1400) * 100)
    assert got["top"]["code"] == "AAPL"  # 환산한 값으로 비교한다
    assert got["top"]["amount"] == 10.0  # 표시는 그 통화 그대로
    assert got["top"]["currency"] == "USD"
    assert FxRepo(rig.db).get(TUE) == 1400.0


async def test_without_a_rate_currencies_are_not_compared_or_added(rig: Rig) -> None:
    rig.prior_record()
    rig.fx = {}
    rig.hold("KR", "A", 10, (MON, 100.0), (TUE, 101.0))  # +10원
    rig.hold("US", "AAPL", 2, (FRI, 100.0), (MON, 105.0))  # +10달러
    got = await rig.recorder.my_assets("KR", TUE)
    assert got is not None
    assert got["change_krw"] is None
    assert got["change_pct"] is None
    assert got["currencies"]["KRW"]["change"] == 10.0
    assert got["currencies"]["USD"]["change"] == 10.0
    assert got["top"]["code"] == "A"  # 환율이 없으면 이 브리핑의 시장 안에서만 비교한다


async def test_missing_close_nulls_that_currency_and_keeps_the_rest(rig: Rig) -> None:
    rig.prior_record()
    rig.hold("KR", "A", 10, (MON, 100.0), (TUE, 110.0))
    rig.hold("KR", "NOBAR", 10, (MON, 100.0))
    rig.hold("US", "AAPL", 2, (FRI, 100.0), (MON, 105.0))
    got = await rig.recorder.my_assets("KR", TUE)
    assert got is not None
    assert got["currencies"]["KRW"] == {"change": None, "change_pct": None}
    assert got["currencies"]["USD"]["change"] == 10.0
    assert got["change_krw"] is None
    assert got["top"]["code"] == "AAPL"  # 환산하면 애플이 더 크다
    assert got["bottom"] is None


async def test_us_briefing_uses_its_own_session(rig: Rig) -> None:
    rig.prior_record()
    rig.hold("US", "AAPL", 2, (FRI, 100.0), (MON, 105.0))
    got = await rig.recorder.my_assets("US", MON)
    assert got is not None
    assert got["currencies"] == {"USD": {"change": 10.0, "change_pct": pytest.approx(5.0)}}
    assert ("US", "AAPL", MON) in rig.refreshed


# ---- 서비스와 API ---------------------------------------------------------------


def service(deps: AppDeps, assets: Any, **kw: Any) -> BriefingService:
    async def kr_day(day: date) -> bool:
        return day.weekday() < 5

    async def collect(market: str, session: date, feeds: Any, db: Any, *, alerts_until: Any) -> Any:
        return Collected({"market": market, "session": session.isoformat()})

    return BriefingService(
        deps,
        clock=MarketClock(kr_day, now=lambda: NOW),
        feeds_fn=lambda: cast(Any, None),
        run_fn=lambda: LlmRun("cloud", TIER, TIER, {}, {}),
        collect_fn=collect,
        interpret_fn=kw.get("interpret", lambda market, data, run: dict(TEXT)),
        notify_fn=lambda *_: None,
        now=lambda: NOW,
        assets_fn=assets,
    )


SECTION = {
    "change_krw": 100.0,
    "change_pct": 10.0,
    "currencies": {"KRW": {"change": 100.0, "change_pct": 10.0}},
    "top": {"code": "A", "name": "가", "amount": 100.0, "currency": "KRW"},
    "bottom": None,
}


async def test_section_is_saved_apart_from_data_and_served(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    seen: dict[str, Any] = {}

    def interpret(market: str, data: dict[str, Any], run: Any) -> dict[str, str]:
        seen.update(data)
        return dict(TEXT)

    async def assets(market: str, session: date) -> dict[str, Any]:
        assert seen, "내 자산은 AI 해석이 끝난 뒤에 계산한다"
        return SECTION

    bid = await service(deps, assets, interpret=interpret).generate("KR", TUE)
    assert "my_assets" not in seen
    r = (await client.get(f"/briefings/{bid}")).json()
    assert r["my_assets"] == SECTION
    assert "my_assets" not in r["data"]
    assert r["status"] == "done"
    assert r["missing"] == []


async def test_no_holdings_is_not_counted_as_missing(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    async def assets(market: str, session: date) -> None:
        return None

    bid = await service(deps, assets).generate("KR", TUE)
    r = (await client.get(f"/briefings/{bid}")).json()
    assert r["my_assets"] is None
    assert r["missing"] == []
    assert r["status"] == "done"


async def test_failed_section_does_not_stop_the_briefing(deps: AppDeps) -> None:
    async def assets(market: str, session: date) -> None:
        raise RuntimeError("boom")

    assert deps.db is not None
    bid = await service(deps, assets).generate("KR", TUE)
    saved = BriefingRepo(deps.db).get(bid)
    assert saved.my_assets is None
    assert saved.missing == ["my_assets"]
    assert saved.text == TEXT


async def test_section_is_saved_even_when_ai_fails(deps: AppDeps) -> None:
    def interpret(market: str, data: dict[str, Any], run: Any) -> dict[str, str]:
        raise RuntimeError("llm down")

    async def assets(market: str, session: date) -> dict[str, Any]:
        return SECTION

    assert deps.db is not None
    bid = await service(deps, assets, interpret=interpret).generate("KR", TUE)
    saved = BriefingRepo(deps.db).get(bid)
    assert saved.my_assets == SECTION
    assert saved.missing == ["interpretation"]


def test_repo_round_trip_and_regenerate(tmp_path: Path) -> None:
    db = open_db(tmp_path)
    repo = BriefingRepo(db)
    first = repo.save("KR", TUE, {}, None, [], my_assets=SECTION)
    assert repo.get(first).my_assets == SECTION
    assert repo.save("KR", TUE, {}, None, []) == first
    assert repo.get(first).my_assets is None  # 다시 만들면 그때 값으로 바꾼다
