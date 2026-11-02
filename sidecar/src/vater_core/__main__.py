"""`python -m vater_core` 진입점.

127.0.0.1의 빈 포트(포트 0)에 바인딩하고, 실제 포트를 stdout `ready` 이벤트로 알린 뒤
서버를 시작한다. Tauri는 이 줄을 읽어 포트를 알아낸다 (스펙 2-1).
"""

import asyncio
import os
import socket
import sys

import uvicorn

from vater_core.api.app import create_app
from vater_core.api.deps import AppDeps
from vater_core.api.events import EventBus
from vater_core.config import load_runtime
from vater_core.secrets.store import select_secret_store
from vater_core.stdout_events import emit
from vater_core.store.db import open_db

HOST = "127.0.0.1"  # 다른 주소는 설정으로도 허용하지 않는다


def bind_free_port() -> socket.socket:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind((HOST, 0))
    sock.listen(128)
    return sock


def main() -> None:
    runtime = load_runtime()
    deps = AppDeps(
        token=runtime.token,
        dev=runtime.dev,
        data_dir=runtime.data_dir,
        db=open_db(runtime.data_dir),
        secrets=select_secret_store(os.environ, sys.platform),
        events=EventBus(),
    )
    app = create_app(deps)

    sock = bind_free_port()
    # log_config=None: uvicorn 로그가 stdout(이벤트 통로)에 섞이지 않게 한다.
    server = uvicorn.Server(uvicorn.Config(app, log_config=None, access_log=False))

    def request_exit() -> None:
        server.should_exit = True

    deps.shutdown = request_exit
    emit("ready", port=sock.getsockname()[1])
    asyncio.run(server.serve(sockets=[sock]))


if __name__ == "__main__":
    main()
