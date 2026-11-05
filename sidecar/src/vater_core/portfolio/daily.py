"""자산 추이 기록과 브리핑의 내 자산 구역 (v2 설계 12, 15장).

- 한 행은 "그 날 16:00(KST)에 확정돼 있던 종가"로 잰 평가금액이다. 그래서 그날 기록한 행과 나중에
  채운 행이 같은 값을 쓴다. 뉴욕 세션 d는 d+1 아침에 끝나므로 d일 행에는 d-1 세션까지만 들어간다.
- 한국이나 미국 어느 한쪽이라도 열린 날에 행을 만든다. 쉬는 시장은 마지막 세션의 종가를 그대로 둔다.
- 값을 지어내지 않는다. 그 시장의 종가를 하나라도 못 받으면 그 시장 값은 NULL이고 나중에 다시 받는다
  (일부만 더하면 폭락처럼 보인다). 0은 "그 시장에 보유가 없음"이고 실패가 아니다.
- 조회는 됐는데 그날 봉이 없는 종목(거래정지)은 14일 안의 마지막 종가가 실제 가격이다.
- 이 파일의 값은 저장과 표시에만 쓴다. **AI 입력에 넣지 않는다**(v2 설계 8-1장).
"""

import asyncio
import contextlib
import logging
import sqlite3
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any, Literal

from vater_core.alerts.bars import HISTORY_DAYS, refresh_bars
from vater_core.alerts.clock import (
    KST,
    LOOKBACK_DAYS,
    SETTLE,
    MarketClock,
    MarketId,
    session_bounds,
)
from vater_core.alerts.store import BarRepo, WatchItem
from vater_core.analysis.symbols import resolve_target
from vater_core.api.deps import AppDeps
from vater_core.api.errors import VaterError
from vater_core.holdings.service import get_holdings, summarize
from vater_core.kis.quotes import is_domestic_trading_day
from vater_core.kis.services import require_kis
from vater_core.market.fx import FxRepo, fetch_usdkrw_range
from vater_core.store.holdings import HoldingsRepo

logger = logging.getLogger(__name__)

RECORD_AT = time(16, 0)
TICK_SEC = 60.0
RETRY = timedelta(minutes=30)
RETRY_DAYS = 14  # 그보다 오래된 빈 값은 앞으로도 오지 않는 값으로 본다
HALT_DAYS = 14  # 거래정지 종목의 마지막 종가를 쓰는 범위
FX_SPAN = timedelta(days=89)  # 한투 일별 조회는 한 번에 약 100행이다
View = Literal["all", "krw", "usd"]
_CURRENCY: dict[MarketId, str] = {"KR": "KRW", "US": "USD"}

_COLUMNS = "day, kr_value, kr_cost, us_value, us_cost, usdkrw, backfilled"


@dataclass(frozen=True)
class DailyRow:
    day: date
    kr_value: float | None
    kr_cost: float | None
    us_value: float | None
    us_cost: float | None
    usdkrw: float | None
    backfilled: bool


@dataclass(frozen=True)
class Position:
    code: str
    name: str
    quantity: Decimal
    cost: float | None  # 평단가를 모르는 수량이 있으면 None이다


def held(conn: sqlite3.Connection) -> dict[MarketId, list[Position]]:
    """지금 보유 수량. 국내·미국 외 시장은 평가하지 않는다."""
    repo = HoldingsRepo(conn)
    out: dict[MarketId, list[Position]] = {}
    for market, code in sorted({(h.market, h.code) for h in repo.all() if h.market}):
        rows = repo.by_symbol(market, code)
        s = summarize(rows, [], set())
        cost = s["cost"] if s["unpriced_quantity"] == "0" else None
        out.setdefault(market, []).append(Position(code, rows[0].name, Decimal(s["total"]), cost))
    return out


class DailyRepo:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def fill(
        self,
        day: date,
        kr_value: float | None,
        kr_cost: float | None,
        us_value: float | None,
        us_cost: float | None,
        usdkrw: float | None,
        *,
        backfilled: bool,
    ) -> None:
        """없으면 넣고, 있으면 빈 값만 채운다. 이미 기록한 값은 바꾸지 않는다.

        지난 행의 금액을 나중에 채우면 그때 수량을 쓴 것이므로 `backfilled`를 켠다(환율은 무관).
        """
        with self._conn:
            self._conn.execute(
                f"INSERT INTO portfolio_daily ({_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?) "  # noqa: S608
                "ON CONFLICT (day) DO UPDATE SET "
                "kr_value = COALESCE(kr_value, excluded.kr_value), "
                "kr_cost = COALESCE(kr_cost, excluded.kr_cost), "
                "us_value = COALESCE(us_value, excluded.us_value), "
                "us_cost = COALESCE(us_cost, excluded.us_cost), "
                "usdkrw = COALESCE(usdkrw, excluded.usdkrw), "
                "backfilled = CASE WHEN excluded.backfilled = 1 AND ("
                "(kr_value IS NULL AND excluded.kr_value IS NOT NULL) "
                "OR (kr_cost IS NULL AND excluded.kr_cost IS NOT NULL) "
                "OR (us_value IS NULL AND excluded.us_value IS NOT NULL) "
                "OR (us_cost IS NULL AND excluded.us_cost IS NOT NULL)"
                ") THEN 1 ELSE backfilled END",
                (
                    day.isoformat(),
                    kr_value,
                    kr_cost,
                    us_value,
                    us_cost,
                    usdkrw,
                    int(backfilled),
                ),
            )

    def last_day(self, today: date) -> date | None:
        """마지막 기록 날짜. 시계가 틀렸을 때 생긴 미래 행은 없는 것으로 본다."""
        r = self._conn.execute(
            "SELECT max(day) FROM portfolio_daily WHERE day <= ?", (today.isoformat(),)
        ).fetchone()
        return date.fromisoformat(r[0]) if r and r[0] else None

    def has_before(self, day: date) -> bool:
        r = self._conn.execute(
            "SELECT 1 FROM portfolio_daily WHERE day < ? LIMIT 1", (day.isoformat(),)
        ).fetchone()
        return r is not None

    def incomplete(self, since: date, until: date) -> list[date]:
        """다시 받아야 할 값이 남은 날."""
        rows = self._conn.execute(
            "SELECT day FROM portfolio_daily WHERE day >= ? AND day <= ? AND (kr_value IS NULL "
            "OR us_value IS NULL OR (us_value != 0 AND usdkrw IS NULL)) ORDER BY day",
            (since.isoformat(), until.isoformat()),
        )
        return [date.fromisoformat(r[0]) for r in rows]

    def since(self, after: date | None) -> list[DailyRow]:
        """그 날짜 다음 날부터. 오래된 것부터."""
        rows = self._conn.execute(
            f"SELECT {_COLUMNS} FROM portfolio_daily WHERE day > ? ORDER BY day",  # noqa: S608
            (after.isoformat() if after else "",),
        )
        return [
            DailyRow(date.fromisoformat(r[0]), r[1], r[2], r[3], r[4], r[5], bool(r[6]))
            for r in rows
        ]


def _combined(kr: float | None, us: float | None, usdkrw: float | None) -> float | None:
    """원화 + 달러 × 그날 환율. 어느 한쪽이라도 모르면 합계를 말하지 않는다."""
    if kr is None or us is None:
        return None
    if us == 0:
        return kr
    return None if usdkrw is None else kr + us * usdkrw


def point(row: DailyRow, view: View) -> dict[str, Any]:
    if view == "krw":
        value, cost = row.kr_value, row.kr_cost
    elif view == "usd":
        value, cost = row.us_value, row.us_cost
    else:
        value = _combined(row.kr_value, row.us_value, row.usdkrw)
        cost = _combined(row.kr_cost, row.us_cost, row.usdkrw)
    return {
        "day": row.day.isoformat(),
        "value": value,
        "cost": cost,
        "usdkrw": row.usdkrw,
        "backfilled": row.backfilled,
    }


def _section(
    conn: sqlite3.Connection,
    positions: dict[MarketId, list[Position]],
    sessions: dict[MarketId, date | None],
    market: MarketId,
    usdkrw: float | None,
) -> dict[str, Any]:
    """통화별·전체 변화와 기여 최대·최소. 지금 수량 × (세션 종가 - 직전 종가)다."""
    bars = BarRepo(conn)
    currencies: dict[str, dict[str, float | None]] = {}
    change: dict[MarketId, float | None] = {"KR": 0.0, "US": 0.0}
    base: dict[MarketId, float | None] = {"KR": 0.0, "US": 0.0}
    moves: list[tuple[float, MarketId, dict[str, Any]]] = []
    for m, rows in positions.items():
        session = sessions[m]
        moved, before, complete = Decimal(0), Decimal(0), True
        for p in rows:
            close = bars.close_on(m, p.code, session) if session else None
            prev = bars.close_before(m, p.code, session) if session else None
            if not close or not prev:
                complete = False  # 일부만 더하지 않는다
                continue
            amount = p.quantity * (Decimal(str(close)) - Decimal(str(prev)))
            moved += amount
            before += p.quantity * Decimal(str(prev))
            entry = {
                "code": p.code,
                "name": p.name,
                "amount": float(amount),
                "currency": _CURRENCY[m],
            }
            moves.append((float(amount) * ((usdkrw or 1.0) if m == "US" else 1.0), m, entry))
        change[m], base[m] = (float(moved), float(before)) if complete else (None, None)
        currencies[_CURRENCY[m]] = {
            "change": change[m],
            "change_pct": float(moved / before * 100) if complete and before else None,
        }
    total = _combined(change["KR"], change["US"], usdkrw)
    worth = _combined(base["KR"], base["US"], usdkrw)
    # 환율이 없으면 원화와 달러를 견주지 않고 이 브리핑의 시장 안에서만 고른다
    ranked = sorted((x for x in moves if usdkrw is not None or x[1] == market), key=lambda x: x[0])
    return {
        "change_krw": total,
        "change_pct": total / worth * 100 if total is not None and worth else None,
        "currencies": currencies,
        "top": ranked[-1][2] if ranked and ranked[-1][0] > 0 else None,  # 수익 난 종목 중 최대
        "bottom": ranked[0][2] if ranked and ranked[0][0] < 0 else None,  # 손실 난 종목 중 최대
    }


class DailyRecorder:
    def __init__(
        self,
        deps: AppDeps,
        *,
        clock: MarketClock,
        refresh: Callable[[str, str, date], Awaitable[Any]] | None = None,
        fetch_fx: Callable[[date, date], Awaitable[dict[date, float]]] | None = None,
        now: Callable[[], datetime] = lambda: datetime.now(KST),
    ) -> None:
        self._deps = deps
        self._clock = clock
        self._refresh = refresh or self._kis_refresh
        self._fetch_fx = fetch_fx or self._kis_fx
        self._now = now
        self._synced: tuple[date, bool] | None = None
        self._retry_at: datetime | None = None
        self._task: asyncio.Task[None] | None = None

    @property
    def _db(self) -> sqlite3.Connection:
        if self._deps.db is None:
            raise VaterError("DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", status=503)
        return self._deps.db

    def today(self) -> date:
        return self._now().astimezone(KST).date()

    async def _kis_refresh(self, market: str, code: str, through: date) -> None:
        client = require_kis(self._deps).client
        exchange = resolve_target(self._db, market, code).exchange if market == "US" else ""
        item = WatchItem(0, market, code, exchange, code, "")
        await refresh_bars(client, BarRepo(self._db), item, through)

    async def _kis_fx(self, start: date, end: date) -> dict[date, float]:
        return await fetch_usdkrw_range(require_kis(self._deps).client, start, end)

    # ---- 날짜 ---------------------------------------------------------------

    async def _session_at(self, market: MarketId, day: date) -> date | None:
        """`day` 16:00(KST)에 확정돼 있는 그 시장의 마지막 세션."""
        d = day if market == "KR" else day - timedelta(days=1)
        for _ in range(LOOKBACK_DAYS):
            if await self._clock.is_session_day(market, d):
                return d
            d -= timedelta(days=1)
        return None

    async def _open_day(self, day: date) -> bool:
        return await self._clock.is_session_day("KR", day) or await self._clock.is_session_day(
            "US", day
        )

    async def _today_due(self, now: datetime) -> bool:
        """16:00이 지났고 국내 장이 끝났다(수능날은 16:30에 끝난다)."""
        if now.time() < RECORD_AT:
            return False
        if await self._clock.is_session_day("KR", now.date()):
            return now >= session_bounds("KR", now.date())[1] + SETTLE
        return True

    async def _new_days(self, last: date | None, now: datetime) -> list[date]:
        """새로 만들 행. 첫 기록 전 날짜는 만들지 않는다."""
        today = now.date()
        days: list[date] = []
        if last is not None:
            day = max(last + timedelta(days=1), today - timedelta(days=HISTORY_DAYS))
            while day < today:
                if await self._open_day(day):
                    days.append(day)
                day += timedelta(days=1)
        if (
            (last is None or last < today)
            and await self._today_due(now)
            and await self._open_day(today)
        ):
            days.append(today)
        return days

    # ---- 값 -----------------------------------------------------------------

    async def _sync_once(self, today: date, recording_today: bool) -> None:
        """자동 조회이므로 끊긴 연결은 부르지 않는다. 실패하면 마지막 수량으로 기록한다."""
        key = (today, recording_today)
        if self._synced == key:
            return
        self._synced = key
        try:
            await get_holdings(self._deps).sync(skip_lost=True)
        except Exception as e:
            logger.warning("daily: holdings sync failed: %s", type(e).__name__)

    async def _refresh_closes(
        self, positions: dict[MarketId, list[Position]], through: dict[MarketId, date | None]
    ) -> set[tuple[str, str]]:
        """한 종목의 실패는 그 종목에서 끝난다. 실패한 종목을 돌려준다. 키가 없으면 올린다."""
        failed: set[tuple[str, str]] = set()
        for market, rows in positions.items():
            last = through[market]
            if last is None:
                continue
            for p in rows:
                try:
                    await self._refresh(market, p.code, last)
                except Exception as e:
                    if isinstance(e, VaterError) and e.code == "KIS_NOT_CONFIGURED":
                        raise
                    logger.warning("daily: close failed: %s %s", market, type(e).__name__)
                    failed.add((market, p.code))
        return failed

    async def _rates(self, days: Iterable[date]) -> dict[date, float]:
        """하루 한 시점만 쓴다. 저장된 날은 다시 받지 않는다."""
        repo = FxRepo(self._db)
        rates: dict[date, float] = {}
        missing: list[date] = []
        for day in sorted(days):
            saved = repo.get(day)
            if saved is None:
                missing.append(day)
            else:
                rates[day] = saved
        while missing:
            start, end = missing[0], min(missing[0] + FX_SPAN, missing[-1])
            try:
                got = await self._fetch_fx(start, end)
            except Exception as e:
                logger.warning("daily: fx failed: %s", type(e).__name__)
                got = {}
            for day in [d for d in missing if d <= end]:
                if got.get(day):
                    repo.save(day, got[day])
                    rates[day] = got[day]
            missing = [d for d in missing if d > end]
        return rates

    def _value(
        self,
        market: MarketId,
        rows: list[Position],
        session: date | None,
        failed: set[tuple[str, str]],
    ) -> float | None:
        if session is None:
            return None
        bars, total = BarRepo(self._db), Decimal(0)
        for p in rows:
            close = bars.close_on(market, p.code, session)
            if close is None or close <= 0:
                # 못 받았으면 지난 값으로 메우지 않고 다시 받는다. 봉이 없으면 거래정지다
                close = (
                    None
                    if (market, p.code) in failed
                    else bars.recent_close(market, p.code, session, HALT_DAYS)
                )
            if close is None:
                return None
            total += p.quantity * Decimal(str(close))
        return float(total)

    async def _market(
        self,
        market: MarketId,
        rows: list[Position],
        day: date,
        new: bool,
        failed: set[tuple[str, str]],
    ) -> tuple[float | None, float | None]:
        """(평가금액, 매입금액). 보유가 없으면 0이다. 다시 시도하는 지난 행에는 0을 넣지 않는다."""
        if not rows:
            return (0.0, 0.0) if new else (None, None)
        value = self._value(market, rows, await self._session_at(market, day), failed)
        # 평단가를 모르는 수량이 있으면 매입금액을 말하지 않는다. 없는 수익이 보이면 안 된다
        costs = [p.cost for p in rows]
        return value, None if None in costs else sum(c for c in costs if c is not None)

    # ---- 기록 ---------------------------------------------------------------

    async def check_once(self) -> None:
        repo = DailyRepo(self._db)
        now = self._now().astimezone(KST)
        today = now.date()
        last = repo.last_day(today)
        new_days = await self._new_days(last, now)
        retry_since = today - timedelta(days=RETRY_DAYS)
        retry_due = self._retry_at is None or now >= self._retry_at
        retry_days = repo.incomplete(retry_since, today) if retry_due else []
        if not new_days and not retry_days:
            return
        if new_days:
            await self._sync_once(today, today in new_days)
        # ponytail: 지난 날짜에도 지금 수량을 쓴다(스펙 12장). 거래 내역이 생기면 그날 수량으로
        positions = held(self._db)
        if not positions and last is None:
            return

        days = sorted({*new_days, *retry_days})
        through: dict[MarketId, date | None] = {}
        for market in positions:
            sessions = [await self._session_at(market, d) for d in days]
            through[market] = max((s for s in sessions if s), default=None)
        failed = await self._refresh_closes(positions, through)
        rates = await self._rates(days) if "US" in positions else {}

        for day in days:
            new = day in new_days
            kr, kr_cost = await self._market("KR", positions.get("KR", []), day, new, failed)
            us, us_cost = await self._market("US", positions.get("US", []), day, new, failed)
            repo.fill(day, kr, kr_cost, us, us_cost, rates.get(day), backfilled=day < today)
        self._retry_at = now + RETRY if repo.incomplete(retry_since, today) else None

    # ---- 브리핑 -------------------------------------------------------------

    async def my_assets(self, market: MarketId, session: date) -> dict[str, Any] | None:
        """브리핑의 내 자산 구역. 보유가 없으면 None이다. 저장과 표시에만 쓴다.

        전일 기록이 없으면 어제 보유했는지 모르므로 변화를 말하지 않는다.
        """
        positions = held(self._db)
        if not positions:
            return None
        today = self.today()
        if not DailyRepo(self._db).has_before(today):
            return {
                "change_krw": None,
                "change_pct": None,
                "currencies": {
                    _CURRENCY[m]: {"change": None, "change_pct": None} for m in positions
                },
                "top": None,
                "bottom": None,
            }
        sessions: dict[MarketId, date | None] = {
            m: session if m == market else await self._clock.last_closed_session(m)
            for m in positions
        }
        await self._refresh_closes(positions, sessions)
        rates = await self._rates({today, session}) if "US" in positions else {}
        usdkrw = rates.get(today) or rates.get(session)
        return _section(self._db, positions, sessions, market, usdkrw)

    async def _run(self) -> None:
        while True:
            try:
                await self.check_once()
            except asyncio.CancelledError:
                raise
            except VaterError as e:
                logger.log(
                    logging.DEBUG if e.code == "KIS_NOT_CONFIGURED" else logging.WARNING,
                    "daily record skipped: %s",
                    e.code,
                )
            except Exception:  # 한 회차가 실패해도 기록은 계속된다
                logger.exception("daily record failed")
            await asyncio.sleep(TICK_SEC)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task


def get_daily(deps: AppDeps) -> DailyRecorder:
    if deps.daily is None:

        async def kr_trading_day(day: date) -> bool:
            return await is_domestic_trading_day(require_kis(deps).client, day)

        deps.daily = DailyRecorder(deps, clock=MarketClock(kr_trading_day))
    return deps.daily
