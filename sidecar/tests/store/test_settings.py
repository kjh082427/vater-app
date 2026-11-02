from pathlib import Path
from typing import Any

import pytest

from vater_core.api.errors import VaterError
from vater_core.store.db import open_db
from vater_core.store.settings import SettingsRepo


def code_of(repo: SettingsRepo, changes: dict[str, Any]) -> str:
    with pytest.raises(VaterError) as e:
        repo.update(changes)
    return e.value.code


def test_settings_defaults_and_update(tmp_path: Path) -> None:
    repo = SettingsRepo(open_db(tmp_path))
    assert repo.get("briefing.kr.time") == "16:00"
    assert repo.update({"briefing.kr.time": "17:30"})["briefing.kr.time"] == "17:30"
    assert SettingsRepo(open_db(tmp_path)).get("briefing.kr.time") == "17:30"  # 다시 열어도 유지


def test_get_all_includes_defaults(tmp_path: Path) -> None:
    all_ = SettingsRepo(open_db(tmp_path)).get_all()
    assert all_["kis.server"] == "prod" and all_["llm.preset"] == "cloud"
    assert all_["general.autostart"] is True and all_["analysis.debate_rounds"] == 1


def test_settings_rejects_unknown_and_invalid(tmp_path: Path) -> None:
    repo = SettingsRepo(open_db(tmp_path))
    assert code_of(repo, {"nope": 1}) == "SETTING_UNKNOWN"
    assert code_of(repo, {"kis.server": "live"}) == "SETTING_INVALID"
    assert code_of(repo, {"briefing.us.time": "25:00"}) == "SETTING_INVALID"
    assert code_of(repo, {"briefing.us.time": "7:00"}) == "SETTING_INVALID"


def test_bool_and_int_are_not_interchangeable(tmp_path: Path) -> None:
    repo = SettingsRepo(open_db(tmp_path))
    assert code_of(repo, {"analysis.debate_rounds": True}) == "SETTING_INVALID"
    assert code_of(repo, {"general.autostart": 1}) == "SETTING_INVALID"


def test_int_ranges(tmp_path: Path) -> None:
    repo = SettingsRepo(open_db(tmp_path))
    assert code_of(repo, {"analysis.debate_rounds": 0}) == "SETTING_INVALID"
    assert code_of(repo, {"alerts.poll_interval_sec": 5}) == "SETTING_INVALID"
    assert repo.update({"alerts.poll_interval_sec": 60})["alerts.poll_interval_sec"] == 60


def test_failed_update_changes_nothing(tmp_path: Path) -> None:
    repo = SettingsRepo(open_db(tmp_path))
    code_of(repo, {"briefing.kr.time": "18:00", "kis.server": "live"})
    assert repo.get("briefing.kr.time") == "16:00"
