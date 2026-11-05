"""메리츠증권 보유 조회 (v2 설계 1, 8장). 공식 카탈로그의 holdings와 ovs_holdings만 부른다.

키가 계좌에 묶여 있어 계좌번호를 보내지 않는다. 모든 요청에 PC의 MAC 주소가 필요하다.
토큰은 거부 응답을 받으면 다시 발급하므로 만료 시각을 따로 두지 않는다(값 그대로 저장해야 로그
마스킹에 잡힌다). 이 게이트웨이는 업무 오류도 HTTP 500으로 보내므로 상태코드보다 `rsp_cd`를
먼저 본다.
"""

import asyncio
import uuid
from typing import Any

from vater_core.api.errors import VaterError
from vater_core.brokers.base import ADAPTERS, BrokerContext, average, number, stock_code
from vater_core.secrets.names import broker_secret
from vater_core.store.holdings import HoldingRow, bad_broker_response

BASE_URL = "https://openapi.imeritz.com:9443"
TOKEN_PATH = "/oauth2/token"  # noqa: S105  (경로이지 비밀값이 아니다)
KR_PATH = "/accounts/v1/me/holdings"
US_PATH = "/accounts/v1/me/overseas/holdings"
ASSET_PATH = "/accounts/v1/me/valuation/by-asset"  # 두 목록이 다 빌 때 합계로 확인한다
_ALLOWED = frozenset(
    {("POST", TOKEN_PATH), ("GET", KR_PATH), ("GET", US_PATH), ("GET", ASSET_PATH)}
)
MAX_PAGES = 20  # 다 못 받으면 저장하지 않는다. 일부만 저장하면 나머지를 판 것으로 알게 된다
PAGE_DELAY_SEC = 0.15  # 초당 10건 제한
_DONE = "5766"
_NO_DATA = "5820"  # 자료를 담고도 올 때가 있어 data로 판단한다
_MORE = "5762"
_ASSET_CLASSES = ("01", "02")  # 국내주식, 해외주식
_DOMESTIC_ROW = "1"
_TOKEN_DEAD = {"EGW00121", "EGW00123"}
_RATE_LIMITED = "EGW00200"
_NO_MAC = "IGW50024"
_BAD_KEY = "EGW00103"  # 앱키 오타나 다른 환경의 앱키. 재발급으로 풀리지 않는다
_SERVER_ERROR = "EGW00002"  # 자격 증명 문제가 아니다
_OVERSEAS_ROW = "J"  # pros_trgt_cls_code. 국내 목록에 해외 행이 섞여 온다


def _mac_error() -> VaterError:
    return VaterError(
        "BROKER_MAC_UNAVAILABLE",
        "이 PC의 MAC 주소를 읽지 못했습니다.",
        "메리츠 API는 모든 요청에 MAC 주소를 요구합니다. 네트워크 장치를 확인해 주세요.",
        status=422,
    )


def mac_address() -> str:
    node = uuid.getnode()
    if not node or node >> 40 & 1:  # 장치를 못 읽으면 멀티캐스트 비트가 켜진 임의 값이 온다
        raise _mac_error()
    return f"{node:012X}"


def _auth_error(detail: str = "") -> VaterError:
    return VaterError(
        "BROKER_AUTH_INVALID",
        f"메리츠 인증에 실패했습니다. {detail}".strip(),
        "앱키와 시크릿을 확인해 주세요. 키는 계좌마다 따로 발급됩니다.",
        status=401,
    )


def _json(response: Any) -> dict[str, Any] | None:
    try:
        body = response.json()
    except ValueError:
        return None
    return body if isinstance(body, dict) else None


def _detail(body: dict[str, Any]) -> str:
    parts = (str(body.get(k) or "").strip() for k in ("rsp_msg", "rsp_sub_msg"))
    return " ".join(p for p in parts if p)


def _check_error(status: int, body: dict[str, Any] | None) -> None:
    """성공 코드가 아니면 알맞은 오류를 낸다."""
    code = str(body.get("rsp_cd") or "") if body else ""
    if body and body.get("error"):  # 토큰 발급의 OAuth 오류 형식
        raise _auth_error(str(body.get("error_description") or body["error"]))
    if code == _RATE_LIMITED or status == 429:
        raise VaterError(
            "BROKER_RATE_LIMITED",
            "메리츠 호출 한도를 넘었습니다.",
            "잠시 후 다시 시도해 주세요.",
            status=429,
        )
    if code == _NO_MAC:
        raise _mac_error()
    if code == _SERVER_ERROR or (status >= 500 and not code):
        raise VaterError(
            "BROKER_UNREACHABLE",
            "증권사 서버에 연결할 수 없습니다.",
            "잠시 후 다시 시도해 주세요.",
            status=503,
        )
    if body is None:
        raise bad_broker_response()
    if status == 401 or code == _BAD_KEY or code in _TOKEN_DEAD:
        raise _auth_error(_detail(body))
    if code:
        raise VaterError("BROKER_API_ERROR", f"메리츠: {_detail(body) or code}", status=502)
    raise bad_broker_response()


def _kr_code(raw: Any) -> str:
    """접두어 1자리 + 코드 6자리."""
    code = stock_code(raw)
    return code[1:] if len(code) == 7 and code[0] in "AJQ" else code


class MeritzAdapter:
    def __init__(self, ctx: BrokerContext) -> None:
        self._creds = ctx.creds
        self._secrets = ctx.secrets
        self._broker = ctx.make_http(BASE_URL, _ALLOWED)
        self._token_name = broker_secret(ctx.creds.conn_id, "TOKEN")
        self._mac = mac_address()

    async def _issue_token(self) -> str:
        r = await self._broker.request(
            "POST",
            TOKEN_PATH,
            data={
                "grant_type": "client_credentials",
                "client_id": self._creds.app_key,
                "client_secret": self._creds.app_secret,
                "scope": "login",
            },
        )
        body = _json(r)
        token = body.get("access_token") if body and r.status_code == 200 else None
        if not token:
            _check_error(r.status_code, body)
        self._secrets.set(self._token_name, str(token))
        return str(token)

    async def _page(self, path: str, params: dict[str, str]) -> dict[str, Any]:
        """성공한 응답 본문. 토큰이 거부되면 한 번만 다시 받는다."""
        reissued = False
        while True:
            token = self._secrets.get(self._token_name) or await self._issue_token()
            r = await self._broker.request(
                "GET",
                path,
                params=params,
                headers={"authorization": f"Bearer {token}", "mac_address": self._mac},
            )
            body = _json(r)
            code = body.get("rsp_cd") if body else None
            if r.status_code == 401 or code in _TOKEN_DEAD:
                if reissued:
                    raise _auth_error()
                self._secrets.delete(self._token_name)
                reissued = True
                continue
            if body is not None and r.status_code == 200 and code in {_DONE, _NO_DATA, _MORE}:
                return body
            _check_error(r.status_code, body)
            raise bad_broker_response()

    async def _rows(self, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        query = dict(params)
        for _ in range(MAX_PAGES):
            body = await self._page(path, query)
            page = body.get("data")
            if not isinstance(page, list) or any(r in rows for r in page):
                raise bad_broker_response()
            if not page and body.get("rsp_sub_msg"):  # 비어 있는 이유가 따로 적혀 있다
                raise bad_broker_response()
            rows += page
            more_code, more_flag = body["rsp_cd"] == _MORE, body.get("tr_cont") == "1"
            if more_code and body.get("tr_cont") == "0":
                raise bad_broker_response()
            if not more_code and not more_flag:
                return rows
            key = body.get("tr_cont_key")
            if not key or key == query.get("tr_cont_key"):
                raise bad_broker_response()
            query = {**params, "tr_cont": "1", "tr_cont_key": str(key)}
            await asyncio.sleep(PAGE_DELAY_SEC)
        raise bad_broker_response()

    async def test(self) -> None:
        """국내·해외를 모두 불러 본다. 한쪽만 안 되는 키를 저장한 뒤 매번 실패하지 않게."""
        await self.holdings()

    async def _require_no_stock_value(self) -> None:
        """두 목록이 다 비면 자산군 합계로 확인한다. 저장된 내역을 지우는 일이라 그렇다."""
        for asset in _ASSET_CLASSES:
            body = await self._page(ASSET_PATH, {"aset_cls_code": asset})
            data = body.get("data")
            if not isinstance(data, dict) or number(data.get("vltn_amt")) != 0:
                raise bad_broker_response()

    async def holdings(self) -> list[HoldingRow]:
        mixed = await self._rows(KR_PATH, {"nthn_rmnd_incu_yn": "N"})
        overseas = await self._rows(US_PATH, {})
        if not mixed and not overseas:
            await self._require_no_stock_value()
            return []
        # 국내 목록에 해외 행이 함께 온다. 두 조회가 어긋나면 어느 쪽을 믿을지 알 수 없다
        listed = {
            stock_code(r.get("iscd"))
            for r in mixed
            if r.get("pros_trgt_cls_code") == _OVERSEAS_ROW
            and number(r.get("rmnd_qty")) + number(r.get("hldn_issu_rmnd_qty") or 0) != 0
        }
        if listed != {
            stock_code(r.get("iscd")) for r in overseas if number(r.get("rmnd_dqty")) != 0
        }:
            raise bad_broker_response()
        rows: list[HoldingRow] = []
        for r in mixed:
            kind = r.get("pros_trgt_cls_code")
            if kind == _OVERSEAS_ROW:
                continue
            domestic = kind == _DOMESTIC_ROW
            code = _kr_code(r.get("iscd")) if domestic else stock_code(r.get("iscd"))
            rows.append(
                HoldingRow(
                    "KR" if domestic else None,
                    code,
                    str(r.get("isnm") or code),
                    number(r.get("rmnd_qty")),
                    average(r.get("byng_unpr")),
                    "KRW" if domestic else "",
                )
            )
        for r in overseas:
            currency = stock_code(r.get("crcd"))
            symbol = stock_code(
                r.get("ovrs_stck_symb_iscd") or stock_code(r.get("iscd")).split(".")[0]
            )
            rows.append(
                HoldingRow(
                    "US" if currency == "USD" else None,
                    symbol,
                    str(r.get("isnm") or symbol),
                    number(r.get("rmnd_dqty")),
                    average(r.get("avrg_unpr")),
                    currency,
                )
            )
        return rows


ADAPTERS["meritz"] = MeritzAdapter
