"""증권사 연결과 보유 내역 API (v2 설계 1, 2, 4-1, 5, 14장). 주문 경로는 없다."""

from typing import Any, Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from vater_core.alerts.rules import default_timing, parse_rule
from vater_core.alerts.store import RuleRepo, WatchlistRepo
from vater_core.analysis.symbols import resolve_target
from vater_core.api.deps import AppDeps, get_deps
from vater_core.api.errors import ErrorBody, VaterError
from vater_core.holdings.csv_import import (
    ColumnGuess,
    build_rows,
    csv_invalid,
    decode_csv,
    guess_columns,
    parse_table,
)
from vater_core.holdings.service import get_holdings
from vater_core.store.holdings import AvgPrice, Holding, HoldingRow, HoldingsRepo, Quantity

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
    server: str | None


class ConnectionCreate(BaseModel):
    broker_id: str
    app_key: str | None = Field(default=None, repr=False)
    app_secret: str | None = Field(default=None, repr=False)
    account: str | None = Field(default=None, repr=False)
    replaces: int | None = None  # [다시 연결]이 고른 옛 연결. 첫 조회가 성공하면 이것을 대신한다


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
    unsupported_reason: str | None
    is_new: bool  # 업로드 확인 창에서 아직 보지 못한 종목


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
    seen: list[
        WatchTarget
    ] = []  # 확인 창에 보였지만 체크하지 않은 종목. 다시 새 종목으로 세지 않는다
    rule: BulkRule | None = None


class ManualHolding(BaseModel):
    broker_id: str
    market: Literal["KR", "US"]
    code: str
    quantity: Quantity
    avg_price: AvgPrice


class ManualKey(BaseModel):
    broker_id: str
    market: Literal["KR", "US"]
    code: str


class CsvGuess(BaseModel):
    name: str | None
    code: str | None
    quantity: str | None
    avg_price: str | None


class CsvCandidate(BaseModel):
    market: str
    code: str
    name: str


class CsvRowOut(BaseModel):
    row: int
    name: str
    market: Literal["KR", "US"] | None
    code: str | None
    quantity: str | None
    avg_price: float | None
    error: str | None
    candidates: list[CsvCandidate]


class CsvChanges(BaseModel):
    added: int
    updated: int
    removed: int


class CsvPreview(BaseModel):
    columns: list[str]
    guess: CsvGuess
    rows: list[CsvRowOut]
    changes: CsvChanges


class CsvCommitRow(BaseModel):
    market: Literal["KR", "US"]
    code: str
    quantity: Quantity
    avg_price: AvgPrice


class CsvCommit(BaseModel):
    broker_id: str
    rows: list[CsvCommitRow]


class WatchResult(BaseModel):
    added: int
    skipped: int
    rules: int


def _unsupported_reason(repo: HoldingsRepo, h: Holding) -> str | None:
    if h.market is None:
        return "국내·미국 외 시장은 지원하지 않습니다."
    if not repo.in_master(h.market, h.code):
        return "종목 목록에 없는 상품입니다(ETN 등)."
    return None


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
        body.broker_id, body.app_key, body.app_secret, body.account, body.replaces
    )
    return ConnectionOut(**vars(conn))


@router.delete("/connections/{conn_id}", status_code=204)
async def remove_connection(
    conn_id: int,
    delete_data: bool,
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> Response:
    await get_holdings(deps).disconnect(conn_id, delete_data)
    return Response(status_code=204)


@router.delete("/brokers/{broker_id}/data", status_code=204)
async def delete_broker_data(
    broker_id: str,
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> Response:
    await get_holdings(deps).delete_broker_data(broker_id)
    return Response(status_code=204)


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
    repo = get_holdings(deps).repo
    seen = repo.seen()
    out = []
    for h in repo.all():
        reason = _unsupported_reason(repo, h)
        out.append(
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
                supported=reason is None,
                unsupported_reason=reason,
                is_new=(h.market or "", h.code) not in seen,
            )
        )
    return out


@router.get("/holdings/symbol/{market}/{code}")
async def symbol_holdings(
    market: Literal["KR", "US"],
    code: str,
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> SymbolHoldings:
    return SymbolHoldings(**get_holdings(deps).summary(market, code))


@router.put("/holdings/manual", status_code=204)
async def save_manual(
    body: ManualHolding,
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> Response:
    if deps.db is None:
        raise VaterError("DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", status=503)
    code = body.code.upper() if body.market == "US" else body.code
    target = resolve_target(deps.db, body.market, code)
    get_holdings(deps).save_manual(
        body.broker_id,
        HoldingRow(
            body.market,
            code,
            target.name,
            body.quantity,
            body.avg_price,
            "KRW" if body.market == "KR" else "USD",
        ),
    )
    return Response(status_code=204)


@router.delete("/holdings/manual", status_code=204)
async def delete_manual(
    body: ManualKey,
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> Response:
    code = body.code.upper() if body.market == "US" else body.code
    get_holdings(deps).delete_manual(body.broker_id, body.market, code)
    return Response(status_code=204)


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
    get_holdings(deps).repo.mark_seen(
        (t.market, t.code.upper() if t.market == "US" else t.code)
        for t in [*body.items, *body.seen]
    )
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


@router.post(
    "/holdings/csv/preview",
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"text/csv": {"schema": {"type": "string", "format": "binary"}}},
        }
    },
)
async def csv_preview(
    request: Request,
    broker_id: str,
    name_col: str | None = None,
    code_col: str | None = None,
    quantity_col: str | None = None,
    avg_price_col: str | None = None,
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> CsvPreview:
    """저장하지 않고 행을 해석한다. 열을 고르면 그 값이 추정보다 우선한다."""
    if deps.db is None:
        raise VaterError("DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", status=503)
    service = get_holdings(deps)
    service.ensure_manual_allowed(broker_id)
    columns, table = parse_table(decode_csv(await request.body()))
    auto = guess_columns(columns)
    guess = ColumnGuess(
        name_col or auto.name,
        code_col or auto.code,
        quantity_col or auto.quantity,
        avg_price_col or auto.avg_price,
    )
    rows = build_rows(deps.db, columns, table, guess)
    good = [(r.market, r.code) for r in rows if r.error is None and r.market and r.code]
    return CsvPreview(
        columns=columns,
        guess=CsvGuess(**vars(guess)),
        rows=[
            CsvRowOut(
                row=r.row,
                name=r.name,
                market=r.market,  # type: ignore[arg-type]
                code=r.code,
                quantity=format(r.quantity.normalize(), "f") if r.quantity is not None else None,
                avg_price=float(r.avg_price) if r.avg_price is not None else None,
                error=r.error,
                candidates=[CsvCandidate(**c) for c in r.candidates],
            )
            for r in rows
        ],
        changes=CsvChanges(**service.manual_changes(broker_id, good)),
    )


@router.post("/holdings/csv/commit")
async def csv_commit(
    body: CsvCommit,
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> CsvChanges:
    """그 증권사의 수동 항목을 파일 내용으로 바꾼다. 하나라도 틀리면 아무것도 바꾸지 않는다."""
    if deps.db is None:
        raise VaterError("DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", status=503)
    service = get_holdings(deps)
    if not body.rows:
        raise csv_invalid(
            "올릴 종목이 없습니다.", "수동 항목을 지우려면 증권사 데이터 삭제를 써 주세요."
        )
    rows = []
    for r in body.rows:
        code = r.code.upper() if r.market == "US" else r.code
        target = resolve_target(deps.db, r.market, code)
        currency = "KRW" if r.market == "KR" else "USD"
        rows.append(HoldingRow(r.market, code, target.name, r.quantity, r.avg_price, currency))
    keys: list[tuple[str, str]] = [(r.market or "", r.code) for r in rows]
    if len(set(keys)) != len(keys):
        raise csv_invalid("같은 종목이 두 번 있습니다.")
    changes = service.manual_changes(body.broker_id, keys)
    service.replace_manual(body.broker_id, rows)
    return CsvChanges(**changes)
