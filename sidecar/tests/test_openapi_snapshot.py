"""API 계약 스냅샷. UI의 TypeScript 타입이 이 명세에서 생성된다 (스펙 2-2).

API를 의도적으로 바꿨다면: `UPDATE_SNAPSHOTS=1 uv run pytest tests/test_openapi_snapshot.py`
"""

import json
import os
from pathlib import Path

from vater_core.api.app import create_app
from vater_core.api.deps import AppDeps

SNAPSHOT = Path(__file__).parent / "snapshots" / "openapi.json"


def test_openapi_snapshot(deps: AppDeps) -> None:
    current = create_app(deps).openapi()
    if os.environ.get("UPDATE_SNAPSHOTS") == "1":
        SNAPSHOT.parent.mkdir(exist_ok=True)
        text = json.dumps(current, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        SNAPSHOT.write_text(text, encoding="utf-8")
    assert json.loads(SNAPSHOT.read_text(encoding="utf-8")) == current
