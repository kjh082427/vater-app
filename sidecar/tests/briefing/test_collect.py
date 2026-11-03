import sqlite3
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest

from vater_core.alerts.store import EventRepo, RuleRepo, WatchItem, WatchlistRepo
from vater_core.analysis.symbols import resolve_target
from vater_core.api.errors import VaterError
from vater_core.briefing.collect import collect
from vater_core.kis.client import KisApiError
from vater_core.kis.market import IndexQuote, InvestorFlows, OverseasIndex, RankItem, SectorBoard
from vater_core.kis.models import Bar, Quote
from vater_core.store.db import open_db

KR_DAY = date(2026, 11, 3)
KR_NOW = datetime(2026, 11, 3, 7, 0, tzinfo=UTC)  # 16:00 KST
US_DAY = date(2026, 11, 2)
US_NOW = datetime(2026, 11, 2, 22, 0, tzinfo=UTC)  # 화 07:00 KST


@pytest.fixture
def db(tmp_path: Path) -> sqlite3.Connection:
    conn = open_db(tmp_path)
    conn.executemany(
        "INSERT INTO symbols (market, code, exchange, name, name_en, kind) VALUES (?,?,?,?,?,?)",
        [
            ("KR", "005930", "KOSPI", "삼성전자", None, "stock"),
            ("KR", "000660", "KOSPI", "SK하이닉스", None, "stock"),
            ("US", "AAPL", "NAS", "애플", "APPLE INC", "stock"),
        ],
    )
    conn.commit()
    return conn


def iq(code: str, name: str, value: float = 100.0) -> IndexQuote:
    return IndexQuote(code, name, value, 1.0, 1.0)


class FakeFeeds:
    """한투 조회 흉내. `fail[(메서드, 인자)]` 또는 `fail[메서드]`에 예외를 넣으면 그걸 낸다."""

    def __init__(self) -> None:
        self.fail: dict[Any, Exception] = {}
        self.calls: list[tuple[str, Any]] = []

    def _check(self, method: str, arg: Any = None) -> None:
        self.calls.append((method, arg))
        for key in ((method, arg), method):
            if key in self.fail:
                raise self.fail[key]

    async def index_quote(self, m: str) -> IndexQuote:
        self._check("index_quote", m)
        return iq("0001" if m == "KOSPI" else "1001", m)

    async def index_daily(self, m: str, start: date, end: date) -> list[Bar]:
        self._check("index_daily", m)
        # 세션 다음 날의 (장중 미확정) 봉까지 섞어 준다: 수집이 걸러야 한다
        days = [end + timedelta(days=1)] + [end - timedelta(days=i) for i in range(40)]
        return [Bar(d, 1, 1, 1, float(d.toordinal() % 1000), 1) for d in sorted(days)]

    async def sector_board(self, m: str) -> SectorBoard:
        self._check("sector_board", m)
        return SectorBoard(iq("0001", m), 500, 300, 50, [iq("0013", "전기전자")])

    async def fluctuation_rank(self, direction: str, limit: int = 10) -> list[RankItem]:
        self._check("fluctuation_rank", direction)
        return [RankItem(1, "005930", "삼성전자", 70000, 5.0 if direction == "up" else -5.0, 1)]

    async def trading_value_rank(self, limit: int = 10) -> list[RankItem]:
        self._check("trading_value_rank")
        return [RankItem(1, "005930", "삼성전자", 70000, 5.0, 1_000_000)]

    async def investor_flows(self, m: str, day: date) -> InvestorFlows:
        self._check("investor_flows", m)
        return InvestorFlows(day, 1200, -300, -900)

    async def overseas_index(self, code: str, start: date, end: date) -> OverseasIndex:
        self._check("overseas_index", code)
        days = [end - timedelta(days=i) for i in range(40)][::-1]
        return OverseasIndex(
            iq(code, code, 6000), [Bar(d, 1, 1, 1, float(i), 1) for i, d in enumerate(days)]
        )

    async def price(self, item: WatchItem) -> Quote:
        self._check("price", item.code)
        return Quote(item.market, item.code, 70000.0, 500.0, 0.72, 1000)  # type: ignore[arg-type]


def watch(db: sqlite3.Connection, market: str, code: str) -> WatchItem:
    return WatchlistRepo(db).add(resolve_target(db, market, code))


async def test_kr_collects_every_section(db: sqlite3.Connection) -> None:
    watch(db, "KR", "005930")
    got = await collect("KR", KR_DAY, FakeFeeds(), db, alerts_until=KR_NOW)

    assert got.missing == []
    d = got.data
    assert (d["market"], d["session"], d["collected_at"]) == (
        "KR",
        "2026-11-03",
        "2026-11-03T16:00:00+09:00",
    )
    assert [i["name"] for i in d["indices"]] == ["KOSPI", "KOSDAQ"]
    kospi = d["indices"][0]
    assert {k: kospi[k] for k in ("code", "name", "value", "change", "change_pct")} == {
        "code": "0001",
        "name": "KOSPI",
        "value": 100.0,
        "change": 1.0,
        "change_pct": 1.0,
    }
    # 국내 지수도 미니 차트용 최근 30거래일 종가. 세션 다음 날 봉은 빠진다
    assert len(kospi["closes"]) == 30
    assert kospi["closes"][-1] == {"day": "2026-11-03", "close": float(KR_DAY.toordinal() % 1000)}
    assert set(d["sectors"]) == {"KOSPI", "KOSDAQ"}
    assert d["sectors"]["KOSPI"]["advancers"] == 500
    assert d["sectors"]["KOSPI"]["sectors"][0]["name"] == "전기전자"
    assert [m["change_pct"] for m in d["movers"]["down"]] == [-5.0]
    assert d["movers"]["value"][0]["trading_value"] == 1_000_000
    assert d["flows"]["KOSPI"] == {
        "day": "2026-11-03",
        "foreign": 1200,
        "institution": -300,
        "individual": -900,
    }
    assert d["watchlist"] == [
        {"code": "005930", "name": "삼성전자", "price": 70000.0, "change_pct": 0.72}
    ]
    assert d["alerts"] == []


async def test_us_has_indices_with_closes_but_no_kr_only_sections(db: sqlite3.Connection) -> None:
    watch(db, "US", "AAPL")
    watch(db, "KR", "005930")
    got = await collect("US", US_DAY, FakeFeeds(), db, alerts_until=US_NOW)

    assert got.missing == []
    assert [i["code"] for i in got.data["indices"]] == ["SPX", "COMP", "NDX"]
    closes = got.data["indices"][0]["closes"]
    assert len(closes) == 30 and closes[-1] == {"day": "2026-11-02", "close": 39.0}
    assert not {"sectors", "movers", "flows"} & set(got.data)
    assert [w["code"] for w in got.data["watchlist"]] == ["AAPL"]


async def test_one_failed_section_is_reported_missing(db: sqlite3.Connection) -> None:
    feeds = FakeFeeds()
    feeds.fail["investor_flows"] = KisApiError("EGW00500", "일시 오류")
    got = await collect("KR", KR_DAY, feeds, db, alerts_until=KR_NOW)
    assert got.missing == ["flows"]
    assert "flows" not in got.data and "indices" in got.data


async def test_half_a_section_counts_as_missing(db: sqlite3.Connection) -> None:
    feeds = FakeFeeds()
    feeds.fail[("sector_board", "KOSDAQ")] = KisApiError("EGW00500", "일시 오류")
    got = await collect("KR", KR_DAY, feeds, db, alerts_until=KR_NOW)
    assert got.missing == ["sectors"] and "sectors" not in got.data


async def test_one_watch_item_failing_skips_only_that_item(db: sqlite3.Connection) -> None:
    watch(db, "KR", "005930")
    watch(db, "KR", "000660")
    feeds = FakeFeeds()
    feeds.fail[("price", "005930")] = KisApiError("EGW00500", "일시 오류")
    got = await collect("KR", KR_DAY, feeds, db, alerts_until=KR_NOW)
    assert got.missing == []
    assert [w["code"] for w in got.data["watchlist"]] == ["000660"]


@pytest.mark.parametrize(
    "error",
    [VaterError("KIS_UNREACHABLE", "끊김", status=503), httpx.ConnectError("no route")],
)
async def test_internet_loss_is_raised(db: sqlite3.Connection, error: Exception) -> None:
    feeds = FakeFeeds()
    feeds.fail["sector_board"] = error
    with pytest.raises(type(error)):
        await collect("KR", KR_DAY, feeds, db, alerts_until=KR_NOW)


async def test_nothing_collected_is_an_error(db: sqlite3.Connection) -> None:
    feeds = FakeFeeds()
    for method in (
        "index_quote",
        "sector_board",
        "fluctuation_rank",
        "trading_value_rank",
        "investor_flows",
    ):
        feeds.fail[method] = KisApiError("EGW00500", "일시 오류")
    with pytest.raises(VaterError) as e:
        await collect("KR", KR_DAY, feeds, db, alerts_until=KR_NOW)
    assert (e.value.code, e.value.status) == ("BRIEFING_NO_DATA", 502)


async def test_us_alerts_use_the_new_york_session_window(db: sqlite3.Connection) -> None:
    us = watch(db, "US", "AAPL")
    kr = watch(db, "KR", "005930")
    rules = RuleRepo(db)
    us_rule = rules.create(us.id, "price_above", {"price": 1}, "realtime", True)
    kr_rule = rules.create(kr.id, "price_above", {"price": 1}, "realtime", True)
    events = EventRepo(db)
    events.add(us_rule.id, "2026-11-02T23:20:00+09:00", 1, "애플 장 전")  # 09:20 NY, 개장 전
    events.add(us_rule.id, "2026-11-02T23:45:00+09:00", 1, "애플 장중 (한국 월요일 밤)")
    events.add(us_rule.id, "2026-11-03T06:10:00+09:00", 1, "애플 마감 평가 (한국 화요일)")
    events.add(us_rule.id, "2026-11-03T07:30:00+09:00", 1, "애플 브리핑 뒤")
    events.add(kr_rule.id, "2026-11-03T01:00:00+09:00", 1, "삼성전자")
    events.add(None, "2026-11-03T01:00:00+09:00", None, "AI 분석 완료: 애플 — 매수")

    got = await collect("US", US_DAY, FakeFeeds(), db, alerts_until=US_NOW)

    assert [a["message"] for a in got.data["alerts"]] == [
        "애플 장중 (한국 월요일 밤)",
        "애플 마감 평가 (한국 화요일)",
    ]
    assert got.data["alerts"][0] == {
        "fired_at": "2026-11-02T23:45:00+09:00",
        "name": "애플",
        "kind": "price_above",
        "message": "애플 장중 (한국 월요일 밤)",
    }


async def test_kr_index_closes_failing_makes_indices_missing(db: sqlite3.Connection) -> None:
    feeds = FakeFeeds()
    feeds.fail[("index_daily", "KOSDAQ")] = KisApiError("EGW00500", "일시 오류")
    got = await collect("KR", KR_DAY, feeds, db, alerts_until=KR_NOW)
    assert got.missing == ["indices"] and "indices" not in got.data
