from collections.abc import Iterator
from pathlib import Path

import keyring
import pytest
from keyring.backend import KeyringBackend
from keyring.errors import PasswordDeleteError

from vater_core.api.errors import VaterError
from vater_core.secrets.names import SecretName, broker_secret
from vater_core.secrets.store import (
    EnvFileSecretStore,
    KeyringSecretStore,
    SecretStore,
    select_secret_store,
)


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


@pytest.fixture(params=["env", "keyring"])
def any_store(request: pytest.FixtureRequest, tmp_path: Path) -> Iterator[SecretStore]:
    if request.param == "env":
        yield EnvFileSecretStore(tmp_path / ".env")
        return
    previous = keyring.get_keyring()
    keyring.set_keyring(MemoryKeyring())
    try:
        yield KeyringSecretStore()
    finally:
        keyring.set_keyring(previous)


def test_broker_secret_names() -> None:
    assert broker_secret(7, "APP_KEY") == "BROKER_7_APP_KEY"
    assert broker_secret(7, "TOKEN") == "BROKER_7_TOKEN"


def test_broker_secrets_are_stored_deleted_and_known_for_masking(any_store: SecretStore) -> None:
    any_store.set(SecretName.KIS_APP_KEY, "kis-1")
    any_store.set(broker_secret(3, "APP_KEY"), "kiwoom-key-3")
    any_store.set(broker_secret(3, "ACCOUNT"), "81234567")
    any_store.set(broker_secret(4, "APP_SECRET"), "meritz-sec-4")
    assert any_store.get(broker_secret(3, "APP_KEY")) == "kiwoom-key-3"
    assert sorted(any_store.known_values()) == [
        "81234567",
        "kis-1",
        "kiwoom-key-3",
        "meritz-sec-4",
    ]
    any_store.delete(broker_secret(3, "APP_KEY"))
    assert any_store.get(broker_secret(3, "APP_KEY")) is None
    assert "kiwoom-key-3" not in any_store.known_values()


def test_broker_secrets_survive_a_new_store_instance(tmp_path: Path) -> None:
    EnvFileSecretStore(tmp_path / ".env").set(broker_secret(1, "APP_SECRET"), "sec-1")
    # 앱을 다시 켜도 마스킹 대상에서 빠지지 않아야 한다
    assert EnvFileSecretStore(tmp_path / ".env").known_values() == ["sec-1"]


def test_broker_secret_rejects_newlines(any_store: SecretStore) -> None:
    with pytest.raises(VaterError):
        any_store.set(broker_secret(1, "APP_KEY"), "a\nb")


def test_dynamic_name_is_indexed_before_its_value_is_written(tmp_path: Path) -> None:
    """중간에 멈춰도 저장된 값이 마스킹 목록에서 빠지지 않게 한다."""
    written: list[str] = []

    class Recording(EnvFileSecretStore):
        def _raw_set(self, name: str, value: str) -> None:
            written.append(name)
            super()._raw_set(name, value)

    Recording(tmp_path / ".env").set(broker_secret(1, "TOKEN"), "abcd")
    assert written == ["BROKER_SECRET_NAMES", "BROKER_1_TOKEN"]
