"""국내·해외 현재가, 일봉, 국내 휴장일 (조회 전용)."""

from datetime import date, timedelta

from vater_core.kis.client import KisClient
from vater_core.kis.config import Priority
from vater_core.kis.models import Bar, Quote, UsExchange, num, signed_change, ymd

DAILY_PAGE = 100  # 국내 일봉은 한 번에 최대 100행
MAX_PAGES = 10


async def domestic_price(c: KisClient, code: str, priority: Priority = Priority.ALERTS) -> Quote:
    body = await c.get(
        "/uapi/domestic-stock/v1/quotations/inquire-price",
        "FHKST01010100",
        {"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": code},
        priority,
    )
    o = body["output"]
    return Quote(
        market="KR",
        code=code,
        price=num(o["stck_prpr"]),
        change=signed_change(o["prdy_vrss"], o.get("prdy_vrss_sign")),
        change_pct=num(o["prdy_ctrt"]),
        volume=int(num(o["acml_vol"])),
    )


async def overseas_price(
    c: KisClient, exchange: UsExchange, symbol: str, priority: Priority = Priority.ALERTS
) -> Quote:
    body = await c.get(
        "/uapi/overseas-price/v1/quotations/price",
        "HHDFS00000300",
        {"AUTH": "", "EXCD": exchange, "SYMB": symbol},
        priority,
    )
    o = body["output"]
    return Quote(
        market="US",
        code=symbol,
        price=num(o["last"]),
        change=signed_change(o["diff"], o.get("sign")),  # diff는 부호가 없다
        change_pct=num(o["rate"]),
        volume=int(num(o["tvol"])),
    )


def _domestic_bar(row: dict[str, str]) -> Bar:
    return Bar(
        day=ymd(row["stck_bsop_date"]),
        open=num(row["stck_oprc"]),
        high=num(row["stck_hgpr"]),
        low=num(row["stck_lwpr"]),
        close=num(row["stck_clpr"]),
        volume=int(num(row["acml_vol"])),
    )


async def domestic_daily(
    c: KisClient, code: str, start: date, end: date, priority: Priority = Priority.ALERTS
) -> list[Bar]:
    """[start, end] 일봉을 날짜 오름차순으로. 100행이 넘으면 끝 날짜를 앞으로 옮겨 이어 받는다."""
    bars: dict[date, Bar] = {}
    page_end = end
    for _ in range(MAX_PAGES):
        body = await c.get(
            "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
            "FHKST03010100",
            {
                "FID_COND_MRKT_DIV_CODE": "J",
                "FID_INPUT_ISCD": code,
                "FID_INPUT_DATE_1": start.strftime("%Y%m%d"),
                "FID_INPUT_DATE_2": page_end.strftime("%Y%m%d"),
                "FID_PERIOD_DIV_CODE": "D",
                "FID_ORG_ADJ_PRC": "0",  # 수정주가
            },
            priority,
        )
        rows = [r for r in body.get("output2", []) if r.get("stck_bsop_date")]
        for r in rows:
            bar = _domestic_bar(r)
            if start <= bar.day <= end:
                bars[bar.day] = bar
        if len(rows) < DAILY_PAGE:
            break
        oldest = min(ymd(r["stck_bsop_date"]) for r in rows)
        if oldest <= start:
            break
        page_end = oldest - timedelta(days=1)
    return [bars[d] for d in sorted(bars)]


async def overseas_daily(
    c: KisClient, exchange: UsExchange, symbol: str, end: date, priority: Priority = Priority.ALERTS
) -> list[Bar]:
    """`end`까지의 최근 일봉(한 번에 약 100행)을 날짜 오름차순으로."""
    body = await c.get(
        "/uapi/overseas-price/v1/quotations/dailyprice",
        "HHDFS76240000",
        {
            "AUTH": "",
            "EXCD": exchange,
            "SYMB": symbol,
            "GUBN": "0",
            "BYMD": end.strftime("%Y%m%d"),
            "MODP": "1",
        },
        priority,
    )
    bars = [
        Bar(
            day=ymd(r["xymd"]),
            open=num(r["open"]),
            high=num(r["high"]),
            low=num(r["low"]),
            close=num(r["clos"]),
            volume=int(num(r["tvol"])),
        )
        for r in body.get("output2", [])
        if r.get("xymd")
    ]
    return sorted(bars, key=lambda b: b.day)


async def is_domestic_trading_day(
    c: KisClient, day: date, priority: Priority = Priority.ALERTS
) -> bool:
    """국내 개장일 여부. 한투 휴장일 API의 `opnd_yn`(개장일 여부)을 쓴다."""
    body = await c.get(
        "/uapi/domestic-stock/v1/quotations/chk-holiday",
        "CTCA0903R",
        {"BASS_DT": day.strftime("%Y%m%d"), "CTX_AREA_NK": "", "CTX_AREA_FK": ""},
        priority,
    )
    key = day.strftime("%Y%m%d")
    for row in body.get("output", []):
        if row.get("bass_dt") == key:
            return str(row.get("opnd_yn")) == "Y"
    return False
