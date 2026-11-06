"""4단계 확인 U의 사이드카 판(stack): 실제 사이드카 앱 + 가짜 바깥 서비스.

실제 코드: FastAPI 앱(create_app), DB, 비밀키 저장소(env 파일), 이벤트 통로, 알림 감시 루프
(AlertMonitor + 실제 KisRealtime·KisClient·TokenManager), 분석 작업 큐, 브리핑 서비스, 알림 이력 기록.
가짜: 한투 REST·WebSocket 서버(이 프로세스 안의 로컬 서버), TradingAgents 엔진, 브리핑 수집·LLM 해석.
v2 확인(v2.accept.ts)용으로 키움·메리츠 서버와 한투 잔고·일봉·환율도 이 프로세스 안에 둔다. 응답 모양은
`sidecar/tests/brokers/test_{kis,kiwoom,meritz}.py`의 공식 형식 픽스처와 같다.

- 한투 주소(`kis.config.REST_HOST`·`WS_HOST`)와 키움·메리츠 주소(`brokers.kiwoom.BASE_URL`·
  `brokers.meritz.BASE_URL`, 어댑터가 부를 때마다 읽는 모듈 값)는 **이 판에서만** 로컬 가짜 서버로 바꾼다
  (제품 코드는 그대로, 환경 변수 같은 설치본의 우회로를 더하지 않는다).
- 알림 감시 시계는 실제 시간으로 흐르되 화 10:00 KST(국내 장중)에서 시작한다.
  브리핑 시계는 같은 날 16:00 KST(국내 장 마감 뒤)에서 시작한다(수동 "지금 만들기"용, 자동 일정은 끈다).
- 토큰은 실제 셸처럼 환경변수 `VATER_TOKEN`으로 받고, 준비되면 stdout에
  `{"type":"ready","port":N,"control":M}`을 쓴다. 그 뒤 stdout에는 실제 `notify` 이벤트가 온다.
- 제어 서버(127.0.0.1:<controlPort>, 0이면 빈 포트): 테스트가 틱 보내기, WebSocket 끊기, 오프라인,
  한투 인증 실패, 분석·LLM 실패를 켜고 끄며 상태를 읽는다.

실행: uv run --project sidecar python apps/desktop/e2e/acceptance/stack.py <dataDir> <controlPort>
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import socket
import sys
import threading
import time
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, cast
from zoneinfo import ZoneInfo

import httpx
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed
from websockets.http11 import Response

from vater_core.__main__ import recover_analyses
from vater_core.alerts.clock import MarketClock
from vater_core.alerts.evaluator import record_event_alerts
from vater_core.alerts.monitor import AlertMonitor
from vater_core.alerts.store import WatchItem
from vater_core.brokers import kiwoom, meritz
from vater_core.briefing.interpret import build_messages
from vater_core.analysis.engine import Cancelled
from vater_core.analysis.models import EngineResult, Progress
from vater_core.analysis.queue import AnalysisQueue
from vater_core.analysis.summary import DecisionSummary
from vater_core.api.app import create_app
from vater_core.api.deps import AppDeps
from vater_core.api.events import EventBus
from vater_core.api.errors import VaterError
from vater_core.briefing.collect import Collected, Feeds
from vater_core.briefing.service import BriefingService
from vater_core.kis import config as kis_config
from vater_core.kis.config import KisServer
from vater_core.kis.models import Quote
from vater_core.kis.quotes import domestic_price, overseas_price
from vater_core.kis.services import require_kis
from vater_core.kis.ws import KisRealtime, Tick
from vater_core.llm.presets import LlmRun, TierChoice
from vater_core.portfolio.daily import DailyRecorder, DailyRepo
from vater_core.portfolio.service import PortfolioService
from vater_core.logging_setup import setup_logging
from vater_core.secrets.names import SecretName
from vater_core.secrets.store import EnvFileSecretStore
from vater_core.stdout_events import emit, notify
from vater_core.store.db import open_db
from vater_core.store.settings import SettingsRepo

HOST = "127.0.0.1"
KST = ZoneInfo("Asia/Seoul")
MONITOR_START = datetime(2026, 11, 3, 1, 0, tzinfo=UTC)  # 화 10:00 KST (국내 장중)
BRIEFING_START = datetime(2026, 11, 3, 7, 0, tzinfo=UTC)  # 화 16:00 KST (국내 장 마감 뒤)
SESSION = date(2026, 11, 2)  # 분석 기준일(직전 거래일)

SYMBOLS = [
    ("KR", "005930", "KOSPI", "삼성전자", "SAMSUNG ELECTRONICS", "stock"),
    ("KR", "000660", "KOSPI", "SK하이닉스", "SK HYNIX", "stock"),
    ("US", "AAPL", "NAS", "애플", "APPLE INC", "stock"),
    # v2: 보유(NAVER·엔비디아)와 분류 탐색(반도체·인터넷, 미분류)용
    ("KR", "035420", "KOSPI", "NAVER", "NAVER", "stock"),
    ("US", "NVDA", "NAS", "엔비디아", "NVIDIA CORP", "stock"),
    ("US", "AMD", "NAS", "AMD", "ADVANCED MICRO DEVICES", "stock"),
    ("US", "GOOGL", "NAS", "알파벳", "ALPHABET INC", "stock"),
    ("KR", "999999", "KOSDAQ", "가상기업", "FAKE CO", "stock"),
]
# 화면 밖에서 미리 넣는 가짜 키(마법사를 거치지 않는 테스트용). 실제 키가 아니다.
FAKE_SECRETS = {
    SecretName.KIS_APP_KEY: "PSacceptanceFAKEappKEY000000000000000",
    SecretName.KIS_APP_SECRET: "acceptance-fake-app-secret-not-real",
    SecretName.LLM_GOOGLE_KEY: "acceptance-fake-llm-key-not-real",
}
REPORT_TEXT = {
    "market_report": "Market report: the stock trended up with rising volume.",
    "sentiment_report": "Sentiment report: social mood is mildly positive.",
    "news_report": "News report: memory prices are recovering.",
    "fundamentals_report": "Fundamentals report: margins improved this quarter.",
    "investment_plan": "리서치 매니저: 강세 쪽 근거가 더 탄탄합니다.",
    "trader_investment_plan": "트레이더: 분할 매수를 제안합니다.",
    "final_trade_decision": "**Rating**: Buy\n포트폴리오 매니저: 매수 의견입니다.",
}
STAGES = (
    ("analysts", "Market Analyst"),
    ("research", "Bull Researcher"),
    ("trader", "Trader"),
    ("risk", "Neutral Analyst"),
    ("portfolio", "Portfolio Manager"),
)
BRIEFING_TEXT = {
    "headline": "반도체 대형주가 지수를 끌어올렸습니다.",
    "market": "코스피는 오름세로 마감했습니다.",
    "sectors": "전기전자 업종이 가장 강했습니다.",
    "flows": "외국인이 순매수했습니다.",
    "notable": "거래대금 상위는 대형주가 차지했습니다.",
    "watchlist": "감시 종목은 대체로 올랐습니다.",
}


def closed_port() -> int:
    """아무도 듣지 않는 포트(연결 거부). 오프라인 흉내에 쓴다."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((HOST, 0))
        return int(s.getsockname()[1])


class Control:
    """제어 서버가 바꾸는 상태. 이벤트 루프 스레드에서만 고친다(엔진 스레드는 읽기만)."""

    def __init__(self) -> None:
        self.auth_ok = True
        self.offline = False
        self.ws_down = False
        self.analysis_fail = False
        self.llm_fail = False
        self.stage_sec = 0.4
        # 한투 REST 현재가: code → (현재가, 전일 대비, 등락률)
        self.prices: dict[str, tuple[float, float, float]] = {
            "005930": (59000.0, 500.0, 0.85),
            "000660": (198500.0, -3300.0, -1.63),
            "AAPL": (227.48, 2.13, 0.95),
        }
        self.rest_paths: list[str] = []
        self.rest_trs: list[str] = []  # 한투 REST에 온 TR ID(주문 TR이 없는지 본다)
        self.tokens_issued = 0
        self.ws_connections: list[ServerConnection] = []
        self.ws_accepted = 0
        self.subscribed: list[str] = []
        self.rest_port = 0
        self.dead_port = closed_port()
        # v2: 키움·메리츠 가짜 서버 상태(ok | auth | down)와 받은 호출("METHOD /경로"), 환율·시계·AI 입력
        self.broker_mode = {"kiwoom": "ok", "meritz": "ok"}
        self.broker_calls: dict[str, list[str]] = {"kiwoom": [], "meritz": []}
        self.fx_off = False
        self.skew_min = 0
        self.ai_inputs: list[str] = []


C = Control()


# ── 가짜 한투 REST ──────────────────────────────────────────────────────────────

kis_rest = FastAPI()


def _auth_error() -> JSONResponse:
    return JSONResponse(
        {"error_code": "EGW00103", "error_description": "유효하지 않은 AppKey입니다."},
        status_code=403,
    )


@kis_rest.post("/oauth2/tokenP")
async def token_p(request: Request) -> JSONResponse:
    C.rest_paths.append("/oauth2/tokenP")
    if not C.auth_ok:
        return _auth_error()
    C.tokens_issued += 1
    expires = (datetime.now(UTC) + timedelta(hours=24)).astimezone(KST)
    return JSONResponse(
        {
            "access_token": f"fake-access-token-{C.tokens_issued}",
            "token_type": "Bearer",
            "expires_in": 86400,
            "access_token_token_expired": expires.strftime("%Y-%m-%d %H:%M:%S"),
        }
    )


@kis_rest.post("/oauth2/Approval")
async def approval(request: Request) -> JSONResponse:
    C.rest_paths.append("/oauth2/Approval")
    if not C.auth_ok:
        return _auth_error()
    return JSONResponse({"approval_key": "fake-approval-key"})


def _ok(**body: Any) -> JSONResponse:
    return JSONResponse({"rt_cd": "0", "msg_cd": "MCA00000", "msg1": "정상처리 되었습니다.", **body})


def _sign(change: float) -> str:
    return "2" if change > 0 else ("5" if change < 0 else "3")


def _closes(base: float, step: float) -> list[dict[str, str]]:
    rows = []
    for i in range(40):
        day = SESSION - timedelta(days=i)
        if day.weekday() >= 5:
            continue
        v = f"{base - i * step:.2f}"
        rows.append(
            {
                "stck_bsop_date": day.strftime("%Y%m%d"),
                "bstp_nmix_oprc": v,
                "bstp_nmix_hgpr": v,
                "bstp_nmix_lwpr": v,
                "bstp_nmix_prpr": v,
                "ovrs_nmix_oprc": v,
                "ovrs_nmix_hgpr": v,
                "ovrs_nmix_lwpr": v,
                "ovrs_nmix_prpr": v,
                "acml_vol": "1000",
            }
        )
    return rows



# 한투 잔고(공식 필드 이름은 test_kis.py와 같다). 계좌 12345678-01
KIS_DOMESTIC = [
    {"pdno": "005930", "prdt_name": "삼성전자", "hldg_qty": "10", "pchs_avg_pric": "60000.0000"},
    {"pdno": "000660", "prdt_name": "SK하이닉스", "hldg_qty": "2", "pchs_avg_pric": "190000.0000"},
]
KIS_OVERSEAS = [
    {"pdno": "AAPL", "prdt_name": "애플", "ccld_qty_smtl1": "1.5", "cblc_qty13": "999",
     "avg_unpr3": "200.00", "ovrs_excg_cd": "NASD", "natn_kor_name": "미국", "buy_crcy_cd": "USD"},
    {"pdno": "7203", "prdt_name": "토요타", "ccld_qty_smtl1": "100", "cblc_qty13": "999",
     "avg_unpr3": "2500", "ovrs_excg_cd": "TKSE", "natn_kor_name": "일본", "buy_crcy_cd": "JPY"},
]  # fmt: skip
KIS_ACCOUNT = "12345678"


def _price_of(code: str) -> float:
    return C.prices.get(code, (10000.0, 0.0, 0.0))[0]


def _weekdays(start: date, end: date) -> list[date]:
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    return [d for d in days if d.weekday() < 5]


def _ymd(raw: str) -> date:
    return date(int(raw[:4]), int(raw[4:6]), int(raw[6:8]))


def kr_close(code: str, day: date) -> float:
    """국내 일봉 종가: 현재가 + 일(day) × 100. 날마다 달라야 채운 값을 구별할 수 있다."""
    return _price_of(code) + day.day * 100


def us_close(code: str, day: date) -> float:
    return _price_of(code) + day.day


def fx_rate(day: date) -> float:
    return 1400.0 + day.day


@kis_rest.get("/{path:path}")
async def kis_get(path: str, request: Request) -> JSONResponse:
    full = "/" + path
    C.rest_paths.append(full)
    C.rest_trs.append(request.headers.get("tr_id", ""))
    if not C.auth_ok:  # 키가 만료·폐기됨: 토큰을 거부한다(클라이언트는 한 번 재발급을 시도한다)
        return JSONResponse(
            {"rt_cd": "1", "msg_cd": "EGW00123", "msg1": "기간이 만료된 token 입니다."},
            status_code=500,
        )
    q = request.query_params
    if full.endswith("/quotations/inquire-price"):
        price, change, pct = C.prices.get(q.get("FID_INPUT_ISCD", ""), (10000.0, 0.0, 0.0))
        return _ok(
            output={
                "stck_prpr": f"{price:.0f}",
                "prdy_vrss": f"{abs(change):.0f}",
                "prdy_vrss_sign": _sign(change),
                "prdy_ctrt": f"{pct:.2f}",
                "acml_vol": "1000000",
            }
        )
    if full.endswith("/overseas-price/v1/quotations/price"):
        price, change, pct = C.prices.get(q.get("SYMB", ""), (100.0, 0.0, 0.0))
        return _ok(
            output={
                "last": f"{price:.2f}",
                "diff": f"{abs(change):.2f}",
                "sign": _sign(change),
                "rate": f"{pct:.2f}",
                "tvol": "5000000",
            }
        )
    if full.endswith("/inquire-index-price"):
        return _ok(
            output={
                "bstp_nmix_prpr": "2583.27",
                "bstp_nmix_prdy_vrss": "21.48",
                "prdy_vrss_sign": "2",
                "bstp_nmix_prdy_ctrt": "0.84",
            }
        )
    if full.endswith("/inquire-daily-indexchartprice"):
        return _ok(output1={}, output2=_closes(2583.27, 3.0))
    if full.endswith("/inquire-daily-chartprice") and q.get("FID_INPUT_ISCD") == "FX@KRW":
        days = [] if C.fx_off else _weekdays(_ymd(q["FID_INPUT_DATE_1"]), _ymd(q["FID_INPUT_DATE_2"]))
        rows = [
            {"stck_bsop_date": d.strftime("%Y%m%d"), "ovrs_nmix_prpr": f"{fx_rate(d):.2f}"}
            for d in reversed(days)
        ]
        return _ok(output1={}, output2=rows)
    if full.endswith("/trading/inquire-balance"):
        if q.get("CANO") != KIS_ACCOUNT or request.headers.get("tr_id") != "TTTC8434R":
            return JSONResponse(
                {"rt_cd": "7", "msg_cd": "OPSQ2000", "msg1": "ERROR : INPUT INVALID_CHECK_ACNO"}
            )
        return _ok(output1=KIS_DOMESTIC, output2=[{"scts_evlu_amt": "1000000"}])
    if full.endswith("/trading/inquire-present-balance"):
        return _ok(output1=KIS_OVERSEAS, output2=[], output3={"evlu_amt_smtl": "1000"})
    if full.endswith("/inquire-daily-itemchartprice"):
        code = q.get("FID_INPUT_ISCD", "")
        rows = [
            {
                "stck_bsop_date": d.strftime("%Y%m%d"),
                "stck_oprc": f"{kr_close(code, d):.0f}",
                "stck_hgpr": f"{kr_close(code, d):.0f}",
                "stck_lwpr": f"{kr_close(code, d):.0f}",
                "stck_clpr": f"{kr_close(code, d):.0f}",
                "acml_vol": "1000",
            }
            for d in reversed(_weekdays(_ymd(q["FID_INPUT_DATE_1"]), _ymd(q["FID_INPUT_DATE_2"])))
        ]
        return _ok(output1={}, output2=rows)
    if full.endswith("/overseas-price/v1/quotations/dailyprice"):
        code, end = q.get("SYMB", ""), _ymd(q["BYMD"])
        days = _weekdays(end - timedelta(days=140), end)[-100:]  # 한 번에 약 100행
        rows = [
            {
                "xymd": d.strftime("%Y%m%d"),
                "open": f"{us_close(code, d):.2f}",
                "high": f"{us_close(code, d):.2f}",
                "low": f"{us_close(code, d):.2f}",
                "clos": f"{us_close(code, d):.2f}",
                "tvol": "1000",
            }
            for d in reversed(days)
        ]
        return _ok(output1={}, output2=rows)
    if full.endswith("/inquire-daily-chartprice"):
        return _ok(
            output1={
                "hts_kor_isnm": q.get("FID_INPUT_ISCD", ""),
                "ovrs_nmix_prpr": "6012.40",
                "ovrs_nmix_prdy_vrss": "12.30",
                "prdy_vrss_sign": "2",
                "prdy_ctrt": "0.21",
            },
            output2=_closes(6012.4, 5.0),
        )
    if full.endswith("/chk-holiday"):
        day = q.get("BASS_DT", SESSION.strftime("%Y%m%d"))
        d = date(int(day[:4]), int(day[4:6]), int(day[6:8]))
        flag = "Y" if d.weekday() < 5 else "N"
        return _ok(output=[{"bass_dt": day, "bzdy_yn": flag, "tr_day_yn": flag, "opnd_yn": flag}])
    return JSONResponse({"rt_cd": "1", "msg_cd": "FAKE404", "msg1": f"가짜 한투에 없는 경로: {full}"})


# ── 가짜 한투 WebSocket ─────────────────────────────────────────────────────────


def _ws_gate(connection: ServerConnection, request: Any) -> Response | None:
    if C.offline or C.ws_down:
        return connection.respond(503, "fake KIS websocket is down\n")
    return None


async def ws_handler(ws: ServerConnection) -> None:
    C.ws_accepted += 1
    C.ws_connections.append(ws)
    try:
        with contextlib.suppress(ConnectionClosed):
            async for msg in ws:
                body = json.loads(msg)
                tr = body["body"]["input"]
                if not C.auth_ok:
                    await ws.send(
                        json.dumps(
                            {
                                "header": {"tr_id": tr["tr_id"], "tr_key": tr["tr_key"]},
                                "body": {
                                    "rt_cd": "1",
                                    "msg_cd": "OPSP0011",
                                    "msg1": "invalid approval : NOT FOUND",
                                },
                            }
                        )
                    )
                    continue
                if body["header"].get("tr_type") == "1":
                    C.subscribed.append(tr["tr_key"])
    finally:
        with contextlib.suppress(ValueError):
            C.ws_connections.remove(ws)


async def send_tick(code: str, price: float, pct: float, volume: int) -> int:
    rec = [code, "100001", f"{price:.0f}", "2", "0", f"{pct:.2f}"] + ["0"] * 7 + [str(volume)]
    rec += ["0"] * (46 - len(rec))
    sent = 0
    for ws in list(C.ws_connections):
        with contextlib.suppress(ConnectionClosed):
            await ws.send("0|H0STCNT0|001|" + "^".join(rec))
            sent += 1
    return sent


async def drop_ws() -> None:
    for ws in list(C.ws_connections):
        with contextlib.suppress(Exception):
            await ws.close()


# ── 가짜 키움·메리츠 ────────────────────────────────────────────────────────────
# 받은 호출은 모두 기록한다. 공식 목록 밖의 경로나 방법(주문 등)이 오면 "UNEXPECTED"로 따로 남겨 테스트가 본다.

kiwoom_app = FastAPI()
meritz_app = FastAPI()
KIWOOM_OK = {"return_code": 0, "return_msg": "정상적으로 처리되었습니다"}
KIWOOM_KR = [
    {"stk_cd": "A005930", "stk_nm": "삼성전자", "rmnd_qty": "000000000000005",
     "pur_pric": "000000000066000"},
    {"stk_cd": "A035420", "stk_nm": "NAVER", "rmnd_qty": "000000000000003",
     "pur_pric": "000000000200000"},
]  # fmt: skip
KIWOOM_US = [
    {"stk_cd": "NVDA", "frgn_stk_nm": "엔비디아", "poss_qty": "000000000002",
     "frgn_stk_book_uv": "100.0000", "crnc_code": "USD"},
]  # fmt: skip


def _record(broker: str, request: Request) -> None:
    C.broker_calls[broker].append(f"{request.method} {request.url.path}")


@kiwoom_app.post("/oauth2/token")
async def kiwoom_token(request: Request) -> JSONResponse:
    _record("kiwoom", request)
    mode = C.broker_mode["kiwoom"]
    if mode == "down":
        return JSONResponse({}, status_code=500)
    if mode == "auth":
        return JSONResponse({"return_code": 3, "return_msg": "[3:인증에 실패했습니다]"}, 401)
    return JSONResponse(
        {"token": f"fake-kiwoom-token-{len(C.broker_calls['kiwoom'])}",
         "expires_dt": "20991231235959", "token_type": "bearer", "return_code": 0}
    )  # fmt: skip


async def _kiwoom_data(request: Request, api_id: str, body: dict[str, Any]) -> JSONResponse:
    _record("kiwoom", request)
    mode = C.broker_mode["kiwoom"]
    if mode == "down":
        return JSONResponse({}, status_code=500)
    if mode == "auth" or not request.headers.get("authorization", "").startswith("Bearer fake-"):
        return JSONResponse({"return_code": 3, "return_msg": "[3:인증에 실패했습니다]"}, 401)
    if request.headers.get("api-id") != api_id:
        return JSONResponse({"return_code": 1, "return_msg": "api-id 불일치"}, 400)
    return JSONResponse(body, headers={"cont-yn": "N", "next-key": ""})


@kiwoom_app.post("/api/dostk/acnt")
async def kiwoom_kr(request: Request) -> JSONResponse:
    body = {**KIWOOM_OK, "tot_evlt_amt": "000000025789890", "acnt_evlt_remn_indv_tot": KIWOOM_KR}
    return await _kiwoom_data(request, "kt00018", body)


@kiwoom_app.post("/api/us/acnt")
async def kiwoom_us(request: Request) -> JSONResponse:
    body = {**KIWOOM_OK, "tot_evlt_amt": "156464.6701", "result_list": KIWOOM_US}
    return await _kiwoom_data(request, "ust21070", body)


@kiwoom_app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def kiwoom_other(path: str, request: Request) -> JSONResponse:
    C.broker_calls["kiwoom"].append(f"UNEXPECTED {request.method} {request.url.path}")
    return JSONResponse({"return_code": 1, "return_msg": "없는 경로"}, 404)


def _meritz_ok(data: Any) -> dict[str, Any]:
    return {"rsp_cd": "5766", "rsp_msg": "조회가 완료되었습니다.", "data": data, "tr_cont": "0"}


MERITZ_KR = [
    {"iscd": "A000660", "isnm": "SK하이닉스", "pros_trgt_cls_code": "1", "mksc_cls_name": "주식일반",
     "rmnd_qty": 1, "hldn_issu_rmnd_qty": "1", "byng_unpr": "202000.00"},
    {"iscd": "AAPL.OQ", "isnm": "애플", "pros_trgt_cls_code": "J", "mksc_cls_name": "해외주식",
     "rmnd_qty": 1, "hldn_issu_rmnd_qty": "1", "byng_unpr": "0.00"},
]  # fmt: skip
MERITZ_US = [
    {"iscd": "AAPL.OQ", "ovrs_stck_symb_iscd": "AAPL", "isnm": "애플",
     "rmnd_dqty": "1.0000000000", "avrg_unpr": "188.000000", "crcd": "USD"},
]  # fmt: skip


async def _meritz_data(request: Request, data: Any) -> JSONResponse:
    _record("meritz", request)
    mode = C.broker_mode["meritz"]
    if mode == "down":
        return JSONResponse({"rsp_cd": "EGW00002", "rsp_msg": "서버 오류"}, status_code=500)
    token = request.headers.get("authorization", "")
    if mode == "auth" or not token.startswith("Bearer fake-"):
        return JSONResponse({"rsp_cd": "EGW00123", "rsp_msg": "토큰 만료"}, status_code=401)
    if not request.headers.get("mac_address"):
        return JSONResponse({"rsp_cd": "IGW50024", "rsp_msg": "MAC 주소 필요"}, status_code=500)
    return JSONResponse(_meritz_ok(data))


@meritz_app.post("/oauth2/token")
async def meritz_token(request: Request) -> JSONResponse:
    _record("meritz", request)
    mode = C.broker_mode["meritz"]
    if mode == "down":
        return JSONResponse({"rsp_cd": "EGW00002", "rsp_msg": "서버 오류"}, status_code=500)
    if mode == "auth":
        return JSONResponse(
            {"error": "invalid_client", "error_description": "앱키 확인"}, status_code=401
        )
    return JSONResponse(
        {"access_token": f"fake-meritz-token-{len(C.broker_calls['meritz'])}",
         "token_type": "Bearer", "expires_in": 43200, "scope": "login"}
    )  # fmt: skip


@meritz_app.get("/accounts/v1/me/holdings")
async def meritz_kr(request: Request) -> JSONResponse:
    return await _meritz_data(request, MERITZ_KR)


@meritz_app.get("/accounts/v1/me/overseas/holdings")
async def meritz_us(request: Request) -> JSONResponse:
    return await _meritz_data(request, MERITZ_US)


@meritz_app.get("/accounts/v1/me/valuation/by-asset")
async def meritz_asset(request: Request) -> JSONResponse:
    return await _meritz_data(request, {"vltn_amt": 1000, "byng_amt": 900})


@meritz_app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def meritz_other(path: str, request: Request) -> JSONResponse:
    C.broker_calls["meritz"].append(f"UNEXPECTED {request.method} {request.url.path}")
    return JSONResponse({"rsp_cd": "EGW00404", "rsp_msg": "없는 경로"}, 404)


# ── 가짜 엔진·브리핑 ───────────────────────────────────────────────────────────


class ResourceExhausted(Exception):
    """클라우드 LLM 호출 한도 초과(가짜). 실제로는 LLM SDK의 예외가 그대로 올라온다."""


class FakeEngine:
    def run(
        self, job: Any, on_progress: Any, cancel: threading.Event, kis: Any
    ) -> EngineResult:
        t0 = time.monotonic()
        timings: dict[str, float] = {}
        for i, (stage, node) in enumerate(STAGES):
            start = time.monotonic()
            on_progress(Progress(stage, node, round(start - t0, 1)))
            time.sleep(C.stage_sec)
            if cancel.is_set():
                raise Cancelled
            if C.analysis_fail and i == 1:
                raise ResourceExhausted("429 quota exceeded")
            timings[stage] = round(time.monotonic() - start, 1)
        return EngineResult(
            summary=DecisionSummary(
                "Buy",
                ("메모리 업황이 회복되고 있습니다.", "이익률이 좋아졌습니다.", "수급이 우호적입니다."),
                "250000",
                "3-6 months",
            ),
            reports=dict(REPORT_TEXT),
            timings=timings,
            tokens={"in": 12000, "out": 3400},
        )


def briefing_data(market: str, session: date) -> dict[str, Any]:
    def closes(base: float) -> list[dict[str, Any]]:
        return [
            {"day": (session - timedelta(days=29 - i)).isoformat(), "close": base + i}
            for i in range(30)
        ]

    if market == "US":  # 미국 브리핑은 지수만 모은다(실제 수집과 같음)
        return {
            "market": market,
            "session": session.isoformat(),
            "indices": [
                {"code": "SPX", "name": "S&P 500", "value": 6012.4, "change": 12.3,
                 "change_pct": 0.21, "closes": closes(5980)},
                {"code": "COMP", "name": "나스닥", "value": 19870.2, "change": -40.1,
                 "change_pct": -0.2, "closes": closes(19800)},
            ],  # fmt: skip
            "watchlist": [],
            "alerts": [],
        }
    return {
        "market": market,
        "session": session.isoformat(),
        "indices": [
            {"code": "0001", "name": "코스피", "value": 2583.27, "change": 21.48,
             "change_pct": 0.84, "closes": closes(2550)},
            {"code": "1001", "name": "코스닥", "value": 742.15, "change": -4.12,
             "change_pct": -0.55, "closes": closes(730)},
        ],  # fmt: skip
        "sectors": {
            "KOSPI": {
                "index": {"code": "0001", "name": "코스피", "value": 2583.27, "change": 21.48,
                          "change_pct": 0.84},
                "advancers": 512, "decliners": 318, "unchanged": 76,
                "sectors": [{"code": "0013", "name": "전기전자", "value": 31244.1,
                             "change": 701.2, "change_pct": 2.3}],
            },
        },  # fmt: skip
        "movers": {
            "up": [{"rank": 1, "code": "123456", "name": "가나전자", "price": 12300,
                    "change_pct": 29.92, "trading_value": 51200000000}],
            "down": [{"rank": 1, "code": "654321", "name": "다라바이오", "price": 4100,
                      "change_pct": -18.4, "trading_value": 820000000}],
            "value": [{"rank": 1, "code": "005930", "name": "삼성전자", "price": 71400,
                       "change_pct": 1.71, "trading_value": 1824000000000}],
        },  # fmt: skip
        "flows": {
            "KOSPI": {"day": session.isoformat(), "foreign": 312400, "institution": -152000,
                      "individual": -160400},
        },  # fmt: skip
        "watchlist": [{"code": "005930", "name": "삼성전자", "price": 59000, "change_pct": 0.85}],
        "alerts": [],
    }


# ── 조립 ──────────────────────────────────────────────────────────────────────


def build(data_dir: Path, token: str) -> tuple[AppDeps, AlertMonitor]:
    db = open_db(data_dir)
    if db.execute("SELECT COUNT(*) FROM symbols").fetchone()[0] == 0:
        db.executemany(
            "INSERT INTO symbols (market, code, exchange, name, name_en, kind) "
            "VALUES (?,?,?,?,?,?)",
            SYMBOLS,
        )
        db.commit()
        # 폴링 간격 최솟값(10초): 끊김·복구가 화면에 빨리 드러나게 한다
        SettingsRepo(db).update({"alerts.poll_interval_sec": 10})
    secrets = EnvFileSecretStore(data_dir / "secrets.env")
    setup_logging(data_dir, secrets.known_values)
    deps = AppDeps(
        token=token,
        dev=False,  # 설치한 앱과 같은 모드: Tauri 출처만 CORS 허용
        data_dir=data_dir,
        db=db,
        secrets=secrets,
        events=EventBus(),
        http=httpx.AsyncClient(timeout=5),
    )
    recover_analyses(db)

    monitor_offset = MONITOR_START - datetime.now(UTC)
    briefing_offset = BRIEFING_START - datetime.now(UTC)

    def monitor_now() -> datetime:
        return datetime.now(UTC) + monitor_offset

    def briefing_now() -> datetime:
        return datetime.now(UTC) + briefing_offset

    async def weekdays(day: date) -> bool:
        return day.weekday() < 5

    async def price(item: WatchItem) -> Quote:
        client = require_kis(deps).client
        if item.market == "KR":
            return await domestic_price(client, item.code)
        return await overseas_price(client, cast(Any, item.exchange), item.code)

    async def bars(item: WatchItem, through: date) -> int:
        return 0  # 가격 규칙만 쓴다(일봉은 받지 않는다)

    def realtime(on_tick: Any, on_state: Any, limit: int) -> KisRealtime:
        kis = require_kis(deps)
        return KisRealtime(kis.tokens, kis.server, on_tick, on_state, limit, backoff=(0.5, 1.0))

    monitor = AlertMonitor(
        deps,
        clock=MarketClock(weekdays, now=monitor_now),
        realtime_factory=realtime,
        price_fn=price,
        bars_fn=bars,
        notify_fn=notify,
        now=monitor_now,
    )
    deps.alerts = monitor

    async def latest(_: Any) -> date:
        return SESSION

    deps.analysis = AnalysisQueue(deps, FakeEngine(), latest_day=latest, notify_fn=notify)

    async def collect(
        market: str, session: date, feeds: Any, db: Any, *, alerts_until: datetime
    ) -> Collected:
        await asyncio.sleep(0.3)
        return Collected(briefing_data(market, session), [])

    def interpret(market: str, data: dict[str, Any], run: LlmRun) -> dict[str, str]:
        # 실제 프롬프트 조립 코드로 AI에 갈 요청 전체를 만들어 기록한다(V10이 개인정보가 없는지 본다)
        C.ai_inputs.append(json.dumps(build_messages(market, data), ensure_ascii=False))
        if C.llm_fail:
            raise VaterError("BRIEFING_LLM_FAILED", "AI 해석에 실패했습니다 (RateLimit).", status=502)
        return dict(BRIEFING_TEXT)

    def daily_now() -> datetime:  # 브리핑 시계 + 제어 서버가 앞당긴 분(재시도 간격을 건너뛴다)
        return briefing_now() + timedelta(minutes=C.skew_min)

    deps.daily = DailyRecorder(
        deps, clock=MarketClock(weekdays, now=daily_now), now=daily_now
    )  # 자동 반복은 켜지 않고 제어 서버가 check_once를 부른다
    deps.portfolio = PortfolioService(deps, now=lambda: daily_now().astimezone(KST))
    daily = deps.daily

    async def assets(market: Any, session: date) -> dict[str, Any] | None:
        return await daily.my_assets(market, session)

    tier = TierChoice("google", "gemini-fake", None)
    deps.briefing = BriefingService(
        deps,
        clock=MarketClock(weekdays, now=briefing_now),
        feeds_fn=lambda: cast(Feeds, None),
        run_fn=lambda: LlmRun("cloud", tier, tier, {}, {}),
        collect_fn=collect,
        interpret_fn=interpret,
        notify_fn=notify,
        now=briefing_now,
        assets_fn=assets,
    )
    return deps, monitor


def control_app(deps: AppDeps, monitor: AlertMonitor) -> FastAPI:
    app = FastAPI()

    @app.post("/setup")
    async def setup(body: dict[str, Any]) -> dict[str, bool]:
        assert deps.secrets is not None
        if body.get("kis"):
            deps.secrets.set(SecretName.KIS_APP_KEY, FAKE_SECRETS[SecretName.KIS_APP_KEY])
            deps.secrets.set(SecretName.KIS_APP_SECRET, FAKE_SECRETS[SecretName.KIS_APP_SECRET])
        if body.get("llm"):
            deps.secrets.set(SecretName.LLM_GOOGLE_KEY, FAKE_SECRETS[SecretName.LLM_GOOGLE_KEY])
        return {"ok": True}

    @app.post("/tick")
    async def tick(body: dict[str, Any]) -> dict[str, int]:
        sent = await send_tick(
            str(body["code"]), float(body["price"]), float(body.get("pct", 0.0)),
            int(body.get("volume", 1000)),
        )  # fmt: skip
        return {"sent": sent}

    @app.post("/price")
    async def set_price(body: dict[str, Any]) -> dict[str, bool]:
        C.prices[str(body["code"])] = (
            float(body["price"]), float(body["change"]), float(body["pct"]),
        )  # fmt: skip
        return {"ok": True}

    @app.post("/ws")
    async def ws_state(body: dict[str, Any]) -> dict[str, bool]:
        C.ws_down = bool(body.get("down"))
        if body.get("drop") or C.ws_down:
            await drop_ws()
        return {"ok": True}

    @app.post("/offline")
    async def offline(body: dict[str, Any]) -> dict[str, bool]:
        C.offline = bool(body.get("on"))
        port = C.dead_port if C.offline else C.rest_port
        for server in KisServer:
            kis_config.REST_HOST[server] = f"http://{HOST}:{port}"
        if C.offline:
            await drop_ws()
        return {"ok": True}

    @app.post("/auth")
    async def auth(body: dict[str, Any]) -> dict[str, bool]:
        C.auth_ok = bool(body.get("ok"))
        return {"ok": True}

    @app.post("/analysis")
    async def analysis(body: dict[str, Any]) -> dict[str, bool]:
        C.analysis_fail = bool(body.get("fail"))
        if "stage_sec" in body:
            C.stage_sec = float(body["stage_sec"])
        return {"ok": True}

    @app.post("/llm")
    async def llm(body: dict[str, Any]) -> dict[str, bool]:
        C.llm_fail = bool(body.get("fail"))
        return {"ok": True}

    @app.post("/broker")
    async def broker(body: dict[str, Any]) -> dict[str, bool]:
        C.broker_mode[str(body["broker"])] = str(body["mode"])
        return {"ok": True}

    @app.post("/fx")
    async def fx(body: dict[str, Any]) -> dict[str, bool]:
        C.fx_off = bool(body.get("off"))
        return {"ok": True}

    @app.post("/skew")
    async def skew(body: dict[str, Any]) -> dict[str, bool]:
        C.skew_min += int(body["minutes"])
        return {"ok": True}

    @app.post("/daily/seed")
    async def daily_seed(body: dict[str, Any]) -> dict[str, bool]:
        assert deps.db is not None
        DailyRepo(deps.db).fill(
            date.fromisoformat(str(body["day"])),
            body.get("kr_value"), body.get("kr_cost"), body.get("us_value"), body.get("us_cost"),
            body.get("usdkrw"), backfilled=False,
        )  # fmt: skip
        return {"ok": True}

    @app.post("/daily/check")
    async def daily_check() -> dict[str, bool]:
        assert deps.daily is not None
        await deps.daily.check_once()
        return {"ok": True}

    @app.get("/state")
    async def state() -> dict[str, Any]:
        return {
            "broker_calls": C.broker_calls,
            "ai_inputs": C.ai_inputs,
            "subscribed": C.subscribed,
            "ws_open": len(C.ws_connections),
            "ws_accepted": C.ws_accepted,
            "rest_paths": C.rest_paths,
            "rest_trs": C.rest_trs,
            "tokens_issued": C.tokens_issued,
            "monitor": monitor.status(),
            "pid": os.getpid(),
        }

    return app


def bind() -> socket.socket:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind((HOST, 0))
    sock.listen(128)
    return sock


def quiet_server(app: Any) -> uvicorn.Server:
    return uvicorn.Server(uvicorn.Config(app, log_config=None, access_log=False, lifespan="off"))


def main() -> None:
    data_dir = Path(sys.argv[1])
    control_port = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    token = os.environ["VATER_TOKEN"]
    deps, monitor = build(data_dir, token)

    rest_sock = bind()
    C.rest_port = rest_sock.getsockname()[1]
    for server in KisServer:  # 이 판에서만: 한투 주소를 로컬 가짜로
        kis_config.REST_HOST[server] = f"http://{HOST}:{C.rest_port}"

    kiwoom_sock, meritz_sock = bind(), bind()
    kiwoom.BASE_URL = f"http://{HOST}:{kiwoom_sock.getsockname()[1]}"  # 어댑터가 부를 때마다 읽는다
    meritz.BASE_URL = f"http://{HOST}:{meritz_sock.getsockname()[1]}"
    meritz.mac_address = lambda: "AABBCCDDEEFF"  # 이 PC의 MAC 주소를 읽지 않는다

    sidecar_sock = bind()
    control_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    control_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    control_sock.bind((HOST, control_port))
    control_sock.listen(16)

    sidecar = uvicorn.Server(uvicorn.Config(create_app(deps), log_config=None, access_log=False))
    fake_rest = quiet_server(kis_rest)
    fake_kiwoom = quiet_server(kiwoom_app)
    fake_meritz = quiet_server(meritz_app)
    control = quiet_server(control_app(deps, monitor))

    def request_exit() -> None:
        sidecar.should_exit = True

    deps.shutdown = request_exit

    async def serve_all() -> None:
        async with serve(ws_handler, HOST, 0, process_request=_ws_gate) as ws_server:
            ws_port = next(iter(ws_server.sockets)).getsockname()[1]
            for server in KisServer:
                kis_config.WS_HOST[server] = f"ws://{HOST}:{ws_port}"
            assert deps.events is not None and deps.db is not None
            stop_event_alerts = record_event_alerts(deps.events, deps.db)
            assert deps.analysis is not None
            deps.analysis.start()
            monitor.start()
            emit(
                "ready",
                port=sidecar_sock.getsockname()[1],
                control=control_sock.getsockname()[1],
            )
            tasks = [
                asyncio.create_task(fake_rest.serve(sockets=[rest_sock])),
                asyncio.create_task(fake_kiwoom.serve(sockets=[kiwoom_sock])),
                asyncio.create_task(fake_meritz.serve(sockets=[meritz_sock])),
                asyncio.create_task(control.serve(sockets=[control_sock])),
            ]
            try:
                await sidecar.serve(sockets=[sidecar_sock])
            finally:
                stop_event_alerts()
                await monitor.stop()
                await deps.analysis.stop()
                if deps.briefing is not None:
                    await deps.briefing.stop()
                fake_rest.should_exit = fake_kiwoom.should_exit = fake_meritz.should_exit = True
                control.should_exit = True
                await asyncio.gather(*tasks, return_exceptions=True)
                if deps.http is not None:
                    await deps.http.aclose()

    asyncio.run(serve_all())
    sys.stdout.flush()
    os._exit(0)  # 엔진 스레드(daemon)가 남아 있어도 바로 끝낸다


if __name__ == "__main__":
    main()
