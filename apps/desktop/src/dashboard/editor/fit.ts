/** 편집 화면의 "맞는지" 판정과 이유 문구(대시보드 설계 2장 "맞지 않는 틀"). */
import { useEffect, useState } from 'react';
import { computeRects, dashboardArea, fits, GAP } from '../layout/geometry';
import { minOf } from '../layout/mins';
import { templateRoot, templatesFor } from '../layout/templates';
import type { PanelDoc, Rect, Size, TemplateId } from '../layout/types';
import { panelDef } from '../panels/registry';

const round = (n: number) => Math.round(n);
export const labelOf = (type: string) =>
  type === 'empty' ? '빈칸' : (panelDef(type)?.label ?? '지원하지 않는 내용');

/** 지금 창 크기에서 대시보드 영역(사이드바·여백·탭·숫자 줄을 뺀 크기). 창 크기가 바뀌면 따라간다. */
export function useWindowArea(kpi: boolean): Size {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [win, setWin] = useState(read);
  useEffect(() => {
    const on = () => setWin(read());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return dashboardArea(win, kpi);
}

/** 이 틀이 이 칸 내용으로 영역에 들어가지 않으면 이유. 들어가면 null. */
export function templateBlock(id: TemplateId, panels: PanelDoc[], area: Size): string | null {
  const mins = panels.map((p) => minOf(p.type));
  const r = fits(templateRoot(id), area, mins, GAP);
  if (r.ok) return null;
  const what = labelOf(panels[r.panel]?.type ?? 'empty');
  return r.got.w + 0.5 < r.need.w
    ? `창이 작아 들어가지 않음: 칸 너비 약 ${round(r.got.w)}px < ${what} 최소 ${r.need.w}px`
    : `창이 작아 들어가지 않음: 칸 높이 약 ${round(r.got.h)}px < ${what} 최소 ${r.need.h}px`;
}

/** 칸 수를 바꿀 때 고를 틀: 맞는 첫 틀, 없으면 첫 틀. */
export function firstFitting(count: number, panels: PanelDoc[], area: Size): TemplateId {
  const list = templatesFor(count);
  return list.find((t) => templateBlock(t, panels, area) === null) ?? list[0] ?? 'one';
}

/** 이 칸 크기에 이 내용이 들어가지 않으면 이유. */
export function contentBlock(type: string, rect: Rect | undefined): string | null {
  if (!rect) return null;
  const min = minOf(type);
  if (rect.w + 0.5 >= min.w && rect.h + 0.5 >= min.h) return null;
  return `칸이 작아 들어가지 않음: 칸 약 ${round(rect.w)}×${round(rect.h)}px < 최소 ${min.w}×${min.h}px`;
}

export const realRects = (root: Parameters<typeof computeRects>[0], area: Size) =>
  computeRects(root, area, GAP);
