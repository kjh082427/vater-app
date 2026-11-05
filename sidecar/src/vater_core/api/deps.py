"""앱 전역 의존성. `create_app(deps)`로 주입하고 라우트에서는 `get_deps`로 꺼낸다."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

import httpx
from fastapi import Request

from vater_core.api.events import EventBus
from vater_core.secrets.store import SecretStore

if (
    TYPE_CHECKING
):  # 순환 import 방지 (kis.services, llm.state, analysis.queue가 이 모듈을 import한다)
    from vater_core.alerts.monitor import AlertMonitor
    from vater_core.analysis.queue import AnalysisQueue
    from vater_core.briefing.service import BriefingService
    from vater_core.holdings.service import HoldingsService
    from vater_core.kis.services import KisServices
    from vater_core.llm.state import LlmState
    from vater_core.market.indices import IndexBoard
    from vater_core.portfolio.daily import DailyRecorder
    from vater_core.portfolio.service import PortfolioService


def _noop() -> None:
    return None


@dataclass
class AppDeps:
    token: str = field(repr=False)  # 사이드카 인증 토큰은 repr에 남기지 않는다
    dev: bool
    data_dir: Path
    db: sqlite3.Connection | None = None
    secrets: SecretStore | None = None
    events: EventBus | None = None
    shutdown: Callable[[], None] = field(default=_noop)
    http: httpx.AsyncClient | None = None  # 외부 API용 공용 클라이언트 (없으면 처음 쓸 때 만든다)
    kis: KisServices | None = None  # kis.services.get_kis()가 채우고 관리한다
    llm: LlmState | None = None  # llm.state.get_llm()이 처음 부를 때 만든다
    analysis: AnalysisQueue | None = None  # analysis.queue.get_analysis()가 만든다
    alerts: AlertMonitor | None = None  # alerts.monitor.get_alerts()가 만든다
    briefing: BriefingService | None = None  # briefing.service.get_briefing()이 만든다
    holdings: HoldingsService | None = None  # holdings.service.get_holdings()가 만든다
    portfolio: PortfolioService | None = None  # portfolio.service.get_portfolio()가 만든다
    daily: DailyRecorder | None = None  # portfolio.daily.get_daily()가 만든다
    indices: IndexBoard | None = None  # api.routes.market이 처음 부를 때 만든다


def get_deps(request: Request) -> AppDeps:
    deps: AppDeps = request.app.state.deps
    return deps
