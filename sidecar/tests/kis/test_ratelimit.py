import asyncio
import time

from vater_core.kis.ratelimit import PriorityRateLimiter


async def test_higher_priority_goes_first_under_contention() -> None:
    lim = PriorityRateLimiter(20)
    order: list[str] = []

    async def take(priority: int, tag: str) -> None:
        await lim.acquire(priority)
        order.append(tag)

    await lim.acquire(1)  # 즉시 통과하는 첫 칸을 써 버린다
    tasks = [asyncio.create_task(take(2, f"low{i}")) for i in range(3)]
    await asyncio.sleep(0)
    tasks.append(asyncio.create_task(take(0, "high")))
    await asyncio.gather(*tasks)
    assert order[0] == "high" and order[1:] == ["low0", "low1", "low2"]


async def test_rate_is_respected() -> None:
    lim = PriorityRateLimiter(50)  # 간격 0.02초
    t0 = time.monotonic()
    for _ in range(10):
        await lim.acquire(0)
    assert time.monotonic() - t0 >= 0.17


async def test_cancelled_waiter_does_not_block_others() -> None:
    lim = PriorityRateLimiter(20)
    await lim.acquire(0)
    doomed = asyncio.create_task(lim.acquire(0))
    await asyncio.sleep(0)
    doomed.cancel()
    await asyncio.wait_for(lim.acquire(0), timeout=1)
