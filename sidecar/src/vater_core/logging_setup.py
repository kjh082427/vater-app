"""파일 로그 설정. 키와 토큰은 마스킹해서 원문이 남지 않게 한다 (스펙 8장).

- 위치: `<data_dir>/logs/vater-core.log`, 5MB마다 새 파일, 5개 보관
- stdout에는 로그를 쓰지 않는다 (Tauri 이벤트 전용 통로)
- 가리는 대상: ① 저장된 비밀키 값(4자 이상), ② `Bearer ...`, ③ `appkey=...` 같은 키-값 패턴
- 필터(메시지·인자)와 포맷터(최종 문자열, traceback 포함) 두 단계에서 가린다
"""

import logging
import re
import threading
import time
from collections.abc import Callable
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_FILE = "vater-core.log"
MAX_BYTES = 5 * 1024 * 1024
BACKUPS = 5
MIN_SECRET_LEN = 4
CACHE_SECONDS = 5.0
MASK = "***"

_BEARER = re.compile(r"(Bearer\s+)\S+", re.IGNORECASE)
_KEY_VALUE = re.compile(
    r'("?(?:appkey|appsecret|access_token|approval_key|api_key|authorization)"?\s*[:=]\s*"?)'
    r'[^"\s,&}]+',
    re.IGNORECASE,
)


_reentry = threading.local()


class _SecretCache:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._provider: Callable[[], list[str]] = list
        self._values: list[str] = []
        self._loaded_at = float("-inf")

    def configure(self, provider: Callable[[], list[str]]) -> None:
        with self._lock:
            self._provider = provider
            self._loaded_at = float("-inf")

    def invalidate(self) -> None:
        with self._lock:
            self._loaded_at = float("-inf")

    def values(self) -> list[str]:
        """비밀키 목록을 돌려준다.

        제공 함수(keyring 등)는 **잠금 밖에서** 부른다. 제공 함수가 스스로 로그를 남기면
        그 로그가 다시 여기로 들어오는데(재진입), 그때는 갱신하지 않고 기존 값을 쓴다.
        잠금을 쥔 채 부르면 같은 스레드가 같은 잠금을 다시 기다리며 멈춘다 (리뷰 Critical #1).
        """
        with self._lock:
            fresh = time.monotonic() - self._loaded_at <= CACHE_SECONDS
            current, provider = self._values, self._provider
        if fresh or getattr(_reentry, "refreshing", False):
            return current
        _reentry.refreshing = True
        try:
            raw = provider()
        except Exception:  # 로그 때문에 앱이 죽으면 안 된다
            return current
        finally:
            _reentry.refreshing = False
        # 긴 값부터 가려야 짧은 값이 긴 값의 일부만 가리는 일이 없다.
        updated = sorted({v for v in raw if len(v) >= MIN_SECRET_LEN}, key=len, reverse=True)
        with self._lock:
            self._values, self._loaded_at = updated, time.monotonic()
        return updated


_cache = _SecretCache()


def mask(text: str) -> str:
    for value in _cache.values():
        text = text.replace(value, MASK)
    text = _BEARER.sub(rf"\g<1>{MASK}", text)
    return _KEY_VALUE.sub(rf"\g<1>{MASK}", text)


def refresh_secret_cache() -> None:
    """비밀키를 새로 저장했을 때 호출한다. 다음 로그부터 새 값을 가린다."""
    _cache.invalidate()


class MaskingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = mask(record.getMessage())
        record.args = None
        return True


class MaskingFormatter(logging.Formatter):
    """traceback처럼 필터 이후에 만들어지는 문자열까지 가린다."""

    def format(self, record: logging.LogRecord) -> str:
        return mask(super().format(record))


def setup_logging(data_dir: Path, secret_values: Callable[[], list[str]]) -> None:
    _cache.configure(secret_values)
    root = logging.getLogger()
    for h in list(root.handlers):
        if getattr(h, "_vater", False):
            root.removeHandler(h)
            h.close()

    log_dir = data_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(
        log_dir / LOG_FILE, maxBytes=MAX_BYTES, backupCount=BACKUPS, encoding="utf-8"
    )
    handler._vater = True  # type: ignore[attr-defined]
    handler.addFilter(MaskingFilter())
    handler.setFormatter(MaskingFormatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root.addHandler(handler)
    root.setLevel(logging.INFO)
