from collections.abc import Iterator
from pathlib import Path

import keyring
import pytest
from keyring.backend import KeyringBackend
from keyring.errors import PasswordDeleteError

from vater_core.api.errors import VaterError
from vater_core.secrets.names import SecretName
from vater_core.secrets.store import EnvFileSecretStore, KeyringSecretStore, select_secret_store


class MemoryKeyring(KeyringBackend):
    priority = 1

    def __init__(self) -> None:
        super().__init__()  # type: ignore[no-untyped-call]
        self.data: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, username: str) -> str | None:
        return self.data.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self.data[(service, username)] = password

    def delete_password(self, service: str, username: str) -> None:
        if (service, username) not in self.data:
            raise PasswordDeleteError("missing")
        del self.data[(service, username)]


@pytest.fixture
def memory_keyring() -> Iterator[MemoryKeyring]:
    previous = keyring.get_keyring()
    backend = MemoryKeyring()
    keyring.set_keyring(backend)
    yield backend
    keyring.set_keyring(previous)


def test_envfile_roundtrip(tmp_path: Path) -> None:
    s = EnvFileSecretStore(tmp_path / ".env")
    s.set(SecretName.KIS_APP_KEY, "abc")
    assert EnvFileSecretStore(tmp_path / ".env").get(SecretName.KIS_APP_KEY) == "abc"
    assert oct((tmp_path / ".env").stat().st_mode & 0o777) == "0o600"
    s.delete(SecretName.KIS_APP_KEY)
    assert s.get(SecretName.KIS_APP_KEY) is None


def test_envfile_preserves_comments_and_other_keys(tmp_path: Path) -> None:
    f = tmp_path / ".env"
    f.write_text("# 한투 키\nKIS_APP_KEY=\nOTHER=keep=me\n", encoding="utf-8")
    EnvFileSecretStore(f).set(SecretName.KIS_APP_KEY, "new")
    assert f.read_text(encoding="utf-8") == "# 한투 키\nKIS_APP_KEY=new\nOTHER=keep=me\n"


def test_envfile_empty_value_reads_as_none(tmp_path: Path) -> None:
    f = tmp_path / ".env"
    f.write_text("LLM_GOOGLE_KEY=\n", encoding="utf-8")
    assert EnvFileSecretStore(f).get(SecretName.LLM_GOOGLE_KEY) is None


def test_envfile_keeps_symlink(tmp_path: Path) -> None:
    target = tmp_path / "real.env"
    target.write_text("", encoding="utf-8")
    link = tmp_path / ".env"
    link.symlink_to(target)
    EnvFileSecretStore(link).set(SecretName.KIS_HTS_ID, "me")
    assert link.is_symlink() and "KIS_HTS_ID=me" in target.read_text(encoding="utf-8")


def test_envfile_rejects_newline(tmp_path: Path) -> None:
    with pytest.raises(VaterError) as e:
        EnvFileSecretStore(tmp_path / ".env").set(SecretName.KIS_APP_KEY, "a\nb")
    assert e.value.code == "SECRET_VALUE_INVALID"


def test_known_values_lists_only_set_values(tmp_path: Path) -> None:
    s = EnvFileSecretStore(tmp_path / ".env")
    s.set(SecretName.KIS_APP_SECRET, "sec-1")
    s.set(SecretName.LLM_GOOGLE_KEY, "goog-2")
    assert sorted(s.known_values()) == ["goog-2", "sec-1"]


def test_keyring_roundtrip(memory_keyring: MemoryKeyring) -> None:
    s = KeyringSecretStore()
    s.set(SecretName.LLM_GOOGLE_KEY, "g-key")
    assert s.get(SecretName.LLM_GOOGLE_KEY) == "g-key"
    assert memory_keyring.data[("Vater", "LLM_GOOGLE_KEY")] == "g-key"
    assert s.known_values() == ["g-key"]
    s.delete(SecretName.LLM_GOOGLE_KEY)
    s.delete(SecretName.LLM_GOOGLE_KEY)  # 없는 키를 지워도 오류가 나지 않음
    assert s.get(SecretName.LLM_GOOGLE_KEY) is None


def test_select_store_defaults() -> None:
    assert isinstance(select_secret_store({}, "win32"), KeyringSecretStore)
    assert isinstance(select_secret_store({}, "linux"), EnvFileSecretStore)


def test_select_store_override(tmp_path: Path) -> None:
    env = {"VATER_SECRET_BACKEND": "envfile", "VATER_ENV_FILE": str(tmp_path / "x.env")}
    store = select_secret_store(env, "win32")
    assert isinstance(store, EnvFileSecretStore) and store.path == tmp_path / "x.env"
    assert isinstance(
        select_secret_store({"VATER_SECRET_BACKEND": "keyring"}, "linux"), KeyringSecretStore
    )
