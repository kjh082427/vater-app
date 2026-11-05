"""비밀키 저장소 구현. 값은 DB·로그·응답에 절대 나가지 않는다."""

import contextlib
import os
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import Protocol

import keyring
from keyring.errors import PasswordDeleteError

from vater_core.api.errors import VaterError
from vater_core.logging_setup import refresh_secret_cache
from vater_core.secrets.names import BROKER_INDEX, SecretName

SERVICE = "Vater"


class SecretStore(Protocol):
    def get(self, name: str) -> str | None: ...
    def set(self, name: str, value: str) -> None: ...
    def delete(self, name: str) -> None: ...
    def known_values(self) -> list[str]: ...


def _check_value(value: str) -> None:
    if "\n" in value or "\r" in value:
        raise VaterError(
            "SECRET_VALUE_INVALID", "값에 줄바꿈이 들어 있습니다.", "한 줄로 입력해 주세요."
        )


def _is_fixed(name: str) -> bool:
    return name in SecretName.__members__.values()


class _IndexedStore:
    """고정 이름과 증권사 연결 이름을 함께 다룬다. 연결 이름은 목록에 적어 마스킹에 포함한다."""

    def _raw_get(self, name: str) -> str | None:
        raise NotImplementedError

    def _raw_set(self, name: str, value: str) -> None:
        raise NotImplementedError

    def _raw_delete(self, name: str) -> None:
        raise NotImplementedError

    def _dynamic_names(self) -> list[str]:
        raw = self._raw_get(BROKER_INDEX)
        return raw.split(",") if raw else []

    def get(self, name: str) -> str | None:
        return self._raw_get(str(name)) or None

    def set(self, name: str, value: str) -> None:
        _check_value(value)
        key = str(name)
        names = self._dynamic_names()
        if not _is_fixed(key) and key not in names:  # 값보다 먼저 적어야 마스킹에서 빠지지 않는다
            self._raw_set(BROKER_INDEX, ",".join([*names, key]))
        self._raw_set(key, value)
        refresh_secret_cache()

    def delete(self, name: str) -> None:
        key = str(name)
        self._raw_delete(key)
        names = self._dynamic_names()
        if key in names:
            rest = [n for n in names if n != key]
            if rest:
                self._raw_set(BROKER_INDEX, ",".join(rest))
            else:
                self._raw_delete(BROKER_INDEX)

    def known_values(self) -> list[str]:
        names: list[str] = [n.value for n in SecretName] + self._dynamic_names()
        return [v for n in names if (v := self.get(n))]


class KeyringSecretStore(_IndexedStore):
    """Windows에서는 자격 증명 관리자에 저장된다."""

    def __init__(self, service: str = SERVICE) -> None:
        self.service = service

    def _raw_get(self, name: str) -> str | None:
        return keyring.get_password(self.service, name)

    def _raw_set(self, name: str, value: str) -> None:
        keyring.set_password(self.service, name, value)

    def _raw_delete(self, name: str) -> None:
        with contextlib.suppress(PasswordDeleteError):  # 없는 키를 지워도 오류가 아니다
            keyring.delete_password(self.service, name)


class EnvFileSecretStore(_IndexedStore):
    """개발용: `KEY=value` 줄 형식. 주석과 다른 키는 그대로 두고, 파일 권한은 0600."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def _lines(self) -> list[str]:
        return self.path.read_text(encoding="utf-8").splitlines() if self.path.exists() else []

    def _read(self) -> dict[str, str]:
        values: dict[str, str] = {}
        for line in self._lines():
            key, sep, value = line.partition("=")
            if sep and not key.lstrip().startswith("#"):
                values[key.strip()] = value.strip()
        return values

    def _write(self, lines: list[str]) -> None:
        # 링크(worktree의 .env 등)는 유지하고 실제 파일을 바꾼다.
        target = self.path.resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".env.", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write("".join(line + "\n" for line in lines))
            os.chmod(tmp, 0o600)
            os.replace(tmp, target)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def _put(self, key: str, value: str | None) -> None:
        lines, found = [], False
        for line in self._lines():
            k, sep, _ = line.partition("=")
            if sep and k.strip() == key and not k.lstrip().startswith("#"):
                found = True
                if value is not None:
                    lines.append(f"{key}={value}")
                continue
            lines.append(line)
        if not found and value is not None:
            lines.append(f"{key}={value}")
        self._write(lines)

    def _raw_get(self, name: str) -> str | None:
        return self._read().get(name)

    def _raw_set(self, name: str, value: str) -> None:
        self._put(name, value)

    def _raw_delete(self, name: str) -> None:
        self._put(name, None)


def select_secret_store(env: Mapping[str, str], platform: str) -> SecretStore:
    backend = env.get("VATER_SECRET_BACKEND") or ("keyring" if platform == "win32" else "envfile")
    if backend == "keyring":
        return KeyringSecretStore()
    return EnvFileSecretStore(Path(env.get("VATER_ENV_FILE") or Path.cwd() / ".env"))
