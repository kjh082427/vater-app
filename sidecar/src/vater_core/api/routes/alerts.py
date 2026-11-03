"""알림 규칙·발생 이력·감시 상태 API (스펙 2-3, 4장).

규칙의 params는 종류별 모델로 검사하고, 기본값을 채운 형태로 저장한다.
SSE: `alert.fired`(발생한 알림), `alerts.state` `{state, realtime, polling, markets, feeds}`,
`quote`(감시 종목 시세 갱신).
"""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel

from vater_core.alerts.monitor import get_alerts
from vater_core.alerts.rules import KINDS, default_params, default_timing, parse_rule
from vater_core.alerts.store import AlertEvent, EventRepo, Rule, RuleRepo, WatchlistRepo
from vater_core.api.deps import AppDeps, get_deps
from vater_core.api.errors import VaterError

router = APIRouter(prefix="/alerts", tags=["alerts"])

Timing = Literal["realtime", "close"]
MonitorState = Literal["running", "paused", "offline", "closed"]


class RuleCreate(BaseModel):
    watchlist_id: int
    kind: str
    params: dict[str, Any] | None = None  # 없으면 기본값
    timing: Timing | None = None  # 없으면 종류별 기본값
    enabled: bool = True


class RulePatch(BaseModel):
    params: dict[str, Any] | None = None
    timing: Timing | None = None
    enabled: bool | None = None


class RuleOut(BaseModel):
    id: int
    watchlist_id: int
    kind: str
    params: dict[str, Any]
    timing: str
    enabled: bool
    last_state: bool | None
    last_fired_at: str | None


class AlertEventOut(BaseModel):
    id: int
    rule_id: int | None  # 없으면 이벤트 알림(분석 완료·브리핑 도착)
    fired_at: str
    value: float | None
    message: str
    market: str | None
    code: str | None
    name: str | None
    kind: str | None


class FeedOut(BaseModel):
    market: str
    code: str
    feed: Literal["realtime", "polling", "idle", "closed", "offline"]


class MonitorStatus(BaseModel):
    state: MonitorState
    realtime: int
    polling: int
    markets: dict[
        str, Literal["open", "closed"]
    ]  # {"KR": ..., "US": ...}, 첫 확인 전에는 비어 있음
    feeds: list[FeedOut]  # 감시 종목별 수신 상태


class MonitorStateOut(BaseModel):
    state: MonitorState


class KindInfo(BaseModel):
    kind: str
    params: dict[str, Any]  # 필수가 아닌 값의 기본값
    required: list[str]  # 사용자가 꼭 넣어야 하는 값
    timing: Timing


def _db(deps: AppDeps) -> Any:
    if deps.db is None:
        raise VaterError("DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", status=503)
    return deps.db


def _rule_out(r: Rule) -> RuleOut:
    return RuleOut(
        id=r.id,
        watchlist_id=r.watchlist_id,
        kind=r.kind,
        params=r.params,
        timing=r.timing,
        enabled=r.enabled,
        last_state=r.last_state,
        last_fired_at=r.last_fired_at,
    )


def _event_out(e: AlertEvent) -> AlertEventOut:
    return AlertEventOut(
        id=e.id,
        rule_id=e.rule_id,
        fired_at=e.fired_at,
        value=e.value,
        message=e.message,
        market=e.market,
        code=e.code,
        name=e.name,
        kind=e.kind,
    )


def _normalized(kind: str, params: dict[str, Any]) -> dict[str, Any]:
    return parse_rule(kind, params).model_dump()


@router.get("/rules")
async def list_rules(
    watchlist_id: int | None = None,
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> list[RuleOut]:
    return [_rule_out(r) for r in RuleRepo(_db(deps)).list(watchlist_id)]


@router.post("/rules", status_code=201)
async def create_rule(body: RuleCreate, deps: AppDeps = Depends(get_deps)) -> RuleOut:  # noqa: B008
    db = _db(deps)
    WatchlistRepo(db).get(body.watchlist_id)
    params = _normalized(body.kind, body.params or {})
    timing = body.timing or default_timing(body.kind)
    rule = RuleRepo(db).create(body.watchlist_id, body.kind, params, timing, body.enabled)
    return _rule_out(rule)


@router.patch("/rules/{rid}")
async def update_rule(
    rid: int,
    body: RulePatch,
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> RuleOut:
    repo = RuleRepo(_db(deps))
    current = repo.get(rid)
    params = None if body.params is None else _normalized(current.kind, body.params)
    return _rule_out(repo.update(rid, params=params, timing=body.timing, enabled=body.enabled))


@router.delete("/rules/{rid}", status_code=204)
async def delete_rule(rid: int, deps: AppDeps = Depends(get_deps)) -> Response:  # noqa: B008
    RuleRepo(_db(deps)).delete(rid)
    return Response(status_code=204)


@router.get("/events")
async def list_events(
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> list[AlertEventOut]:
    return [_event_out(e) for e in EventRepo(_db(deps)).list(limit)]


@router.post("/pause")
async def pause_alerts(deps: AppDeps = Depends(get_deps)) -> MonitorStateOut:  # noqa: B008
    monitor = get_alerts(deps)
    monitor.pause()
    return MonitorStateOut(state=monitor.status()["state"])


@router.post("/resume")
async def resume_alerts(deps: AppDeps = Depends(get_deps)) -> MonitorStateOut:  # noqa: B008
    monitor = get_alerts(deps)
    monitor.resume()
    return MonitorStateOut(state=monitor.status()["state"])


@router.get("/status")
async def alerts_status(deps: AppDeps = Depends(get_deps)) -> MonitorStatus:  # noqa: B008
    return MonitorStatus(**get_alerts(deps).status())


@router.get("/kinds")
async def list_kinds() -> list[KindInfo]:
    out = []
    for kind, (model, timing) in KINDS.items():
        required = [n for n, f in model.model_fields.items() if f.is_required()]
        out.append(
            KindInfo(kind=kind, params=default_params(kind), required=required, timing=timing)
        )
    return out
