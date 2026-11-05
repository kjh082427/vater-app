"""앱 설정: 정의된 키만 받고, 타입·선택지·범위를 검사해서 JSON으로 저장한다.

비밀키는 여기에 저장하지 않는다 (secrets 모듈 담당).
"""

import json
import re
import sqlite3
from dataclasses import dataclass
from typing import Any

from vater_core.api.errors import VaterError
from vater_core.llm.catalog import catalog_tags

_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


@dataclass(frozen=True)
class SettingDef:
    type: type[bool] | type[int] | type[str]
    default: Any
    choices: tuple[str, ...] | tuple[int, ...] | None = None
    min: int | None = None
    max: int | None = None
    time_of_day: bool = False  # "HH:MM" 형식


# 이후 브랜치(core/kis, core/llm …)가 자기 키를 여기에 추가한다.
SETTING_DEFS: dict[str, SettingDef] = {
    "general.autostart": SettingDef(bool, True),
    "general.close_to_tray": SettingDef(bool, True),
    "kis.server": SettingDef(str, "prod", choices=("prod", "vps")),
    # 공식 샘플 간격(실전 0.05s, 모의 0.5s)보다 보수적으로 잡는다.
    "kis.rate_per_sec.prod": SettingDef(int, 15, min=1, max=20),
    "kis.rate_per_sec.vps": SettingDef(int, 2, min=1, max=5),
    "kis.ws_max_subscriptions": SettingDef(int, 41, min=1, max=41),
    "llm.preset": SettingDef(str, "cloud", choices=("cloud", "local", "mixed")),
    # 빈 문자열 = 아직 고르지 않음(로컬 모델) / 카탈로그 기본값 사용(클라우드 모델)
    "llm.local_model": SettingDef(str, "", choices=("", *catalog_tags())),
    "llm.cloud_provider": SettingDef(
        str, "google", choices=("google", "anthropic", "openai", "compat")
    ),
    "llm.cloud_deep_model": SettingDef(str, ""),
    "llm.cloud_quick_model": SettingDef(str, ""),
    "llm.output_language": SettingDef(str, "Korean", choices=("Korean", "English")),
    "analysis.debate_rounds": SettingDef(int, 1, min=1, max=5),
    "holdings.sync_minutes": SettingDef(int, 0, choices=(0, 10, 30, 60)),
    "alerts.poll_interval_sec": SettingDef(int, 30, min=10, max=600),
    "briefing.kr.enabled": SettingDef(bool, True),
    "briefing.kr.time": SettingDef(str, "16:00", time_of_day=True),
    "briefing.us.enabled": SettingDef(bool, True),
    "briefing.us.time": SettingDef(str, "07:00", time_of_day=True),
}


def _invalid(key: str, why: str) -> VaterError:
    return VaterError("SETTING_INVALID", f"설정 '{key}' 값이 올바르지 않습니다: {why}", status=422)


def validate(key: str, value: Any) -> None:
    d = SETTING_DEFS.get(key)
    if d is None:
        raise VaterError("SETTING_UNKNOWN", f"알 수 없는 설정입니다: '{key}'", status=400)
    # bool은 int의 하위 타입이라 type()으로 정확히 비교한다.
    if type(value) is not d.type:
        raise _invalid(key, f"{d.type.__name__} 타입이어야 합니다")
    if d.choices is not None and value not in d.choices:
        raise _invalid(key, f"{', '.join(map(str, d.choices))} 중 하나여야 합니다")
    if isinstance(value, int) and d.min is not None and value < d.min:
        raise _invalid(key, f"{d.min} 이상이어야 합니다")
    if isinstance(value, int) and d.max is not None and value > d.max:
        raise _invalid(key, f"{d.max} 이하여야 합니다")
    if d.time_of_day and not (isinstance(value, str) and _HHMM.match(value)):
        raise _invalid(key, "HH:MM 형식(00:00~23:59)이어야 합니다")


class SettingsRepo:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def get_all(self) -> dict[str, Any]:
        stored = {
            k: json.loads(v) for k, v in self._conn.execute("SELECT key, value FROM settings")
        }
        return {k: stored.get(k, d.default) for k, d in SETTING_DEFS.items()}

    def get(self, key: str) -> Any:
        if key not in SETTING_DEFS:
            raise VaterError("SETTING_UNKNOWN", f"알 수 없는 설정입니다: '{key}'", status=400)
        return self.get_all()[key]

    def update(self, changes: dict[str, Any]) -> dict[str, Any]:
        """모두 검사한 뒤에만 저장한다. 하나라도 틀리면 아무것도 바꾸지 않는다."""
        for key, value in changes.items():
            validate(key, value)
        with self._conn:
            self._conn.executemany(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [(k, json.dumps(v, ensure_ascii=False)) for k, v in changes.items()],
            )
        return self.get_all()
