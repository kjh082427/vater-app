import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from './client';
import { toApiError, type ApiError } from './errors';
import { useServices } from './services';
import type { EventType } from './types';

export interface Resource<T> {
  /** 받은 자료. 다시 불러오는 동안에는 이전 자료를 그대로 둔다. key가 바뀌면 undefined부터. */
  data: T | undefined;
  /** 마지막 불러오기의 오류(`message`·`hint`를 화면에 그대로). */
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
  /** 받은 자료를 화면에서 고친다(SSE 시세처럼 다시 부르지 않고 반영할 때). */
  mutate: (update: (prev: T | undefined) => T | undefined) => void;
}

export interface ResourceOptions {
  /** 이 SSE 이벤트가 오면 다시 불러온다. 드물게 오는 이벤트만(시세 quote는 mutate로). */
  refreshOn?: EventType[];
}

interface Loaded<T> {
  key: string | null;
  version: number;
  data: T | undefined;
  error: ApiError | null;
}

/**
 * 사이드카 자료 하나를 불러온다. 불러오기 함수가 없으면 key를 경로로 GET 한다. key가 null이면 부르지 않는다.
 * SSE가 다시 열리면(끊김 뒤, 사이드카 재시작 뒤) 놓친 변경이 있을 수 있으므로 다시 불러온다.
 */
export function useResource<T = unknown>(
  key: string | null,
  loader?: (api: ApiClient) => Promise<T>,
  options: ResourceOptions = {},
): Resource<T> {
  const { api, events } = useServices();
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState<Loaded<T>>({
    key: null,
    version: -1,
    data: undefined,
    error: null,
  });
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    if (key === null) return;
    let alive = true;
    const load = loaderRef.current ?? ((client: ApiClient) => client.request<T>(key));
    load(api).then(
      (data) => {
        if (alive) setLoaded({ key, version, data, error: null });
      },
      (e: unknown) => {
        if (!alive) return;
        setLoaded((prev) => ({
          key,
          version,
          data: prev.key === key ? prev.data : undefined,
          error: toApiError(e),
        }));
      },
    );
    return () => {
      alive = false;
    };
  }, [api, key, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  // SSE가 다시 열리면(끊김 뒤, 사이드카 재시작 뒤) 다시 불러온다: 그 사이의 변경을 놓쳤을 수 있다.
  // 앱이 처음 연결될 때(connecting)의 open만 빼고 그 뒤의 open마다 부른다. 끊긴 동안 열린 화면은
  // 처음 불러오기가 실패했을 수 있으므로 다음 open을 다시 연결로 본다.
  useEffect(() => {
    let openedBefore = events.status !== 'connecting';
    return events.onStatus((status) => {
      if (status !== 'open') return;
      if (openedBefore) reload();
      openedBefore = true;
    });
  }, [events, reload]);

  const refreshKey = (options.refreshOn ?? []).join(',');
  useEffect(() => {
    if (!refreshKey) return;
    const offs = refreshKey.split(',').map((type) => events.subscribe(type as EventType, reload));
    return () => {
      for (const off of offs) off();
    };
  }, [events, refreshKey, reload]);

  const mutate = useCallback(
    (update: (prev: T | undefined) => T | undefined) => {
      setLoaded((prev) => (prev.key === key ? { ...prev, data: update(prev.data) } : prev));
    },
    [key],
  );

  const current = loaded.key === key;
  return {
    data: current ? loaded.data : undefined,
    error: current ? loaded.error : null,
    loading: key !== null && (!current || loaded.version !== version),
    reload,
    mutate,
  };
}
