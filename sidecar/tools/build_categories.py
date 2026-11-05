"""분류표(catalog.json) 생성 도구. 개발 때만 쓰고 앱은 이 도구도, SEC도 부르지 않는다.

입력: tools/categories/{groups,themes,sic_map}.json (직접 관리) + SEC company_tickers.json와
submissions/CIK*.json의 sic. 거래소(KRX) 자료는 쓰지 않는다(스펙 11장).
SEC 요청의 User-Agent는 환경 변수 SEC_USER_AGENT로만 받는다(값은 출력하지 않는다).

    SEC_USER_AGENT=... uv run python tools/build_categories.py --cache <저장소 밖 폴더>
"""

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import httpx

HERE = Path(__file__).parent
OUT = HERE.parent / "src" / "vater_core" / "categories" / "catalog.json"
TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
WORKERS = 4
DELAY = 0.13  # 요청 하나당 대기. 작업자 수만큼 곱해 SEC 한도(초당 10회)보다 느리게


def parse_sic(submission: dict[str, Any]) -> str | None:
    return str(submission.get("sic") or "") or None


def _mid_for_sic(sic: str, sic_map: dict[str, str | None]) -> str | None:
    for n in range(len(sic), 1, -1):  # 가장 긴 접두어가 이긴다. null이면 미분류
        if sic[:n] in sic_map:
            return sic_map[sic[:n]]
    return None


def build(
    groups: list[dict[str, Any]],
    themes: dict[str, dict[str, Any]],
    sic_map: dict[str, str | None],
    tickers: dict[str, str | None],
) -> dict[str, Any]:
    """tickers: SEC 티커 → SIC(없으면 None). 맞는 중분류가 없는 종목은 넣지 않는다(미분류)."""
    ids = {m["id"] for g in groups for m in g["mids"]}
    for bad in [*(set(themes) - ids), *(set(sic_map.values()) - ids - {None})]:
        raise ValueError(f"groups.json에 없는 중분류: {bad}")
    us: dict[str, list[str]] = {i: list(themes.get(i, {}).get("us", [])) for i in ids}
    for ticker, sic in sorted(tickers.items()):
        mid = _mid_for_sic(sic, sic_map) if sic else None
        code = ticker.replace("-", "/")  # 한투 마스터는 클래스 주식을 BRK/B로 쓴다
        if mid and code not in us[mid]:
            us[mid].append(code)
    return {
        "version": 1,
        "source": "SEC EDGAR(company_tickers, submissions의 SIC)와 직접 작성한 테마 파일",
        "groups": [
            {
                "id": g["id"],
                "name": g["name"],
                "mids": [
                    {
                        "id": m["id"],
                        "name": m["name"],
                        "keywords": themes.get(m["id"], {}).get("keywords", []),
                        "kr": [c for c, _ in themes.get(m["id"], {}).get("kr", [])],
                        "us": us[m["id"]],
                    }
                    for m in g["mids"]
                ],
            }
            for g in groups
        ],
    }


def fetch_sics(cache: Path, user_agent: str) -> dict[str, str | None]:
    """SEC에서 티커별 SIC를 받는다. 받은 값은 cache/sic.json에 쌓아 두어 다시 받지 않는다."""
    headers = {"User-Agent": user_agent}
    cache.mkdir(parents=True, exist_ok=True)
    with httpx.Client(headers=headers, timeout=30) as http:
        raw = http.get(TICKERS_URL)
        raw.raise_for_status()
        rows = list(raw.json().values())
        path = cache / "sic.json"
        by_cik: dict[str, str | None] = json.loads(path.read_text()) if path.exists() else {}
        todo = sorted({str(r["cik_str"]) for r in rows} - set(by_cik))

        def one(cik: str) -> tuple[str, str | None]:
            for attempt in range(4):
                time.sleep(DELAY * WORKERS)  # 전체로는 초당 10회 아래
                r = http.get(SUBMISSIONS_URL.format(cik=int(cik)))
                if r.status_code == 404:
                    return cik, None
                if r.status_code == 200:
                    return cik, parse_sic(r.json())
                time.sleep(2 * (attempt + 1))  # 429 등은 쉬었다가 다시
            r.raise_for_status()
            raise RuntimeError(cik)

        with ThreadPoolExecutor(WORKERS) as pool:
            for i, (cik, sic) in enumerate(pool.map(one, todo), 1):
                by_cik[cik] = sic
                if i % 500 == 0:
                    path.write_text(json.dumps(by_cik))
                    print(f"SIC {i}/{len(todo)}", file=sys.stderr)
        path.write_text(json.dumps(by_cik))
    return {r["ticker"]: by_cik.get(str(r["cik_str"])) for r in rows}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", type=Path, required=True, help="받은 SIC를 쌓는 폴더(저장소 밖)")
    args = ap.parse_args()
    ua = os.environ.get("SEC_USER_AGENT")
    if not ua:
        sys.exit("환경 변수 SEC_USER_AGENT가 필요하다 (SEC 요청자 식별용)")
    src = HERE / "categories"
    load = lambda n: json.loads((src / n).read_text(encoding="utf-8"))  # noqa: E731
    cat = build(
        load("groups.json"), load("themes.json"), load("sic_map.json"), fetch_sics(args.cache, ua)
    )
    OUT.write_text(json.dumps(cat, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
