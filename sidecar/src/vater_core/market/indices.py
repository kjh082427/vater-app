"""지수 보드: 대시보드의 지수 칸과 숫자 카드용 (대시보드 설계 4장).

국내(코스피·코스닥)와 미국(S&P 500·나스닥 종합)의 현재값과 최근 30거래일 종가를 준다.
- 30초 캐시, 동시에 온 요청은 한 번의 조회를 함께 기다린다.
- 지수 하나가 실패하면 그 지수만 값이 null이다(전체 실패가 아님).
- 오늘의 미확정 봉(장중)은 종가 목록에 넣지 않는다. 오늘 값은 `value`다.
- 한투 함수는 이미 `Priority.BRIEFING`으로 부른다(알림 감시보다 뒤).
"""

import asyncio
import functools
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Literal, Protocol

from vater_core.alerts.clock import KST, NY
from vater_core.kis.market import DomesticMarket, IndexQuote, OverseasIndex, OverseasIndexCode
from vater_core.kis.models import Bar

log = logging.getLogger(__name__)

CACHE_SECONDS = 30.0
CLOSES = 30
LOOKBACK = timedelta(days=60)


@dataclass(frozen=True)
class IndexSpec:
    code: str
    name: str
    market: Literal["KR", "US"]


INDICES: tuple[IndexSpec, ...] = (
    IndexSpec("KOSPI", "코스피", "KR"),
    IndexSpec("KOSDAQ", "코스닥", "KR"),
    IndexSpec("SPX", "S&P 500", "US"),
    IndexSpec("COMP", "나스닥", "US"),
)


@dataclass(frozen=True)
class IndexRow:
    code: str
    name: str
    market: Literal["KR", "US"]
    value: float | None
    change: float | None
    change_pct: float | None
    at: datetime | None
    closes: list[float] = field(default_factory=list)


class IndexFetcher(Protocol):
    async def kr_quote(self, m: DomesticMarket) -> IndexQuote: ...
    async def kr_daily(self, m: DomesticMarket, start: date, end: date) -> list[Bar]: ...
    async def us_index(self, code: OverseasIndexCode, start: date, end: date) -> OverseasIndex: ...


def _empty(spec: IndexSpec) -> IndexRow:
    return IndexRow(spec.code, spec.name, spec.market, None, None, None, None, [])


def _closes(bars: list[Bar], today: date) -> list[float]:
    done = [b.close for b in sorted(bars, key=lambda b: b.day) if b.day < today]
    return done[-CLOSES:]


class IndexBoard:
    def __init__(
        self,
        now: Callable[[], float] = time.monotonic,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._now = now
        self._clock = clock
        self._cached: tuple[str, float, list[IndexRow]] | None = None
        self._inflight: tuple[str, asyncio.Task[list[IndexRow]]] | None = None

    async def rows(self, fetch: IndexFetcher | None, key: str | None) -> list[IndexRow]:
        """`key`는 한투 설정의 지문(키·서버가 바뀌면 캐시를 버린다). 한투가 없으면 모두 null."""
        if fetch is None or key is None:
            return [_empty(s) for s in INDICES]
        if (
            self._cached
            and self._cached[0] == key
            and self._now() - self._cached[1] < CACHE_SECONDS
        ):
            return self._cached[2]
        if self._inflight is None or self._inflight[0] != key:
            task = asyncio.create_task(self._load(fetch))
            self._inflight = (key, task)
            task.add_done_callback(functools.partial(self._finish, key))
        # 기다리는 쪽이 취소돼도 조회는 끝까지 돌고, 끝나면 _finish가 캐시를 채우고 비운다.
        return await asyncio.shield(self._inflight[1])

    def _finish(self, key: str, task: "asyncio.Task[list[IndexRow]]") -> None:
        if self._inflight and self._inflight[1] is task:
            self._inflight = None
        if not task.cancelled() and task.exception() is None:
            self._cached = (key, self._now(), task.result())

    async def _load(self, fetch: IndexFetcher) -> list[IndexRow]:
        at = self._clock()
        return list(await asyncio.gather(*(self._one(fetch, s, at) for s in INDICES)))

    async def _one(self, fetch: IndexFetcher, spec: IndexSpec, at: datetime) -> IndexRow:
        try:
            if spec.market == "KR":
                m: DomesticMarket = "KOSPI" if spec.code == "KOSPI" else "KOSDAQ"
                today = at.astimezone(KST).date()
                quote, bars = await asyncio.gather(
                    fetch.kr_quote(m), fetch.kr_daily(m, today - LOOKBACK, today)
                )
            else:
                code: OverseasIndexCode = "SPX" if spec.code == "SPX" else "COMP"
                today = at.astimezone(NY).date()
                idx = await fetch.us_index(code, today - LOOKBACK, today)
                quote, bars = idx.quote, idx.bars
            return IndexRow(
                spec.code,
                spec.name,
                spec.market,
                quote.value,
                quote.change,
                quote.change_pct,
                at,
                _closes(bars, today),
            )
        except Exception as e:  # 지수 하나의 실패는 그 지수만 null로 (한투 오류·빈 응답)
            log.warning("지수 %s 조회 실패: %s", spec.code, type(e).__name__)
            return _empty(spec)
