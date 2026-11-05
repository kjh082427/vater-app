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


@respx.mock
async def test_redirects_are_never_followed_even_if_asked() -> None:
    respx.get(f"{BASE}/holdings").mock(
        return_value=httpx.Response(302, headers={"location": f"{BASE}/orders"})
    )
    orders = respx.get(f"{BASE}/orders").mock(return_value=httpx.Response(200))
    async with httpx.AsyncClient(follow_redirects=True) as http:
        ro = ReadOnlyHttp(http, BASE, ALLOWED)
        r = await ro.request("GET", "/holdings", follow_redirects=True)
    assert r.status_code == 302 and not orders.called


@respx.mock
async def test_any_request_error_becomes_broker_unreachable() -> None:
    respx.get(f"{BASE}/holdings").mock(side_effect=httpx.DecodingError("bad gzip"))
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await ReadOnlyHttp(http, BASE, ALLOWED).request("GET", "/holdings")
    assert e.value.code == "BROKER_UNREACHABLE"


_NETWORK_MODULES = ("httpx", "urllib", "requests", "aiohttp", "http", "socket", "importlib")


def bypasses(source: str, filename: str = "adapter.py") -> list[str]:
    """허용 목록을 건너뛸 수 있는 코드를 찾는다."""
    found = []
    for node in ast.walk(ast.parse(source)):
        modules: list[str] = []
        if isinstance(node, ast.Import):
            modules = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            modules = [node.module or ""]
        found += [m for m in modules if m.split(".")[0] in _NETWORK_MODULES]
        # 한투만 기존 KisClient(GET만 있고 호출 한도를 공유한다)를 쓴다
        if isinstance(node, ast.ImportFrom) and filename != "kis.py":
            found += [a.name for a in node.names if a.name == "KisClient"]
        if isinstance(node, ast.Attribute) and node.attr == "_http":
            found.append("._http")
        if isinstance(node, ast.Name) and node.id == "__import__":
            found.append("__import__")
    return found


@pytest.mark.parametrize(
    "source",
    [
        "import httpx",
        "from httpx import AsyncClient",
        "import urllib.request",
        "import importlib",
        "x = __import__('httpx')",
        "async def f(ro): await ro._http.post('/orders')",
        "from vater_core.kis.client import KisClient",
    ],
)
def test_bypass_scan_catches(source: str) -> None:
    assert bypasses(source)


def test_only_readonly_module_touches_the_network() -> None:
    """어댑터가 허용 목록을 건너뛰지 못하게, 네트워크는 readonly.py에서만 호출한다."""
    offenders = {
        str(path.relative_to(BROKERS)): hits
        for path in BROKERS.rglob("*.py")
        if path.name != "readonly.py"
        and (hits := bypasses(path.read_text(encoding="utf-8"), path.name))
    }
    assert offenders == {}
