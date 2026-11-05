"""분류표 생성 도구: 네트워크 없이 작은 입력으로 로직만 확인한다."""

import importlib.util
from pathlib import Path

import pytest

_PATH = Path(__file__).parents[2] / "tools" / "build_categories.py"
_spec = importlib.util.spec_from_file_location("build_categories", _PATH)
assert _spec and _spec.loader
bc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bc)

GROUPS = [
    {
        "id": "it",
        "name": "IT",
        "mids": [{"id": "semi", "name": "반도체"}, {"id": "hw", "name": "IT 하드웨어"}],
    },
    {"id": "fin", "name": "금융", "mids": [{"id": "bank", "name": "은행"}]},
]
THEMES = {
    "semi": {"keywords": ["반도체 소켓"], "kr": [["058470", "리노공업"]], "us": ["NVDA"]},
    "bank": {"keywords": [], "kr": [], "us": []},
}
SIC_MAP = {"3674": "semi", "357": "hw", "60": "bank", "6770": None}


def _build(tickers: dict[str, str | None]) -> dict:
    return bc.build(GROUPS, THEMES, SIC_MAP, tickers)


def _mid(cat: dict, mid_id: str) -> dict:
    return next(m for g in cat["groups"] for m in g["mids"] if m["id"] == mid_id)


def test_longest_prefix_wins_and_theme_picks_come_first() -> None:
    cat = _build({"AMD": "3674", "NVDA": "3674", "DELL": "3571", "JPM": "6021"})
    assert _mid(cat, "semi")["us"] == ["NVDA", "AMD"]  # 테마 파일의 종목이 앞, 중복 없음
    assert _mid(cat, "hw")["us"] == ["DELL"]
    assert _mid(cat, "bank")["us"] == ["JPM"]
    assert _mid(cat, "semi")["kr"] == ["058470"]
    assert _mid(cat, "semi")["keywords"] == ["반도체 소켓"]


def test_ticker_without_sic_or_unmapped_sic_is_left_out() -> None:
    cat = _build({"SPAC": None, "ODD": "9999", "NVDA": "3674"})
    all_us = {t for g in cat["groups"] for m in g["mids"] for t in m["us"]}
    assert all_us == {"NVDA"}


def test_null_in_sic_map_means_unclassified() -> None:
    cat = bc.build(GROUPS, THEMES, {"67": "bank", "6770": None}, {"SPAC": "6770", "X": "6792"})
    assert _mid(cat, "bank")["us"] == ["X"]  # 6770(블랭크체크)만 짧은 접두어를 이기고 빠진다


def test_sec_class_share_ticker_uses_kis_slash() -> None:
    cat = _build({"BRK-B": "6021"})
    assert _mid(cat, "bank")["us"] == ["BRK/B"]


def test_unknown_mid_id_is_rejected() -> None:
    with pytest.raises(ValueError, match="nope"):
        bc.build(GROUPS, {"nope": {"keywords": [], "kr": [], "us": []}}, SIC_MAP, {})
    with pytest.raises(ValueError, match="nope"):
        bc.build(GROUPS, THEMES, {"60": "nope"}, {})


def test_extract_sic_from_submissions_json() -> None:
    assert bc.parse_sic({"sic": "3674", "sicDescription": "Semiconductors"}) == "3674"
    assert bc.parse_sic({"sic": "", "name": "x"}) is None
    assert bc.parse_sic({}) is None
