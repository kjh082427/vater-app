"""버전은 한 곳(Cargo.toml)이 기준이고 네 파일과 태그가 같아야 한다 (infra/release Task 1)."""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "apps/desktop/src-tauri/packaging/check-versions.py"
FILES = (
    "apps/desktop/src-tauri/Cargo.toml",
    "apps/desktop/package.json",
    "apps/desktop/package-lock.json",
    "apps/desktop/src-tauri/Cargo.lock",
    "sidecar/pyproject.toml",
    "sidecar/uv.lock",
)


def run(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--root", str(root), *args],
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.fixture
def tree(tmp_path: Path) -> Path:
    for rel in FILES:
        target = tmp_path / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / rel, target)
    return tmp_path


def test_repository_versions_agree() -> None:
    # 저장소가 어긋나면 태그 빌드가 실패하기 전에 여기서 먼저 드러난다
    r = run(REPO)
    assert r.returncode == 0, r.stdout + r.stderr


def test_mismatch_fails_and_names_the_file(tree: Path) -> None:
    p = tree / "apps/desktop/package.json"
    doc = json.loads(p.read_text(encoding="utf-8"))
    doc["version"] = "9.9.9"
    p.write_text(json.dumps(doc), encoding="utf-8")
    r = run(tree)
    assert r.returncode == 1 and "package.json" in r.stdout


def test_tag_must_match(tree: Path) -> None:
    assert run(tree, "--set", "0.1.0").returncode == 0
    assert run(tree, "--tag", "v0.1.0").returncode == 0
    r = run(tree, "--tag", "v0.2.0")
    assert r.returncode == 1 and "v0.2.0" in r.stdout


def test_set_changes_all_files_including_prerelease(tree: Path) -> None:
    assert run(tree, "--set", "0.1.0-rc.1").returncode == 0
    assert run(tree).returncode == 0
    assert run(tree, "--tag", "v0.1.0-rc.1").returncode == 0
    lock = json.loads((tree / "apps/desktop/package-lock.json").read_text(encoding="utf-8"))
    assert lock["version"] == "0.1.0-rc.1" and lock["packages"][""]["version"] == "0.1.0-rc.1"
    cargo = (tree / "apps/desktop/src-tauri/Cargo.toml").read_text(encoding="utf-8")
    assert 'version = "0.1.0-rc.1"' in cargo
    assert 'tauri = { version = "=2.12.4"' in cargo  # 의존성 버전은 건드리지 않는다


@pytest.mark.parametrize("bad", ["1.2", "v1.2.3", "1.2.3.4", "latest"])
def test_set_rejects_non_semver(tree: Path, bad: str) -> None:
    r = run(tree, "--set", bad)
    assert r.returncode == 2 and "SemVer" in r.stdout
    assert run(tree).returncode == 0  # 아무 파일도 바꾸지 않았다


def test_set_updates_lock_files_so_locked_builds_keep_working(tree: Path) -> None:
    assert run(tree, "--set", "0.1.0-rc.1").returncode == 0
    cargo_lock = (tree / "apps/desktop/src-tauri/Cargo.lock").read_text(encoding="utf-8")
    assert 'name = "vater"\nversion = "0.1.0-rc.1"' in cargo_lock
    uv_lock = (tree / "sidecar/uv.lock").read_text(encoding="utf-8")
    assert 'name = "vater-core"\nversion = "0.1.0-rc.1"' in uv_lock


@pytest.mark.parametrize("script", ["check-versions.py", "make-latest-json.py"])
def test_korean_output_survives_a_windows_console_encoding(tmp_path: Path, script: str) -> None:
    """Windows CI의 stdout은 cp1252다. 한글을 찍다가 죽으면 릴리스가 멈춘다."""
    env = {**os.environ, "PYTHONIOENCODING": "cp1252", "PYTHONUTF8": "0"}
    path = SCRIPT.parent / script
    args = (
        ["--root", str(REPO)]
        if script == "check-versions.py"
        else ["--version", "bad", "--sig", "x", "--base-url", "y", "--out", str(tmp_path / "o")]
    )
    r = subprocess.run(
        [sys.executable, str(path), *args], capture_output=True, env=env, check=False
    )
    assert b"UnicodeEncodeError" not in r.stderr, r.stderr
    assert r.returncode in (0, 1)
