/**
 * 사이드카 접속 정보(주소·토큰) 관리. 셸이 사이드카를 다시 시작하면(`sidecar-state`) 포트와 토큰이
 * 바뀌므로 다시 읽고, 바뀌었으면 구독자(SSE 허브)에게 알린다(스펙 2-1).
 */
import type { Platform, SidecarInfo } from '../platform';
import { ApiError } from './errors';

export interface Endpoint {
  baseUrl: string;
  token: string;
}

/**
 * 사이드카가 "시작 중"일 때 요청이 기다리는 최대 시간.
 * 셸(shell/tauri)은 사이드카의 ready를 60초까지 기다린다(첫 실행의 백신 검사 등으로 늦을 수 있다).
 * 그보다 먼저 포기하면 마법사·화면이 "시작 중" 오류로 끝나므로, 셸 대기 60초 + 여유 10초.
 */
export const START_WAIT_MS = 70_000;

function same(a: SidecarInfo | null, b: SidecarInfo | null): boolean {
  return a?.state === b?.state && a?.baseUrl === b?.baseUrl && a?.token === b?.token;
}

function unavailable(info: SidecarInfo): ApiError {
  if (info.state === 'starting') {
    return new ApiError(
      'SIDECAR_STARTING',
      'Vater 백그라운드 서비스가 아직 시작 중입니다.',
      '잠시 뒤 다시 시도하세요.',
      0,
    );
  }
  return new ApiError(
    'SIDECAR_UNAVAILABLE',
    'Vater 백그라운드 서비스를 실행하지 못했습니다.',
    '앱을 완전히 종료(트레이 메뉴 > 종료)한 뒤 다시 실행하세요.',
    0,
  );
}

export class SidecarConnection {
  private info: SidecarInfo | null = null;
  private pending: Promise<SidecarInfo> | null = null;
  /** 다시 읽기마다 늘린다. 늦게 끝난 옛 읽기가 새 정보를 덮지 않게 가장 최근 것만 반영한다. */
  private seq = 0;
  private listeners = new Set<(info: SidecarInfo) => void>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly platform: Platform) {}

  /** 셸의 sidecar-state 이벤트를 듣기 시작한다. */
  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.platform.onSidecarState(() => {
      void this.refresh();
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** 마지막으로 읽은 정보(아직 안 읽었으면 null). */
  get snapshot(): SidecarInfo | null {
    return this.info;
  }

  /** 정보를 다시 읽는다. 바뀌었으면 구독자에게 알린다. 겹치면 가장 최근 읽기만 반영한다. */
  refresh(): Promise<SidecarInfo> {
    const seq = ++this.seq;
    const read = this.platform
      .getSidecarInfo()
      .catch((): SidecarInfo => ({ state: 'failed' }))
      .then((next) => {
        if (seq !== this.seq) return this.info ?? next; // 더 새 읽기가 있다
        this.pending = null;
        if (!same(this.info, next)) {
          this.info = next;
          for (const listener of this.listeners) listener(next);
        }
        return next;
      });
    this.pending = read;
    return read;
  }

  /** 진행 중인 다시 읽기가 끝날 때까지 기다린다. */
  async settled(): Promise<void> {
    while (this.pending) await this.pending;
  }

  onChange(listener: (info: SidecarInfo) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 요청에 쓸 주소와 토큰. 시작 중이면 준비될 때까지(최대 START_WAIT_MS) 기다린다. */
  async current(): Promise<Endpoint> {
    if (!this.info && !this.pending) await this.refresh();
    await this.settled();
    let info: SidecarInfo = this.info ?? { state: 'failed' };
    if (info.state === 'starting') info = await this.waitUntilSettledState();
    if (info.state === 'ready' && info.baseUrl && info.token) {
      return { baseUrl: info.baseUrl, token: info.token };
    }
    throw unavailable(info);
  }

  private waitUntilSettledState(): Promise<SidecarInfo> {
    return new Promise((resolve) => {
      // 기다리기 시작하기 전에 이미 바뀌었을 수 있다
      if (this.info && this.info.state !== 'starting') {
        resolve(this.info);
        return;
      }
      const timer = setTimeout(() => {
        off();
        resolve(this.info ?? { state: 'starting' });
      }, START_WAIT_MS);
      const off = this.onChange((next) => {
        if (next.state === 'starting') return;
        clearTimeout(timer);
        off();
        resolve(next);
      });
    });
  }
}
