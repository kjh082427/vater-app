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
from vater_core.briefing.service import BriefingService, get_briefing
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
