import type { MetricId } from '../layout/mins';
import { MetricTile } from './metrics';
import styles from './KpiStrip.module.css';

/** 맨 위 숫자 줄: 숫자 카드 최대 5개. 높이는 layout/geometry.ts CHROME.kpi와 같다. */
export function KpiStrip({ items }: { items: MetricId[] }) {
  if (items.length === 0) return null;
  return (
    <div className={styles.strip} role="group" aria-label="맨 위 숫자 줄">
      {items.map((id) => (
        <MetricTile key={id} id={id} />
      ))}
    </div>
  );
}
