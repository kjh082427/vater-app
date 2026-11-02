from pathlib import Path

import pytest

from vater_core.api.errors import VaterError
from vater_core.kis.config import REST_HOST, WS_HOST, KisServer, Priority, load_credentials
from vater_core.secrets.names import SecretName
from vater_core.secrets.store import EnvFileSecretStore
from vater_core.store.db import open_db
from vater_core.store.settings import SettingsRepo


def test_kis_setting_defaults(tmp_path: Path) -> None:
    s = SettingsRepo(open_db(tmp_path)).get_all()
    assert s["kis.rate_per_sec.prod"] == 15
    assert s["kis.rate_per_sec.vps"] == 2
    assert s["kis.ws_max_subscriptions"] == 41


@pytest.mark.parametrize(
    ("key", "value"),
    [("kis.rate_per_sec.prod", 0), ("kis.rate_per_sec.prod", 21), ("kis.rate_per_sec.vps", 6),
     ("kis.ws_max_subscriptions", 42)],
)  # fmt: skip
def test_kis_setting_ranges(tmp_path: Path, key: str, value: int) -> None:
    with pytest.raises(VaterError) as e:
        SettingsRepo(open_db(tmp_path)).update({key: value})
    assert e.value.code == "SETTING_INVALID"


def test_hosts() -> None:
    assert REST_HOST[KisServer.PROD] == "https://openapi.koreainvestment.com:9443"
    assert REST_HOST[KisServer.VPS] == "https://openapivts.koreainvestment.com:29443"
    assert WS_HOST[KisServer.PROD] == "ws://ops.koreainvestment.com:21000"
    assert WS_HOST[KisServer.VPS] == "ws://ops.koreainvestment.com:31000"


def test_priority_order() -> None:
    assert Priority.ALERTS < Priority.BRIEFING < Priority.MASTER


def test_load_credentials(tmp_path: Path) -> None:
    store = EnvFileSecretStore(tmp_path / ".env")
    store.set(SecretName.KIS_APP_KEY, "ak")
    store.set(SecretName.KIS_APP_SECRET, "as")
    creds = load_credentials(store)
    assert (creds.app_key, creds.app_secret, creds.hts_id) == ("ak", "as", None)


def test_load_credentials_missing(tmp_path: Path) -> None:
    store = EnvFileSecretStore(tmp_path / ".env")
    store.set(SecretName.KIS_APP_KEY, "ak")
    with pytest.raises(VaterError) as e:
        load_credentials(store)
    assert e.value.code == "KIS_NOT_CONFIGURED" and e.value.status == 409
