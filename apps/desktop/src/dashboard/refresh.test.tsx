import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithServices } from '../test/render';
import { mock, server } from '../test/server';
import { WatchlistPanel } from './panels/WatchlistPanel';

function count(pathEnd: string) {
  const seen: string[] = [];
  server.events.on('request:start', ({ request }) => {
    const u = new URL(request.url);
    if (u.pathname.endsWith(pathEnd)) seen.push(u.pathname);
  });
  return seen;
}

/** 삼성전자만 실시간 규칙이 없는(idle) 종목으로 둔다. */
function idleRow(on = true) {
  mock.db.watchQuotes = mock.db.watchQuotes.map((q) =>
    q.code === '005930' ? { ...q, feed: on ? ('idle' as const) : ('realtime' as const) } : q,
  );
}

async function show() {
  renderWithServices(<WatchlistPanel options={{}} size={{ w: 700, h: 300 }} />);
  const table = await screen.findByRole('table', { name: '감시 종목' });
  await within(table).findByRole('row', { name: /삼성전자/ });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('주가 갱신 주기(설정 quotes.refresh_sec): 규칙 없는 종목, 장중만', () => {
  it('설정한 주기(30초)가 지나면 다시 부른다', async () => {
    mock.db.settings['quotes.refresh_sec'] = 30;
    idleRow();
    const calls = count('/watchlist/quotes');
    await show();
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('기본(10분)에서는 45초 뒤에도 다시 부르지 않는다', async () => {
    idleRow();
    const calls = count('/watchlist/quotes');
    await show();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(calls).toHaveLength(1);
  });

  it('주기를 바꾸면 곧 반영된다(10분 → 30초)', async () => {
    idleRow();
    const calls = count('/watchlist/quotes');
    await show();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toHaveLength(1);
    mock.db.settings['quotes.refresh_sec'] = 30;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('장이 닫혀 있으면 부르지 않는다', async () => {
    mock.db.settings['quotes.refresh_sec'] = 30;
    mock.db.monitor.markets = { KR: 'closed', US: 'closed' };
    idleRow();
    const calls = count('/watchlist/quotes');
    await show();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toHaveLength(1);
  });

  it('규칙 없는 종목이 없으면(전부 실시간·폴링) 부르지 않는다', async () => {
    mock.db.settings['quotes.refresh_sec'] = 30;
    idleRow(false);
    const calls = count('/watchlist/quotes');
    await show();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toHaveLength(1);
  });

  it('보유 평가(portfolio/summary)도 같은 주기로 다시 받는다', async () => {
    mock.db.settings['quotes.refresh_sec'] = 30;
    idleRow();
    const calls = count('/portfolio/summary');
    await show();
    const first = calls.length;
    await vi.advanceTimersByTimeAsync(45_000);
    expect(calls.length).toBeGreaterThan(first);
  });
});
