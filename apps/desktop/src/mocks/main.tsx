/**
 * 개발용 견본 화면(npm run dev 후 /mock.html). 사이드카 없이 MSW 처리기와 예시 자료로 화면을 그린다.
 * 화면 캡처와 눈으로 확인하는 데 쓴다. 빌드(dist)에는 들어가지 않는다(vite.config.ts의 input에 없음).
 *
 * 주소 쿼리로 상황을 고른다(여러 개 가능):
 *   ?stream=down   SSE 연결 끊김(배너)
 *   ?offline=1     감시 상태 offline(배너)
 *   ?empty=1       감시 종목·알림·분석·브리핑이 없는 빈 상태
 *   ?nokey=1       한투 앱키 없음(마법사로 보냄)
 *   ?running=1     실행 중인 분석(#/analyses/40)과 진행 이벤트
 *   ?six=1         홈에 6칸 대시보드 탭("6칸")을 더한다
 *   ?broken=1      저장된 대시보드 문서가 깨짐(기본 배치 + 배너)
 *   ?brokers=1     흉내 증권사 서버: 키움·메리츠를 연결하면 보유 종목이 들어오고, 시세·일봉·자산 추이 예시가 있다
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
import { defaultDashboard } from '../dashboard/layout/defaults';
import { templateRoot } from '../dashboard/layout/templates';
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
if (params.get('offline') === '1') {
  // 사이드카처럼: 오프라인이면 모든 종목의 수신 상태도 offline
  db.monitor = {
    ...db.monitor,
    state: 'offline',
    realtime: 0,
    polling: 0,
    feeds: db.monitor.feeds.map((f) => ({ ...f, feed: 'offline' })),
  };
  db.watchQuotes = db.watchQuotes.map((q) => ({ ...q, feed: 'offline' }));
}
if (params.get('nokey') === '1') db.secrets.KIS_APP_KEY = false;
if (params.get('broken') === '1') db.dashboards = { version: 1, dashboards: [{ id: 'x' }] };
if (params.get('six') === '1') {
  const home = defaultDashboard('home');
  db.dashboards = {
    version: 1,
    dashboards: [
      home,
      {
        id: 'six',
        name: '6칸',
        kpi: { enabled: false, items: [] },
        layout: { template: 'grid-2x3', root: templateRoot('grid-2x3') },
        panels: [
          { type: 'index-chart', options: { index: 'KOSDAQ' } },
          { type: 'kpi', options: { metrics: ['kospi', 'spx'] } },
          { type: 'running-analyses', options: {} },
          { type: 'briefing', options: { market: 'US' } },
          { type: 'recent-alerts', options: {} },
          { type: 'index-chart', options: { index: 'SPX' } },
        ],
      },
    ],
  };
}
if (params.get('brokers') === '1') {
  // 흉내 증권사 서버(실제 증권사는 부르지 않는다): 연결하면 아래 보유가 그 증권사의 내역이 된다
  db.fakeBroker = {
    kiwoom: [
      { market: 'KR', code: '005930', quantity: '10', avg_price: 64000 },
      { market: 'KR', code: '035420', quantity: '3', avg_price: 180000 },
    ],
    meritz: [
      { market: 'KR', code: '005930', quantity: '5', avg_price: 64000 },
      { market: 'US', code: 'NVDA', quantity: '2.5', avg_price: 120 },
    ],
  };
  db.prices = { 'KR:005930': 71400, 'KR:035420': 195000, 'US:NVDA': 130.5 };
  const closes = (from: number) =>
    Array.from({ length: 60 }, (_, i) => ({
      day: new Date(Date.UTC(2026, 8, 7 + i)).toISOString().slice(0, 10),
      close: Math.round(from + i * 80 + Math.sin(i / 3) * 900),
    }));
  db.bars = { 'KR:005930': closes(66000), 'KR:035420': closes(180000), 'US:NVDA': closes(120) };
  db.history = Array.from({ length: 30 }, (_, i) => ({
    day: new Date(Date.UTC(2026, 9, 8 + i)).toISOString().slice(0, 10),
    value: 1000000 + i * 9000 + Math.sin(i / 2) * 20000,
    cost: i < 12 ? 960000 : 1100000,
    usdkrw: 1400,
    backfilled: i === 5,
  }));
}
const running = params.get('running') === '1';
if (running) {
  const base = db.analyses[0];
  if (base) {
    db.analyses.push({
      ...base,
      id: 40,
      code: '000660',
      name: 'SK하이닉스',
      status: 'running',
      decision: null,
      decision_ko: null,
      decision_changed: false,
      summary: null,
      reports: null,
      timings: null,
      tokens: null,
    });
  }
}

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
  openLogFolder: async () => undefined,
  getAppVersion: async () => null,
  checkUpdate: async () => ({ state: 'up_to_date' }),
  installUpdate: async () => undefined,
  onUpdateAvailable: () => () => undefined,
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
      if (running) {
        this.send('analysis.progress', {
          id: 40,
          stage: 'analysts',
          node: 'Market Analyst',
          elapsed_sec: 412,
        });
        this.send('analysis.progress', {
          id: 40,
          stage: 'research',
          node: 'Bull Researcher',
          elapsed_sec: 530,
        });
      }
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
