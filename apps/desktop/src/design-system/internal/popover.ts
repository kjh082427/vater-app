import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

const GAP = 4;
const EDGE = 8;

/**
 * 떠 있는 목록(Select, Menu)의 자리. 창 기준(position: fixed)으로 트리거 아래에 두고,
 * 아래 자리가 모자라면 위로 올린다. 카드나 스크롤 영역의 overflow에 잘리지 않는다.
 */
export function usePopoverPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  popoverRef: RefObject<HTMLElement | null>,
  align: 'start' | 'end' = 'start',
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const pop = popoverRef.current?.getBoundingClientRect();
      if (!anchor || !pop) return;
      const below = anchor.bottom + GAP;
      const above = anchor.top - GAP - pop.height;
      const top = below + pop.height > window.innerHeight - EDGE && above > EDGE ? above : below;
      const width = Math.max(pop.width, align === 'start' ? anchor.width : 0);
      const wanted = align === 'end' ? anchor.right - width : anchor.left;
      const left = Math.max(EDGE, Math.min(wanted, window.innerWidth - width - EDGE));
      setStyle({ top, left, minWidth: align === 'start' ? anchor.width : undefined });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef, popoverRef, align]);

  return style;
}
