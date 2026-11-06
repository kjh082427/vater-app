import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { connection, holding } from '../../test/holdings';
import { renderWithServices } from '../../test/render';
import { mock } from '../../test/server';
import { HoldingsScreen } from './HoldingsScreen';

/** 삼성전자는 한투·메리츠에 나눠 보유(감시 중, 등락 있음), NAVER는 감시하지 않는 종목. */
function setup() {
  mock.db.connections = [
    connection({ id: 1, broker_id: 'kis', account_mask: '****7801' }),
    connection({ id: 2, broker_id: 'meritz', account_mask: '키 ab12' }),
  ];
  mock.db.holdings = [
    holding({ code: '005930', name: '삼성전자', quantity: '10', avg_price: 64000 }),
    holding({
      broker_id: 'meritz',
      connection_id: 2,
      code: '005930',
      name: '삼성전자',
      quantity: '5',
      avg_price: 70000,
    }),
    holding({ code: '035420', name: 'NAVER', quantity: '3', avg_price: 200000 }),
  ];
  mock.db.prices['KR:005930'] = 71400;
  mock.db.prices['KR:035420'] = 190000;
}

describe('보유 종목 화면', () => {
  it('종목별 현재가·등락·평가금액·평가손익과 증권사별 수량을 보인다', async () => {
    setup();
    renderWithServices(<HoldingsScreen />);
    await screen.findByRole('heading', { name: '보유 종목', level: 1 });
    const table = await screen.findByRole('table', { name: '보유 종목' });
    const samsung = within(table).getByRole('row', { name: /삼성전자/ });
    expect(samsung).toHaveTextContent('71,400원'); // 현재가
    expect(samsung).toHaveTextContent('1.71%'); // 등락(감시 중이라 시세가 있다)
    expect(samsung).toHaveTextContent('1,071,000원'); // 15주 × 71,400
    expect(samsung).toHaveTextContent('한국투자 10주');
    expect(samsung).toHaveTextContent('메리츠 5주');
    const naver = within(table).getByRole('row', { name: /NAVER/ });
    expect(naver).toHaveTextContent('190,000원');
    expect(naver).toHaveTextContent('570,000원');
    expect(naver).toHaveTextContent('−30,000원'); // 평가손익
    expect(naver).toHaveTextContent('한국투자 3주');
  });

  it('감시하지 않는 종목의 등락은 비어 있고 이유를 한 줄로 알린다', async () => {
    setup();
    renderWithServices(<HoldingsScreen />);
    const table = await screen.findByRole('table', { name: '보유 종목' });
    const naver = within(table).getByRole('row', { name: /NAVER/ });
    expect(within(naver).getAllByText('데이터 없음').length).toBeGreaterThan(0);
    expect(screen.getByText(/등락은 감시 중인 종목만 보입니다/)).toBeInTheDocument();
  });

  it('증권사를 연결하지 않았으면 연결 안내를 보이고, 직접 입력은 그대로 쓸 수 있다', async () => {
    renderWithServices(<HoldingsScreen />);
    expect(await screen.findByText(/증권사를 연결하면 보유 종목을 불러옵니다/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /설정 > 증권사 연결/ })).toHaveAttribute(
      'href',
      '#/settings',
    );
    expect(screen.getByRole('button', { name: '보유 종목 직접 추가' })).toBeInTheDocument();
    expect(await screen.findByText(/보유 내역이 없습니다/)).toBeInTheDocument();
  });

  it('[보유 종목 직접 추가]은 입력 창을, 증권사 버튼은 업로드 확인 창을 연다', async () => {
    setup();
    renderWithServices(<HoldingsScreen />);
    await userEvent.click(await screen.findByRole('button', { name: '보유 종목 직접 추가' }));
    const manual = await screen.findByRole('dialog', { name: '보유 내역 직접 입력' });
    await userEvent.keyboard('{Escape}');
    expect(manual).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: '한국투자' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('지원하지 않는 종목만 있으면 평가하지 않는다고 알린다', async () => {
    mock.db.connections = [connection({ id: 1, broker_id: 'kis' })];
    mock.db.holdings = [
      holding({
        code: '530031',
        name: '삼성 레버리지 ETN',
        supported: false,
        market: null,
        unsupported_reason: '종목 목록에 없는 상품입니다(ETN 등).',
      }),
    ];
    renderWithServices(<HoldingsScreen />);
    expect(await screen.findByText(/지원하지 않는 1종목/)).toBeInTheDocument();
  });
});
