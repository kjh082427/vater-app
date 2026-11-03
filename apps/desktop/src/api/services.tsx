/**
 * 앱이 쓰는 사이드카 연결 묶음(플랫폼, 접속 정보, REST 클라이언트, SSE 허브)과 그것을 화면에 주는 React 문맥.
 * 테스트는 흉내 플랫폼과 EventSource로 만든 묶음을 넘긴다.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { Platform } from '../platform';
import { createClient, type ApiClient } from './client';
import { SidecarConnection } from './connection';
import { EventHub, type EventHubOptions, type StreamStatus } from './events';
import type { EventMap, EventType } from './types';

export interface Services {
  platform: Platform;
  connection: SidecarConnection;
  api: ApiClient;
  events: EventHub;
}

export interface ServicesOptions extends EventHubOptions {
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
}

export function createServices(platform: Platform, options: ServicesOptions = {}): Services {
  const connection = new SidecarConnection(platform);
  const api = createClient(connection, options.fetchImpl);
  const events = new EventHub(connection, options);
  return { platform, connection, api, events };
}

/** 접속 정보 감시와 SSE 연결을 시작한다. 멈추는 함수를 돌려준다. */
export function startServices(services: Services): () => void {
  services.connection.start();
  services.events.start();
  return () => {
    services.events.stop();
    services.connection.stop();
  };
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({
  services,
  children,
}: {
  services: Services;
  children: ReactNode;
}) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('ServicesProvider 안에서 써야 합니다');
  return services;
}

export function useApi(): ApiClient {
  return useServices().api;
}

/** SSE 이벤트 하나를 구독한다. 처리기는 매번 바뀌어도 다시 구독하지 않는다. */
export function useEvent<K extends EventType>(type: K, handler: (data: EventMap[K]) => void): void {
  const { events } = useServices();
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => events.subscribe(type, (data) => ref.current(data)), [events, type]);
}

/** SSE 연결 상태(connecting/open/disconnected). */
export function useStreamStatus(): StreamStatus {
  const { events } = useServices();
  return useSyncExternalStore(
    (notify) => events.onStatus(notify),
    () => events.status,
  );
}
