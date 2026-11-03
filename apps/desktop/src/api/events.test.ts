import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeEventSource } from '../test/FakeEventSource';
import { fakePlatform, TEST_BASE } from '../test/fakePlatform';
import { SidecarConnection } from './connection';
import { EventHub, type StreamStatus } from './events';

const NEW_BASE = 'http://127.0.0.1:41001';

async function setup(retryDelaysMs = [1000, 5000]) {
  const shell = fakePlatform({ state: 'ready', baseUrl: TEST_BASE, token: 'tok/1+=' });
  const connection = new SidecarConnection(shell.platform);
  connection.start();
  const hub = new EventHub(connection, {
    createSource: (url) => new FakeEventSource(url),
    retryDelaysMs,
  });
  const statuses: StreamStatus[] = [];
  hub.onStatus((s) => statuses.push(s));
  hub.start();
  await vi.waitFor(() => expect(FakeEventSource.all).toHaveLength(1));
  return { shell, connection, hub, statuses };
}

const quote = {
  market: 'KR',
  code: '005930',
  price: 71500,
  change: 1300,
  change_pct: 1.85,
  at: '2026-11-03T14:33:00+09:00',
  source: 'realtime' as const,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('EventHub', () => {
  it('GET /events에 토큰을 쿼리로 붙여 연결한다(EventSource는 헤더를 못 붙임)', async () => {
    const { hub } = await setup();
    expect(FakeEventSource.latest.url).toBe(`${TEST_BASE}/events?token=tok%2F1%2B%3D`);
    expect(hub.status).toBe('connecting');
    FakeEventSource.latest.open();
    expect(hub.status).toBe('open');
  });

  it('구독한 종류의 이벤트만 해석해서 넘기고, 해제하면 더 넘기지 않는다', async () => {
    const { hub } = await setup();
    const quotes = vi.fn();
    const fired = vi.fn();
    const off = hub.subscribe('quote', quotes);
    hub.subscribe('alert.fired', fired);
    FakeEventSource.latest.open();
    FakeEventSource.latest.emit('quote', quote);
    expect(quotes).toHaveBeenCalledWith(quote);
    expect(fired).not.toHaveBeenCalled();
    off();
    FakeEventSource.latest.emit('quote', quote);
    expect(quotes).toHaveBeenCalledTimes(1);
  });

  it('깨진 data나 처리기 오류가 다른 구독자를 막지 않는다', async () => {
    const { hub } = await setup();
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    hub.subscribe('quote', bad);
    hub.subscribe('quote', good);
    FakeEventSource.latest.emitRaw('quote', '{not json');
    expect(good).not.toHaveBeenCalled();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    FakeEventSource.latest.emit('quote', quote);
    expect(good).toHaveBeenCalledWith(quote);
  });

  it('마지막 수신 시각을 남긴다', async () => {
    const { hub } = await setup();
    expect(hub.lastEventAt).toBeNull();
    FakeEventSource.latest.emit('alerts.state', {
      state: 'running',
      realtime: 0,
      polling: 0,
      markets: {},
      feeds: [],
    });
    expect(hub.lastEventAt).toBeInstanceOf(Date);
  });

  it('끊기면 disconnected, 기다렸다가 새 EventSource로 다시 연결하고 열리면 open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { hub, statuses } = await setup();
    const first = FakeEventSource.latest;
    first.open();
    first.fail();
    expect(first.closed).toBe(true);
    expect(hub.status).toBe('disconnected');
    expect(FakeEventSource.all).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeEventSource.all).toHaveLength(2);
    // 다시 여는 동안에도 끊김으로 둔다(배너가 깜빡이지 않게), 열려야 open
    expect(hub.status).toBe('disconnected');
    FakeEventSource.latest.open();
    expect(hub.status).toBe('open');
    expect(statuses).toEqual(['open', 'disconnected', 'open']);
  });

  it('연달아 실패하면 간격을 늘리고, 열리면 처음 간격으로 돌아간다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await setup([1000, 5000]);
    FakeEventSource.latest.fail();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeEventSource.all).toHaveLength(2);
    FakeEventSource.latest.fail();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeEventSource.all).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(FakeEventSource.all).toHaveLength(3);
    FakeEventSource.latest.open();
    FakeEventSource.latest.fail();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeEventSource.all).toHaveLength(4);
  });

  it('다시 연결할 때 접속 정보를 다시 읽는다(이벤트 없이 포트가 바뀐 경우)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { shell } = await setup();
    shell.platform.getSidecarInfo = async () => ({
      state: 'ready',
      baseUrl: NEW_BASE,
      token: 'tok-2',
    });
    FakeEventSource.latest.fail();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(FakeEventSource.all).toHaveLength(2));
    expect(FakeEventSource.latest.url).toBe(`${NEW_BASE}/events?token=tok-2`);
  });

  it('사이드카가 다시 시작되면(sidecar-state) 기다리지 않고 새 포트·토큰으로 다시 연결한다', async () => {
    const { shell, hub } = await setup();
    const first = FakeEventSource.latest;
    first.open();
    shell.restart({ state: 'ready', baseUrl: NEW_BASE, token: 'tok-2' });
    await vi.waitFor(() => expect(FakeEventSource.all).toHaveLength(2));
    expect(first.closed).toBe(true);
    expect(FakeEventSource.latest.url).toBe(`${NEW_BASE}/events?token=tok-2`);
    FakeEventSource.latest.open();
    expect(hub.status).toBe('open');
  });

  it('사이드카가 실패 상태면 연결하지 않고 disconnected', async () => {
    const { shell, hub } = await setup();
    FakeEventSource.latest.open();
    shell.restart({ state: 'failed' });
    await vi.waitFor(() => expect(hub.status).toBe('disconnected'));
    expect(FakeEventSource.latest.closed).toBe(true);
  });

  it('reconnect()는 기다리지 않고 바로 다시 연결한다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { hub } = await setup([60_000]);
    FakeEventSource.latest.fail();
    hub.reconnect();
    await vi.waitFor(() => expect(FakeEventSource.all).toHaveLength(2));
  });

  it('stop하면 닫고 다시 연결하지 않는다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { hub } = await setup();
    const first = FakeEventSource.latest;
    first.fail();
    hub.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeEventSource.all).toHaveLength(1);
    expect(first.closed).toBe(true);
  });
});
