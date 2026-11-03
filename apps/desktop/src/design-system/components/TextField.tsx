import { useId, type HTMLInputTypeAttribute } from 'react';
import { cx } from '../internal/cx';
import styles from './TextField.module.css';

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** 오류 문구: 원인과 고치는 방법. 있으면 aria-invalid, 황토 테두리와 글자(빨강 아님). */
  error?: string;
  /** 도움말 한 줄(예: "1~20자"). */
  hint?: string;
  /** 있으면 넘게 쓸 수 없고 "5/20"처럼 쓴 글자 수를 보인다. */
  maxLength?: number;
  type?: HTMLInputTypeAttribute;
  className?: string;
}

/** 글자 입력. 이름표는 위, 도움말·오류는 아래이며 둘 다 aria-describedby로 입력에 연결된다. */
export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  maxLength,
  type = 'text',
  className,
}: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className={cx(styles.field, className)}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        className={styles.input}
        value={value}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint || error || maxLength ? (
        <div className={styles.foot}>
          <div className={styles.messages}>
            {error ? (
              <p id={errorId} className={styles.error}>
                {error}
              </p>
            ) : null}
            {hint ? (
              <p id={hintId} className={styles.hint}>
                {hint}
              </p>
            ) : null}
          </div>
          {maxLength ? (
            <span className={cx(styles.count, 'vt-num')} aria-hidden="true">
              {`${value.length}/${maxLength}`}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
