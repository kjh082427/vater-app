"""LLM 관리 API (스펙 2-3).

하드웨어, 카탈로그, Ollama 상태·시작·설치, 모델 받기·삭제, 준비 확인, 키 테스트.
모델 받기와 설치는 오래 걸려서 202로 바로 응답하고,
진행은 SSE 이벤트(`llm.pull`, `llm.install`)로 보낸다.
"""

import asyncio
import logging
from dataclasses import asdict
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel

from vater_core.api.deps import AppDeps, get_deps
from vater_core.api.errors import VaterError
from vater_core.api.events import EventBus
from vater_core.llm.catalog import CloudProviderId, LocalModel
from vater_core.llm.cloud import check_cloud_key
from vater_core.llm.install import require_windows
from vater_core.llm.ollama import not_running
from vater_core.llm.presets import Preset, build_run
from vater_core.llm.state import LlmState, get_llm, http_client
from vater_core.secrets.store import SecretStore
from vater_core.store.settings import SettingsRepo

logger = logging.getLogger(__name__)
router = APIRouter(tags=["llm"])


# ---- 응답 모델 -------------------------------------------------------------


class GpuOut(BaseModel):
    name: str
    vram_mb: int


class LocalModelOut(BaseModel):
    tag: str
    label: str
    size_gb: float
    num_ctx: int
    min_vram_mb: int
    note: str
    variant: str


class HardwareOut(BaseModel):
    gpus: list[GpuOut]
    ram_mb: int | None
    tier: str
    tier_label: str
    recommended: LocalModelOut | None
    alternatives: list[LocalModelOut]
    default_preset: str
    expected_minutes: int | None


class TierOut(BaseModel):
    id: str
    label: str
    min_vram_mb: int
    default_preset: str
    recommended: str | None
    alternatives: list[str]
    expected_minutes: int | None


class CloudProviderOut(BaseModel):
    id: str
    label: str
    secret: str
    base_url_secret: str | None
    deep: str | None
    quick: str | None
    free_tier: bool


class CatalogOut(BaseModel):
    version: str
    tiers: list[TierOut]
    local_models: list[LocalModelOut]
    cloud: dict[str, CloudProviderOut]


class InstalledOut(BaseModel):
    name: str
    size: int


class LoadedOut(BaseModel):
    name: str
    size: int
    size_vram: int
    offloaded: bool


class OllamaStatusOut(BaseModel):
    installed: bool
    running: bool
    version: str | None
    models: list[InstalledOut]
    loaded: list[LoadedOut]


class RunningOut(BaseModel):
    running: bool


class StartedOut(BaseModel):
    started: bool


class PullStartedOut(BaseModel):
    started: bool
    variant: str


class TierChoiceOut(BaseModel):
    provider: str
    model: str


class CheckOut(BaseModel):
    ok: bool
    preset: str
    deep: TierChoiceOut
    quick: TierChoiceOut
    offloaded: bool | None  # 로컬 모델이 올라가 있지 않으면 아직 모름(None)


class CloudTestOut(BaseModel):
    provider: str
    ok: bool
    model_count: int
    defaults_available: bool


# ---- 공용 ------------------------------------------------------------------


def _local_out(m: LocalModel) -> LocalModelOut:
    return LocalModelOut(**asdict(m), variant=m.variant)


def _settings(deps: AppDeps) -> SettingsRepo:
    if deps.db is None:
        raise VaterError("DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", status=503)
    return SettingsRepo(deps.db)


def _secrets(deps: AppDeps) -> SecretStore:
    if deps.secrets is None:
        raise VaterError("SECRETS_UNAVAILABLE", "키 저장소가 준비되지 않았습니다.", status=503)
    return deps.secrets


def _events(deps: AppDeps) -> EventBus:
    if deps.events is None:
        raise VaterError("EVENTS_UNAVAILABLE", "이벤트 통로가 준비되지 않았습니다.", status=503)
    return deps.events


# ---- 하드웨어·카탈로그 ---------------------------------------------------------


@router.get("/llm/hardware")
async def llm_hardware(
    refresh: bool = False,
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> HardwareOut:
    llm = get_llm(deps)
    if llm.hardware is None or refresh:
        llm.hardware = await asyncio.to_thread(llm.detect, llm.catalog)
    hw = llm.hardware
    tier = llm.catalog.tier(hw.tier)
    return HardwareOut(
        gpus=[GpuOut(name=g.name, vram_mb=g.vram_mb) for g in hw.gpus],
        ram_mb=hw.ram_mb,
        tier=tier.id,
        tier_label=tier.label,
        recommended=_local_out(llm.catalog.local(tier.recommended)) if tier.recommended else None,
        alternatives=[_local_out(llm.catalog.local(t)) for t in tier.alternatives],
        default_preset=tier.default_preset,
        expected_minutes=tier.expected_minutes,
    )


@router.get("/llm/catalog")
async def llm_catalog(deps: AppDeps = Depends(get_deps)) -> CatalogOut:  # noqa: B008
    cat = get_llm(deps).catalog
    return CatalogOut(
        version=cat.version,
        tiers=[TierOut(**{**asdict(t), "alternatives": list(t.alternatives)}) for t in cat.tiers],
        local_models=[_local_out(m) for m in cat.local_models],
        cloud={
            pid: CloudProviderOut(
                id=p.id,
                label=p.label,
                secret=p.secret.value,
                base_url_secret=p.base_url_secret.value if p.base_url_secret else None,
                deep=p.deep,
                quick=p.quick,
                free_tier=p.free_tier,
            )
            for pid, p in cat.cloud.items()
        },
    )


# ---- Ollama --------------------------------------------------------------------


@router.get("/llm/ollama/status")
async def ollama_status(deps: AppDeps = Depends(get_deps)) -> OllamaStatusOut:  # noqa: B008
    s = await get_llm(deps).ollama.status()
    return OllamaStatusOut(
        installed=s.installed,
        running=s.running,
        version=s.version,
        models=[InstalledOut(name=m.name, size=m.size) for m in s.models],
        loaded=[
            LoadedOut(name=m.name, size=m.size, size_vram=m.size_vram, offloaded=m.offloaded)
            for m in s.loaded
        ],
    )


@router.post("/llm/ollama/start")
async def ollama_start(deps: AppDeps = Depends(get_deps)) -> RunningOut:  # noqa: B008
    return RunningOut(running=await get_llm(deps).ollama.start())


async def _install_job(deps: AppDeps, llm: LlmState) -> None:
    try:
        await llm.install(http_client(deps), llm.ollama, _events(deps), deps.data_dir / "cache")
    except Exception:
        logger.exception("ollama install job failed")
        _events(deps).publish(
            "llm.install",
            {"stage": "error", "code": "INTERNAL", "message": "설치 중 오류가 났습니다."},
        )
    finally:
        llm.installing = False


@router.post("/llm/ollama/install", status_code=202)
async def ollama_install(deps: AppDeps = Depends(get_deps)) -> StartedOut:  # noqa: B008
    llm = get_llm(deps)
    require_windows(llm.platform)
    if llm.installing:
        raise VaterError(
            "OLLAMA_INSTALL_IN_PROGRESS", "Ollama 설치가 이미 진행 중입니다.", status=409
        )
    llm.installing = True  # await 전에 잡아야 동시에 두 번 눌러도 하나만 시작한다
    try:
        running = await llm.ollama.version() is not None
    except BaseException:
        llm.installing = False
        raise
    if running:
        llm.installing = False
        return StartedOut(started=False)  # 이미 설치되어 실행 중
    llm.spawn(_install_job(deps, llm))
    return StartedOut(started=True)


# ---- 모델 받기·삭제 ------------------------------------------------------------


def _percent(completed: int | None, total: int | None) -> int | None:
    if completed is None or not total:
        return None
    return round(completed / total * 100)


async def _pull_job(deps: AppDeps, llm: LlmState, model: LocalModel) -> None:
    events = _events(deps)

    def publish(data: dict[str, Any]) -> None:
        events.publish("llm.pull", {"tag": model.tag, **data})

    last: tuple[str, int | None] | None = None
    try:
        async for p in llm.ollama.pull(model.tag):
            percent = _percent(p.completed, p.total)
            if (p.status, percent) == last:
                continue  # 같은 단계의 같은 진행률은 다시 보내지 않는다
            last = (p.status, percent)
            publish(
                {"status": p.status, "completed": p.completed, "total": p.total, "percent": percent}
            )
        variant = await llm.ollama.create_variant(model)
        repo = _settings(deps)
        if repo.get("llm.local_model") == "":
            repo.update({"llm.local_model": model.tag})  # 첫 설치면 바로 쓰게 한다
        publish({"status": "done", "variant": variant})
    except VaterError as e:
        publish({"status": "error", "code": e.code, "message": e.message, "hint": e.hint})
    except Exception:
        logger.exception("model pull job failed: %s", model.tag)
        publish(
            {"status": "error", "code": "INTERNAL", "message": "모델을 받는 중 오류가 났습니다."}
        )
    finally:
        llm.pulls.discard(model.tag)


@router.post("/llm/models/{tag}/pull", status_code=202)
async def model_pull(tag: str, deps: AppDeps = Depends(get_deps)) -> PullStartedOut:  # noqa: B008
    llm = get_llm(deps)
    model = llm.catalog.local(tag)  # 카탈로그에 없으면 404
    if tag in llm.pulls:
        raise VaterError("LLM_PULL_IN_PROGRESS", f"'{tag}' 모델을 이미 받고 있습니다.", status=409)
    llm.pulls.add(tag)  # await 전에 잡아야 동시에 두 번 눌러도 하나만 시작한다
    try:
        if await llm.ollama.version() is None:
            raise not_running()
    except BaseException:
        llm.pulls.discard(tag)
        raise
    llm.spawn(_pull_job(deps, llm, model))
    return PullStartedOut(started=True, variant=model.variant)


@router.delete("/llm/models/{tag}", status_code=204)
async def model_delete(tag: str, deps: AppDeps = Depends(get_deps)) -> Response:  # noqa: B008
    llm = get_llm(deps)
    model = llm.catalog.local(tag)
    await llm.ollama.delete(model.variant, missing_ok=True)
    await llm.ollama.delete(model.tag, missing_ok=True)
    repo = _settings(deps)
    if repo.get("llm.local_model") == tag:
        repo.update({"llm.local_model": ""})
    return Response(status_code=204)


# ---- 준비 확인·키 테스트 --------------------------------------------------------


@router.get("/llm/check")
async def llm_check(
    preset: Annotated[Preset | None, Query()] = None,
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> CheckOut:
    """분석을 시작하기 전에 키·로컬 모델·Ollama 상태를 확인한다."""
    llm = get_llm(deps)
    run = build_run(_settings(deps).get_all(), llm.catalog, _secrets(deps), preset=preset)
    local = {t.model for t in (run.deep, run.quick) if t.provider == "ollama"}
    offloaded: bool | None = None
    if local:
        for name in sorted(local):
            await llm.ollama.require_model(name)
        hits = [m for m in await llm.ollama.loaded() if m.name in local]
        offloaded = any(m.offloaded for m in hits) if hits else None
    return CheckOut(
        ok=True,
        preset=run.preset,
        deep=TierChoiceOut(provider=run.deep.provider, model=run.deep.model),
        quick=TierChoiceOut(provider=run.quick.provider, model=run.quick.model),
        offloaded=offloaded,
    )


@router.post("/settings/llm/test")
async def cloud_key_test(
    provider: Annotated[Literal["google", "anthropic", "openai", "compat"] | None, Query()] = None,
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> CloudTestOut:
    llm = get_llm(deps)
    pid: CloudProviderId = provider or _settings(deps).get("llm.cloud_provider")
    result = await check_cloud_key(http_client(deps), llm.catalog.cloud[pid], _secrets(deps))
    return CloudTestOut(**asdict(result))
