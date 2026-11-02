"""우선순위가 있는 초당 호출 제한 (스펙 7-2).

기다리는 요청이 여럿이면 priority가 작은 것(알림 감시)부터, 같으면 먼저 온 순서로 통과시킨다.
통과 간격은 항상 `1/rate` 이상이다.
"""

import asyncio
import heapq
import itertools
import time


class PriorityRateLimiter:
    def __init__(self, rate_per_sec: float) -> None:
        if rate_per_sec <= 0:
            raise ValueError("rate_per_sec must be positive")
        self.interval = 1.0 / rate_per_sec
        self._next_slot = 0.0
        self._waiters: list[tuple[int, int, asyncio.Future[None]]] = []
        self._seq = itertools.count()
        self._dispatcher: asyncio.Task[None] | None = None

    async def acquire(self, priority: int) -> None:
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[None] = loop.create_future()
        heapq.heappush(self._waiters, (priority, next(self._seq), fut))
        if self._dispatcher is None or self._dispatcher.done():
            self._dispatcher = loop.create_task(self._dispatch())
        await fut

    async def _dispatch(self) -> None:
        while self._waiters:
            now = time.monotonic()
            if now < self._next_slot:
                await asyncio.sleep(self._next_slot - now)
                continue  # 기다리는 동안 더 급한 요청이 들어왔을 수 있다
            _, _, fut = heapq.heappop(self._waiters)
            if fut.cancelled():
                continue  # 취소된 요청은 칸을 쓰지 않는다
            fut.set_result(None)
            self._next_slot = max(now, self._next_slot) + self.interval
