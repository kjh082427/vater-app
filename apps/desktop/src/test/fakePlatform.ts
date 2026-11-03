import type { Platform, SidecarInfo, UpdateInfo } from '../platform';

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
  let appVersion: string | null = null;
  let update: UpdateInfo | Error = { state: 'up_to_date' };
  let installs = 0;
  let installError: Error | null = null;
  const updateListeners = new Set<(info: UpdateInfo) => void>();
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
    getAppVersion: async () => appVersion,
    checkUpdate: async () => {
      if (update instanceof Error) throw update;
      return update;
    },
    installUpdate: async () => {
      installs += 1;
      if (installError) throw installError;
    },
    onUpdateAvailable(callback) {
      updateListeners.add(callback);
      return () => updateListeners.delete(callback);
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
    /** 셸이 아는 앱 버전(기본은 없음: /health를 쓴다). */
    setAppVersion(version: string | null) {
      appVersion = version;
    },
    /** 다음 [업데이트 확인]의 결과. Error면 실패. */
    setUpdate(next: UpdateInfo | Error) {
      update = next;
    },
    /** [지금 설치] 횟수. */
    get updateInstalls() {
      return installs;
    },
    failInstall(error: Error) {
      installError = error;
    },
    /** 셸의 update-available 이벤트. */
    updateAvailable(info: UpdateInfo) {
      for (const listener of updateListeners) listener(info);
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
