import { useRef, type KeyboardEvent } from 'react';
import { cx } from '../internal/cx';
import styles from './SegmentedControl.module.css';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  /** 묶음 이름(화면 읽기 프로그램이 읽는다). */
  label: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  size?: 'md' | 'sm';
  className?: string;
}

/**
 * 몇 개 중 하나 고르기(라디오 그룹). 옅은 회색 홈 안에서 고른 것만 흰 바탕.
 * 키보드: ←→(↑↓)로 옮기며 바로 고른다(끝에서 처음으로 돈다, 막힌 것은 건너뜀). 고른 것만 Tab 순서에 든다.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  size = 'md',
  className,
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.flatMap((option, index) => (option.disabled ? [] : [index]));
  const selected = options.findIndex((option) => option.value === value && !option.disabled);
  const tabStop = selected >= 0 ? selected : (enabled[0] ?? -1);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step || enabled.length === 0) return;
    event.preventDefault();
    const at = enabled.indexOf(index);
    const next = enabled[(at + step + enabled.length) % enabled.length] as number;
    onChange((options[next] as SegmentOption<T>).value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx(styles.group, className)}
      data-size={size}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={index === tabStop ? 0 : -1}
          disabled={option.disabled}
          className={styles.segment}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
