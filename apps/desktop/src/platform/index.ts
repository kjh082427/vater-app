/**
 * 플랫폼 어댑터(스펙 9-3). 화면은 Tauri API를 직접 부르지 않고 이것만 쓴다.
 * - Tauri: 셸의 커맨드 `get_sidecar_info`·`get_autostart`·`set_autostart`, 이벤트 `sidecar-state`·`navigate`
 * - 브라우저(Vite 개발 서버): 환경변수 `VITE_SIDECAR_URL`·`VITE_SIDECAR_TOKEN`, 셸 이벤트는 없음
 */
import { invoke as tauriInvoke, isTauri } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';

export type SidecarState = 'starting' | 'ready' | 'failed' | 'stopped';

/** 사이드카 접속 정보. 포트와 토큰은 사이드카가 다시 시작될 때마다 바뀐다. */
export interface SidecarInfo {
  state: SidecarState;
  /** 예: http://127.0.0.1:54321 (ready일 때만) */
  baseUrl?: string;
  token?: string;
}

export interface Platform {
  kind: 'tauri' | 'browser';
  getSidecarInfo(): Promise<SidecarInfo>;
  /** 사이드카 상태가 바뀌었다(다시 시작 포함). 정보는 getSidecarInfo로 다시 읽는다. 해제 함수를 돌려준다. */
  onSidecarState(callback: () => void): () => void;
  /** 알림을 눌러 이동할 화면. 예: "/symbols/KR/005930", "/analyses/3". */
  onNavigate(callback: (route: string) => void): () => void;
  getAutostart(): Promise<boolean>;
  setAutostart(enabled: boolean): Promise<void>;
}

/** @tauri-apps/api 중 쓰는 두 함수. 테스트는 흉내를 넘긴다. */
export interface TauriBridge {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void>;
}

interface ShellSidecarInfo {
  state: SidecarState;
  port?: number;
  token?: string;
}

const STATES: readonly SidecarState[] = ['starting', 'ready', 'failed', 'stopped'];

/** listen은 Promise로 해제 함수를 준다. 그 전에 해제를 불러도 나중에 등록이 풀리게 한다. */
function subscribe<T>(
  bridge: TauriBridge,
  event: string,
  handler: (payload: T) => void,
): () => void {
  let active = true;
  let unlisten: (() => void) | null = null;
  void bridge
    .listen<T>(event, (e) => {
      if (active) handler(e.payload);
    })
    .then((off) => {
      if (active) unlisten = off;
      else off();
    })
    .catch((e: unknown) => {
      // 이벤트 이름과 짧은 문구만 남긴다(페이로드·토큰은 남기지 않는다)
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`셸 이벤트 구독 실패: ${event}`, message.slice(0, 200));
    });
  return () => {
    active = false;
    unlisten?.();
  };
}

export function createTauriPlatform(bridge: TauriBridge): Platform {
  return {
    kind: 'tauri',
    async getSidecarInfo() {
      const info = await bridge.invoke<ShellSidecarInfo>('get_sidecar_info');
      const state = STATES.includes(info.state) ? info.state : 'failed';
      if (state !== 'ready') return { state };
      if (typeof info.port !== 'number' || typeof info.token !== 'string' || info.token === '') {
        return { state: 'failed' };
      }
      return { state, baseUrl: `http://127.0.0.1:${info.port}`, token: info.token };
    },
    onSidecarState(callback) {
      return subscribe(bridge, 'sidecar-state', () => callback());
    },
    onNavigate(callback) {
      return subscribe<{ route?: unknown }>(bridge, 'navigate', (payload) => {
        if (typeof payload?.route === 'string') callback(payload.route);
      });
    },
    async getAutostart() {
      return Boolean(await bridge.invoke<boolean>('get_autostart'));
    },
    async setAutostart(enabled) {
      await bridge.invoke('set_autostart', { enabled });
    },
  };
}

export interface BrowserEnv {
  VITE_SIDECAR_URL?: string;
  VITE_SIDECAR_TOKEN?: string;
}

export function createBrowserPlatform(env: BrowserEnv): Platform {
  const baseUrl = env.VITE_SIDECAR_URL?.trim().replace(/\/+$/, '');
  const token = env.VITE_SIDECAR_TOKEN?.trim();
  return {
    kind: 'browser',
    async getSidecarInfo() {
      if (!baseUrl || !token) return { state: 'failed' };
      return { state: 'ready', baseUrl, token };
    },
    onSidecarState: () => () => undefined,
    onNavigate: () => () => undefined,
    // 브라우저에는 부팅 시 자동 실행이 없다
    getAutostart: async () => false,
    setAutostart: async () => undefined,
  };
}

/** 앱이 쓰는 플랫폼: Tauri 창 안이면 셸, 아니면 브라우저(Vite 개발 서버). */
export function detectPlatform(): Platform {
  if (isTauri()) {
    return createTauriPlatform({
      invoke: (cmd, args) => tauriInvoke(cmd, args),
      listen: (event, handler) => tauriListen(event, handler),
    });
  }
  return createBrowserPlatform({
    VITE_SIDECAR_URL: import.meta.env.VITE_SIDECAR_URL as string | undefined,
    VITE_SIDECAR_TOKEN: import.meta.env.VITE_SIDECAR_TOKEN as string | undefined,
  });
}
