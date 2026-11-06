import asyncio
import sqlite3
import threading
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, cast

import pytest

from vater_core.alerts.clock import MarketClock
from vater_core.api.deps import AppDeps
from vater_core.api.errors import VaterError
from vater_core.api.events import Event, EventBus
from vater_core.briefing.collect import Collected, Feeds
from vater_core.briefing.service import (
    RETRY_EVERY,
    RETRY_WINDOW,
    BriefingService,
    get_briefing,
)
from vater_core.briefing.store import BriefingRepo
from vater_core.llm.presets import LlmRun, TierChoice
from vater_core.store.db import open_db
from vater_core.store.settings import SettingsRepo

TUE = date(2026, 11, 3)
MON = date(2026, 11, 2)
KR_SLOT = datetime(2026, 11, 3, 7, 0, tzinfo=UTC)  # 화 16:00 KST
TEXT = {k: "문장." for k in ("headline", "market", "sectors", "flows", "notable", "watchlist")}
TIER = TierChoice("google", "m", None)


class Clock:
    def __init__(self, at: datetime) -> None:
        self.at = at

    def __call__(self) -> datetime:
        return self.at


class Rig:
    def __init__(self, db: sqlite3.Connection, at: datetime, llm_timeout: float = 5.0) -> None:
        self.db = db
        self.clock = Clock(at)
        self.bus = EventBus()
        self.deps = AppDeps(token="t", dev=True, data_dir=Path("."), db=db, events=self.bus)
        self.notes: list[tuple[str, str, str | None]] = []
        self.collected: list[tuple[str, date]] = []
        self.collect_error: Exception | None = None
        self.missing: list[str] = []
        self.gate: asyncio.Event | None = None
        self.interpret_error: Exception | None = None
        self.run_error: Exception | None = None
        self.feeds_error: Exception | None = None
        self.interpret_block: threading.Event | None = None
        self.interpreted: list[dict[str, Any]] = []

        async def weekdays(day: date) -> bool:
            return day.weekday() < 5

        async def collect(
            market: str, session: date, feeds: Any, db: Any, *, alerts_until: datetime
        ) -> Collected:
            self.collected.append((market, session))
            if self.gate is not None:
                await self.gate.wait()
            if self.collect_error is not None:
                raise self.collect_error
            return Collected({"market": market, "session": session.isoformat()}, list(self.missing))

        def interpret(market: str, data: dict[str, Any], run: LlmRun) -> dict[str, str]:
            self.interpreted.append(data)
            if self.interpret_block is not None:
                self.interpret_block.wait()  # 응답이 오지 않는 LLM
            if self.interpret_error is not None:
                raise self.interpret_error
            return dict(TEXT)

        def run_fn() -> LlmRun:
            if self.run_error is not None:
                raise self.run_error
            return LlmRun("cloud", TIER, TIER, {}, {})

        async def sleep(_: float) -> None:
            await asyncio.sleep(0)

        def feeds() -> Feeds:
            if self.feeds_error is not None:
                raise self.feeds_error
            return cast(Feeds, None)  # 수집 함수를 바꿨으므로 쓰이지 않는다

        def note(title: str, body: str, route: str | None = None) -> None:
            self.notes.append((title, body, route))

        self.service = BriefingService(
            self.deps,
            clock=MarketClock(weekdays, now=self.clock),
            feeds_fn=feeds,
            run_fn=run_fn,
            collect_fn=collect,
            interpret_fn=interpret,
            notify_fn=note,
            now=self.clock,
            sleep=sleep,
            llm_timeout=llm_timeout,
        )


@pytest.fixture
def db(tmp_path: Path) -> sqlite3.Connection:
    return open_db(tmp_path)


def event_rows(db: sqlite3.Connection) -> list[tuple[Any, ...]]:
    return db.execute("SELECT rule_id, fired_at, value, message FROM alert_events").fetchall()


async def drain(sub: Any) -> list[Event]:
    out = []
    while not sub.queue.empty():
        out.append(sub.queue.get_nowait())
    return out


async def test_generate_saves_notifies_and_records(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_SLOT)
    sub = rig.bus.subscribe()

    bid = await rig.service.generate("KR", TUE)

    b = BriefingRepo(db).get(bid)
    assert (b.market, b.date, b.status, b.text, b.missing) == ("KR", "2026-11-03", "done", TEXT, [])
    assert rig.notes == [
        ("오늘의 시장 브리핑", "국내 11/3 브리핑이 도착했습니다", f"/briefings/{bid}")
    ]
    assert event_rows(db) == [
        (None, "2026-11-03T16:00:00+09:00", None, "시장 브리핑 도착: 국내 2026-11-03")
    ]
    events = [(e.type, e.data) for e in await drain(sub)]
    assert events == [
        ("briefing.status", {"market": "KR", "date": "2026-11-03", "status": "running"}),
        ("briefing.status", {"market": "KR", "date": "2026-11-03", "status": "done", "id": bid}),
    ]


@pytest.mark.parametrize(
    "where",
    ["interpret", "run"],
)
async def test_llm_problems_still_save_the_data(db: sqlite3.Connection, where: str) -> None:
    rig = Rig(db, KR_SLOT)
    rig.missing = ["flows"]
    if where == "interpret":
        rig.interpret_error = VaterError("BRIEFING_LLM_FAILED", "실패", status=502)
    else:
        rig.run_error = VaterError("LLM_KEY_MISSING", "키 없음", status=409)

    bid = await rig.service.generate("KR", TUE)

    b = BriefingRepo(db).get(bid)
    assert (b.status, b.text, b.missing) == ("partial", None, ["flows", "interpretation"])
    assert len(rig.notes) == 1


async def test_collect_failure_saves_nothing_and_reports(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_SLOT)
    rig.collect_error = VaterError("BRIEFING_NO_DATA", "없음", status=502)
    sub = rig.bus.subscribe()

    with pytest.raises(VaterError):
        await rig.service.generate("KR", TUE)

    assert BriefingRepo(db).list() == [] and rig.notes == []
    last = (await drain(sub))[-1]
    assert last.data == {
        "market": "KR",
        "date": "2026-11-03",
        "status": "failed",
        "error": {"code": "BRIEFING_NO_DATA", "message": "없음"},
    }


async def test_regenerating_overwrites(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_SLOT)
    first = await rig.service.generate("KR", TUE)
    assert await rig.service.generate("KR", TUE) == first
    assert len(BriefingRepo(db).list()) == 1


async def test_one_at_a_time(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_SLOT)
    rig.gate = asyncio.Event()
    first = asyncio.create_task(rig.service.generate("KR", TUE))
    await asyncio.sleep(0)
    with pytest.raises(VaterError) as e:
        await rig.service.generate("US", MON)
    assert (e.value.code, e.value.status) == ("BRIEFING_BUSY", 409)
    rig.gate.set()
    await first


async def test_tick_makes_each_due_briefing_once(db: sqlite3.Connection) -> None:
    rig = Rig(
        db, KR_SLOT - timedelta(minutes=1)
    )  # 15:59 KST, 미국 월 세션(화 07:00 KST)은 이미 지남
    SettingsRepo(db).update({"briefing.us.enabled": False})
    await rig.service.tick_once()
    assert rig.collected == []

    rig.clock.at = KR_SLOT
    await rig.service.tick_once()
    await rig.service.tick_once()
    assert rig.collected == [("KR", TUE)]
    assert BriefingRepo(db).find("KR", TUE) is not None


async def test_tick_covers_the_us_morning_briefing(db: sqlite3.Connection) -> None:
    rig = Rig(db, datetime(2026, 11, 2, 22, 5, tzinfo=UTC))  # 화 07:05 KST
    SettingsRepo(db).update({"briefing.kr.enabled": False})
    await rig.service.tick_once()
    assert rig.collected == [("US", MON)]


async def test_tick_retries_after_five_minutes(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_SLOT)
    SettingsRepo(db).update({"briefing.us.enabled": False})
    rig.collect_error = VaterError("KIS_UNREACHABLE", "끊김", status=503)
    await rig.service.tick_once()

    rig.collect_error = None
    rig.clock.at = KR_SLOT + timedelta(minutes=1)
    await rig.service.tick_once()
    assert len(rig.collected) == 1

    rig.clock.at = KR_SLOT + timedelta(minutes=5)
    await rig.service.tick_once()
    assert len(rig.collected) == 2 and BriefingRepo(db).find("KR", TUE) is not None


async def test_run_latest_builds_the_last_closed_session(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_SLOT + timedelta(hours=1))  # 화 17:00 KST
    rig.gate = asyncio.Event()
    assert await rig.service.run_latest("KR") == TUE
    with pytest.raises(VaterError) as e:
        await rig.service.run_latest("KR")
    assert e.value.code == "BRIEFING_BUSY"
    rig.gate.set()
    for _ in range(20):
        await asyncio.sleep(0)
    assert BriefingRepo(db).find("KR", TUE) is not None


async def test_run_latest_without_any_session(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_SLOT)

    async def never(_: date) -> bool:
        return False

    rig.service._clock = MarketClock(never, now=rig.clock)  # 테스트에서만 바꾼다
    with pytest.raises(VaterError) as e:
        await rig.service.run_latest("KR")
    assert (e.value.code, e.value.status) == ("BRIEFING_NO_SESSION", 409)


async def test_start_and_stop(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_SLOT)
    SettingsRepo(db).update({"briefing.us.enabled": False})
    rig.service.start()
    for _ in range(20):
        await asyncio.sleep(0)
    assert rig.collected == [("KR", TUE)]
    await rig.service.stop()


async def test_get_briefing_without_keys_does_not_raise(db: sqlite3.Connection) -> None:
    deps = AppDeps(token="t", dev=True, data_dir=Path("."), db=db, events=EventBus())
    service = get_briefing(deps)
    assert get_briefing(deps) is service and deps.briefing is service
    await service.tick_once()  # 한투 키가 없으면 만들지 못하고 나중에 다시 시도한다
    await service.stop()


@pytest.mark.parametrize(
    ("at", "expected"),
    [
        (
            datetime(2026, 11, 3, 2, 0, tzinfo=UTC),
            None,
        ),  # 화 11:00 KST: 월 세션은 다음 장이 열려 만들 수 없다
        (datetime(2026, 11, 3, 6, 40, tzinfo=UTC), TUE),  # 화 15:40 KST: 화 세션
        (datetime(2026, 11, 2, 23, 0, tzinfo=UTC), MON),  # 화 08:00 KST: 개장 전이면 월 세션
    ],
)
async def test_manual_run_never_mixes_in_the_next_sessions_data(
    db: sqlite3.Connection, at: datetime, expected: date | None
) -> None:
    rig = Rig(db, at)
    if expected is None:
        with pytest.raises(VaterError) as e:
            await rig.service.run_latest("KR")
        assert (e.value.code, e.value.status) == ("BRIEFING_NO_SESSION", 409)
    else:
        assert await rig.service.run_latest("KR") == expected
        await rig.service.stop()


async def test_a_hung_llm_call_times_out_in_a_daemon_thread(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_SLOT, llm_timeout=0.2)
    rig.interpret_block = threading.Event()
    try:
        bid = await asyncio.wait_for(rig.service.generate("KR", TUE), 5)
        b = BriefingRepo(db).get(bid)
        assert (b.status, b.text, b.missing) == ("partial", None, ["interpretation"])
        hung = [t for t in threading.enumerate() if t.name == "vater-briefing-llm"]
        assert hung and all(t.daemon for t in hung)  # 앱 종료를 막지 않는다
    finally:
        rig.interpret_block.set()


async def test_missing_kis_keys_stay_quiet(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_SLOT)
    rig.feeds_error = VaterError("KIS_NOT_CONFIGURED", "키 없음", status=409)
    sub = rig.bus.subscribe()
    await rig.service.tick_once()
    assert await drain(sub) == []  # 첫 실행 마법사 중에 '브리핑 실패'를 보내지 않는다
    assert BriefingRepo(db).list() == []


# ---- AI 해석 다시 만들기와 자동 재시도 (v2 설계 21장 5번) ------------------------------


def busy_error() -> VaterError:
    return VaterError("LLM_BUSY", "구글 AI 서버가 계속 혼잡했습니다.", status=503)


async def saved_without_text(rig: Rig, error: Exception | None = None) -> int:
    rig.interpret_error = error or busy_error()
    bid = await rig.service.generate("KR", TUE)
    rig.interpret_error = None
    return bid


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (VaterError("LLM_DAILY_LIMIT", "하루 한도", status=429), "LLM_DAILY_LIMIT"),
        (VaterError("LLM_KEY_MISSING", "키 없음", status=409), "LLM_KEY_MISSING"),
        (RuntimeError("secret g-key"), "BRIEFING_LLM_FAILED"),
    ],
)
async def test_the_reason_for_a_missing_interpretation_is_saved(
    db: sqlite3.Connection, error: Exception, code: str
) -> None:
    rig = Rig(db, KR_SLOT)
    bid = await saved_without_text(rig, error)
    reason = BriefingRepo(db).get(bid).interpret_error
    assert reason is not None and reason["code"] == code
    assert "g-key" not in reason["message"]


async def test_a_timeout_is_saved_as_a_reason(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_SLOT, llm_timeout=0.1)
    rig.interpret_block = threading.Event()
    try:
        bid = await rig.service.generate("KR", TUE)
    finally:
        rig.interpret_block.set()
    reason = BriefingRepo(db).get(bid).interpret_error
    assert reason is not None and reason["code"] == "BRIEFING_LLM_FAILED"


async def test_reinterpret_fills_in_only_the_text(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_SLOT)
    rig.missing = ["flows"]
    bid = await saved_without_text(rig)
    before = BriefingRepo(db).get(bid)
    sub = rig.bus.subscribe()
    rig.notes.clear()

    await rig.service.reinterpret(bid)

    b = BriefingRepo(db).get(bid)
    assert (b.text, b.missing, b.status, b.interpret_error) == (TEXT, ["flows"], "partial", None)
    assert (b.data, b.created_at) == (before.data, before.created_at)
    assert rig.notes == [] and len(rig.collected) == 1  # 다시 수집하지도 알리지도 않는다
    assert rig.interpreted[-1] == before.data  # 처음과 같은 데이터만 AI에 간다
    events = [e.data for e in await drain(sub)]
    assert [e["status"] for e in events] == ["running", "partial"] and events[-1]["id"] == bid


async def test_reinterpret_failure_updates_the_reason(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_SLOT)
    bid = await saved_without_text(rig)
    rig.interpret_error = VaterError("LLM_DAILY_LIMIT", "하루 한도", status=429)

    await rig.service.reinterpret(bid)  # 실패해도 예외로 새지 않는다

    b = BriefingRepo(db).get(bid)
    assert (b.text, b.missing) == (None, ["interpretation"])
    assert b.interpret_error == {"code": "LLM_DAILY_LIMIT", "message": "하루 한도"}


async def test_reinterpret_does_not_run_twice_at_once(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_SLOT)
    bid = await saved_without_text(rig)
    rig.interpret_block = threading.Event()
    try:
        assert rig.service.start_reinterpret(bid).id == bid
        assert rig.service.busy()
        with pytest.raises(VaterError) as e:
            rig.service.start_reinterpret(bid)
        assert (e.value.code, e.value.status) == ("BRIEFING_BUSY", 409)
        with pytest.raises(VaterError):
            await rig.service.run_latest("KR")  # 브리핑 만들기도 같이 돌지 않는다
    finally:
        rig.interpret_block.set()
    for _ in range(50):
        await asyncio.sleep(0.01)
        if not rig.service.busy():
            break
    assert BriefingRepo(db).get(bid).text == TEXT
    await rig.service.stop()


async def test_reinterpret_of_an_unknown_briefing(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_SLOT)
    with pytest.raises(VaterError) as e:
        rig.service.start_reinterpret(99)
    assert (e.value.code, e.value.status) == ("BRIEFING_NOT_FOUND", 404)


async def settle(rig: Rig) -> None:
    for _ in range(300):
        await asyncio.sleep(0.01)
        if not rig.service.busy():
            return


async def test_tick_retries_a_missing_interpretation_on_schedule(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_SLOT)
    SettingsRepo(db).update({"briefing.us.enabled": False})
    bid = await saved_without_text(rig)  # 방금 한 번 실패했다
    calls = len(rig.interpreted)

    rig.clock.at = KR_SLOT + RETRY_EVERY - timedelta(minutes=1)
    await rig.service.tick_once()
    await settle(rig)
    assert len(rig.interpreted) == calls  # 간격이 차기 전에는 부르지 않는다

    rig.clock.at = KR_SLOT + RETRY_EVERY
    await rig.service.tick_once()
    await settle(rig)
    assert len(rig.interpreted) == calls + 1
    assert BriefingRepo(db).get(bid).text == TEXT
    await rig.service.tick_once()
    await settle(rig)
    assert len(rig.interpreted) == calls + 1  # 해석이 생기면 더 부르지 않는다


async def test_tick_keeps_the_interval_while_failures_repeat(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_SLOT)
    SettingsRepo(db).update({"briefing.us.enabled": False})
    await saved_without_text(rig)
    rig.interpret_error = busy_error()
    calls = len(rig.interpreted)

    for minutes in (30, 31, 45, 59, 60, 61, 90):
        rig.clock.at = KR_SLOT + timedelta(minutes=minutes)
        await rig.service.tick_once()
        await settle(rig)
    assert len(rig.interpreted) - calls == 3  # 30분, 60분, 90분에만


async def test_tick_stops_retrying_after_the_window(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_SLOT)
    SettingsRepo(db).update({"briefing.us.enabled": False})
    bid = await saved_without_text(rig)
    calls = len(rig.interpreted)
    stamp = (KR_SLOT - RETRY_WINDOW - timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    db.execute("UPDATE briefings SET created_at = ? WHERE id = ?", (stamp, bid))
    db.commit()

    rig.clock.at = KR_SLOT + RETRY_EVERY
    await rig.service.tick_once()
    await settle(rig)
    assert len(rig.interpreted) == calls


@pytest.mark.parametrize("code", ["LLM_DAILY_LIMIT", "LLM_KEY_INVALID", "LLM_KEY_MISSING"])
async def test_tick_does_not_retry_when_waiting_cannot_help(
    db: sqlite3.Connection, code: str
) -> None:
    rig = Rig(db, KR_SLOT)
    SettingsRepo(db).update({"briefing.us.enabled": False})
    await saved_without_text(rig, VaterError(code, "안 됨", status=409))
    calls = len(rig.interpreted)

    rig.clock.at = KR_SLOT + RETRY_EVERY * 2
    await rig.service.tick_once()
    await settle(rig)
    assert len(rig.interpreted) == calls


async def test_tick_retry_does_not_block_the_schedule(db: sqlite3.Connection) -> None:
    rig = Rig(db, KR_SLOT)
    SettingsRepo(db).update({"briefing.us.enabled": False})
    await saved_without_text(rig)
    rig.interpret_block = threading.Event()  # 해석이 멈춘 LLM
    rig.clock.at = KR_SLOT + RETRY_EVERY
    try:
        await asyncio.wait_for(rig.service.tick_once(), 2)  # 기다리지 않고 돌아온다
        assert rig.service.busy()
    finally:
        rig.interpret_block.set()
    await settle(rig)
    await rig.service.stop()


async def test_the_retry_window_and_interval_are_bounded() -> None:
    assert timedelta(minutes=10) <= RETRY_EVERY <= timedelta(hours=2)
    assert timedelta(hours=1) <= RETRY_WINDOW <= timedelta(hours=12)


async def test_a_timeout_stops_the_llm_thread_from_retrying(
    db: sqlite3.Connection, monkeypatch: pytest.MonkeyPatch
) -> None:
    """900초 시간 초과 뒤 daemon 스레드가 계속 기다리며 Gemini를 부르면 다시 만들기와 겹친다."""
    seen: list[threading.Event] = []

    def waits_for_stop(m: str, d: dict[str, Any], r: LlmRun, stop: threading.Event) -> Any:
        seen.append(stop)
        stop.wait(10)  # 대기 중인 스레드: 멈춤 신호가 서야 끝난다
        raise RuntimeError("stopped")

    monkeypatch.setattr("vater_core.briefing.service.interpret", waits_for_stop)
    rig = Rig(db, KR_SLOT, llm_timeout=0.1)
    rig.service._interpret = None  # 기본 해석 함수를 쓴다(테스트에서만 바꾼다)
    await rig.service.generate("KR", TUE)
    assert len(seen) == 1 and seen[0].is_set()
    for _ in range(100):
        if not [t for t in threading.enumerate() if t.name == "vater-briefing-llm"]:
            break
        await asyncio.sleep(0.02)
    assert not [t for t in threading.enumerate() if t.name == "vater-briefing-llm"]


async def test_stopping_the_service_stops_the_llm_thread(
    db: sqlite3.Connection, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[threading.Event] = []

    def waits_for_stop(m: str, d: dict[str, Any], r: LlmRun, stop: threading.Event) -> Any:
        seen.append(stop)
        stop.wait(10)
        raise RuntimeError("stopped")

    monkeypatch.setattr("vater_core.briefing.service.interpret", waits_for_stop)
    rig = Rig(db, KR_SLOT)
    rig.service._interpret = None
    bid = await saved_without_text(rig)
    seen.clear()
    rig.service.start_reinterpret(bid)
    for _ in range(100):
        await asyncio.sleep(0.01)
        if seen:
            break
    await rig.service.stop()
    assert seen and seen[0].is_set()


@pytest.mark.parametrize("code", ["LLM_LOCAL_MODEL_MISSING", "LLM_MODEL_UNKNOWN"])
async def test_tick_does_not_retry_a_model_the_user_must_fix(
    db: sqlite3.Connection, code: str
) -> None:
    rig = Rig(db, KR_SLOT)
    SettingsRepo(db).update({"briefing.us.enabled": False})
    await saved_without_text(rig, VaterError(code, "모델", status=409))
    calls = len(rig.interpreted)
    rig.clock.at = KR_SLOT + RETRY_EVERY * 2
    await rig.service.tick_once()
    await settle(rig)
    assert len(rig.interpreted) == calls


async def test_a_reinterpret_that_loses_the_lock_tells_the_screen(db: sqlite3.Connection) -> None:
    """202를 받은 뒤 일정 생성이 잠금을 먼저 잡으면 화면이 SSE로 실패 이유를 안다."""
    rig = Rig(db, KR_SLOT)
    bid = await saved_without_text(rig)
    sub = rig.bus.subscribe()
    rig.service.start_reinterpret(bid)  # 작업은 아직 시작 전이다
    await rig.service._lock.acquire()  # 일정 생성이 먼저 잡았다
    try:
        for _ in range(20):
            await asyncio.sleep(0)
    finally:
        rig.service._lock.release()
    events = [e.data for e in await drain(sub)]
    assert events == [
        {
            "market": "KR",
            "date": "2026-11-03",
            "status": "failed",
            "error": {"code": "BRIEFING_BUSY", "message": "브리핑을 만드는 중입니다."},
        }
    ]
    assert BriefingRepo(db).get(bid).text is None
