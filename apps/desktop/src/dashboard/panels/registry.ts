/** 칸 내용 목록(대시보드 설계 3장): 내용 1가지 = 컴포넌트 + 최소 크기 + 옵션. */
import { MAX_PANEL_METRICS, PANEL_MINS } from '../layout/mins';
import { AlertHistoryPanel, KIND_CHOICES, useSymbolChoices } from './AlertHistoryPanel';
import {
  AssetTrendPanel,
  TREND_RANGE_LABEL,
  TREND_RANGES,
  TREND_VIEW_LABEL,
  TREND_VIEWS,
} from './AssetTrendPanel';
import { HoldingsPanel } from './HoldingsPanel';
import { AnalysisResultPanel, useAnalysisChoices } from './AnalysisResultPanel';
import { BRIEF_MARKETS, BriefingPanel, MARKET_NAME } from './BriefingPanel';
import { INDEX_CODES, INDEX_LABEL, IndexChartPanel } from './IndexChartPanel';
import { DEFAULT_PANEL_METRICS, KpiPanel } from './KpiPanel';
import { RecentAlertsPanel } from './RecentAlertsPanel';
import { RunningAnalysesPanel } from './RunningAnalysesPanel';
import { pick, type Choice, type PanelRegistry } from './types';
import { WATCH_MARKET_LABEL, WATCH_MARKETS, WatchlistPanel } from './WatchlistPanel';

const fixed = (choices: Choice[]) => () => choices;

export const PANELS: PanelRegistry = {
  watchlist: {
    label: '감시 종목',
    description: '현재가·등락·수신 상태 표',
    describe: (o) =>
      `현재가와 수신 상태 · ${WATCH_MARKET_LABEL[pick(o, 'market', WATCH_MARKETS, 'all')]}`,
    min: PANEL_MINS.watchlist,
    options: [
      {
        kind: 'select',
        key: 'market',
        label: '시장',
        default: 'all',
        useChoices: fixed(WATCH_MARKETS.map((m) => ({ value: m, label: WATCH_MARKET_LABEL[m] }))),
      },
    ],
    Component: WatchlistPanel,
  },
  'index-chart': {
    label: '지수 차트',
    description: '최근 30거래일 종가와 오늘 값',
    describe: (o) =>
      `${INDEX_LABEL[pick(o, 'index', INDEX_CODES, 'KOSPI')]} · 최근 30거래일 · 점선은 전일 종가`,
    min: PANEL_MINS['index-chart'],
    options: [
      {
        kind: 'select',
        key: 'index',
        label: '지수',
        default: 'KOSPI',
        useChoices: fixed(INDEX_CODES.map((c) => ({ value: c, label: INDEX_LABEL[c] }))),
      },
    ],
    Component: IndexChartPanel,
  },
  briefing: {
    label: '브리핑 요약',
    description: 'AI 한 문장과 수급·지수',
    describe: (o) => `${MARKET_NAME[pick(o, 'market', BRIEF_MARKETS, 'KR')]} 최신 브리핑`,
    min: PANEL_MINS.briefing,
    options: [
      {
        kind: 'select',
        key: 'market',
        label: '시장',
        default: 'KR',
        useChoices: fixed(BRIEF_MARKETS.map((m) => ({ value: m, label: MARKET_NAME[m] }))),
      },
    ],
    Component: BriefingPanel,
  },
  'recent-alerts': {
    label: '최근 알림',
    description: '새로 울린 알림 5~10건',
    min: PANEL_MINS['recent-alerts'],
    Component: RecentAlertsPanel,
  },
  'running-analyses': {
    label: '진행 중인 분석',
    description: '단계와 경과 시간',
    min: PANEL_MINS['running-analyses'],
    Component: RunningAnalysesPanel,
  },
  'analysis-result': {
    label: '분석 결과',
    description: '의견 눈금·3줄 요약·목표가',
    min: PANEL_MINS['analysis-result'],
    options: [
      {
        kind: 'select',
        key: 'analysis',
        label: '분석',
        default: 'latest',
        useChoices: useAnalysisChoices,
      },
    ],
    Component: AnalysisResultPanel,
  },
  'alert-history': {
    label: '알림 이력',
    description: '종목·종류로 거른 알림 목록',
    min: PANEL_MINS['alert-history'],
    options: [
      {
        kind: 'select',
        key: 'symbol',
        label: '종목',
        default: 'all',
        useChoices: useSymbolChoices,
      },
      {
        kind: 'select',
        key: 'kind',
        label: '종류',
        default: 'all',
        useChoices: fixed(KIND_CHOICES),
      },
    ],
    Component: AlertHistoryPanel,
  },
  holdings: {
    label: '내 보유 종목',
    description: '보유 수량·평단가·평가손익 표',
    min: PANEL_MINS.holdings,
    Component: HoldingsPanel,
  },
  'asset-trend': {
    label: '자산 추이',
    description: '주식 평가금액과 매입금액 두 선',
    describe: (o) =>
      `주식 평가금액(예수금 제외) · ${TREND_VIEW_LABEL[pick(o, 'view', TREND_VIEWS, 'all')]} 보기`,
    min: PANEL_MINS['asset-trend'],
    options: [
      {
        kind: 'select',
        key: 'view',
        label: '보기',
        default: 'all',
        useChoices: fixed(TREND_VIEWS.map((v) => ({ value: v, label: TREND_VIEW_LABEL[v] }))),
      },
      {
        kind: 'select',
        key: 'range',
        label: '기간',
        default: '3m',
        useChoices: fixed(TREND_RANGES.map((v) => ({ value: v, label: TREND_RANGE_LABEL[v] }))),
      },
    ],
    Component: AssetTrendPanel,
  },
  kpi: {
    label: '숫자 카드',
    description: '지수·건수를 큰 숫자로',
    min: PANEL_MINS.kpi,
    options: [
      {
        kind: 'metrics',
        key: 'metrics',
        label: '숫자',
        default: DEFAULT_PANEL_METRICS,
        max: MAX_PANEL_METRICS,
      },
    ],
    Component: KpiPanel,
  },
};

/** 목록에 보이지만 아직 고를 수 없는 내용. */
export const COMING_SOON = [
  { id: 'simulation', label: '시뮬레이션', description: '모의 투자 결과' },
];

export const panelDef = (type: string) =>
  Object.hasOwn(PANELS, type) ? PANELS[type as keyof typeof PANELS] : undefined;

/** 새로 고른 내용의 기본 옵션. */
export function defaultOptions(type: string): Record<string, unknown> {
  const def = panelDef(type);
  return Object.fromEntries((def?.options ?? []).map((o) => [o.key, o.default]));
}
