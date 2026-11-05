"""어댑터가 허용된 조회만 부를 수 있는지 (v2 설계 8장)."""

import ast
from pathlib import Path

import httpx
import pytest
import respx

from vater_core.api.errors import VaterError
from vater_core.brokers.readonly import ReadOnlyHttp

BROKERS = Path(__file__).parents[2] / "src/vater_core/brokers"
BASE = "https://broker.example"
ALLOWED = frozenset({("POST", "/oauth2/token"), ("GET", "/holdings")})


@respx.mock
async def test_allowed_call_goes_through() -> None:
    route = respx.get(f"{BASE}/holdings").mock(return_value=httpx.Response(200, json={"a": 1}))
    async with httpx.AsyncClient() as http:
        r = await ReadOnlyHttp(http, BASE, ALLOWED).request("GET", "/holdings", params={"p": "1"})
    assert r.json() == {"a": 1} and route.called


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/orders"),
        ("GET", "/orders"),
        ("POST", "/holdings"),  # 경로가 같아도 메서드가 다르면 막는다
        ("GET", "/holdings/../orders"),
        ("GET", "https://evil.example/holdings"),
    ],
)
@respx.mock
async def test_anything_else_is_blocked_before_any_request(method: str, path: str) -> None:
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await ReadOnlyHttp(http, BASE, ALLOWED).request(method, path)
    assert e.value.code == "BROKER_CALL_BLOCKED"
    assert respx.calls.call_count == 0


@respx.mock
async def test_connection_failure_becomes_broker_unreachable() -> None:
    respx.get(f"{BASE}/holdings").mock(side_effect=httpx.ConnectError("down"))
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await ReadOnlyHttp(http, BASE, ALLOWED).request("GET", "/holdings")
    assert e.value.code == "BROKER_UNREACHABLE"


def test_only_readonly_module_touches_httpx() -> None:
    """어댑터가 허용 목록을 건너뛰지 못하게, httpx는 readonly.py에서만 호출한다."""
    offenders = []
    for path in BROKERS.glob("*.py"):
        if path.name == "readonly.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import) and any(a.name.startswith("httpx") for a in node.names):
                offenders.append(path.name)
            if isinstance(node, ast.ImportFrom) and (node.module or "").startswith("httpx"):
                offenders.append(path.name)
    assert offenders == []
