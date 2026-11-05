import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AlertRule, WatchItem } from '../../api/types';
import { connection, holding } from '../../test/holdings';
import { renderWithServices } from '../../test/render';
import { mock, server } from '../../test/server';
import { StockOverview } from './StockOverview';

const samsung: WatchItem = {
  id: 1,
  market: 'KR',
  code: '005930',
  exchange: 'KOSPI',
  name: '삼성전자',
  created_at: '2026-11-02T09:00:00+09:00',
};
const apple: WatchItem = {
  id: 3,
  market: 'US',
  code: 'AAPL',
  exchange: 'NAS',
  name: '애플',
  created_at: '2026-11-02T09:00:00+09:00',
};

const bars = (n: number, start = 70000) =>
  Array.from({ length: n }, (_, i) => ({
    day: `2026-10-${String(i + 1).padStart(2, '0')}`,
    close: start + i * 100,
  }));

/** 스펙 4-2의 예: 한국투자 10주(평단 64,000) + 메리츠 5주(평단 64,000), 현재가 71,400. */
function held() {
  mock.db.brokers = mock.db.brokers.map((b) => b);
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
  ];
  mock.db.prices['KR:005930'] = 71400;
  mock.db.bars['KR:005930'] = bars(30);
}

function view(item = samsung, rule?: AlertRule) {
  return renderWithServices(
    <StockOverview item={item} rule={rule} onRulesChanged={() => undefined} />,
  );
}
const card = () => screen.findByRole('region', { name: '내 보유' });

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // 저장소가 막힌 환경
  }
});

describe('내 보유 카드', () => {
  it('스펙 예시 값: 평가금액, 평가손익, 총 수량·평단가, 시세 시각, 증권사 칩', async () => {
    held();
    view();
    const c = await card();
    expect(await within(c).findByText('1,071,000원')).toBeInTheDocument();
    expect(within(c).getByText('+111,000원 (+11.56%)')).toBeInTheDocument();
    expect(within(c).getByText('총 15주 · 평단가 64,000원')).toBeInTheDocument();
    expect(within(c).getByText('시세 14:05')).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: '한국투자 10주' })).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: '메리츠 5주' })).toBeInTheDocument();
    expect(
      within(c).getByRole('img', { name: /증권사별 비중: 한국투자 66.7%, 메리츠 33.3%/ }),
    ).toBeInTheDocument();
  });

  it('평가손익은 방향 색: 이익은 up, 손실은 down', async () => {
    held();
    view();
    const c = await card();
    const pl = await within(c).findByText('+111,000원 (+11.56%)');
    expect(pl).toHaveAttribute('data-direction', 'up');
  });

  it('칩을 누르면 모든 칩이 수량에서 비율로 바뀌고 마지막 선택을 기억한다', async () => {
    held();
    const first = view();
    const c = await card();
    await userEvent.click(await within(c).findByRole('button', { name: '한국투자 10주' }));
    expect(within(c).getByRole('button', { name: '한국투자 66.7%' })).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: '메리츠 33.3%' })).toBeInTheDocument();
    first.unmount();
    view();
    const again = await card();
    expect(
      await within(again).findByRole('button', { name: '한국투자 66.7%' }),
    ).toBeInTheDocument();
    await userEvent.click(within(again).getByRole('button', { name: '메리츠 33.3%' }));
    expect(within(again).getByRole('button', { name: '메리츠 5주' })).toBeInTheDocument();
  });

  it('칩이 셋이어도 비율 합이 100.0이다', async () => {
    held();
    mock.db.connections.push(connection({ id: 3, broker_id: 'kiwoom', account_mask: '키 cd34' }));
    mock.db.holdings = ['kis', 'meritz', 'kiwoom'].map((broker_id, i) =>
      holding({ code: '005930', name: '삼성전자', quantity: '5', broker_id, connection_id: i + 1 }),
    );
    view();
    const c = await card();
    await userEvent.click(await within(c).findByRole('button', { name: /^한국투자 5주/ }));
    const texts = within(c)
      .getAllByRole('button', { name: /%$/ })
      .map((b) => Number.parseFloat(b.textContent?.match(/[\d.]+(?=%)/)?.[0] ?? 'x'));
    expect(texts.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);
  });

  it('미국 수량은 소수점, 국내는 정수', async () => {
    mock.db.connections = [connection({ id: 1, broker_id: 'kis' })];
    mock.db.holdings = [
      holding({
        market: 'US',
        code: 'AAPL',
        name: '애플',
        quantity: '0.5',
        currency: 'USD',
        avg_price: 200,
      }),
    ];
    mock.db.prices['US:AAPL'] = 227.48;
    view(apple);
    const c = await card();
    expect(await within(c).findByText('총 0.5주 · 평단가 $200.00')).toBeInTheDocument();
    expect(within(c).getByText('$113.74')).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: '한국투자 0.5주' })).toBeInTheDocument();
  });

  it('시세가 없으면 평가금액·평가손익은 —이고 0으로 쓰지 않는다', async () => {
    held();
    delete mock.db.prices['KR:005930'];
    view();
    const c = await card();
    expect(await within(c).findByText('총 15주 · 평단가 64,000원')).toBeInTheDocument();
    const value = within(c).getByText('평가금액').parentElement as HTMLElement;
    expect(value).toHaveTextContent('—');
    expect(value).not.toHaveTextContent('0원');
    const pl = within(c).getByText('평가손익').parentElement as HTMLElement;
    expect(pl).toHaveTextContent('—');
    expect(c).not.toHaveTextContent('시세 14:05');
  });

  it('평단가를 모르면 평단가 —, 평단가를 모르는 수량은 손익에서 뺐다고 알린다', async () => {
    mock.db.connections = [connection({ id: 1, broker_id: 'kis' })];
    mock.db.holdings = [
      holding({ code: '005930', name: '삼성전자', quantity: '10', avg_price: null }),
    ];
    mock.db.prices['KR:005930'] = 71400;
    view();
    const c = await card();
    expect(await within(c).findByText('총 10주 · 평단가 —')).toBeInTheDocument();
    expect(
      within(c).getByText(/평단가를 모르는 10주는 손익 계산에서 뺐습니다/),
    ).toBeInTheDocument();
  });

  it('보유하지 않은 종목은 카드를 그리지 않는다', async () => {
    mock.db.bars['KR:005930'] = bars(30);
    view();
    await screen.findByRole('img', { name: /삼성전자 일봉/ });
    expect(screen.queryByRole('region', { name: '내 보유' })).not.toBeInTheDocument();
  });

  it('[새로 고침]은 보유를 다시 받고 값을 다시 그린다', async () => {
    held();
    const syncs: unknown[] = [];
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'POST' && request.url.endsWith('/holdings/sync')) {
        syncs.push(await request.clone().json());
      }
    });
    view();
    const c = await card();
    await within(c).findByText('1,071,000원');
    mock.db.prices['KR:005930'] = 72000;
    await userEvent.click(within(c).getByRole('button', { name: '새로 고침' }));
    expect(await within(c).findByText('1,080,000원')).toBeInTheDocument();
    expect(syncs).toEqual([{}]);
  });

  it('평단가 알림은 기본이 꺼짐, 켜면 기본값(−10%)으로 규칙을 만든다', async () => {
    held();
    const posts: unknown[] = [];
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'POST' && request.url.endsWith('/alerts/rules')) {
        posts.push(await request.clone().json());
      }
    });
    view();
    const c = await card();
    const sw = await within(c).findByRole('switch', { name: '평단가 대비 알림' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw);
    await waitFor(() =>
      expect(posts).toEqual([
        {
          watchlist_id: 1,
          kind: 'avg_price_pct',
          params: { pct: 10, direction: 'down' },
          enabled: true,
        },
      ]),
    );
  });

  it('평단가 알림이 이미 있으면 켜짐으로 보이고, 끄면 그 규칙을 지운다', async () => {
    held();
    const rule: AlertRule = {
      id: 40,
      watchlist_id: 1,
      kind: 'avg_price_pct',
      params: { pct: 10, direction: 'down' },
      timing: 'realtime',
      enabled: true,
      last_state: null,
      last_fired_at: null,
    };
    mock.db.rules.push(rule);
    const dels: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'DELETE') dels.push(new URL(request.url).pathname);
    });
    view(samsung, rule);
    const c = await card();
    const sw = await within(c).findByRole('switch', { name: '평단가 대비 알림' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(within(c).getByText(/내 평단가 대비 −10% 이하 하락/)).toBeInTheDocument();
    await userEvent.click(sw);
    await waitFor(() => expect(dels).toEqual(['/alerts/rules/40']));
  });
});

describe('주가 그래프', () => {
  it('일봉 선 그래프와 기간 전환(1개월/3개월/1년), 기본 3개월', async () => {
    held();
    const ranges: string[] = [];
    server.events.on('request:start', ({ request }) => {
      const u = new URL(request.url);
      if (u.pathname.endsWith('/bars')) ranges.push(u.searchParams.get('range') ?? '');
    });
    view();
    const chart = await screen.findByRole('img', { name: /삼성전자 일봉/ });
    expect(chart).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: '기간' });
    expect(within(group).getByRole('radio', { name: '3개월' })).toBeChecked();
    await userEvent.click(within(group).getByRole('radio', { name: '1개월' }));
    await waitFor(() => expect(ranges).toEqual(['3m', '1m']));
    await userEvent.click(within(group).getByRole('radio', { name: '1년' }));
    await waitFor(() => expect(ranges).toEqual(['3m', '1m', '1y']));
  });

  it('평단가 점선은 보유할 때만 그린다', async () => {
    held();
    const first = view();
    await screen.findByRole('img', { name: /삼성전자 일봉/ });
    await waitFor(() =>
      expect(first.container.querySelector('[data-role="baseline"]')).not.toBeNull(),
    );
    first.unmount();
    mock.db.holdings = [];
    mock.db.connections = [];
    const second = view();
    await screen.findByRole('img', { name: /삼성전자 일봉/ });
    await waitFor(() => expect(screen.queryByText('내 보유')).not.toBeInTheDocument());
    expect(second.container.querySelector('[data-role="baseline"]')).toBeNull();
  });

  it('그래프 자료가 없으면 이유와 함께 안내한다', async () => {
    mock.db.bars['KR:005930'] = [];
    view();
    expect(await screen.findByText(/일봉 자료가 없습니다/)).toBeInTheDocument();
  });

  it('일봉을 받지 못하면 오류와 다시 시도', async () => {
    server.use(
      http.get('*/symbols/:market/:code/bars', () =>
        HttpResponse.json(
          {
            code: 'KIS_UNAVAILABLE',
            message: '일봉을 받지 못했습니다.',
            hint: '잠시 뒤 다시 시도하세요.',
          },
          { status: 502 },
        ),
      ),
    );
    view();
    expect(await screen.findByText('일봉을 불러오지 못했습니다')).toBeInTheDocument();
    expect(
      screen.getByText(/일봉을 받지 못했습니다. 잠시 뒤 다시 시도하세요./),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
  });
});
