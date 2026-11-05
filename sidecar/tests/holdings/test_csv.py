"""CSV 가져오기 (v2 설계 14장)."""

from decimal import Decimal

import httpx
import pytest

from vater_core.api.deps import AppDeps
from vater_core.holdings.csv_import import MAX_ROWS, decode_csv, guess_columns, parse_table


def seed(deps: AppDeps) -> None:
    assert deps.db is not None
    deps.db.executemany(
        "INSERT INTO symbols (market, code, exchange, name, name_en, kind) VALUES (?,?,?,?,?,?)",
        [
            ("KR", "005930", "KOSPI", "삼성전자", None, "stock"),
            ("KR", "000660", "KOSPI", "SK하이닉스", None, "stock"),
            ("KR", "111111", "KOSPI", "같은이름", None, "stock"),
            ("KR", "222222", "KOSDAQ", "같은이름", None, "stock"),
            ("US", "AAPL", "NAS", "애플", "Apple", "stock"),
        ],
    )
    deps.db.commit()


GOOD = '종목명,보유수량,평균단가\n삼성전자,"1,000","71,400"\nSK하이닉스,5,198500\n'


async def preview(c: httpx.AsyncClient, data: bytes, **params: str) -> httpx.Response:
    return await c.post(
        "/holdings/csv/preview",
        content=data,
        params={"broker_id": "samsung", **params},
        headers={"Content-Type": "text/csv"},
    )


def test_decode_utf8_bom_and_cp949() -> None:
    assert decode_csv("가,나".encode("utf-8-sig")) == "가,나"
    assert decode_csv("가,나".encode("cp949")) == "가,나"


def test_parse_table_handles_tabs_and_blank_lines() -> None:
    cols, rows = parse_table("a\tb\n1\t2\n\n3\t4\n")
    assert cols == ["a", "b"] and rows == [["1", "2"], ["3", "4"]]


@pytest.mark.parametrize(
    ("columns", "expected"),
    [
        (["종목명", "보유수량", "평균단가"], ("종목명", None, "보유수량", "평균단가")),
        (["종목코드", "잔고수량", "매입단가"], (None, "종목코드", "잔고수량", "매입단가")),
        (["종목 명", "수량", "평단가", "기타"], ("종목 명", None, "수량", "평단가")),
        (["a", "b"], (None, None, None, None)),
    ],
)
def test_guess_columns(columns: list[str], expected: tuple[str | None, ...]) -> None:
    g = guess_columns(columns)
    assert (g.name, g.code, g.quantity, g.avg_price) == expected


async def test_preview_good_file_in_both_encodings(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    seed(deps)
    for data in (GOOD.encode("cp949"), GOOD.encode("utf-8-sig")):
        r = await preview(client, data)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["guess"]["name"] == "종목명"
        rows = body["rows"]
        assert (rows[0]["market"], rows[0]["code"], rows[0]["quantity"], rows[0]["avg_price"]) == (
            "KR",
            "005930",
            "1000",
            71400,
        )
        assert rows[0]["error"] is None and rows[1]["code"] == "000660"


@pytest.mark.parametrize(
    ("line", "needle"),
    [
        ("삼성전자,-1,100", "수량"),
        ("삼성전자,0,100", "수량"),
        ("삼성전자,abc,100", "수량"),
        ("삼성전자,1,", "평균 매수가"),
        ("삼성전자,1,0", "평균 매수가"),
        ("없는종목,1,100", "찾지 못"),
    ],
)
async def test_bad_rows_show_a_reason_and_others_survive(
    client: httpx.AsyncClient, deps: AppDeps, line: str, needle: str
) -> None:
    seed(deps)
    data = f"종목명,보유수량,평균단가\n{line}\nSK하이닉스,5,198500\n".encode()
    rows = (await preview(client, data)).json()["rows"]
    assert needle in rows[0]["error"]
    assert rows[1]["error"] is None


async def test_same_name_offers_candidates(client: httpx.AsyncClient, deps: AppDeps) -> None:
    seed(deps)
    data = "종목명,수량,평단가\n같은이름,1,100\n".encode()
    row = (await preview(client, data)).json()["rows"][0]
    assert "여럿" in row["error"]
    assert {c["code"] for c in row["candidates"]} == {"111111", "222222"}


async def test_code_column_wins_and_kiwoom_style_prefix_is_stripped(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    seed(deps)
    data = "종목코드,수량,평단가\nA005930,1,100\nAAPL,0.5,200\n".encode()
    rows = (await preview(client, data)).json()["rows"]
    assert (rows[0]["market"], rows[0]["code"]) == ("KR", "005930")
    assert (rows[1]["market"], rows[1]["code"], rows[1]["quantity"]) == ("US", "AAPL", "0.5")


async def test_user_can_override_columns(client: httpx.AsyncClient, deps: AppDeps) -> None:
    seed(deps)
    data = "x,y,z\n삼성전자,3,100\n".encode()
    body = (await preview(client, data)).json()
    assert body["guess"]["name"] is None and body["rows"] == []
    body = (await preview(client, data, name_col="x", quantity_col="y", avg_price_col="z")).json()
    assert body["rows"][0]["code"] == "005930"


async def test_duplicate_symbol_in_file_is_flagged(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    seed(deps)
    data = "종목명,수량,평단가\n삼성전자,1,100\n삼성전자,2,100\n".encode()
    rows = (await preview(client, data)).json()["rows"]
    assert rows[0]["error"] is None and "두 번" in rows[1]["error"]


async def test_too_large_or_garbage_is_refused(client: httpx.AsyncClient) -> None:
    r = await preview(client, b"a" * (2 * 1024 * 1024 + 1))
    assert r.status_code == 422 and r.json()["code"] == "CSV_INVALID"
    r = await preview(client, b"\xff\xfe\x00\x00\xff" * 10)
    assert r.status_code == 422 and r.json()["code"] == "CSV_INVALID"
    assert (await preview(client, b"")).status_code == 422


async def test_preview_reports_changes_and_commit_replaces_manual_rows(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    seed(deps)
    await client.put(
        "/holdings/manual",
        json={
            "broker_id": "samsung",
            "market": "KR",
            "code": "000660",
            "quantity": "9",
            "avg_price": 1,
        },
    )
    await client.put(
        "/holdings/manual",
        json={
            "broker_id": "samsung",
            "market": "US",
            "code": "AAPL",
            "quantity": "1",
            "avg_price": 1,
        },
    )
    body = (await preview(client, GOOD.encode())).json()
    assert body["changes"] == {"added": 1, "updated": 1, "removed": 1}
    rows = [
        {
            "market": x["market"],
            "code": x["code"],
            "quantity": x["quantity"],
            "avg_price": x["avg_price"],
        }
        for x in body["rows"]
    ]
    r = await client.post("/holdings/csv/commit", json={"broker_id": "samsung", "rows": rows})
    assert r.status_code == 200 and r.json() == {"added": 1, "updated": 1, "removed": 1}
    got = {h["code"]: h for h in (await client.get("/holdings")).json()}
    assert set(got) == {"005930", "000660"}
    assert Decimal(got["000660"]["quantity"]) == 5 and got["000660"]["source"] == "csv"


async def test_commit_is_all_or_nothing(client: httpx.AsyncClient, deps: AppDeps) -> None:
    seed(deps)
    await client.put(
        "/holdings/manual",
        json={
            "broker_id": "samsung",
            "market": "US",
            "code": "AAPL",
            "quantity": "1",
            "avg_price": 1,
        },
    )
    r = await client.post(
        "/holdings/csv/commit",
        json={
            "broker_id": "samsung",
            "rows": [{"market": "KR", "code": "999999", "quantity": "1", "avg_price": 1}],
        },
    )
    assert r.status_code == 404
    assert [h["code"] for h in (await client.get("/holdings")).json()] == ["AAPL"]


async def test_csv_refused_for_connected_or_unknown_broker(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    seed(deps)
    assert (await preview(client, GOOD.encode(), broker_id="nope")).status_code == 422


@pytest.mark.parametrize("line_end", ["\r", "\r\n", "\n"])
async def test_any_line_ending_is_read(
    client: httpx.AsyncClient, deps: AppDeps, line_end: str
) -> None:
    seed(deps)
    text = line_end.join(["종목명,수량,평단가", "삼성전자,5,70000", ""])
    r = await preview(client, text.encode())
    assert r.status_code == 200, r.text
    assert r.json()["rows"][0]["code"] == "005930"


async def test_oversized_field_or_too_many_rows_is_refused(client: httpx.AsyncClient) -> None:
    r = await preview(client, b'a,b\n"' + b"x" * 140_000 + b'",1\n')
    assert r.status_code == 422 and r.json()["code"] == "CSV_INVALID"
    r = await preview(client, b"a,b\n" + b"x,1\n" * (MAX_ROWS + 1))
    assert r.status_code == 422 and r.json()["code"] == "CSV_INVALID"


@pytest.mark.parametrize(
    ("qty", "avg"),
    [
        ("1E+1000000", "70000"),
        ("1E-1000000", "70000"),
        ("0.123456789", "70000"),  # 수량은 소수 8자리까지
        ("5", "1e400"),
        ("5", "12345.12345"),  # 평단가는 소수 4자리까지
        ("5", "NaN"),
    ],
)
async def test_numbers_the_commit_would_refuse_are_row_errors(
    client: httpx.AsyncClient, deps: AppDeps, qty: str, avg: str
) -> None:
    seed(deps)
    r = await preview(client, f"종목명,수량,평단가\n삼성전자,{qty},{avg}\n".encode())
    assert r.status_code == 200 and len(r.text) < 2000
    assert r.json()["rows"][0]["error"]


async def test_everything_the_preview_accepts_can_be_committed(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    seed(deps)
    data = "종목명,수량,평단가\n삼성전자,0.12345678,12345.1234\nSK하이닉스,100.0000000000,5.00000\n"
    rows = (await preview(client, data.encode())).json()["rows"]
    assert [x["error"] for x in rows] == [None, None]
    r = await client.post(
        "/holdings/csv/commit",
        json={
            "broker_id": "samsung",
            "rows": [{k: x[k] for k in ("market", "code", "quantity", "avg_price")} for x in rows],
        },
    )
    assert r.status_code == 200, r.text


async def test_commit_refuses_empty_or_repeated_rows(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    seed(deps)
    row = {"market": "KR", "code": "005930", "quantity": "1", "avg_price": 100}
    await client.post("/holdings/csv/commit", json={"broker_id": "samsung", "rows": [row]})
    for rows in ([], [row, row]):
        r = await client.post("/holdings/csv/commit", json={"broker_id": "samsung", "rows": rows})
        assert r.status_code == 422 and r.json()["code"] == "CSV_INVALID"
    assert len((await client.get("/holdings")).json()) == 1


@pytest.mark.parametrize(
    ("column", "value", "code"),
    [
        ("종목코드", "5930", "005930"),  # 엑셀이 앞자리 0을 지운 값
        ("종목코드", '"=""000660"""', "000660"),  # 엑셀 수식 형태
        ("종목명", "삼성전자보통주", "005930"),
    ],
)
async def test_common_spreadsheet_forms_are_understood(
    client: httpx.AsyncClient, deps: AppDeps, column: str, value: str, code: str
) -> None:
    seed(deps)
    data = f"{column},수량,평단가\n{value},5,70000\n".encode()
    assert (await preview(client, data)).json()["rows"][0]["code"] == code


async def test_alphanumeric_kr_code_with_a_prefix(client: httpx.AsyncClient, deps: AppDeps) -> None:
    seed(deps)
    assert deps.db is not None
    deps.db.execute(
        "INSERT INTO symbols VALUES ('KR', '0088M0', 'KOSPI', '메쎄이상', NULL, 'stock')"
    )
    r = await preview(
        client, b"code,\xec\x88\x98\xeb\x9f\x89,\xed\x8f\x89\xeb\x8b\xa8\nA0088M0,5,70000\n"
    )
    assert r.json()["rows"][0]["code"] == "0088M0"


async def test_unmatched_name_offers_search_results(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    seed(deps)
    r = await preview(client, "종목명,수량,평단가\nApple,5,150\n".encode())
    row = r.json()["rows"][0]
    assert row["error"] and [c["code"] for c in row["candidates"]] == ["AAPL"]


def test_code_lookup_uses_an_index(deps: AppDeps) -> None:
    assert deps.db is not None
    plan = deps.db.execute("EXPLAIN QUERY PLAN SELECT * FROM symbols WHERE code = 'A'").fetchall()
    assert "USING INDEX" in str(plan) or "USING COVERING INDEX" in str(plan)
