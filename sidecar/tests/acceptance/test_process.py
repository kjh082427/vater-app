"""3단계 확인 A·F: 실제 `python -m vater_core` 프로세스 (인터넷 없이).

Tauri가 하는 것처럼 프로세스를 띄우고 stdout `ready`에서 포트를 읽어 HTTP로만 이야기한다.
"""

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

import httpx
import pytest

from vater_core.api.app import create_app
from vater_core.api.deps import AppDeps
from vater_core.store.db import open_db

TOKEN = "acceptance-token"
SECRET = "acc-secret-value-1234567890"  # 가짜 키: 로그·응답 어디에도 나오면 안 된다


class Sidecar:
    def __init__(self, data_dir: Path, env_file: Path) -> None:
        env = {
            **os.environ,
            "VATER_TOKEN": TOKEN,
            "VATER_DATA_DIR": str(data_dir),
            "VATER_BACKGROUND_JOBS": "0",  # 인터넷(종목 마스터·한투)을 쓰지 않는다
            "VATER_SECRET_BACKEND": "envfile",
            "VATER_ENV_FILE": str(env_file),
        }
        self.data_dir = data_dir
        self.lines: list[str] = []
        self.p = subprocess.Popen(
            [sys.executable, "-m", "vater_core"], env=env, stdout=subprocess.PIPE, text=True
        )
        assert self.p.stdout is not None
        ready = json.loads(self.p.stdout.readline())
        assert ready["type"] == "ready" and ready["port"] > 0
        self.base = f"http://127.0.0.1:{ready['port']}"
        # stdout은 이벤트 통로다. 읽지 않으면 파이프가 차서 사이드카가 멈출 수 있다.
        threading.Thread(target=self._drain, daemon=True).start()
        self.http = httpx.Client(
            base_url=self.base, headers={"Authorization": f"Bearer {TOKEN}"}, timeout=10
        )

    def _drain(self) -> None:
        assert self.p.stdout is not None
        for line in self.p.stdout:
            self.lines.append(line)

    def stop(self) -> int:
        assert self.http.post("/shutdown").status_code == 202
        code = self.p.wait(timeout=10)
        self.http.close()
        return code

    def kill(self) -> None:
        if self.p.poll() is None:
            self.p.kill()
            self.p.wait(timeout=10)


def seed(data_dir: Path) -> None:
    conn = open_db(data_dir)
    conn.executemany(
        "INSERT INTO symbols (market, code, exchange, name, name_en, kind) VALUES (?,?,?,?,?,?)",
        [
            ("KR", "005930", "KOSPI", "삼성전자", None, "stock"),
            ("US", "AAPL", "NAS", "애플", "APPLE INC", "stock"),
        ],
    )
    conn.commit()
    conn.close()


@pytest.fixture
def dirs(tmp_path: Path) -> tuple[Path, Path]:
    data_dir = tmp_path / "data"
    seed(data_dir)
    return data_dir, tmp_path / "secrets.env"


def test_a1_to_a4_ready_auth_cors_and_clean_shutdown(dirs: tuple[Path, Path]) -> None:
    s = Sidecar(*dirs)
    try:
        assert s.http.get("/health").status_code == 200  # A1

        for headers in ({}, {"Authorization": "Bearer wrong"}):  # A2
            r = httpx.get(f"{s.base}/watchlist", headers=headers, timeout=10)
            assert r.status_code == 401
            assert set(r.json()) == {"code", "message", "hint"}

        def preflight(origin: str) -> httpx.Response:
            return httpx.options(
                f"{s.base}/health",
                headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
                timeout=10,
            )

        ok = preflight("tauri://localhost")  # A3
        assert ok.headers.get("access-control-allow-origin") == "tauri://localhost"
        bad = preflight("http://evil.example")
        assert bad.headers.get("access-control-allow-origin") is None

        assert s.stop() == 0  # A4
    finally:
        s.kill()


def test_a5_state_survives_a_restart(dirs: tuple[Path, Path]) -> None:
    s = Sidecar(*dirs)
    try:
        wid = s.http.post("/watchlist", json={"market": "KR", "code": "005930"}).json()["id"]
        rule = s.http.post("/alerts/rules", json={"watchlist_id": wid, "kind": "rsi"}).json()
        assert s.http.patch("/settings", json={"alerts.poll_interval_sec": 20}).status_code == 200
        assert s.stop() == 0
    finally:
        s.kill()

    again = Sidecar(*dirs)
    try:
        assert [w["code"] for w in again.http.get("/watchlist").json()] == ["005930"]
        assert again.http.get("/alerts/rules").json() == [rule]
        assert again.http.get("/settings").json()["alerts.poll_interval_sec"] == 20
        assert again.stop() == 0
    finally:
        again.kill()


def test_a6_secrets_are_write_only_and_never_logged(dirs: tuple[Path, Path]) -> None:
    data_dir, env_file = dirs
    s = Sidecar(data_dir, env_file)
    try:
        assert s.http.put("/secrets/LLM_GOOGLE_KEY", json={"value": SECRET}).status_code == 204
        listed = s.http.get("/secrets")
        assert listed.json()["LLM_GOOGLE_KEY"] is True and SECRET not in listed.text
        # 키를 쓰는 경로를 한 번 지나가게 한다(실제 호출은 하지 않는 설정 확인)
        s.http.get("/llm/check", params={"preset": "cloud"})
        assert s.stop() == 0
    finally:
        s.kill()
    logs = "".join(p.read_text(encoding="utf-8") for p in (data_dir / "logs").glob("*.log*"))
    assert logs and SECRET not in logs
    assert SECRET not in "".join(s.lines)


def test_a7_sse_stream_delivers_events(dirs: tuple[Path, Path]) -> None:
    s = Sidecar(*dirs)
    seen: list[str] = []
    connected = threading.Event()

    def listen() -> None:
        with httpx.stream("GET", f"{s.base}/events", params={"token": TOKEN}, timeout=15) as r:
            connected.set()
            for line in r.iter_lines():
                seen.append(line)
                if "paused" in line:
                    return

    t = threading.Thread(target=listen, daemon=True)
    try:
        t.start()
        assert connected.wait(10)
        time.sleep(0.3)  # 구독이 등록될 시간
        assert s.http.post("/alerts/pause").json() == {"state": "paused"}
        t.join(timeout=10)
        events = [json.loads(x[5:]) for x in seen if x.startswith("data:")]
        assert {"state": "paused", "realtime": 0, "polling": 0} in events
        assert any(x.strip() == "event: alerts.state" for x in seen)
        assert s.stop() == 0
    finally:
        s.kill()


def test_f2_api_has_no_order_routes(tmp_path: Path) -> None:
    spec: dict[str, Any] = create_app(AppDeps(token="t", dev=False, data_dir=tmp_path)).openapi()
    words = ("order", "trade", "buy", "sell", "cancel-order", "주문")
    assert not [p for p in spec["paths"] if any(w in p.lower() for w in words)]
