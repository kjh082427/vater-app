"""브리핑 API. 서비스는 실제(BriefingService), 수집·해석은 가짜다."""

import asyncio
from datetime import UTC, date, datetime
from typing import Any, cast

import httpx
import pytest

from vater_core.alerts.clock import MarketClock
from vater_core.api.deps import AppDeps
from vater_core.briefing.collect import Collected, Feeds
from vater_core.briefing.service import BriefingService
from vater_core.briefing.store import BriefingRepo
from vater_core.llm.presets import LlmRun, TierChoice

TUE = date(2026, 11, 3)
TEXT = {k: "" for k in ("market", "sectors", "flows", "notable", "watchlist")} | {
    "headline": "반도체가 시장을 이끌었다."
}
TIER = TierChoice("google", "m", None)


def repo(deps: AppDeps) -> BriefingRepo:
    assert deps.db is not None
    return BriefingRepo(deps.db)


def quiet(title: str, body: str, route: str | None = None) -> None:
    return None


def install(
    deps: AppDeps, at: datetime, *, trading: bool = True, interpret: Any = None
) -> asyncio.Event:
    gate = asyncio.Event()

    async def trading_day(day: date) -> bool:
        return trading and day.weekday() < 5

    async def collect(
        market: str, session: date, feeds: Any, db: Any, *, alerts_until: datetime
    ) -> Collected:
        await gate.wait()
        return Collected({"market": market, "session": session.isoformat()}, [])

    deps.briefing = BriefingService(
        deps,
        clock=MarketClock(trading_day, now=lambda: at),
        feeds_fn=lambda: cast(Feeds, None),
        run_fn=lambda: LlmRun("cloud", TIER, TIER, {}, {}),
        collect_fn=collect,
        interpret_fn=interpret or (lambda m, d, r: dict(TEXT)),
        notify_fn=quiet,
        now=lambda: at,
    )
    return gate


async def test_list_and_detail(client: httpx.AsyncClient, deps: AppDeps) -> None:
    a = repo(deps).save("KR", date(2026, 11, 2), {"market": "KR", "indices": []}, TEXT, [])
    b = repo(deps).save("US", date(2026, 11, 2), {"market": "US"}, None, ["interpretation"])
    c = repo(deps).save("KR", TUE, {"market": "KR"}, {**TEXT, "headline": ""}, ["flows"])

    items = (await client.get("/briefings")).json()
    assert [i["id"] for i in items] == [c, b, a]
    assert items[2] == {
        "id": a,
        "market": "KR",
        "date": "2026-11-02",
        "status": "done",
        "headline": "반도체가 시장을 이끌었다.",
        "missing": [],
        "created_at": items[2]["created_at"],
    }
    assert items[1]["headline"] is None and items[0]["headline"] is None  # 해석 없음 / 빈 문장
    assert [
        i["id"]
        for i in (await client.get("/briefings", params={"market": "KR", "limit": 1})).json()
    ] == [c]

    detail = (await client.get(f"/briefings/{a}")).json()
    assert detail["data"] == {"market": "KR", "indices": []} and detail["text"] == TEXT
    assert (await client.get(f"/briefings/{b}")).json()["text"] is None


async def test_unknown_briefing(client: httpx.AsyncClient) -> None:
    r = await client.get("/briefings/99")
    assert (r.status_code, r.json()["code"]) == (404, "BRIEFING_NOT_FOUND")


async def test_run_now_then_busy(client: httpx.AsyncClient, deps: AppDeps) -> None:
    gate = install(deps, datetime(2026, 11, 3, 8, 0, tzinfo=UTC))  # 화 17:00 KST
    r = await client.post("/briefings/run", json={"market": "KR"})
    assert (r.status_code, r.json()) == (202, {"market": "KR", "date": "2026-11-03"})

    busy = await client.post("/briefings/run", json={"market": "US"})
    assert (busy.status_code, busy.json()["code"]) == (409, "BRIEFING_BUSY")

    gate.set()
    for _ in range(50):
        if repo(deps).find("KR", TUE) is not None:
            break
        await asyncio.sleep(0.01)
    assert repo(deps).find("KR", TUE) is not None
    assert deps.briefing is not None
    await deps.briefing.stop()


async def test_run_without_a_recent_session(client: httpx.AsyncClient, deps: AppDeps) -> None:
    install(deps, datetime(2026, 11, 3, 8, 0, tzinfo=UTC), trading=False)
    r = await client.post("/briefings/run", json={"market": "KR"})
    assert (r.status_code, r.json()["code"]) == (409, "BRIEFING_NO_SESSION")


async def test_run_rejects_an_unknown_market(client: httpx.AsyncClient) -> None:
    r = await client.post("/briefings/run", json={"market": "JP"})
    assert (r.status_code, r.json()["code"]) == (422, "REQUEST_INVALID")


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/briefings"),
        ("GET", "/briefings/1"),
        ("POST", "/briefings/run"),
        ("POST", "/briefings/1/interpret"),
    ],
)
async def test_routes_need_the_token(
    anon_client: httpx.AsyncClient, method: str, path: str
) -> None:
    assert (await anon_client.request(method, path)).status_code == 401


REASON = {"code": "LLM_BUSY", "message": "구글 AI 서버가 계속 혼잡해 해석을 만들지 못했습니다."}


async def test_detail_tells_why_there_is_no_interpretation(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    bad = repo(deps).save("KR", TUE, {"market": "KR"}, None, ["interpretation"], None, REASON)
    ok = repo(deps).save("US", TUE, {"market": "US"}, TEXT, [])
    assert (await client.get(f"/briefings/{bad}")).json()["interpret_error"] == REASON
    assert (await client.get(f"/briefings/{ok}")).json()["interpret_error"] is None


async def test_interpret_again_runs_in_the_background(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    seen: list[dict[str, Any]] = []

    def interpret(market: str, data: dict[str, Any], run: LlmRun) -> dict[str, str]:
        seen.append(data)
        return dict(TEXT)

    install(deps, datetime(2026, 11, 3, 8, 0, tzinfo=UTC), interpret=interpret)
    bid = repo(deps).save("KR", TUE, {"market": "KR"}, None, ["interpretation"], None, REASON)

    r = await client.post(f"/briefings/{bid}/interpret")
    assert (r.status_code, r.json()) == (202, {"market": "KR", "date": "2026-11-03"})
    for _ in range(100):
        if repo(deps).get(bid).text is not None:
            break
        await asyncio.sleep(0.01)
    done = (await client.get(f"/briefings/{bid}")).json()
    assert (done["status"], done["missing"], done["interpret_error"]) == ("done", [], None)
    assert done["headline"] == TEXT["headline"] and seen == [{"market": "KR"}]
    assert deps.briefing is not None
    await deps.briefing.stop()


async def test_interpret_again_while_busy_or_unknown(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    gate = install(deps, datetime(2026, 11, 3, 8, 0, tzinfo=UTC))
    bid = repo(deps).save("KR", TUE, {"market": "KR"}, None, ["interpretation"], None, REASON)
    assert (await client.post("/briefings/run", json={"market": "KR"})).status_code == 202
    busy = await client.post(f"/briefings/{bid}/interpret")
    assert (busy.status_code, busy.json()["code"]) == (409, "BRIEFING_BUSY")
    gate.set()
    assert deps.briefing is not None
    await deps.briefing.stop()

    missing = await client.post("/briefings/99/interpret")
    assert (missing.status_code, missing.json()["code"]) == (404, "BRIEFING_NOT_FOUND")
