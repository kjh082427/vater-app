"""홈 대시보드 배치 문서 (대시보드 설계 4장).

settings 테이블의 별도 키 `ui.dashboards`에 JSON 그대로 둔다. 일반 설정(`SETTING_DEFS`)과
검증 경로가 다르고 `GET /settings`에도 나오지 않는다. 여기서는 **모양만** 검사한다.
내용 종류(`type`)와 옵션의 뜻은 화면이 검사한다.
새 내용 종류를 더할 때 사이드카를 바꾸지 않기 위해서다.
"""

import json
import sqlite3
from typing import Any

from vater_core.api.errors import VaterError

KEY = "ui.dashboards"
MAX_BYTES = 64 * 1024
MAX_DASHBOARDS = 8
MAX_PANELS = 6
MAX_KPI_ITEMS = 5
MAX_NAME = 20
MAX_ID = 40
MAX_DEPTH = 32  # root·options 안의 중첩 깊이(직렬화가 깨지는 깊이보다 한참 아래)
EMPTY: dict[str, Any] = {"version": 1, "dashboards": []}


def _bad(why: str) -> VaterError:
    return VaterError(
        "DASHBOARD_INVALID",
        "화면 배치를 저장하지 못했습니다.",
        f"확인할 항목: {why}",
        status=422,
    )


def _short_str(v: Any, limit: int) -> bool:
    return isinstance(v, str) and 1 <= len(v) <= limit


def _depth(v: Any, limit: int) -> bool:
    """중첩 깊이가 limit 이하인지. 재귀 대신 스택으로 센다."""
    stack: list[tuple[Any, int]] = [(v, 1)]
    while stack:
        cur, d = stack.pop()
        if d > limit:
            return False
        if isinstance(cur, dict):
            stack.extend((x, d + 1) for x in cur.values())
        elif isinstance(cur, list):
            stack.extend((x, d + 1) for x in cur)
    return True


def _check_board(i: int, b: Any) -> None:
    where = f"{i + 1}번째 화면"
    if not isinstance(b, dict):
        raise _bad(f"{where}이 객체가 아닙니다")
    if not _short_str(b.get("id"), MAX_ID):
        raise _bad(f"{where}의 id는 1~{MAX_ID}자 문자열이어야 합니다")
    name = b.get("name")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= MAX_NAME:
        raise _bad(f"{where}의 이름은 1~{MAX_NAME}자여야 합니다")
    kpi = b.get("kpi")
    if (
        not isinstance(kpi, dict)
        or not isinstance(kpi.get("enabled"), bool)
        or not isinstance(kpi.get("items"), list)
        or len(kpi["items"]) > MAX_KPI_ITEMS
        or not all(_short_str(x, MAX_ID) for x in kpi["items"])
    ):
        raise _bad(f"{where}의 숫자 줄은 켜기 여부와 숫자 {MAX_KPI_ITEMS}개 이하여야 합니다")
    layout = b.get("layout")
    if (
        not isinstance(layout, dict)
        or not _short_str(layout.get("template"), MAX_ID)
        or not isinstance(layout.get("root"), dict)
    ):
        raise _bad(f"{where}의 배치(template, root)가 올바르지 않습니다")
    if not _depth(layout["root"], MAX_DEPTH):
        raise _bad(f"{where}의 배치가 너무 깊게 중첩되어 있습니다(최대 {MAX_DEPTH}단계)")
    panels = b.get("panels")
    if not isinstance(panels, list) or not 1 <= len(panels) <= MAX_PANELS:
        raise _bad(f"{where}의 칸은 1~{MAX_PANELS}개여야 합니다")
    for p in panels:
        if (
            not isinstance(p, dict)
            or not _short_str(p.get("type"), MAX_ID)
            or not isinstance(p.get("options"), dict)
        ):
            raise _bad(f"{where}의 칸 내용(type, options)이 올바르지 않습니다")
        if not _depth(p["options"], MAX_DEPTH):
            raise _bad(f"{where}의 칸 옵션이 너무 깊게 중첩되어 있습니다(최대 {MAX_DEPTH}단계)")


def validate_dashboards(doc: Any) -> None:
    """틀리면 `DASHBOARD_INVALID`(422). 저장할 문서(PUT)에만 쓴다."""
    if not isinstance(doc, dict):
        raise _bad("문서는 JSON 객체여야 합니다")
    if doc.get("version") != 1:
        raise _bad("version은 1이어야 합니다")
    boards = doc.get("dashboards")
    if not isinstance(boards, list) or not 1 <= len(boards) <= MAX_DASHBOARDS:
        raise _bad(f"화면은 1~{MAX_DASHBOARDS}장이어야 합니다")
    for i, b in enumerate(boards):
        _check_board(i, b)


def parse_body(raw: bytes) -> Any:
    """요청 본문 → JSON. 크기 초과·JSON 아님은 `DASHBOARD_INVALID`."""
    if len(raw) > MAX_BYTES:
        raise _bad(f"문서가 너무 큽니다({len(raw) // 1024}KB, 최대 {MAX_BYTES // 1024}KB)")
    try:
        return json.loads(raw)
    except (ValueError, UnicodeDecodeError, RecursionError) as e:
        raise _bad("JSON 형식이 아닙니다") from e


class DashboardRepo:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def get(self) -> dict[str, Any]:
        row = self._conn.execute("SELECT value FROM settings WHERE key = ?", (KEY,)).fetchone()
        if row is None:
            return dict(EMPTY, dashboards=[])
        doc: dict[str, Any] = json.loads(row[0])
        return doc

    def put(self, doc: Any) -> dict[str, Any]:
        """검사한 뒤에만 저장한다. 틀리면 기존 문서는 그대로다."""
        validate_dashboards(doc)
        text = json.dumps(doc, ensure_ascii=False)
        if len(text.encode()) > MAX_BYTES:
            raise _bad(f"문서가 너무 큽니다(최대 {MAX_BYTES // 1024}KB)")
        with self._conn:
            self._conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (KEY, text),
            )
        stored: dict[str, Any] = doc
        return stored
