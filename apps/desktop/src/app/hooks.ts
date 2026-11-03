/** 앱 틀(상태 표시줄, 사이드바, 배너)이 함께 쓰는 사이드카 상태. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { SidecarState } from '../platform';
import { useEvent, useServices } from '../api/services';
import { useResource } from '../api/useResource';
import {
  EVENT_TYPES,
  type AnalysisItem,
  type AnalysisStatus,
  type MonitorStatus,
} from '../api/types';

/** 감시 상태: 처음엔 GET /alerts/status, 그 뒤로는 SSE `alerts.state`. */
export function useMonitor() {
  const resource = useResource<MonitorStatus>('/alerts/status');
  const { mutate } = resource;
  useEvent('alerts.state', (status) => mutate(() => status));
  return resource;
}

/** 셸이 알려 준 사이드카 상태(아직 모르면 null). */
export function useSidecarState(): SidecarState | null {
  const { connection } = useServices();
  return useSyncExternalStore(
    (notify) => connection.onChange(notify),
    () => connection.snapshot?.state ?? null,
  );
}

const ACTIVE: readonly string[] = ['queued', 'running'];

/** 진행 중(running)·대기(queued) 분석 수. 처음엔 최근 목록, 그 뒤로는 SSE `analysis.status`. */
export function useActiveAnalyses(): { running: number; queued: number } {
  const { data, mutate } = useResource<Record<number, string>>('analyses:active', async (api) => {
    const items = await api.request<AnalysisItem[]>('/analyses', { query: { limit: 20 } });
    return Object.fromEntries(
      items.filter((a) => ACTIVE.includes(a.status)).map((a) => [a.id, a.status]),
    );
  });
  useEvent('analysis.status', (event) =>
    mutate((prev) => ({ ...(prev ?? {}), [event.id]: event.status satisfies AnalysisStatus })),
  );
  const statuses = Object.values(data ?? {});
  return {
    running: statuses.filter((s) => s === 'running').length,
    queued: statuses.filter((s) => s === 'queued').length,
  };
}

/** 마지막으로 SSE 이벤트를 받은 시각. 시세가 초마다 와도 1초에 한 번만 다시 그린다. */
export function useLastEventAt(): Date | null {
  const { events } = useServices();
  const [at, setAt] = useState<Date | null>(events.lastEventAt);
  useEffect(() => {
    let last = 0;
    const offs = EVENT_TYPES.map((type) =>
      events.subscribe(type, () => {
        const now = Date.now();
        if (now - last < 1000) return;
        last = now;
        setAt(new Date(now));
      }),
    );
    return () => {
      for (const off of offs) off();
    };
  }, [events]);
  return at;
}
