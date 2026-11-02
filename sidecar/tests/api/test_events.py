import asyncio
import json
import threading
from typing import Any

import httpx

from vater_core.api.events import EventBus


async def test_bus_delivers_in_order() -> None:
    bus = EventBus()
    sub = bus.subscribe()
    bus.publish("a", {"n": 1})
    bus.publish("b", {"n": 2})
    got = [await anext(sub), await anext(sub)]
    assert [e.type for e in got] == ["a", "b"] and got[0].id < got[1].id


async def test_slow_subscriber_drops_oldest() -> None:
    bus = EventBus()
    sub = bus.subscribe()
    for i in range(1005):
        bus.publish("t", {"i": i})
    first = await anext(sub)
    assert first.data["i"] == 5


async def test_publish_from_another_thread() -> None:
    bus = EventBus()
    sub = bus.subscribe()
    t = threading.Thread(target=bus.publish, args=("analysis.progress", {"node": "trader"}))
    t.start()
    t.join()
    ev = await asyncio.wait_for(anext(sub), timeout=2)
    assert ev.type == "analysis.progress" and ev.data == {"node": "trader"}


async def test_closed_subscription_stops_receiving() -> None:
    bus = EventBus()
    sub = bus.subscribe()
    sub.close()
    bus.publish("x", {})
    assert bus.subscriber_count == 0


async def test_events_stream_delivers_published_event(live_server: tuple[str, Any]) -> None:
    url, deps = live_server
    async with (
        httpx.AsyncClient(timeout=5) as c,
        c.stream("GET", f"{url}/events?token=test-token") as r,
    ):
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        deps.events.publish("alert", {"code": "005930"})
        lines = []
        async for line in r.aiter_lines():
            lines.append(line)
            if line.startswith("data:"):
                break
    assert "event: alert" in lines and json.loads(lines[-1][5:]) == {"code": "005930"}


async def test_events_endpoint_rejects_bad_query_token(live_server: tuple[str, Any]) -> None:
    url, _ = live_server
    async with httpx.AsyncClient(timeout=5) as c:
        assert (await c.get(f"{url}/events?token=bad")).status_code == 401


async def test_other_routes_do_not_accept_query_token(live_server: tuple[str, Any]) -> None:
    url, _ = live_server
    async with httpx.AsyncClient(timeout=5) as c:
        assert (await c.get(f"{url}/health?token=test-token")).status_code == 401
