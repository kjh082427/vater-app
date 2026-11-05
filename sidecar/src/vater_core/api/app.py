"""FastAPI 앱 팩토리."""

from fastapi import APIRouter, Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

import vater_core
from vater_core.api.auth import require_token
from vater_core.api.deps import AppDeps
from vater_core.api.errors import ERROR_RESPONSES, install_error_handlers
from vater_core.api.routes import (
    alerts,
    analyses,
    briefings,
    events,
    holdings,
    kis,
    llm,
    market,
    secrets,
    settings,
    system,
    ui,
    watchlist,
)

TAURI_ORIGINS = ("tauri://localhost", "http://tauri.localhost", "https://tauri.localhost")
DEV_ORIGIN = "http://localhost:5173"


def allowed_origins(dev: bool) -> list[str]:
    return [*TAURI_ORIGINS, DEV_ORIGIN] if dev else list(TAURI_ORIGINS)


def create_app(deps: AppDeps) -> FastAPI:
    # 문서 페이지는 개발 모드에서만 연다. 설치된 앱에서는 토큰 없이 열리면 안 된다.
    app = FastAPI(
        title="Vater sidecar",
        version=vater_core.__version__,
        docs_url="/docs" if deps.dev else None,
        redoc_url=None,
        openapi_url="/openapi.json" if deps.dev else None,
    )
    app.state.deps = deps
    install_error_handlers(app)
    # CORS 사전 요청(OPTIONS)은 인증보다 먼저 미들웨어에서 처리된다.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins(deps.dev),
        allow_methods=["*"],
        allow_headers=["Authorization", "Content-Type"],
    )

    authed = APIRouter(dependencies=[Depends(require_token)], responses=ERROR_RESPONSES)
    authed.include_router(system.router)
    authed.include_router(settings.router)
    authed.include_router(secrets.router)
    authed.include_router(kis.router)
    authed.include_router(llm.router)
    authed.include_router(analyses.router)
    authed.include_router(watchlist.router)
    authed.include_router(alerts.router)
    authed.include_router(briefings.router)
    authed.include_router(ui.router)
    authed.include_router(market.router)
    authed.include_router(holdings.router)
    app.include_router(authed)
    # SSE는 브라우저 EventSource가 헤더를 못 붙이므로 쿼리 토큰도 받는 별도 인증을 쓴다.
    app.include_router(events.router)
    return app
