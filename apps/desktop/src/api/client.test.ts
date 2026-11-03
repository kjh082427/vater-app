import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { fakePlatform, TEST_BASE, TEST_TOKEN } from '../test/fakePlatform';
import { server } from '../test/server';
import { ApiError, createClient } from './client';
import { SidecarConnection } from './connection';

function setup(initial?: Parameters<typeof fakePlatform>[0]) {
  const shell = fakePlatform(initial);
  const connection = new SidecarConnection(shell.platform);
  connection.start();
  const api = createClient(connection);
  return { shell, connection, api };
}

/** 오류를 던지는 약속에서 ApiError를 꺼낸다. */
async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('오류가 나지 않았습니다');
}

describe('request', () => {
  it('모든 요청에 Bearer 토큰을 붙이고 사이드카 주소로 보낸다', async () => {
    let seen: { url: string; auth: string | null } | null = null;
    server.use(
      http.get('*/health', ({ request }) => {
        seen = { url: request.url, auth: request.headers.get('authorization') };
        return HttpResponse.json({ status: 'ok', version: '0.1.0' });
      }),
    );
    const { api } = setup();
    await expect(api.request('/health')).resolves.toEqual({ status: 'ok', version: '0.1.0' });
    expect(seen).toEqual({ url: `${TEST_BASE}/health`, auth: `Bearer ${TEST_TOKEN}` });
  });

  it('본문은 JSON으로 보내고, 빈 값이 아닌 쿼리만 붙인다', async () => {
    let seen: { url: string; type: string | null; body: unknown } | null = null;
    server.use(
      http.post('*/alerts/rules', async ({ request }) => {
        seen = {
          url: request.url,
          type: request.headers.get('content-type'),
          body: await request.json(),
        };
        return HttpResponse.json({ id: 1 }, { status: 201 });
      }),
    );
    const { api } = setup();
    await api.request('/alerts/rules', {
      method: 'POST',
      body: { kind: 'rsi', watchlist_id: 1 },
      query: { a: '삼성 전자', b: undefined, c: null, d: 5 },
    });
    expect(seen).toEqual({
      url: `${TEST_BASE}/alerts/rules?a=%EC%82%BC%EC%84%B1+%EC%A0%84%EC%9E%90&d=5`,
      type: 'application/json',
      body: { kind: 'rsi', watchlist_id: 1 },
    });
  });

  it('204는 undefined', async () => {
    const { api } = setup();
    await expect(api.request('/watchlist/1', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('오류 응답 {code, message, hint}를 ApiError로 바꾼다', async () => {
    server.use(
      http.post('*/briefings/run', () =>
        HttpResponse.json(
          { code: 'BRIEFING_BUSY', message: '브리핑을 만드는 중입니다.', hint: '끝난 뒤 다시.' },
          { status: 409 },
        ),
      ),
    );
    const { api } = setup();
    const error = await caught(api.request('/briefings/run', { method: 'POST', body: {} }));
    expect(error).toMatchObject({
      code: 'BRIEFING_BUSY',
      message: '브리핑을 만드는 중입니다.',
      hint: '끝난 뒤 다시.',
      status: 409,
    });
  });

  it('hint가 없으면 null', async () => {
    server.use(
      http.get('*/settings', () =>
        HttpResponse.json({ code: 'X', message: '안 됩니다.' }, { status: 400 }),
      ),
    );
    const { api } = setup();
    expect((await caught(api.request('/settings'))).hint).toBeNull();
  });

  it('형식이 다른 오류 응답도 ApiError(HTTP_상태)로', async () => {
    server.use(http.get('*/settings', () => new HttpResponse('<html>bad</html>', { status: 502 })));
    const { api } = setup();
    const error = await caught(api.request('/settings'));
    expect(error.code).toBe('HTTP_502');
    expect(error.status).toBe(502);
    expect(error.message).not.toBe('');
  });

  it('연결 자체가 안 되면 SIDECAR_UNREACHABLE과 해결 방법', async () => {
    server.use(http.get('*/settings', () => HttpResponse.error()));
    const { api } = setup();
    const error = await caught(api.request('/settings'));
    expect(error.code).toBe('SIDECAR_UNREACHABLE');
    expect(error.status).toBe(0);
    expect(error.hint).toBeTruthy();
  });

  it('사이드카가 아직 시작 중이면 준비될 때까지 기다렸다가 보낸다', async () => {
    const { api, shell } = setup({ state: 'starting' });
    const pending = api.request('/health');
    shell.restart({ state: 'ready', baseUrl: TEST_BASE, token: TEST_TOKEN });
    await expect(pending).resolves.toEqual({ status: 'ok', version: '0.1.0' });
  });

  it('사이드카가 실패 상태면 바로 SIDECAR_UNAVAILABLE', async () => {
    const { api } = setup({ state: 'failed' });
    const error = await caught(api.request('/health'));
    expect(error.code).toBe('SIDECAR_UNAVAILABLE');
    expect(error.hint).toBeTruthy();
  });
});

describe('사이드카 재시작 (포트·토큰이 바뀜)', () => {
  const NEW_BASE = 'http://127.0.0.1:41001';

  it('sidecar-state 뒤의 요청은 새 포트와 새 토큰으로 간다', async () => {
    const seen: string[] = [];
    server.use(
      http.get('*/health', ({ request }) => {
        seen.push(`${new URL(request.url).origin} ${request.headers.get('authorization')}`);
        return HttpResponse.json({ status: 'ok', version: '0.1.0' });
      }),
    );
    const { api, shell, connection } = setup();
    await api.request('/health');
    shell.restart({ state: 'ready', baseUrl: NEW_BASE, token: 'test-token-2' });
    await connection.settled();
    await api.request('/health');
    expect(seen).toEqual([`${TEST_BASE} Bearer ${TEST_TOKEN}`, `${NEW_BASE} Bearer test-token-2`]);
  });

  it('이벤트보다 먼저 옛 포트로 간 GET이 실패하면 정보를 다시 읽고 한 번 더 보낸다', async () => {
    server.use(
      http.get('*/settings', ({ request }) =>
        request.url.startsWith(TEST_BASE)
          ? HttpResponse.error()
          : HttpResponse.json({ 'kis.server': 'vps' }),
      ),
    );
    const { api, shell } = setup();
    // 셸이 이벤트를 아직 보내지 않은 채 정보만 바뀐 상황
    const changed = { state: 'ready' as const, baseUrl: NEW_BASE, token: 'test-token-2' };
    shell.platform.getSidecarInfo = async () => changed;
    await expect(api.request('/settings')).resolves.toEqual({ 'kis.server': 'vps' });
  });

  it('옛 토큰이 401로 거절되면 정보를 다시 읽고 한 번 더 보낸다', async () => {
    server.use(
      http.post('*/alerts/pause', ({ request }) =>
        request.headers.get('authorization') === 'Bearer test-token-2'
          ? HttpResponse.json({ state: 'paused' })
          : HttpResponse.json({ code: 'AUTH_INVALID', message: '인증 실패' }, { status: 401 }),
      ),
    );
    const { api, shell } = setup();
    const changed = { state: 'ready' as const, baseUrl: TEST_BASE, token: 'test-token-2' };
    shell.platform.getSidecarInfo = async () => changed;
    await expect(api.request('/alerts/pause', { method: 'POST' })).resolves.toEqual({
      state: 'paused',
    });
  });

  it('GET이 아닌 요청은 연결 실패 때 다시 보내지 않는다(두 번 실행될 수 있어서)', async () => {
    let calls = 0;
    server.use(
      http.post('*/analyses', () => {
        calls += 1;
        return HttpResponse.error();
      }),
    );
    const { api, shell } = setup();
    const changed = { state: 'ready' as const, baseUrl: NEW_BASE, token: 'test-token-2' };
    shell.platform.getSidecarInfo = async () => changed;
    const error = await caught(api.request('/analyses', { method: 'POST', body: {} }));
    expect(error.code).toBe('SIDECAR_UNREACHABLE');
    expect(calls).toBe(1);
  });

  it('정보가 그대로면 다시 보내지 않고 오류를 돌려준다', async () => {
    let calls = 0;
    server.use(
      http.get('*/settings', () => {
        calls += 1;
        return HttpResponse.error();
      }),
    );
    const { api } = setup();
    await caught(api.request('/settings'));
    expect(calls).toBe(1);
  });
});
