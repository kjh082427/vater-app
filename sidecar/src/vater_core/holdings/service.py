"""증권사 연결, 동기화, 종목별 합산 (v2 설계 1, 2, 3, 4-1장).

한 연결의 실패는 그 연결에서 끝난다. 기존 보유 내역은 지우지 않고 다른 연결은 계속 갱신한다.
"""

import asyncio
import contextlib
import logging
import re
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
from vater_core.kis.services import require_kis
from vater_core.secrets.names import BrokerSecretField, SecretName, broker_secret
from vater_core.secrets.store import SecretStore
from vater_core.store.holdings import (
    Broker,
    Connection,
    Holding,
    HoldingRow,
    HoldingsRepo,
    bad_broker_response,
)
from vater_core.store.settings import SettingsRepo

logger = logging.getLogger(__name__)

AUTH_ERRORS = {"BROKER_AUTH_INVALID", "KIS_AUTH_INVALID"}
TICK_SEC = 60.0
_FIELDS: tuple[BrokerSecretField, ...] = ("APP_KEY", "APP_SECRET", "ACCOUNT", "TOKEN")
_MARKET_CURRENCY = {"KR": "KRW", "US": "USD"}


def _digits(account: str | None) -> str:
    return re.sub(r"\D", "", account or "")


def mask_account(account: str | None) -> str:
    digits = _digits(account)
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


def _server_mismatch() -> VaterError:
    return VaterError(
        "BROKER_SERVER_MISMATCH",
        "이 한투 연결은 다른 서버(실전·모의)에서 만든 연결입니다.",
        "서버 설정을 되돌리거나 연결을 해제한 뒤 다시 연결해 주세요.",
        status=409,
    )


@dataclass(frozen=True)
class SyncResult:
    connection_id: int
    broker_id: str
    ok: bool
    error: VaterError | None = None


def summarize(holdings: list[Holding], brokers: list[Broker], stale: set[int]) -> dict[str, Any]:
    """한 종목의 합계. 평단가를 모르거나 통화가 다른 수량은 평단가·매입금액에서 뺀다(스펙 4-1)."""
    total = sum((h.quantity for h in holdings), Decimal(0))
    currency = _MARKET_CURRENCY.get(holdings[0].market or "") if holdings else None
    priced = [h for h in holdings if h.avg_price is not None and h.currency == currency]
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
        "currency": currency,
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
        kis = None
        if conn.broker_id == "kis":
            kis = require_kis(self._deps)
            if conn.server != kis.server.value:  # 실계좌번호를 모의 서버로 보내지 않는다
                raise _server_mismatch()
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
            kis=kis.client if kis else None,
        )

    def _forget_secrets(self, conn_id: int) -> None:
        for field in _FIELDS:
            self._secrets.delete(broker_secret(conn_id, field))

    # ---- 연결 -------------------------------------------------------------

    def _same_account(self, conn: Connection, digits: str, app_key: str | None) -> bool:
        s = self._secrets
        stored = _digits(s.get(broker_secret(conn.id, "ACCOUNT")))
        if stored and digits:  # 뒷자리만 같은 다른 계좌를 막지 않도록 저장된 번호로 비교한다
            return stored == digits
        return s.get(broker_secret(conn.id, "APP_KEY")) == app_key

    async def connect(
        self,
        broker_id: str,
        app_key: str | None,
        app_secret: str | None,
        account: str | None,
        replaces: int | None = None,
    ) -> Connection:
        """연결 테스트를 통과해야 남긴다. 실패하면 비밀키까지 지운다.

        `replaces`는 [다시 연결]이 고른 옛 연결이다. 해제하면 계좌번호도 지우므로 앱이 같은
        계좌인지 알 수 없어 사용자가 고른다. 새 연결의 첫 조회가 성공해야 옛 연결을 지운다.
        """
        async with self._lock:
            conn = await self._connect(broker_id, app_key, app_secret, account, replaces)
        self._changed(broker_id)
        return conn

    async def _connect(
        self,
        broker_id: str,
        app_key: str | None,
        app_secret: str | None,
        account: str | None,
        replaces: int | None,
    ) -> Connection:
        broker = self.repo.broker(broker_id)
        factory = ADAPTERS.get(broker_id)
        if broker is None or broker.kind != "api" or factory is None:
            raise _unknown_broker(broker_id)
        is_kis = broker_id == "kis"
        server = require_kis(self._deps).server.value if is_kis else None
        if not is_kis and not (app_key and app_secret):
            raise VaterError("HOLDING_INVALID", "앱키와 시크릿을 입력해 주세요.", status=422)
        old = self.repo.connection(replaces) if replaces is not None else None
        if replaces is not None and (old is None or old.broker_id != broker_id):
            raise VaterError("CONNECTION_NOT_FOUND", "연결을 찾을 수 없습니다.", status=404)
        key = None if is_kis else (app_key or "").strip()
        digits = _digits(account)
        if any(
            c.broker_id == broker_id
            and c.status != "disconnected"
            and c.id != replaces
            and self._same_account(c, digits, key)
            for c in self.repo.connections()
        ):
            raise VaterError(
                "BROKER_DUPLICATE",
                "이미 연결된 계좌입니다.",
                "다른 키로 연결하려면 먼저 연결을 해제해 주세요.",
                status=409,
            )
        if is_kis and any(
            c.broker_id == "kis"
            and c.status != "disconnected"
            and c.id != replaces
            and c.server != server
            for c in self.repo.connections()
        ):  # 실전과 모의 수량을 한 합계에 섞지 않는다
            raise _server_mismatch()
        conn = self.repo.add_connection(broker_id, mask_account(account), server)
        try:
            s = self._secrets
            if account:
                s.set(broker_secret(conn.id, "ACCOUNT"), account.strip())
            if not is_kis and app_key and app_secret:
                s.set(broker_secret(conn.id, "APP_KEY"), app_key.strip())
                s.set(broker_secret(conn.id, "APP_SECRET"), app_secret.strip())
            adapter = factory(self._context(conn))
            await adapter.test()
            if old is not None:
                self.repo.replace_api(conn.id, await adapter.holdings(), _now())
        except BaseException as e:  # 취소돼도 키와 행을 남기지 않는다
            self._forget_secrets(conn.id)
            self.repo.remove_connection(conn.id)
            if isinstance(e, VaterError) or not isinstance(e, Exception):
                raise
            # 예외 문구에 키가 있을 수 있고, 키를 지웠으니 마스킹도 못 한다. 종류만 남긴다
            logger.warning("broker test crashed: %s %s", broker_id, type(e).__name__)
            raise bad_broker_response() from None
        if old is not None:  # 옛 수량을 합계에 두 번 넣지 않는다
            self._forget_secrets(old.id)
            self.repo.remove_connection(old.id)
        return conn

    async def disconnect(self, conn_id: int, delete_data: bool) -> None:
        """키는 항상 지운다. 보유 내역은 사용자가 고른다(v2 설계 1-1장)."""
        async with (
            self._lock
        ):  # 진행 중인 동기화가 끝난 뒤에 지워야 상태와 토큰이 되살아나지 않는다
            if self.repo.connection(conn_id) is None:
                raise VaterError("CONNECTION_NOT_FOUND", "연결을 찾을 수 없습니다.", status=404)
            self._forget_secrets(conn_id)
            if delete_data:
                self.repo.remove_connection(conn_id)
            else:
                self.repo.set_status(conn_id, "disconnected")
        self._changed(None)

    async def delete_broker_data(self, broker_id: str) -> None:
        """그 증권사의 보유 내역을 모두 지운다. 끊기거나 해제된 연결도 함께 지운다."""
        repo = self.repo
        if repo.broker(broker_id) is None:
            raise _unknown_broker(broker_id)
        async with self._lock:
            mine = [c for c in repo.connections() if c.broker_id == broker_id]
            if any(c.status == "ok" for c in mine):
                raise VaterError(
                    "BROKER_CONNECTED",
                    "연결 중인 증권사의 내역은 다음 갱신 때 다시 채워집니다.",
                    "연결을 먼저 해제해 주세요.",
                    status=409,
                )
            for c in mine:
                self._forget_secrets(c.id)
                repo.remove_connection(c.id)
            repo.delete_broker_data(broker_id)
        self._changed(broker_id)

    # ---- 수동 입력 --------------------------------------------------------

    def save_manual(self, broker_id: str, row: HoldingRow) -> None:
        self.ensure_manual_allowed(broker_id)
        self.repo.manual_upsert(broker_id, row, _now())
        self._changed(broker_id)

    def manual_changes(self, broker_id: str, incoming: list[tuple[str, str]]) -> dict[str, int]:
        """가져오기로 달라지는 수(v2 설계 14장)."""
        new = set(incoming)
        old = {
            (h.market or "", h.code)
            for h in self.repo.all()
            if h.broker_id == broker_id and h.connection_id == 0
        }
        return {"added": len(new - old), "updated": len(new & old), "removed": len(old - new)}

    def ensure_manual_allowed(self, broker_id: str) -> None:
        repo = self.repo
        if repo.broker(broker_id) is None:
            raise VaterError("HOLDING_INVALID", "증권사를 먼저 추가해 주세요.", status=422)
        if any(c.broker_id == broker_id and c.status != "disconnected" for c in repo.connections()):
            raise VaterError(
                "HOLDING_INVALID",
                "API로 연결된 증권사는 직접 입력할 수 없습니다.",
                "연결된 증권사의 보유 내역은 [새로 고침]으로 갱신됩니다.",
                status=422,
            )

    def replace_manual(self, broker_id: str, rows: list[HoldingRow]) -> None:
        self.ensure_manual_allowed(broker_id)
        self.repo.replace_manual(broker_id, rows, "csv", _now())
        self._changed(broker_id)

    def delete_manual(self, broker_id: str, market: str, code: str) -> None:
        self.repo.manual_delete(broker_id, market, code)
        self._changed(broker_id)

    def _changed(self, broker_id: str | None) -> None:
        if self._deps.events is not None:
            self._deps.events.publish("holdings.changed", {"broker_id": broker_id})

    # ---- 동기화 -----------------------------------------------------------

    async def _sync_one(self, conn: Connection) -> SyncResult:
        factory = ADAPTERS.get(conn.broker_id)
        try:
            if factory is None:
                raise _unknown_broker(conn.broker_id)
            rows = await factory(self._context(conn)).holdings()
            self.repo.replace_api(conn.id, rows, _now())
        except Exception as e:  # 응답 형식이 깨져도 다른 연결과 주기 조회는 계속된다
            err = e if isinstance(e, VaterError) else bad_broker_response()
            # 일시 오류로 "연결 끊김"이 풀리지 않게 상태는 인증 실패 때만 바꾼다
            self.repo.set_status(
                conn.id, "lost" if err.code in AUTH_ERRORS else conn.status, err.code
            )
            logger.warning(
                "broker sync failed: %s %s %s", conn.broker_id, err.code, type(e).__name__
            )
            return SyncResult(conn.id, conn.broker_id, False, err)
        return SyncResult(conn.id, conn.broker_id, True)

    async def sync(
        self, broker_id: str | None = None, *, skip_lost: bool = False
    ) -> list[SyncResult]:
        """`skip_lost`는 자동 조회용이다. 끊긴 연결은 사용자가 고칠 때까지 부르지 않는다."""
        async with self._lock:
            skipped = {"disconnected", "lost"} if skip_lost else {"disconnected"}
            targets = [
                c
                for c in self.repo.connections()
                if c.status not in skipped and (broker_id is None or c.broker_id == broker_id)
            ]
            results = list(await asyncio.gather(*(self._sync_one(c) for c in targets)))
        if results:
            self._changed(broker_id)
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
        await self.sync(skip_lost=True)

    async def _run(self) -> None:
        try:
            await self.sync(skip_lost=True)  # 앱 시작 때 한 번
        except Exception:
            logger.exception("holdings startup sync failed")
        while True:
            await asyncio.sleep(TICK_SEC)
            try:
                await self.tick_once()
            except Exception:
                logger.exception("holdings sync loop failed")

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task


def get_holdings(deps: AppDeps) -> HoldingsService:
    if deps.holdings is None:
        from vater_core.alerts.monitor import get_alerts

        def is_open() -> bool:
            return "open" in get_alerts(deps).status()["markets"].values()

        deps.holdings = HoldingsService(deps, is_market_open=is_open)
    return deps.holdings
