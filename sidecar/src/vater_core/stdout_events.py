"""stdout은 Tauri 셸과의 이벤트 전용 통로다. 한 줄 = JSON 이벤트 1개 (스펙 2-2).

로그는 절대 stdout에 쓰지 않는다. Rust 쪽은 줄 단위로 JSON을 읽는다.
"""

import json
import sys
import threading
from typing import Any, Literal

EventType = Literal["ready", "notify", "log"]
_lock = threading.Lock()


def emit(event_type: EventType, **payload: Any) -> None:
    line = json.dumps({"type": event_type, **payload}, ensure_ascii=False)
    with _lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def notify(title: str, body: str, route: str | None = None) -> None:
    """Windows 알림을 띄우도록 Tauri에 요청한다. `route`는 알림을 눌렀을 때 열 화면."""
    emit("notify", title=title, body=body, route=route)
