/**
 * 칸 배치 그리기: 분할 나무가 나눈 사각형에 칸을 놓는다(겹침이 원리상 없다).
 * 영역이 지금 비율의 최소 합보다 작으면 배치는 그대로 두고 영역이 스크롤한다(칸은 최소 크기 유지).
 */
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AREA_1280x800, computeRects, requiredArea } from './layout/geometry';
import type { Node, Rect, Size } from './layout/types';
import styles from './dashboard.module.css';

/** 영역 크기. ResizeObserver가 없거나 아직 크기가 0이면(테스트 환경) 1280×800 창의 영역. */
export function useAreaSize(): [RefObject<HTMLDivElement>, Size] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>(AREA_1280x800);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const read = () => {
      const w = node.clientWidth;
      const h = node.clientHeight;
      if (w > 0 && h > 0) setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
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
  /** 칸 위에 겹쳐 그릴 것(편집 화면의 경계선 손잡이). 배치 영역 크기를 받는다. */
  overlay?: (area: Size) => ReactNode;
  className?: string;
  /** 영역 크기를 바깥에서 줄 때(편집 화면의 캔버스). */
  area?: Size;
}

export function SplitLayout({
  root,
  mins,
  gap,
  renderPanel,
  overlay,
  className,
  area,
}: SplitLayoutProps) {
  const [ref, measured] = useAreaSize();
  const outer = area ?? measured;
  const need = requiredArea(root, mins, gap);
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
        {overlay?.(inner)}
      </div>
    </div>
  );
}
