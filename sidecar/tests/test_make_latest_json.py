"""자동 업데이트가 읽는 latest.json 만들기 (infra/release Task 4)."""

import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "apps/desktop/src-tauri/packaging/make-latest-json.py"
BASE = "https://github.com/kjh082427/vater-releases/releases/download"


def run(tmp: Path, *extra: str, version: str = "0.2.0", sig: str = "c2lnbmF0dXJl\n"):
    (tmp / "x.sig").write_text(sig, encoding="utf-8")
    out = tmp / "latest.json"
    r = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--version",
            version,
            "--sig",
            str(tmp / "x.sig"),
            "--base-url",
            BASE,
            "--out",
            str(out),
            *extra,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    return r, out


def test_shape_for_the_windows_updater(tmp_path: Path) -> None:
    r, out = run(tmp_path, "--notes", "알림 수정")
    assert r.returncode == 0, r.stderr
    doc = json.loads(out.read_text(encoding="utf-8"))
    assert doc["version"] == "0.2.0" and doc["notes"] == "알림 수정"
    assert datetime.fromisoformat(doc["pub_date"].replace("Z", "+00:00")).tzinfo is not None
    assert doc["pub_date"].endswith("Z")
    win = doc["platforms"]["windows-x86_64"]
    assert win["url"] == f"{BASE}/v0.2.0/Vater_0.2.0_x64-setup.exe"
    assert win["signature"] == "c2lnbmF0dXJl"  # 끝 줄바꿈 없이 그대로


def test_prerelease_version_in_url(tmp_path: Path) -> None:
    r, out = run(tmp_path, version="0.2.0-rc.1")
    assert r.returncode == 0, r.stderr
    win = json.loads(out.read_text(encoding="utf-8"))["platforms"]["windows-x86_64"]
    assert win["url"] == f"{BASE}/v0.2.0-rc.1/Vater_0.2.0-rc.1_x64-setup.exe"


def test_notes_default_to_empty(tmp_path: Path) -> None:
    _, out = run(tmp_path)
    assert json.loads(out.read_text(encoding="utf-8"))["notes"] == ""


def test_empty_signature_is_refused(tmp_path: Path) -> None:
    r, out = run(tmp_path, sig="  \n")
    assert r.returncode == 1 and "서명" in r.stdout
    assert not out.exists()


def test_non_semver_version_is_refused(tmp_path: Path) -> None:
    r, out = run(tmp_path, version="latest")
    assert r.returncode == 1 and not out.exists()
