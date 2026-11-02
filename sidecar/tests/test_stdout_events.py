import json
import os
import subprocess
import sys

import pytest

from vater_core.stdout_events import emit, notify


def test_emit_writes_one_json_line(capsys: pytest.CaptureFixture[str]) -> None:
    emit("notify", title="삼성전자", body="목표가 도달", route="/alerts/005930")
    line = capsys.readouterr().out.strip()
    assert json.loads(line) == {
        "type": "notify",
        "title": "삼성전자",
        "body": "목표가 도달",
        "route": "/alerts/005930",
    }


def test_emit_keeps_korean_unescaped(capsys: pytest.CaptureFixture[str]) -> None:
    emit("log", message="한글")
    assert "한글" in capsys.readouterr().out


@pytest.mark.parametrize("codepage", ["cp1252", "cp949"])
def test_events_are_utf8_even_on_windows_codepages(codepage: str) -> None:
    """Tauri가 띄우면 stdout은 파이프라 Windows 코드 페이지로 인코딩된다 (리뷰 Important #2)."""
    code = "from vater_core.stdout_events import notify; notify('삼성전자', '✅ 목표가 → 도달')"
    env = {**os.environ, "PYTHONIOENCODING": codepage, "PYTHONUTF8": "0"}
    r = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, timeout=30)
    assert r.returncode == 0, r.stderr.decode(errors="replace")
    assert json.loads(r.stdout.decode("utf-8")) == {
        "type": "notify",
        "title": "삼성전자",
        "body": "✅ 목표가 → 도달",
        "route": None,
    }


def test_notify_shape(capsys: pytest.CaptureFixture[str]) -> None:
    notify("에코프로비엠", "RSI 30 이하 진입")
    assert json.loads(capsys.readouterr().out) == {
        "type": "notify",
        "title": "에코프로비엠",
        "body": "RSI 30 이하 진입",
        "route": None,
    }
