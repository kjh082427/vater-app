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
  /** stage: analysts → research → trader → risk → portfolio (그 밖은 other) */
  'analysis.progress': { id: number; stage: string; node: string; elapsed_sec: number };
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
  'briefing.status',
  'llm.pull',
  'llm.install',
];
