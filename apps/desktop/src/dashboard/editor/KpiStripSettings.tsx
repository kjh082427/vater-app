import { Icon, Toggle } from '../../design-system';
import { isMetricId, MAX_STRIP_METRICS, type MetricId } from '../layout/mins';
import type { DashboardDoc } from '../layout/types';
import { METRICS } from '../panels/metrics';
import { MetricChecklist } from './MetricChecklist';
import { useReorder } from './useReorder';
import styles from './editor.module.css';

/** ③ 맨 위 숫자 줄: 켜기·끄기와 숫자 고르기(최대 5개). */
export function KpiStripSettings({
  kpi,
  onChange,
  announce,
}: {
  kpi: DashboardDoc['kpi'];
  onChange: (kpi: DashboardDoc['kpi']) => void;
  /** 순서를 바꾼 결과를 알린다(편집 화면의 status). */
  announce: (message: string) => void;
}) {
  const items = kpi.items.filter(isMetricId);
  // 끌어서(또는 키보드로) 한 숫자를 다른 숫자 자리로 옮긴다. 옮긴 자리 뒤의 숫자는 한 칸씩 밀린다.
  const order = useReorder({
    group: 'strip',
    count: items.length,
    nameOf: (i) => METRICS[items[i] as MetricId].label,
    done: '자리를 바꿨습니다.',
    announce,
    onDrop: (from, to) => {
      const next = [...items];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved as MetricId);
      onChange({ ...kpi, items: next });
    },
  });
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
      {items.length > 1 ? (
        <ol className={styles.order} aria-label="숫자 줄 순서">
          {items.map((id, i) => (
            <li key={id} className={styles.orderItem} {...order.itemProps(i)}>
              <button
                type="button"
                className={styles.grab}
                aria-label={`${METRICS[id].label} 순서 바꾸기`}
                title="끌어서 순서를 바꿉니다. 키보드는 Space로 잡고 방향키로 고른 뒤 Space로 놓습니다."
                {...order.handleProps(i)}
              >
                <Icon name="grip" size="sm" />
              </button>
              {METRICS[id].label}
            </li>
          ))}
        </ol>
      ) : null}
      <MetricChecklist
        label="맨 위 숫자 줄에 보일 숫자"
        value={items}
        max={MAX_STRIP_METRICS}
        onChange={(next) => onChange({ ...kpi, items: next })}
      />
    </div>
  );
}
