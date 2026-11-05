/** 칸 내용과 숫자 카드가 쓰는 사이드카 자료(같은 key는 한 번만 불러온다, shared.ts). */
import type {
  AlertEvent,
  AnalysisDetail,
  AnalysisItem,
  BriefingDetail,
  BriefingItem,
  HistoryPoint,
  MarketCode,
  PortfolioSummary,
  WatchQuote,
} from '../api/types';
import type { components } from '../api/schema';
import { isActiveStatus } from '../screens/analysis/stages';
import type { Source } from './shared';

export type IndexQuote = components['schemas']['IndexOut'];

/** 장중이지만 실시간 규칙이 없는(idle) 종목은 SSE 시세가 오지 않아 이 간격으로 다시 받는다. */
const IDLE_REFRESH_MS = 30_000;
/** 지수: 사이드카가 30초 캐시한다. 칸이 떠 있는 동안 같은 간격으로 다시 받는다. */
const INDEX_REFRESH_MS = 30_000;

function every(ms: number, tick: () => void): () => void {
  const timer = setInterval(tick, ms);
  return () => clearInterval(timer);
}

/** 감시 종목 시세: GET /watchlist/quotes + SSE quote(시세)·alerts.state(수신 상태). */
export const quotesSource: Source<WatchQuote[]> = {
  key: '/watchlist/quotes',
  load: (api) => api.request<WatchQuote[]>('/watchlist/quotes'),
  live: ({ events, get, mutate, reload }) => {
    const offs = [
      events.subscribe('quote', (q) =>
        mutate((rows) =>
          rows?.map((r) =>
            r.market === q.market && r.code === q.code
              ? {
                  ...r,
                  price: q.price,
                  change: q.change,
                  change_pct: q.change_pct,
                  at: q.at,
                  source: q.source,
                }
              : r,
          ),
        ),
      ),
      events.subscribe('alerts.state', (status) =>
        mutate((rows) =>
          rows?.map((r) => {
            const f = status.feeds.find((x) => x.market === r.market && x.code === r.code);
            return f ? { ...r, feed: f.feed } : r;
          }),
        ),
      ),
      every(IDLE_REFRESH_MS, () => {
        if (get()?.some((r) => r.feed === 'idle')) reload();
      }),
    ];
    return () => offs.forEach((off) => off());
  },
};

/** 지수 4개(코스피·코스닥·S&P 500·나스닥): 최근 30거래일 종가 + 오늘 값. */
export const indicesSource: Source<IndexQuote[]> = {
  key: '/market/indices',
  load: (api) => api.request<IndexQuote[]>('/market/indices'),
  live: ({ reload }) => every(INDEX_REFRESH_MS, reload),
};

/** 시장별 최신 브리핑 1건(없으면 null). */
const briefingSources = new Map<MarketCode, Source<BriefingDetail | null>>();
export function briefingSource(market: MarketCode): Source<BriefingDetail | null> {
  let s = briefingSources.get(market);
  if (!s) {
    s = {
      key: `briefing:latest:${market}`,
      load: async (api) => {
        const list = await api.request<BriefingItem[]>('/briefings', {
          query: { market, limit: 1 },
        });
        const first = list[0];
        return first ? api.request<BriefingDetail>(`/briefings/${first.id}`) : null;
      },
      refreshOn: ['briefing.status'],
    };
    briefingSources.set(market, s);
  }
  return s;
}

/** 최근 알림 100건: 최근 알림·알림 이력 칸, 오늘 알림 수가 같이 쓴다. 새 알림은 SSE alert.fired. */
export const ALERT_LIMIT = 100;
export const alertEventsSource: Source<AlertEvent[]> = {
  key: `/alerts/events?limit=${ALERT_LIMIT}`,
  load: (api) => api.request<AlertEvent[]>('/alerts/events', { query: { limit: ALERT_LIMIT } }),
  live: ({ events, mutate }) =>
    events.subscribe('alert.fired', (fired) =>
      mutate((list) =>
        [fired, ...(list ?? []).filter((e) => e.id !== fired.id)].slice(0, ALERT_LIMIT),
      ),
    ),
};

/** 최근 분석 20건(진행 중인 분석, 분석 결과 칸의 "가장 최근"과 고르기 목록). */
export const analysesSource: Source<AnalysisItem[]> = {
  key: '/analyses?limit=20',
  load: (api) => api.request<AnalysisItem[]>('/analyses', { query: { limit: 20 } }),
  live: ({ events, get, mutate, reload }) =>
    events.subscribe('analysis.status', (event) => {
      if (get()?.some((a) => a.id === event.id)) {
        mutate((items) =>
          items?.map((a) => (a.id === event.id ? { ...a, status: event.status } : a)),
        );
        if (event.status === 'done') reload(); // 결정·요약이 생겼다
      } else {
        reload(); // 새 분석: 종목 이름이 필요하다
      }
    }),
};

export const activeOf = (items: AnalysisItem[] | undefined) =>
  items?.filter((a) => isActiveStatus(a.status));

const detailSources = new Map<number, Source<AnalysisDetail>>();
export function analysisSource(id: number): Source<AnalysisDetail> {
  let s = detailSources.get(id);
  if (!s) {
    s = { key: `/analyses/${id}`, load: (api) => api.request<AnalysisDetail>(`/analyses/${id}`) };
    detailSources.set(id, s);
  }
  return s;
}

/** 일반 설정(폴링 간격, 브리핑 켜기·시각). */
export const settingsSource: Source<Record<string, unknown>> = {
  key: '/settings',
  load: (api) => api.request<Record<string, unknown>>('/settings'),
};

/** 보유 평가(종목별 평가금액·손익, 통화별 합계, 환율). 시세는 사이드카가 쓰는 한투 시세다. */
export const portfolioSummarySource: Source<PortfolioSummary> = {
  key: '/portfolio/summary',
  load: (api) => api.request<PortfolioSummary>('/portfolio/summary'),
};

export type HistoryRange = '1m' | '3m' | '1y' | 'all';
export type HistoryView = 'all' | 'krw' | 'usd';

/** 자산 추이: 기간·보기마다 따로 불러온다. */
const historySources = new Map<string, Source<HistoryPoint[]>>();
export function historySource(range: HistoryRange, view: HistoryView): Source<HistoryPoint[]> {
  const key = `/portfolio/history?range=${range}&view=${view}`;
  let s = historySources.get(key);
  if (!s) {
    s = {
      key,
      load: (api) => api.request<HistoryPoint[]>('/portfolio/history', { query: { range, view } }),
    };
    historySources.set(key, s);
  }
  return s;
}
