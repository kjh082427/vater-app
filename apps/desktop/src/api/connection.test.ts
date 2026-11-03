import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Platform, SidecarInfo } from '../platform';
import { fakePlatform, TEST_BASE } from '../test/fakePlatform';
import { SidecarConnection } from './connection';

afterEach(() => {
  vi.useRealTimers();
});

describe('SidecarConnection', () => {
  it('셸의 ready 대기(60초)보다 먼저 포기하지 않는다: 30초 뒤 ready여도 주소를 준다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const shell = fakePlatform({ state: 'starting' });
    const connection = new SidecarConnection(shell.platform);
    connection.start();
    let settled: unknown = null;
    const pending = connection.current().then(
      (endpoint) => (settled = endpoint),
      (e: unknown) => (settled = e),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(settled).toBeNull(); // 아직 기다리는 중
    shell.restart({ state: 'ready', baseUrl: TEST_BASE, token: 't' });
    await pending;
    expect(settled).toEqual({ baseUrl: TEST_BASE, token: 't' });
  });

  it('셸 대기와 여유를 넘기면(70초) SIDECAR_STARTING으로 포기한다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const shell = fakePlatform({ state: 'starting' });
    const connection = new SidecarConnection(shell.platform);
    connection.start();
    const pending = connection.current().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(69_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await pending).toMatchObject({ code: 'SIDECAR_STARTING' });
  });

  it('refresh가 겹치면 늦게 끝난 옛 읽기가 새 정보를 덮지 않는다', async () => {
    const reads: ((info: SidecarInfo) => void)[] = [];
    const platform: Platform = {
      ...fakePlatform().platform,
      getSidecarInfo: () => new Promise<SidecarInfo>((resolve) => reads.push(resolve)),
    };
    const connection = new SidecarConnection(platform);
    const first = connection.refresh();
    const second = connection.refresh();
    reads[1]?.({ state: 'ready', baseUrl: 'http://127.0.0.1:2', token: 'new' });
    await second;
    reads[0]?.({ state: 'ready', baseUrl: 'http://127.0.0.1:1', token: 'old' });
    await first;
    expect(connection.snapshot).toEqual({
      state: 'ready',
      baseUrl: 'http://127.0.0.1:2',
      token: 'new',
    });
    await connection.settled();
    expect(connection.snapshot?.token).toBe('new');
  });
});
