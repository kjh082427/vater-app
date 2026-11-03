import { SegmentedControl } from '../../design-system';
import styles from './editor.module.css';

const COUNTS = ['1', '2', '3', '4', '5', '6'] as const;

/** ① 몇 칸으로 나눌까요(1~6). */
export function CountPicker({ count, onChange }: { count: number; onChange: (n: number) => void }) {
  return (
    <div className={styles.step}>
      <h3 className={styles.stepTitle}>
        <span className={styles.stepNo} aria-hidden="true">
          1
        </span>
        몇 칸으로 나눌까요
        <span className={styles.stepMeta}>1~6칸</span>
      </h3>
      <SegmentedControl
        label="칸 수"
        value={String(count) as (typeof COUNTS)[number]}
        options={COUNTS.map((c) => ({ value: c, label: c }))}
        onChange={(v) => onChange(Number(v))}
        className={styles.counts}
      />
    </div>
  );
}
