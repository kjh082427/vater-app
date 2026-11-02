# SPIKE: throwaway code, not part of the app
"""Ollama /api/ps를 주기적으로 읽어 모델이 VRAM에 다 올라가 있는지 기록한다 (S1).

사용: uv run python vram_probe.py --interval 5 --out runs/vram-<ts>.jsonl
size_vram < size 이면 일부가 CPU(시스템 RAM)로 넘어간 것이다.
"""

import argparse
import json
import time
from pathlib import Path

import httpx


def sample() -> list[dict[str, object]]:
    models = httpx.get("http://localhost:11434/api/ps", timeout=5).json().get("models", [])
    now = round(time.time(), 1)
    return [{"t": now, "model": m["name"], "size": m["size"], "size_vram": m["size_vram"]} for m in models]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--interval", type=float, default=5)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    out = Path(a.out)
    out.parent.mkdir(exist_ok=True)
    with out.open("a", encoding="utf-8") as f:
        while True:
            try:
                for row in sample():
                    f.write(json.dumps(row) + "\n")
                f.flush()
            except httpx.HTTPError:
                pass
            time.sleep(a.interval)


if __name__ == "__main__":
    main()
