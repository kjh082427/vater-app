/**
 * 경계선 손잡이(편집 화면): 인접한 두 칸의 비율을 바꾼다. 포인터로 끌거나, 초점을 둔 뒤
 * ←/→ 또는 ↑/↓로 5%씩. 끄는 동안 비율(예: 58 : 42)을 보인다. 최소 크기에서 멈춘다(resizeAt).
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { pairPercent, resizeAt, type DividerSpot } from './layout/geometry';
import type { Node, Size } from './layout/types';
import styles from './dashboard.module.css';

const STEP = 0.05;
const KEYS: Record<string, number> = {
  ArrowLeft: -STEP,
  ArrowUp: -STEP,
  ArrowRight: STEP,
  ArrowDown: STEP,
};

/** 숫자 끝소리에 맞춘 조사: 1과, 2와. */
const WA = new Set(['2', '4', '5', '9']);
const josa = (label: string) => (WA.has(label.slice(-1)) ? '와' : '과');
const nameOf = (panels: number[]) => `칸 ${panels.map((p) => p + 1).join('·')}`;

export interface DividerProps {
  spot: DividerSpot;
  root: Node;
  /** 최소 크기를 재는 영역(편집 화면에서는 실제 대시보드 영역). */
  limitArea: Size;
  mins: Size[];
  gap: number;
  onResize: (root: Node) => void;
}

export function Divider({ spot, root, limitArea, mins, gap, onResize }: DividerProps) {
  const drag = useRef<{ start: number; root: Node } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [left, right] = pairPercent(root, spot.path, spot.index);
  const row = spot.dir === 'row';
  const a = nameOf(spot.before);
  const label = `${a}${josa(a)} ${nameOf(spot.after)} 사이 경계선`;

  const move = (delta: number, from: Node) =>
    onResize(resizeAt(from, spot.path, spot.index, delta, limitArea, mins, gap));

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const delta = KEYS[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    move(delta, root);
  }

  const pos = (e: PointerEvent) => (row ? e.clientX : e.clientY);
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget.focus();
    drag.current = { start: pos(e), root };
    setDragging(true);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || spot.free <= 0) return;
    move((pos(e) - d.start) / spot.free, d.root);
  }
  function end(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    drag.current = null;
    setDragging(false);
  }

  const { x, y, w, h } = spot.rect;
  return (
    // 초점을 받는 separator(aria-valuenow 있음)는 ARIA에서 조작 위젯이다(WAI-ARIA 창 분할 패턴).
    // jsx-a11y는 separator를 늘 비조작 요소로 보므로 이 두 규칙만 끈다.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="separator"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      aria-label={label}
      aria-orientation={row ? 'vertical' : 'horizontal'}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={left}
      aria-valuetext={`${left} : ${right}`}
      className={styles.divider}
      data-dir={spot.dir}
      data-dragging={dragging ? 'true' : 'false'}
      style={{ left: x, top: y, width: w, height: h }}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <span className={styles.grip} aria-hidden="true" />
      {dragging ? (
        <span className={styles.ratio} aria-hidden="true">{`${left} : ${right}`}</span>
      ) : null}
    </div>
  );
}
