import json

import httpx


async def test_put_secret_is_write_only(client: httpx.AsyncClient) -> None:
    r = await client.put("/secrets/KIS_APP_KEY", json={"value": "s3cr3t-value"})
    assert r.status_code == 204
    status = (await client.get("/secrets")).json()
    assert status["KIS_APP_KEY"] is True and "s3cr3t-value" not in json.dumps(status)
    assert (await client.get("/secrets/KIS_APP_KEY")).status_code in (404, 405)


async def test_put_secret_rejects_bad_name_and_empty(client: httpx.AsyncClient) -> None:
    r = await client.put("/secrets/NOPE", json={"value": "leak-me-123"})
    assert r.status_code == 400 and r.json()["code"] == "SECRET_NAME_INVALID"
    assert "leak-me-123" not in r.text  # 값이 오류 응답에 다시 나오지 않음
    r = await client.put("/secrets/KIS_APP_KEY", json={"value": "   "})
    assert r.status_code == 400 and r.json()["code"] == "SECRET_VALUE_EMPTY"


async def test_validation_error_does_not_echo_secret(client: httpx.AsyncClient) -> None:
    r = await client.put("/secrets/KIS_APP_KEY", json={"value": 12345678, "extra": "leak-me-456"})
    assert r.status_code in (400, 422)
    assert "leak-me-456" not in r.text and "12345678" not in r.text


async def test_internal_secrets_not_writable(client: httpx.AsyncClient) -> None:
    r = await client.put("/secrets/KIS_ACCESS_TOKEN", json={"value": "x"})
    assert r.status_code == 400 and r.json()["code"] == "SECRET_NAME_INVALID"
    assert "KIS_ACCESS_TOKEN" not in (await client.get("/secrets")).json()


async def test_value_is_trimmed_and_deletable(client: httpx.AsyncClient) -> None:
    assert (await client.put("/secrets/LLM_GOOGLE_KEY", json={"value": " k1 "})).status_code == 204
    assert (await client.get("/secrets")).json()["LLM_GOOGLE_KEY"] is True
    assert (await client.delete("/secrets/LLM_GOOGLE_KEY")).status_code == 204
    assert (await client.get("/secrets")).json()["LLM_GOOGLE_KEY"] is False
