"""분석 이력 삭제: 그 분석의 체크포인트만 지운다 (v2 설계 21장 1번). 진짜 체크포인트 DB를 쓴다."""

from collections.abc import Callable
from pathlib import Path

from tradingagents.graph.checkpointer import get_checkpointer

from vater_core.analysis.engine import clear_checkpoints

Make = Callable[[Path, str, str, str], str]


def threads(base: Path, ticker: str) -> set[str]:
    with get_checkpointer(base, ticker) as saver:
        rows = saver.conn.execute("SELECT DISTINCT thread_id FROM checkpoints").fetchall()
    return {r[0] for r in rows}


def test_clears_every_setting_of_that_ticker_and_day_only(
    tmp_path: Path, make_checkpoint: Make
) -> None:
    # 설정(signature)이 다르면 같은 종목·기준일이어도 스레드가 다르다
    a = make_checkpoint(tmp_path, "005930.KS", "2026-11-03", "cloud")
    b = make_checkpoint(tmp_path, "005930.KS", "2026-11-03", "local")
    other_day = make_checkpoint(tmp_path, "005930.KS", "2026-11-04", "cloud")
    other_ticker = make_checkpoint(tmp_path, "AAPL", "2026-11-03", "cloud")
    assert threads(tmp_path, "005930.KS") == {a, b, other_day}

    clear_checkpoints(tmp_path, "KR", "005930", "2026-11-03")

    assert threads(tmp_path, "005930.KS") == {other_day}
    assert threads(tmp_path, "AAPL") == {other_ticker}


def test_kosdaq_and_us_tickers(tmp_path: Path, make_checkpoint: Make) -> None:
    kq = make_checkpoint(tmp_path, "247540.KQ", "2026-11-03", "s")
    us = make_checkpoint(tmp_path, "AAPL", "2026-11-03", "s")
    clear_checkpoints(tmp_path, "KR", "247540", "2026-11-03")
    assert threads(tmp_path, "247540.KQ") == set() and threads(tmp_path, "AAPL") == {us}
    assert kq not in threads(tmp_path, "247540.KQ")
    clear_checkpoints(tmp_path, "US", "AAPL", "2026-11-03")
    assert threads(tmp_path, "AAPL") == set()


def test_nothing_to_clear_creates_nothing(tmp_path: Path) -> None:
    clear_checkpoints(tmp_path, "KR", "005930", "2026-11-03")
    assert not (tmp_path / "checkpoints").exists()
