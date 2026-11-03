import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { FakeEventSource } from '../test/FakeEventSource';
import { fakePlatform } from '../test/fakePlatform';
import { server } from '../test/server';
import { createServices, ServicesProvider, startServices } from './services';
import { useResource } from './useResource';

function wrapper() {
  const shell = fakePlatform();
  const services = createServices(shell.platform, {
    createSource: (url) => new FakeEventSource(url),
    retryDelaysMs: [10],
  });
  startServices(services);
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <ServicesProvider services={services}>{children}</ServicesProvider>
  );
  return { Wrapper, services };
}

function countRequests(path: string) {
  const counter = { n: 0 };
  server.events.on('request:start', ({ request }) => {
    if (new URL(request.url).pathname === path) counter.n += 1;
  });
  return counter;
}

describe('useResource', () => {
  it('경로를 GET으로 불러와 data에 담는다', async () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useResource<{ status: string }>('/health'), {
      wrapper: Wrapper,
    });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ status: 'ok', version: '0.1.0' });
    expect(result.current.error).toBeNull();
  });

  it('오류 응답의 message와 hint를 error로 준다', async () => {
    server.use(
      http.get('*/alerts/kinds', () =>
        HttpResponse.json(
          { code: 'DB_UNAVAILABLE', message: '저장소가 준비되지 않았습니다.', hint: '다시 시작' },
          { status: 503 },
        ),
      ),
    );
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useResource('/alerts/kinds'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toMatchObject({
      code: 'DB_UNAVAILABLE',
      message: '저장소가 준비되지 않았습니다.',
      hint: '다시 시작',
    });
    expect(result.current.data).toBeUndefined();
  });

  it('key가 null이면 부르지 않는다', async () => {
    const counter = countRequests('/health');
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useResource(null), { wrapper: Wrapper });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(counter.n).toBe(0);
    expect(result.current.loading).toBe(false);
  });

  it('직접 만든 불러오기 함수를 쓸 수 있다', async () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(
      () =>
        useResource('briefing:KR', async (api) => {
          const list = await api.request<{ id: number }[]>('/briefings', {
            query: { market: 'KR', limit: 1 },
          });
          return list[0]?.id ?? null;
        }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.data).toBe(21));
  });

  it('reload로 다시 불러온다', async () => {
    const counter = countRequests('/health');
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useResource('/health'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.reload());
    await waitFor(() => expect(counter.n).toBe(2));
  });

  it('key가 바뀌면 새로 불러오고, 늦게 온 옛 응답은 버린다', async () => {
    server.use(
      http.get('*/briefings/:bid', async ({ params }) => {
        if (params.bid === '21') await delay(80);
        return HttpResponse.json({ id: Number(params.bid) });
      }),
    );
    const { Wrapper } = wrapper();
    const { result, rerender } = renderHook(
      ({ id }: { id: number }) => useResource<{ id: number }>(`/briefings/${id}`),
      { wrapper: Wrapper, initialProps: { id: 21 } },
    );
    rerender({ id: 20 });
    await waitFor(() => expect(result.current.data).toEqual({ id: 20 }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
    expect(result.current.data).toEqual({ id: 20 });
  });

  it('SSE가 끊겼다가 다시 연결되면 다시 불러온다', async () => {
    const counter = countRequests('/watchlist/quotes');
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useResource('/watchlist/quotes'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(FakeEventSource.all).toHaveLength(1));
    act(() => FakeEventSource.latest.open());
    expect(counter.n).toBe(1);
    act(() => FakeEventSource.latest.fail());
    await waitFor(() => expect(FakeEventSource.all).toHaveLength(2));
    act(() => FakeEventSource.latest.open());
    await waitFor(() => expect(counter.n).toBe(2));
  });

  it('사이드카가 다시 시작되어 SSE를 새로 열어도(끊김 없이) 다시 불러온다', async () => {
    const counter = countRequests('/watchlist/quotes');
    const { Wrapper, services } = wrapper();
    const { result } = renderHook(() => useResource('/watchlist/quotes'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(FakeEventSource.all).toHaveLength(1));
    act(() => FakeEventSource.latest.open());
    act(() => services.events.reconnect());
    await waitFor(() => expect(FakeEventSource.all).toHaveLength(2));
    act(() => FakeEventSource.latest.open());
    await waitFor(() => expect(counter.n).toBe(2));
  });

  it('처음 연결이 열릴 때는 다시 부르지 않는다', async () => {
    const counter = countRequests('/watchlist/quotes');
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useResource('/watchlist/quotes'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(FakeEventSource.all).toHaveLength(1));
    act(() => FakeEventSource.latest.open());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(counter.n).toBe(1);
  });

  it('refreshOn에 적은 SSE 이벤트가 오면 다시 불러온다', async () => {
    const counter = countRequests('/alerts/events');
    const { Wrapper } = wrapper();
    const { result } = renderHook(
      () => useResource('/alerts/events', undefined, { refreshOn: ['alert.fired'] }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(FakeEventSource.all).toHaveLength(1));
    act(() => {
      FakeEventSource.latest.open();
      FakeEventSource.latest.emit('quote', {
        market: 'KR',
        code: '005930',
        price: 1,
        change: 0,
        change_pct: 0,
        at: null,
        source: 'realtime',
      });
    });
    expect(counter.n).toBe(1);
    act(() =>
      FakeEventSource.latest.emit('alert.fired', {
        id: 99,
        rule_id: 1,
        fired_at: '2026-11-03T15:00:00+09:00',
        value: 1,
        message: 'x',
        market: 'KR',
        code: '005930',
        name: '삼성전자',
        kind: 'price_above',
      }),
    );
    await waitFor(() => expect(counter.n).toBe(2));
  });

  it('mutate로 받은 자료를 고친다(SSE 시세 반영)', async () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useResource<number[]>('/n', async () => [1, 2]), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.data).toEqual([1, 2]));
    act(() => result.current.mutate((prev) => [...(prev ?? []), 3]));
    expect(result.current.data).toEqual([1, 2, 3]);
  });
});
