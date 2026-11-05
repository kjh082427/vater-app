import logging
import threading
from collections.abc import Iterator
from logging.handlers import RotatingFileHandler
from pathlib import Path

import pytest

from vater_core.logging_setup import refresh_secret_cache, setup_logging
from vater_core.secrets.names import broker_secret
from vater_core.secrets.store import EnvFileSecretStore


@pytest.fixture(autouse=True)
def _restore_root_logging() -> Iterator[None]:
    root = logging.getLogger()
    before = list(root.handlers)
    yield
    for h in list(root.handlers):
        if h not in before:
            root.removeHandler(h)
            h.close()


def read_log(tmp_path: Path) -> str:
    for h in logging.getLogger().handlers:
        h.flush()
    return (tmp_path / "logs" / "vater-core.log").read_text(encoding="utf-8")


def test_masks_known_secret_and_patterns(tmp_path: Path) -> None:
    setup_logging(tmp_path, lambda: ["super-secret-key"])
    log = logging.getLogger("vater_core.test")
    log.info("calling with %s", "super-secret-key")
    log.info('payload {"appsecret": "abcd1234", "x": 1} header Bearer eyJhbGci')
    text = read_log(tmp_path)
    assert "super-secret-key" not in text and "abcd1234" not in text and "eyJhbGci" not in text
    assert "appsecret" in text and "***" in text


def test_masks_secret_inside_traceback(tmp_path: Path) -> None:
    setup_logging(tmp_path, lambda: ["tb-secret-999"])
    try:
        raise ValueError("bad key tb-secret-999")
    except ValueError:
        logging.getLogger("vater_core.test").exception("failed")
    text = read_log(tmp_path)
    assert "tb-secret-999" not in text and "ValueError" in text


def test_short_values_are_not_masked(tmp_path: Path) -> None:
    setup_logging(tmp_path, lambda: ["abc"])  # 4자 미만은 흔한 단어를 망가뜨리므로 제외
    logging.getLogger("vater_core.test").info("abcdef")
    assert "abcdef" in read_log(tmp_path)


def test_refresh_picks_up_new_secret(tmp_path: Path) -> None:
    values: list[str] = []
    setup_logging(tmp_path, lambda: list(values))
    values.append("late-secret-42")
    refresh_secret_cache()
    logging.getLogger("vater_core.test").info("value late-secret-42")
    assert "late-secret-42" not in read_log(tmp_path)


def test_provider_that_logs_does_not_deadlock(tmp_path: Path) -> None:
    """Windows keyring은 비밀키를 읽는 도중 경고 로그를 남길 수 있다 (리뷰 Critical #1)."""

    def noisy_provider() -> list[str]:
        logging.getLogger("keyring.backends.Windows").warning("blob was UTF-8, not UTF-16")
        return ["noisy-secret-1"]

    setup_logging(tmp_path, noisy_provider)
    t = threading.Thread(
        target=lambda: logging.getLogger("vater_core.test").info("x noisy-secret-1"), daemon=True
    )
    t.start()
    t.join(timeout=3)
    assert not t.is_alive(), "logging call deadlocked"
    assert "noisy-secret-1" not in read_log(tmp_path)


def test_rotation_config(tmp_path: Path) -> None:
    setup_logging(tmp_path, lambda: [])
    h = next(h for h in logging.getLogger().handlers if isinstance(h, RotatingFileHandler))
    assert h.maxBytes == 5 * 1024 * 1024 and h.backupCount == 5


def test_setup_is_idempotent_and_never_logs_to_stdout(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    setup_logging(tmp_path, lambda: [])
    setup_logging(tmp_path, lambda: [])
    files = [h for h in logging.getLogger().handlers if isinstance(h, RotatingFileHandler)]
    assert len(files) == 1
    logging.getLogger("vater_core.test").warning("hello")
    assert capsys.readouterr().out == ""  # stdout은 Tauri 이벤트 전용


def test_request_urls_with_account_numbers_are_not_logged(tmp_path: Path) -> None:
    setup_logging(tmp_path, list)
    logging.getLogger("httpx").info("HTTP Request: GET https://x/balance?CANO=12345678")
    assert "12345678" not in read_log(tmp_path)


def test_saved_key_is_masked_without_waiting_for_the_cache(tmp_path: Path) -> None:
    store = EnvFileSecretStore(tmp_path / ".env")
    setup_logging(tmp_path, store.known_values)
    logging.getLogger("x").info("warm the cache")
    store.set(broker_secret(1, "TOKEN"), "fresh-token-value")
    logging.getLogger("x").info("got fresh-token-value")
    assert "fresh-token-value" not in read_log(tmp_path)
