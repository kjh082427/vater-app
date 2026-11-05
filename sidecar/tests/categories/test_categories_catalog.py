"""분류표 파일의 내용 검사. groups.json·sic_map.json은 항상, catalog.json은 있을 때 검사한다."""

import json
from importlib.resources import files
from pathlib import Path

import pytest

SRC = Path(__file__).parents[2] / "tools" / "categories"
THEME_NAMES = [
    *("반도체", "2차전지", "AI·소프트웨어", "인터넷·플랫폼", "로봇", "통신", "제약", "바이오"),
    *("의료기기", "자동차", "자동차 부품", "조선", "방산", "항공우주", "원자력·전력기기", "건설"),
    *(
        "철강",
        "화학·정유",
        "해운·물류",
        "식품",
        "화장품",
        "게임",
        "엔터·미디어",
        "은행",
        "증권",
        "보험",
    ),
]
CATALOG = files("vater_core.categories").joinpath("catalog.json")
# ponytail: 테마 초안 검수 전에는 catalog.json이 저장소에 없다. 검수 뒤 이 표시를 지운다.
needs_catalog = pytest.mark.skipif(not CATALOG.is_file(), reason="catalog.json 아직 없음")


def _groups() -> list[dict]:
    return json.loads((SRC / "groups.json").read_text(encoding="utf-8"))


def test_groups_have_10_to_15_majors_and_all_26_themes() -> None:
    groups = _groups()
    assert 10 <= len(groups) <= 15
    names = [m["name"] for g in groups for m in g["mids"]]
    assert len(names) == len(set(names))
    assert set(THEME_NAMES) <= set(names)
    assert len(THEME_NAMES) == 26
    ids = [m["id"] for g in groups for m in g["mids"]]
    assert len(ids) == len(set(ids))


def test_sic_map_targets_exist() -> None:
    ids = {m["id"] for g in _groups() for m in g["mids"]}
    targets = set(json.loads((SRC / "sic_map.json").read_text(encoding="utf-8")).values())
    assert targets - {None} <= ids


def _catalog() -> dict:
    return json.loads(CATALOG.read_text(encoding="utf-8"))


def _mid(name: str) -> dict:
    return next(m for g in _catalog()["groups"] for m in g["mids"] if m["name"] == name)


@needs_catalog
@pytest.mark.parametrize(
    ("mid", "market", "code"),
    [
        ("반도체", "kr", "005930"),  # 삼성전자
        ("반도체", "kr", "000660"),  # SK하이닉스
        ("반도체", "kr", "058470"),  # 리노공업
        ("조선", "kr", "329180"),  # HD현대중공업
        ("바이오", "kr", "068270"),  # 셀트리온
        ("식품", "kr", "004370"),  # 농심
        ("반도체", "us", "NVDA"),
        ("바이오", "us", "MRNA"),
    ],
)
def test_known_stocks_in_their_theme(mid: str, market: str, code: str) -> None:
    assert code in _mid(mid)[market]


@needs_catalog
def test_every_theme_has_a_stock_and_file_is_small() -> None:
    for name in THEME_NAMES:
        m = _mid(name)
        assert m["kr"] or m["us"], name
    assert len(CATALOG.read_bytes()) <= 2 * 1024 * 1024


@needs_catalog
def test_themes_file_has_26_themes_and_catalog_has_no_personal_fields() -> None:
    themes = json.loads((SRC / "themes.json").read_text(encoding="utf-8"))
    assert len(themes) == 26
    assert set(_catalog()) == {"version", "source", "groups"}
