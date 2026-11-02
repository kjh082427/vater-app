"""OpenAPI 명세가 실제 응답 형식과 같아야 UI의 생성 타입이 맞다 (리뷰 Important #4)."""

from typing import Any

from vater_core.api.app import create_app
from vater_core.api.deps import AppDeps
from vater_core.secrets.names import USER_SETTABLE

ERROR_REF = "#/components/schemas/ErrorBody"


def spec(deps: AppDeps) -> dict[str, Any]:
    return create_app(deps).openapi()


def ref_of(response: dict[str, Any]) -> str | None:
    schema = response.get("content", {}).get("application/json", {}).get("schema", {})
    ref: str | None = schema.get("$ref")
    return ref


def test_error_body_schema_exists(deps: AppDeps) -> None:
    schema = spec(deps)["components"]["schemas"]["ErrorBody"]
    assert set(schema["properties"]) == {"code", "message", "hint"}


def test_default_validation_schema_is_gone(deps: AppDeps) -> None:
    assert "HTTPValidationError" not in spec(deps)["components"]["schemas"]


def test_every_error_response_uses_error_body(deps: AppDeps) -> None:
    for path, methods in spec(deps)["paths"].items():
        for method, op in methods.items():
            assert ref_of(op["responses"]["401"]) == ERROR_REF, (path, method)
            for status in ("422", "500"):
                if status in op["responses"]:
                    assert ref_of(op["responses"][status]) == ERROR_REF, (path, method, status)


def test_secret_name_lists_settable_names(deps: AppDeps) -> None:
    params = spec(deps)["paths"]["/secrets/{name}"]["put"]["parameters"]
    name = next(p for p in params if p["name"] == "name")
    assert name["schema"]["enum"] == [n.value for n in USER_SETTABLE]
