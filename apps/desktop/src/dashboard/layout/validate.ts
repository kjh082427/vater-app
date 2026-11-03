/**
 * 불러온 대시보드 문서 확인(대시보드 설계 2장 "검증"). 사이드카는 모양만 보므로 뜻은 여기서 본다.
 * 1. 틀 id가 있고 칸 수가 맞는가: 아니면 그 장을 버린다
 * 2. 나무 모양이 틀과 같고 sizes가 양수이며 합이 1(오차 0.001)인가: 아니면 틀의 기본 비율
 * 3. 비율이 너무 치우쳐 큰 화면(3840×2160)에서도 최소 크기를 못 지키면: 틀의 기본 비율
 * 남는 장이 없으면 기본 문서. 모르는 내용 종류는 그대로 두고 그 칸이 안내한다.
 */
import { DEFAULT_DOC, defaultDoc } from './defaults';
import { GAP, requiredArea } from './geometry';
import { isMetricId, MAX_STRIP_METRICS, minOf } from './mins';
import { isTemplateId, templateRoot, TEMPLATES } from './templates';
import { isLeaf, type DashboardDoc, type DashboardsDoc, type Node, type PanelDoc } from './types';

export const MAX_DASHBOARDS = 8;
export const MAX_NAME = 20;
const MAX_ID = 40;
const SUM_TOLERANCE = 0.001;
const LARGEST = { w: 3840, h: 2160 };

export interface Validated {
  doc: DashboardsDoc;
  /** 고치거나 버린 것(개발자 기록용). 화면에 그대로 보이지 않는다. */
  problems: string[];
  /** 깨진 문서라 기본 문서로 열었다(정보 배너를 보인다). */
  fallback: boolean;
  /** 일부 장을 버렸거나 비율을 되돌렸다(정보 배너). 모르는 내용 종류는 그 칸이 안내하므로 넣지 않는다. */
  partial: boolean;
}

export const UNKNOWN_PANEL = '모르는 내용 종류';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 틀과 같은 나무 모양이고 비율이 올바른가. */
function sameShape(node: unknown, ref: Node): boolean {
  if (!isRecord(node)) return false;
  if (isLeaf(ref)) return node.panel === ref.panel && Object.keys(node).length === 1;
  const { dir, sizes, children } = node;
  if (dir !== ref.dir || !Array.isArray(sizes) || !Array.isArray(children)) return false;
  if (sizes.length !== ref.children.length || children.length !== ref.children.length) return false;
  if (!sizes.every((s) => typeof s === 'number' && Number.isFinite(s) && s > 0)) return false;
  const total = (sizes as number[]).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > SUM_TOLERANCE) return false;
  return children.every((c, i) => {
    const r = ref.children[i];
    return r !== undefined && sameShape(c, r);
  });
}

function readPanel(raw: unknown): PanelDoc | null {
  if (!isRecord(raw) || typeof raw.type !== 'string' || raw.type === '') return null;
  return { type: raw.type, options: isRecord(raw.options) ? raw.options : {} };
}

function readBoard(
  raw: unknown,
  i: number,
  known: Set<string>,
  problems: string[],
): DashboardDoc | null {
  const where = `${i + 1}번째 화면`;
  if (!isRecord(raw)) return (problems.push(`${where}: 객체가 아님`), null);
  const { id, name, kpi, layout, panels } = raw;
  if (typeof id !== 'string' || id.length < 1 || id.length > MAX_ID) {
    return (problems.push(`${where}: id가 올바르지 않음`), null);
  }
  if (typeof name !== 'string' || name.trim().length < 1 || name.length > MAX_NAME) {
    return (problems.push(`${where}: 이름이 올바르지 않음`), null);
  }
  if (!isRecord(layout) || !isTemplateId(layout.template)) {
    return (problems.push(`${where}: 모르는 배치 틀`), null);
  }
  const template = layout.template;
  const list = Array.isArray(panels) ? panels.map(readPanel) : [];
  if (list.length !== TEMPLATES[template].count || list.some((p) => p === null)) {
    return (problems.push(`${where}: 칸 수가 틀과 다름`), null);
  }
  const cells = list as PanelDoc[];
  for (const p of cells) {
    if (!known.has(p.type)) problems.push(`${where}: ${UNKNOWN_PANEL} ${p.type}`);
  }
  let root: Node = layout.root as Node;
  if (!sameShape(layout.root, TEMPLATES[template].root)) {
    problems.push(`${where}: 비율이 올바르지 않아 틀의 기본 비율로`);
    root = templateRoot(template);
  } else {
    const need = requiredArea(
      root,
      cells.map((p) => minOf(p.type)),
      GAP,
    );
    if (need.w > LARGEST.w || need.h > LARGEST.h) {
      problems.push(`${where}: 비율이 치우쳐 틀의 기본 비율로`);
      root = templateRoot(template);
    }
  }
  const strip = isRecord(kpi) ? kpi : {};
  const items = Array.isArray(strip.items) ? strip.items.filter(isMetricId) : [];
  return {
    id,
    name,
    kpi: {
      enabled: strip.enabled === true,
      items: [...new Set(items)].slice(0, MAX_STRIP_METRICS),
    },
    layout: { template, root },
    panels: cells,
  };
}

export function validateDoc(raw: unknown, known: Set<string>): Validated {
  const problems: string[] = [];
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.dashboards)) {
    return { doc: defaultDoc(), problems: ['문서 형식이 아님'], fallback: true, partial: false };
  }
  if (raw.dashboards.length === 0) {
    return { doc: defaultDoc(), problems, fallback: false, partial: false };
  }
  const seen = new Set<string>();
  const boards: DashboardDoc[] = [];
  raw.dashboards.forEach((b, i) => {
    const board = readBoard(b, i, known, problems);
    if (!board) return;
    if (seen.has(board.id)) return void problems.push(`${i + 1}번째 화면: id가 겹침`);
    seen.add(board.id);
    boards.push(board);
  });
  if (boards.length > MAX_DASHBOARDS) problems.push(`화면이 ${MAX_DASHBOARDS}장을 넘음`);
  if (boards.length === 0) {
    return { doc: structuredClone(DEFAULT_DOC), problems, fallback: true, partial: false };
  }
  return {
    doc: { version: 1, dashboards: boards.slice(0, MAX_DASHBOARDS) },
    problems,
    fallback: false,
    partial: problems.some((p) => !p.includes(UNKNOWN_PANEL)),
  };
}
