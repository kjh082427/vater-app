import { useId } from 'react';
import { METRIC_IDS, type MetricId } from '../layout/mins';
import { METRICS } from '../panels/metrics';
import styles from './editor.module.css';

/** 숫자 고르기(맨 위 숫자 줄 최대 5개, 숫자 카드 칸 최대 4개). 고른 순서대로 놓인다. */
export function MetricChecklist({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: MetricId[];
  max: number;
  onChange: (next: MetricId[]) => void;
}) {
  const reasonId = useId();
  const full = value.length >= max;
  return (
    <fieldset className={styles.metrics} aria-label={label}>
      {METRIC_IDS.map((id) => {
        const checked = value.includes(id);
        const blocked = !checked && full;
        return (
          <label key={id} className={styles.metric} data-blocked={blocked ? 'true' : 'false'}>
            <input
              type="checkbox"
              checked={checked}
              disabled={blocked}
              aria-describedby={blocked ? reasonId : undefined}
              onChange={() => onChange(checked ? value.filter((v) => v !== id) : [...value, id])}
            />
            {METRICS[id].label}
          </label>
        );
      })}
      <span id={reasonId} className={styles.reason} hidden={!full}>
        {`숫자는 ${max}개까지 고를 수 있습니다`}
      </span>
    </fieldset>
  );
}
