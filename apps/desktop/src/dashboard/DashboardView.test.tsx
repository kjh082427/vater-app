import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { errorResponse } from '../mocks/handlers';
import { emit, renderWithServices } from '../test/render';
import { mock, server } from '../test/server';
import { DashboardView } from './DashboardView';
import { templateRoot } from './layout/templates';
import type { DashboardDoc, TemplateId } from './layout/types';
import { chartSeries } from './panels/IndexChartPanel';

const TEMPLATE_BY_COUNT: Record<number, TemplateId> = {
  1: 'one',
  2: 'cols-2',
  3: 'cols-3',
  4: 'grid-2x2',
};

function boardOf(
  panels: { type: string; options?: Record<string, unknown> }[],
  kpi: string[] = [],
): DashboardDoc {
  const template = TEMPLATE_BY_COUNT[panels.length] ?? 'one';
  return {
    id: 't',
    name: '테스트',
    kpi: { enabled: kpi.length > 0, items: kpi },
    layout: { template, root: templateRoot(template) },
    panels: panels.map((p) => ({ type: p.type, options: p.options ?? {} })),
  };
}

const panel = (n: number, label: string) =>
  screen.findByRole('region', { name: `칸 ${n}: ${label}` });

const serverError = () =>
  errorResponse(
    500,
    'INTERNAL',
    '예상하지 못한 오류가 발생했습니다.',
    '로그 폴더를 확인해 주세요.',
  );

/** 요청 경로별 횟수. */
function countRequests() {
  const counts = new Map<string, number>();
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    const key = `${request.method} ${url.pathname}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return counts;
}

interface Case {
  type: string;
  label: string;
  path: string;
  normal: RegExp;
  empty: { set: () => void; text: RegExp };
}

const CASES: Case[] = [
  {
    type: 'watchlist',
    label: '감시 종목',
    path: '*/watchlist/quotes',
    normal: /삼성전자/,
    empty: { set: () => (mock.db.watchQuotes = []), text: /감시 종목이 없습니다/ },
  },
  {
    type: 'index-chart',
    label: '지수 차트',
    path: '*/market/indices',
    normal: /2,583\.27/,
    empty: { set: () => (mock.db.indices = []), text: /코스피 자료가 없습니다/ },
  },
  {
    type: 'briefing',
    label: '브리핑 요약',
    path: '*/briefings',
    normal: /반도체 대형주가 지수를 끌어올렸고/,
    empty: { set: () => (mock.db.briefings = []), text: /아직 국내 브리핑이 없습니다/ },
  },
  {
    type: 'recent-alerts',
    label: '최근 알림',
    path: '*/alerts/events',
    normal: /삼성전자 현재가 71,400/,
    empty: { set: () => (mock.db.events = []), text: /아직 울린 알림이 없습니다/ },
  },
  {
    type: 'running-analyses',
    label: '진행 중인 분석',
    path: '*/analyses',
    normal: /SK하이닉스|진행 중인 분석이 없습니다/,
    empty: {
      set: () => (mock.db.analyses = mock.db.analyses.filter((a) => a.status === 'done')),
      text: /진행 중인 분석이 없습니다/,
    },
  },
  {
    type: 'analysis-result',
    label: '분석 결과',
    path: '*/analyses',
    normal: /분석 보기/,
    empty: { set: () => (mock.db.analyses = []), text: /아직 끝난 분석이 없습니다/ },
  },
  {
    type: 'alert-history',
    label: '알림 이력',
    path: '*/alerts/events',
    normal: /SK하이닉스 RSI\(14\) 72\.4/,
    empty: { set: () => (mock.db.events = []), text: /아직 울린 알림이 없습니다/ },
  },
];

describe('칸 내용: 정상·빈 상태·오류', () => {
  it.each(CASES)('$type 정상', async (c) => {
    renderWithServices(<DashboardView board={boardOf([{ type: c.type }])} />);
    const region = await panel(1, c.label);
    expect((await within(region).findAllByText(c.normal)).length).toBeGreaterThan(0);
  });

  it.each(CASES)('$type 빈 상태', async (c) => {
    c.empty.set();
    renderWithServices(<DashboardView board={boardOf([{ type: c.type }])} />);
    const region = await panel(1, c.label);
    expect(await within(region).findByText(c.empty.text)).toBeInTheDocument();
  });

  it.each(CASES)('$type 오류는 사이드카 문구 그대로와 [다시 시도]', async (c) => {
    server.use(http.get(c.path, serverError));
    renderWithServices(<DashboardView board={boardOf([{ type: c.type }])} />);
    const region = await panel(1, c.label);
    expect(await within(region).findByText(/로그 폴더를 확인해 주세요/)).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
  });

  it('숫자 카드 칸: 고른 숫자(최대 4개)', async () => {
    renderWithServices(
      <DashboardView
        board={boardOf([
          { type: 'kpi', options: { metrics: ['kospi', 'watch-count', 'spx', 'comp', 'kosdaq'] } },
        ])}
      />,
    );
    const region = await panel(1, '숫자 카드');
    await within(region).findAllByText('2,583.27');
    expect(
      within(region)
        .getAllByRole('group')
        .map((g) => g.getAttribute('aria-label')),
    ).toEqual(['코스피', '감시 종목', 'S&P 500', '나스닥']);
  });
});

describe('지수 칸', () => {
  it('값·방향 색·전일 종가 점선', async () => {
    renderWithServices(<DashboardView board={boardOf([{ type: 'index-chart' }])} />);
    const region = await panel(1, '지수 차트');
    await within(region).findAllByText('2,583.27');
    expect(within(region).getByText('+21.48')).toHaveAttribute('data-direction', 'up');
    expect(within(region).getByText('+0.84%')).toHaveAttribute('data-direction', 'up');
    const chart = region.querySelector('[data-direction="up"] svg');
    expect(chart).not.toBeNull();
    expect(region.querySelector('[data-role="baseline"]')).not.toBeNull();
  });

  it('하락 지수는 파랑(down)', async () => {
    renderWithServices(
      <DashboardView board={boardOf([{ type: 'index-chart', options: { index: 'KOSDAQ' } }])} />,
    );
    const region = await panel(1, '지수 차트');
    expect(await within(region).findByText('−4.12')).toHaveAttribute('data-direction', 'down');
  });

  it('값이 null이면 "—"와 "데이터 없음"', async () => {
    renderWithServices(
      <DashboardView board={boardOf([{ type: 'index-chart', options: { index: 'COMP' } }])} />,
    );
    const region = await panel(1, '지수 차트');
    expect(await within(region).findAllByText('—')).not.toHaveLength(0);
    expect(within(region).getAllByText(/데이터 없음/).length).toBeGreaterThan(0);
  });

  it('마지막 종가와 value가 같으면(장 없는 시간) 점을 하나만', () => {
    const closes = [1, 2, 3];
    expect(
      chartSeries({
        code: 'SPX',
        name: 'S&P 500',
        market: 'US',
        value: 3,
        change: 1,
        change_pct: 50,
        at: null,
        closes,
      }),
    ).toEqual({ values: [1, 2, 3], baseline: 2 });
    expect(
      chartSeries({
        code: 'SPX',
        name: 'S&P 500',
        market: 'US',
        value: 4,
        change: 1,
        change_pct: 33,
        at: null,
        closes,
      }),
    ).toEqual({ values: [1, 2, 3, 4], baseline: 3 });
  });
});

describe('브리핑 칸', () => {
  it('수급 막대(억, 순매수 빨강)와 면책', async () => {
    renderWithServices(<DashboardView board={boardOf([{ type: 'briefing' }])} />);
    const region = await panel(1, '브리핑 요약');
    const bars = await within(region).findByRole('img', { name: /투자자별 순매수/ });
    expect(within(bars).getByText('+3,124억')).toBeInTheDocument();
    expect(bars.querySelector('[data-row="외국인"] [data-side="right"]')).not.toBeNull();
    expect(bars.querySelector('[data-row="기관"] [data-side="left"]')).not.toBeNull();
    expect(within(region).getByText(/투자 권유가 아닙니다/)).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: /브리핑 읽기/ })).toHaveAttribute(
      'href',
      '#/briefings/21',
    );
  });
});

describe('브리핑 칸: 값이 없는 투자자', () => {
  it('0억으로 지어내지 않고 막대에서 뺀다', async () => {
    const kr = mock.db.briefings.find((b) => b.market === 'KR');
    const flows = (kr?.data as { flows: { KOSPI: Record<string, unknown> } }).flows;
    flows.KOSPI.individual = null;
    renderWithServices(<DashboardView board={boardOf([{ type: 'briefing' }])} />);
    const region = await panel(1, '브리핑 요약');
    const bars = await within(region).findByRole('img', { name: /투자자별 순매수/ });
    expect(bars.querySelector('[data-row="개인"]')).toBeNull();
    expect(bars.querySelector('[data-row="외국인"]')).not.toBeNull();
  });
});

describe('감시 종목 칸', () => {
  it('SSE quote로 갱신되고, 행을 누르면 그 종목으로', async () => {
    const user = userEvent.setup();
    const { stream } = renderWithServices(
      <DashboardView board={boardOf([{ type: 'watchlist' }])} />,
    );
    const region = await panel(1, '감시 종목');
    await within(region).findByText('삼성전자');
    const source = await stream();
    emit(source, 'quote', {
      market: 'KR',
      code: '005930',
      price: 72500,
      change: 2300,
      change_pct: 3.28,
      at: '2026-11-03T14:10:00+09:00',
      source: 'realtime',
    });
    expect(await within(region).findByText('72,500원')).toBeInTheDocument();
    await user.click(within(region).getByText('삼성전자'));
    await waitFor(() => expect(window.location.hash).toBe('#/symbols/KR/005930'));
  });

  it('같은 내용 두 칸이면 /watchlist/quotes 요청은 1번이고 SSE는 두 칸 모두에', async () => {
    const counts = countRequests();
    const { stream } = renderWithServices(
      <DashboardView
        board={boardOf(
          [{ type: 'watchlist' }, { type: 'watchlist', options: { market: 'KR' } }],
          ['watch-count'],
        )}
      />,
    );
    const a = await panel(1, '감시 종목');
    const b = await panel(2, '감시 종목');
    await within(a).findByText('애플');
    await within(b).findByText('삼성전자');
    expect(within(b).queryByText('애플')).not.toBeInTheDocument();
    const source = await stream();
    emit(source, 'quote', {
      market: 'KR',
      code: '005930',
      price: 72500,
      change: 2300,
      change_pct: 3.28,
      at: '2026-11-03T14:10:00+09:00',
      source: 'realtime',
    });
    expect(await within(a).findByText('72,500원')).toBeInTheDocument();
    expect(within(b).getByText('72,500원')).toBeInTheDocument();
    expect(counts.get('GET /watchlist/quotes')).toBe(1);
  });
});

describe('칸마다 오류 경계', () => {
  it('한 칸이 예외를 던져도 다른 칸은 그려지고, [다시 시도]로 다시 그린다', async () => {
    const user = userEvent.setup();
    // 형식이 틀린 응답(배열 아님): 지수 칸이 그리다 예외를 던진다
    server.use(http.get('*/market/indices', () => HttpResponse.json({ broken: true })));
    renderWithServices(
      <DashboardView board={boardOf([{ type: 'index-chart' }, { type: 'recent-alerts' }])} />,
    );
    const chart = await panel(1, '지수 차트');
    const alerts = await panel(2, '최근 알림');
    expect(await within(chart).findByText('이 칸을 그리지 못했습니다')).toBeInTheDocument();
    expect(await within(alerts).findByText(/삼성전자 현재가 71,400/)).toBeInTheDocument();
    server.resetHandlers();
    server.use(http.get('*/market/indices', () => HttpResponse.json(mock.db.indices)));
    await user.click(within(chart).getByRole('button', { name: '다시 시도' }));
    expect((await within(chart).findAllByText('2,583.27')).length).toBeGreaterThan(0);
    expect(within(alerts).getByText(/삼성전자 현재가 71,400/)).toBeInTheDocument();
  });

  it('모르는 내용 종류면 그 칸만 안내', async () => {
    renderWithServices(
      <DashboardView board={boardOf([{ type: 'heatmap' }, { type: 'recent-alerts' }])} />,
    );
    expect(await screen.findByText('이 버전에서 지원하지 않는 내용입니다')).toBeInTheDocument();
    const alerts = await panel(2, '최근 알림');
    expect(await within(alerts).findByText(/삼성전자 현재가 71,400/)).toBeInTheDocument();
  });

  it('⋯ 메뉴 [새로 고침]은 그 칸의 자료를 다시 부른다', async () => {
    const user = userEvent.setup();
    const counts = countRequests();
    renderWithServices(<DashboardView board={boardOf([{ type: 'recent-alerts' }])} />);
    const region = await panel(1, '최근 알림');
    await within(region).findByText(/삼성전자 현재가 71,400/);
    await user.click(within(region).getByRole('button', { name: '칸 1 메뉴' }));
    await user.click(screen.getByRole('menuitem', { name: '새로 고침' }));
    await waitFor(() => expect(counts.get('GET /alerts/events')).toBe(2));
  });
});

describe('맨 위 숫자 줄', () => {
  it('숫자 5개', async () => {
    renderWithServices(
      <DashboardView
        board={boardOf(
          [{ type: 'recent-alerts' }],
          ['kospi', 'kosdaq', 'watch-count', 'alerts-today', 'analyses-running'],
        )}
      />,
    );
    const strip = await screen.findByRole('group', { name: '맨 위 숫자 줄' });
    const tiles = within(strip).getAllByRole('group');
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual([
      '코스피',
      '코스닥',
      '감시 종목',
      '오늘 알림',
      '진행 중인 분석',
    ]);
    expect(await within(tiles[0] as HTMLElement).findByText('2,583.27')).toBeInTheDocument();
    expect(await within(tiles[2] as HTMLElement).findByText('상승 2 · 하락 1')).toBeInTheDocument();
  });

  it('숫자 줄을 끄면 보이지 않는다', async () => {
    renderWithServices(<DashboardView board={boardOf([{ type: 'recent-alerts' }])} />);
    await panel(1, '최근 알림');
    expect(screen.queryByRole('group', { name: '맨 위 숫자 줄' })).not.toBeInTheDocument();
  });
});
