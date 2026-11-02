"""`GET /events`: SSE 스트림. 브라우저 EventSource 때문에 이 라우트만 `?token=`을 받는다."""

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends
from sse_starlette.sse import EventSourceResponse

from vater_core.api.auth import require_token_or_query
from vater_core.api.deps import AppDeps, get_deps
from vater_core.api.errors import VaterError

router = APIRouter(tags=["events"], dependencies=[Depends(require_token_or_query)])
PING_SECONDS = 15


@router.get("/events")
async def events(deps: AppDeps = Depends(get_deps)) -> EventSourceResponse:  # noqa: B008
    if deps.events is None:
        raise VaterError("EVENTS_UNAVAILABLE", "이벤트 스트림이 준비되지 않았습니다.", status=503)
    # 응답 헤더를 보내기 전에 구독해야, 직후에 발행된 이벤트도 놓치지 않는다.
    sub = deps.events.subscribe()

    async def stream() -> AsyncIterator[dict[str, str]]:
        try:
            async for ev in sub:
                yield {
                    "event": ev.type,
                    "data": json.dumps(ev.data, ensure_ascii=False),
                    "id": str(ev.id),
                }
        finally:
            sub.close()

    return EventSourceResponse(stream(), ping=PING_SECONDS)
