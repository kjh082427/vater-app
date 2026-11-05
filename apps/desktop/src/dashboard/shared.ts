/**
 * 칸들이 같이 쓰는 자료(대시보드 Review Focus 5). 같은 key의 자료는 앱 전체에서 한 번만 불러오고,
 * SSE 반영(시세 등)도 자료마다 한 번만 한다. 그 자료를 쓰는 칸이 모두 사라지면 정리한다.
 * useResource와 같은 규칙: 다시 부르는 동안 이전 자료를 두고, SSE가 다시 열리면 다시 부른다.
 */
import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import type { ApiClient } from '../api/client';
import { toApiError, type ApiError } from '../api/errors';
import type { EventHub } from '../api/events';
import { useServices, type Services } from '../api/services';
import type { EventType } from '../api/types';
import type { Resource } from '../api/useResource';

export interface LiveContext<T> {
  api: ApiClient;
  events: EventHub;
  get: () => T | undefined;
  mutate: (update: (prev: T | undefined) => T | undefined) => void;
  reload: () => void;
}

export interface Source<T> {
  key: string;
  load: (api: ApiClient) => Promise<T>;
  /** 이 SSE 이벤트가 오면 다시 불러온다(드문 이벤트만). */
  refreshOn?: EventType[];
  /** SSE 반영·주기 갱신. 해제 함수를 돌려준다. 자료마다 한 번만 붙는다. */
  live?: (ctx: LiveContext<T>) => () => void;
}

interface Snapshot<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
}

class Entry<T> {
  snapshot: Snapshot<T> = { data: undefined, error: null, loading: true };
  private listeners = new Set<() => void>();
  private offs: (() => void)[] = [];
  private seq = 0;

  constructor(
    private readonly store: SharedStore,
    private readonly source: Source<T>,
  ) {}

  private set(next: Partial<Snapshot<T>>) {
    this.snapshot = { ...this.snapshot, ...next };
    for (const l of this.listeners) l();
  }

  readonly getSnapshot = () => this.snapshot;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  };

  readonly reload = () => {
    const my = ++this.seq;
    if (!this.snapshot.loading) this.set({ loading: true });
    this.source.load(this.store.api).then(
      (data) => {
        if (my === this.seq) this.set({ data, error: null, loading: false });
      },
      (e: unknown) => {
        if (my === this.seq) this.set({ error: toApiError(e), loading: false });
      },
    );
  };

  readonly mutate = (update: (prev: T | undefined) => T | undefined) => {
    this.set({ data: update(this.snapshot.data) });
  };

  private start() {
    this.store.attach(this.source.key, this);
    const { events } = this.store;
    this.reload();
    let openedBefore = events.status !== 'connecting';
    this.offs.push(
      events.onStatus((status) => {
        if (status !== 'open') return;
        if (openedBefore) this.reload();
        openedBefore = true;
      }),
    );
    for (const type of this.source.refreshOn ?? []) {
      this.offs.push(events.subscribe(type, this.reload));
    }
    if (this.source.live) {
      this.offs.push(
        this.source.live({
          api: this.store.api,
          events,
          get: () => this.snapshot.data,
          mutate: this.mutate,
          reload: this.reload,
        }),
      );
    }
  }

  private stop() {
    for (const off of this.offs.splice(0)) off();
    this.seq++; // 늦게 온 응답은 버린다
    this.snapshot = { data: undefined, error: null, loading: true };
    this.store.detach(this.source.key, this);
  }
}

class SharedStore {
  private entries = new Map<string, Entry<unknown>>();

  constructor(
    readonly api: ApiClient,
    readonly events: EventHub,
  ) {}

  entry<T>(source: Source<T>): Entry<T> {
    let e = this.entries.get(source.key) as Entry<T> | undefined;
    if (!e) {
      e = new Entry(this, source);
      this.entries.set(source.key, e as Entry<unknown>);
    }
    return e;
  }

  attach(key: string, e: object) {
    if (!this.entries.has(key)) this.entries.set(key, e as Entry<unknown>);
  }

  detach(key: string, e: object) {
    if (this.entries.get(key) === e) this.entries.delete(key);
  }
}

const stores = new WeakMap<Services, SharedStore>();

function storeFor(services: Services): SharedStore {
  let s = stores.get(services);
  if (!s) {
    s = new SharedStore(services.api, services.events);
    stores.set(services, s);
  }
  return s;
}

/** 칸의 [새로 고침]이 그 칸이 쓰는 자료를 모두 다시 부르도록, 칸마다 다시 부르기 함수를 모은다. */
export interface RefreshRegistry {
  add: (reload: () => void) => () => void;
}
export const RefreshContext = createContext<RefreshRegistry | null>(null);

/** 같이 쓰는 자료 하나. key가 null이면 부르지 않는다. */
export function useShared<T>(source: Source<T> | null): Resource<T> {
  const store = storeFor(useServices());
  const entry = source ? store.entry(source) : null;
  const snapshot = useSyncExternalStore(
    entry ? entry.subscribe : noopSubscribe,
    entry ? entry.getSnapshot : idle,
  ) as Snapshot<T>;
  const registry = useContext(RefreshContext);
  const reload = entry?.reload;
  useEffect(() => (registry && reload ? registry.add(reload) : undefined), [registry, reload]);
  return {
    data: snapshot.data,
    error: snapshot.error,
    loading: snapshot.loading,
    reload: entry?.reload ?? noop,
    mutate: entry?.mutate ?? noop,
  };
}

const noop = () => undefined;
const noopSubscribe = () => noop;
const IDLE: Snapshot<never> = { data: undefined, error: null, loading: false };
const idle = () => IDLE;
