"""한투 응답을 앱이 쓰는 형태로 바꾼 값 객체와 숫자 변환 도우미."""

from dataclasses import dataclass
from datetime import date
from typing import Literal

Market = Literal["KR", "US"]
UsExchange = Literal["NAS", "NYS", "AMS"]

# 한투 전일 대비 부호 코드: 1 상한, 2 상승, 3 보합, 4 하한, 5 하락
_DOWN_SIGNS = {"4", "5"}


def num(text: object) -> float:
    """한투는 숫자를 문자열로 준다. 빈 값은 0으로 본다."""
    s = str(text or "").strip().replace(",", "")
    return float(s) if s else 0.0


def signed_change(value: object, sign: object) -> float:
    """해외 `diff`처럼 부호 없이 오는 값을 부호 코드로 바로잡는다."""
    v = abs(num(value))
    return -v if str(sign) in _DOWN_SIGNS else v


def ymd(text: str) -> date:
    return date(int(text[:4]), int(text[4:6]), int(text[6:8]))


@dataclass(frozen=True)
class Quote:
    market: Market
    code: str
    price: float
    change: float
    change_pct: float
    volume: int


@dataclass(frozen=True)
class Bar:
    day: date
    open: float
    high: float
    low: float
    close: float
    volume: int
