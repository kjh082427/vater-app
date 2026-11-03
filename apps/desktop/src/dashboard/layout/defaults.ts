/** 기본 대시보드(대시보드 설계 1장): 처음 설치했을 때와, 저장된 문서를 읽지 못했을 때. */
import { templateRoot } from './templates';
import type { DashboardDoc, DashboardsDoc } from './types';

export const DEFAULT_KPI = ['kospi', 'kosdaq', 'watch-count', 'alerts-today', 'analyses-running'];

export function defaultDashboard(id: string, name = '기본'): DashboardDoc {
  return {
    id,
    name,
    kpi: { enabled: true, items: [...DEFAULT_KPI] },
    layout: { template: 'grid-2x2', root: templateRoot('grid-2x2') },
    panels: [
      { type: 'index-chart', options: { index: 'KOSPI' } },
      { type: 'briefing', options: { market: 'KR' } },
      { type: 'watchlist', options: { market: 'all' } },
      { type: 'recent-alerts', options: {} },
    ],
  };
}

export const DEFAULT_DOC: DashboardsDoc = { version: 1, dashboards: [defaultDashboard('home')] };

export const defaultDoc = (): DashboardsDoc => structuredClone(DEFAULT_DOC);
