#!/usr/bin/env python3
"""acceptance-publish.ps1이 쓰는 가짜 gh. 비밀값 없이 올리기 스크립트의 흐름을 확인한다."""

import json
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(os.environ["FAKE_GH_DIR"])
STATE = ROOT / "state.json"
ASSETS = ROOT / "assets"


def load() -> dict | None:
    return json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else None


def save(state: dict) -> None:
    STATE.write_text(json.dumps(state), encoding="utf-8")


def main() -> int:
    args = sys.argv[1:]
    with (ROOT / "calls.log").open("a", encoding="utf-8") as log:
        log.write(" ".join(args[:3]) + "\n")
    if args[:1] != ["release"]:
        return 2
    verb = args[1]
    state = load()
    if verb == "view":
        if state is None:
            print("release not found", file=sys.stderr)
            return 1
        print("true" if state["draft"] else "false")
        return 0
    if verb == "delete":
        STATE.unlink()
        shutil.rmtree(ASSETS, ignore_errors=True)
        return 0
    if verb == "create":
        if state is not None:
            print("a release with the same tag name already exists", file=sys.stderr)
            return 1
        ASSETS.mkdir(parents=True, exist_ok=True)
        for f in (a for a in args[3:] if Path(a).is_file()):
            shutil.copy(f, ASSETS)
        save({"draft": "--draft" in args, "prerelease": False, "latest": False})
        return 0
    if verb == "download":
        dest = Path(args[args.index("--dir") + 1])
        for f in ASSETS.iterdir():
            shutil.copy(f, dest)
        if os.environ.get("FAKE_GH_CORRUPT") == "1":
            target = next(dest.glob("*-setup.exe"))
            target.write_bytes(target.read_bytes() + b"x")
        return 0
    if verb == "edit":
        assert state is not None
        state["draft"] = False
        state["prerelease"] = "--prerelease" in args
        state["latest"] = "--latest" in args
        save(state)
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
