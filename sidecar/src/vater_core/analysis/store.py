"""`analyses` 테이블 (001_init.sql). 쓰기는 이벤트 루프 스레드에서만 부른다.

DB에는 프리셋과 단계별 제공자·모델 이름만 남긴다. TradingAgents 설정 덮어쓰기(`LlmRun.overrides`)는
기타 서버 주소에 자격 증명이 섞일 수 있어서 저장하지 않는다.
"""

import json
import sqlite3
from dataclasses import dataclass
from typing import Any

from vater_core.analysis.models import EngineResult
from vater_core.analysis.symbols import Target
from vater_core.api.errors import VaterError

_COLUMNS = (
    "a.id, a.market, a.code, s.name, a.as_of, a.preset, a.status, a.models, a.decision, "
    "a.summary, a.reports, a.timings, a.tokens, a.error, a.created_at"
)
_FROM = "FROM analyses a LEFT JOIN symbols s ON s.market = a.market AND s.code = a.code"
INTERRUPTED = {
    "code": "ANALYSIS_INTERRUPTED",
    "message": "앱이 종료되어 분석이 중단되었습니다.",
    "hint": "[다시 시도]를 누르면 끝난 단계부터 이어서 분석합니다.",
}


@dataclass(frozen=True)
class Analysis:
    id: int
    market: str
    code: str
    name: str | None
    as_of: str
    preset: str
    status: str
    models: dict[str, Any] | None
    decision: str | None
    summary: list[str] | None
    price_target: str | None
    time_horizon: str | None
    reports: dict[str, str] | None
    timings: dict[str, float] | None
    tokens: dict[str, int] | None
    error: dict[str, Any] | None
    created_at: str


def _load(text: str | None) -> Any:
    return json.loads(text) if text else None


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _row(r: tuple[Any, ...]) -> Analysis:
    summary = _load(r[9]) or {}
    return Analysis(
        id=r[0],
        market=r[1],
        code=r[2],
        name=r[3],
        as_of=r[4],
        preset=r[5],
        status=r[6],
        models=_load(r[7]),
        decision=r[8],
        summary=summary.get("lines"),
        price_target=summary.get("price_target"),
        time_horizon=summary.get("time_horizon"),
        reports=_load(r[10]),
        timings=_load(r[11]),
        tokens=_load(r[12]),
        error=_load(r[13]),
        created_at=r[14],
    )


class AnalysisRepo:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def create(self, target: Target, as_of: str, preset: str) -> int:
        with self._conn:
            cur = self._conn.execute(
                "INSERT INTO analyses (market, code, as_of, preset, status) "
                "VALUES (?, ?, ?, ?, 'queued')",
                (target.market, target.code, as_of, preset),
            )
        if cur.lastrowid is None:  # INSERT는 항상 행 id를 돌려준다
            raise RuntimeError("analyses insert returned no row id")
        return cur.lastrowid

    def get(self, id: int) -> Analysis:
        r = self._conn.execute(f"SELECT {_COLUMNS} {_FROM} WHERE a.id = ?", (id,)).fetchone()
        if r is None:
            raise VaterError("ANALYSIS_NOT_FOUND", f"분석 기록이 없습니다: {id}", status=404)
        return _row(r)

    def list(
        self, market: str | None = None, code: str | None = None, limit: int = 50
    ) -> list[Analysis]:
        where, args = [], []
        if market is not None:
            where.append("a.market = ?")
            args.append(market)
        if code is not None:
            where.append("a.code = ?")
            args.append(code)
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        rows = self._conn.execute(
            f"SELECT {_COLUMNS} {_FROM} {clause} ORDER BY a.id DESC LIMIT ?",
            (*args, limit),
        ).fetchall()
        return [_row(r) for r in rows]

    def _update(self, id: int, sql: str, args: tuple[Any, ...]) -> None:
        with self._conn:
            self._conn.execute(f"UPDATE analyses SET {sql} WHERE id = ?", (*args, id))  # noqa: S608

    def set_running(self, id: int, models: dict[str, Any]) -> None:
        self._update(id, "status = 'running', models = ?", (_dump(models),))

    def finish(self, id: int, result: EngineResult) -> None:
        s = result.summary
        summary = {
            "lines": list(s.lines),
            "price_target": s.price_target,
            "time_horizon": s.time_horizon,
        }
        self._update(
            id,
            "status = 'done', decision = ?, summary = ?, reports = ?, timings = ?, tokens = ?, "
            "error = NULL",
            (
                s.decision,
                _dump(summary),
                _dump(result.reports),
                _dump(result.timings),
                _dump(result.tokens),
            ),
        )

    def fail(self, id: int, code: str, message: str, hint: str | None) -> None:
        error = {"code": code, "message": message, "hint": hint}
        self._update(id, "status = 'failed', error = ?", (_dump(error),))

    def cancel(self, id: int) -> None:
        self._update(id, "status = 'cancelled'", ())

    def previous_done(self, market: str, code: str, before_id: int) -> Analysis | None:
        r = self._conn.execute(
            f"SELECT {_COLUMNS} {_FROM} WHERE a.market = ? AND a.code = ? AND a.status = 'done' "
            "AND a.id < ? ORDER BY a.id DESC LIMIT 1",
            (market, code, before_id),
        ).fetchone()
        return _row(r) if r is not None else None

    def recover_interrupted(self) -> int:
        """사이드카가 다시 시작될 때: 대기·실행 중으로 남은 분석은 중단된 것이다."""
        with self._conn:
            cur = self._conn.execute(
                "UPDATE analyses SET status = 'failed', error = ? "
                "WHERE status IN ('queued', 'running')",
                (_dump(INTERRUPTED),),
            )
        return cur.rowcount
