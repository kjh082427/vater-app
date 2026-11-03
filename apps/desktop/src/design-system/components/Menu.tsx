import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from 'react';
import { cx } from '../internal/cx';
import { usePopoverPosition } from '../internal/popover';
import styles from './Menu.module.css';

export interface MenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  /** 막힌 항목: 보이지만 누를 수 없고, 키보드는 건너뛴다. */
  disabled?: boolean;
  /** 막힌 이유. 항목 아래에 보이고 설명으로 읽힌다. */
  reason?: string;
}

/** 트리거가 받아 버튼에 붙이는 속성. Button처럼 나머지 속성을 그대로 넘기는 요소여야 한다. */
interface TriggerProps {
  'aria-haspopup'?: 'menu';
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
}

export interface MenuProps {
  /** 메뉴를 여는 버튼. 보통 <Button variant="icon" aria-label="칸 메뉴" icon={<Icon name="more" />} />. */
  trigger: ReactElement<TriggerProps>;
  items: MenuItem[];
  /** 메뉴를 트리거의 어느 쪽 끝에 맞출지. 칸 머리 오른쪽의 ⋯는 end(기본). */
  align?: 'start' | 'end';
  className?: string;
}

/**
 * 메뉴(WAI-ARIA 메뉴 버튼). 트리거를 누르거나 Enter·Space·↓로 열면 첫 항목에 초점(↑는 끝 항목).
 * ↑↓는 막힌 항목을 건너뛰며 돌고, Home·End, Enter로 고름. Esc는 닫고 트리거로 초점을 돌린다.
 * 바깥을 누르거나 Tab으로 나가면 닫힌다.
 */
export function Menu({ trigger, items, align = 'end', className }: MenuProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const position = usePopoverPosition(open, wrapRef, menuRef, align);
  const enabled = items.flatMap((item, index) => (item.disabled ? [] : [index]));

  useEffect(() => {
    if (open && focusIndex >= 0) itemRefs.current[focusIndex]?.focus();
  }, [open, focusIndex]);

  function triggerEl(): HTMLElement | null {
    return wrapRef.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]') ?? null;
  }

  function show(from: 'first' | 'last') {
    setFocusIndex((from === 'first' ? enabled[0] : enabled[enabled.length - 1]) ?? -1);
    setOpen(true);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    setFocusIndex(-1);
    if (returnFocus) triggerEl()?.focus();
  }

  function choose(item: MenuItem) {
    if (item.disabled) return;
    close(true);
    item.onSelect();
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const at = enabled.indexOf(focusIndex);
    const n = enabled.length;
    const moves: Record<string, () => number | undefined> = {
      ArrowDown: () => enabled[(at + 1) % n],
      ArrowUp: () => enabled[(at - 1 + n) % n],
      Home: () => enabled[0],
      End: () => enabled[n - 1],
    };
    const move = moves[event.key];
    if (move && n > 0) {
      event.preventDefault();
      setFocusIndex(move() ?? -1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    }
  }

  function onMenuBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget as Node | null;
    if (!next || !wrapRef.current?.contains(next)) {
      setOpen(false);
      setFocusIndex(-1);
    }
  }

  const triggerProps = trigger.props;
  const cloned = cloneElement(trigger, {
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? `${id}-menu` : undefined,
    onClick: (event: MouseEvent<HTMLElement>) => {
      triggerProps.onClick?.(event);
      // 여기서는 ref를 읽지 않는다(cloneElement에 넘기는 함수라 렌더 중 접근으로 보일 수 있다)
      if (open) {
        setOpen(false);
        setFocusIndex(-1);
      } else {
        show('first');
      }
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      triggerProps.onKeyDown?.(event);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        show(event.key === 'ArrowUp' ? 'last' : 'first');
      }
    },
  });

  return (
    <span ref={wrapRef} className={cx(styles.wrap, className)}>
      {cloned}
      {open ? (
        <div
          ref={menuRef}
          id={`${id}-menu`}
          role="menu"
          tabIndex={-1}
          className={styles.menu}
          style={position}
          onKeyDown={onMenuKeyDown}
          onBlur={onMenuBlur}
        >
          {items.map((item, index) => {
            const nameId = `${id}-${item.id}-name`;
            const reasonId = `${id}-${item.id}-reason`;
            return (
              <button
                key={item.id}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={item.disabled || undefined}
                aria-labelledby={nameId}
                aria-describedby={item.reason ? reasonId : undefined}
                className={styles.item}
                onClick={() => choose(item)}
                onMouseMove={() => {
                  if (!item.disabled && index !== focusIndex) setFocusIndex(index);
                }}
              >
                <span id={nameId}>{item.label}</span>
                {item.reason ? (
                  <span id={reasonId} className={styles.reason}>
                    {item.reason}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </span>
  );
}
