/**
 * 사이드카 API 형식. REST 형식은 OpenAPI 명세에서 만든 schema.d.ts(npm run gen:api)에서 가져오고,
 * SSE 이벤트 형식(명세에 없음)은 sidecar/README.md의 이벤트 표를 옮겨 여기 적는다.
 */
import type { components } from './schema';

type S = components['schemas'];

export type ErrorBody = S['ErrorBody'];
export type Health = S['Health'];
export type SymbolOut = S['SymbolOut'];
export type WatchItem = S['WatchItemOut'];
export type WatchQuote = S['WatchQuoteOut'];
export type FeedKind = WatchQuote['feed'];
export type AlertEvent = S['AlertEventOut'];
export type AlertKindInfo = S['KindInfo'];
export type AlertRule = S['RuleOut'];
export type RuleCreate = S['RuleCreate'];
export type RulePatch = S['RulePatch'];
export type RulePreviewIn = S['RulePreviewIn'];
export type RulePreviewOut = S['RulePreviewOut'];
export type MonitorStatus = S['MonitorStatus'];
export type MonitorState = MonitorStatus['state'];
export type MonitorStateOut = S['MonitorStateOut'];
export type AnalysisCreate = S['AnalysisCreate'];
export type AnalysisQueued = S['AnalysisQueued'];
export type AnalysisItem = S['AnalysisItem'];
export type AnalysisDetail = S['AnalysisDetail'];
export type BriefingItem = S['BriefingItem'];
export type BriefingDetail = S['BriefingDetail'];
export type CheckOut = S['CheckOut'];
export type CatalogOut = S['CatalogOut'];
export type CloudProvider = S['CloudProviderOut'];
export type LocalModel = S['LocalModelOut'];
export type HardwareOut = S['HardwareOut'];
export type OllamaStatus = S['OllamaStatusOut'];
export type KisTestResult = S['KisTestResult'];
export type CloudTestOut = S['CloudTestOut'];
export type PullStarted = S['PullStartedOut'];
export type BrokerOut = S['BrokerOut'];
export type ConnectionOut = S['ConnectionOut'];
export type ConnectionCreate = S['ConnectionCreate'];
export type HoldingOut = S['HoldingOut'];
export type SymbolHoldings = S['SymbolHoldings'];
export type BrokerShare = S['BrokerShare'];
export type ManualHolding = S['ManualHolding'];
export type ManualKey = S['ManualKey'];
export type CsvPreview = S['CsvPreview'];
export type CsvRow = S['CsvRowOut'];
export type CsvCommit = S['CsvCommit'];
export type WatchRequest = S['WatchRequest'];
export type WatchResult = S['WatchResult'];
export type SyncResult = S['SyncResultOut'];
export type PortfolioSummary = S['PortfolioSummary'];
export type SymbolValue = S['SymbolValue'];
export type Totals = S['Totals'];
export type HistoryPoint = S['HistoryPoint'];
export type Fx = S['FxOut'];
export type Bar = S['BarOut'];
export type CategoryGroup = S['GroupOut'];
export type CategoryStock = S['CategoryStockOut'];
export type CategorySearch = S['CategorySearchOut'];
export type MyAssets = S['MyAssets'];

export type MarketCode = 'KR' | 'US';

/** 분석 상태(스펙 5장): queued → running → done | failed | cancelled. */
export type AnalysisStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** SSE 이벤트별 data 형식(sidecar/README.md). */
export interface EventMap {
  /** 발생한 알림. GET /alerts/events의 항목과 같다. */
  'alert.fired': AlertEvent;
  /** 감시 상태. GET /alerts/status와 같다. */
  'alerts.state': MonitorStatus;
  /** 감시 종목 시세 갱신(종목당 1초 1번). */
  quote: {
    market: string;
    code: string;
    price: number | null;
    change: number | null;
    change_pct: number | null;
    at: string | null;
    source: 'realtime' | 'polling' | 'rest' | null;
  };
  'analysis.status': {
    id: number;
    status: AnalysisStatus;
    decision?: string | null;
    error?: ErrorBody | null;
  };
  /**
   * stage: analysts → research → trader → risk → portfolio (그 밖은 other).
   * wait: 구글 AI 혼잡(busy)·분당 한도(rate)로 기다리는 동안만 온다(v2 설계 20장).
   */
  'analysis.progress': {
    id: number;
    stage: string;
    node: string;
    elapsed_sec: number;
    wait?: { reason: 'busy' | 'rate'; message: string; seconds: number } | null;
  };
  /** 지운 분석(21장). 이 id의 목록 줄과 상세는 버린다. */
  'analysis.deleted': { ids: number[] };
  'briefing.status': {
    market: MarketCode;
    date: string;
    status: 'running' | 'done' | 'partial' | 'failed';
    id?: number;
    error?: ErrorBody | null;
  };
  /** 모델 받기 진행. status가 done이면 variant, error면 code·message·hint. */
  'llm.pull': {
    tag: string;
    status: string;
    completed?: number | null;
    total?: number | null;
    percent?: number | null;
    variant?: string;
    code?: string;
    message?: string;
    hint?: string | null;
  };
  /** Ollama 설치 진행. error면 code·message. */
  'llm.install': {
    stage: 'download' | 'verify' | 'launch' | 'waiting' | 'done' | 'error';
    code?: string;
    message?: string;
    hint?: string | null;
  };
}

export type EventType = keyof EventMap;

export const EVENT_TYPES: readonly EventType[] = [
  'alert.fired',
  'alerts.state',
  'quote',
  'analysis.status',
  'analysis.progress',
  'analysis.deleted',
  'briefing.status',
  'llm.pull',
  'llm.install',
];
