"""CSV로 보유 종목 가져오기 (v2 설계 14장).

증권사마다 파일 형식이 달라 열을 이름으로 추정하고, 틀리면 사용자가 고른다.
올리는 내용은 행마다 검사해 이유를 보여 준다. 파일이 깨졌어도 앱은 멈추지 않는다.
"""

import csv
import io
import sqlite3
from dataclasses import dataclass, field
from decimal import Decimal

from pydantic import TypeAdapter, ValidationError

from vater_core.api.errors import VaterError
from vater_core.kis.master import search_symbols
from vater_core.store.holdings import AvgPrice, Quantity

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 1000  # 행마다 종목을 찾느라 이벤트 루프를 쓴다. 개인 계좌에 이보다 많을 일은 없다
_CANDIDATES = 5
_QUANTITY_VALUE: TypeAdapter[Decimal] = TypeAdapter(Quantity)
_PRICE_VALUE: TypeAdapter[Decimal] = TypeAdapter(AvgPrice)
_NAME = {"종목명", "종목", "name"}
_CODE = {"종목코드", "코드", "티커", "code", "ticker", "symbol"}
_QUANTITY = {"보유수량", "잔고수량", "수량", "보유주수", "주수", "잔고"}
_AVG = {"평균단가", "매입단가", "평균매수가", "평균매입가", "매입평균가", "평단가", "평단"}


def csv_invalid(message: str, hint: str | None = None) -> VaterError:
    return VaterError("CSV_INVALID", message, hint, status=422)


def decode_csv(data: bytes) -> str:
    if len(data) > MAX_BYTES:
        raise csv_invalid("파일이 너무 큽니다.", "2MB 이하의 파일을 올려 주세요.")
    if not data.strip():
        raise csv_invalid("파일이 비어 있습니다.")
    for encoding in ("utf-8-sig", "cp949"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise csv_invalid("파일을 읽지 못했습니다.", "CSV 형식으로 저장한 파일을 올려 주세요.")


def parse_table(text: str) -> tuple[list[str], list[list[str]]]:
    first = text.lstrip().splitlines()[0] if text.strip() else ""
    delimiter = max(",\t;", key=first.count)
    try:
        rows = [
            [c.strip() for c in r]
            for r in csv.reader(io.StringIO(text, newline=""), delimiter=delimiter)
            if any(c.strip() for c in r)
        ]
    except csv.Error:
        raise csv_invalid(
            "파일을 읽지 못했습니다.", "CSV 형식으로 저장한 파일을 올려 주세요."
        ) from None
    if not rows:
        raise csv_invalid("파일에 내용이 없습니다.")
    if len(rows) > MAX_ROWS + 1:
        raise csv_invalid("행이 너무 많습니다.", f"{MAX_ROWS}행 이하로 올려 주세요.")
    return rows[0], rows[1:]


@dataclass(frozen=True)
class ColumnGuess:
    name: str | None = None
    code: str | None = None
    quantity: str | None = None
    avg_price: str | None = None


def guess_columns(columns: list[str]) -> ColumnGuess:
    def pick(names: set[str]) -> str | None:
        return next((c for c in columns if c.replace(" ", "").lower() in names), None)

    return ColumnGuess(pick(_NAME), pick(_CODE), pick(_QUANTITY), pick(_AVG))


@dataclass
class CsvRow:
    row: int
    name: str
    market: str | None = None
    code: str | None = None
    quantity: Decimal | None = None
    avg_price: Decimal | None = None
    error: str | None = None
    candidates: list[dict[str, str]] = field(default_factory=list)


def _number(raw: str, rule: TypeAdapter[Decimal]) -> Decimal | None:
    """저장할 때와 같은 규칙으로 검사한다. 미리보기를 통과한 값은 저장도 된다."""
    try:
        return rule.validate_python(Decimal(raw.replace(",", "").replace(" ", "")).normalize())
    except (ArithmeticError, ValidationError):
        return None


def _lookup(db: sqlite3.Connection, code: str, name: str) -> list[tuple[str, str, str]]:
    if code:
        wanted = code.strip().strip('="').upper()  # 엑셀의 ="000660" 형태
        if wanted.isdigit():
            wanted = wanted.zfill(6)  # 엑셀이 지운 앞자리 0
        # 7자리이고 A로 시작하면 증권사 표기다. 영문 티커는 이보다 짧다
        prefixed = wanted.startswith("A") and len(wanted) == 7
        options = [wanted, wanted[1:]] if prefixed else [wanted]
        for option in options:
            rows = db.execute(
                "SELECT market, code, name FROM symbols WHERE code = ?", (option,)
            ).fetchall()
            if rows:
                return list(rows)
        return []
    clean = name.removesuffix("보통주").strip()
    return list(db.execute("SELECT market, code, name FROM symbols WHERE name = ?", (clean,)))


def build_rows(
    db: sqlite3.Connection, columns: list[str], table: list[list[str]], guess: ColumnGuess
) -> list[CsvRow]:
    """행을 해석한다. 종목(이름이나 코드)과 수량 열을 모르면 아직 고를 수 없으므로 빈 목록이다."""
    if not (guess.name or guess.code) or not guess.quantity:
        return []

    def cell(values: list[str], column: str | None) -> str:
        if column is None or column not in columns:
            return ""
        i = columns.index(column)
        return values[i] if i < len(values) else ""

    out: list[CsvRow] = []
    seen: set[tuple[str, str]] = set()
    for number, values in enumerate(table, start=2):
        name, code = cell(values, guess.name), cell(values, guess.code)
        row = CsvRow(number, name or code)
        found = _lookup(db, code, name)
        if not found:
            row.error = "종목을 찾지 못했습니다."
            if name and not code:
                row.candidates = [
                    {"market": s.market, "code": s.code, "name": s.name}
                    for s in search_symbols(db, name, _CANDIDATES)
                ]
        elif len(found) > 1:
            row.error = "같은 이름의 종목이 여럿입니다. 하나를 골라 주세요."
            row.candidates = [{"market": m, "code": c, "name": n} for m, c, n in found]
        else:
            row.market, row.code, row.name = found[0]
        row.quantity = _number(cell(values, guess.quantity), _QUANTITY_VALUE)
        row.avg_price = _number(cell(values, guess.avg_price), _PRICE_VALUE)
        if row.error is None and row.quantity is None:
            row.error = "수량이 올바르지 않습니다."
        elif row.error is None and row.avg_price is None:
            row.error = "평균 매수가가 없거나 올바르지 않습니다."
        if row.error is None and row.market and row.code:
            key = (row.market, row.code)
            if key in seen:
                row.error = "같은 종목이 두 번 있습니다."
            seen.add(key)
        out.append(row)
    return out
