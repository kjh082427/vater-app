"""종목 마스터: 한투가 공개하는 마스터 파일을 받아 로컬 검색 색인(symbols 테이블)을 만든다.

파일 형식 (cp949, 줄바꿈 LF):
- 국내(kospi_code.mst / kosdaq_code.mst): 줄 끝의 고정 길이 부분(코스피 227자, 코스닥 221자)을 떼고
  앞부분이 `[0:9]` 단축코드, `[9:21]` 표준코드, `[21:]` 한글명. 고정부 앞 2자리가 그룹코드다.
  (공식 파서는 줄바꿈이 붙은 줄로 228/222자를 자르므로 1자 차이가 난다 — 실제 파일로 확인함.)
- 해외(nasmst.cod 등): 탭 구분. `[4]` 종목, `[6]` 한글명, `[7]` 영문명, `[8]` 유형(2 주식, 3 ETF).
"""

import asyncio
import io
import logging
import sqlite3
import zipfile
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date
from typing import Literal

import httpx

from vater_core.kis.models import Market, UsExchange

logger = logging.getLogger(__name__)

MASTER_URL = "https://new.real.download.dws.co.kr/common/master/"
CHECK_INTERVAL = 6 * 3600  # 몇 시간마다 날짜가 바뀌었는지 확인 (실제 다운로드는 하루 1번)
RETRY_AFTER_FAILURE = 600  # 실패하면 10분 뒤 다시
DomesticExchange = Literal["KOSPI", "KOSDAQ"]
_SUFFIX: dict[DomesticExchange, int] = {"KOSPI": 227, "KOSDAQ": 221}
# 그룹코드 → 종류. 그 밖(ETN, DR, 수익증권 등)은 검색 대상에서 뺀다.
_DOMESTIC_KIND = {"ST": "stock", "RT": "stock", "FS": "stock", "EF": "etf"}
_OVERSEAS_KIND = {"2": "stock", "3": "etf"}
_FILES: list[tuple[str, str, str]] = [
    ("kospi_code.mst.zip", "KR", "KOSPI"),
    ("kosdaq_code.mst.zip", "KR", "KOSDAQ"),
    ("nasmst.cod.zip", "US", "NAS"),
    ("nysmst.cod.zip", "US", "NYS"),
    ("amsmst.cod.zip", "US", "AMS"),
]


@dataclass(frozen=True)
class Symbol:
    market: Market
    code: str
    exchange: str
    name: str
    name_en: str | None
    kind: str


def parse_domestic(text: str, exchange: DomesticExchange) -> list[Symbol]:
    suffix = _SUFFIX[exchange]
    out = []
    for line in text.split("\n"):
        row = line.rstrip("\r")
        if len(row) <= suffix:
            continue
        head, tail = row[:-suffix], row[-suffix:]
        kind = _DOMESTIC_KIND.get(tail[:2])
        code, name = head[0:9].rstrip(), head[21:].strip()
        if kind and code and name:
            out.append(Symbol("KR", code, exchange, name, None, kind))
    return out


def parse_overseas(text: str, exchange: UsExchange) -> list[Symbol]:
    out = []
    for line in text.split("\n"):
        cols = line.rstrip("\r").split("\t")
        if len(cols) < 9:
            continue
        kind = _OVERSEAS_KIND.get(cols[8].strip())
        code = cols[4].strip()
        if kind and code:
            name_en = cols[7].strip() or None
            out.append(Symbol("US", code, exchange, cols[6].strip() or code, name_en, kind))
    return out


def _unzip_text(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return z.read(z.namelist()[0]).decode("cp949", errors="replace")


async def refresh_master(http: httpx.AsyncClient, conn: sqlite3.Connection, today: date) -> int:
    """하루 1번 마스터를 통째로 바꾼다.

    오늘 이미 했으면 0을 돌려준다. 다운로드가 하나라도 실패하면 기존 데이터를 그대로 둔다.
    """
    row = conn.execute("SELECT value FROM symbols_meta WHERE key = 'refreshed_on'").fetchone()
    if row and row[0] == today.isoformat():
        return 0
    symbols: list[Symbol] = []
    for fname, market, exchange in _FILES:  # 전부 받은 뒤에만 DB를 건드린다
        r = await http.get(MASTER_URL + fname, timeout=60)
        r.raise_for_status()
        text = _unzip_text(r.content)
        if market == "KR":
            symbols += parse_domestic(text, exchange)  # type: ignore[arg-type]
        else:
            symbols += parse_overseas(text, exchange)  # type: ignore[arg-type]
    with conn:
        conn.execute("DELETE FROM symbols")
        conn.executemany(
            "INSERT OR REPLACE INTO symbols (market, code, exchange, name, name_en, kind) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [(s.market, s.code, s.exchange, s.name, s.name_en, s.kind) for s in symbols],
        )
        conn.execute(
            "INSERT INTO symbols_meta (key, value) VALUES ('refreshed_on', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (today.isoformat(),),
        )
    logger.info("symbol master refreshed: %d symbols", len(symbols))
    return len(symbols)


def _like(q: str) -> str:
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def search_symbols(conn: sqlite3.Connection, q: str, limit: int = 20) -> list[Symbol]:
    """① 코드 정확 일치 → ② 이름·영문명 앞부분 → ③ 포함. 대소문자 무시, 주식이 ETF보다 앞."""
    q = q.strip()
    if not q:
        return []
    rows = conn.execute(
        "SELECT market, code, exchange, name, name_en, kind FROM symbols "
        "WHERE code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR name_en LIKE ? ESCAPE '\\' "
        "LIMIT 500",
        (_like(q), _like(q), _like(q)),
    ).fetchall()
    ql = q.lower()

    def rank(r: tuple[str, ...]) -> tuple[int, int, int]:
        code, name, name_en = r[1].lower(), r[3].lower(), (r[4] or "").lower()
        tier = 0 if code == ql else 1 if name.startswith(ql) or name_en.startswith(ql) else 2
        return tier, 0 if r[5] == "stock" else 1, len(r[3])

    rows.sort(key=rank)
    return [Symbol(r[0], r[1], r[2], r[3], r[4], r[5]) for r in rows[:limit]]


async def keep_master_fresh(
    http: httpx.AsyncClient,
    conn: sqlite3.Connection,
    today: Callable[[], date],
    refresh: Callable[
        [httpx.AsyncClient, sqlite3.Connection, date], Awaitable[int]
    ] = refresh_master,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> None:
    """앱이 켜져 있는 동안 종목 마스터를 최신으로 유지한다.

    첫 실행에도 검색이 되게 시작하자마자 받는다.

    이벤트 루프에서 돌기 때문에 DB 쓰기도 루프 스레드에서 일어난다(core/foundation 리뷰 규칙).
    """
    while True:
        try:
            await refresh(http, conn, today())
            delay: float = CHECK_INTERVAL
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("symbol master refresh failed; retrying in %ss", RETRY_AFTER_FAILURE)
            delay = RETRY_AFTER_FAILURE
        await sleep(delay)
