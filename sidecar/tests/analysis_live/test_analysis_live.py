"""실제 TradingAgents + Gemini(클라우드 프리셋) + 한국투자증권으로 분석 1건씩을 끝까지 돌린다.

기본 실행에서 제외된다: `uv run pytest -m llm tests/analysis_live -q -s` (약 20~30분)
- 키는 저장소 루트 `.env`에서 **읽기만** 한다.
- 한투 토큰 캐시는 `~/.local/share/vater/dev-kis-cache.env`.
- 키가 없으면 건너뛴다.
"""

import asyncio
import json
import sqlite3
from pathlib import Path
from typing import ClassVar

import pytest

from vater_core.analysis.engine import TradingAgentsEngine
from vater_core.analysis.queue import AnalysisQueue
from vater_core.analysis.store import Analysis, AnalysisRepo
from vater_core.analysis.summary import DECISIONS
from vater_core.api.deps import AppDeps
from vater_core.api.events import EventBus
from vater_core.secrets.names import SecretName
from vater_core.secrets.store import EnvFileSecretStore
from vater_core.store.db import open_db

pytestmark = pytest.mark.llm

ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"
CACHE = Path.home() / ".local/share/vater/dev-kis-cache.env"
TIMEOUT_SEC = 45 * 60


class DevStore:
    """키는 루트 .env에서 읽고(쓰지 않음), 한투 토큰 캐시는 별도 파일에 쓴다."""

    CACHE_NAMES: ClassVar[frozenset[SecretName]] = frozenset(
        {SecretName.KIS_ACCESS_TOKEN, SecretName.KIS_WS_APPROVAL_KEY}
    )

    def __init__(self) -> None:
        self.keys = EnvFileSecretStore(ROOT_ENV)
        self.cache = EnvFileSecretStore(CACHE)

    def get(self, name: SecretName) -> str | None:
        return (self.cache if name in self.CACHE_NAMES else self.keys).get(name)

    def set(self, name: SecretName, value: str) -> None:
        assert name in self.CACHE_NAMES, "live tests must never write keys"
        self.cache.set(name, value)

    def delete(self, name: SecretName) -> None:
        assert name in self.CACHE_NAMES, "live tests must never delete keys"
        self.cache.delete(name)

    def known_values(self) -> list[str]:
        return self.keys.known_values() + self.cache.known_values()


def seed(conn: sqlite3.Connection) -> None:
    conn.executemany(
        "INSERT INTO symbols (market, code, exchange, name, name_en, kind) VALUES (?,?,?,?,?,?)",
        [
            ("KR", "005930", "KOSPI", "삼성전자", None, "stock"),
            ("US", "AAPL", "NAS", "애플", "APPLE INC", "stock"),
        ],
    )
    conn.commit()


def require_keys(store: DevStore, *names: SecretName) -> None:
    missing = [n.value for n in names if not store.get(n)]
    if missing:
        pytest.skip(f"root .env is missing {missing}")


async def run_one(tmp_path: Path, market: str, code: str) -> Analysis:
    store = DevStore()
    require_keys(
        store, SecretName.LLM_GOOGLE_KEY, SecretName.KIS_APP_KEY, SecretName.KIS_APP_SECRET
    )
    db = open_db(tmp_path)
    seed(db)
    deps = AppDeps(token="t", dev=False, data_dir=tmp_path, db=db, secrets=store, events=EventBus())
    notes: list[tuple[str, str, str]] = []
    queue = AnalysisQueue(deps, TradingAgentsEngine(), notify_fn=lambda *n: notes.append(n))
    queue.start()
    assert deps.events is not None
    sub = deps.events.subscribe()
    try:
        aid = await queue.submit(market, code, None, "cloud")
        repo = AnalysisRepo(db)
        for _ in range(TIMEOUT_SEC):
            if repo.get(aid).status in ("done", "failed", "cancelled"):
                break
            await asyncio.sleep(1)
        a = repo.get(aid)
    finally:
        await queue.stop()
        if deps.http is not None:
            await deps.http.aclose()
    stages = []
    while not sub.queue.empty():
        ev = sub.queue.get_nowait()
        if ev.type == "analysis.progress" and ev.data["stage"] not in stages:
            stages.append(ev.data["stage"])
    print(json.dumps({"id": a.id, "status": a.status, "as_of": a.as_of, "decision": a.decision,
                      "summary": a.summary, "timings": a.timings, "tokens": a.tokens,
                      "error": a.error, "stages": stages, "notes": notes},
                     ensure_ascii=False, indent=1))  # fmt: skip
    assert a.status == "done", a.error
    assert a.decision in DECISIONS and a.summary
    assert stages[-1] == "portfolio" and "analysts" in stages
    assert notes and notes[-1][0] == "분석 완료"
    return a


async def test_live_domestic_analysis_uses_kis(tmp_path: Path) -> None:
    a = await run_one(tmp_path, "KR", "005930")
    assert a.reports is not None
    fundamentals, news = a.reports["fundamentals_report"], a.reports["news_report"]
    print("fundamentals:", fundamentals[:600])
    # 한투 재무 데이터가 들어갔으면 '데이터 없음' 신호가 없어야 한다 (검증 실험 S2의 해결 확인)
    assert "NO_DATA_AVAILABLE" not in fundamentals
    assert "NO_DATA_AVAILABLE" not in news


async def test_live_us_analysis(tmp_path: Path) -> None:
    await run_one(tmp_path, "US", "AAPL")
