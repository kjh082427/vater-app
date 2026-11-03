import { Toggle } from '../../design-system';
import { isMetricId, MAX_STRIP_METRICS } from '../layout/mins';
import type { DashboardDoc } from '../layout/types';
import { METRICS } from '../panels/metrics';
import { MetricChecklist } from './MetricChecklist';
import styles from './editor.module.css';

/** ③ 맨 위 숫자 줄: 켜기·끄기와 숫자 고르기(최대 5개). */
export function KpiStripSettings({
  kpi,
  onChange,
}: {
  kpi: DashboardDoc['kpi'];
  onChange: (kpi: DashboardDoc['kpi']) => void;
}) {
  const items = kpi.items.filter(isMetricId);
  const summary =
    items.length > 2
      ? `${items
          .slice(0, 2)
          .map((id) => METRICS[id].label)
          .join(' · ')} 외 ${items.length - 2}개`
      : items.map((id) => METRICS[id].label).join(' · ') || '고른 숫자 없음';
  return (
    <div className={styles.step}>
      <h3 className={styles.stepTitle}>
        <span className={styles.stepNo} aria-hidden="true">
          3
        </span>
        맨 위 숫자 줄
      </h3>
      <Toggle
        label="숫자 카드 줄 보이기"
        checked={kpi.enabled}
        onChange={(enabled) => onChange({ ...kpi, enabled })}
      />
      <p className={styles.stepMeta}>{summary}</p>
      <MetricChecklist
        label="맨 위 숫자 줄에 보일 숫자"
        value={items}
        max={MAX_STRIP_METRICS}
        onChange={(next) => onChange({ ...kpi, items: next })}
      />
    </div>
  );
}
