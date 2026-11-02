import json

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


def test_notify_shape(capsys: pytest.CaptureFixture[str]) -> None:
    notify("에코프로비엠", "RSI 30 이하 진입")
    assert json.loads(capsys.readouterr().out) == {
        "type": "notify",
        "title": "에코프로비엠",
        "body": "RSI 30 이하 진입",
        "route": None,
    }
