/**
 * 사이드카 REST 클라이언트. 모든 요청에 `Authorization: Bearer <token>`을 붙이고(스펙 2-1),
 * 오류 응답 `{code, message, hint}`는 ApiError로 바꾼다(스펙 8장).
 *
 * 사이드카가 다시 시작되어 포트·토큰이 바뀐 직후에는 옛 주소로 간 요청이 실패할 수 있다.
 * 그때는 정보를 다시 읽어 바뀌었으면 한 번 더 보낸다. 단, 연결 실패의 재전송은 GET만 한다
 * (POST가 이미 처리된 뒤 끊겼을 수 있어서). 401(옛 토큰)은 처리되지 않은 요청이라 모두 다시 보낸다.
 */
import type { Endpoint, SidecarConnection } from './connection';
import { ApiError } from './errors';

export { ApiError, isApiError, toApiError } from './errors';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: Method;
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
}

export interface ApiClient {
  request<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const unreachable = () =>
  new ApiError(
    'SIDECAR_UNREACHABLE',
    'Vater 백그라운드 서비스에 연결할 수 없습니다.',
    '잠시 뒤 다시 시도하세요. 계속되면 앱을 다시 시작하세요.',
    0,
  );

function urlOf(endpoint: Endpoint, path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) params.append(key, String(value));
  }
  const qs = params.toString();
  return `${endpoint.baseUrl}${path}${qs ? `?${qs}` : ''}`;
}

async function errorFrom(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { code?: unknown; message?: unknown; hint?: unknown };
    if (typeof body.code === 'string' && typeof body.message === 'string') {
      const hint = typeof body.hint === 'string' ? body.hint : null;
      return new ApiError(body.code, body.message, hint, res.status);
    }
  } catch {
    // JSON이 아니면 아래 일반 오류
  }
  return new ApiError(`HTTP_${res.status}`, '요청을 처리할 수 없습니다.', null, res.status);
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

function changed(used: Endpoint, info: { baseUrl?: string; token?: string; state: string }) {
  return info.state === 'ready' && (info.baseUrl !== used.baseUrl || info.token !== used.token);
}

export function createClient(
  connection: SidecarConnection,
  // 호출할 때 전역 fetch를 찾는다(테스트의 MSW가 바꿔 끼운 것을 쓰게).
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): ApiClient {
  async function send<T>(path: string, options: RequestOptions, retried: boolean): Promise<T> {
    const method = options.method ?? 'GET';
    const endpoint = await connection.current();
    const headers: Record<string, string> = { Authorization: `Bearer ${endpoint.token}` };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await fetchImpl(urlOf(endpoint, path, options.query), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (e) {
      if (isAbort(e)) throw e;
      if (!retried && method === 'GET' && changed(endpoint, await connection.refresh())) {
        return send<T>(path, options, true);
      }
      throw unreachable();
    }

    if (res.status === 401 && !retried && changed(endpoint, await connection.refresh())) {
      return send<T>(path, options, true);
    }
    if (!res.ok) throw await errorFrom(res);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    request: (path, options = {}) => send(path, options, false),
  };
}
