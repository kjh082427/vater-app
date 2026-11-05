/**
 * 숫자 목록(대시보드 설계 3장): 맨 위 숫자 줄과 숫자 카드 칸이 같이 쓴다.
 * 숫자는 디자인 시스템 표기 함수만 쓰고, 빨강·파랑은 방향(SignedNumber, Sparkline)에만 쓴다.
 */
import type { ReactNode } from 'react';
import type { ApiError } from '../../api/errors';
import {
  directionOf,
  formatUsd,
  formatUsdChange,
  formatWon,
  formatWonChange,
  formatNumber,
  KpiTile,
  SignedNumber,
  Sparkline,
} from '../../design-system';
import { KIND_GROUP } from '../../screens/alerts/kinds';
import { parseFlows } from '../../screens/briefing/data';
import { MissingValue } from '../../screens/common/quotes';
import { formatDay, formatHm } from '../../screens/common/time';
import type { MetricId } from '../layout/mins';
import { useShared } from '../shared';
import {
  activeOf,
  alertEventsSource,
  analysesSource,
  briefingSource,
  indicesSource,
  portfolioSummarySource,
  quotesSource,
} from '../sources';
import type { PortfolioSummary } from '../../api/types';
import { chartSeries, type IndexCode } from './IndexChartPanel';
import { hasUnpriced, UNPRICED_NOTE } from './common';
import styles from './panels.module.css';

export interface MetricValue {
  value: ReactNode;
  change?: ReactNode;
  chart?: ReactNode;
  error?: ApiError | null;
}

const Unit = ({ children }: { children: string }) => (
  <small className={styles.unit}>{children}</small>
);
const Muted = ({ children }: { children: ReactNode }) => (
  <span className={styles.muted}>{children}</span>
);

function useIndex(code: IndexCode): MetricValue {
  const { data, error } = useShared(indicesSource);
  const q = data?.find((x) => x.code === code);
  if (!q || q.value === null) {
    return { value: <MissingValue />, change: data ? <Muted>데이터 없음</Muted> : null, error };
  }
  const { values } = chartSeries(q);
  return {
    value: formatNumber(q.value, 2),
    change: (
      <span className={styles.change}>
        <SignedNumber value={q.change} format="number" decimals={2} />
        <SignedNumber value={q.change_pct} format="percent" />
      </span>
    ),
    chart:
      values.length > 1 ? (
        <Sparkline
          values={values}
          direction={directionOf(q.change)}
          label={`${q.name} 최근 30거래일`}
          width={48}
          height={22}
        />
      ) : null,
    error,
  };
}

function useWatchCount(): MetricValue {
  const { data, error } = useShared(quotesSource);
  if (!data) return { value: <MissingValue />, error };
  const up = data.filter((r) => (r.change_pct ?? 0) > 0).length;
  const down = data.filter((r) => (r.change_pct ?? 0) < 0).length;
  return {
    value: (
      <>
        {formatNumber(data.length)}
        <Unit>종목</Unit>
      </>
    ),
    change: <Muted>{`상승 ${up} · 하락 ${down}`}</Muted>,
    error,
  };
}

const sameDay = (iso: string, now: Date) => {
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
};

function useAlertsToday(): MetricValue {
  const { data, error } = useShared(alertEventsSource);
  if (!data) return { value: <MissingValue />, error };
  const today = data.filter((e) => sameDay(e.fired_at, new Date()));
  const last = today[0];
  return {
    value: (
      <>
        {formatNumber(today.length)}
        <Unit>건</Unit>
      </>
    ),
    change: (
      <Muted>
        {last
          ? `마지막 ${formatHm(last.fired_at)} · ${last.kind ? (KIND_GROUP[last.kind] ?? '이벤트') : '이벤트'}`
          : '오늘 울린 알림 없음'}
      </Muted>
    ),
    error,
  };
}

function useAnalysesRunning(): MetricValue {
  const { data, error } = useShared(analysesSource);
  const active = activeOf(data);
  if (!active) return { value: <MissingValue />, error };
  const first = active[0];
  return {
    value: (
      <>
        {formatNumber(active.length)}
        <Unit>건</Unit>
      </>
    ),
    change: <Muted>{first ? (first.name ?? first.code) : '진행 중인 분석 없음'}</Muted>,
    error,
  };
}

function useForeignNet(): MetricValue {
  const { data, error } = useShared(briefingSource('KR'));
  const flow = data ? parseFlows(data.data)[0] : undefined;
  if (!data || !flow || flow.foreign === null) {
    return {
      value: <MissingValue />,
      change: data === null ? <Muted>국내 브리핑 없음</Muted> : null,
      error,
    };
  }
  return {
    value: <SignedNumber value={flow.foreign} format="eok" />,
    change: <Muted>{`${flow.label} · ${formatDay(data.date)}`}</Muted>,
    error,
  };
}

/** 합계에서 빠졌거나 믿기 어려운 부분을 문장으로(환율 없음, 시세 제외, 지원 안 함). */
function caveats(data: PortfolioSummary): string[] {
  return [
    ...(data.currencies.USD && data.total_krw === null ? ['환율 없음(원화만 합산)'] : []),
    ...(data.missing_prices > 0 ? [`시세 없는 ${data.missing_prices}종목 제외`] : []),
    ...(data.unsupported > 0 ? [`지원하지 않는 ${data.unsupported}종목 제외`] : []),
  ];
}

const noHoldings = (data: PortfolioSummary): MetricValue => ({
  value: <MissingValue />,
  change: (
    <Muted>
      {data.unsupported > 0 ? `지원하지 않는 ${data.unsupported}종목만 있습니다` : '보유 내역 없음'}
    </Muted>
  ),
});

/** 총 평가금액: 환율이 있으면 원화 환산 합계, 없으면 원화 합계만(달러는 따로). 통화별 값을 함께 보인다. */
function useTotalValue(): MetricValue {
  const { data, error } = useShared(portfolioSummarySource);
  if (!data) return { value: <MissingValue />, error };
  const krw = data.currencies.KRW;
  const usd = data.currencies.USD;
  if (!krw && !usd) return { ...noHoldings(data), error };
  const shown = data.total_krw !== null ? data.total_krw.value : krw?.value;
  const notes = caveats(data);
  const parts = [
    ...(krw && (usd || notes.length > 0) ? [`원화 ${formatWon(krw.value)}`] : []),
    ...(usd ? [`달러 ${formatUsd(usd.value)}`] : []),
    ...notes,
  ];
  return {
    value: shown === null || shown === undefined ? <MissingValue /> : formatWon(shown),
    change: <Muted>{parts.length > 0 ? parts.join(' · ') : '주식 평가금액'}</Muted>,
    error,
  };
}

/** 총 평가손익: 총 평가금액과 같은 기준(환산 또는 원화). 통화별 손익을 함께 보인다. */
function useTotalPl(): MetricValue {
  const { data, error } = useShared(portfolioSummarySource);
  if (!data) return { value: <MissingValue />, error };
  const krw = data.currencies.KRW;
  const usd = data.currencies.USD;
  if (!krw && !usd) return { ...noHoldings(data), error };
  const basis = data.total_krw ?? krw;
  const notes = [...caveats(data), ...(hasUnpriced(data.symbols) ? [UNPRICED_NOTE] : [])];
  const parts = [
    ...(krw && usd ? [`원화 ${formatWonChange(krw.pl, { unit: true })}`] : []),
    ...(usd ? [`달러 ${formatUsdChange(usd.pl)}`] : []),
    ...notes,
  ];
  return {
    value: <SignedNumber value={basis?.pl} format="won" unit />,
    change: (
      <span className={styles.change}>
        <SignedNumber value={basis?.pl_pct} format="percent" />
        {parts.length > 0 ? <Muted>{parts.join(' · ')}</Muted> : null}
      </span>
    ),
    error,
  };
}

export const METRICS: Record<MetricId, { label: string; use: () => MetricValue }> = {
  kospi: { label: '코스피', use: () => useIndex('KOSPI') },
  kosdaq: { label: '코스닥', use: () => useIndex('KOSDAQ') },
  spx: { label: 'S&P 500', use: () => useIndex('SPX') },
  comp: { label: '나스닥', use: () => useIndex('COMP') },
  'watch-count': { label: '감시 종목', use: useWatchCount },
  'alerts-today': { label: '오늘 알림', use: useAlertsToday },
  'analyses-running': { label: '진행 중인 분석', use: useAnalysesRunning },
  'foreign-net': { label: '외국인 순매수', use: useForeignNet },
  'total-value': { label: '총 평가금액', use: useTotalValue },
  'total-pl': { label: '총 평가손익', use: useTotalPl },
};

/** 숫자 카드 1개. id가 바뀌면 훅 순서가 바뀌므로 부모는 key={id}로 그린다. */
export function MetricTile({ id, className }: { id: MetricId; className?: string }) {
  const metric = METRICS[id];
  const v = metric.use();
  return (
    <KpiTile
      tag="neutral"
      label={metric.label}
      value={v.value}
      change={v.error ? <Muted>{v.error.message}</Muted> : v.change}
      chart={v.chart ?? undefined}
      className={className}
    />
  );
}
