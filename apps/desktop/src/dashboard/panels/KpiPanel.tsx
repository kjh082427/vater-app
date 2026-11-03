import { isMetricId, MAX_PANEL_METRICS, type MetricId } from '../layout/mins';
import { MetricTile } from './metrics';
import styles from './panels.module.css';
import type { PanelProps } from './types';

export const DEFAULT_PANEL_METRICS: MetricId[] = ['kospi', 'kosdaq'];

export function metricsOf(options: Record<string, unknown>): MetricId[] {
  const raw = Array.isArray(options.metrics) ? options.metrics.filter(isMetricId) : [];
  const list = [...new Set(raw)].slice(0, MAX_PANEL_METRICS);
  return list.length > 0 ? list : DEFAULT_PANEL_METRICS;
}

/** 숫자 카드: 고른 숫자 1~4개를 큰 숫자로. 칸이 이미 카드라 숫자는 카드 없이 선으로 나눈다. */
export function KpiPanel({ options }: PanelProps) {
  return (
    <div className={`${styles.body} ${styles.kpis}`}>
      {metricsOf(options).map((id) => (
        <MetricTile key={id} id={id} className={styles.flatTile} />
      ))}
    </div>
  );
}
