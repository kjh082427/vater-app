import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import pytest
from websockets.asyncio.server import Server, ServerConnection, serve

from vater_core.kis.config import KisServer
from vater_core.kis.ws import KisRealtime, Tick

PING = '{"header":{"tr_id":"PINGPONG","datetime":"20261103030000"}}'


def domestic_record(code: str, price: str, pct: str, vol: str) -> list[str]:
    rec = [code, "093001", price, "2", "500", pct] + ["0"] * 7 + [vol]
    return rec + ["0"] * (46 - len(rec))


def us_record(symb: str, price: str, pct: str, vol: str) -> list[str]:
    rec = [
        symb,
        "4",
        "20261102",
        "20261102",
        "143001",
        "20261103",
        "043001",
        "0",
        "0",
        "0",
        price,
        "5",
        "1",
        pct,
        "0",
        "0",
        "0",
        "0",
        "0",
        vol,
    ]
    return rec + ["0"] * (25 - len(rec))


class FakeKis:
    """한투 WebSocket 흉내: 받은 메시지를 기록하고, 테스트가 보낼 메시지를 넣는다."""

    def __init__(self) -> None:
        self.received: asyncio.Queue[str] = asyncio.Queue()
        self.connections = 0
        self.current: ServerConnection | None = None
        self.drop_first = False

    async def handler(self, ws: ServerConnection) -> None:
        self.connections += 1
        self.current = ws
        if self.drop_first and self.connections == 1:
            await ws.recv()  # 첫 구독 하나를 받고 바로 끊는다
            await ws.close()
            return
        async for msg in ws:
            await self.received.put(str(msg))


class FakeApproval:
    async def approval_key(self) -> str:
        return "appr-key"


@pytest.fixture
async def fake() -> AsyncIterator[tuple[FakeKis, str]]:
    f = FakeKis()
    server: Server
    async with serve(f.handler, "127.0.0.1", 0) as server:
        port = next(iter(server.sockets)).getsockname()[1]
        yield f, f"ws://127.0.0.1:{port}"


def realtime(url: str, ticks: list[Tick], states: list[str], limit: int = 41) -> KisRealtime:
    return KisRealtime(
        FakeApproval(),
        KisServer.PROD,
        on_tick=ticks.append,
        on_state=states.append,
        max_subscriptions=limit,
        url=url,
        backoff=(0, 0, 0),
    )


async def next_json(f: FakeKis) -> dict[str, Any]:
    msg: dict[str, Any] = json.loads(await asyncio.wait_for(f.received.get(), timeout=3))
    return msg


async def wait_for(pred: Any, timeout: float = 3) -> None:
    async with asyncio.timeout(timeout):
        while not pred():
            await asyncio.sleep(0.01)


async def test_subscribe_message_format(fake: tuple[FakeKis, str]) -> None:
    f, url = fake
    rt = realtime(url, [], [])
    assert await rt.subscribe("KR", "005930")
    assert await rt.subscribe("US", "AAPL", "NAS")
    task = asyncio.create_task(rt.run())
    try:
        first, second = await next_json(f), await next_json(f)
        assert first["header"] == {
            "approval_key": "appr-key",
            "custtype": "P",
            "tr_type": "1",
            "content-type": "utf-8",
        }
        assert first["body"]["input"] == {"tr_id": "H0STCNT0", "tr_key": "005930"}
        assert second["body"]["input"] == {"tr_id": "HDFSCNT0", "tr_key": "DNASAAPL"}
    finally:
        task.cancel()


async def test_pingpong_is_echoed(fake: tuple[FakeKis, str]) -> None:
    f, url = fake
    rt = realtime(url, [], [])
    task = asyncio.create_task(rt.run())
    try:
        await wait_for(lambda: f.current is not None and rt.state == "connected")
        assert f.current is not None
        await f.current.send(PING)
        assert await asyncio.wait_for(f.received.get(), timeout=3) == PING
    finally:
        task.cancel()


async def test_multi_record_message_yields_ticks(fake: tuple[FakeKis, str]) -> None:
    f, url = fake
    ticks: list[Tick] = []
    rt = realtime(url, ticks, [])
    await rt.subscribe("KR", "005930")
    await rt.subscribe("US", "AAPL", "NAS")
    task = asyncio.create_task(rt.run())
    try:
        await next_json(f)
        await next_json(f)
        assert f.current is not None
        kr = domestic_record("005930", "71200", "0.71", "1234567") + domestic_record(
            "005930", "71300", "0.85", "1234600"
        )
        await f.current.send("0|H0STCNT0|002|" + "^".join(kr))
        await f.current.send(
            "0|HDFSCNT0|001|" + "^".join(us_record("DNASAAPL", "338.10", "-1.90", "999"))
        )
        await wait_for(lambda: len(ticks) == 3)
        assert ticks[0] == Tick("KR", "005930", 71200.0, 0.71, 1234567, "093001")
        assert ticks[1].price == 71300.0
        assert ticks[2] == Tick("US", "AAPL", 338.10, -1.90, 999, "043001")
    finally:
        task.cancel()


async def test_reconnect_restores_all_subscriptions(fake: tuple[FakeKis, str]) -> None:
    f, url = fake
    f.drop_first = True
    states: list[str] = []
    rt = realtime(url, [], states)
    await rt.subscribe("KR", "005930")
    await rt.subscribe("KR", "000660")
    task = asyncio.create_task(rt.run())
    try:
        keys = {(await next_json(f))["body"]["input"]["tr_key"] for _ in range(2)}
        assert keys == {"005930", "000660"} and f.connections == 2
        assert "reconnecting" in states and states[-1] == "connected"
    finally:
        task.cancel()


async def test_subscription_limit(fake: tuple[FakeKis, str]) -> None:
    _, url = fake
    rt = realtime(url, [], [], limit=1)
    assert await rt.subscribe("KR", "005930") is True
    assert await rt.subscribe("KR", "005930") is True  # 이미 있는 구독은 한도를 쓰지 않는다
    assert await rt.subscribe("KR", "000660") is False  # 넘친 종목은 호출자가 폴링으로


async def test_unsubscribe_sends_tr_type_2(fake: tuple[FakeKis, str]) -> None:
    f, url = fake
    rt = realtime(url, [], [])
    await rt.subscribe("KR", "005930")
    task = asyncio.create_task(rt.run())
    try:
        await next_json(f)
        await rt.unsubscribe("KR", "005930")
        msg = await next_json(f)
        assert msg["header"]["tr_type"] == "2" and msg["body"]["input"]["tr_key"] == "005930"
    finally:
        task.cancel()
