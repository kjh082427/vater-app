"""3단계 확인 D·E: 분석 완료와 브리핑이 API·SSE·알림 이력까지 이어지는지.

분석 엔진(TradingAgents)과 브리핑 수집·해석(한투·LLM)만 가짜이고, 작업 큐·이벤트 기록·일정·저장·
API는 실제 코드다.
"""

import asyncio
import threading
from collections.abc import AsyncIterator, Callable
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, cast

import httpx
import pytest

from vater_core.alerts.clock import MarketClock
from vater_core.alerts.evaluator import record_event_alerts
from vater_core.analysis.engine import Cancelled
from vater_core.analysis.models import EngineResult, Progress
from vater_core.analysis.queue import AnalysisQueue
from vater_core.analysis.summary import DecisionSummary
from vater_core.api.app import create_app
from vater_core.api.deps import AppDeps
from vater_core.api.errors import VaterError
from vater_core.api.events import EventBus
from vater_core.briefing.collect import Collected, Feeds
from vater_core.briefing.service import BriefingService
from vater_core.llm.presets import LlmRun, TierChoice
from vater_core.secrets.names import SecretName
from vater_core.secrets.store import EnvFileSecretStore
from vater_core.store.db import open_db

TOKEN = "acc"
TIER = TierChoice("google", "m", None)
TEXT = {k: "문장." for k in ("headline", "market", "sectors", "flows", "notable", "watchlist")}


class Engine:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail

    def run(self, job: Any, on_progress: Any, cancel: threading.Event, kis: Any) -> EngineResult:
        on_progress(Progress("analysts", "Market Analyst", 1.0))
        if cancel.is_set():
            raise Cancelled
        if self.fail:
            raise RuntimeError("engine exploded")
        return EngineResult(
            summary=DecisionSummary("Buy", ("근거 1.", "근거 2."), "250000", "3-6 months"),
            reports={"final_trade_decision": "**Rating**: Buy"},
            timings={"analysts": 1.0},
            tokens={"in": 10, "out": 5},
        )


async def latest(_: Any) -> date:
    return date(2026, 11, 2)


@pytest.fixture
async def deps(tmp_path: Path) -> AsyncIterator[AppDeps]:
    db = open_db(tmp_path / "data")
    db.execute(
        "INSERT INTO symbols (market, code, exchange, name, name_en, kind) VALUES (?,?,?,?,?,?)",
        ("KR", "005930", "KOSPI", "삼성전자", None, "stock"),
    )
    db.commit()
    secrets = EnvFileSecretStore(tmp_path / "secrets.env")
    for name in (SecretName.LLM_GOOGLE_KEY, SecretName.KIS_APP_KEY, SecretName.KIS_APP_SECRET):
        secrets.set(name, "dummy")
    d = AppDeps(
        token=TOKEN, dev=False, data_dir=tmp_path, db=db, secrets=secrets, events=EventBus()
    )
    yield d
    if d.analysis is not None:
        await d.analysis.stop()
    if d.briefing is not None:
        await d.briefing.stop()
    if d.http is not None:
        await d.http.aclose()


def api(deps: AppDeps) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app(deps)),
        base_url="http://sidecar",
        headers={"Authorization": f"Bearer {TOKEN}"},
    )


async def until(cond: Callable[[], Any], timeout: float = 10) -> None:
    for _ in range(int(timeout / 0.02)):
        if await cond():
            return
        await asyncio.sleep(0.02)
    raise AssertionError("timed out")


@pytest.mark.parametrize(
    ("fail", "status", "message"),
    [
        (False, "done", "AI 분석 완료: 삼성전자 — 매수"),
        (True, "failed", "AI 분석 실패: 삼성전자 — 분석 중 오류가 났습니다 (RuntimeError)."),
    ],
)
async def test_d_analysis_result_reaches_alert_history(
    deps: AppDeps, fail: bool, status: str, message: str
) -> None:
    assert deps.events is not None and deps.db is not None
    stop = record_event_alerts(deps.events, deps.db)
    sub = deps.events.subscribe()
    q = AnalysisQueue(deps, Engine(fail), latest_day=latest, notify_fn=lambda *a: None)
    q.start()
    deps.analysis = q
    async with api(deps) as c:
        r = await c.post("/analyses", json={"market": "KR", "code": "005930"})
        assert r.status_code == 202
        aid = r.json()["id"]

        async def finished() -> bool:
            return bool((await c.get(f"/analyses/{aid}")).json()["status"] == status)

        await until(finished)

        async def recorded() -> bool:
            return bool((await c.get("/alerts/events")).json())

        await until(recorded)
        events = (await c.get("/alerts/events")).json()
    stop()
    assert [(e["rule_id"], e["message"]) for e in events] == [(None, message)]
    seen = []
    while not sub.queue.empty():
        seen.append(sub.queue.get_nowait())
    assert {"id": aid, "status": status} == {
        k: v for k, v in seen[-1].data.items() if k in ("id", "status")
    }


def quiet(title: str, body: str, route: str | None = None) -> None:
    return None


def briefing(deps: AppDeps, at: datetime, *, llm_fails: bool = False) -> BriefingService:
    async def weekdays(day: date) -> bool:
        return day.weekday() < 5

    async def collect(
        market: str, session: date, feeds: Any, db: Any, *, alerts_until: datetime
    ) -> Collected:
        return Collected({"market": market, "session": session.isoformat(), "indices": []}, [])

    def interpret(market: str, data: dict[str, Any], run: LlmRun) -> dict[str, str]:
        if llm_fails:
            raise VaterError(
                "BRIEFING_LLM_FAILED", "AI 해석에 실패했습니다 (RateLimit).", status=502
            )
        return dict(TEXT)

    service = BriefingService(
        deps,
        clock=MarketClock(weekdays, now=lambda: at),
        feeds_fn=lambda: cast(Feeds, None),
        run_fn=lambda: LlmRun("cloud", TIER, TIER, {}, {}),
        collect_fn=collect,
        interpret_fn=interpret,
        notify_fn=quiet,
        now=lambda: at,
    )
    deps.briefing = service
    return service


KR_16 = datetime(2026, 11, 3, 7, 0, tzinfo=UTC)  # 화 16:00 KST


@pytest.mark.parametrize(
    ("llm_fails", "status", "missing"),
    [(False, "done", []), (True, "partial", ["interpretation"])],
)
async def test_e1_e2_scheduled_briefing_reaches_api_and_history(
    deps: AppDeps, llm_fails: bool, status: str, missing: list[str]
) -> None:
    assert deps.events is not None
    sub = deps.events.subscribe()
    service = briefing(deps, KR_16, llm_fails=llm_fails)
    await service.tick_once()  # 일정 루프 1회 (미국은 이미 지난 세션 → 같이 만들어질 수 있다)
    async with api(deps) as c:
        items = (await c.get("/briefings", params={"market": "KR"})).json()
        events = (await c.get("/alerts/events")).json()
    assert [(i["date"], i["status"], i["missing"]) for i in items] == [
        ("2026-11-03", status, missing)
    ]
    assert "시장 브리핑 도착: 국내 2026-11-03" in [e["message"] for e in events]
    done = [e.data for e in [sub.queue.get_nowait() for _ in range(sub.queue.qsize())]
            if e.type == "briefing.status" and e.data["market"] == "KR"]  # fmt: skip
    assert [d["status"] for d in done] == ["running", status]


async def test_e3_manual_run_during_the_next_session_is_refused(deps: AppDeps) -> None:
    briefing(deps, datetime(2026, 11, 3, 2, 0, tzinfo=UTC))  # 화 11:00 KST, 국내 장중
    async with api(deps) as c:
        r = await c.post("/briefings/run", json={"market": "KR"})
    assert (r.status_code, r.json()["code"]) == (409, "BRIEFING_NO_SESSION")
