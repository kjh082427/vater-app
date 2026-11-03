import { render, type RenderOptions } from '@testing-library/react';
import { act, type ReactElement } from 'react';
import { vi } from 'vitest';
import { createServices, ServicesProvider, startServices } from '../api/services';
import type { EventMap, EventType } from '../api/types';
import { FakeEventSource } from './FakeEventSource';
import { fakePlatform } from './fakePlatform';

/**
 * 사이드카 흉내(MSW)와 흉내 셸·EventSource로 화면을 그린다.
 * `shell`로 사이드카 재시작·알림 클릭을, `stream()`으로 SSE를 흉내 낸다.
 */
export function renderWithServices(
  ui: ReactElement,
  options: RenderOptions & { retryDelaysMs?: number[] } = {},
) {
  const { retryDelaysMs = [50], ...renderOptions } = options;
  const shell = fakePlatform();
  const services = createServices(shell.platform, {
    createSource: (url) => new FakeEventSource(url),
    retryDelaysMs,
  });
  const stop = startServices(services);
  const result = render(
    <ServicesProvider services={services}>{ui}</ServicesProvider>,
    renderOptions,
  );
  return {
    ...result,
    services,
    shell,
    stop,
    /** 지금 열려 있는 SSE 연결(없으면 생길 때까지 기다린다). 처음이면 open까지 해 둔다. */
    async stream(): Promise<FakeEventSource> {
      await vi.waitFor(() => {
        const latest = FakeEventSource.all[FakeEventSource.all.length - 1];
        if (!latest || latest.closed) throw new Error('SSE 연결 없음');
      });
      if (services.events.status !== 'open') act(() => FakeEventSource.latest.open());
      return FakeEventSource.latest;
    },
  };
}

/** SSE 이벤트를 act 안에서 보낸다. */
export function emit<K extends EventType>(source: FakeEventSource, type: K, data: EventMap[K]) {
  act(() => source.emit(type, data));
}
