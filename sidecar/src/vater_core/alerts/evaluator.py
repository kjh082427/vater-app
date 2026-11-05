"""알림 평가기: 상태 전이(거짓→참)와 하루 1회 쿨다운 (스펙 4-2).

- 처음 평가(직전 상태 없음)는 기준값만 저장한다. 규칙을 만든 순간 이미 참이어도 울리지 않는다.
- 계산 불가(일봉 부족)는 상태를 바꾸지 않는다.
- 같은 규칙은 그 시장의 현지 날짜(세션 날짜) 기준 하루 1번만 울린다.
- 발생 시각은 한국 시각(+09:00)으로 저장한다.

DB 쓰기가 있으므로 이벤트 루프 스레드에서만 부른다.
`rules`는 방금 DB에서 읽은 것이어야 한다(직전 상태·발생 시각을 그대로 믿는다).
"""

import asyncio
import logging
import sqlite3
from collections.abc import Callable
from dataclasses import asdict, replace
from datetime import UTC, date, datetime
from typing import Any

from vater_core.alerts.clock import KST, NY
from vater_core.alerts.rules import AvgPricePct, History, Live, condition, parse_rule
from vater_core.alerts.store import AlertEvent, EventRepo, Rule, RuleRepo, WatchItem
from vater_core.analysis.store import AnalysisRepo
from vater_core.analysis.summary import decision_ko
from vater_core.api.errors import VaterError
from vater_core.api.events import EventBus
from vater_core.holdings.service import avg_price_of
from vater_core.stdout_events import notify

logger = logging.getLogger(__name__)

NotifyFn = Callable[[str, str, str | None], None]
NowFn = Callable[[], datetime]


def _now_default() -> datetime:
    return datetime.now(UTC)


def _stamp(now: NowFn) -> str:
    return now().astimezone(KST).isoformat(timespec="seconds")


def _fired_on(last_fired_at: str | None, market: str, session_day: date) -> bool:
    if last_fired_at is None:
        return False
    at = datetime.fromisoformat(last_fired_at)
    if at.tzinfo is not None:
        at = at.astimezone(KST if market == "KR" else NY)
    return at.date() == session_day


class Evaluator:
    def __init__(
        self,
        conn: sqlite3.Connection,
        events: EventBus | None,
        notify_fn: NotifyFn = notify,
        now: NowFn = _now_default,
    ) -> None:
        self._conn = conn
        self._rules = RuleRepo(conn)
        self._events = EventRepo(conn)
        self._bus = events
        self._notify = notify_fn
        self._now = now

    def evaluate(
        self,
        item: WatchItem,
        rules: list[Rule],
        history: History,
        live: Live | None,
        session_day: date,
    ) -> list[AlertEvent]:
        """`live`가 있으면 realtime 규칙만, 없으면 close 규칙만 평가한다."""
        timing = "realtime" if live is not None else "close"
        fired: list[AlertEvent] = []
        for rule in rules:
            if not rule.enabled or rule.timing != timing:
                continue
            try:
                params = parse_rule(rule.kind, rule.params)
            except VaterError:
                logger.warning("alert rule %s has invalid stored params: skipped", rule.id)
                continue
            avg = None
            if isinstance(params, AvgPricePct):
                avg = avg_price_of(self._conn, item.market, item.code)
                # 평단 정정, 전량 매도, 재매수: 새 평단가의 기준값부터 저장한다
                if avg != rule.last_avg:
                    self._rules.reset_avg(rule.id, avg)
                    rule = replace(rule, last_state=None, last_avg=avg)
            reading = condition(params, history, live, avg)
            if reading.state is None:
                continue
            if (
                rule.last_state is False
                and reading.state
                and not _fired_on(rule.last_fired_at, item.market, session_day)
            ):
                fired.append(self._fire(item, rule, reading.value, reading.message))
            if reading.state != rule.last_state:
                self._rules.set_state(rule.id, reading.state)
        return fired

    def _fire(self, item: WatchItem, rule: Rule, value: float | None, message: str) -> AlertEvent:
        at = _stamp(self._now)
        # 규칙이나 감시 종목이 지워져도 이력만으로 읽히도록 종목명을 붙여 저장한다
        text = f"{item.name} {message}"
        event_id = self._events.add(rule.id, at, value, text)
        self._rules.mark_fired(rule.id, at)
        event = AlertEvent(
            id=event_id,
            rule_id=rule.id,
            fired_at=at,
            value=value,
            message=text,
            market=item.market,
            code=item.code,
            name=item.name,
            kind=rule.kind,
        )
        self._notify(f"알림: {item.name}", message, f"/symbols/{item.market}/{item.code}")
        if self._bus is not None:
            self._bus.publish("alert.fired", asdict(event))
        return event


def _event_message(analyses: AnalysisRepo, data: dict[str, Any]) -> str | None:
    status = data.get("status")
    if status not in ("done", "failed"):
        return None
    try:
        a = analyses.get(int(data["id"]))
    except (VaterError, KeyError, TypeError, ValueError):
        return None
    name = a.name or a.code
    if status == "done":
        decision = data.get("decision")
        return f"AI 분석 완료: {name} — {decision_ko(decision) or decision or '결과 확인'}"
    error = data.get("error") or {}
    return f"AI 분석 실패: {name} — {error.get('message') or '오류'}"


def record_event_alerts(
    bus: EventBus, conn: sqlite3.Connection, now: NowFn = _now_default
) -> Callable[[], None]:
    """분석 완료·실패를 알림 이력(`rule_id = NULL`)에 남긴다. 해제 함수를 돌려준다.

    이벤트 루프 안에서 불러야 한다. 기록도 그 루프에서 한다.
    Windows 알림은 분석 큐가 이미 보내므로 여기서는 보내지 않는다.
    """
    sub = bus.subscribe()
    analyses = AnalysisRepo(conn)
    events = EventRepo(conn)

    async def run() -> None:
        async for event in sub:
            if event.type != "analysis.status":
                continue
            try:
                message = _event_message(analyses, event.data)
                if message is not None:
                    events.add(None, _stamp(now), None, message)
            except Exception:
                logger.exception("failed to record analysis event alert")

    task = asyncio.get_running_loop().create_task(run())

    def stop() -> None:
        sub.close()
        task.cancel()

    return stop
