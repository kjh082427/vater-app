"""원달러 환율 (v2 설계 12장). 한투 `FHKST03030100`, 시장 `X`, `FX@KRW`. 하루 한 시점만 쓴다."""

import sqlite3
from datetime import date, timedelta

from vater_core.kis.client import KisClient
from vater_core.kis.config import Priority
from vater_core.kis.models import num, ymd

FX_PATH = "/uapi/overseas-price/v1/quotations/inquire-daily-chartprice"
LOOKBACK = timedelta(days=7)  # 오늘 값이 없을 때(주말, 휴장, 이른 아침) 쓸 수 있는 범위


class FxRepo:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def get(self, day: date) -> float | None:
        row = self._conn.execute(
            "SELECT usdkrw FROM fx_daily WHERE day = ?", (day.isoformat(),)
        ).fetchone()
        return float(row[0]) if row else None

    def latest(self, today: date) -> tuple[date, float] | None:
        """오늘까지 7일 안에 저장된 가장 최근 값."""
        row = self._conn.execute(
            "SELECT day, usdkrw FROM fx_daily WHERE day <= ? AND day >= ? "
            "ORDER BY day DESC LIMIT 1",
            (today.isoformat(), (today - LOOKBACK).isoformat()),
        ).fetchone()
        return (date.fromisoformat(row[0]), float(row[1])) if row else None

    def save(self, day: date, usdkrw: float) -> None:
        with self._conn:
            self._conn.execute(
                "INSERT INTO fx_daily (day, usdkrw) VALUES (?, ?) "
                "ON CONFLICT (day) DO UPDATE SET usdkrw = excluded.usdkrw",
                (day.isoformat(), usdkrw),
            )


async def fetch_usdkrw_range(c: KisClient, start: date, end: date) -> dict[date, float]:
    """기간의 일별 환율. 0이나 빈 값은 없는 날로 둔다."""
    body = await c.get(
        FX_PATH,
        "FHKST03030100",
        {
            "FID_COND_MRKT_DIV_CODE": "X",
            "FID_INPUT_ISCD": "FX@KRW",
            "FID_INPUT_DATE_1": start.strftime("%Y%m%d"),
            "FID_INPUT_DATE_2": end.strftime("%Y%m%d"),
            "FID_PERIOD_DIV_CODE": "D",
        },
        Priority.BRIEFING,
    )
    return {
        ymd(r["stck_bsop_date"]): num(r.get("ovrs_nmix_prpr"))
        for r in body.get("output2", [])
        if r.get("stck_bsop_date") and num(r.get("ovrs_nmix_prpr")) > 0
    }


async def fetch_usdkrw(c: KisClient, today: date) -> tuple[date, float] | None:
    """7일 안의 가장 최근 환율과 그 날짜. 오늘 값이 아직 없으면 그 전 값이 온다."""
    rows = await fetch_usdkrw_range(c, today - LOOKBACK, today)
    days = [d for d in rows if d <= today]
    return (max(days), rows[max(days)]) if days else None
