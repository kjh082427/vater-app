/**
 * 끌어서 바꾸기(스펙 18장): 칸 내용 맞바꾸기와 숫자 줄 순서 바꾸기가 같이 쓴다. 새 라이브러리 없이
 * `Divider.tsx`처럼 포인터 이벤트로 처리한다.
 * - 포인터: 칸(항목) 아무 데나 눌러 4px 넘게 끌면 시작한다. 입력칸·버튼·링크를 눌러서는 시작하지 않는다
 *   (손잡이 버튼만 예외). 놓은 자리의 항목이 `data-reorder="<group>"`과 `data-reorder-index`를 가진 요소다.
 * - 키보드: 손잡이에서 Space·Enter로 잡고, 방향키로 놓을 자리를 고르고, Space·Enter로 놓는다. Esc는 취소.
 * 놓을 수 없는 자리(`check`가 이유를 돌려줌)는 표시하고, 놓아도 바꾸지 않고 이유를 알린다.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { withObjectParticle } from '../../screens/common/text';

const INTERACTIVE =
  'button, input, select, textarea, a, label, [role="button"], [role="combobox"], [role="listbox"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"]';
const THRESHOLD = 4;

export type ReorderMark = 'from' | 'over' | 'blocked' | undefined;

export interface ReorderOptions {
  /** `data-reorder` 값: 이 목록의 항목만 놓을 자리로 센다. */
  group: string;
  count: number;
  /** 알림에 쓰는 항목 이름. 예: "칸 1". */
  nameOf: (index: number) => string;
  /** 놓은 뒤 알림 끝말(맞바꾸기). 예: "내용을 바꿨습니다." */
  done?: string;
  /** 끼워 넣기: 옮긴 항목 뒤의 항목이 한 칸씩 밀린다. 알림은 "A를 C 자리로 옮겼습니다."로 한다. */
  insert?: boolean;
  /** 이 자리에 놓을 수 없으면 이유. */
  check?: (from: number, to: number) => string | null;
  onDrop: (from: number, to: number) => void;
  /** 화면 읽기·눈에 보이는 알림(편집 화면의 status 한 곳). */
  announce: (message: string) => void;
}

interface Active {
  from: number;
  over: number | null;
  keyboard: boolean;
  /** 포인터를 4px 넘게 움직였다(눌렀다 떼기만 한 것은 끌기가 아니다). */
  moved: boolean;
}

function indexAt(group: string, x: number, y: number): number | null {
  const el = document.elementFromPoint?.(x, y);
  const holder = el?.closest(`[data-reorder="${group}"]`);
  const n = Number(holder?.getAttribute('data-reorder-index'));
  return holder && Number.isInteger(n) ? n : null;
}

export function useReorder({
  group,
  count,
  nameOf,
  done = '내용을 바꿨습니다.',
  insert = false,
  check,
  onDrop,
  announce,
}: ReorderOptions) {
  const [active, setActive] = useState<Active | null>(null);
  const press = useRef<{ from: number; x: number; y: number; moved: boolean } | null>(null);

  const reasonOf = (from: number, to: number) => (check ? check(from, to) : null);
  const slot = insert ? '옮길 자리' : '바꿀 칸';
  const slotObj = insert ? '옮길 자리를' : '바꿀 칸을';
  const dragging = active !== null && !active.keyboard;

  // 끄는 중 Esc는 끌기만 취소한다. 편집 화면의 Esc(취소)보다 먼저 받으려고 capture 단계에서 막는다.
  useEffect(() => {
    if (!dragging || !active) return;
    const from = active.from;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      press.current = null;
      setActive(null);
      announce(`${nameOf(from)}: 취소했습니다.`);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });

  function attempt(from: number, to: number) {
    const reason = reasonOf(from, to);
    const pair = `${nameOf(from)} ↔ ${nameOf(to)}`;
    if (reason) {
      announce(`${pair}: 놓을 수 없습니다. ${reason}`);
      return;
    }
    onDrop(from, to);
    announce(
      insert
        ? `${withObjectParticle(nameOf(from))} ${nameOf(to)} 자리로 옮겼습니다.`
        : `${pair} ${done}`,
    );
  }

  function onPointerDown(index: number, e: PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    const target = e.target as Element;
    const interactive = target.closest(INTERACTIVE);
    if (interactive && !interactive.closest('[data-drag-handle]')) return;
    press.current = { from: index, x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: PointerEvent<HTMLElement>) {
    const p = press.current;
    if (!p) return;
    if (e.buttons === 0) {
      // 버튼을 이미 뗐는데 pointerup을 못 받았다(창 밖에서 놓음 등): 끌기를 끝낸다
      press.current = null;
      setActive(null);
      if (p.moved) announce('');
      return;
    }
    if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < THRESHOLD) return;
    p.moved = true;
    const hit = indexAt(group, e.clientX, e.clientY);
    const over = hit !== null && hit !== p.from ? hit : null;
    setActive({ from: p.from, over, keyboard: false, moved: true });
    if (over !== null) {
      const reason = reasonOf(p.from, over);
      announce(
        reason ? `${nameOf(over)}에는 놓을 수 없습니다. ${reason}` : `${slot}: ${nameOf(over)}`,
      );
    }
  }

  function end(e: PointerEvent<HTMLElement>, drop: boolean) {
    const p = press.current;
    press.current = null;
    setActive(null);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!p || !p.moved) return;
    const hit = drop ? indexAt(group, e.clientX, e.clientY) : null;
    if (hit !== null && hit !== p.from) attempt(p.from, hit);
    else announce(''); // 빈 곳이나 제자리에 놓았다: 끄는 동안의 "바꿀 칸" 안내를 지운다
  }

  function onKeyDown(index: number, e: KeyboardEvent<HTMLElement>) {
    const grabbed = active?.keyboard ? active : null;
    const press_ = e.key === ' ' || e.key === 'Enter';
    if (!grabbed) {
      if (!press_) return;
      e.preventDefault();
      setActive({ from: index, over: null, keyboard: true, moved: true });
      announce(
        `${nameOf(index)}: 잡았습니다. 방향키로 ${slotObj} 고르고 Space로 놓으세요. Esc로 취소합니다.`,
      );
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault(); // 편집 화면의 Esc(취소)가 이어서 일하지 않게
      setActive(null);
      announce(`${nameOf(grabbed.from)}: 취소했습니다.`);
      return;
    }
    if (press_) {
      e.preventDefault();
      setActive(null);
      if (grabbed.over !== null && grabbed.over !== grabbed.from)
        attempt(grabbed.from, grabbed.over);
      else announce(`${nameOf(grabbed.from)}: ${slotObj} 고르지 않아 그대로 두었습니다.`);
      return;
    }
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = Math.min(Math.max((grabbed.over ?? grabbed.from) + step, 0), count - 1);
    setActive({ ...grabbed, over: next === grabbed.from ? null : next });
    if (next === grabbed.from) {
      announce(`${nameOf(grabbed.from)}: ${slotObj} 고르세요.`);
      return;
    }
    const reason = reasonOf(grabbed.from, next);
    announce(
      reason ? `${nameOf(next)}에는 놓을 수 없습니다. ${reason}` : `${slot}: ${nameOf(next)}`,
    );
  }

  function markOf(index: number): ReorderMark {
    if (!active) return undefined;
    if (index === active.from) return active.moved ? 'from' : undefined;
    if (index === active.over) return reasonOf(active.from, index) ? 'blocked' : 'over';
    return undefined;
  }

  return {
    /** 항목(칸, 숫자) 요소에 펼친다. */
    itemProps: (index: number) => ({
      'data-reorder': group,
      'data-reorder-index': index,
      'data-reorder-state': markOf(index),
      onPointerDown: (e: PointerEvent<HTMLElement>) => onPointerDown(index, e),
      onPointerMove,
      onPointerUp: (e: PointerEvent<HTMLElement>) => end(e, true),
      onPointerCancel: (e: PointerEvent<HTMLElement>) => end(e, false),
    }),
    /** 손잡이 버튼에 펼친다(키보드로 잡기). */
    handleProps: (index: number) => ({
      'data-drag-handle': '',
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => onKeyDown(index, e),
      onBlur: () => {
        if (active?.keyboard) setActive(null);
      },
    }),
  };
}
