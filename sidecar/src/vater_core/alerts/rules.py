"""알림 규칙 종류와 조건 판정 (스펙 4-1).

`condition()`은 순수 함수다: 확정 일봉(`History`)과, 장중이면 현재가(`Live`)를 받아
"지금 조건이 참인가"를 돌려준다. 거짓→참 전이와 쿨다운은 평가기(`evaluator.py`)가 맡는다.
장중(잠정) 계산은 현재가를 오늘 종가로 가정한다(스펙 4-2).
교차류(`ma_cross`, `macd_cross`)는 현재 위·아래 상태를 state로 쓴다. 상태가 바뀌는 순간이 곧 교차다.
"""

from dataclasses import dataclass
from datetime import date
from typing import Any, Literal

import pandas as pd
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from vater_core.alerts import indicators as ind
from vater_core.api.errors import VaterError

Timing = Literal["realtime", "close"]
YEAR = 252  # 52주 = 최근 252거래일


class _Params(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PriceAbove(_Params):
    price: float = Field(gt=0)


class PriceBelow(_Params):
    price: float = Field(gt=0)


class ChangePct(_Params):
    pct: float = Field(5.0, gt=0, le=100)
    direction: Literal["up", "down", "both"] = "both"


class MaCross(_Params):
    fast: int = Field(5, ge=1, le=250)
    slow: int = Field(20, ge=2, le=250)
    direction: Literal["golden", "dead"] = "golden"

    @model_validator(mode="after")
    def _order(self) -> "MaCross":
        if self.fast >= self.slow:
            raise ValueError("fast must be smaller than slow")
        return self


class MaBreak(_Params):
    period: int = Field(20, ge=2, le=250)
    direction: Literal["above", "below"] = "above"


class Rsi(_Params):
    period: int = Field(14, ge=2, le=100)
    upper: float = Field(70.0, gt=0, lt=100)
    lower: float = Field(30.0, gt=0, lt=100)
    direction: Literal["overbought", "oversold"] = "overbought"

    @model_validator(mode="after")
    def _order(self) -> "Rsi":
        if self.lower >= self.upper:
            raise ValueError("lower must be smaller than upper")
        return self


class MacdCross(_Params):
    fast: int = Field(12, ge=2, le=100)
    slow: int = Field(26, ge=3, le=200)
    signal: int = Field(9, ge=2, le=100)
    direction: Literal["golden", "dead"] = "golden"

    @model_validator(mode="after")
    def _order(self) -> "MacdCross":
        if self.fast >= self.slow:
            raise ValueError("fast must be smaller than slow")
        return self


class Bollinger(_Params):
    period: int = Field(20, ge=2, le=250)
    k: float = Field(2.0, gt=0, le=5)
    direction: Literal["upper", "lower"] = "upper"


class VolumeSpike(_Params):
    period: int = Field(20, ge=2, le=250)
    multiple: float = Field(3.0, gt=1, le=100)


class NewHighLow(_Params):
    direction: Literal["high", "low"] = "high"


class AvgPricePct(_Params):
    pct: float = Field(10.0, gt=0, le=100)
    direction: Literal["up", "down"] = "down"


RuleParams = (
    PriceAbove
    | PriceBelow
    | ChangePct
    | MaCross
    | MaBreak
    | Rsi
    | MacdCross
    | Bollinger
    | VolumeSpike
    | NewHighLow
    | AvgPricePct
)

# kind → (파라미터 모델, 기본 확인 시점)
KINDS: dict[str, tuple[type[_Params], Timing]] = {
    "price_above": (PriceAbove, "realtime"),
    "price_below": (PriceBelow, "realtime"),
    "change_pct": (ChangePct, "realtime"),
    "ma_cross": (MaCross, "close"),
    "ma_break": (MaBreak, "close"),
    "rsi": (Rsi, "close"),
    "macd_cross": (MacdCross, "close"),
    "bollinger": (Bollinger, "close"),
    "volume_spike": (VolumeSpike, "realtime"),
    "new_high_low": (NewHighLow, "realtime"),
    "avg_price_pct": (AvgPricePct, "realtime"),
}


# 울렸다는 사실만으로 보유가 드러나는 종류. AI 입력에 넣지 않는다 (v2 설계 8-1장).
PRIVATE_KINDS = frozenset({"avg_price_pct"})


def _invalid(message: str, hint: str | None = None) -> VaterError:
    return VaterError("ALERT_RULE_INVALID", message, hint=hint, status=422)


def parse_rule(kind: str, params: dict[str, Any]) -> RuleParams:
    if kind not in KINDS:
        raise _invalid(f"알 수 없는 알림 종류입니다: '{kind}'", f"가능한 종류: {', '.join(KINDS)}")
    model = KINDS[kind][0]
    try:
        parsed: RuleParams = model.model_validate(params)  # type: ignore[assignment]
    except ValidationError as e:
        # 입력값은 되돌려주지 않는다. 어느 필드가 틀렸는지만 알린다.
        fields = sorted({".".join(str(p) for p in err["loc"]) or "params" for err in e.errors()})
        raise _invalid(
            "알림 조건 값이 올바르지 않습니다.", f"확인할 항목: {', '.join(fields)}"
        ) from e
    return parsed


def default_timing(kind: str) -> Timing:
    if kind not in KINDS:
        raise _invalid(f"알 수 없는 알림 종류입니다: '{kind}'")
    return KINDS[kind][1]


def default_params(kind: str) -> dict[str, Any]:
    """UI 폼용: 필수가 아닌 값의 기본값."""
    model = KINDS[kind][0]
    return {name: f.default for name, f in model.model_fields.items() if not f.is_required()}


@dataclass(frozen=True)
class History:
    """확정 일봉. 오래된 것부터."""

    days: tuple[date, ...]
    open: tuple[float, ...]
    high: tuple[float, ...]
    low: tuple[float, ...]
    close: tuple[float, ...]
    volume: tuple[float, ...]


@dataclass(frozen=True)
class Live:
    """장중 현재가. `day`는 그 시장의 오늘(세션) 날짜."""

    day: date
    price: float
    change_pct: float
    volume: int


@dataclass(frozen=True)
class Reading:
    state: bool | None  # None = 계산 불가(일봉 부족)
    value: float | None
    message: str


@dataclass(frozen=True)
class _Frame:
    close: pd.Series
    high: pd.Series
    low: pd.Series
    volume: pd.Series


def _frame(h: History, live: Live | None) -> _Frame:
    """확정 일봉 + (장중이면) 현재가를 오늘 봉으로 붙인다. 오늘의 미확정 봉은 뺀다."""
    keep = [i for i, d in enumerate(h.days) if live is None or d < live.day]
    close = [h.close[i] for i in keep]
    high = [h.high[i] for i in keep]
    low = [h.low[i] for i in keep]
    volume = [h.volume[i] for i in keep]
    if live is not None:
        close.append(live.price)
        high.append(live.price)
        low.append(live.price)
        volume.append(float(live.volume))
    return _Frame(
        pd.Series(close, dtype=float),
        pd.Series(high, dtype=float),
        pd.Series(low, dtype=float),
        pd.Series(volume, dtype=float),
    )


def _fmt(x: float) -> str:
    return f"{x:,.0f}" if abs(x) >= 1000 else f"{x:,.2f}"


def _last(series: pd.Series) -> float | None:
    if series.empty or pd.isna(series.iloc[-1]):
        return None
    return float(series.iloc[-1])


UNKNOWN = "데이터가 부족해 계산할 수 없습니다"


def condition(
    params: RuleParams, history: History, live: Live | None, avg_price: float | None = None
) -> Reading:
    """`avg_price`는 내 합산 평단가(`avg_price_pct`만 쓴다). 알림 글에는 값을 넣지 않는다."""
    f = _frame(history, live)
    if f.close.empty:
        return Reading(None, None, UNKNOWN)
    price = float(f.close.iloc[-1])

    if isinstance(params, PriceAbove | PriceBelow):
        above = isinstance(params, PriceAbove)
        ok = price >= params.price if above else price <= params.price
        word = "이상" if above else "이하"
        return Reading(ok, price, f"현재가 {_fmt(price)} — 목표가 {_fmt(params.price)} {word}")

    if isinstance(params, ChangePct):
        if live is not None:
            change = live.change_pct
        elif len(f.close) >= 2 and f.close.iloc[-2] != 0:
            change = (price / float(f.close.iloc[-2]) - 1) * 100
        else:
            return Reading(None, None, UNKNOWN)
        ok = {
            "up": change >= params.pct,
            "down": change <= -params.pct,
            "both": abs(change) >= params.pct,
        }[params.direction]
        return Reading(ok, change, f"전일 대비 {change:+.2f}%")

    if isinstance(params, MaCross):
        fast, slow = _last(ind.sma(f.close, params.fast)), _last(ind.sma(f.close, params.slow))
        if fast is None or slow is None:
            return Reading(None, None, UNKNOWN)
        golden = params.direction == "golden"
        ok = fast > slow if golden else fast < slow
        name = "골든크로스" if golden else "데드크로스"
        word = "위로" if golden else "아래로"
        msg = f"{params.fast}일 이동평균이 {params.slow}일 이동평균 {word} 교차 ({name})"
        return Reading(ok, fast - slow, msg)

    if isinstance(params, MaBreak):
        ma = _last(ind.sma(f.close, params.period))
        if ma is None:
            return Reading(None, None, UNKNOWN)
        above = params.direction == "above"
        ok = price > ma if above else price < ma
        word = "돌파" if above else "이탈"
        msg = f"{params.period}일 이동평균({_fmt(ma)}) {word}, 현재가 {_fmt(price)}"
        return Reading(ok, price - ma, msg)

    if isinstance(params, Rsi):
        value = _last(ind.rsi(f.close, params.period))
        if value is None:
            return Reading(None, None, UNKNOWN)
        over = params.direction == "overbought"
        ok = value >= params.upper if over else value <= params.lower
        word = "과매수" if over else "과매도"
        return Reading(ok, value, f"RSI({params.period}) {value:.1f} — {word} 진입")

    if isinstance(params, MacdCross):
        line, sig, _ = ind.macd(f.close, params.fast, params.slow, params.signal)
        m, s = _last(line), _last(sig)
        if m is None or s is None:
            return Reading(None, None, UNKNOWN)
        golden = params.direction == "golden"
        ok = m > s if golden else m < s
        word = "위로" if golden else "아래로"
        return Reading(ok, m - s, f"MACD가 시그널선 {word} 교차")

    if isinstance(params, Bollinger):
        _, up, low = ind.bollinger(f.close, params.period, params.k)
        u, lo = _last(up), _last(low)
        if u is None or lo is None:
            return Reading(None, None, UNKNOWN)
        upper = params.direction == "upper"
        ok = price > u if upper else price < lo
        band = u if upper else lo
        word = "상단" if upper else "하단"
        msg = f"볼린저밴드 {word}({_fmt(band)}) 이탈, 현재가 {_fmt(price)}"
        return Reading(ok, price, msg)

    if isinstance(params, VolumeSpike):
        previous = f.volume.iloc[:-1]
        if len(previous) < params.period:
            return Reading(None, None, UNKNOWN)
        avg = float(previous.iloc[-params.period :].mean())
        if avg <= 0:
            return Reading(None, None, UNKNOWN)
        ratio = float(f.volume.iloc[-1]) / avg
        return Reading(
            ratio >= params.multiple, ratio, f"거래량이 {params.period}일 평균의 {ratio:.1f}배"
        )

    if isinstance(params, NewHighLow):
        high = params.direction == "high"
        previous = (f.high if high else f.low).iloc[:-1]
        if len(previous) < YEAR:
            return Reading(None, None, UNKNOWN)
        window = previous.iloc[-YEAR:]
        today = float((f.high if high else f.low).iloc[-1])
        ok = today > float(window.max()) if high else today < float(window.min())
        word = "신고가" if high else "신저가"
        return Reading(ok, today, f"52주 {word} 경신 ({_fmt(today)})")

    if isinstance(params, AvgPricePct):
        if not avg_price or avg_price <= 0:
            return Reading(None, None, "보유 평단가를 알 수 없습니다")
        change = round(
            (price / avg_price - 1) * 100, 9
        )  # 정확히 -10%에서 부동소수 오차로 빗나가지 않게
        up = params.direction == "up"
        ok = change >= params.pct if up else change <= -params.pct
        return Reading(ok, change, f"평단가 대비 {change:+.2f}%")

    raise _invalid(f"처리할 수 없는 알림 종류입니다: {type(params).__name__}")
