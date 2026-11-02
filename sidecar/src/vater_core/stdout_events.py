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
    """항상 UTF-8 바이트로 쓴다. Windows 파이프의 기본 인코딩(cp949 등)을 따르지 않는다.

    Rust 쪽은 줄을 UTF-8로 읽는다 (리뷰 Important #2).
    """
    data = (json.dumps({"type": event_type, **payload}, ensure_ascii=False) + "\n").encode("utf-8")
    with _lock:
        out = sys.stdout
        out.flush()  # 텍스트 계층에 남은 내용이 있으면 먼저 내보낸다
        buffer = getattr(out, "buffer", None)
        if buffer is not None:
            buffer.write(data)
            buffer.flush()
        else:  # 바이트 버퍼가 없는 대체 stdout (드묾)
            out.write(data.decode("utf-8"))
            out.flush()


def notify(title: str, body: str, route: str | None = None) -> None:
    """Windows 알림을 띄우도록 Tauri에 요청한다. `route`는 알림을 눌렀을 때 열 화면."""
    emit("notify", title=title, body=body, route=route)
