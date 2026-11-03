import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cx } from '../internal/cx';
import styles from './Tabs.module.css';

interface TabsState {
  current: string;
  select: (value: string) => void;
  idFor: (kind: 'tab' | 'panel', value: string) => string;
}

const TabsContext = createContext<TabsState | null>(null);
/** 이 목록에서 Tab 키로 들어갈 탭의 값. 선택된 탭이 목록에 없으면 첫 탭. */
const FocusableTabContext = createContext<string | undefined>(undefined);

function useTabs(): TabsState {
  const state = useContext(TabsContext);
  if (!state) throw new Error('Tab, TabList, TabPanel은 Tabs 안에서 써야 합니다');
  return state;
}

export interface TabsProps {
  /** 제어 모드: 바깥에서 값을 정한다. */
  value?: string;
  /** 비제어 모드의 처음 값. */
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
}

/**
 * 탭(WAI-ARIA 탭 패턴). TabList와 TabPanel을 떨어진 자리에 둘 수 있다.
 * 키보드: ←→ 이동과 동시에 선택, Home·End. 선택된 탭만 Tab 키 순서에 들어간다.
 */
export function Tabs({ value, defaultValue = '', onValueChange, children }: TabsProps) {
  const [inner, setInner] = useState(defaultValue);
  const current = value ?? inner;
  const baseId = useId();
  const select = useCallback(
    (next: string) => {
      if (value === undefined) setInner(next);
      onValueChange?.(next);
    },
    [value, onValueChange],
  );
  const state = useMemo<TabsState>(
    () => ({
      current,
      select,
      idFor: (kind, v) => `${baseId}${kind}-${v.replace(/[^\w-]/g, '_')}`,
    }),
    [current, select, baseId],
  );
  return <TabsContext.Provider value={state}>{children}</TabsContext.Provider>;
}

export interface TabListProps {
  /** 탭 묶음의 이름(화면 읽기 프로그램용). 예: "시장". */
  label: string;
  /** line: 본문 탭(기본), segment: 작은 전환 버튼 모양. */
  variant?: 'line' | 'segment';
  className?: string;
  children: ReactNode;
}

export function TabList({ label, variant = 'line', className, children }: TabListProps) {
  const { current } = useTabs();
  const values = Children.toArray(children).flatMap((child) =>
    isValidElement<{ value: string }>(child) && child.type === Tab ? [child.props.value] : [],
  );
  const focusable = values.includes(current) ? current : values[0];
  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      className={cx(styles.list, className)}
      data-variant={variant}
    >
      <FocusableTabContext.Provider value={focusable}>{children}</FocusableTabContext.Provider>
    </div>
  );
}

const KEY_STEP: Record<string, (index: number, last: number) => number> = {
  ArrowRight: (i, last) => (i === last ? 0 : i + 1),
  ArrowLeft: (i, last) => (i === 0 ? last : i - 1),
  Home: () => 0,
  End: (_, last) => last,
};

export function Tab({ value, children }: { value: string; children: ReactNode }) {
  const { current, select, idFor } = useTabs();
  const focusable = useContext(FocusableTabContext) ?? current;
  const selected = current === value;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const step = KEY_STEP[event.key];
    const list = event.currentTarget.closest('[role="tablist"]');
    if (!step || !list) return;
    const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const target = tabs[step(tabs.indexOf(event.currentTarget), tabs.length - 1)];
    if (!target) return;
    event.preventDefault();
    target.focus();
    select(target.dataset.value ?? '');
  }

  return (
    <button
      type="button"
      role="tab"
      id={idFor('tab', value)}
      aria-selected={selected}
      aria-controls={idFor('panel', value)}
      tabIndex={value === focusable ? 0 : -1}
      data-value={value}
      className={styles.tab}
      onClick={() => select(value)}
      onKeyDown={onKeyDown}
    >
      {children}
    </button>
  );
}

export function TabPanel({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  const { current, idFor } = useTabs();
  if (current !== value) return null;
  return (
    <div
      role="tabpanel"
      id={idFor('panel', value)}
      aria-labelledby={idFor('tab', value)}
      tabIndex={0}
      className={cx(styles.panel, className)}
    >
      {children}
    </div>
  );
}
