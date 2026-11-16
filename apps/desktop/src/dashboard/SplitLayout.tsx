/**
 * 칸 배치 그리기: 분할 나무가 나눈 사각형에 칸을 놓는다(겹침이 원리상 없다).
 * 영역이 지금 비율의 최소 합보다 작으면 배치는 그대로 두고 영역이 스크롤한다(칸은 최소 크기 유지).
 */
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Divider } from './Divider';
import { AREA_1280x800, computeRects, dividers, requiredArea } from './layout/geometry';
import type { Node, Rect, Size } from './layout/types';
import styles from './dashboard.module.css';

/** 영역 크기. ResizeObserver가 없거나 아직 크기가 0이면(테스트 환경) 1280×800 창의 영역. */
export function useAreaSize(): [RefObject<HTMLDivElement>, Size] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>(AREA_1280x800);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    // clientWidth는 반올림이라(853.6 → 854) 캔버스가 상자보다 커져 스크롤바가 생겼다 사라지기를
    // 되풀이할 수 있다(배율 125%·150%, v0.2.2 22-1). 소수점 안쪽 크기 하나를 내림하고, 어떤 경우에도
    // clientWidth보다 크지 않게 한다. 안쪽 크기는 ResizeObserver의 contentRect(스크롤바·테두리 제외,
    // 이 영역은 padding이 없다), 처음 한 번은 바깥 상자에서 테두리·스크롤바 몫을 뺀 값이다.
    const read = (inner?: { width: number; height: number }) => {
      const outer = inner ? null : node.getBoundingClientRect();
      const box = inner ?? {
        width: (outer?.width ?? 0) - (node.offsetWidth - node.clientWidth),
        height: (outer?.height ?? 0) - (node.offsetHeight - node.clientHeight),
      };
      const w = Math.min(Math.floor(box.width), node.clientWidth);
      const h = Math.min(Math.floor(box.height), node.clientHeight);
      if (w > 0 && h > 0) setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => read(entries[0]?.contentRect));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

export interface SplitLayoutProps {
  root: Node;
  mins: Size[];
  gap: number;
  /** 칸 그리기. rect는 영역 안 위치(px). */
  renderPanel: (index: number, rect: Rect) => ReactNode;
  /** 있으면 경계선 손잡이를 그린다(편집 화면). 바뀐 나무를 받는다. */
  onResize?: (root: Node) => void;
  /** 경계선이 최소 크기를 재는 영역. 없으면 그린 영역. */
  limitArea?: Size;
  className?: string;
  /** 영역 크기를 바깥에서 줄 때. */
  area?: Size;
  /**
   * 편집 화면의 캔버스: 실제 영역보다 좁은 미리보기라 최소 크기로 늘리지 않고 영역에 맞춰 그린다.
   * 최소 크기는 경계선이 limitArea(실제 영역)로 지킨다.
   */
  fitToArea?: boolean;
}

export function SplitLayout({
  root,
  mins,
  gap,
  renderPanel,
  onResize,
  limitArea,
  className,
  area,
  fitToArea = false,
}: SplitLayoutProps) {
  const [ref, measured] = useAreaSize();
  const outer = area ?? measured;
  const need = fitToArea ? { w: 0, h: 0 } : requiredArea(root, mins, gap);
  const inner = { w: Math.max(outer.w, need.w), h: Math.max(outer.h, need.h) };
  const rects = computeRects(root, inner, gap);
  const scrolls = inner.w > outer.w + 0.5 || inner.h > outer.h + 0.5;
  return (
    <div
      ref={ref}
      className={`${styles.area} ${className ?? ''}`}
      data-scroll={scrolls ? 'true' : 'false'}
      tabIndex={scrolls ? 0 : undefined}
      role={scrolls ? 'group' : undefined}
      aria-label={scrolls ? '칸 배치(창이 작아 스크롤됨)' : undefined}
    >
      <div className={styles.canvas} style={{ width: inner.w, height: inner.h }}>
        {rects.map((r, i) => (
          <div
            key={i}
            className={styles.cell}
            data-panel={i}
            style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
          >
            {renderPanel(i, r)}
          </div>
        ))}
        {onResize
          ? dividers(root, inner, gap).map((spot) => (
              <Divider
                key={`${spot.path.join('.')}:${spot.index}`}
                spot={spot}
                root={root}
                limitArea={limitArea ?? inner}
                mins={mins}
                gap={gap}
                onResize={onResize}
              />
            ))
          : null}
      </div>
    </div>
  );
}
