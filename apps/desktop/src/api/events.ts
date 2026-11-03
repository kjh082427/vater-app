/**
 * SSE 허브: `GET /events` 하나로 오는 이벤트(스펙 2-2)를 종류별 구독자에게 나눠 준다.
 *
 * - EventSource는 헤더를 붙일 수 없어서 토큰을 `?token=`으로 붙인다(스펙 2-1).
 * - 끊기면 EventSource 스스로의 재시도(옛 주소·토큰 그대로)에 맡기지 않는다: 닫고 기다렸다가
 *   접속 정보를 다시 읽어 새로 연다. 사이드카가 다시 시작되면(포트·토큰 바뀜) 기다리지 않고 바로 연다.
 * - 상태(connecting/open/disconnected)는 오프라인 배너와 "다시 연결되면 목록 다시 불러오기"에 쓴다.
 */
import type { SidecarConnection } from './connection';
import { EVENT_TYPES, type EventMap, type EventType } from './types';

/** EventSource 중 쓰는 부분. 테스트는 흉내를 넘긴다. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

export type StreamStatus = 'connecting' | 'open' | 'disconnected';

export interface EventHubOptions {
  createSource?: (url: string) => EventSourceLike;
  /** 연달아 실패할 때의 대기 간격. 마지막 값을 계속 쓴다. */
  retryDelaysMs?: number[];
}

type Handler<K extends EventType> = (data: EventMap[K]) => void;

const DEFAULT_RETRY = [1000, 2000, 5000, 10_000];

export class EventHub {
  private source: EventSourceLike | null = null;
  private handlers = new Map<EventType, Set<Handler<EventType>>>();
  private statusListeners = new Set<(status: StreamStatus) => void>();
  private currentStatus: StreamStatus = 'connecting';
  private lastAt: Date | null = null;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  /** 연결 시도마다 늘린다. 늦게 끝난 옛 시도가 새 연결을 덮지 않게 한다. */
  private attempt = 0;
  private offConnection: (() => void) | null = null;
  /** 한 번이라도 열렸는지. */
  private everOpened = false;
  /** open()이 접속 정보를 읽는 중. */
  private resolving = false;
  private readonly createSource: (url: string) => EventSourceLike;
  private readonly retryDelaysMs: number[];

  constructor(
    private readonly connection: SidecarConnection,
    options: EventHubOptions = {},
  ) {
    this.createSource = options.createSource ?? ((url) => new EventSource(url));
    this.retryDelaysMs = options.retryDelaysMs?.length ? options.retryDelaysMs : DEFAULT_RETRY;
  }

  get status(): StreamStatus {
    return this.currentStatus;
  }

  /** 마지막으로 이벤트를 받은 시각. */
  get lastEventAt(): Date | null {
    return this.lastAt;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // 사이드카가 다시 시작되면 포트·토큰이 바뀐다: 기다리지 않고 새 정보로 다시 연다.
    // 연결 준비 중(주소를 읽는 중)이면 그 시도가 새 정보를 읽으므로 따로 다시 열지 않는다.
    this.offConnection = this.connection.onChange((info) => {
      // 사이드카가 내려갔거나 다시 시작 중이면, EventSource의 error보다 먼저 와도 바로 끊김으로 둔다
      // (배너와 "확인 불가" 표시가 켜지고, 열릴 때까지 유지된다).
      // 앱을 처음 켤 때의 starting은 끊김이 아니다(한 번이라도 열렸던 연결만 끊김으로 본다).
      if (info.state !== 'ready' && this.everOpened) this.markDown();
      if (!this.resolving) this.reconnect();
    });
    void this.open();
  }

  stop(): void {
    this.running = false;
    this.resolving = false;
    this.attempt += 1;
    this.offConnection?.();
    this.offConnection = null;
    this.clearTimer();
    this.closeSource();
  }

  /** 지금 바로 다시 연결한다(배너의 [지금 다시 연결], 사이드카 재시작). */
  reconnect(): void {
    if (!this.running) return;
    this.resolving = false;
    this.clearTimer();
    this.closeSource();
    void this.open();
  }

  subscribe<K extends EventType>(type: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<EventType>);
    return () => {
      set.delete(handler as Handler<EventType>);
    };
  }

  onStatus(listener: (status: StreamStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** 끊김으로 표시하고, 다음 open까지 유지되게 실패로 센다. */
  private markDown() {
    if (this.failures === 0) this.failures = 1;
    this.setStatus('disconnected');
  }

  private setStatus(next: StreamStatus) {
    if (next === this.currentStatus) return;
    this.currentStatus = next;
    for (const listener of this.statusListeners) listener(next);
  }

  private async open(): Promise<void> {
    const attempt = ++this.attempt;
    // 끊긴 뒤 다시 여는 중이면 disconnected를 유지한다(열릴 때까지 배너가 떠 있게)
    if (this.failures === 0) this.setStatus('connecting');
    let url: string;
    this.resolving = true;
    try {
      // 실패 뒤 다시 열 때는 정보를 새로 읽는다(셸 이벤트보다 먼저 포트가 바뀌었을 수 있다).
      if (this.failures > 0) await this.connection.refresh();
      const endpoint = await this.connection.current();
      url = `${endpoint.baseUrl}/events?token=${encodeURIComponent(endpoint.token)}`;
    } catch {
      if (attempt === this.attempt) {
        this.resolving = false;
        this.fail();
      }
      return;
    }
    if (attempt === this.attempt) this.resolving = false;
    if (attempt !== this.attempt || !this.running) return;

    const source = this.createSource(url);
    this.source = source;
    source.addEventListener('open', () => {
      if (this.source !== source) return;
      this.failures = 0;
      this.everOpened = true;
      this.setStatus('open');
    });
    source.addEventListener('error', () => {
      if (this.source !== source) return;
      this.closeSource();
      this.fail();
    });
    for (const type of EVENT_TYPES) {
      source.addEventListener(type, (event) => {
        if (this.source === source) this.dispatch(type, event);
      });
    }
  }

  private fail() {
    if (!this.running) return;
    this.setStatus('disconnected');
    const delays = this.retryDelaysMs;
    const delay = delays[Math.min(this.failures, delays.length - 1)] ?? 1000;
    this.failures += 1;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.open();
    }, delay);
  }

  private dispatch(type: EventType, event: MessageEvent) {
    let data: unknown;
    try {
      data = JSON.parse(String(event.data));
    } catch {
      return; // 형식이 깨진 이벤트는 버린다
    }
    this.lastAt = new Date();
    for (const handler of this.handlers.get(type) ?? []) {
      try {
        handler(data as EventMap[EventType]);
      } catch (e) {
        console.error(`SSE ${type} 처리 중 오류`, e);
      }
    }
  }

  private closeSource() {
    this.source?.close();
    this.source = null;
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
