"""3단계 확인 C: 알림 끝까지.

실제 API(FastAPI) + 실제 감시 루프(AlertMonitor) + 실제 한투 WebSocket 클라이언트(KisRealtime)를
로컬 가짜 한투 서버에 소켓으로 연결한다. 시계는 실제 시간으로 흐르되 국내 장중(화 10:00 KST)에서
시작한다. 스펙 성공 기준 2: 조건 충족 → 알림까지 실시간 5초, 폴링 60초 이내.
"""

import asyncio
import contextlib
import json
import sqlite3
import time
from collections.abc import AsyncIterator, Callable
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest
from websockets.asyncio.server import Server, ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from vater_core.alerts.clock import MarketClock
from vater_core.alerts.monitor import AlertMonitor
from vater_core.alerts.store import WatchItem
from vater_core.api.app import create_app
from vater_core.api.deps import AppDeps
from vater_core.api.errors import VaterError
from vater_core.api.events import Event, EventBus
from vater_core.kis.config import KisServer
from vater_core.kis.models import Quote
from vater_core.kis.ws import KisRealtime, Tick
from vater_core.store.db import open_db
from vater_core.store.settings import SettingsRepo

TOKEN = "acc"
START = datetime(2026, 11, 3, 1, 0, tzinfo=UTC)  # 화 10:00 KST (국내 장중)


class FakeKis:
    """한투 실시간 서버 흉내: 구독 요청을 기록하고, 테스트가 체결 메시지를 보낸다."""

    def __init__(self) -> None:
        self.subscribed: list[str] = []
        self.connections = 0
        self.current: ServerConnection | None = None

    async def handler(self, ws: ServerConnection) -> None:
        self.connections += 1
        self.current = ws
        with contextlib.suppress(ConnectionClosed):  # 테스트가 끝나며 클라이언트가 끊는다
            async for msg in ws:
                body = json.loads(msg)["body"]["input"]
                self.subscribed.append(body["tr_key"])

    async def tick(self, code: str, price: int, pct: float = 0.0, vol: int = 1000) -> None:
        rec = [code, "100001", str(price), "2", "0", f"{pct:.2f}"] + ["0"] * 7 + [str(vol)]
        rec += ["0"] * (46 - len(rec))
        assert self.current is not None
        await self.current.send("0|H0STCNT0|001|" + "^".join(rec))


class Approval:
    async def approval_key(self) -> str:
        return "appr"


class World:
    """실제 시간으로 흐르는 시계(화 10:00 KST에서 시작), 가짜 한투 현재가, 알림 기록."""

    def __init__(self, db: sqlite3.Connection, url: str) -> None:
        self.offset = START - datetime.now(UTC)
        self.prices: dict[str, float] = {}
        self.price_error: Exception | None = None
        self.notes: list[tuple[float, str, str, str | None]] = []
        self.bus = EventBus()
        self.deps = AppDeps(token=TOKEN, dev=False, data_dir=Path("."), db=db, events=self.bus)
        self.realtime: KisRealtime | None = None

        async def weekdays(day: date) -> bool:
            return day.weekday() < 5

        async def price(item: WatchItem) -> Quote:
            if self.price_error is not None:
                raise self.price_error
            return Quote("KR", item.code, self.prices.get(item.code, 50000.0), 0.0, 0.0, 1000)

        async def bars(item: WatchItem, through: date) -> int:
            return 0  # 가격 규칙만 쓰므로 일봉은 필요 없다

        def realtime(
            on_tick: Callable[[Tick], None], on_state: Callable[[str], None], limit: int
        ) -> KisRealtime:
            self.realtime = KisRealtime(
                Approval(), KisServer.PROD, on_tick, on_state, limit, url=url, backoff=(0.5,)
            )
            return self.realtime

        def note(title: str, body: str, route: str | None = None) -> None:
            self.notes.append((time.monotonic(), title, body, route))

        self.monitor = AlertMonitor(
            self.deps,
            clock=MarketClock(weekdays, now=self.now),
            realtime_factory=realtime,
            price_fn=price,
            bars_fn=bars,
            notify_fn=note,
            now=self.now,
        )
        self.deps.alerts = self.monitor
        self.api = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=create_app(self.deps)),
            base_url="http://sidecar",
            headers={"Authorization": f"Bearer {TOKEN}"},
        )

    def now(self) -> datetime:
        return datetime.now(UTC) + self.offset

    async def watch(self, code: str, price: float) -> int:
        wid: int = (await self.api.post("/watchlist", json={"market": "KR", "code": code})).json()[
            "id"
        ]
        r = await self.api.post(
            "/alerts/rules",
            json={"watchlist_id": wid, "kind": "price_above", "params": {"price": price}},
        )
        assert r.status_code == 201
        return wid


def counts(status: dict[str, Any]) -> dict[str, Any]:
    """상태 중 감시 루프 개수 부분(markets·feeds는 따로 있다)."""
    return {k: status[k] for k in ("state", "realtime", "polling")}


async def until(cond: Callable[[], bool], timeout: float, what: str) -> float:
    start = time.monotonic()
    while not cond():
        if time.monotonic() - start > timeout:
            raise AssertionError(f"timed out waiting for {what}")
        await asyncio.sleep(0.05)
    return time.monotonic() - start


@pytest.fixture
async def world(tmp_path: Path) -> AsyncIterator[tuple[World, FakeKis]]:
    db = open_db(tmp_path)
    db.executemany(
        "INSERT INTO symbols (market, code, exchange, name, name_en, kind) VALUES (?,?,?,?,?,?)",
        [
            ("KR", "005930", "KOSPI", "삼성전자", None, "stock"),
            ("KR", "000660", "KOSPI", "SK하이닉스", None, "stock"),
        ],
    )
    db.commit()
    SettingsRepo(db).update({"alerts.poll_interval_sec": 10})
    fake = FakeKis()
    server: Server
    async with serve(fake.handler, "127.0.0.1", 0) as server:
        port = next(iter(server.sockets)).getsockname()[1]
        w = World(db, f"ws://127.0.0.1:{port}")
        try:
            yield w, fake
        finally:
            await w.monitor.stop()
            await w.api.aclose()


async def drain(sub: Any) -> list[Event]:
    out = []
    while not sub.queue.empty():
        out.append(sub.queue.get_nowait())
    return out


async def test_c1_c5_realtime_tick_alerts_within_5_seconds(world: tuple[World, FakeKis]) -> None:
    w, fake = world
    await w.watch("005930", 60000)  # 아직 아래 → 넘으면 울려야 한다
    await w.watch("000660", 1)  # (다른 종목) 처음부터 참 → 울리면 안 된다 (C5)
    w.prices["000660"] = 200000.0
    sub = w.bus.subscribe()
    w.monitor.start()
    await until(lambda: {"005930", "000660"} <= set(fake.subscribed), 10, "subscriptions")
    await until(lambda: w.realtime is not None and w.realtime.state == "connected", 10, "ws")

    await fake.tick("005930", 59000)  # 첫 평가: 기준값(거짓)
    await fake.tick("000660", 200000)  # 첫 평가: 기준값(참) → 알림 없음
    await asyncio.sleep(1.2)  # 틱 1초 제한이 지나게

    sent_at = time.monotonic()
    await fake.tick("005930", 61000)
    await until(lambda: len(w.notes) >= 1, 5, "realtime alert")
    latency = w.notes[0][0] - sent_at
    print(f"\nC1 realtime alert latency: {latency * 1000:.0f} ms")
    assert latency < 5.0
    assert w.notes[0][1:] == (
        "알림: 삼성전자",
        "현재가 61,000 — 목표가 60,000 이상",
        "/symbols/KR/005930",
    )

    events = (await w.api.get("/alerts/events")).json()
    assert [e["message"] for e in events] == ["삼성전자 현재가 61,000 — 목표가 60,000 이상"]
    fired = [e for e in await drain(sub) if e.type == "alert.fired"]
    assert len(fired) == 1 and fired[0].data["code"] == "005930"
    await w.monitor.tick_once()  # 상태는 회차마다 갱신된다(첫 회차는 연결 전이라 폴링)
    status = (await w.api.get("/alerts/status")).json()
    assert counts(status) == {"state": "running", "realtime": 2, "polling": 0}
    await asyncio.sleep(1.2)
    assert len(w.notes) == 1  # C5: 처음부터 참이던 규칙은 울리지 않았다


async def test_c2_polled_symbol_alerts_within_60_seconds(world: tuple[World, FakeKis]) -> None:
    w, _ = world
    assert w.deps.db is not None
    SettingsRepo(w.deps.db).update({"kis.ws_max_subscriptions": 1})
    await w.watch("005930", 60000)  # 실시간 (한도 1)
    await w.watch("000660", 100000)  # 한도를 넘어 폴링
    w.prices["000660"] = 90000.0
    w.monitor.start()
    await until(lambda: w.monitor.status()["polling"] >= 1, 10, "first poll")  # 기준값(거짓)

    changed_at = time.monotonic()
    w.prices["000660"] = 110000.0  # 이 순간 조건 충족
    await until(lambda: len(w.notes) >= 1, 60, "polling alert")
    latency = w.notes[0][0] - changed_at
    print(f"\nC2 polling alert latency: {latency:.1f} s (poll interval 10 s)")
    assert latency < 60.0
    assert w.notes[0][1] == "알림: SK하이닉스"


async def test_c3_websocket_drop_falls_back_to_polling_and_recovers(
    world: tuple[World, FakeKis],
) -> None:
    w, fake = world
    await w.watch("005930", 60000)
    await w.watch("000660", 100000)
    await w.monitor.tick_once()
    await until(lambda: w.realtime is not None and w.realtime.state == "connected", 10, "ws")
    await w.monitor.tick_once()
    assert counts(w.monitor.status()) == {"state": "running", "realtime": 2, "polling": 0}

    assert fake.current is not None and w.realtime is not None
    await fake.current.close()  # 한투가 연결을 끊는다
    await until(lambda: w.realtime is not None and w.realtime.state != "connected", 5, "drop")
    await w.monitor.tick_once()
    assert counts(w.monitor.status()) == {"state": "running", "realtime": 0, "polling": 2}

    await until(lambda: fake.connections >= 2 and w.realtime is not None
                and w.realtime.state == "connected", 10, "reconnect")  # fmt: skip
    await until(lambda: fake.subscribed.count("005930") >= 2, 5, "resubscribe")
    await w.monitor.tick_once()
    assert counts(w.monitor.status()) == {"state": "running", "realtime": 2, "polling": 0}


async def test_c4_offline_is_reported_and_watch_resumes(world: tuple[World, FakeKis]) -> None:
    w, _ = world
    assert w.deps.db is not None
    SettingsRepo(w.deps.db).update({"kis.ws_max_subscriptions": 1})
    await w.watch("005930", 60000)
    await w.watch("000660", 100000)
    sub = w.bus.subscribe()

    w.price_error = VaterError(
        "KIS_UNREACHABLE", "한국투자증권 서버에 연결할 수 없습니다.", status=503
    )
    await w.monitor.tick_once()
    assert (await w.api.get("/alerts/status")).json()["state"] == "offline"
    states = [e.data["state"] for e in await drain(sub) if e.type == "alerts.state"]
    assert states[-1] == "offline"

    w.price_error = None
    await w.monitor.tick_once()
    assert (await w.api.get("/alerts/status")).json()["state"] == "running"
    states = [e.data["state"] for e in await drain(sub) if e.type == "alerts.state"]
    assert states[-1] == "running"
