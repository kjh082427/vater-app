"""지표 함수. 정확성은 TA-Lib(개발 의존성)과 비교한다 (스펙 4-2)."""

import math

import numpy as np
import pandas as pd
import pytest

from vater_core.alerts import indicators as ind

talib = pytest.importorskip("talib")


def prices(n: int = 300, seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    close = 50000 * np.exp(np.cumsum(rng.normal(0, 0.015, n)))
    high = close * (1 + rng.uniform(0, 0.02, n))
    low = close * (1 - rng.uniform(0, 0.02, n))
    volume = rng.integers(1_000_000, 5_000_000, n).astype(float)
    return pd.DataFrame({"close": close, "high": high, "low": low, "volume": volume})


def same(ours: pd.Series, theirs: np.ndarray) -> None:
    a, b = ours.to_numpy(dtype=float), np.asarray(theirs, dtype=float)
    assert len(a) == len(b)
    assert np.array_equal(np.isnan(a), np.isnan(b)), "NaN 위치가 다르다"
    mask = ~np.isnan(a)
    assert np.allclose(a[mask], b[mask], rtol=0, atol=1e-6)


def test_sma_small_example() -> None:
    out = ind.sma(pd.Series([1.0, 2.0, 3.0, 4.0]), 2).tolist()
    assert math.isnan(out[0]) and out[1:] == [1.5, 2.5, 3.5]


def test_rsi_of_rising_prices_is_100() -> None:
    assert ind.rsi(pd.Series(np.arange(1.0, 40.0)), 14).iloc[-1] == pytest.approx(100.0)


@pytest.mark.parametrize("n", [5, 20, 60])
def test_sma_matches_talib(n: int) -> None:
    p = prices()
    same(ind.sma(p.close, n), talib.SMA(p.close.to_numpy(), n))


@pytest.mark.parametrize("n", [10, 12, 26])
def test_ema_matches_talib(n: int) -> None:
    p = prices()
    same(ind.ema(p.close, n), talib.EMA(p.close.to_numpy(), n))


def test_rsi_matches_talib() -> None:
    p = prices()
    same(ind.rsi(p.close, 14), talib.RSI(p.close.to_numpy(), 14))


def test_macd_matches_talib() -> None:
    p = prices()
    m, s, h = ind.macd(p.close, 12, 26, 9)
    tm, ts, th = talib.MACD(p.close.to_numpy(), 12, 26, 9)
    same(m, tm)
    same(s, ts)
    same(h, th)


def test_bollinger_matches_talib() -> None:
    p = prices()
    mid, up, low = ind.bollinger(p.close, 20, 2.0)
    tu, tm, tl = talib.BBANDS(p.close.to_numpy(), 20, 2.0, 2.0)
    same(mid, tm)
    same(up, tu)
    same(low, tl)


def test_volume_ma_and_rolling_extremes() -> None:
    p = prices()
    same(ind.volume_ma(p.volume, 20), talib.SMA(p.volume.to_numpy(), 20))
    same(ind.rolling_high(p.high, 252), talib.MAX(p.high.to_numpy(), 252))
    same(ind.rolling_low(p.low, 252), talib.MIN(p.low.to_numpy(), 252))


def test_short_input_is_all_nan() -> None:
    s = pd.Series([1.0, 2.0, 3.0])
    assert ind.sma(s, 5).isna().all()
    assert ind.rsi(s, 14).isna().all()
    assert ind.macd(s)[2].isna().all()
