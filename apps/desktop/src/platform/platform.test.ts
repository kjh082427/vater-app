import { describe, expect, it, vi } from 'vitest';
import { createBrowserPlatform, createTauriPlatform, type TauriBridge } from './index';

/** Tauri 쪽 invoke·listen 흉내. emit으로 셸 이벤트를 보낸다. */
function fakeTauri(responses: Record<string, unknown>) {
  const handlers = new Map<string, Set<(event: { payload: unknown }) => void>>();
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'set_autostart') {
      responses.get_autostart = args?.enabled;
      return null;
    }
    if (!(cmd in responses)) throw new Error(`unknown command ${cmd}`);
    return responses[cmd];
  });
  const bridge: TauriBridge = {
    invoke: invoke as TauriBridge['invoke'],
    listen: async (event, handler) => {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler as (event: { payload: unknown }) => void);
      return () => set.delete(handler as (event: { payload: unknown }) => void);
    },
  };
  const emit = (event: string, payload: unknown) => {
    for (const h of handlers.get(event) ?? []) h({ payload });
  };
  return { bridge, invoke, emit, handlers };
}

describe('Tauri 플랫폼', () => {
  it('get_sidecar_info의 포트를 127.0.0.1 주소로 바꾼다', async () => {
    const { bridge } = fakeTauri({
      get_sidecar_info: { state: 'ready', port: 54321, token: 'tok-1' },
    });
    const platform = createTauriPlatform(bridge);
    expect(await platform.getSidecarInfo()).toEqual({
      state: 'ready',
      baseUrl: 'http://127.0.0.1:54321',
      token: 'tok-1',
    });
  });

  it('아직 시작 중이면 주소와 토큰이 없다', async () => {
    const { bridge } = fakeTauri({ get_sidecar_info: { state: 'starting' } });
    const platform = createTauriPlatform(bridge);
    expect(await platform.getSidecarInfo()).toEqual({ state: 'starting' });
  });

  it('ready인데 포트나 토큰이 빠졌으면 실패로 본다', async () => {
    const { bridge } = fakeTauri({ get_sidecar_info: { state: 'ready', port: 1 } });
    const platform = createTauriPlatform(bridge);
    expect((await platform.getSidecarInfo()).state).toBe('failed');
  });

  it('sidecar-state 이벤트를 알리고, 해제하면 더 알리지 않는다', async () => {
    const { bridge, emit } = fakeTauri({});
    const platform = createTauriPlatform(bridge);
    const seen = vi.fn();
    const off = platform.onSidecarState(seen);
    await Promise.resolve();
    emit('sidecar-state', { state: 'ready' });
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    await Promise.resolve();
    emit('sidecar-state', { state: 'ready' });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('listen이 끝나기 전에 해제해도 나중에 등록된 처리기를 지운다', async () => {
    const { bridge, emit, handlers } = fakeTauri({});
    const platform = createTauriPlatform(bridge);
    const seen = vi.fn();
    platform.onNavigate(seen)();
    await Promise.resolve();
    await Promise.resolve();
    emit('navigate', { route: '/analyses/3' });
    expect(seen).not.toHaveBeenCalled();
    expect(handlers.get('navigate')?.size ?? 0).toBe(0);
  });

  it('navigate 이벤트의 route를 넘긴다', async () => {
    const { bridge, emit } = fakeTauri({});
    const platform = createTauriPlatform(bridge);
    const seen = vi.fn();
    platform.onNavigate(seen);
    await Promise.resolve();
    emit('navigate', { route: '/symbols/KR/005930' });
    emit('navigate', { nope: 1 });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith('/symbols/KR/005930');
  });

  it('부팅 시 자동 실행: get_autostart / set_autostart(enabled)', async () => {
    const { bridge, invoke } = fakeTauri({ get_autostart: false });
    const platform = createTauriPlatform(bridge);
    expect(await platform.getAutostart()).toBe(false);
    await platform.setAutostart(true);
    expect(invoke).toHaveBeenCalledWith('set_autostart', { enabled: true });
    expect(await platform.getAutostart()).toBe(true);
  });
});

describe('브라우저 플랫폼 (Vite 개발 서버)', () => {
  it('환경변수의 주소와 토큰을 쓴다', async () => {
    const platform = createBrowserPlatform({
      VITE_SIDECAR_URL: 'http://127.0.0.1:8765/',
      VITE_SIDECAR_TOKEN: 'dev',
    });
    expect(platform.kind).toBe('browser');
    expect(await platform.getSidecarInfo()).toEqual({
      state: 'ready',
      baseUrl: 'http://127.0.0.1:8765',
      token: 'dev',
    });
  });

  it('환경변수가 없으면 실패 상태와 이유를 알린다', async () => {
    const platform = createBrowserPlatform({});
    const info = await platform.getSidecarInfo();
    expect(info.state).toBe('failed');
  });

  it('셸 이벤트는 오지 않고, 자동 실행은 꺼짐으로 답한다', async () => {
    const platform = createBrowserPlatform({});
    const off = platform.onNavigate(vi.fn());
    off();
    expect(await platform.getAutostart()).toBe(false);
    await expect(platform.setAutostart(true)).resolves.toBeUndefined();
  });
});
