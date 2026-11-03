import { useId, type ReactNode } from 'react';
import styles from './form.module.css';

export interface ControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export interface FieldProps {
  label: string;
  /** 원인과 해결 방법. 있으면 칸이 황토 테두리가 되고 화면 읽기 프로그램이 함께 읽는다. */
  error?: string;
  hint?: string;
  children: (control: ControlProps) => ReactNode;
}

/** 이름표 + 입력 칸 + 도움말/오류. 칸은 children 함수가 받은 id·aria 값을 붙인다. */
export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const described = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        'aria-describedby': described || undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

export { styles as formStyles };
