/**
 * 사이드카 흉내(MSW)의 기본 자료. 테스트와 개발용 견본 화면(mock.html)이 함께 쓴다.
 * 시세와 문장은 모두 예시 데이터다. 형식은 OpenAPI 타입(src/api/types.ts)을 따른다.
 */
import type {
  AlertEvent,
  AlertKindInfo,
  AlertRule,
  AnalysisDetail,
  AnalysisItem,
  BriefingDetail,
  CheckOut,
  MonitorStatus,
  SymbolOut,
  WatchItem,
  WatchQuote,
} from '../api/types';

export const watchItems: WatchItem[] = [
  {
    id: 1,
    market: 'KR',
    code: '005930',
    exchange: 'KOSPI',
    name: '삼성전자',
    created_at: '2026-11-02T09:00:00+09:00',
  },
  {
    id: 2,
    market: 'KR',
    code: '000660',
    exchange: 'KOSPI',
    name: 'SK하이닉스',
    created_at: '2026-11-02T09:01:00+09:00',
  },
  {
    id: 3,
    market: 'US',
    code: 'AAPL',
    exchange: 'NAS',
    name: '애플',
    created_at: '2026-11-02T09:02:00+09:00',
  },
];

export const watchQuotes: WatchQuote[] = [
  {
    watchlist_id: 1,
    market: 'KR',
    code: '005930',
    name: '삼성전자',
    price: 71400,
    change: 1200,
    change_pct: 1.71,
    at: '2026-11-03T14:32:05+09:00',
    feed: 'realtime',
    source: 'realtime',
  },
  {
    watchlist_id: 2,
    market: 'KR',
    code: '000660',
    name: 'SK하이닉스',
    price: 198500,
    change: -3300,
    change_pct: -1.63,
    at: '2026-11-03T14:32:01+09:00',
    feed: 'polling',
    source: 'polling',
  },
  {
    watchlist_id: 3,
    market: 'US',
    code: 'AAPL',
    name: '애플',
    price: 227.48,
    change: 2.13,
    change_pct: 0.95,
    at: '2026-11-03T06:00:00+09:00',
    feed: 'closed',
    source: 'rest',
  },
];

export const monitorStatus: MonitorStatus = {
  state: 'running',
  realtime: 1,
  polling: 1,
  markets: { KR: 'open', US: 'closed' },
  feeds: [
    { market: 'KR', code: '005930', feed: 'realtime' },
    { market: 'KR', code: '000660', feed: 'polling' },
    { market: 'US', code: 'AAPL', feed: 'closed' },
  ],
};

export const alertEvents: AlertEvent[] = [
  {
    id: 12,
    rule_id: 4,
    fired_at: '2026-11-03T13:58:10+09:00',
    value: 71400,
    message: '삼성전자 현재가 71,400 — 목표가 71,000 이상',
    market: 'KR',
    code: '005930',
    name: '삼성전자',
    kind: 'price_above',
  },
  {
    id: 11,
    rule_id: null,
    fired_at: '2026-11-03T13:05:00+09:00',
    value: null,
    message: 'AI 분석 완료: 삼성전자 — 비중확대',
    market: null,
    code: null,
    name: null,
    kind: null,
  },
  {
    id: 10,
    rule_id: 6,
    fired_at: '2026-11-02T16:10:00+09:00',
    value: 72.4,
    message: 'SK하이닉스 RSI(14) 72.4 — 과매수 진입',
    market: 'KR',
    code: '000660',
    name: 'SK하이닉스',
    kind: 'rsi',
  },
];

export const alertKinds: AlertKindInfo[] = [
  { kind: 'price_above', params: {}, required: ['price'], timing: 'realtime' },
  { kind: 'price_below', params: {}, required: ['price'], timing: 'realtime' },
  { kind: 'change_pct', params: { pct: 5, direction: 'both' }, required: [], timing: 'realtime' },
  {
    kind: 'ma_cross',
    params: { fast: 5, slow: 20, direction: 'golden' },
    required: [],
    timing: 'close',
  },
  { kind: 'ma_break', params: { period: 20, direction: 'above' }, required: [], timing: 'close' },
  {
    kind: 'rsi',
    params: { period: 14, upper: 70, lower: 30, direction: 'overbought' },
    required: [],
    timing: 'close',
  },
  {
    kind: 'macd_cross',
    params: { fast: 12, slow: 26, signal: 9, direction: 'golden' },
    required: [],
    timing: 'close',
  },
  {
    kind: 'bollinger',
    params: { period: 20, k: 2, direction: 'upper' },
    required: [],
    timing: 'close',
  },
  { kind: 'volume_spike', params: { period: 20, multiple: 3 }, required: [], timing: 'realtime' },
  { kind: 'new_high_low', params: { direction: 'high' }, required: [], timing: 'realtime' },
];

export const alertRules: AlertRule[] = [
  {
    id: 4,
    watchlist_id: 1,
    kind: 'price_above',
    params: { price: 71000 },
    timing: 'realtime',
    enabled: true,
    last_state: true,
    last_fired_at: '2026-11-03T13:58:10+09:00',
  },
  {
    id: 5,
    watchlist_id: 1,
    kind: 'ma_cross',
    params: { fast: 5, slow: 20, direction: 'golden' },
    timing: 'close',
    enabled: false,
    last_state: false,
    last_fired_at: null,
  },
  {
    id: 6,
    watchlist_id: 2,
    kind: 'rsi',
    params: { period: 14, upper: 70, lower: 30, direction: 'overbought' },
    timing: 'close',
    enabled: true,
    last_state: true,
    last_fired_at: '2026-11-02T16:10:00+09:00',
  },
];

export const symbols: SymbolOut[] = [
  {
    market: 'KR',
    code: '005930',
    exchange: 'KOSPI',
    kind: 'stock',
    name: '삼성전자',
    name_en: 'SAMSUNG ELECTRONICS',
  },
  {
    market: 'KR',
    code: '005935',
    exchange: 'KOSPI',
    kind: 'stock',
    name: '삼성전자우',
    name_en: null,
  },
  {
    market: 'KR',
    code: '035420',
    exchange: 'KOSPI',
    kind: 'stock',
    name: 'NAVER',
    name_en: 'NAVER',
  },
  { market: 'US', code: 'AAPL', exchange: 'NAS', kind: 'stock', name: '애플', name_en: 'Apple' },
  {
    market: 'US',
    code: 'NVDA',
    exchange: 'NAS',
    kind: 'stock',
    name: '엔비디아',
    name_en: 'NVIDIA',
  },
];

const reports = {
  market_report: 'Market analysis: price is above the 50-day moving average. (예시)',
  sentiment_report: '',
  news_report: 'News: memory prices recovered in the third quarter. (예시)',
  fundamentals_report: 'Fundamentals: operating margin improved year over year. (예시)',
  investment_plan: '강세 측 근거가 우세합니다. 메모리 업황 회복이 핵심입니다. (예시)',
  trader_investment_plan: '분할 접근을 제안합니다. (예시)',
  final_trade_decision: '최종 의견: 비중확대. 6개월 목표가 82,000원. (예시)',
};

export const analysisDone: AnalysisDetail = {
  id: 7,
  market: 'KR',
  code: '005930',
  name: '삼성전자',
  as_of: '2026-11-03',
  preset: 'cloud',
  status: 'done',
  decision: 'Overweight',
  decision_ko: '비중확대',
  decision_changed: true,
  created_at: '2026-11-03T12:41:00+09:00',
  models: {
    deep: { provider: 'google', model: 'gemini-3-pro' },
    quick: { provider: 'google', model: 'gemini-3-flash' },
  },
  summary: [
    'HBM 출하 확대로 메모리 실적 회복이 이어질 것으로 봅니다. (예시)',
    '파운드리 적자 축소가 아직 확인되지 않아 상단을 제한합니다. (예시)',
    '외국인 순매수 전환은 단기 수급에 우호적입니다. (예시)',
  ],
  price_target: '82,000원',
  time_horizon: '6개월',
  reports,
  timings: { analysts: 412.4, research: 188.1, trader: 61.0, risk: 240.7, portfolio: 52.3 },
  tokens: { in: 182340, out: 24120 },
  error: null,
};

export const analysisFailed: AnalysisDetail = {
  ...analysisDone,
  id: 6,
  code: 'AAPL',
  market: 'US',
  name: '애플',
  status: 'failed',
  decision: null,
  decision_ko: null,
  decision_changed: false,
  summary: null,
  price_target: null,
  time_horizon: null,
  reports: null,
  timings: { analysts: 120.2 },
  tokens: { in: 40210, out: 3120 },
  error: {
    code: 'LLM_RATE_LIMITED',
    message: '클라우드 AI 호출 한도를 넘었습니다.',
    hint: '잠시 뒤 [다시 시도]를 누르면 끝난 단계는 건너뜁니다.',
  },
  created_at: '2026-11-02T20:10:00+09:00',
};

function itemOf(d: AnalysisDetail): AnalysisItem {
  return {
    id: d.id,
    market: d.market,
    code: d.code,
    name: d.name,
    as_of: d.as_of,
    preset: d.preset,
    status: d.status,
    decision: d.decision,
    decision_ko: d.decision_ko,
    decision_changed: d.decision_changed,
    created_at: d.created_at,
  };
}

export const analysisDetails: AnalysisDetail[] = [analysisDone, analysisFailed];
export const analysisItems: AnalysisItem[] = analysisDetails.map(itemOf);

export const llmCheck: CheckOut = {
  ok: true,
  preset: 'cloud',
  deep: { provider: 'google', model: 'gemini-3-pro' },
  quick: { provider: 'google', model: 'gemini-3-flash' },
  offloaded: null,
};

export const settings: Record<string, unknown> = {
  'general.autostart': true,
  'general.close_to_tray': true,
  'kis.server': 'prod',
  'llm.preset': 'cloud',
  'llm.cloud_provider': 'google',
  'analysis.debate_rounds': 1,
  'alerts.poll_interval_sec': 30,
  'briefing.kr.enabled': true,
  'briefing.kr.time': '16:00',
  'briefing.us.enabled': true,
  'briefing.us.time': '07:00',
};

export const secrets: Record<string, boolean> = {
  KIS_APP_KEY: true,
  KIS_APP_SECRET: true,
  KIS_HTS_ID: true,
  GOOGLE_API_KEY: true,
};

function closes(start: number, steps: number[]): { day: string; close: number }[] {
  let value = start;
  return steps.map((step, i) => {
    value = Math.round((value + step) * 100) / 100;
    return { day: `2026-10-${String(i + 1).padStart(2, '0')}`, close: value };
  });
}

const krSteps = [5, -12, 8, 14, -3, 6, -9, 11, 4, -2, 7, 13, -6, 2, 9, -4, 10, 3, -8, 12, 5, 21];
const kqSteps = [2, -4, 3, -5, 1, -2, 4, -3, -1, 2, -6, 3, -2, -4, 1, 2, -3, -1, 2, -4, 1, -4];

export const briefingKr: BriefingDetail = {
  id: 21,
  market: 'KR',
  date: '2026-11-02',
  status: 'done',
  missing: [],
  created_at: '2026-11-02T16:00:40+09:00',
  headline: '반도체 대형주가 지수를 끌어올렸고, 외국인이 사흘 만에 순매수로 돌아섰습니다. (예시)',
  text: {
    headline: '반도체 대형주가 지수를 끌어올렸고, 외국인이 사흘 만에 순매수로 돌아섰습니다. (예시)',
    market: '코스피는 장 초반 약세를 딛고 오름세로 마감했습니다. (예시)',
    sectors: '전기전자 업종이 가장 강했습니다. (예시)',
    flows: '외국인은 반도체를 중심으로 샀습니다. (예시)',
    notable: '거래대금 상위는 대형주가 차지했습니다. (예시)',
    watchlist: '감시 종목은 대체로 올랐습니다. (예시)',
  },
  data: {
    market: 'KR',
    session: '2026-11-02',
    indices: [
      {
        code: '0001',
        name: '코스피',
        value: 2583.27,
        change: 21.48,
        change_pct: 0.84,
        closes: closes(2490, krSteps),
      },
      {
        code: '1001',
        name: '코스닥',
        value: 742.15,
        change: -4.12,
        change_pct: -0.55,
        closes: closes(760, kqSteps),
      },
    ],
  },
};

export const briefingUs: BriefingDetail = {
  id: 20,
  market: 'US',
  date: '2026-11-02',
  status: 'partial',
  missing: ['sectors'],
  created_at: '2026-11-03T07:00:30+09:00',
  headline: '기술주가 쉬어 가며 나스닥이 소폭 내렸습니다. (예시)',
  text: null,
  data: {
    market: 'US',
    session: '2026-11-02',
    indices: [
      {
        code: 'SPX',
        name: 'S&P500',
        value: 5871.2,
        change: -8.4,
        change_pct: -0.14,
        closes: closes(5800, krSteps),
      },
      {
        code: 'COMP',
        name: '나스닥 종합',
        value: 18712.6,
        change: -61.3,
        change_pct: -0.33,
        closes: closes(
          18650,
          kqSteps.map((s) => s * 10),
        ),
      },
    ],
  },
};
