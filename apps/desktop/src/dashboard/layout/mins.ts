/**
 * 내용마다 최소 크기(CSS 픽셀, 1배율, 카드 바깥 크기). 칸 내용 목록(panels/registry.ts)과
 * 배치 엔진이 같이 쓴다. 대시보드 설계 3장의 표 그대로다.
 */
import type { Size } from './types';

export const PANEL_MINS = {
  watchlist: { w: 360, h: 180 },
  'index-chart': { w: 300, h: 180 },
  briefing: { w: 300, h: 180 },
  'recent-alerts': { w: 280, h: 160 },
  'running-analyses': { w: 280, h: 140 },
  'analysis-result': { w: 360, h: 240 },
  'alert-history': { w: 360, h: 220 },
  holdings: { w: 360, h: 200 },
  'asset-trend': { w: 360, h: 240 },
  kpi: { w: 260, h: 96 },
} as const satisfies Record<string, Size>;

export type PanelType = keyof typeof PANEL_MINS;

/** 빈칸·모르는 내용의 최소 크기: 안내 한 줄과 [내용 바꾸기]가 들어갈 만큼. */
export const FALLBACK_MIN: Size = { w: 200, h: 120 };

export function minOf(type: string): Size {
  return (PANEL_MINS as Record<string, Size>)[type] ?? FALLBACK_MIN;
}

/** 숫자 id(맨 위 숫자 줄과 숫자 카드 칸이 같이 쓴다). 뜻과 자료는 panels/metrics.tsx. */
export const METRIC_IDS = [
  'kospi',
  'kosdaq',
  'spx',
  'comp',
  'watch-count',
  'alerts-today',
  'analyses-running',
  'foreign-net',
  'total-value',
  'total-pl',
] as const;

export type MetricId = (typeof METRIC_IDS)[number];

export const isMetricId = (v: unknown): v is MetricId =>
  typeof v === 'string' && (METRIC_IDS as readonly string[]).includes(v);

/** 맨 위 숫자 줄의 숫자는 최대 5개, 숫자 카드 칸은 1~4개. */
export const MAX_STRIP_METRICS = 5;
export const MAX_PANEL_METRICS = 4;
