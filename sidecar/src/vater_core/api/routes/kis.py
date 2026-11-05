"""한국투자증권 관련 API: 종목 검색, 연결 테스트."""

from datetime import timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from vater_core.alerts.monitor import get_alerts
from vater_core.alerts.store import BarRepo, WatchItem
from vater_core.analysis.symbols import resolve_target
from vater_core.api.deps import AppDeps, get_deps
from vater_core.api.errors import VaterError
from vater_core.kis.master import search_symbols
from vater_core.kis.quotes import domestic_price
from vater_core.kis.services import require_kis

router = APIRouter(tags=["kis"])
SAMPLE_CODE = "005930"  # 연결 테스트용 (삼성전자)


class KisSample(BaseModel):
    code: str
    price: float


class KisTestResult(BaseModel):
    ok: bool
    server: str
    sample: KisSample


@router.post("/settings/kis/test")
async def kis_connection_test(deps: AppDeps = Depends(get_deps)) -> KisTestResult:  # noqa: B008
    """첫 실행 마법사의 '연결 테스트': 토큰을 받고 삼성전자 현재가를 조회해 본다."""
    services = require_kis(deps)
    quote = await domestic_price(services.client, SAMPLE_CODE)
    return KisTestResult(
        ok=True, server=services.server.value, sample=KisSample(code=SAMPLE_CODE, price=quote.price)
    )


class SymbolOut(BaseModel):
    market: str
    code: str
    exchange: str
    name: str
    name_en: str | None
    kind: str


@router.get("/symbols/search")
async def symbols_search(
    q: Annotated[str, Query(min_length=1, max_length=50, description="종목명, 영문명 또는 코드")],
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> list[SymbolOut]:
    if deps.db is None:
        raise VaterError("DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", status=503)
    return [SymbolOut(**s.__dict__) for s in search_symbols(deps.db, q)]


class BarOut(BaseModel):
    day: str
    close: float


RANGE_DAYS = {"1m": 31, "3m": 92, "1y": 366}


@router.get("/symbols/{market}/{code}/bars")
async def symbol_bars(
    market: Literal["KR", "US"],
    code: str,
    range: Annotated[Literal["1m", "3m", "1y"], Query()] = "1m",
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> list[BarOut]:
    """종목 일봉 종가(오래된 것부터). 한투 키가 없거나 받지 못하면 가진 만큼만 준다."""
    if deps.db is None:
        raise VaterError("DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", status=503)
    target = resolve_target(deps.db, market, code.upper() if market == "US" else code)
    item = WatchItem(0, target.market, target.code, target.exchange, target.name, "")
    await get_alerts(deps).ensure_bars(item)
    repo = BarRepo(deps.db)
    last = repo.last_day(item.market, item.code)
    if last is None:
        return []
    rows = repo.closes_since(item.market, item.code, last - timedelta(days=RANGE_DAYS[range]))
    return [BarOut(day=d.isoformat(), close=c) for d, c in rows]
