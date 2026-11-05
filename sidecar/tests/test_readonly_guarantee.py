"""앱은 주문하지 않는다 (스펙 7-4). 주문·정정·취소 API를 부르는 코드가 하나라도 생기면 실패한다."""

import re
from pathlib import Path

ORDER_TR_ID = re.compile(r"\b[A-Z]{4}\d{4}U\b")  # 한투 주문·정정·취소 TR ID (끝자리 U)
ORDER_PATH = re.compile(r"/trading/[\w-]*(order|rsvn)")  # 주문·주간주문·예약주문 경로
# 키움 주문·신용주문·금현물·미국 주문 경로와 TR (공식 명세 kiwoom_api_spec.json으로 확인)
KIWOOM_ORDER = re.compile(
    r"/api/dostk/(crd)?ordr|/api/us/(ordr|exchange)|\bkt1000[0-9]\b|\bkt5000[0-3]\b"
    r"|\bust2000[0-3]\b|\bust31490\b|\bust3130[0-2]\b"
)
# 메리츠 주문·예약주문·해외 주문·환전 경로와 TR (공식 카탈로그로 확인)
MERITZ_ORDER = re.compile(
    r"/oauth2/revoke|/trading/v1/|/forex/v1/exchanges|\bobtr[so]_oder_\d{3}a\b|\bobtsd_fbnk_\d{3}a\b"
)
SCANNED = {".py", ".json", ".sql", ".toml", ".yaml", ".yml"}
SRC = Path(__file__).parents[1] / "src"


def find_order_references(root: Path) -> list[str]:
    hits = []
    for p in sorted(root.rglob("*")):
        if p.is_file() and p.suffix in SCANNED:
            for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
                if (
                    ORDER_TR_ID.search(line)
                    or ORDER_PATH.search(line)
                    or KIWOOM_ORDER.search(line)
                    or MERITZ_ORDER.search(line)
                ):
                    hits.append(f"{p.relative_to(root)}:{i}")
    return hits


def test_no_order_api_in_source() -> None:
    assert find_order_references(SRC) == []


def test_guard_patterns_catch_known_order_ids() -> None:
    for s in ["TTTC0802U", "VTTC0801U", "TTTC0012U", "TTTT1002U", "TTTS1002U", "CTSC0008U",
              "/uapi/overseas-stock/v1/trading/daytime-order",
              "/uapi/overseas-stock/v1/trading/order-resv",
              "/uapi/domestic-stock/v1/trading/order-cash",
              "/uapi/overseas-stock/v1/trading/order-rvsecncl"]:  # fmt: skip
        assert ORDER_TR_ID.search(s) or ORDER_PATH.search(s), s
    for s in ["FHKST01010100", "HHDFS00000300", "TTTC8434R", "/uapi/domestic-stock/v1/quotations"]:
        assert not (ORDER_TR_ID.search(s) or ORDER_PATH.search(s)), s


def test_guard_catches_kiwoom_order_ids(tmp_path: Path) -> None:
    (tmp_path / "a.py").write_text(
        'API = "kt10000"\nPATH = "/api/dostk/ordr"\nC = "/api/dostk/crdordr"\nK = "kt10009"\n'
        'G = "kt50003"\nU = "/api/us/ordr"\nV = "ust20001"\nW = "ust31490"\n'
        'X = "/api/us/exchange"\nY = "ust31302"\n',
        encoding="utf-8",
    )
    (tmp_path / "b.py").write_text(
        'API = "kt00018"\nPATH = "/api/dostk/acnt"\nU = "/api/us/acnt"\nV = "ust21070"\n',
        encoding="utf-8",
    )
    assert find_order_references(tmp_path) == [f"a.py:{i}" for i in range(1, 11)]


def test_guard_scans_non_python_files(tmp_path: Path) -> None:
    (tmp_path / "tr_ids.json").write_text('{"buy": "TTTC0802U"}', encoding="utf-8")
    assert find_order_references(tmp_path) == ["tr_ids.json:1"]


def test_guard_catches_meritz_order_ids(tmp_path: Path) -> None:
    (tmp_path / "a.py").write_text(
        'A = "/trading/v1/orders/buy"\nB = "/trading/v1/overseas/reserved-orders/sell"\n'
        'C = "/forex/v1/exchanges"\nD = "obtrs_oder_101a"\nE = "obtro_oder_112a"\n'
        'F = "obtsd_fbnk_202a"\n',
        encoding="utf-8",
    )
    (tmp_path / "b.py").write_text(
        'A = "/accounts/v1/me/holdings"\nB = "obacb_balc_114r"\nC = "obtro_oder_110r"\n',
        encoding="utf-8",
    )
    assert find_order_references(tmp_path) == [f"a.py:{i}" for i in range(1, 7)]
