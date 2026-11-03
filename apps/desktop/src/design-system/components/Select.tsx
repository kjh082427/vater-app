import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { cx } from '../internal/cx';
import { usePopoverPosition } from '../internal/popover';
import { Icon } from './Icon';
import styles from './Select.module.css';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** 막힌 항목: 보이지만 고를 수 없고, 키보드는 건너뛴다. */
  disabled?: boolean;
  /** 막힌 이유(예: "칸이 작아 들어가지 않음"). 항목 아래에 보이고 설명으로 읽힌다. */
  reason?: string;
}

export interface SelectProps<T extends string> {
  /** 버튼 안 왼쪽의 이름표이자 목록 이름. */
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

/**
 * 고르기(WAI-ARIA 접히는 listbox). 네이티브 select 대신 쓰는 이유: 막힌 항목에 이유를 붙인다.
 * 버튼: 누르거나 ↓↑로 연다. 목록: ↑↓·Home·End(막힌 항목 건너뜀), Enter·Space로 고름,
 * Esc는 고르지 않고 닫음. 닫히면 초점은 버튼으로. 바깥을 누르거나 Tab으로 나가면 닫힌다.
 */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: SelectProps<T>) {
  const id = useId();
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;
  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-opt-${index}`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const position = usePopoverPosition(open, buttonRef, listRef);

  const enabled = options.flatMap((option, index) => (option.disabled ? [] : [index]));
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];

  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  function show(start: 'current' | 'first' | 'last') {
    const current = enabled.includes(selectedIndex) ? selectedIndex : undefined;
    const first = enabled[0] ?? -1;
    const last = enabled[enabled.length - 1] ?? -1;
    setActive(start === 'last' ? (current ?? last) : (current ?? first));
    setOpen(true);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    close(true);
    if (option.value !== value) onChange(option.value);
  }

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      show(event.key === 'ArrowUp' ? 'last' : 'current');
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const at = enabled.indexOf(active);
    const moves: Record<string, () => number | undefined> = {
      ArrowDown: () => enabled[Math.min(at + 1, enabled.length - 1)],
      ArrowUp: () => enabled[Math.max(at - 1, 0)],
      Home: () => enabled[0],
      End: () => enabled[enabled.length - 1],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      const next = move();
      if (next !== undefined) setActive(next);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(active);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    }
  }

  function onListBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget as Node | null;
    if (!next || !wrapRef.current?.contains(next)) setOpen(false);
  }

  return (
    <div ref={wrapRef} className={cx(styles.select, className)}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.button}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${valueId}`}
        onClick={() => (open ? close(false) : show('current'))}
        onKeyDown={onButtonKeyDown}
      >
        <span id={labelId} className={styles.label}>
          {label}
        </span>
        <span id={valueId} className={styles.value}>
          {selected?.label ?? '—'}
        </span>
        <Icon name="chevron-down" size="sm" className={styles.chevron} />
      </button>
      {open ? (
        // 목록 상자 자체가 초점을 받고, 활성 항목은 aria-activedescendant로 알린다(APG 접히는 listbox)
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={labelId}
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          className={styles.list}
          style={position}
          onKeyDown={onListKeyDown}
          onBlur={onListBlur}
        >
          {options.map((option, index) => {
            const nameId = `${optionId(index)}-name`;
            const reasonId = `${optionId(index)}-reason`;
            return (
              // 초점은 목록 상자에 있고 항목은 aria-activedescendant로 가리킨다(항목 자체는 초점을 받지 않음).
              // 항목 선택은 목록 상자의 키보드 처리(Enter·Space)가 맡고, 클릭은 마우스용이다.
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
              <div
                key={option.value}
                id={optionId(index)}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                aria-labelledby={nameId}
                aria-describedby={option.reason ? reasonId : undefined}
                className={styles.option}
                data-active={index === active ? 'true' : undefined}
                onClick={() => choose(index)}
                onMouseMove={() => {
                  if (!option.disabled && index !== active) setActive(index);
                }}
              >
                <span className={styles.optionText}>
                  <span id={nameId}>{option.label}</span>
                  {option.reason ? (
                    <span id={reasonId} className={styles.reason}>
                      {option.reason}
                    </span>
                  ) : null}
                </span>
                {option.value === value ? (
                  <Icon name="check" size="sm" className={styles.check} />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
