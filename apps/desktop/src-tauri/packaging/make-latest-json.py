#!/usr/bin/env python3
"""자동 업데이트가 읽는 latest.json을 만든다 (infra/release Task 4, tauri-plugin-updater 형식).

서명은 Tauri 빌드가 설치 파일 옆에 만든 `.sig` 파일의 내용이다(공개되는 값, 개인 키 아님).
"""

import argparse
import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

SEMVER = re.compile(r"^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--version", required=True)
    ap.add_argument("--sig", required=True, type=Path)
    ap.add_argument("--base-url", required=True, help="릴리스 파일 주소 앞부분(.../releases/download)")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--notes", default="")
    args = ap.parse_args()

    if not SEMVER.match(args.version):
        print(f"SemVer가 아닙니다: {args.version}")
        return 1
    signature = args.sig.read_text(encoding="utf-8").strip()
    if not signature:
        print(f"서명 파일이 비어 있습니다: {args.sig}")
        return 1
    url = f"{args.base_url.rstrip('/')}/v{args.version}/Vater_{args.version}_x64-setup.exe"
    doc = {
        "version": args.version,
        "notes": args.notes,
        "pub_date": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": {"windows-x86_64": {"signature": signature, "url": url}},
    }
    args.out.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{args.out}: {args.version} → {url}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
