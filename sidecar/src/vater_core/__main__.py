"""`python -m vater_core` 진입점.

127.0.0.1의 빈 포트(포트 0)에 바인딩하고, 실제 포트를 stdout `ready` 이벤트로 알린 뒤
서버를 시작한다. Tauri는 이 줄을 읽어 포트를 알아낸다 (스펙 2-1).
"""

import asyncio
import logging
import os
import socket
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
import uvicorn

from vater_core.api.app import create_app
from vater_core.api.deps import AppDeps
from vater_core.api.events import EventBus
from vater_core.config import load_runtime
from vater_core.kis.master import keep_master_fresh
from vater_core.logging_setup import setup_logging
from vater_core.secrets.store import select_secret_store
from vater_core.stdout_events import emit
from vater_core.store.db import open_db

KST = ZoneInfo("Asia/Seoul")
HOST = "127.0.0.1"  # 다른 주소는 설정으로도 허용하지 않는다


def bind_free_port() -> socket.socket:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind((HOST, 0))
    sock.listen(128)
    return sock


def main() -> None:
    runtime = load_runtime()
    secrets = select_secret_store(os.environ, sys.platform)
    setup_logging(runtime.data_dir, secrets.known_values)  # 가장 먼저: 이후 모든 로그를 마스킹
    deps = AppDeps(
        token=runtime.token,
        dev=runtime.dev,
        data_dir=runtime.data_dir,
        db=open_db(runtime.data_dir),
        secrets=secrets,
        events=EventBus(),
        http=httpx.AsyncClient(timeout=15),
    )
    app = create_app(deps)
    logging.getLogger(__name__).info("vater-core started (dev=%s)", runtime.dev)

    sock = bind_free_port()
    # log_config=None: uvicorn 로그가 stdout(이벤트 통로)에 섞이지 않게 한다.
    server = uvicorn.Server(uvicorn.Config(app, log_config=None, access_log=False))

    def request_exit() -> None:
        server.should_exit = True

    http, db = deps.http, deps.db
    if http is None or db is None:
        raise RuntimeError("http client and db must be ready before serving")

    async def serve() -> None:
        background: list[asyncio.Task[None]] = []
        if os.environ.get("VATER_BACKGROUND_JOBS", "1") != "0":
            # 첫 실행에도 종목 검색이 되도록 시작하자마자 마스터를 받고, 이후 주기적으로 확인한다.
            today = lambda: datetime.now(KST).date()  # noqa: E731
            background.append(asyncio.create_task(keep_master_fresh(http, db, today=today)))
        try:
            await server.serve(sockets=[sock])
        finally:
            for task in background:
                task.cancel()
            await http.aclose()  # 외부 API 연결을 정리하고 끝낸다

    deps.shutdown = request_exit
    emit("ready", port=sock.getsockname()[1])
    asyncio.run(serve())


if __name__ == "__main__":
    main()
