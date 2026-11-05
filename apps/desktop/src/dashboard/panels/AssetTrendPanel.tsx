import { useState } from 'react';
import {
  directionOf,
  formatNumber,
  formatUsd,
  formatWon,
  LineChart,
  SegmentedControl,
} from '../../design-system';
import { formatDay } from '../../screens/common/time';
import { useShared } from '../shared';
import {
  historySource,
  portfolioSummarySource,
  type HistoryRange,
  type HistoryView,
} from '../sources';
import { PanelEmpty, PanelError, styles } from './common';
import { pick, type PanelProps } from './types';

export const TREND_VIEWS = ['all', 'krw', 'usd'] as const;
export const TREND_VIEW_LABEL: Record<HistoryView, string> = {
  all: '전체',
  krw: '원화',
  usd: '달러',
};
export const TREND_RANGES = ['1m', '3m', '1y', 'all'] as const;
export const TREND_RANGE_LABEL: Record<HistoryRange, string> = {
  '1m': '1개월',
  '3m': '3개월',
  '1y': '1년',
  all: '전체',
};

/**
 * 자산 추이(스펙 12장): 주식 평가금액과 매입금액 두 선. 주식을 더 사도 평가금액이 오르므로 매입금액을
 * 함께 긋는다. 전체 보기는 그날 환율로 환산해 더하므로 적용 환율과 미국 비중을 보인다. 예수금은 넣지 않는다.
 */
export function AssetTrendPanel({ options }: PanelProps) {
  const [view, setView] = useState<HistoryView>(pick(options, 'view', TREND_VIEWS, 'all'));
  const [range, setRange] = useState<HistoryRange>(pick(options, 'range', TREND_RANGES, '3m'));
  const history = useShared(historySource(range, view));
  const summary = useShared(portfolioSummarySource);

  const controls = (
    <div className={styles.controls}>
      <SegmentedControl
        label="보기"
        size="sm"
        value={view}
        options={TREND_VIEWS.map((v) => ({ value: v, label: TREND_VIEW_LABEL[v] }))}
        onChange={setView}
      />
      <SegmentedControl
        label="기간"
        size="sm"
        value={range}
        options={TREND_RANGES.map((v) => ({ value: v, label: TREND_RANGE_LABEL[v] }))}
        onChange={setRange}
      />
    </div>
  );

  if (history.error) {
    return (
      <div className={styles.body}>
        {controls}
        <PanelError
          error={history.error}
          title="자산 추이를 불러오지 못했습니다"
          onRetry={history.reload}
        />
      </div>
    );
  }
  const points = history.data;
  if (!points) return <div className={styles.body} aria-busy="true" />;
  if (points.length === 0) {
    return (
      <div className={styles.body}>
        {controls}
        <PanelEmpty>
          아직 기록이 없습니다. 장 마감 뒤 종가로 하루 한 번 기록하며, 첫 연결 이후부터 쌓입니다.
          과거 추이는 복원하지 않습니다.
        </PanelEmpty>
      </div>
    );
  }

  const last = points[points.length - 1];
  const format = view === 'usd' ? formatUsd : formatWon;
  const filled = points.flatMap((p, i) => (p.backfilled ? [i] : []));
  const usd = summary.data?.currencies.USD;
  const total = summary.data?.total_krw;
  const rate = summary.data?.usdkrw ?? null;
  // 마지막 날만이 아니라 표시 기간 어디든 환율이 없어 비어 있는 날이 있으면 알린다
  const rateMissing = view === 'all' && points.some((p) => p.value === null && p.usdkrw === null);
  const share =
    view === 'all' && usd?.value && total?.value && rate
      ? ((usd.value * rate) / total.value) * 100
      : null;
  const diff =
    last?.value !== null && last?.value !== undefined && last.cost !== null
      ? last.value - last.cost
      : null;

  return (
    <div className={styles.body}>
      {controls}
      <LineChart
        className={styles.fill}
        values={points.map((p) => p.value)}
        secondary={points.map((p) => p.cost)}
        hollow={filled}
        labels={points.map((p) => formatDay(p.day))}
        direction={directionOf(diff)}
        format={format}
        aria-label={`주식 평가금액과 매입금액(${TREND_VIEW_LABEL[view]})`}
      />
      <div className={styles.legend}>
        <span>평가금액</span>
        <span>매입금액</span>
      </div>
      {rateMissing ? (
        <p className={`${styles.note} ${styles.holdCaution}`}>
          환율 없음: 전체(원화 환산) 보기를 계산하지 못했습니다. 원화·달러 보기는 그대로 볼 수
          있습니다.
        </p>
      ) : null}
      {share !== null && rate !== null ? (
        <p className={`${styles.note} vt-num`}>
          {`적용 환율 ${formatNumber(rate)}원 · 미국 비중 ${formatNumber(share, 1)}%`}
        </p>
      ) : null}
      {filled.length > 0 ? (
        <p className={styles.note}>
          {`채운 날 ${filled.length}일: 앱이 꺼져 있어 마지막 보유 수량과 그날 종가로 채웠습니다(속이 빈 점).`}
        </p>
      ) : null}
    </div>
  );
}
