import { useState } from 'react';
import { useResource } from '../../api/useResource';
import type { Bar } from '../../api/types';
import { formatPrice, LineChart, SegmentedControl } from '../../design-system';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { currencyOf } from '../common/quotes';
import { formatDay } from '../common/time';
import styles from './holdings.module.css';

type Range = '1m' | '3m' | '1y';
const RANGES: { value: Range; label: string }[] = [
  { value: '1m', label: '1개월' },
  { value: '3m', label: '3개월' },
  { value: '1y', label: '1년' },
];

export interface PriceChartProps {
  market: string;
  code: string;
  name: string;
  /** 보유 중이면 내 평단가(점선). 보유하지 않으면 없다. */
  avgPrice: number | null;
}

/** 일봉 종가 선 그래프(스펙 4-4). 선 색은 기간 처음과 끝의 방향, 보유 중이면 평단가를 점선으로 긋는다. */
export function PriceChart({ market, code, name, avgPrice }: PriceChartProps) {
  const [range, setRange] = useState<Range>('3m');
  const bars = useResource<Bar[]>(`/symbols/${market}/${code}/bars?range=${range}`, (api) =>
    api.request<Bar[]>(`/symbols/${market}/${code}/bars`, { query: { range } }),
  );
  const currency = currencyOf(market);
  const data = bars.data;
  const first = data?.[0]?.close;
  const last = data?.[data.length - 1]?.close;
  const direction =
    first === undefined || last === undefined || first === last
      ? 'flat'
      : last > first
        ? 'up'
        : 'down';

  return (
    <div className={styles.chart}>
      <div className={styles.chartHead}>
        <SegmentedControl
          label="기간"
          size="sm"
          value={range}
          options={RANGES}
          onChange={setRange}
        />
      </div>
      {bars.error ? (
        <ApiErrorNotice
          error={bars.error}
          title="일봉을 불러오지 못했습니다"
          onRetry={bars.reload}
        />
      ) : null}
      {data && data.length === 0 ? (
        <p className={styles.empty}>
          이 기간의 일봉 자료가 없습니다. 상장한 지 얼마 안 됐거나 시세를 받지 못한 종목일 수
          있습니다.
        </p>
      ) : null}
      {data && data.length > 0 ? (
        <LineChart
          values={data.map((b) => b.close)}
          labels={data.map((b) => formatDay(b.day))}
          baseline={avgPrice ?? undefined}
          direction={direction}
          format={(n) => formatPrice(n, currency)}
          height={180}
          aria-label={`${name} 일봉 종가${avgPrice !== null ? ', 점선은 내 평단가' : ''}`}
        />
      ) : null}
    </div>
  );
}
