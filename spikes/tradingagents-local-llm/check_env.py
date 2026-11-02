# SPIKE: throwaway code, not part of the app
"""실험 환경 점검: Ollama 연결, 모델, TradingAgents import, DEFAULT_CONFIG 키 목록."""

import json
import sys

import httpx

OLLAMA = "http://localhost:11434"
SECRET_HINTS = ("key", "token", "secret", "password")


def mask(name: str, value: object) -> object:
    return "***" if any(h in name.lower() for h in SECRET_HINTS) and value else value


def main() -> int:
    ok = True
    try:
        print("① Ollama 버전:", httpx.get(f"{OLLAMA}/api/version", timeout=5).json()["version"])
        tags = [m["name"] for m in httpx.get(f"{OLLAMA}/api/tags", timeout=5).json()["models"]]
        print("② 모델:", ", ".join(sorted(tags)))
        for need in ("qwen3.5:4b", "qwen3.5:9b"):
            if need not in tags:
                print(f"   ✗ {need} 없음")
                ok = False
    except Exception as e:  # noqa: BLE001
        print("① Ollama 연결 실패:", e)
        ok = False

    try:
        import tradingagents  # noqa: F401
        from tradingagents.default_config import DEFAULT_CONFIG

        print("③ tradingagents import 성공:", getattr(tradingagents, "__version__", "(버전 속성 없음)"))
        print("④ DEFAULT_CONFIG:")
        for k in sorted(DEFAULT_CONFIG):
            print(f"   {k} = {json.dumps(mask(k, DEFAULT_CONFIG[k]), ensure_ascii=False, default=str)}")
    except Exception as e:  # noqa: BLE001
        print("③ tradingagents import 실패:", repr(e))
        ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
