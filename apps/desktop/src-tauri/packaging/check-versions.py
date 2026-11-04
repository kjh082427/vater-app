#!/usr/bin/env python3
"""앱 버전을 한 곳에서 맞춘다 (infra/release Task 1).

기준은 `apps/desktop/src-tauri/Cargo.toml`의 [package] version이다. 설치 파일 이름과 Tauri 버전이 여기서 나온다.

    check-versions.py                 여섯 파일이 같은지 검사
    check-versions.py --tag v0.1.0    태그와 기준 버전이 같은지도 검사
    check-versions.py --set 0.1.0     여섯 파일을 모두 바꿈

종료 코드: 0 일치, 1 불일치, 2 잘못된 인자(SemVer가 아님).
"""

import argparse
import json
import re
import sys
from pathlib import Path

SEMVER = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$"
)
CARGO = "apps/desktop/src-tauri/Cargo.toml"
PACKAGE = "apps/desktop/package.json"
LOCK = "apps/desktop/package-lock.json"
PYPROJECT = "sidecar/pyproject.toml"
CARGO_LOCK = "apps/desktop/src-tauri/Cargo.lock"
UV_LOCK = "sidecar/uv.lock"
# 첫 [package]/[project] 표의 version 줄만 고른다. 의존성 줄(tauri = { version = ...})은 건드리지 않는다.
TABLE_VERSION = {
    CARGO: re.compile(r'(^\[package\]\n(?:(?!^\[).*\n)*?^version = ")([^"]+)(")', re.M),
    PYPROJECT: re.compile(r'(^\[project\]\n(?:(?!^\[).*\n)*?^version = ")([^"]+)(")', re.M),
    CARGO_LOCK: re.compile(r'(^name = "vater"\nversion = ")([^"]+)(")', re.M),
    UV_LOCK: re.compile(r'(^name = "vater-core"\nversion = ")([^"]+)(")', re.M),
}


def _toml_version(root: Path, rel: str) -> str:
    m = TABLE_VERSION[rel].search((root / rel).read_text(encoding="utf-8"))
    if m is None:
        raise SystemExit(f"{rel}: version 줄을 찾지 못했습니다")
    return m.group(2)


def read_versions(root: Path) -> dict[str, str]:
    package = json.loads((root / PACKAGE).read_text(encoding="utf-8"))
    lock = json.loads((root / LOCK).read_text(encoding="utf-8"))
    return {
        CARGO: _toml_version(root, CARGO),
        PACKAGE: package["version"],
        f"{LOCK} (version)": lock["version"],
        f'{LOCK} (packages."")': lock["packages"][""]["version"],
        PYPROJECT: _toml_version(root, PYPROJECT),
        CARGO_LOCK: _toml_version(root, CARGO_LOCK),
        UV_LOCK: _toml_version(root, UV_LOCK),
    }


def set_versions(root: Path, version: str) -> None:
    for rel, pattern in TABLE_VERSION.items():
        path = root / rel
        text, n = pattern.subn(rf"\g<1>{version}\g<3>", path.read_text(encoding="utf-8"), count=1)
        if n != 1:
            raise SystemExit(f"{rel}: version 줄을 찾지 못했습니다")
        path.write_text(text, encoding="utf-8", newline="\n")
    for rel in (PACKAGE, LOCK):
        path = root / rel
        doc = json.loads(path.read_text(encoding="utf-8"))
        doc["version"] = version
        if "packages" in doc:
            doc["packages"][""]["version"] = version
        path.write_text(
            json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
        )


def main() -> int:
    # Windows 콘솔은 cp1252라 한글을 찍다가 죽는다(CI에서 확인됨)
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    ap = argparse.ArgumentParser(description=__doc__, exit_on_error=False)
    ap.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[4])
    ap.add_argument("--tag")
    ap.add_argument("--set", dest="new")
    args = ap.parse_args()

    if args.new is not None:
        if not SEMVER.match(args.new):
            print(f"SemVer가 아닙니다: {args.new}")
            return 2
        set_versions(args.root, args.new)

    versions = read_versions(args.root)
    base = versions[CARGO]
    wrong = {k: v for k, v in versions.items() if v != base}
    for k, v in wrong.items():
        print(f"불일치: {k} = {v} (기준 {CARGO} = {base})")
    if args.tag is not None and args.tag != f"v{base}":
        print(f"태그 {args.tag}이(가) 기준 버전 v{base}과(와) 다릅니다")
        return 1
    if wrong:
        return 1
    print(f"버전 일치: {base}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
