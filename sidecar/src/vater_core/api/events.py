"""사이드카 내부 이벤트 버스. SSE(`GET /events`)로 UI에 전달된다 (스펙 2-2).

- 분석 엔진처럼 **다른 스레드**에서도 `publish`할 수 있다.
- 구독자마다 큐를 따로 두고, 가득 차면 가장 오래된 이벤트를 버린다(느린 구독자가 버스를 막지 않음).
"""

import asyncio
import threading
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

QUEUE_SIZE = 1000


@dataclass(frozen=True)
class Event:
    type: str
    data: dict[str, Any]
    id: int


class Subscription(AsyncIterator[Event]):
    def __init__(self, bus: "EventBus", loop: asyncio.AbstractEventLoop) -> None:
        self._bus = bus
        self.loop = loop
        self.queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=QUEUE_SIZE)

    def offer(self, event: Event) -> None:
        """구독자의 이벤트 루프 안에서만 호출된다."""
        if self.queue.full():
            self.queue.get_nowait()
        self.queue.put_nowait(event)

    async def __anext__(self) -> Event:
        return await self.queue.get()

    def close(self) -> None:
        self._bus.unsubscribe(self)


class EventBus:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subs: list[Subscription] = []
        self._next_id = 0

    @property
    def subscriber_count(self) -> int:
        with self._lock:
            return len(self._subs)

    def subscribe(self) -> Subscription:
        """호출하는 순간 등록된다. 이후 발행되는 이벤트는 빠짐없이 받는다."""
        sub = Subscription(self, asyncio.get_running_loop())
        with self._lock:
            self._subs.append(sub)
        return sub

    def unsubscribe(self, sub: Subscription) -> None:
        with self._lock:
            if sub in self._subs:
                self._subs.remove(sub)

    def publish(self, type: str, data: dict[str, Any]) -> Event:
        with self._lock:
            self._next_id += 1
            event = Event(type=type, data=data, id=self._next_id)
            subs = list(self._subs)
        for sub in subs:
            if _running_loop() is sub.loop:
                sub.offer(event)
            elif not sub.loop.is_closed():
                sub.loop.call_soon_threadsafe(sub.offer, event)
        return event


def _running_loop() -> asyncio.AbstractEventLoop | None:
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return None
