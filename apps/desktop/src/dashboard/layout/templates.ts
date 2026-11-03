/** 배치 틀(대시보드 설계 2장): 칸 수별로 코드에 고정된 목록. 문서에는 id로 저장한다. */
import type { Node, TemplateId } from './types';

const p = (panel: number): Node => ({ panel });
const even = (n: number) => Array.from({ length: n }, () => 1 / n);
const row = (sizes: number[], children: Node[]): Node => ({ dir: 'row', sizes, children });
const col = (sizes: number[], children: Node[]): Node => ({ dir: 'col', sizes, children });
const rowOf = (...panels: number[]) => row(even(panels.length), panels.map(p));
const colOf = (...panels: number[]) => col(even(panels.length), panels.map(p));

export interface Template {
  count: number;
  label: string;
  root: Node;
}

export const TEMPLATES: Record<TemplateId, Template> = {
  one: { count: 1, label: '한 칸', root: p(0) },
  'cols-2': { count: 2, label: '좌우 반반', root: rowOf(0, 1) },
  'rows-2': { count: 2, label: '위아래 반반', root: colOf(0, 1) },
  'left-big-3': {
    count: 3,
    label: '왼쪽 크게 + 오른쪽 2',
    root: row([0.6, 0.4], [p(0), colOf(1, 2)]),
  },
  'top-big-3': { count: 3, label: '위 크게 + 아래 2', root: col([0.6, 0.4], [p(0), rowOf(1, 2)]) },
  'cols-3': { count: 3, label: '가로 3열', root: rowOf(0, 1, 2) },
  'grid-2x2': { count: 4, label: '2×2 격자', root: col(even(2), [rowOf(0, 1), rowOf(2, 3)]) },
  'left-big-4': {
    count: 4,
    label: '왼쪽 크게 + 오른쪽 3',
    root: row([0.5, 0.5], [p(0), colOf(1, 2, 3)]),
  },
  'top-big-4': {
    count: 4,
    label: '위 크게 + 아래 3',
    root: col([0.55, 0.45], [p(0), rowOf(1, 2, 3)]),
  },
  'cols-4': { count: 4, label: '가로 4열', root: rowOf(0, 1, 2, 3) },
  'top2-bottom3': {
    count: 5,
    label: '위 2 + 아래 3',
    root: col(even(2), [rowOf(0, 1), rowOf(2, 3, 4)]),
  },
  'left-big-5': {
    count: 5,
    label: '왼쪽 크게 + 오른쪽 2×2',
    root: row([0.5, 0.5], [p(0), col(even(2), [rowOf(1, 2), rowOf(3, 4)])]),
  },
  'grid-2x3': {
    count: 6,
    label: '2줄 × 3칸',
    root: col(even(2), [rowOf(0, 1, 2), rowOf(3, 4, 5)]),
  },
  'grid-3x2': {
    count: 6,
    label: '3줄 × 2칸',
    root: col(even(3), [rowOf(0, 1), rowOf(2, 3), rowOf(4, 5)]),
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[];

export const isTemplateId = (v: unknown): v is TemplateId =>
  typeof v === 'string' && Object.hasOwn(TEMPLATES, v);

/** 칸 수에 맞는 틀(목록 순서 그대로). */
export function templatesFor(count: number): TemplateId[] {
  return TEMPLATE_IDS.filter((id) => TEMPLATES[id].count === count);
}

/** 틀의 기본 나무(복사본: 바꿔도 목록은 그대로). */
export const templateRoot = (id: TemplateId): Node => structuredClone(TEMPLATES[id].root);
