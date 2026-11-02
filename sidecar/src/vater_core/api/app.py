"""FastAPI 앱 팩토리."""

from fastapi import APIRouter, Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

import vater_core
from vater_core.api.auth import require_token
from vater_core.api.deps import AppDeps
from vater_core.api.errors import install_error_handlers
from vater_core.api.routes import system

TAURI_ORIGINS = ("tauri://localhost", "http://tauri.localhost", "https://tauri.localhost")
DEV_ORIGIN = "http://localhost:5173"


def allowed_origins(dev: bool) -> list[str]:
    return [*TAURI_ORIGINS, DEV_ORIGIN] if dev else list(TAURI_ORIGINS)


def create_app(deps: AppDeps) -> FastAPI:
    app = FastAPI(title="Vater sidecar", version=vater_core.__version__)
    app.state.deps = deps
    install_error_handlers(app)
    # CORS 사전 요청(OPTIONS)은 인증보다 먼저 미들웨어에서 처리된다.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins(deps.dev),
        allow_methods=["*"],
        allow_headers=["Authorization", "Content-Type"],
    )

    authed = APIRouter(dependencies=[Depends(require_token)])
    authed.include_router(system.router)
    app.include_router(authed)
    return app
