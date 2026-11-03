import { useState } from 'react';
import { toApiError, type ApiError } from '../../api/errors';
import { useApi } from '../../api/services';
import { useResource } from '../../api/useResource';

export type Settings = Record<string, unknown>;

/** 설정(GET/PATCH /settings). save는 바뀐 것만 보내고, 받은 전체 설정으로 바꾼다. 검증 오류는 422 message. */
export function useSettings() {
  const api = useApi();
  const resource = useResource<Settings>('/settings');
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  /** 저장하고 오류를 돌려준다(성공이면 null). 오류는 부른 쪽이 그 자리에 보인다. */
  async function saveOrError(changes: Settings): Promise<ApiError | null> {
    setSaving(true);
    try {
      const next = await api.request<Settings>('/settings', { method: 'PATCH', body: changes });
      resource.mutate(() => next);
      return null;
    } catch (e) {
      return toApiError(e);
    } finally {
      setSaving(false);
    }
  }

  /** 바로 저장하는 칸(선택·체크)용: 오류는 error로 화면 위에 보인다. */
  async function save(changes: Settings): Promise<boolean> {
    setError(null);
    const failed = await saveOrError(changes);
    setError(failed);
    return failed === null;
  }

  return {
    data: resource.data,
    loadError: resource.error,
    reload: resource.reload,
    save,
    saveOrError,
    saving,
    error,
  };
}

export const str = (settings: Settings | undefined, key: string, fallback = '') => {
  const v = settings?.[key];
  return typeof v === 'string' ? v : fallback;
};
