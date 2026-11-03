"""SidecarManager 테스트용 가짜 사이드카 (표준 라이브러리만 사용).

실제 사이드카와 같은 계약을 흉내 낸다: VATER_TOKEN 필수, 127.0.0.1의 빈 포트에 HTTP 서버,
stdout에 UTF-8 JSON 한 줄 이벤트, `GET /health`와 `POST /shutdown`(202)은 Bearer 토큰 인증.

사용법: python fake_sidecar.py <mode>
  ready            ready 후 서버. /shutdown 이면 종료 코드 0으로 끝난다
  notify           ready 후 notify 한 줄을 보내고 서버
  garbage          JSON 아님·깨진 UTF-8·모르는 type 줄을 먼저 보내고 ready 후 서버
  ignore-shutdown  ready 후 서버. /shutdown에 202로 답하지만 끝나지 않는다
  crash            바로 종료 코드 3으로 끝난다
  silent           ready를 보내지 않고 계속 살아 있다
  crash-once       첫 실행은 crash, 그다음부터 ready
  ready-then-crash ready를 보내고 0.3초 뒤 종료 코드 3으로 끝난다(첫 실행만, 그다음부터 ready)

FAKE_RUNS 환경변수에 파일 경로가 있으면 실행할 때마다 자기 PID를 한 줄 추가한다.
토큰 값은 어디에도 출력하지 않는다.
"""

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ["VATER_TOKEN"]


def previous_runs() -> int:
    path = os.environ.get("FAKE_RUNS")
    if not path:
        return 0
    count = 0
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            count = sum(1 for line in f if line.strip())
    with open(path, "a", encoding="utf-8") as f:
        f.write(f"{os.getpid()}\n")
    return count


def emit_raw(data: bytes) -> None:
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def emit(event_type: str, **payload: object) -> None:
    line = json.dumps({"type": event_type, **payload}, ensure_ascii=False) + "\n"
    emit_raw(line.encode("utf-8"))


def serve(honor_shutdown: bool, after_ready=None) -> None:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args: object) -> None:  # stdout·stderr를 더럽히지 않는다
            pass

        def _authorized(self) -> bool:
            if self.headers.get("Authorization") == f"Bearer {TOKEN}":
                return True
            self._reply(401, {"error": "unauthorized"})
            return False

        def _reply(self, status: int, body: dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:
            if self.path == "/health" and self._authorized():
                self._reply(200, {"status": "ok"})

        def do_POST(self) -> None:
            if self.path == "/shutdown" and self._authorized():
                self._reply(202, {"status": "shutting_down"})
                if honor_shutdown:
                    threading.Thread(target=server.shutdown, daemon=True).start()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    emit("ready", port=server.server_address[1])
    if after_ready is not None:
        after_ready()
    server.serve_forever(poll_interval=0.05)  # 기본 0.5초면 종료가 테스트의 유예 시간(0.5초)을 넘는다
    server.server_close()
    sys.exit(0)


def main() -> None:
    mode = sys.argv[1]
    runs = previous_runs()
    if mode == "crash" or (mode == "crash-once" and runs == 0):
        sys.exit(3)
    if mode == "silent":
        while True:
            time.sleep(60)
    if mode == "garbage":
        emit_raw(b"this is not json\n")
        emit_raw(b'{"type": "notify", "title": "\xff\xfe", "body": "broken"}\n')
        emit("progress", pct=40)
        emit_raw(b"\n\r\n")
    if mode == "ready-then-crash" and runs == 0:

        def crash_soon() -> None:
            def later() -> None:
                time.sleep(0.3)
                os._exit(3)

            threading.Thread(target=later, daemon=True).start()

        serve(honor_shutdown=True, after_ready=crash_soon)
    if mode == "notify":

        def send_notify() -> None:
            emit("notify", title="삼성전자 RSI 30 이하", body="RSI가 28.4입니다.", route="/alerts")

        serve(honor_shutdown=True, after_ready=send_notify)
    serve(honor_shutdown=(mode != "ignore-shutdown"))


if __name__ == "__main__":
    main()
