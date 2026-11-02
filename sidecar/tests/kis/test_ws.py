import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import pytest
from websockets.asyncio.server import Server, ServerConnection, serve

from vater_core.api.errors import VaterError
from vater_core.kis.config import KisServer
from vater_core.kis.ws import KisRealtime, Tick

PING = '{"header":{"tr_id":"PINGPONG","datetime":"20261103030000"}}'


def domestic_record(code: str, price: str, pct: str, vol: str) -> list[str]:
    rec = [code, "093001", price, "2", "500", pct] + ["0"] * 7 + [vol]
    return rec + ["0"] * (46 - len(rec))


def us_record(symb: str, price: str, pct: str, vol: str) -> list[str]:
    """실제 HDFSCNT0 원문(2026-11-03)과 같은 26개 필드.

    0 RSYM, 1 SYMB, 7 KHMS(한국시각), 11 LAST, 14 RATE, 20 TVOL.
    """
    rec = [
        f"DNAS{symb}",
        symb,
        "4",
        "20261102",
        "20261102",
        "124637",
        "20261103",
        "024637",
        "342.6700",
        "343.7800",
        "336.5206",
        price,
        "5",
        "7.2300",
        pct,
        "337.3800",
        "337.4200",
        "20",
        "47",
        "213",
        vol,
        "5070372153",
        "3704445",
        "2135979",
        "57.66",
        "2",
    ]
    return rec


class FakeKis:
    """한투 WebSocket 흉내: 받은 메시지를 기록하고, 테스트가 보낼 메시지를 넣는다."""

    def __init__(self) -> None:
        self.received: asyncio.Queue[str] = asyncio.Queue()
        self.connections = 0
        self.current: ServerConnection | None = None
        self.drop_first = False
        self.close_on_connect = False

    async def handler(self, ws: ServerConnection) -> None:
        self.connections += 1
        self.current = ws
        if self.close_on_connect:  # 접속은 받고 아무것도 보내지 않은 채 바로 끊는다
            await ws.close()
            return
        if self.drop_first and self.connections == 1:
            await ws.recv()  # 첫 구독 하나를 받고 바로 끊는다
            await ws.close()
            return
        async for msg in ws:
            await self.received.put(str(msg))


class FakeApproval:
    def __init__(self, fail_first: int = 0) -> None:
        self.fail_first = fail_first

    async def approval_key(self) -> str:
        if self.fail_first > 0:
            self.fail_first -= 1
            raise VaterError("KIS_UNREACHABLE", "승인키 발급 실패", status=503)
        return "appr-key"


@pytest.fixture
async def fake() -> AsyncIterator[tuple[FakeKis, str]]:
    f = FakeKis()
    server: Server
    async with serve(f.handler, "127.0.0.1", 0) as server:
        port = next(iter(server.sockets)).getsockname()[1]
        yield f, f"ws://127.0.0.1:{port}"


def realtime(
    url: str,
    ticks: list[Tick],
    states: list[str],
    limit: int = 41,
    approval: FakeApproval | None = None,
    backoff: tuple[float, ...] = (0, 0, 0),
    idle_timeout: float = 30,
    on_tick: Any = None,
) -> KisRealtime:
    return KisRealtime(
        approval or FakeApproval(),
        KisServer.PROD,
        on_tick=on_tick or ticks.append,
        on_state=states.append,
        max_subscriptions=limit,
        url=url,
        backoff=backoff,
        idle_timeout=idle_timeout,
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
            "0|HDFSCNT0|001|" + "^".join(us_record("AAPL", "337.4000", "-2.10", "14893876"))
        )
        await wait_for(lambda: len(ticks) == 3)
        assert ticks[0] == Tick("KR", "005930", 71200.0, 0.71, 1234567, "093001")
        assert ticks[1].price == 71300.0
        assert ticks[2] == Tick("US", "AAPL", 337.40, -2.10, 14893876, "024637")
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


# ── 리뷰 Critical #2, Important #3~#5 ──
# 하루 종일 도는 트레이 앱에서 수신 루프가 죽거나 재접속이 폭주하면 안 된다.


async def test_malformed_frame_does_not_kill_loop(fake: tuple[FakeKis, str]) -> None:
    f, url = fake
    ticks: list[Tick] = []
    rt = realtime(url, ticks, [])
    await rt.subscribe("KR", "005930")
    task = asyncio.create_task(rt.run())
    try:
        await next_json(f)
        assert f.current is not None
        await f.current.send("0|H0STCNT0|xx|garbage")
        await f.current.send("0|H0STCNT0|001|" + "^".join(domestic_record("005930", "1", "0", "1")))
        await wait_for(lambda: len(ticks) == 1)
        assert rt.state == "connected" and not task.done()
    finally:
        task.cancel()


async def test_failing_callback_does_not_kill_loop(fake: tuple[FakeKis, str]) -> None:
    f, url = fake
    seen: list[Tick] = []

    def flaky(t: Tick) -> None:
        seen.append(t)
        if len(seen) == 1:
            raise RuntimeError("consumer bug")

    rt = realtime(url, [], [], on_tick=flaky)
    await rt.subscribe("KR", "005930")
    task = asyncio.create_task(rt.run())
    try:
        await next_json(f)
        assert f.current is not None
        for price in ("1", "2"):
            await f.current.send(
                "0|H0STCNT0|001|" + "^".join(domestic_record("005930", price, "0", "1"))
            )
        await wait_for(lambda: len(seen) == 2)
        assert not task.done()
    finally:
        task.cancel()


async def test_approval_failure_is_retried(fake: tuple[FakeKis, str]) -> None:
    f, url = fake
    rt = realtime(url, [], [], approval=FakeApproval(fail_first=2))
    await rt.subscribe("KR", "005930")
    task = asyncio.create_task(rt.run())
    try:
        msg = await next_json(f)  # 두 번 실패한 뒤 결국 구독이 간다
        assert msg["body"]["input"]["tr_key"] == "005930" and not task.done()
    finally:
        task.cancel()


async def test_backoff_grows_when_server_closes_immediately(fake: tuple[FakeKis, str]) -> None:
    f, url = fake
    f.close_on_connect = True
    rt = realtime(url, [], [], backoff=(0.05, 0.3, 1.0))
    task = asyncio.create_task(rt.run())
    try:
        await asyncio.sleep(0.6)
        assert 2 <= f.connections <= 3  # 0.05 → 0.3 → 1.0초로 늘어난다 (폭주 금지)
    finally:
        task.cancel()


async def test_silent_connection_is_recycled(fake: tuple[FakeKis, str]) -> None:
    f, url = fake
    states: list[str] = []
    rt = realtime(url, [], states, idle_timeout=0.2)
    task = asyncio.create_task(rt.run())
    try:
        await wait_for(
            lambda: f.connections >= 2
        )  # 아무 메시지도 없으면 반쯤 끊긴 연결로 보고 다시 접속
        assert "reconnecting" in states
    finally:
        task.cancel()


async def test_subscription_rejection_is_logged(
    fake: tuple[FakeKis, str], caplog: pytest.LogCaptureFixture
) -> None:
    f, url = fake
    rt = realtime(url, [], [])
    await rt.subscribe("KR", "005930")
    task = asyncio.create_task(rt.run())
    try:
        await next_json(f)
        assert f.current is not None
        await f.current.send(
            json.dumps(
                {
                    "header": {"tr_id": "H0STCNT0", "tr_key": "005930", "encrypt": "N"},
                    "body": {
                        "rt_cd": "1",
                        "msg_cd": "OPSP0011",
                        "msg1": "invalid approval : NOT FOUND",
                    },
                }
            )
        )
        await wait_for(lambda: ("H0STCNT0", "005930") in rt.subscription_errors)
        assert "invalid approval" in rt.subscription_errors[("H0STCNT0", "005930")]
        assert any(
            "invalid approval" in r.getMessage() for r in caplog.records if r.levelname == "WARNING"
        )
    finally:
        task.cancel()
