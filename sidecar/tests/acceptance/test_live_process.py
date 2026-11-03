"""3단계 확인 G1: 실제 키로 실제 사이드카 프로세스.

실행: `uv run pytest -m kis_live tests/acceptance -q -s`

- 사용자 `.env`와 개발용 토큰 캐시를 **임시 파일로 복사**해서 쓴다
  (원본은 읽기만, 새 토큰 발급 없음).
- 백그라운드 작업(종목 마스터, 알림 감시, 브리핑 일정)을 켠 채로: 종목 검색 → 감시 종목·규칙 추가 →
  (국내 장중이면) 실시간 구독과 틱 평가 → 정상 종료. 로그에 키 원문이 없는지 확인한다.
"""

import json
import os
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest

pytestmark = pytest.mark.kis_live

ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"
CACHE = Path.home() / ".local/share/vater/dev-kis-cache.env"
TOKEN = "live-acceptance"
KST = ZoneInfo("Asia/Seoul")


def secret_values(path: Path) -> list[str]:
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            value = line.split("=", 1)[1].strip().strip('"').strip("'")
            if len(value) >= 8:
                out.append(value)
    return out


def wait_for(fn, timeout: float, what: str):  # type: ignore[no-untyped-def]
    start = time.monotonic()
    while True:
        got = fn()
        if got:
            return got
        if time.monotonic() - start > timeout:
            raise AssertionError(f"timed out waiting for {what}")
        time.sleep(1)


def test_g1_real_sidecar_with_real_kis(tmp_path: Path) -> None:
    if not ROOT_ENV.exists():
        pytest.skip("no root .env")
    env_file = tmp_path / "secrets.env"
    parts = [ROOT_ENV.read_text(encoding="utf-8")]
    if CACHE.exists():
        parts.append(CACHE.read_text(encoding="utf-8"))
    env_file.write_text("\n".join(parts) + "\n", encoding="utf-8")
    env_file.chmod(0o600)
    secrets = secret_values(env_file)

    data_dir = tmp_path / "data"
    env = {
        **os.environ,
        "VATER_TOKEN": TOKEN,
        "VATER_DATA_DIR": str(data_dir),
        "VATER_BACKGROUND_JOBS": "1",
        "VATER_SECRET_BACKEND": "envfile",
        "VATER_ENV_FILE": str(env_file),
    }
    p = subprocess.Popen(
        [sys.executable, "-m", "vater_core"], env=env, stdout=subprocess.PIPE, text=True
    )
    lines: list[str] = []
    try:
        assert p.stdout is not None
        ready = json.loads(p.stdout.readline())
        threading.Thread(target=lambda: lines.extend(p.stdout or []), daemon=True).start()
        http = httpx.Client(
            base_url=f"http://127.0.0.1:{ready['port']}",
            headers={"Authorization": f"Bearer {TOKEN}"},
            timeout=30,
        )
        assert http.patch("/settings", json={"alerts.poll_interval_sec": 10}).status_code == 200

        found = wait_for(
            lambda: http.get("/symbols/search", params={"q": "삼성전자"}).json(), 180, "master"
        )
        print(f"\nsymbol search: {found[0]}")
        wid = http.post("/watchlist", json={"market": "KR", "code": "005930"}).json()["id"]
        rule = http.post(
            "/alerts/rules",
            json={"watchlist_id": wid, "kind": "price_above", "params": {"price": 1000}},
        ).json()

        now = datetime.now(KST)
        kr_open = now.weekday() < 5 and (9, 0) <= (now.hour, now.minute) < (15, 30)
        if kr_open:
            status = wait_for(
                lambda: (s := http.get("/alerts/status").json())["realtime"] >= 1 and s,
                90,
                "realtime subscription",
            )
            state = wait_for(
                lambda: http.get("/alerts/rules").json()[0]["last_state"] is not None,
                30,
                "first evaluation",
            )
            print(f"status {status}, rule baseline set: {state}")
            assert http.get("/alerts/rules").json()[0]["last_state"] is True  # 현재가 > 1,000원
        else:
            status = http.get("/alerts/status").json()
            print(f"KR market closed ({now:%H:%M} KST): status {status}")
            assert status["state"] in ("closed", "running")
        assert rule["id"] == http.get("/alerts/rules").json()[0]["id"]
        assert http.post("/shutdown").status_code == 202
        assert p.wait(timeout=30) == 0
    finally:
        if p.poll() is None:
            p.kill()
    logs = "".join(f.read_text(encoding="utf-8") for f in (data_dir / "logs").glob("*.log*"))
    leaked = [s for s in secrets if s in logs or s in "".join(lines)]
    assert not leaked, f"{len(leaked)} secret value(s) appeared in logs/stdout"
