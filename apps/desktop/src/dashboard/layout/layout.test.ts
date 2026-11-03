import { describe, expect, it } from 'vitest';
import { PANEL_MINS, minOf } from './mins';
import {
  AREA_1024x600,
  AREA_1280x800,
  GAP,
  computeRects,
  dashboardArea,
  fits,
  requiredArea,
  resizeAt,
  withCount,
} from './geometry';
import { TEMPLATES, templatesFor, TEMPLATE_IDS } from './templates';
import { DEFAULT_DOC, defaultDashboard } from './defaults';
import type { DashboardDoc, Node, Split, TemplateId } from './types';
import { validateDoc } from './validate';

const KNOWN = new Set(Object.keys(PANEL_MINS));
const at = <T>(xs: T[], i: number): T => {
  const v = xs[i];
  if (v === undefined) throw new Error(`${i}번 없음`);
  return v;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function splits(node: Node): Split[] {
  return 'panel' in node ? [] : [node, ...node.children.flatMap(splits)];
}

function board(template: TemplateId, types: string[]): DashboardDoc {
  return {
    id: `b-${template}`,
    name: template,
    kpi: { enabled: false, items: [] },
    layout: { template, root: structuredClone(TEMPLATES[template].root) },
    panels: types.map((type) => ({ type, options: {} })),
  };
}

describe('틀 목록', () => {
  it('칸 수별 틀 id가 정해진 목록이다', () => {
    expect([1, 2, 3, 4, 5, 6].map(templatesFor)).toEqual([
      ['one'],
      ['cols-2', 'rows-2'],
      ['left-big-3', 'top-big-3', 'cols-3'],
      ['grid-2x2', 'left-big-4', 'top-big-4', 'cols-4'],
      ['top2-bottom3', 'left-big-5'],
      ['grid-2x3', 'grid-3x2'],
    ]);
    expect(templatesFor(7)).toEqual([]);
  });

  it.each(TEMPLATE_IDS)('%s: 칸 수가 count이고 넓이 합 = 영역 − 틈', (id) => {
    const t = TEMPLATES[id];
    const area = { w: 1000, h: 600 };
    const rects = computeRects(t.root, area, GAP);
    expect(rects).toHaveLength(t.count);
    rects.forEach((r, i) => expect(r, `칸 ${i}`).toBeDefined());
    // 틈의 넓이: 분할마다 (아이 수 − 1) × 틈 × 그 분할의 다른 변
    let gapArea = 0;
    const walk = (node: Node, a: { w: number; h: number }) => {
      if ('panel' in node) return;
      const n = node.children.length;
      const along = node.dir === 'row' ? a.w : a.h;
      const cross = node.dir === 'row' ? a.h : a.w;
      gapArea += (n - 1) * GAP * cross;
      const free = along - GAP * (n - 1);
      node.children.forEach((c, i) => {
        const len = free * (node.sizes[i] ?? 0);
        walk(c, node.dir === 'row' ? { w: len, h: a.h } : { w: a.w, h: len });
      });
    };
    walk(t.root, area);
    expect(sum(rects.map((r) => r.w * r.h)) + gapArea).toBeCloseTo(area.w * area.h, 3);
    for (const s of splits(t.root)) expect(sum(s.sizes)).toBeCloseTo(1, 6);
  });

  it('칸끼리 겹치지 않고 영역 안에 있다', () => {
    for (const id of TEMPLATE_IDS) {
      const rects = computeRects(TEMPLATES[id].root, { w: 1000, h: 600 }, GAP);
      rects.forEach((a, i) => {
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.y + a.h).toBeLessThanOrEqual(600 + 1e-6);
        rects.slice(i + 1).forEach((b) => {
          const overlap =
            a.x < b.x + b.w - 1e-6 &&
            b.x < a.x + a.w - 1e-6 &&
            a.y < b.y + b.h - 1e-6 &&
            b.y < a.y + a.h - 1e-6;
          expect(overlap, `${id}`).toBe(false);
        });
      });
    }
  });
});

describe('맞는지 판정', () => {
  it('실제 영역 상수: 사이드바·여백·탭·숫자 줄을 뺀 크기', () => {
    expect(AREA_1024x600).toEqual(dashboardArea({ w: 1024, h: 600 }, true));
    expect(AREA_1024x600.w).toBe(1024 - 200 - 32);
    expect(dashboardArea({ w: 1024, h: 600 }, false).h).toBeGreaterThan(AREA_1024x600.h);
  });

  it('cols-4는 1024×600에서 감시 종목이 들어가지 않는다', () => {
    const b = board('cols-4', ['watchlist', 'briefing', 'kpi', 'kpi']);
    const r = fits(
      b.layout.root,
      AREA_1024x600,
      b.panels.map((p) => minOf(p.type)),
      GAP,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.panel).toBe(0);
      expect(r.need).toEqual(PANEL_MINS.watchlist);
      expect(r.got.w).toBeLessThan(360);
      expect(Math.round(r.got.w)).toBe(189);
    }
  });

  it('1280×800 판정 기록: cols-4 감시 종목은 여전히 막히고, 기본 대시보드는 둘 다 들어간다', () => {
    const b = board('cols-4', ['watchlist', 'briefing', 'kpi', 'kpi']);
    const mins = b.panels.map((p) => minOf(p.type));
    const r = fits(b.layout.root, AREA_1280x800, mins, GAP);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Math.round(r.got.w)).toBe(253);
    const d = at(DEFAULT_DOC.dashboards, 0);
    const dmins = d.panels.map((p) => minOf(p.type));
    expect(fits(d.layout.root, AREA_1024x600, dmins, GAP)).toEqual({ ok: true });
    expect(fits(d.layout.root, AREA_1280x800, dmins, GAP)).toEqual({ ok: true });
  });

  it('requiredArea: 이 비율로 모든 칸이 최소 크기를 지키는 가장 작은 영역', () => {
    const b = board('cols-4', ['watchlist', 'watchlist', 'watchlist', 'watchlist']);
    const mins = b.panels.map((p) => minOf(p.type));
    const need = requiredArea(b.layout.root, mins, GAP);
    expect(need.w).toBeCloseTo(360 * 4 + 3 * GAP, 6);
    expect(need.h).toBe(180);
    expect(fits(b.layout.root, need, mins, GAP)).toEqual({ ok: true });
  });
});

describe('경계선 조절', () => {
  const b = board('cols-2', ['watchlist', 'briefing']);
  const mins = b.panels.map((p) => minOf(p.type));
  const area = { w: 1012, h: 400 }; // 칸에 쓰는 너비 1000

  it('비율을 옮기고 합 1을 지킨다', () => {
    const next = resizeAt(b.layout.root, [], 0, 0.1, area, mins, GAP) as Split;
    expect(next.sizes[0]).toBeCloseTo(0.6, 6);
    expect(sum(next.sizes)).toBeCloseTo(1, 9);
    expect((b.layout.root as Split).sizes).toEqual([0.5, 0.5]); // 원본은 그대로
  });

  it('최소 크기에서 멈춘다', () => {
    const right = resizeAt(b.layout.root, [], 0, 0.5, area, mins, GAP) as Split;
    expect(right.sizes[1]).toBeCloseTo(300 / 1000, 6); // 브리핑 최소 300
    const left = resizeAt(b.layout.root, [], 0, -0.5, area, mins, GAP) as Split;
    expect(left.sizes[0]).toBeCloseTo(360 / 1000, 6); // 감시 종목 최소 360
    expect(sum(left.sizes)).toBeCloseTo(1, 9);
  });

  it('안쪽 분할도 path로 찾는다', () => {
    const t = board('left-big-3', ['briefing', 'kpi', 'kpi']);
    const m = t.panels.map((p) => minOf(p.type));
    const next = resizeAt(t.layout.root, [1], 0, 0.1, { w: 1000, h: 612 }, m, GAP) as Split;
    const inner = next.children[1] as Split;
    expect(inner.sizes[0]).toBeCloseTo(0.6, 6);
    expect(sum(inner.sizes)).toBeCloseTo(1, 9);
  });
});

describe('칸 수 바꾸기', () => {
  it('앞 번호 칸 내용은 남고 새 칸은 빈칸이다', () => {
    const d = board('grid-2x2', ['watchlist', 'briefing', 'kpi', 'recent-alerts']);
    const two = withCount(d, 2, 'cols-2');
    expect(two.panels.map((p) => p.type)).toEqual(['watchlist', 'briefing']);
    expect(two.layout).toEqual({ template: 'cols-2', root: TEMPLATES['cols-2'].root });
    const five = withCount(two, 5, 'top2-bottom3');
    expect(five.panels.map((p) => p.type)).toEqual([
      'watchlist',
      'briefing',
      'empty',
      'empty',
      'empty',
    ]);
    expect(five.id).toBe(d.id);
    expect(five.name).toBe(d.name);
  });
});

describe('validateDoc', () => {
  const good = () => ({ version: 1, dashboards: [board('cols-2', ['watchlist', 'briefing'])] });

  it('문서가 아니면 기본 문서', () => {
    for (const raw of [null, 'x', 3, [], { version: 2, dashboards: [] }, { version: 1 }]) {
      const r = validateDoc(raw, KNOWN);
      expect(r.doc).toEqual(DEFAULT_DOC);
      expect(r.fallback).toBe(true);
      expect(r.problems.length).toBeGreaterThan(0);
    }
  });

  it('처음(빈 문서)은 기본 문서이고 문제가 아니다', () => {
    const r = validateDoc({ version: 1, dashboards: [] }, KNOWN);
    expect(r.doc).toEqual(DEFAULT_DOC);
    expect(r.problems).toEqual([]);
    expect(r.fallback).toBe(false);
  });

  it('올바른 문서는 그대로', () => {
    const r = validateDoc(good(), KNOWN);
    expect(r.doc).toEqual(good());
    expect(r.problems).toEqual([]);
  });

  it('sizes 합이 1이 아니면 틀의 기본 비율', () => {
    const raw = good();
    (at(raw.dashboards, 0).layout.root as Split).sizes = [0.7, 0.7];
    const r = validateDoc(raw, KNOWN);
    expect(at(r.doc.dashboards, 0).layout.root).toEqual(TEMPLATES['cols-2'].root);
    expect(r.problems).toHaveLength(1);
  });

  it('음수 비율이나 나무 모양이 틀과 다르면 틀의 기본 비율', () => {
    const raw = good();
    (at(raw.dashboards, 0).layout.root as Split).sizes = [1.2, -0.2];
    expect(at(validateDoc(raw, KNOWN).doc.dashboards, 0).layout.root).toEqual(
      TEMPLATES['cols-2'].root,
    );
    const raw2 = good();
    (at(raw2.dashboards, 0).layout.root as Split).dir = 'col';
    expect(at(validateDoc(raw2, KNOWN).doc.dashboards, 0).layout.root).toEqual(
      TEMPLATES['cols-2'].root,
    );
  });

  it('비율이 너무 치우쳐 어떤 창에서도 최소 크기를 못 지키면 기본 비율', () => {
    const raw = good();
    (at(raw.dashboards, 0).layout.root as Split).sizes = [0.999, 0.001];
    const r = validateDoc(raw, KNOWN);
    expect(at(r.doc.dashboards, 0).layout.root).toEqual(TEMPLATES['cols-2'].root);
  });

  it('틀 id를 모르거나 칸 수가 틀과 다르면 그 장만 버린다', () => {
    const raw = {
      version: 1,
      dashboards: [
        {
          ...board('cols-2', ['watchlist', 'briefing']),
          id: 'a',
          layout: { template: 'zig', root: {} },
        },
        { ...board('cols-2', ['watchlist']), id: 'b' },
        board('one', ['briefing']),
      ],
    };
    const r = validateDoc(raw, KNOWN);
    expect(r.doc.dashboards.map((d) => d.id)).toEqual(['b-one']);
    expect(r.problems).toHaveLength(2);
    expect(r.fallback).toBe(false);
  });

  it('모든 장이 깨지면 기본 문서', () => {
    const raw = { version: 1, dashboards: [{ id: 'x' }, 'y'] };
    const r = validateDoc(raw, KNOWN);
    expect(r.doc).toEqual(DEFAULT_DOC);
    expect(r.fallback).toBe(true);
  });

  it('모르는 내용 종류는 그대로 두고 problems에 기록', () => {
    const raw = { version: 1, dashboards: [board('cols-2', ['watchlist', 'heatmap'])] };
    const r = validateDoc(raw, KNOWN);
    expect(at(r.doc.dashboards, 0).panels[1]).toEqual({ type: 'heatmap', options: {} });
    expect(r.problems).toEqual([expect.stringContaining('heatmap')]);
  });

  it('이름·id가 틀리거나 겹치면 그 장을 버리고, 8장까지만, 숫자 줄은 5개까지', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      ...board('one', ['briefing']),
      id: `d${i}`,
      kpi: {
        enabled: true,
        items: ['kospi', 'kosdaq', 'spx', 'comp', 'watch-count', 'alerts-today'],
      },
    }));
    many[1] = { ...at(many, 1), name: '' };
    many[2] = { ...at(many, 2), id: 'd0' };
    const r = validateDoc({ version: 1, dashboards: many }, KNOWN);
    expect(r.doc.dashboards).toHaveLength(8);
    expect(r.doc.dashboards.map((d) => d.id)).not.toContain('d1');
    expect(at(r.doc.dashboards, 0).kpi.items).toHaveLength(5);
  });

  it('defaultDashboard는 기본 칸 4개와 숫자 줄', () => {
    const d = defaultDashboard('home');
    expect(d.layout.template).toBe('grid-2x2');
    expect(d.panels.map((p) => p.type)).toEqual([
      'index-chart',
      'briefing',
      'watchlist',
      'recent-alerts',
    ]);
    expect(d.kpi).toEqual({
      enabled: true,
      items: ['kospi', 'kosdaq', 'watch-count', 'alerts-today', 'analyses-running'],
    });
    expect(at(DEFAULT_DOC.dashboards, 0).name).toBe('기본');
  });
});
