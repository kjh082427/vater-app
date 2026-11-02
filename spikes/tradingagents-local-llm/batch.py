# SPIKE: throwaway code, not part of the app
"""여러 run_spike 실행을 순서대로 돌리면서 vram_probe를 함께 띄운다 (GPU를 겹쳐 쓰지 않게).

사용: uv run python batch.py local-9b:AAPL local-4b:005930.KS local-9b:005930.KS [--date 2026-11-02]
각 항목 전에 해당 모델 예열 호출 1회(측정 제외).
"""

import argparse
import subprocess
import sys
import time
from pathlib import Path

import httpx

from presets import LOCAL_MODELS

HERE = Path(__file__).resolve().parent


def warm_up(model: str) -> None:
    httpx.post("http://localhost:11434/api/generate",
               json={"model": model, "prompt": "hi", "stream": False}, timeout=600)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("jobs", nargs="+", help="preset:ticker")
    ap.add_argument("--date", default="2026-11-02")
    ap.add_argument("--timeout-min", type=int, default=60)
    a = ap.parse_args()
    stamp = time.strftime("%Y%m%d-%H%M%S")
    probe = subprocess.Popen([sys.executable, str(HERE / "vram_probe.py"), "--interval", "5",
                              "--out", str(HERE / "runs" / f"vram-{stamp}.jsonl")])
    failures = 0
    try:
        for job in a.jobs:
            preset, ticker = job.split(":", 1)
            if preset in LOCAL_MODELS:
                warm_up(LOCAL_MODELS[preset])
            print(f"=== {preset} × {ticker} 시작 {time.strftime('%H:%M:%S')}", flush=True)
            r = subprocess.run([sys.executable, "-W", "ignore", str(HERE / "run_spike.py"), "--ticker", ticker,
                                "--preset", preset, "--date", a.date, "--timeout-min", str(a.timeout_min)],
                               cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
            print(r.stdout.strip().splitlines()[-2:] if r.stdout.strip() else "(출력 없음)", flush=True)
            failures += r.returncode != 0
    finally:
        probe.terminate()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
