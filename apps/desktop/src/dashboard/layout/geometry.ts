/**
 * 배치 계산(순수 함수). 칸은 분할 나무가 영역을 빈틈없이 나눈 사각형이라 겹치지 않는다.
 * 모든 길이는 CSS 픽셀(1배율)이다.
 */
import { templateRoot } from './templates';
import {
  isLeaf,
  type DashboardDoc,
  type Node,
  type Rect,
  type Size,
  type Split,
  type TemplateId,
} from './types';

/** 칸 사이 틈(--space-gap, 12px). */
export const GAP = 12;

/**
 * 창 크기에서 대시보드 영역을 빼는 데 쓰는 앱 틀 크기. CSS와 같은 값이어야 한다:
 * 사이드바 --size-sidebar(200), 상태 표시줄 --size-statusbar(28), 본문 여백 --space-4(16) × 2,
 * 탭 줄(40 + 틈 12), 맨 위 숫자 줄(100 + 틈 12). dashboard.module.css가 같은 값을 쓴다.
 */
export const CHROME = { sidebar: 200, statusbar: 28, padding: 16, tabs: 52, kpi: 112 } as const;

/** 이 크기의 창에서 칸이 쓸 수 있는 영역. */
export function dashboardArea(win: Size, kpi: boolean): Size {
  return {
    w: win.w - CHROME.sidebar - CHROME.padding * 2,
    h: win.h - CHROME.statusbar - CHROME.padding * 2 - CHROME.tabs - (kpi ? CHROME.kpi : 0),
  };
}

/** 최소 창(1024×600)과 흔한 창(1280×800)에서 숫자 줄을 켠 실제 영역. */
export const AREA_1024x600 = dashboardArea({ w: 1024, h: 600 }, true);
export const AREA_1280x800 = dashboardArea({ w: 1280, h: 800 }, true);

const along = (dir: Split['dir'], s: Size) => (dir === 'row' ? s.w : s.h);

function place(node: Node, box: Rect, gap: number, out: Rect[]) {
  if (isLeaf(node)) {
    out[node.panel] = box;
    return;
  }
  const n = node.children.length;
  const free = Math.max(0, along(node.dir, box) - gap * (n - 1));
  let offset = 0;
  node.children.forEach((child, i) => {
    const len = free * (node.sizes[i] ?? 0);
    const r: Rect =
      node.dir === 'row'
        ? { x: box.x + offset, y: box.y, w: len, h: box.h }
        : { x: box.x, y: box.y + offset, w: box.w, h: len };
    place(child, r, gap, out);
    offset += len + gap;
  });
}

/** 칸 사각형(칸 번호 순서). */
export function computeRects(root: Node, area: Size, gap: number): Rect[] {
  const out: Rect[] = [];
  place(root, { x: 0, y: 0, ...area }, gap, out);
  return out;
}

/** 지금 비율로 모든 칸이 최소 크기를 지키는 가장 작은 영역. 영역이 이보다 작으면 스크롤한다. */
export function requiredArea(node: Node, mins: Size[], gap: number): Size {
  if (isLeaf(node)) return mins[node.panel] ?? { w: 0, h: 0 };
  const needs = node.children.map((c) => requiredArea(c, mins, gap));
  const n = node.children.length;
  const byRatio = Math.max(
    ...needs.map((s, i) => along(node.dir, s) / Math.max(node.sizes[i] ?? 0, 1e-9)),
  );
  const main = byRatio + gap * (n - 1);
  const cross = Math.max(...needs.map((s) => (node.dir === 'row' ? s.h : s.w)));
  return node.dir === 'row' ? { w: main, h: cross } : { w: cross, h: main };
}

/** 반올림 오차(0.5px)는 맞는 것으로 본다. */
const EPS = 0.5;

export type FitResult = { ok: true } | { ok: false; panel: number; need: Size; got: Size };

/** 이 영역에서 모든 칸이 최소 크기 이상인가. 아니면 처음 걸린 칸. */
export function fits(root: Node, area: Size, mins: Size[], gap: number): FitResult {
  const rects = computeRects(root, area, gap);
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const need = mins[i];
    if (!r || !need) continue;
    if (r.w + EPS < need.w || r.h + EPS < need.h) {
      return { ok: false, panel: i, need, got: { w: r.w, h: r.h } };
    }
  }
  return { ok: true };
}

/** path(아이 순번들)를 따라간 분할과 그 분할의 영역. */
function locate(root: Node, path: number[], area: Size, gap: number): { node: Node; size: Size } {
  let node = root;
  let size = area;
  for (const i of path) {
    if (isLeaf(node)) break;
    const n = node.children.length;
    const len = Math.max(0, along(node.dir, size) - gap * (n - 1)) * (node.sizes[i] ?? 0);
    size = node.dir === 'row' ? { w: len, h: size.h } : { w: size.w, h: len };
    node = node.children[i] ?? node;
  }
  return { node, size };
}

function replaceAt(root: Node, path: number[], next: Node): Node {
  if (path.length === 0 || isLeaf(root)) return next;
  const [head, ...rest] = path;
  return {
    ...root,
    children: root.children.map((c, i) => (i === head ? replaceAt(c, rest, next) : c)),
  };
}

/**
 * path의 분할에서 index번 아이와 그 다음 아이의 비율을 delta(비율, 예: 0.05)만큼 옮긴다.
 * 두 칸 어느 쪽도 최소 크기 아래로 내려가지 않는 지점에서 멈춘다. 나머지 비율과 합 1은 그대로다.
 */
export function resizeAt(
  root: Node,
  path: number[],
  index: number,
  delta: number,
  area: Size,
  mins: Size[],
  gap: number,
): Node {
  const { node, size } = locate(root, path, area, gap);
  if (isLeaf(node)) return root;
  const a = node.sizes[index];
  const b = node.sizes[index + 1];
  const left = node.children[index];
  const right = node.children[index + 1];
  if (a === undefined || b === undefined || !left || !right) return root;
  const free = along(node.dir, size) - gap * (node.children.length - 1);
  if (free <= 0) return root;
  const minA = along(node.dir, requiredArea(left, mins, gap)) / free;
  const minB = along(node.dir, requiredArea(right, mins, gap)) / free;
  const pair = a + b;
  if (minA + minB > pair) return root; // 이미 좁다: 움직이지 않는다(영역이 스크롤한다)
  const nextA = Math.min(Math.max(a + delta, minA), pair - minB);
  const sizes = node.sizes.slice();
  sizes[index] = nextA;
  sizes[index + 1] = pair - nextA;
  return replaceAt(root, path, { ...node, sizes });
}

/** 칸 수와 틀을 바꾼다. 앞 번호 칸의 내용은 남고, 새 칸은 빈칸(`empty`)이다. */
export function withCount(doc: DashboardDoc, count: number, template: TemplateId): DashboardDoc {
  const panels = Array.from(
    { length: count },
    (_, i) => doc.panels[i] ?? { type: 'empty', options: {} },
  );
  return { ...doc, layout: { template, root: templateRoot(template) }, panels };
}
