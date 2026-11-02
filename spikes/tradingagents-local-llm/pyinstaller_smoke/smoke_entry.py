# SPIKE: throwaway code, not part of the app
"""S7: PyInstaller로 포장한 실행 파일에서 TradingAgents가 import되고 그래프가 만들어지는지 확인한다.

LLM 호출은 하지 않는다. 성공하면 'SMOKE OK <노드 수> <초>'를 출력하고 0으로 끝난다.
빌드: uv run pyinstaller --noconfirm --onedir --name smoke --paths . pyinstaller_smoke/smoke_entry.py
"""

import sys
import time

t0 = time.monotonic()


def main() -> int:
    from presets import build_config
    from tradingagents.graph.trading_graph import TradingAgentsGraph

    ta = TradingAgentsGraph(config=build_config("local-4b"))
    nodes = len(ta.graph.get_graph().nodes)
    print(f"SMOKE OK {nodes} {time.monotonic() - t0:.1f}s", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
