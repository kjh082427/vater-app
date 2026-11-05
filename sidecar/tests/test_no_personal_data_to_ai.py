"""개인정보는 어떤 AI에도 보내지 않는다 (v2 설계 8-1, 15장).

AI에 닿는 코드는 보유 내역 모듈을 불러오지 못하고(AST 검사), 보유 내역과 평단가 알림이 있어도
실제로 만들어진 프롬프트에 그 값이 없어야 한다(끝에서 끝까지).
"""

import ast
import json
import re
import sqlite3
import subprocess
import sys
from collections.abc import Iterator
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

import vater_core
from vater_core.alerts.clock import MarketClock
from vater_core.alerts.store import BarRepo, EventRepo, RuleRepo, WatchlistRepo
from vater_core.analysis.symbols import resolve_target
from vater_core.api.deps import AppDeps
from vater_core.api.events import EventBus
from vater_core.briefing.interpret import build_messages
from vater_core.briefing.service import BriefingService
from vater_core.briefing.store import BriefingRepo
from vater_core.kis.market import IndexQuote
from vater_core.kis.models import Bar, Quote
from vater_core.llm.presets import LlmRun, TierChoice
from vater_core.portfolio.daily import DailyRecorder, DailyRepo
from vater_core.store.db import open_db
from vater_core.store.holdings import HoldingRow, HoldingsRepo

SRC = Path(vater_core.__file__).parent
FORBIDDEN = ("vater_core.holdings", "vater_core.portfolio", "vater_core.store.holdings")
LOADED_FORBIDDEN = (*FORBIDDEN, "vater_core.alerts.evaluator")
ATTRS = ("holdings", "portfolio", "my_assets")  # deps.holdings, deps.portfolio, briefing.my_assets
SQL_TABLES = re.compile(
    r"\b(FROM|JOIN|INTO|UPDATE|TABLE)\s+(holdings|connections|portfolio_daily)\b", re.IGNORECASE
)
# 패키지 자료를 읽는 importlib.resources 말고는 동적 import다. AST로 추적되지 않으므로 막는다
SAFE_IMPORTLIB = "importlib.resources"


def targets() -> list[Path]:
    """AI 입력을 만들거나 보내는 코드. `collect.py`는 AI에 가는 `data`를 만드므로 함께 막는다."""
    return [
        *sorted((SRC / "analysis").rglob("*.py")),
        *sorted((SRC / "llm").rglob("*.py")),
        SRC / "briefing" / "interpret.py",
        SRC / "briefing" / "collect.py",
    ]


def imported(source: str, package: str) -> Iterator[str]:
    """소스가 불러오는 모듈 이름 전부. 함수·TYPE_CHECKING 안, 상대 import, 문자열 import 포함."""
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            yield from (alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            parts = package.split(".")
            parent = parts[: len(parts) - node.level + 1] if node.level else []
            base = ".".join([*parent, *([node.module] if node.module else [])])
            yield base
            yield from (f"{base}.{alias.name}" for alias in node.names)
        elif (
            isinstance(node, ast.Call)
            and getattr(node.func, "attr", getattr(node.func, "id", "")) in IMPORT_CALLS
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[0].value, str)
        ):
            yield node.args[0].value


IMPORT_CALLS = ("import_module", "__import__")


def _is_or_under(name: str, parents: tuple[str, ...]) -> bool:
    return any(name == bad or name.startswith(f"{bad}.") for bad in parents)


def _dynamic_import(name: str) -> bool:
    return _is_or_under(name, ("importlib",)) and not _is_or_under(name, (SAFE_IMPORTLIB,))


def violations(source: str, package: str = "vater_core.analysis") -> list[str]:
    found = [
        name
        for name in imported(source, package)
        if _is_or_under(name, FORBIDDEN) or _dynamic_import(name)
    ]
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Attribute) and node.attr in ATTRS:
            found.append(f".{node.attr}")
        elif isinstance(node, ast.Name) and node.id == "__import__":
            found.append("__import__")
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            found.extend(m.group(0) for m in SQL_TABLES.finditer(node.value))
    return found


@pytest.mark.parametrize(
    "source",
    [
        "import vater_core.holdings",
        "import vater_core.holdings.service as s",
        "import vater_core.portfolio.daily",
        "import vater_core.store.holdings",
        "from vater_core.holdings.service import get_holdings",
        "from vater_core.holdings import service",
        "from vater_core.portfolio.valuation import value_of",
        "from vater_core.store.holdings import HoldingsRepo",
        "from vater_core import holdings",
        "from vater_core import portfolio as p",
        "from vater_core.store import holdings",
        "from ..holdings import service",
        "from .. import portfolio",
        "from ..store.holdings import HoldingsRepo",
        "def f():\n    from vater_core.holdings.service import summarize\n",
        "if TYPE_CHECKING:\n    from vater_core.portfolio.daily import DailyRepo\n",
        "import importlib\nimportlib.import_module('vater_core.holdings.service')",
        "__import__('vater_core.store.holdings')",
        "import importlib",
        "from importlib import import_module",
        "__import__(name)",
        "deps.holdings.repo.all()",
        "self._deps.portfolio",
        "x = deps.portfolio.summary()",
        "saved.my_assets",
        "conn.execute('SELECT * FROM holdings')",
        "conn.execute('select quantity from holdings where code = ?')",
        "conn.execute('SELECT 1 FROM alert_rules r JOIN connections c ON 1')",
        "conn.execute(f'SELECT {cols} FROM portfolio_daily')",
        "conn.execute('INSERT INTO holdings VALUES (1)')",
    ],
)
def test_the_check_catches_a_violation(source: str) -> None:
    assert violations(source)


@pytest.mark.parametrize(
    "source",
    [
        "from vater_core.api.errors import VaterError",
        "from vater_core.store.settings import SettingsRepo",
        "from vater_core.store.db import open_db",
        "from . import models",
        "from ..llm.presets import LlmRun",
        "import portfolio",
        "text = 'vater_core.holdings'",
        'STAGE = {"Portfolio Manager": "portfolio"}',
        "from importlib.resources import files",
        "text = '보유 holdings 없음'",
        "conn.execute('SELECT * FROM analyses')",
        "holdings = 1",
    ],
)
def test_the_check_allows_other_imports(source: str) -> None:
    assert not violations(source)


def test_targets_are_the_real_files() -> None:
    found = targets()
    assert all(path.is_file() for path in found)
    for name in ("engine.py", "queue.py", "presets.py", "interpret.py", "collect.py"):
        assert name in {path.name for path in found}


@pytest.mark.parametrize("path", targets(), ids=lambda p: str(p.relative_to(SRC)))
def test_ai_facing_code_does_not_import_holdings(path: Path) -> None:
    package = ".".join(("vater_core", *path.parent.relative_to(SRC).parts))
    assert violations(path.read_text(encoding="utf-8"), package) == []


def loaded_after_importing(*modules: str) -> list[str]:
    """새 인터프리터에서 모듈을 불러온 뒤 올라온 금지 모듈. 간접 import까지 잡는다."""
    code = (
        "import importlib, json, sys\n"
        f"for name in {list(modules)!r}:\n"
        "    importlib.import_module(name)\n"
        "print(json.dumps(sorted(sys.modules)))\n"
    )
    done = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, check=True, timeout=120
    )
    return [m for m in json.loads(done.stdout) if _is_or_under(m, LOADED_FORBIDDEN)]


def ai_modules() -> list[str]:
    return [
        ".".join(("vater_core", *path.relative_to(SRC).with_suffix("").parts))
        for path in targets()
        if path.name != "__init__.py"
    ]


def test_loading_ai_code_does_not_load_holdings_even_indirectly() -> None:
    modules = ai_modules()
    assert {"vater_core.analysis.engine", "vater_core.briefing.interpret"} <= set(modules)
    assert len(modules) >= 9
    assert loaded_after_importing(*modules) == []


@pytest.mark.parametrize(
    ("module", "caught"),
    [
        ("vater_core.holdings.service", "vater_core.holdings.service"),
        ("vater_core.store.holdings", "vater_core.store.holdings"),
        ("vater_core.portfolio.valuation", "vater_core.portfolio.valuation"),
        ("vater_core.alerts.evaluator", "vater_core.alerts.evaluator"),
    ],
)
def test_the_loaded_module_check_catches_a_violation(module: str, caught: str) -> None:
    assert caught in loaded_after_importing(module)


# ---- 끝에서 끝까지 --------------------------------------------------------------

MON, TUE = date(2026, 11, 2), date(2026, 11, 3)
NOW = datetime(2026, 11, 3, 8, 0, tzinfo=UTC)  # 화 17:00 KST
AT = "2026-11-03T00:00:00Z"
TEXT = {k: "문장." for k in ("headline", "market", "sectors", "flows", "notable", "watchlist")}
TIER = TierChoice("google", "m", None)
HELD_ONLY = ("KR", "123450", "보유전용종목")
BOTH = ("KR", "005930", "삼성전자")
QTY_HELD_ONLY, AVG_HELD_ONLY = 7717, 5123
QTY_BOTH, AVG_BOTH = 3313, 64123


class Feeds:
    """지수만 온다. 나머지 항목은 빠져도 브리핑은 만들어진다."""

    async def index_quote(self, m: str) -> IndexQuote:
        return IndexQuote("0001", m, 100.0, 1.0, 1.0)

    async def index_daily(self, m: str, start: date, end: date) -> list[Bar]:
        return []

    async def price(self, item: Any) -> Quote:
        return Quote(item.market, item.code, 70000.0, 500.0, 0.72, 1000)

    def __getattr__(self, name: str) -> Any:
        async def unavailable(*args: Any) -> Any:
            raise RuntimeError(name)

        return unavailable


async def kr_day(day: date) -> bool:
    return day.weekday() < 5


async def fetch_fx(start: date, end: date) -> dict[date, float]:
    return {start: 1400.0, end: 1400.0}


async def no_refresh(market: str, code: str, through: date) -> None:
    return None


def seeded(tmp_path: Path) -> sqlite3.Connection:
    db = open_db(tmp_path)
    db.executemany(
        "INSERT INTO symbols (market, code, exchange, name, name_en, kind) VALUES (?,?,?,?,?,?)",
        [(m, c, "KOSPI", n, None, "stock") for m, c, n in (BOTH, HELD_ONLY)],
    )
    db.commit()
    repo, bars = HoldingsRepo(db), BarRepo(db)
    for (market, code, name), qty, avg, low, high in (
        (BOTH, QTY_BOTH, AVG_BOTH, 70000.0, 71000.0),
        (HELD_ONLY, QTY_HELD_ONLY, AVG_HELD_ONLY, 5000.0, 4900.0),
    ):
        row = HoldingRow(market, code, name, Decimal(qty), Decimal(avg), "KRW")  # type: ignore[arg-type]
        repo.manual_upsert("samsung", row, AT)
        bars.upsert(market, code, [Bar(MON, 1, 1, 1, low, 1), Bar(TUE, 1, 1, 1, high, 1)])
    DailyRepo(db).fill(MON, 1.0, 1.0, 0.0, 0.0, None, backfilled=False)

    # 감시 종목이기도 한 보유 종목에 평단가 알림과 보통 알림이 하나씩 울렸다
    watched = WatchlistRepo(db).add(resolve_target(db, BOTH[0], BOTH[1]))
    rules, events = RuleRepo(db), EventRepo(db)
    avg_rule = rules.create(
        watched.id, "avg_price_pct", {"pct": 10, "direction": "down"}, "realtime", True
    )
    plain = rules.create(watched.id, "price_above", {"price": 1}, "realtime", True)
    at = "2026-11-03T10:00:00+09:00"
    events.add(avg_rule.id, at, -11.0, "삼성전자 평단가 대비 -11.00%")
    events.add(plain.id, at, 70000.0, "삼성전자 현재가 70,000 — 목표가 1 이상")
    # 감시를 지워 규칙이 사라진 뒤에도 이력에 남은 평단가 알림
    events.add(None, at, -11.0, "보유전용종목 평단가 대비 -11.00%")
    return db


async def generate(db: sqlite3.Connection) -> tuple[dict[str, Any], int, list[Any], list[Any]]:
    deps = AppDeps(token="t", dev=True, data_dir=Path("."), db=db, events=EventBus())
    assert deps.events is not None
    sub = deps.events.subscribe()
    clock = MarketClock(kr_day, now=lambda: NOW)
    recorder = DailyRecorder(
        deps, clock=clock, refresh=no_refresh, fetch_fx=fetch_fx, now=lambda: NOW
    )
    seen: dict[str, Any] = {}
    notes: list[Any] = []

    def interpret(market: str, data: dict[str, Any], run: LlmRun) -> dict[str, str]:
        seen["data"] = data
        seen["text"] = "\n".join(c for _, c in build_messages(market, data))
        return dict(TEXT)

    service = BriefingService(
        deps,
        clock=clock,
        feeds_fn=lambda: Feeds(),  # type: ignore[arg-type, return-value]
        run_fn=lambda: LlmRun("cloud", TIER, TIER, {}, {}),
        interpret_fn=interpret,
        notify_fn=lambda *note: notes.append(note),
        now=lambda: NOW,
        assets_fn=recorder.my_assets,
    )
    bid = await service.generate("KR", TUE)
    published = []
    while not sub.queue.empty():
        published.append(sub.queue.get_nowait())
    return seen, bid, notes, published


async def test_prompt_has_no_holdings_even_with_an_average_price_alert(tmp_path: Path) -> None:
    db = seeded(tmp_path)
    seen, bid, notes, published = await generate(db)
    text = seen["text"]

    # 보유만 한 종목은 이름도 코드도 없다
    assert HELD_ONLY[2] not in text
    assert HELD_ONLY[1] not in text
    # 평단가 알림의 흔적이 없다
    for word in ("avg_price_pct", "평단", "11.00"):
        assert word not in text
    # 수량, 평단가, 금액, 기여, 내 자산 구역
    assets = BriefingRepo(db).get(bid).my_assets
    assert assets is not None
    amounts = [assets["change_krw"], assets["top"]["amount"], assets["bottom"]["amount"]]
    for number in (QTY_HELD_ONLY, QTY_BOTH, AVG_HELD_ONLY, AVG_BOTH, *amounts):
        assert f"{abs(number):.0f}" not in text
    for word in ("my_assets", "change_krw", "보유", "holding", "broker", "삼성증권", "samsung"):
        assert word not in text

    # 감시 종목은 코드, 이름, 시세만 간다. 보유 여부는 표시하지 않는다
    assert seen["data"]["watchlist"] == [
        {"code": "005930", "name": "삼성전자", "price": 70000.0, "change_pct": 0.72}
    ]
    # 평단가 규칙이 아닌 알림은 그대로 간다
    assert [a["kind"] for a in seen["data"]["alerts"]] == ["price_above"]
    assert "my_assets" not in seen["data"]

    # 내 자산은 저장과 표시에만 쓴다. 저장된 `data`에도 섞이지 않는다
    saved = BriefingRepo(db).get(bid)
    assert "my_assets" not in saved.data
    assert json.dumps(saved.data, ensure_ascii=False).count(HELD_ONLY[2]) == 0
    assert assets["bottom"]["name"] == HELD_ONLY[2]

    # 알림과 진행 이벤트에도 금액이 없다
    assert "my_assets" not in json.dumps([n for n in notes], ensure_ascii=False)
    assert all("my_assets" not in e.data and "amount" not in e.data for e in published)
