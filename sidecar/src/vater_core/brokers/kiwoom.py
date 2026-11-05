"""키움증권 보유 조회 (v2 설계 1, 8장). 공식 명세의 kt00018과 ust21070만 부른다.

키가 계좌에 묶여 있어 계좌번호를 보내지 않는다. 실전 서버만 쓴다. 토큰은 만료 응답을 받으면 다시
발급하므로 만료 시각을 따로 두지 않는다(값 그대로 저장해야 로그 마스킹에 잡힌다).
"""

import asyncio
import re
from typing import Any

from vater_core.api.errors import VaterError
from vater_core.brokers.base import ADAPTERS, BrokerContext, average, number, stock_code
from vater_core.secrets.names import broker_secret
from vater_core.store.holdings import HoldingRow, bad_broker_response

BASE_URL = "https://api.kiwoom.com"
TOKEN_PATH = "/oauth2/token"  # noqa: S105  (경로이지 비밀값이 아니다)
KR_PATH = "/api/dostk/acnt"
US_PATH = "/api/us/acnt"
_ALLOWED = frozenset({("POST", TOKEN_PATH), ("POST", KR_PATH), ("POST", US_PATH)})
_API_IDS = {KR_PATH: "kt00018", US_PATH: "ust21070"}  # 경로마다 부를 수 있는 TR은 하나다
MAX_PAGES = 20  # 다 못 받으면 저장하지 않는다. 일부만 저장하면 나머지를 판 것으로 알게 된다
PAGE_DELAY_SEC = (
    0.25  # 조회는 초당 5회까지다. 비정상 부하가 반복되면 서비스가 해지된다(약관 8, 9조)
)
_AUTH_FAILED = 3  # 사유가 return_msg에 들어 있을 때가 많다
_RETRY_CODES = {_AUTH_FAILED, 8005, 8010, 8031, 8103}  # 토큰 무효, 발급 IP 변경, 투자구분 불일치
_RATE_CODES = {5, 1700, 1701, 1702}
_NOT_AUTH_CODES = {8003, 8006, 8009, 8104, 8200}  # 토큰 조회·생성·발급 장애, 모의·법인 미지원
_EMBEDDED = re.compile(r"\[(\d{3,5}):")


def _auth_error(detail: str = "") -> VaterError:
    return VaterError(
        "BROKER_AUTH_INVALID",
        f"키움 인증에 실패했습니다. {detail}".strip(),
        "앱키와 시크릿키를 확인해 주세요. 3개월 동안 접속하지 않으면 키가 자동 해지되니, "
        "해지됐다면 키움 REST API 홈페이지에서 재신청해 주세요. "
        "다른 프로그램이 같은 키를 쓰고 있어도 끊길 수 있습니다.",
        status=401,
    )


def _return_code(payload: Any) -> int | None:
    if not isinstance(payload, dict):
        return None
    if found := _EMBEDDED.search(str(payload.get("return_msg", ""))):  # 3 + "[8005:...]" 형태
        return int(found.group(1))
    try:
        return int(payload["return_code"])
    except (KeyError, TypeError, ValueError):
        return None


def _check(status: int, payload: Any, code: int | None) -> None:
    detail = str(payload.get("return_msg", "")) if isinstance(payload, dict) else ""
    if status == 429 or code in _RATE_CODES:
        raise VaterError(
            "BROKER_RATE_LIMITED",
            "키움 호출 한도를 넘었습니다.",
            "잠시 후 다시 시도해 주세요.",
            status=429,
        )
    if status >= 500:
        raise VaterError(
            "BROKER_UNREACHABLE",
            "증권사 서버에 연결할 수 없습니다.",
            "잠시 후 다시 시도해 주세요.",
            status=503,
        )
    if not isinstance(payload, dict):
        raise bad_broker_response()
    in_auth_range = code is not None and 8000 <= code < 9000 and code not in _NOT_AUTH_CODES
    if status == 401 or code == _AUTH_FAILED or in_auth_range:
        raise _auth_error(detail)
    if code or status != 200:
        raise VaterError("BROKER_API_ERROR", f"키움: {detail or status}", status=502)


def _json(response: Any) -> Any:
    try:
        return response.json()
    except ValueError:
        return None


def _kr_code(raw: Any) -> str:
    """접두어 1자리 + 코드 6자리. 접두어는 A(주식), J(ELW), Q(ETN)다. `_NX`는 넥스트레이드 표시."""
    code = stock_code(raw).split("_")[0]
    return code[1:] if len(code) == 7 and code[0] in "AJQ" else code


def _require_zero_total(body: dict[str, Any], field: str) -> None:
    """빈 목록을 "다 팔았다"로 믿기 전에 합계로 확인한다. 저장된 내역을 지우는 일이라 그렇다."""
    if number(body.get(field)) != 0:
        raise bad_broker_response()


class KiwoomAdapter:
    def __init__(self, ctx: BrokerContext) -> None:
        self._creds = ctx.creds
        self._secrets = ctx.secrets
        self._broker = ctx.make_http(BASE_URL, _ALLOWED)
        self._token_name = broker_secret(ctx.creds.conn_id, "TOKEN")

    async def _issue_token(self) -> str:
        r = await self._broker.request(
            "POST",
            TOKEN_PATH,
            json={
                "grant_type": "client_credentials",
                "appkey": self._creds.app_key,
                "secretkey": self._creds.app_secret,
            },
        )
        payload = _json(r)
        _check(r.status_code, payload, _return_code(payload))
        token = payload.get("token")
        if not token:
            raise bad_broker_response()
        self._secrets.set(self._token_name, str(token))
        return str(token)

    async def _call(
        self, path: str, body: dict[str, str], next_key: str | None
    ) -> tuple[dict[str, Any], str | None]:
        """응답 본문과 다음 쪽 키. 토큰이 거부되면 한 번만 다시 받는다."""
        reissued = False
        while True:
            token = self._secrets.get(self._token_name) or await self._issue_token()
            headers = {"api-id": _API_IDS[path], "authorization": f"Bearer {token}"}
            if next_key:
                headers |= {"cont-yn": "Y", "next-key": next_key}
            r = await self._broker.request("POST", path, json=body, headers=headers)
            payload = _json(r)
            code = _return_code(payload)
            if r.status_code == 401 or code in _RETRY_CODES:
                if reissued:
                    raise _auth_error(str((payload or {}).get("return_msg", "")))
                self._secrets.delete(self._token_name)
                reissued = True
                continue
            _check(r.status_code, payload, code)
            if code != 0:  # return_code가 없거나 읽을 수 없으면 성공으로 보지 않는다
                raise bad_broker_response()
            more = (r.headers.get("cont-yn") or "").upper()
            following = r.headers.get("next-key") or ""
            if more == "Y":
                return payload, following
            if more != "N" and following:
                raise bad_broker_response()
            return payload, None

    async def _rows(self, path: str, body: dict[str, str], list_field: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        key: str | None = None
        for _ in range(MAX_PAGES):
            payload, following = await self._call(path, body, key)
            page = payload.get(list_field)
            if not isinstance(page, list) or any(r in rows for r in page):
                raise bad_broker_response()
            rows += page
            if following is None:
                if not rows:
                    _require_zero_total(payload, "tot_evlt_amt")
                return rows
            if not following or following == key:
                raise bad_broker_response()
            key = following
            await asyncio.sleep(PAGE_DELAY_SEC)
        raise bad_broker_response()

    async def test(self) -> None:
        """국내·미국을 모두 불러 본다. 한쪽만 안 되는 키를 저장한 뒤 매번 실패하지 않게."""
        await self.holdings()

    async def holdings(self) -> list[HoldingRow]:
        kr = await self._rows(
            KR_PATH, {"qry_tp": "1", "dmst_stex_tp": "KRX"}, "acnt_evlt_remn_indv_tot"
        )
        us = await self._rows(US_PATH, {"stex_tp": "", "stk_cd": ""}, "result_list")
        rows = [
            HoldingRow(
                "KR",
                _kr_code(r.get("stk_cd")),
                r.get("stk_nm") or r["stk_cd"],
                number(r["rmnd_qty"]),
                average(r.get("pur_pric")),
                "KRW",
            )
            for r in kr
        ]
        for r in us:
            currency = r.get("crnc_code") or "USD"
            rows.append(
                HoldingRow(
                    "US" if currency == "USD" else None,
                    stock_code(r.get("stk_cd")),
                    r.get("frgn_stk_nm") or r["stk_cd"],
                    number(r["poss_qty"]),
                    average(r.get("frgn_stk_book_uv")),
                    currency,
                )
            )
        return rows


ADAPTERS["kiwoom"] = KiwoomAdapter
