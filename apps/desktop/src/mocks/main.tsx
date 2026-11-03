/**
 * 개발용 견본 화면(npm run dev 후 /mock.html). 사이드카 없이 MSW 처리기와 예시 자료로 화면을 그린다.
 * 화면 캡처와 눈으로 확인하는 데 쓴다. 빌드(dist)에는 들어가지 않는다(vite.config.ts의 input에 없음).
 *
 * 주소 쿼리로 상황을 고른다(여러 개 가능):
 *   ?stream=down   SSE 연결 끊김(배너)
 *   ?offline=1     감시 상태 offline(배너)
 *   ?empty=1       감시 종목·알림·분석·브리핑이 없는 빈 상태
 *   ?nokey=1       한투 앱키 없음(마법사로 보냄)
 */
import { getResponse, type RequestHandler } from 'msw';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { EventSourceLike } from '../api/events';
import { createServices, ServicesProvider, startServices } from '../api/services';
import type { EventMap, EventType } from '../api/types';
import { App } from '../app/App';
import '../design-system/styles.css';
import type { Platform } from '../platform';
import { createHandlers, createMockDb, type MockDb } from './handlers';

const params = new URLSearchParams(window.location.search);
const db: MockDb = createMockDb();
if (params.get('empty') === '1') {
  db.watchItems = [];
  db.watchQuotes = [];
  db.events = [];
  db.rules = [];
  db.analyses = [];
  db.briefings = [];
  db.monitor = { ...db.monitor, realtime: 0, polling: 0, feeds: [] };
}
if (params.get('offline') === '1') db.monitor = { ...db.monitor, state: 'offline' };
if (params.get('nokey') === '1') db.secrets.KIS_APP_KEY = false;

const handlers = createHandlers(db) as RequestHandler[];

const platform: Platform = {
  kind: 'browser',
  getSidecarInfo: async () => ({
    state: 'ready',
    baseUrl: 'http://127.0.0.1:41000',
    token: 'mock',
  }),
  onSidecarState: () => () => undefined,
  onNavigate: () => () => undefined,
  getAutostart: async () => true,
  setAutostart: async () => undefined,
};

/** 열리면 감시 상태를 한 번 보내는 흉내 EventSource. */
class MockEventSource implements EventSourceLike {
  private listeners = new Map<string, ((event: MessageEvent) => void)[]>();

  constructor() {
    setTimeout(() => {
      if (params.get('stream') === 'down') {
        this.fire('error', new MessageEvent('error'));
        return;
      }
      this.fire('open', new MessageEvent('open'));
      this.send('alerts.state', db.monitor);
    }, 50);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.listeners.clear();
  }

  private fire(type: string, event: MessageEvent) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  private send<K extends EventType>(type: K, data: EventMap[K]) {
    this.fire(type, new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

const services = createServices(platform, {
  createSource: () => new MockEventSource(),
  retryDelaysMs: [60_000],
  fetchImpl: async (input, init) => {
    const response = await getResponse(handlers, new Request(input, init));
    return response ?? new Response(null, { status: 404 });
  },
});
startServices(services);

const root = document.getElementById('root');
if (!root) throw new Error('#root 요소가 없습니다');
createRoot(root).render(
  <StrictMode>
    <ServicesProvider services={services}>
      <App />
    </ServicesProvider>
  </StrictMode>,
);
