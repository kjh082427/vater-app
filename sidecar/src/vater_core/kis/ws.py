"""한투 실시간 체결 WebSocket (스펙 7-3).

- 국내 `H0STCNT0`(tr_key = 종목코드), 미국 `HDFSCNT0`(tr_key = "D" + 거래소 + 종목, 예: DNASAAPL)
- 서버가 보내는 `PINGPONG`은 받은 문자열을 그대로 돌려보낸다.
- 데이터 메시지는 `암호화여부|TR_ID|건수|필드^필드^...` 형식이고 한 메시지에 여러 건이 올 수 있다.
- 끊기면 1·2·4…60초 간격으로 다시 접속하고 구독을 모두 복원한다.
- 구독 한도(기본 41)를 넘는 종목은 `subscribe()`가 False를 돌려준다.
  호출자는 그 종목을 REST 폴링으로 대체한다.
"""

import asyncio
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, Protocol

from websockets.asyncio.client import ClientConnection, connect

from vater_core.kis.config import WS_HOST, KisServer
from vater_core.kis.models import Market, UsExchange, num

logger = logging.getLogger(__name__)

State = Literal["connecting", "connected", "reconnecting", "stopped"]
DOMESTIC_TR, US_TR = "H0STCNT0", "HDFSCNT0"
DOMESTIC_FIELDS, US_FIELDS = 46, 26


class ApprovalSource(Protocol):
    async def approval_key(self) -> str: ...


@dataclass(frozen=True)
class Tick:
    market: Market
    code: str
    price: float
    change_pct: float
    volume: int  # 누적 거래량
    at: str  # 체결 시각 HHMMSS (국내: KST, 미국: 한국 시각)


def _noop(_: str) -> None:
    return None


class KisRealtime:
    def __init__(
        self,
        tokens: ApprovalSource,
        server: KisServer,
        on_tick: Callable[[Tick], None],
        on_state: Callable[[str], None] = _noop,
        max_subscriptions: int = 41,
        url: str | None = None,
        backoff: tuple[float, ...] = (1, 2, 4, 8, 16, 32, 60),
        idle_timeout: float = 120.0,
    ) -> None:
        self._tokens = tokens
        self._url = url or WS_HOST[server]
        self._on_tick = on_tick
        self._on_state = on_state
        self._max = max_subscriptions
        self._backoff = backoff
        # 이 시간 동안 아무 메시지(PINGPONG 포함)도 없으면 반쯤 끊긴 연결로 보고 다시 접속한다.
        # (노트북 절전·Wi-Fi 전환 뒤에는 OS가 끊김을 늦게 알린다.)
        self._idle_timeout = idle_timeout
        self.subscription_errors: dict[tuple[str, str], str] = {}  # 구독 거부 사유 (UI·로그용)
        # (tr_id, tr_key) → (market, code). 삽입 순서대로 복원한다.
        self._subs: dict[tuple[str, str], tuple[Market, str]] = {}
        self._ws: ClientConnection | None = None
        self.state: State = "stopped"

    @staticmethod
    def _key(market: Market, code: str, exchange: UsExchange | None) -> tuple[str, str]:
        if market == "KR":
            return DOMESTIC_TR, code
        if exchange is None:
            raise ValueError("US subscription needs an exchange (NAS/NYS/AMS)")
        return US_TR, f"D{exchange}{code}"

    async def subscribe(
        self, market: Market, code: str, exchange: UsExchange | None = None
    ) -> bool:
        key = self._key(market, code, exchange)
        if key in self._subs:
            return True
        if len(self._subs) >= self._max:
            return False
        self._subs[key] = (market, code)
        if self._ws is not None:
            await self._send(self._ws, key, "1")
        return True

    async def unsubscribe(
        self, market: Market, code: str, exchange: UsExchange | None = None
    ) -> None:
        key = self._key(market, code, exchange)
        if self._subs.pop(key, None) is not None and self._ws is not None:
            await self._send(self._ws, key, "2")

    @property
    def subscriptions(self) -> list[tuple[Market, str]]:
        return list(self._subs.values())

    def _set_state(self, state: State) -> None:
        if state != self.state:
            self.state = state
            self._on_state(state)

    async def _send(self, ws: ClientConnection, key: tuple[str, str], tr_type: str) -> None:
        msg = {
            "header": {
                "approval_key": await self._tokens.approval_key(),
                "custtype": "P",
                "tr_type": tr_type,
                "content-type": "utf-8",
            },
            "body": {"input": {"tr_id": key[0], "tr_key": key[1]}},
        }
        await ws.send(json.dumps(msg))

    async def run(self) -> None:
        """취소될 때까지 접속을 유지한다. 어떤 오류에도 루프가 죽지 않는다(리뷰 Critical #2).

        백오프는 접속 성공이 아니라 **첫 메시지를 받았을 때** 초기화한다. 접속만 받고 바로 끊는
        서버(잘못된 승인키, 점검 시간)에 1초 간격으로 계속 붙는 폭주를 막는다(리뷰 Important #3).
        """
        failures = 0
        self._set_state("connecting")
        try:
            while True:
                try:
                    async with connect(self._url, ping_interval=None) as ws:
                        self._ws = ws
                        self._set_state("connected")
                        for key in list(self._subs):
                            await self._send(ws, key, "1")
                        while True:
                            raw = await asyncio.wait_for(ws.recv(), timeout=self._idle_timeout)
                            failures = 0
                            try:
                                await self._handle(
                                    ws, raw if isinstance(raw, str) else raw.decode()
                                )
                            except Exception:  # 메시지 하나가 깨져도 루프는 계속 돈다
                                logger.exception("bad KIS realtime message")
                except asyncio.CancelledError:
                    raise
                except TimeoutError:
                    logger.warning(
                        "KIS websocket silent for %.0fs; reconnecting", self._idle_timeout
                    )
                except Exception as e:  # 연결 오류, 승인키 발급 실패 등 → 다시 접속
                    logger.warning("KIS websocket error: %s", e)
                finally:
                    self._ws = None
                delay = self._backoff[min(failures, len(self._backoff) - 1)]
                failures += 1
                self._set_state("reconnecting")
                await asyncio.sleep(delay)
        finally:
            self._ws = None
            self._set_state("stopped")

    async def _handle(self, ws: ClientConnection, raw: str) -> None:
        if raw.startswith("{"):
            try:
                msg = json.loads(raw)
            except ValueError:
                return
            header, body = msg.get("header", {}), msg.get("body") or {}
            if header.get("tr_id") == "PINGPONG":
                await ws.send(raw)  # 받은 그대로 돌려보낸다
                return
            key = (str(header.get("tr_id", "")), str(header.get("tr_key", "")))
            if body.get("rt_cd") not in (None, "0"):  # 구독 거부 (승인키 오류, 한도 초과 등)
                reason = f"{body.get('msg_cd', '')}: {body.get('msg1', '')}"
                self.subscription_errors[key] = reason
                logger.warning("KIS realtime subscription rejected %s %s: %s", *key, reason)
            elif body.get("rt_cd") == "0":
                self.subscription_errors.pop(key, None)
            return
        parts = raw.split("|", 3)
        if len(parts) != 4:
            return
        encrypted, tr_id, count_text, data = parts
        if encrypted != "0":
            logger.debug("skipping encrypted realtime message %s", tr_id)
            return
        fields = data.split("^")
        count = max(int(count_text or "1"), 1)
        width = len(fields) // count
        for i in range(count):
            rec = fields[i * width : (i + 1) * width]
            tick = self._parse(tr_id, rec)
            if tick is not None:
                try:
                    self._on_tick(tick)
                except Exception:  # 받는 쪽의 버그가 수신 루프를 죽이면 안 된다
                    logger.exception("realtime tick consumer failed")

    def _parse(self, tr_id: str, rec: list[str]) -> Tick | None:
        if tr_id == DOMESTIC_TR and len(rec) > 13:
            return Tick("KR", rec[0], num(rec[2]), num(rec[5]), int(num(rec[13])), rec[1])
        if tr_id == US_TR and len(rec) > 20:
            # 실제 원문(2026-11-03): 0 RSYM(DNASAAPL), 1 SYMB, 7 한국시각,
            # 11 현재가, 14 등락률, 20 누적거래량.
            # 공식 예제의 열 목록에는 맨 앞 RSYM이 빠져 있어 한 칸씩 밀린다.
            sub = self._subs.get((US_TR, rec[0]))
            code = sub[1] if sub else rec[1]
            return Tick("US", code, num(rec[11]), num(rec[14]), int(num(rec[20])), rec[7])
        return None
