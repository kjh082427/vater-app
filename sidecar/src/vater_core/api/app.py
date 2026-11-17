"""FastAPI 앱 팩토리."""

from fastapi import APIRouter, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

import vater_core
from vater_core.api.auth import require_token
from vater_core.api.deps import AppDeps
from vater_core.api.errors import ERROR_RESPONSES, error_body, install_error_handlers
from vater_core.api.routes import (
    alerts,
    analyses,
    briefings,
    categories,
    events,
    holdings,
    kis,
    llm,
    market,
    portfolio,
    secrets,
    settings,
    system,
    ui,
    watchlist,
)

TAURI_ORIGINS = ("tauri://localhost", "http://tauri.localhost", "https://tauri.localhost")
DEV_ORIGIN = "http://localhost:5173"

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost"})
# 가장 큰 정상 요청은 CSV 가져오기(2MB)다. 그보다 넉넉히 두되 메모리를 지킨다.
MAX_BODY_BYTES = 4 * 1024 * 1024


class RequestGuard:
    """라우팅·인증보다 먼저: Host가 루프백이 아니면 거절하고(DNS 리바인딩), 큰 본문을 끊는다."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope["headers"])
        host = headers.get(b"host", b"").decode("latin-1").rsplit(":", 1)[0].lower()
        if host not in LOOPBACK_HOSTS:
            body = error_body("HOST_INVALID", "허용되지 않은 요청입니다.")
            await JSONResponse(body, status_code=400)(scope, receive, send)
            return
        length = headers.get(b"content-length", b"0")
        if not length.isdigit() or int(length) > MAX_BODY_BYTES:
            await JSONResponse(_too_large(), status_code=413)(scope, receive, send)
            return
        received = 0

        async def capped() -> Message:
            nonlocal received
            message = await receive()
            received += len(message.get("body", b""))
            if received > MAX_BODY_BYTES:  # Content-Length 없이 흘려보낸 본문
                raise HTTPException(413)
            return message

        await self.app(scope, capped, send)


def _too_large() -> dict[str, str | None]:
    return error_body("BODY_TOO_LARGE", "요청 본문이 너무 큽니다.")


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

    app.add_middleware(RequestGuard)  # 마지막에 넣은 것이 가장 바깥에서 먼저 돈다

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
    authed.include_router(categories.router)
    authed.include_router(holdings.router)
    authed.include_router(portfolio.router)
    app.include_router(authed)
    # SSE는 브라우저 EventSource가 헤더를 못 붙이므로 쿼리 토큰도 받는 별도 인증을 쓴다.
    app.include_router(events.router)
    return app
