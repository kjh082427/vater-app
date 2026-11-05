import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { HistoryPoint } from '../../api/types';
import { connection, holding } from '../../test/holdings';
import { renderWithServices } from '../../test/render';
import { mock, server } from '../../test/server';
import { DashboardView } from '../DashboardView';
import { METRIC_IDS, PANEL_MINS } from '../layout/mins';
import { templateRoot } from '../layout/templates';
import { METRICS } from './metrics';
import { PANELS } from './registry';
import { WatchlistPanel } from './WatchlistPanel';

function renderPanel(type: string, options: Record<string, unknown> = {}) {
  window.location.hash = '#/home';
  return renderWithServices(
    <DashboardView
      board={{
        id: 't',
        name: '테스트',
        kpi: { enabled: false, items: [] },
        layout: { template: 'one', root: templateRoot('one') },
        panels: [{ type, options }],
      }}
    />,
  );
}
const section = (name: string) => screen.getByRole('region', { name: `칸 1: ${name}` });

/** 삼성전자 15주(평단 64,000, 현재가 71,400)와 애플 0.5주(평단 $200, 현재가 $227.48). */
function held() {
  mock.db.connections = [
    connection({ id: 1, broker_id: 'kis' }),
    connection({ id: 2, broker_id: 'meritz', account_mask: '키 ab12' }),
  ];
  mock.db.holdings = [
    holding({ code: '005930', name: '삼성전자', quantity: '10' }),
    holding({
      code: '005930',
      name: '삼성전자',
      quantity: '5',
      broker_id: 'meritz',
      connection_id: 2,
    }),
    holding({
      market: 'US',
      code: 'AAPL',
      name: '애플',
      quantity: '0.5',
      currency: 'USD',
      avg_price: 200,
    }),
  ];
  mock.db.prices['KR:005930'] = 71400;
  mock.db.prices['US:AAPL'] = 227.48;
}

const point = (
  day: string,
  value: number | null,
  cost: number | null,
  over: Partial<HistoryPoint> = {},
): HistoryPoint => ({
  day,
  value,
  cost,
  usdkrw: 1400,
  backfilled: false,
  ...over,
});

describe('칸 내용 목록과 최소 크기', () => {
  it('"내 보유 종목"과 "자산 추이"를 더했다', () => {
    expect(PANELS.holdings.label).toBe('내 보유 종목');
    expect(PANELS['asset-trend'].label).toBe('자산 추이');
    expect(PANEL_MINS.holdings).toEqual({ w: 360, h: 200 });
    expect(PANEL_MINS['asset-trend']).toEqual({ w: 360, h: 240 });
  });

  it('숫자 카드에 총 평가금액·총 평가손익을 더했다', () => {
    expect(METRIC_IDS).toContain('total-value');
    expect(METRIC_IDS).toContain('total-pl');
    expect(METRICS['total-value'].label).toBe('총 평가금액');
    expect(METRICS['total-pl'].label).toBe('총 평가손익');
  });
});

describe('내 보유 종목 칸', () => {
  it('종목별 보유·평단가·평가금액·평가손익(방향 색)과 합계', async () => {
    held();
    renderPanel('holdings');
    const table = await within(section('내 보유 종목')).findByRole('table', {
      name: '내 보유 종목',
    });
    const samsung = await within(table).findByRole('row', { name: /삼성전자/ });
    expect(within(samsung).getByText('15주')).toBeInTheDocument();
    expect(within(samsung).getByText('64,000원')).toBeInTheDocument();
    expect(within(samsung).getByText('1,071,000원')).toBeInTheDocument();
    expect(within(samsung).getByText('+111,000 (+11.56%)')).toHaveAttribute('data-direction', 'up');
    const apple = within(table).getByRole('row', { name: /애플/ });
    expect(within(apple).getByText('0.5주')).toBeInTheDocument();
    expect(within(apple).getByText('$113.74')).toBeInTheDocument();
  });

  it('시세가 없으면 평가금액·평가손익은 —이고 합계에서 빠졌다고 알린다', async () => {
    held();
    delete mock.db.prices['US:AAPL'];
    renderPanel('holdings');
    const card = section('내 보유 종목');
    const apple = await within(card).findByRole('row', { name: /애플/ });
    expect(within(apple).getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(
      within(card).getByText(/시세를 받지 못한 1종목은 합계에서 뺐습니다/),
    ).toBeInTheDocument();
  });

  it('보유 내역이 없으면 연결·직접 추가를 안내한다', async () => {
    renderPanel('holdings');
    const card = section('내 보유 종목');
    expect(await within(card).findByText(/보유 내역이 없습니다/)).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: '증권사 연결' })).toHaveAttribute(
      'href',
      '#/settings',
    );
  });

  it('오류면 원인과 해결 방법', async () => {
    server.use(
      http.get('*/portfolio/summary', () =>
        HttpResponse.json(
          {
            code: 'INTERNAL',
            message: '평가를 계산하지 못했습니다.',
            hint: '로그 폴더를 확인하세요.',
          },
          { status: 500 },
        ),
      ),
    );
    renderPanel('holdings');
    expect(
      await within(section('내 보유 종목')).findByText('보유 현황을 불러오지 못했습니다'),
    ).toBeInTheDocument();
  });
});

describe('숫자 카드: 총 평가금액·총 평가손익', () => {
  it('원화만 있으면 원화 합계와 손익, 달러가 있으면 환산 합계와 통화별', async () => {
    held();
    renderPanel('kpi', { metrics: ['total-value', 'total-pl'] });
    const card = section('숫자 카드');
    // 1,071,000원 + $113.74 × 1,400 = 1,230,236원
    expect(await within(card).findByText('1,230,236원')).toBeInTheDocument();
    expect(within(card).getByText(/원화 1,071,000원 · 달러 \$113.74/)).toBeInTheDocument();
    // 손익: 111,000 + (113.74 − 100) × 1,400 = 130,236
    expect(within(card).getByText('+130,236원')).toHaveAttribute('data-direction', 'up');
  });

  it('보유가 없으면 —와 안내', async () => {
    renderPanel('kpi', { metrics: ['total-value'] });
    const card = section('숫자 카드');
    expect(await within(card).findByText('보유 내역 없음')).toBeInTheDocument();
  });

  it('환율이 없으면 환산하지 않고 원화 합계만, 달러는 따로', async () => {
    held();
    mock.db.fx = { day: '2026-11-06', usdkrw: null };
    renderPanel('kpi', { metrics: ['total-value'] });
    const card = section('숫자 카드');
    expect(await within(card).findByText('1,071,000원')).toBeInTheDocument();
    expect(within(card).getByText(/달러 \$113.74 · 환율 없음/)).toBeInTheDocument();
  });
});

describe('자산 추이 칸', () => {
  it('평가금액·매입금액 두 선, 적용 환율과 미국 비중, "주식 평가금액"', async () => {
    held();
    mock.db.history = [
      point('2026-11-04', 1000000, 960000),
      point('2026-11-05', 1100000, 960000),
      point('2026-11-06', 1230236, 1100000),
    ];
    const { container } = renderPanel('asset-trend');
    const card = section('자산 추이');
    expect(await within(card).findByRole('img', { name: /주식 평가금액/ })).toBeInTheDocument();
    expect(container.querySelector('[data-role="secondary"]')).not.toBeNull();
    expect(within(card).getByText('평가금액')).toBeInTheDocument();
    expect(within(card).getByText('매입금액')).toBeInTheDocument();
    expect(within(card).getByText(/적용 환율 1,400원/)).toBeInTheDocument();
    // 미국 비중: 113.74 × 1,400 ÷ 1,230,236 = 12.9%
    expect(within(card).getByText(/미국 비중 12.9%/)).toBeInTheDocument();
  });

  it('보기 전환(전체/원화/달러)과 기간이 요청에 반영된다', async () => {
    held();
    mock.db.history = [point('2026-11-05', 1, 1), point('2026-11-06', 2, 1)];
    const asked: string[] = [];
    server.events.on('request:start', ({ request }) => {
      const u = new URL(request.url);
      if (u.pathname.endsWith('/portfolio/history'))
        asked.push(`${u.searchParams.get('range')}/${u.searchParams.get('view')}`);
    });
    renderPanel('asset-trend');
    const card = section('자산 추이');
    await within(card).findByRole('img', { name: /주식 평가금액/ });
    expect(asked).toEqual(['3m/all']);
    await userEvent.click(
      within(within(card).getByRole('radiogroup', { name: '보기' })).getByRole('radio', {
        name: '달러',
      }),
    );
    await waitFor(() => expect(asked).toContain('3m/usd'));
    await userEvent.click(
      within(within(card).getByRole('radiogroup', { name: '기간' })).getByRole('radio', {
        name: '1년',
      }),
    );
    await waitFor(() => expect(asked).toContain('1y/usd'));
    // 달러 보기에는 환율 안내가 없다
    expect(within(card).queryByText(/적용 환율/)).not.toBeInTheDocument();
  });

  it('환율이 없으면 전체 보기에 "환율 없음", 원화·달러 보기는 그대로', async () => {
    held();
    mock.db.fx = { day: '2026-11-06', usdkrw: null };
    mock.db.history = [
      point('2026-11-05', null, null, { usdkrw: null }),
      point('2026-11-06', null, null, { usdkrw: null }),
    ];
    renderPanel('asset-trend');
    const card = section('자산 추이');
    expect(await within(card).findByText(/환율 없음/)).toBeInTheDocument();
    expect(within(card).getByRole('radio', { name: '원화' })).toBeEnabled();
  });

  it('기록이 없으면 언제부터 쌓이는지 안내한다', async () => {
    held();
    mock.db.history = [];
    renderPanel('asset-trend');
    expect(
      await within(section('자산 추이')).findByText(/아직 기록이 없습니다/),
    ).toBeInTheDocument();
  });

  it('앱이 꺼져 있어 채운 날은 속이 빈 점과 문구로 알린다', async () => {
    held();
    mock.db.history = [
      point('2026-11-04', 1000000, 960000),
      point('2026-11-05', 1100000, 960000, { backfilled: true }),
      point('2026-11-06', 1230236, 1100000),
    ];
    const { container } = renderPanel('asset-trend');
    const card = section('자산 추이');
    await within(card).findByRole('img', { name: /주식 평가금액/ });
    expect(container.querySelectorAll('[data-role="filled-point"]')).toHaveLength(1);
    expect(within(card).getByText(/채운 날 1일/)).toBeInTheDocument();
  });
});

describe('감시 종목 표의 보유 열', () => {
  it('보유·평단가·평가손익 열을 더하고, 좁으면 평단가부터 숨긴다', async () => {
    held();
    mock.db.watchItems = mock.db.watchItems.filter((w) => w.code !== '000660');
    mock.db.watchQuotes = mock.db.watchQuotes.filter((q) => q.code !== '000660');
    renderPanel('watchlist');
    const table = await within(section('감시 종목')).findByRole('table', { name: '감시 종목' });
    const heads = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(heads).toEqual(expect.arrayContaining(['보유', '평단가', '평가손익']));
    const samsung = await within(table).findByRole('row', { name: /삼성전자/ });
    expect(within(samsung).getByText('15주')).toBeInTheDocument();
    expect(within(samsung).getByText('64,000원')).toBeInTheDocument();
    expect(within(samsung).getByText('+111,000 (+11.56%)')).toHaveAttribute('data-direction', 'up');
  });

  it.each([
    [800, ['평단가', '보유', '평가손익']],
    [650, ['보유', '평가손익']],
    [550, ['평가손익']],
    [480, []],
  ])('넓이 %ipx이면 보유 열은 %j만(평단가부터 숨김)', async (w, expected) => {
    held();
    renderWithServices(<WatchlistPanel options={{}} size={{ w, h: 300 }} />);
    const table = await screen.findByRole('table', { name: '감시 종목' });
    await within(table).findByRole('row', { name: /삼성전자/ });
    await waitFor(() => {
      const heads = within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent ?? '');
      expect(['평단가', '보유', '평가손익'].filter((h) => heads.includes(h)).sort()).toEqual(
        [...expected].sort(),
      );
    });
  });

  it('보유 내역이 없으면 열을 더하지 않는다', async () => {
    renderPanel('watchlist');
    const table = await within(section('감시 종목')).findByRole('table', { name: '감시 종목' });
    const heads = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(heads).not.toContain('보유');
  });
});
