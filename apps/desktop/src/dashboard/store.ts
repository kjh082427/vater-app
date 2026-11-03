/**
 * 대시보드 문서 저장(GET·PUT /ui/dashboards, 대시보드 설계 4장). 읽은 문서는 validateDoc으로
 * 확인하고, 깨졌으면 기본 문서로 연다. 저장은 바로 화면에 반영한 뒤 PUT 하고, 실패하면 되돌린다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toApiError, type ApiError } from '../api/errors';
import { useServices } from '../api/services';
import { useResource } from '../api/useResource';
import { PANEL_MINS } from './layout/mins';
import type { DashboardsDoc } from './layout/types';
import { validateDoc } from './layout/validate';

export { DEFAULT_DOC } from './layout/defaults';

/** 이 버전이 아는 내용 종류. 모르는 종류는 그 칸이 "지원하지 않는 내용"으로 안내한다. */
export const KNOWN_PANELS = new Set<string>(Object.keys(PANEL_MINS));

export interface DashboardStore {
  /** 확인을 거친 문서. 처음 불러오기 전에는 null. */
  doc: DashboardsDoc | null;
  status: 'loading' | 'ready' | 'error';
  /** 불러오기 오류(status가 error일 때). */
  error: ApiError | null;
  /** 저장된 문서가 깨져 기본 배치로 열었다. 다음 저장 때 덮어쓴다. */
  fallback: boolean;
  /** 일부 화면을 버렸거나 비율을 되돌렸다. 다음 저장 때 남은 것만 저장된다. */
  partial: boolean;
  reload: () => void;
  /** 바로 반영하고 PUT. 실패하면 되돌리고 ApiError를 던진다. */
  save: (doc: DashboardsDoc) => Promise<void>;
}

export function useDashboards(): DashboardStore {
  const { api } = useServices();
  const resource = useResource<unknown>('/ui/dashboards');
  const { data, error, reload, mutate } = resource;
  const [pending, setPending] = useState<DashboardsDoc | null>(null);
  const validated = useMemo(
    () => (data === undefined ? null : validateDoc(data, KNOWN_PANELS)),
    [data],
  );
  useEffect(() => {
    // 무엇을 고쳤는지만 남긴다(문서 본문·토큰은 남기지 않는다)
    if (validated && validated.problems.length > 0)
      console.warn('대시보드 문서 확인', validated.problems);
  }, [validated]);

  const save = useCallback(
    async (next: DashboardsDoc) => {
      setPending(next);
      try {
        const saved = await api.request<unknown>('/ui/dashboards', { method: 'PUT', body: next });
        mutate(() => saved);
      } catch (e) {
        throw toApiError(e);
      } finally {
        setPending(null);
      }
    },
    [api, mutate],
  );

  const doc = pending ?? validated?.doc ?? null;
  let status: DashboardStore['status'] = 'loading';
  if (doc) status = 'ready';
  else if (error) status = 'error';
  return {
    doc,
    status,
    error: doc ? null : error,
    fallback: !pending && (validated?.fallback ?? false),
    partial: !pending && (validated?.partial ?? false),
    reload,
    save,
  };
}

/** 새 화면 id: 사이드카 한도 40자 안, 주소(?tab=)에 그대로 쓸 수 있는 글자. */
export function newDashboardId(): string {
  const rand = Math.floor(Math.random() * 36 ** 6).toString(36);
  return `d-${Date.now().toString(36)}${rand}`;
}
