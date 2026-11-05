from datetime import date, timedelta
from typing import Any

import pytest

from vater_core.alerts.rules import (
    KINDS,
    History,
    Live,
    condition,
    default_timing,
    parse_rule,
)
from vater_core.api.errors import VaterError

START = date(2025, 1, 1)


def history(closes: list[float], volumes: list[float] | None = None) -> History:
    n = len(closes)
    days = tuple(START + timedelta(days=i) for i in range(n))
    vols = tuple(volumes or [1_000_000.0] * n)
    return History(
        days=days,
        open=tuple(closes),
        high=tuple(c * 1.01 for c in closes),
        low=tuple(c * 0.99 for c in closes),
        close=tuple(closes),
        volume=vols,
    )


def rising(n: int, start: float = 100.0, step: float = 1.0) -> list[float]:
    return [start + i * step for i in range(n)]


def state(kind: str, params: dict[str, Any], h: History, live: Live | None = None) -> bool | None:
    return condition(parse_rule(kind, params), h, live).state


def test_every_kind_has_defaults_and_timing() -> None:
    assert set(KINDS) == {
        "price_above",
        "price_below",
        "change_pct",
        "ma_cross",
        "ma_break",
        "rsi",
        "macd_cross",
        "bollinger",
        "volume_spike",
        "new_high_low",
        "avg_price_pct",
    }
    assert default_timing("price_above") == "realtime"
    assert default_timing("rsi") == "close"
    assert default_timing("volume_spike") == "realtime"
    parse_rule("rsi", {})  # 기본값만으로 만들 수 있다
    parse_rule("macd_cross", {})


@pytest.mark.parametrize(
    ("kind", "params"),
    [
        ("price_above", {}),  # 필수 값 없음
        ("price_above", {"price": -1}),
        ("ma_cross", {"fast": 20, "slow": 5}),
        ("macd_cross", {"fast": 26, "slow": 12}),
        ("rsi", {"upper": 30, "lower": 70}),
        ("rsi", {"bogus": 1}),  # 남는 필드
        ("bollinger", {"k": 0}),
        ("volume_spike", {"multiple": 0.5}),
        ("teleport", {}),
    ],
)
def test_invalid_rules(kind: str, params: dict[str, Any]) -> None:
    with pytest.raises(VaterError) as e:
        parse_rule(kind, params)
    assert (e.value.code, e.value.status) == ("ALERT_RULE_INVALID", 422)


def test_invalid_rule_names_the_field() -> None:
    with pytest.raises(VaterError) as e:
        parse_rule("price_above", {"price": "abc"})
    assert "price" in (e.value.hint or "")


def test_price_above_below_with_live_price() -> None:
    h = history(rising(10))
    live = Live(day=START + timedelta(days=10), price=150.0, change_pct=1.0, volume=10)
    assert state("price_above", {"price": 140}, h, live) is True
    assert state("price_above", {"price": 160}, h, live) is False
    assert state("price_below", {"price": 160}, h, live) is True
    assert state("price_above", {"price": 105}, h) is True  # 현재가가 없으면 마지막 종가(109)


def test_change_pct_directions() -> None:
    h = history(rising(5))
    up = Live(day=START + timedelta(days=5), price=110, change_pct=6.0, volume=1)
    down = Live(day=START + timedelta(days=5), price=90, change_pct=-6.0, volume=1)
    assert state("change_pct", {"pct": 5, "direction": "up"}, h, up) is True
    assert state("change_pct", {"pct": 5, "direction": "up"}, h, down) is False
    assert state("change_pct", {"pct": 5, "direction": "down"}, h, down) is True
    assert state("change_pct", {"pct": 5}, h, down) is True  # both
    assert state("change_pct", {"pct": 5}, history([100, 103])) is False  # 종가로 계산 3%


def test_ma_cross_and_break() -> None:
    h = history(rising(30))  # 계속 오르면 짧은 평균 > 긴 평균, 가격 > 평균
    assert state("ma_cross", {"fast": 5, "slow": 20, "direction": "golden"}, h) is True
    assert state("ma_cross", {"fast": 5, "slow": 20, "direction": "dead"}, h) is False
    assert state("ma_break", {"period": 20, "direction": "above"}, h) is True
    assert state("ma_break", {"period": 20, "direction": "below"}, h) is False


def test_rsi_overbought_oversold() -> None:
    assert state("rsi", {"direction": "overbought"}, history(rising(30))) is True
    assert state("rsi", {"direction": "oversold"}, history(rising(30, 200, -1))) is True
    assert state("rsi", {"direction": "oversold"}, history(rising(30))) is False


def test_macd_and_bollinger() -> None:
    assert (
        state(
            "macd_cross",
            {"direction": "golden"},
            history(rising(60, 100, 0.5) + rising(10, 140, 3)),
        )
        is True
    )
    flat = [100.0] * 25 + [130.0]
    assert state("bollinger", {"direction": "upper"}, history(flat)) is True
    assert state("bollinger", {"direction": "lower"}, history(flat)) is False


def test_volume_spike_uses_previous_days_average() -> None:
    h = history(rising(25), [1_000_000.0] * 25)
    spike = Live(day=START + timedelta(days=25), price=130, change_pct=1, volume=3_500_000)
    calm = Live(day=START + timedelta(days=25), price=130, change_pct=1, volume=2_000_000)
    assert state("volume_spike", {}, h, spike) is True
    assert state("volume_spike", {}, h, calm) is False


def test_new_high_low() -> None:
    h = history(rising(260))
    live = Live(day=START + timedelta(days=260), price=500, change_pct=1, volume=1)
    assert state("new_high_low", {"direction": "high"}, h, live) is True
    assert state("new_high_low", {"direction": "low"}, h, live) is False


@pytest.mark.parametrize(
    ("kind", "params"),
    [
        ("ma_cross", {}),
        ("ma_break", {}),
        ("rsi", {}),
        ("macd_cross", {}),
        ("bollinger", {}),
        ("volume_spike", {}),
        ("new_high_low", {}),
        ("change_pct", {}),
    ],
)
def test_not_enough_history_is_unknown(kind: str, params: dict[str, Any]) -> None:
    """신규 상장처럼 일봉이 부족하면 '계산 불가'(None): 상태를 바꾸지 않는다."""
    reading = condition(parse_rule(kind, params), history([100.0]), None)
    assert reading.state is None and reading.value is None


def test_live_replaces_todays_partial_bar() -> None:
    """장중에 받은 일봉에 오늘의 미확정 봉이 있으면 현재가로 바꿔서 계산한다."""
    h = history(rising(30))  # 마지막 날 = START + 29일
    today = START + timedelta(days=29)
    live = Live(day=today, price=50.0, change_pct=-50, volume=1)
    with_partial = condition(parse_rule("ma_break", {"period": 20, "direction": "below"}), h, live)
    trimmed = history(rising(29))
    expected = condition(
        parse_rule("ma_break", {"period": 20, "direction": "below"}), trimmed, live
    )
    assert with_partial == expected and with_partial.state is True


def test_messages_are_korean() -> None:
    r = condition(parse_rule("rsi", {"direction": "overbought"}), history(rising(30)), None)
    assert "RSI(14)" in r.message and "과매수" in r.message
