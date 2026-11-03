/**
 * 대시보드 문서 형식(대시보드 설계 2·4장). 사이드카는 모양(크기·장 수·칸 수)만 확인하고,
 * 틀·비율·내용 종류의 뜻은 화면이 확인한다(validate.ts).
 */

/** 분할 나무. row는 아이들을 가로로(왼쪽→오른쪽), col은 세로로(위→아래) 놓는다. sizes 합 = 1. */
export type Split = { dir: 'row' | 'col'; sizes: number[]; children: Node[] };
/** panel = 칸 번호(0부터). 칸 번호는 panels 배열의 순번이다. */
export type Leaf = { panel: number };
export type Node = Split | Leaf;

export interface Size {
  w: number;
  h: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

export type TemplateId =
  | 'one'
  | 'cols-2'
  | 'rows-2'
  | 'left-big-3'
  | 'top-big-3'
  | 'cols-3'
  | 'grid-2x2'
  | 'left-big-4'
  | 'top-big-4'
  | 'cols-4'
  | 'top2-bottom3'
  | 'left-big-5'
  | 'grid-2x3'
  | 'grid-3x2';

/** 칸 1개의 내용. type은 모르는 값일 수 있다(새 버전에서 생긴 내용). `empty`는 편집 중의 빈칸. */
export interface PanelDoc {
  type: string;
  options: Record<string, unknown>;
}

export interface DashboardDoc {
  id: string;
  name: string;
  /** 맨 위 숫자 줄. items는 숫자 id(METRICS), 최대 5개. */
  kpi: { enabled: boolean; items: string[] };
  layout: { template: TemplateId; root: Node };
  panels: PanelDoc[];
}

export interface DashboardsDoc {
  version: 1;
  dashboards: DashboardDoc[];
}

export const isLeaf = (node: Node): node is Leaf => 'panel' in node;
