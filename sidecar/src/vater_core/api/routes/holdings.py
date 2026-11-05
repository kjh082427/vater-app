"""증권사 연결과 보유 내역 API (v2 설계 1, 2, 4-1, 5, 14장). 주문 경로는 없다."""

from typing import Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from vater_core.alerts.rules import default_timing, parse_rule
from vater_core.alerts.store import RuleRepo, WatchlistRepo
from vater_core.analysis.symbols import resolve_target
from vater_core.api.deps import AppDeps, get_deps
from vater_core.api.errors import ErrorBody, VaterError
from vater_core.holdings.service import get_holdings

router = APIRouter(tags=["holdings"])

# 목표가 규칙은 종목마다 값이 달라 일괄 적용할 수 없다 (v2 설계 6장)
NO_BULK_KINDS = {"price_above", "price_below"}


class BrokerOut(BaseModel):
    id: str
    name: str
    color: str
    kind: Literal["api", "manual"]
    builtin: bool


class BrokerCreate(BaseModel):
    name: str


class ConnectionOut(BaseModel):
    id: int
    broker_id: str
    account_mask: str
    status: Literal["ok", "lost", "disconnected"]
    last_synced_at: str | None
    last_error: str | None


class ConnectionCreate(BaseModel):
    broker_id: str
    app_key: str | None = Field(default=None, repr=False)
    app_secret: str | None = Field(default=None, repr=False)
    account: str | None = Field(default=None, repr=False)


class SyncRequest(BaseModel):
    broker_id: str | None = None


class SyncResultOut(BaseModel):
    connection_id: int
    broker_id: str
    ok: bool
    error: ErrorBody | None = None


class HoldingOut(BaseModel):
    broker_id: str
    connection_id: int
    market: Literal["KR", "US"] | None
    code: str
    name: str
    quantity: str
    avg_price: float | None
    currency: str
    source: Literal["api", "manual", "csv"]
    updated_at: str
    supported: bool


class BrokerShare(BaseModel):
    broker_id: str
    name: str
    color: str
    quantity: str
    ratio: float  # 총 수량 중 몫(%)
    stale: bool  # 연결이 끊겼거나 해제되어 갱신되지 않는 수량


class SymbolHoldings(BaseModel):
    total: str
    avg_price: float | None
    cost: float | None
    unpriced_quantity: str  # 평단가를 몰라 평단가·손익 계산에서 뺀 수량
    currency: str | None
    brokers: list[BrokerShare]


class WatchTarget(BaseModel):
    market: Literal["KR", "US"]
    code: str


class BulkRule(BaseModel):
    kind: str
    params: dict[str, Any] | None = None


class WatchRequest(BaseModel):
    items: list[WatchTarget]
    rule: BulkRule | None = None


class WatchResult(BaseModel):
    added: int
    skipped: int
    rules: int


@router.get("/brokers")
async def list_brokers(deps: AppDeps = Depends(get_deps)) -> list[BrokerOut]:  # noqa: B008
    return [BrokerOut(**vars(b)) for b in get_holdings(deps).repo.brokers()]


@router.post("/brokers", status_code=201)
async def add_broker(body: BrokerCreate, deps: AppDeps = Depends(get_deps)) -> BrokerOut:  # noqa: B008
    return BrokerOut(**vars(get_holdings(deps).repo.add_broker(body.name)))


@router.get("/connections")
async def list_connections(deps: AppDeps = Depends(get_deps)) -> list[ConnectionOut]:  # noqa: B008
    return [ConnectionOut(**vars(c)) for c in get_holdings(deps).repo.connections()]


@router.post("/connections", status_code=201)
async def add_connection(
    body: ConnectionCreate,
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> ConnectionOut:
    conn = await get_holdings(deps).connect(
        body.broker_id, body.app_key, body.app_secret, body.account
    )
    return ConnectionOut(**vars(conn))


@router.post("/holdings/sync")
async def sync_holdings(
    body: SyncRequest,
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> list[SyncResultOut]:
    results = await get_holdings(deps).sync(body.broker_id)
    return [
        SyncResultOut(
            connection_id=r.connection_id,
            broker_id=r.broker_id,
            ok=r.ok,
            error=ErrorBody(code=r.error.code, message=r.error.message, hint=r.error.hint)
            if r.error
            else None,
        )
        for r in results
    ]


@router.get("/holdings")
async def list_holdings(deps: AppDeps = Depends(get_deps)) -> list[HoldingOut]:  # noqa: B008
    return [
        HoldingOut(
            broker_id=h.broker_id,
            connection_id=h.connection_id,
            market=h.market,
            code=h.code,
            name=h.name,
            quantity=format(h.quantity.normalize(), "f"),
            avg_price=float(h.avg_price) if h.avg_price is not None else None,
            currency=h.currency,
            source=h.source,
            updated_at=h.updated_at,
            supported=h.supported,
        )
        for h in get_holdings(deps).repo.all()
    ]


@router.get("/holdings/symbol/{market}/{code}")
async def symbol_holdings(
    market: Literal["KR", "US"],
    code: str,
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> SymbolHoldings:
    return SymbolHoldings(**get_holdings(deps).summary(market, code))


@router.post("/holdings/watch")
async def watch_holdings(
    body: WatchRequest,
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> WatchResult:
    """고른 종목을 감시 종목에 넣는다. 보유 내역은 그대로다(v2 설계 2장)."""
    if deps.db is None:
        raise VaterError("DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", status=503)
    params: dict[str, Any] | None = None
    if body.rule is not None:
        if body.rule.kind in NO_BULK_KINDS:
            raise VaterError(
                "ALERT_RULE_INVALID",
                "목표가 규칙은 일괄 적용할 수 없습니다.",
                "종목마다 값이 달라 종목 화면에서 따로 추가해 주세요.",
                status=422,
            )
        params = parse_rule(body.rule.kind, body.rule.params or {}).model_dump()
    watch, rules = WatchlistRepo(deps.db), RuleRepo(deps.db)
    added = skipped = made = 0
    for item in body.items:
        code = item.code.upper() if item.market == "US" else item.code
        try:
            new = watch.add(resolve_target(deps.db, item.market, code))
        except VaterError as e:
            if e.code not in ("WATCHLIST_DUPLICATE", "SYMBOL_UNKNOWN"):
                raise
            skipped += 1
            continue
        added += 1
        if body.rule is not None and params is not None:
            rules.create(new.id, body.rule.kind, params, default_timing(body.rule.kind), True)
            made += 1
    return WatchResult(added=added, skipped=skipped, rules=made)
