import sqlite3
from datetime import date
from pathlib import Path

import pytest

from vater_core.api.errors import VaterError
from vater_core.briefing.store import BriefingRepo
from vater_core.store.db import open_db

DATA = {"market": "KR", "indices": [{"code": "0001", "name": "KOSPI", "value": 4100.5}]}
TEXT = {
    "headline": "반도체가 시장을 이끌었다.",
    "market": "",
    "sectors": "",
    "flows": "",
    "notable": "",
    "watchlist": "",
}


@pytest.fixture
def repo(tmp_path: Path) -> BriefingRepo:
    conn: sqlite3.Connection = open_db(tmp_path)
    return BriefingRepo(conn)


def test_save_and_read_back(repo: BriefingRepo) -> None:
    bid = repo.save("KR", date(2026, 11, 3), DATA, TEXT, [])
    b = repo.get(bid)
    assert (b.market, b.date, b.status, b.missing) == ("KR", "2026-11-03", "done", [])
    assert b.data == DATA and b.text == TEXT
    assert repo.find("KR", date(2026, 11, 3)) == b
    assert repo.find("US", date(2026, 11, 3)) is None


def test_missing_items_make_it_partial(repo: BriefingRepo) -> None:
    bid = repo.save("KR", date(2026, 11, 3), DATA, None, ["flows", "interpretation"])
    b = repo.get(bid)
    assert (b.status, b.text, b.missing) == ("partial", None, ["flows", "interpretation"])


def test_same_market_and_date_is_overwritten(repo: BriefingRepo) -> None:
    first = repo.save("KR", date(2026, 11, 3), DATA, None, ["interpretation"])
    second = repo.save("KR", date(2026, 11, 3), {"market": "KR"}, TEXT, [])
    assert second == first
    assert len(repo.list()) == 1
    b = repo.get(first)
    assert (b.status, b.data, b.text) == ("done", {"market": "KR"}, TEXT)


def test_list_newest_first_with_filter_and_limit(repo: BriefingRepo) -> None:
    a = repo.save("KR", date(2026, 11, 2), DATA, TEXT, [])
    b = repo.save("US", date(2026, 11, 2), DATA, TEXT, [])
    c = repo.save("KR", date(2026, 11, 3), DATA, TEXT, [])
    assert [x.id for x in repo.list()] == [c, b, a]
    assert [x.id for x in repo.list(market="KR")] == [c, a]
    assert [x.id for x in repo.list(limit=1)] == [c]


def test_unknown_id(repo: BriefingRepo) -> None:
    with pytest.raises(VaterError) as e:
        repo.get(42)
    assert (e.value.code, e.value.status) == ("BRIEFING_NOT_FOUND", 404)
