import io
import zipfile
from datetime import date
from pathlib import Path

import httpx
import pytest
import respx

from vater_core.kis.master import (
    MASTER_URL,
    Symbol,
    parse_domestic,
    parse_overseas,
    refresh_master,
    search_symbols,
)
from vater_core.store.db import open_db

FIX = Path(__file__).parent / "fixtures"


def text(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8")


def zipped(name: str, inner: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(inner, text(name).encode("cp949"))
    return buf.getvalue()


def test_parse_kospi_keeps_stocks_and_etfs() -> None:
    syms = parse_domestic(text("master_kospi.txt"), "KOSPI")
    by_code = {s.code: s for s in syms}
    assert by_code["005930"] == Symbol("KR", "005930", "KOSPI", "삼성전자", None, "stock")
    assert by_code["069500"].kind == "etf" and by_code["069500"].name == "KODEX 200"
    assert "000660" in by_code
    assert len(syms) == 3  # ETN은 제외


def test_parse_kosdaq_excludes_dr() -> None:
    syms = parse_domestic(text("master_kosdaq.txt"), "KOSDAQ")
    assert [(s.code, s.name, s.exchange) for s in syms] == [("247540", "에코프로비엠", "KOSDAQ")]


def test_parse_nasdaq() -> None:
    syms = {s.code: s for s in parse_overseas(text("master_nas.txt"), "NAS")}
    assert syms["AAPL"] == Symbol("US", "AAPL", "NAS", "애플", "APPLE INC", "stock")
    assert syms["AAAP"].kind == "etf"


def mock_all_masters() -> None:
    files = {
        "kospi_code.mst.zip": zipped("master_kospi.txt", "kospi_code.mst"),
        "kosdaq_code.mst.zip": zipped("master_kosdaq.txt", "kosdaq_code.mst"),
        "nasmst.cod.zip": zipped("master_nas.txt", "nasmst.cod"),
        "nysmst.cod.zip": zipped("master_nas.txt", "nysmst.cod"),
        "amsmst.cod.zip": zipped("master_nas.txt", "amsmst.cod"),
    }
    for fname, data in files.items():
        respx.get(MASTER_URL + fname).mock(return_value=httpx.Response(200, content=data))


@respx.mock
async def test_refresh_and_search(tmp_path: Path) -> None:
    mock_all_masters()
    conn = open_db(tmp_path)
    async with httpx.AsyncClient() as http:
        n = await refresh_master(http, conn, date(2026, 11, 3))
        assert n > 0
        assert await refresh_master(http, conn, date(2026, 11, 3)) == 0  # 오늘 이미 갱신
    assert search_symbols(conn, "005930")[0].name == "삼성전자"  # 코드 정확 일치
    assert search_symbols(conn, "삼성")[0].code == "005930"  # 이름 앞부분
    assert search_symbols(conn, "apple")[0].code == "AAPL"  # 영문명, 대소문자 무시
    assert search_symbols(conn, "에코프로")[0].market == "KR"
    assert search_symbols(conn, "%") == []  # LIKE 특수문자는 글자 그대로


@respx.mock
async def test_failed_download_keeps_old_data(tmp_path: Path) -> None:
    mock_all_masters()
    conn = open_db(tmp_path)
    async with httpx.AsyncClient() as http:
        await refresh_master(http, conn, date(2026, 11, 2))
        respx.get(MASTER_URL + "nasmst.cod.zip").mock(return_value=httpx.Response(500))
        with pytest.raises(httpx.HTTPStatusError):
            await refresh_master(http, conn, date(2026, 11, 3))
    assert search_symbols(conn, "삼성전자")  # 이전 데이터 유지
