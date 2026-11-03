import type { EventSourceLike } from '../api/events';
import type { EventMap, EventType } from '../api/types';

/**
 * 테스트용 EventSource. jsdom에는 EventSource가 없고, 끊김·다시 연결을 테스트가 직접 일으켜야 하므로
 * 이벤트 허브에 이 클래스를 만드는 함수를 넘긴다. 만들어진 것은 모두 `FakeEventSource.all`에 남는다.
 */
export class FakeEventSource implements EventSourceLike {
  static all: FakeEventSource[] = [];

  static reset() {
    FakeEventSource.all = [];
  }

  /** 가장 최근에 만든 것. */
  static get latest(): FakeEventSource {
    const last = FakeEventSource.all[FakeEventSource.all.length - 1];
    if (!last) throw new Error('아직 만든 EventSource가 없습니다');
    return last;
  }

  readonly url: string;
  closed = false;
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.all.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  close() {
    this.closed = true;
  }

  private fire(type: string, event: MessageEvent) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  /** 서버 연결이 열림. */
  open() {
    this.fire('open', new MessageEvent('open'));
  }

  /** 연결이 끊기거나 서버가 거부함. */
  fail() {
    this.fire('error', new MessageEvent('error'));
  }

  /** 이름 있는 SSE 이벤트 하나를 보낸다. */
  emit<K extends EventType>(type: K, data: EventMap[K]) {
    this.fire(type, new MessageEvent(type, { data: JSON.stringify(data) }));
  }

  /** 형식이 깨진 data. */
  emitRaw(type: string, data: string) {
    this.fire(type, new MessageEvent(type, { data }));
  }
}
