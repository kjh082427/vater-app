"""대시보드 배치 문서 저장소 (대시보드 설계 4장)."""

import copy
from pathlib import Path
from typing import Any

import pytest

from vater_core.api.errors import VaterError
from vater_core.store.dashboards import DashboardRepo, validate_dashboards
from vater_core.store.db import open_db


def board(i: int = 0, panels: int = 4, name: str | None = None) -> dict[str, Any]:
    return {
        "id": f"d{i}",
        "name": name if name is not None else f"화면 {i}",
        "kpi": {"enabled": True, "items": ["kospi", "kosdaq"]},
        "layout": {"template": "grid-2x2", "root": {"dir": "row", "sizes": [0.5, 0.5]}},
        "panels": [{"type": "watchlist", "options": {}} for _ in range(panels)],
    }


def doc(*boards: dict[str, Any]) -> dict[str, Any]:
    return {"version": 1, "dashboards": list(boards) or [board()]}


def test_empty_get_returns_empty_document(tmp_path: Path) -> None:
    assert DashboardRepo(open_db(tmp_path)).get() == {"version": 1, "dashboards": []}


def test_put_then_get_round_trips_and_survives_reopen(tmp_path: Path) -> None:
    d = doc(board(0), board(1, panels=6))
    assert DashboardRepo(open_db(tmp_path)).put(d) == d
    assert DashboardRepo(open_db(tmp_path)).get() == d


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update(version=2),
        lambda d: d.update(dashboards=[]),
        lambda d: d.update(dashboards=[board(i) for i in range(9)]),
        lambda d: d["dashboards"][0].update(name=""),
        lambda d: d["dashboards"][0].update(name="   "),
        lambda d: d["dashboards"][0].update(name="가" * 21),
        lambda d: d["dashboards"][0].update(panels=[]),
        lambda d: d["dashboards"][0].update(panels=board(panels=7)["panels"]),
        lambda d: d["dashboards"][0]["kpi"].update(items=["kospi"] * 6),
        lambda d: d["dashboards"][0]["kpi"].update(enabled="yes"),
        lambda d: d["dashboards"][0]["layout"].update(root=[1, 2]),
        lambda d: d["dashboards"][0]["layout"].update(template=""),
        lambda d: d["dashboards"][0]["panels"][0].update(type=3),
        lambda d: d["dashboards"][0]["panels"][0].update(options=None),
        lambda d: d["dashboards"][0].update(id="x" * 41),
        lambda d: d.pop("dashboards"),
    ],
)
def test_invalid_documents_raise_dashboard_invalid(mutate: Any) -> None:
    d = copy.deepcopy(doc())
    mutate(d)
    with pytest.raises(VaterError) as e:
        validate_dashboards(d)
    assert e.value.code == "DASHBOARD_INVALID" and e.value.status == 422 and e.value.hint


def test_top_level_not_object_is_invalid() -> None:
    with pytest.raises(VaterError):
        validate_dashboards([doc()])


def test_invalid_put_keeps_previous_document(tmp_path: Path) -> None:
    repo = DashboardRepo(open_db(tmp_path))
    good = doc()
    repo.put(good)
    with pytest.raises(VaterError):
        repo.put({"version": 1, "dashboards": []})
    assert repo.get() == good
