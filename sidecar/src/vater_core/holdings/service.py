"""증권사 연결, 동기화, 종목별 합산 (v2 설계 1, 2, 3, 4-1장).

한 연결의 실패는 그 연결에서 끝난다. 기존 보유 내역은 지우지 않고 다른 연결은 계속 갱신한다.
"""

import asyncio
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import httpx

from vater_core.api.deps import AppDeps
from vater_core.api.errors import VaterError
from vater_core.brokers.base import ADAPTERS, BrokerContext, BrokerCreds
from vater_core.brokers.readonly import ReadOnlyHttp
from vater_core.secrets.names import BrokerSecretField, SecretName, broker_secret
from vater_core.secrets.store import SecretStore
from vater_core.store.holdings import Broker, Connection, Holding, HoldingsRepo
from vater_core.store.settings import SettingsRepo

logger = logging.getLogger(__name__)

AUTH_ERRORS = {"BROKER_AUTH_INVALID"}
TICK_SEC = 60.0
_FIELDS: tuple[BrokerSecretField, ...] = ("APP_KEY", "APP_SECRET", "ACCOUNT", "TOKEN")


def mask_account(account: str | None) -> str:
    digits = (account or "").replace("-", "")
    return f"****{digits[-4:]}" if digits else ""


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _unknown_broker(broker_id: str) -> VaterError:
    return VaterError(
        "BROKER_UNKNOWN",
        f"연결할 수 없는 증권사입니다: {broker_id}",
        "API로 연결되는 증권사는 한국투자, 키움, 메리츠입니다. 그 밖에는 직접 입력해 주세요.",
        status=422,
    )


@dataclass(frozen=True)
class SyncResult:
    connection_id: int
    broker_id: str
    ok: bool
    error: VaterError | None = None


def summarize(holdings: list[Holding], brokers: list[Broker], stale: set[int]) -> dict[str, Any]:
    """한 종목의 합계. 평단가를 모르는 수량은 평단가·매입금액에서 뺀다(스펙 4-1)."""
    total = sum((h.quantity for h in holdings), Decimal(0))
    priced = [h for h in holdings if h.avg_price is not None]
    priced_qty = sum((h.quantity for h in priced), Decimal(0))
    cost = sum((h.quantity * (h.avg_price or Decimal(0)) for h in priced), Decimal(0))
    by_broker: dict[str, Decimal] = {}
    stale_brokers: set[str] = set()
    for h in holdings:
        by_broker[h.broker_id] = by_broker.get(h.broker_id, Decimal(0)) + h.quantity
        if h.connection_id in stale:
            stale_brokers.add(h.broker_id)
    info = {b.id: b for b in brokers}
    rows = [
        {
            "broker_id": bid,
            "name": info[bid].name,
            "color": info[bid].color,
            "quantity": format(qty.normalize(), "f"),
            "ratio": float(qty / total * 100),
            "stale": bid in stale_brokers,
        }
        for bid, qty in sorted(by_broker.items(), key=lambda kv: -kv[1])
        if bid in info
    ]
    return {
        "total": format(total.normalize(), "f") if total else "0",
        "avg_price": float(cost / priced_qty) if priced_qty else None,
        "cost": float(cost) if priced_qty else None,
        "unpriced_quantity": format((total - priced_qty).normalize(), "f")
        if total != priced_qty
        else "0",
        "currency": holdings[0].currency if holdings else None,
        "brokers": rows,
    }


class HoldingsService:
    def __init__(
        self,
        deps: AppDeps,
        *,
        is_market_open: Callable[[], bool] = lambda: False,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._deps = deps
        self._is_market_open = is_market_open
        self._monotonic = monotonic
        self._lock = asyncio.Lock()
        self._last_periodic: float | None = None
        self._task: asyncio.Task[None] | None = None

    # ---- 의존성 -----------------------------------------------------------

    @property
    def repo(self) -> HoldingsRepo:
        if self._deps.db is None:
            raise VaterError("DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", status=503)
        return HoldingsRepo(self._deps.db)

    @property
    def _secrets(self) -> SecretStore:
        if self._deps.secrets is None:
            raise VaterError("SECRETS_UNAVAILABLE", "비밀키 저장소가 없습니다.", status=503)
        return self._deps.secrets

    def _http(self) -> httpx.AsyncClient:
        if self._deps.http is None:
            self._deps.http = httpx.AsyncClient(timeout=15)
        return self._deps.http

    def _context(self, conn: Connection) -> BrokerContext:
        s = self._secrets
        account = s.get(broker_secret(conn.id, "ACCOUNT"))
        if conn.broker_id == "kis":
            key, secret = s.get(SecretName.KIS_APP_KEY), s.get(SecretName.KIS_APP_SECRET)
        else:
            key = s.get(broker_secret(conn.id, "APP_KEY"))
            secret = s.get(broker_secret(conn.id, "APP_SECRET"))
        if not key or not secret:
            raise VaterError(
                "BROKER_AUTH_INVALID",
                "저장된 키가 없습니다.",
                "설정 > 증권사 연결에서 다시 연결해 주세요.",
                status=401,
            )
        http = self._http()
        return BrokerContext(
            BrokerCreds(conn.id, key, secret, account),
            s,
            lambda base, allowed: ReadOnlyHttp(http, base, allowed),
        )

    def _forget_secrets(self, conn_id: int) -> None:
        for field in _FIELDS:
            self._secrets.delete(broker_secret(conn_id, field))

    # ---- 연결 -------------------------------------------------------------

    async def connect(
        self, broker_id: str, app_key: str | None, app_secret: str | None, account: str | None
    ) -> Connection:
        """연결 테스트를 통과해야 남긴다. 실패하면 비밀키까지 지운다."""
        broker = self.repo.broker(broker_id)
        factory = ADAPTERS.get(broker_id)
        if broker is None or broker.kind != "api" or factory is None:
            raise _unknown_broker(broker_id)
        is_kis = broker_id == "kis"
        if not is_kis and not (app_key and app_secret):
            raise VaterError("HOLDING_INVALID", "앱키와 시크릿을 입력해 주세요.", status=422)
        mask = mask_account(account)
        # 뒷자리만 같은 다른 계좌를 막지 않도록 가린 값이 아니라 저장된 번호로 비교한다
        clean = (account or "").strip()
        if clean and any(
            c.broker_id == broker_id and self._secrets.get(broker_secret(c.id, "ACCOUNT")) == clean
            for c in self.repo.connections()
        ):
            raise VaterError(
                "BROKER_DUPLICATE",
                "이미 연결된 계좌입니다.",
                "다른 키로 연결하려면 먼저 연결을 해제해 주세요.",
                status=409,
            )
        conn = self.repo.add_connection(broker_id, mask)
        try:
            s = self._secrets
            if account:
                s.set(broker_secret(conn.id, "ACCOUNT"), account.strip())
            if not is_kis and app_key and app_secret:
                s.set(broker_secret(conn.id, "APP_KEY"), app_key.strip())
                s.set(broker_secret(conn.id, "APP_SECRET"), app_secret.strip())
            await factory(self._context(conn)).test()
        except Exception:
            self._forget_secrets(conn.id)
            self.repo.remove_connection(conn.id)
            raise
        return conn

    # ---- 동기화 -----------------------------------------------------------

    async def _sync_one(self, conn: Connection) -> SyncResult:
        factory = ADAPTERS.get(conn.broker_id)
        try:
            if factory is None:
                raise _unknown_broker(conn.broker_id)
            rows = await factory(self._context(conn)).holdings()
        except VaterError as e:
            self.repo.set_status(conn.id, "lost" if e.code in AUTH_ERRORS else "ok", e.code)
            logger.warning("broker sync failed: %s %s", conn.broker_id, e.code)
            return SyncResult(conn.id, conn.broker_id, False, e)
        self.repo.replace_api(conn.id, rows, _now())
        return SyncResult(conn.id, conn.broker_id, True)

    async def sync(self, broker_id: str | None = None) -> list[SyncResult]:
        async with self._lock:
            targets = [
                c
                for c in self.repo.connections()
                if c.status != "disconnected" and (broker_id is None or c.broker_id == broker_id)
            ]
            results = list(await asyncio.gather(*(self._sync_one(c) for c in targets)))
        if results and self._deps.events is not None:
            self._deps.events.publish("holdings.changed", {"broker_id": broker_id})
        return results

    def summary(self, market: str, code: str) -> dict[str, Any]:
        repo = self.repo
        stale = {c.id for c in repo.connections() if c.status != "ok"}
        return summarize(repo.by_symbol(market, code), repo.brokers(), stale)

    # ---- 주기 조회 --------------------------------------------------------

    async def tick_once(self) -> None:
        """설정이 켜져 있고 장이 열려 있으면 주기마다 동기화한다."""
        if self._deps.db is None:
            return
        minutes = int(SettingsRepo(self._deps.db).get("holdings.sync_minutes"))
        if minutes <= 0 or not self._is_market_open():
            return
        now = self._monotonic()
        if self._last_periodic is not None and now - self._last_periodic < minutes * 60:
            return
        self._last_periodic = now
        await self.sync()

    async def _run(self) -> None:
        await self.sync()  # 앱 시작 때 한 번
        while True:
            await asyncio.sleep(TICK_SEC)
            try:
                await self.tick_once()
            except Exception:
                logger.exception("holdings sync loop failed")

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run())


def get_holdings(deps: AppDeps) -> HoldingsService:
    if deps.holdings is None:
        from vater_core.alerts.monitor import get_alerts

        def is_open() -> bool:
            return "open" in get_alerts(deps).status()["markets"].values()

        deps.holdings = HoldingsService(deps, is_market_open=is_open)
    return deps.holdings
