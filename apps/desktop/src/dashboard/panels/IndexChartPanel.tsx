import {
  directionOf,
  formatNumber,
  LineChart,
  SignedNumber,
  VisuallyHidden,
} from '../../design-system';
import { MissingValue } from '../../screens/common/quotes';
import { formatHm } from '../../screens/common/time';
import { useShared } from '../shared';
import { indicesSource, type IndexQuote } from '../sources';
import { PanelEmpty, PanelError, styles } from './common';
import { pick, type PanelProps } from './types';

export const INDEX_CODES = ['KOSPI', 'KOSDAQ', 'SPX', 'COMP'] as const;
export type IndexCode = (typeof INDEX_CODES)[number];
export const INDEX_LABEL: Record<IndexCode, string> = {
  KOSPI: '코스피',
  KOSDAQ: '코스닥',
  SPX: 'S&P 500',
  COMP: '나스닥',
};

const fmt = (n: number) => formatNumber(n, 2);

/**
 * 최근 30거래일 종가 + 오늘 값. 장이 없는 시간(주말·휴장·장 전)에는 마지막 종가와 value가 같은 날이라
 * 점을 하나만 둔다. 기준선(전일 종가)은 오늘 값 바로 앞의 종가다.
 */
export function chartSeries(q: IndexQuote): { values: number[]; baseline?: number } {
  const closes = q.closes.filter((n) => Number.isFinite(n));
  const last = closes[closes.length - 1];
  if (q.value === null || !Number.isFinite(q.value)) return { values: closes };
  if (last !== undefined && last === q.value) {
    return { values: closes, baseline: closes[closes.length - 2] };
  }
  return { values: [...closes, q.value], baseline: last };
}

function labelsFor(n: number): string[] {
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? '최근' : `${n - 1 - i}거래일 전`));
}

/** 지수 차트: 값·전일 대비·등락률과 선 차트(방향 색, 전일 종가 점선). */
export function IndexChartPanel({ options }: PanelProps) {
  const code = pick(options, 'index', INDEX_CODES, 'KOSPI');
  const indices = useShared(indicesSource);
  if (indices.error) {
    return (
      <PanelError
        error={indices.error}
        title="지수를 불러오지 못했습니다"
        onRetry={indices.reload}
      />
    );
  }
  if (!indices.data) return <div className={styles.body} aria-busy="true" />;
  const q = indices.data.find((x) => x.code === code);
  if (!q) return <PanelEmpty>{`${INDEX_LABEL[code]} 자료가 없습니다.`}</PanelEmpty>;
  const { values, baseline } = chartSeries(q);
  return (
    <div className={styles.body}>
      <div className={styles.bar}>
        <b className={`${styles.big} vt-num`}>
          {q.value === null ? <MissingValue /> : fmt(q.value)}
        </b>
        <span className={`${styles.change} vt-num`}>
          <SignedNumber value={q.change} format="number" decimals={2} />
          <SignedNumber value={q.change_pct} format="percent" />
        </span>
        {q.at ? <span className={styles.itemMeta}>{`${formatHm(q.at)} 기준`}</span> : null}
      </div>
      {values.length > 1 ? (
        <LineChart
          className={styles.fill}
          values={values}
          labels={labelsFor(values.length)}
          baseline={baseline}
          direction={directionOf(q.change)}
          format={fmt}
          aria-label={`${q.name} 최근 30거래일 종가와 오늘 값`}
        />
      ) : (
        <PanelEmpty>
          <span aria-hidden="true">데이터 없음</span>
          <VisuallyHidden>{`${q.name} 차트 데이터 없음`}</VisuallyHidden>
        </PanelEmpty>
      )}
    </div>
  );
}
