import type { Platform, SidecarInfo } from '../platform';

export const TEST_BASE = 'http://127.0.0.1:41000';
export const TEST_TOKEN = 'test-token-1';

/** 셸 흉내. restart로 포트·토큰을 바꾸고 sidecar-state를 보내며, navigate로 알림 클릭을 흉내 낸다. */
export function fakePlatform(
  initial: SidecarInfo = { state: 'ready', baseUrl: TEST_BASE, token: TEST_TOKEN },
) {
  let info = initial;
  let autostart = true;
  let opened = 0;
  let openError: Error | null = null;
  const stateListeners = new Set<() => void>();
  const navListeners = new Set<(route: string) => void>();
  const platform: Platform = {
    kind: 'tauri',
    getSidecarInfo: async () => info,
    onSidecarState(callback) {
      stateListeners.add(callback);
      return () => stateListeners.delete(callback);
    },
    onNavigate(callback) {
      navListeners.add(callback);
      return () => navListeners.delete(callback);
    },
    getAutostart: async () => autostart,
    setAutostart: async (enabled) => {
      autostart = enabled;
    },
    openLogFolder: async () => {
      opened += 1;
      if (openError) throw openError;
    },
  };
  return {
    /** 로그 폴더 열기 횟수. */
    get logFolderOpened() {
      return opened;
    },
    /** 다음 로그 폴더 열기를 실패시킨다. */
    failLogFolder(error: Error) {
      openError = error;
    },
    platform,
    /** 사이드카가 다시 시작되어 정보가 바뀌었다. */
    restart(next: SidecarInfo) {
      info = next;
      for (const listener of stateListeners) listener();
    },
    navigate(route: string) {
      for (const listener of navListeners) listener(route);
    },
    get listenerCount() {
      return stateListeners.size;
    },
  };
}
