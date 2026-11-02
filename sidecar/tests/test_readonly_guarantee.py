"""앱은 주문하지 않는다 (스펙 7-4). 주문·정정·취소 API를 부르는 코드가 하나라도 생기면 실패한다."""

import re
from pathlib import Path

ORDER_TR_ID = re.compile(r"\b[TV]TT[A-Z]\d{4}U\b")  # 한투 주문·정정·취소 TR ID (끝자리 U)
ORDER_PATH = re.compile(r"/trading/order")  # 국내·해외 주문 엔드포인트 경로
SCANNED = {".py", ".json", ".sql", ".toml", ".yaml", ".yml"}
SRC = Path(__file__).parents[1] / "src"


def find_order_references(root: Path) -> list[str]:
    hits = []
    for p in sorted(root.rglob("*")):
        if p.is_file() and p.suffix in SCANNED:
            for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
                if ORDER_TR_ID.search(line) or ORDER_PATH.search(line):
                    hits.append(f"{p.relative_to(root)}:{i}")
    return hits


def test_no_order_api_in_source() -> None:
    assert find_order_references(SRC) == []


def test_guard_patterns_catch_known_order_ids() -> None:
    for s in ["TTTC0802U", "VTTC0801U", "TTTC0012U", "TTTT1002U", "TTTS1002U",
              "/uapi/domestic-stock/v1/trading/order-cash",
              "/uapi/overseas-stock/v1/trading/order-rvsecncl"]:  # fmt: skip
        assert ORDER_TR_ID.search(s) or ORDER_PATH.search(s), s
    for s in ["FHKST01010100", "HHDFS00000300", "TTTC8434R", "/uapi/domestic-stock/v1/quotations"]:
        assert not (ORDER_TR_ID.search(s) or ORDER_PATH.search(s)), s


def test_guard_scans_non_python_files(tmp_path: Path) -> None:
    (tmp_path / "tr_ids.json").write_text('{"buy": "TTTC0802U"}', encoding="utf-8")
    assert find_order_references(tmp_path) == ["tr_ids.json:1"]
