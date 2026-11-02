"""모든 오류 응답을 `{code, message, hint}` 형식으로 통일한다 (스펙 8장)."""

import logging
from typing import cast

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)

_HTTP_CODES = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}
_HTTP_MESSAGES = {404: "요청한 경로가 없습니다.", 405: "허용되지 않은 요청 방식입니다."}


class VaterError(Exception):
    """사이드카가 의도적으로 내는 오류. UI는 `code`로 안내 문구와 버튼을 정한다."""

    def __init__(self, code: str, message: str, hint: str | None = None, status: int = 400) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.hint = hint
        self.status = status


def error_body(code: str, message: str, hint: str | None = None) -> dict[str, str | None]:
    return {"code": code, "message": message, "hint": hint}


async def _vater_error(_: Request, exc: Exception) -> JSONResponse:
    err = cast(VaterError, exc)
    return JSONResponse(error_body(err.code, err.message, err.hint), status_code=err.status)


async def _validation_error(_: Request, exc: Exception) -> JSONResponse:
    errors = cast(RequestValidationError, exc).errors()
    # 입력값(input)은 절대 응답에 넣지 않는다: 비밀키가 그대로 되돌아올 수 있다.
    fields = sorted({".".join(str(p) for p in e.get("loc", ())) for e in errors})
    hint = f"확인할 항목: {', '.join(fields)}" if fields else None
    return JSONResponse(error_body("REQUEST_INVALID", "요청 형식이 올바르지 않습니다.", hint), 422)


async def _http_error(_: Request, exc: Exception) -> JSONResponse:
    status = cast(StarletteHTTPException, exc).status_code
    code = _HTTP_CODES.get(status, f"HTTP_{status}")
    message = _HTTP_MESSAGES.get(status, "요청을 처리할 수 없습니다.")
    return JSONResponse(error_body(code, message), status_code=status)


async def _unexpected_error(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("unexpected error", exc_info=exc)
    body = error_body(
        "INTERNAL", "예상하지 못한 오류가 발생했습니다.", "로그 폴더를 확인해 주세요."
    )
    return JSONResponse(body, status_code=500)


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(VaterError, _vater_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(StarletteHTTPException, _http_error)
    app.add_exception_handler(Exception, _unexpected_error)
