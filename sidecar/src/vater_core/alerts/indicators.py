"""기술 지표 순수 함수 (스펙 4-2). 결과는 TA-Lib과 같다(`tests/alerts/test_indicators.py`가 비교).

모든 함수는 입력과 같은 길이의 `pandas.Series`를 돌려주고, 계산할 수 없는 앞부분은 NaN이다.
"""

import numpy as np
import pandas as pd


def _out(values: np.ndarray, like: pd.Series) -> pd.Series:
    return pd.Series(values, index=like.index, dtype=float)


def _ema_array(x: np.ndarray, n: int, seed_start: int, seed_end: int) -> np.ndarray:
    """`x[seed_start:seed_end]`의 평균을 `seed_end - 1` 위치의 첫 값으로 쓰는 EMA (TA-Lib 방식)."""
    out = np.full(len(x), np.nan)
    if seed_end > len(x) or seed_end - seed_start < 1:
        return out
    k = 2.0 / (n + 1)
    value = float(np.mean(x[seed_start:seed_end]))
    out[seed_end - 1] = value
    for i in range(seed_end, len(x)):
        value += k * (x[i] - value)
        out[i] = value
    return out


def sma(close: pd.Series, n: int) -> pd.Series:
    return close.rolling(n, min_periods=n).mean().astype(float)


def ema(close: pd.Series, n: int) -> pd.Series:
    x = close.to_numpy(dtype=float)
    return _out(_ema_array(x, n, 0, n), close)


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    """Wilder 평활 RSI."""
    x = close.to_numpy(dtype=float)
    out = np.full(len(x), np.nan)
    if len(x) <= n:
        return _out(out, close)
    diff = np.diff(x)
    gains, losses = np.clip(diff, 0, None), np.clip(-diff, 0, None)
    avg_gain, avg_loss = gains[:n].mean(), losses[:n].mean()

    def value(g: float, loss: float) -> float:
        total = g + loss
        return 0.0 if total == 0 else 100.0 * g / total

    out[n] = value(avg_gain, avg_loss)
    for i in range(n, len(diff)):
        avg_gain = (avg_gain * (n - 1) + gains[i]) / n
        avg_loss = (avg_loss * (n - 1) + losses[i]) / n
        out[i + 1] = value(avg_gain, avg_loss)
    return _out(out, close)


def macd(
    close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """(MACD, 시그널, 히스토그램). TA-Lib처럼 두 EMA를 같은 시점에서 시작하고,
    세 값 모두 시그널이 처음 나오는 시점부터 보여준다."""
    x = close.to_numpy(dtype=float)
    nan = np.full(len(x), np.nan)
    start = slow - 1  # 느린 EMA의 첫 값 위치
    if len(x) < slow + signal - 1:
        return _out(nan, close), _out(nan.copy(), close), _out(nan.copy(), close)
    fast_ema = _ema_array(x, fast, start + 1 - fast, start + 1)
    slow_ema = _ema_array(x, slow, 0, start + 1)
    line = fast_ema - slow_ema
    sig = np.full(len(x), np.nan)
    sig[start:] = _ema_array(line[start:], signal, 0, signal)
    first = start + signal - 1
    line[:first] = np.nan
    hist = line - sig
    return _out(line, close), _out(sig, close), _out(hist, close)


def bollinger(
    close: pd.Series, n: int = 20, k: float = 2.0
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """(중심선, 상단, 하단). 표준편차는 모집단 기준(ddof=0, TA-Lib과 같음)."""
    mid = sma(close, n)
    std = close.rolling(n, min_periods=n).std(ddof=0)
    return mid, (mid + k * std).astype(float), (mid - k * std).astype(float)


def volume_ma(volume: pd.Series, n: int = 20) -> pd.Series:
    return sma(volume.astype(float), n)


def rolling_high(high: pd.Series, n: int = 252) -> pd.Series:
    return high.rolling(n, min_periods=n).max().astype(float)


def rolling_low(low: pd.Series, n: int = 252) -> pd.Series:
    return low.rolling(n, min_periods=n).min().astype(float)
