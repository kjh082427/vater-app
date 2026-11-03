import { cx } from '../internal/cx';
import styles from './Toggle.module.css';

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/** 켜기·끄기 스위치(role="switch"). 이름표와 스위치가 한 버튼이라 어디를 눌러도 바뀐다. Space·Enter. */
export function Toggle({ label, checked, onChange, disabled, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cx(styles.toggle, className)}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.label}>{label}</span>
      <span className={styles.track} data-on={checked ? 'true' : 'false'} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
    </button>
  );
}
