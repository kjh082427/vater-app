import httpx


async def test_get_settings_api(client: httpx.AsyncClient) -> None:
    r = await client.get("/settings")
    assert r.status_code == 200 and r.json()["briefing.us.time"] == "07:00"


async def test_patch_settings_api(client: httpx.AsyncClient) -> None:
    r = await client.patch("/settings", json={"analysis.debate_rounds": 2})
    assert r.status_code == 200 and r.json()["analysis.debate_rounds"] == 2
    r = await client.patch("/settings", json={"nope": 1})
    assert r.status_code == 400 and r.json()["code"] == "SETTING_UNKNOWN"


async def test_patch_settings_invalid_is_422(client: httpx.AsyncClient) -> None:
    r = await client.patch("/settings", json={"kis.server": "live"})
    assert r.status_code == 422 and r.json()["code"] == "SETTING_INVALID"
