import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CategoryStock } from '../../api/types';
import { renderWithServices } from '../../test/render';
import { mock, server } from '../../test/server';
import { CategoryBrowser } from './CategoryBrowser';

const stock = (
  code: string,
  name: string,
  market: 'KR' | 'US' = 'KR',
  mids: string[] = [],
): CategoryStock => ({
  market,
  code,
  exchange: market === 'KR' ? 'KOSPI' : 'NAS',
  name,
  name_en: null,
  kind: 'stock',
  mids,
});

const SAMSUNG = stock('005930', '삼성전자', 'KR', ['semi']);
const HYNIX = stock('000660', 'SK하이닉스', 'KR', ['semi']);
const NVDA = stock('NVDA', '엔비디아', 'US', ['semi']);
const CATL = stock('373220', 'LG에너지솔루션', 'KR', ['battery']);

function tree() {
  mock.db.categories = [
    {
      id: 'tech',
      name: '기술',
      mids: [
        { id: 'semi', name: '반도체' },
        { id: 'battery', name: '2차전지' },
      ],
    },
    { id: 'unclassified', name: '미분류', mids: [] },
  ];
  mock.db.categoryStocks = {
    tech: [SAMSUNG, HYNIX, NVDA, CATL],
    semi: [SAMSUNG, HYNIX, NVDA],
    battery: [CATL],
    unclassified: [],
  };
}

function asked() {
  const seen: string[] = [];
  server.events.on('request:start', ({ request }) => {
    const u = new URL(request.url);
    if (u.pathname.endsWith('/categories/stocks')) {
      seen.push(`${u.searchParams.get('node')}/${u.searchParams.get('market')}`);
    }
  });
  return seen;
}

const onPick = vi.fn();
/** 처음에는 접혀 있다(검색창 아래의 [분류로 찾기]). */
async function view(marked?: { keys: ReadonlySet<string>; label: string }) {
  const result = renderWithServices(
    <CategoryBrowser actionLabel="선택" onPick={onPick} marked={marked} />,
  );
  await userEvent.click(screen.getByRole('button', { name: '분류로 찾기' }));
  return result;
}

describe('분류로 찾기', () => {
  it('시장 칸은 [통합 | 한국 | 미국], 기본은 통합', async () => {
    tree();
    await view();
    const group = await screen.findByRole('radiogroup', { name: '시장' });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['통합', '한국', '미국']);
    expect(within(group).getByRole('radio', { name: '통합' })).toBeChecked();
  });

  it('대분류에서 멈춰도 그 아래 종목을 모두 보여 준다', async () => {
    tree();
    const seen = asked();
    await view();
    await userEvent.click(await screen.findByRole('button', { name: '기술' }));
    const list = await screen.findByRole('list', { name: '분류의 종목' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    expect(seen).toEqual(['tech/ALL']);
  });

  it('중분류로 들어가면 그 중분류의 종목만, 소분류 단계는 없다', async () => {
    tree();
    const seen = asked();
    await view();
    await userEvent.click(await screen.findByRole('button', { name: '기술' }));
    await userEvent.click(await screen.findByRole('button', { name: '반도체' }));
    const list = await screen.findByRole('list', { name: '분류의 종목' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3));
    expect(seen).toContain('semi/ALL');
    expect(screen.queryByText('소분류')).not.toBeInTheDocument();
  });

  it('시장을 바꿔도 고른 분류는 유지하고 그 시장 종목만 다시 받는다', async () => {
    tree();
    const seen = asked();
    await view();
    await userEvent.click(await screen.findByRole('button', { name: '기술' }));
    await userEvent.click(await screen.findByRole('button', { name: '반도체' }));
    await screen.findByText('엔비디아');
    await userEvent.click(
      within(screen.getByRole('radiogroup', { name: '시장' })).getByRole('radio', { name: '한국' }),
    );
    await waitFor(() => expect(seen).toContain('semi/KR'));
    expect(screen.getByRole('button', { name: '반도체' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '기술' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.queryByText('엔비디아')).not.toBeInTheDocument());
    expect(screen.getByText('삼성전자')).toBeInTheDocument();
  });

  it('종목을 고르면 onPick, 이미 표시된 종목은 버튼 대신 표시', async () => {
    tree();
    onPick.mockClear();
    await view({ keys: new Set(['KR:005930']), label: '감시 중' });
    await userEvent.click(await screen.findByRole('button', { name: '기술' }));
    await userEvent.click(await screen.findByRole('button', { name: 'SK하이닉스 선택' }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ code: '000660', market: 'KR' }));
    expect(screen.queryByRole('button', { name: '삼성전자 선택' })).not.toBeInTheDocument();
    expect(screen.getByText('감시 중')).toBeInTheDocument();
  });

  it('검색 결과 종목이 100개를 넘으면 잘랐다고 알린다', async () => {
    tree();
    mock.db.categoryStocks.semi = Array.from({ length: 130 }, (_, i) =>
      stock(String(100000 + i), `반도체종목${i}`),
    );
    await view();
    await userEvent.type(await screen.findByLabelText('분류 검색'), '반도체종목');
    const list = await screen.findByRole('list', { name: '찾은 종목' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(100);
    expect(screen.getByText('상위 100개만 표시, 이름으로 검색해 주세요')).toBeInTheDocument();
  });

  it('미분류는 수천 개여도 처음 100개만 그리고 [더 보기]로 늘린다', async () => {
    tree();
    mock.db.categoryStocks.unclassified = Array.from({ length: 3000 }, (_, i) =>
      stock(String(100000 + i), `종목${i}`),
    );
    await view();
    await userEvent.click(await screen.findByRole('button', { name: '미분류' }));
    const list = await screen.findByRole('list', { name: '분류의 종목' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(100);
    expect(
      screen.getByText('3,000개 중 100개를 보고 있습니다. 이름으로 검색하면 더 빨리 찾습니다.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '더 보기' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(200);
  });

  it('분류에 종목이 없으면 그렇게 알린다', async () => {
    tree();
    await view();
    await userEvent.click(await screen.findByRole('button', { name: '미분류' }));
    expect(await screen.findByText(/이 분류에는 고른 시장의 종목이 없습니다/)).toBeInTheDocument();
  });

  it('키워드로 분류와 종목을 찾고, 분류를 누르면 그 분류가 선택된다', async () => {
    tree();
    await view();
    await userEvent.type(await screen.findByLabelText('분류 검색'), '반도');
    const hit = await screen.findByRole('button', { name: /반도체/ });
    expect(hit).toBeInTheDocument();
    await userEvent.click(hit);
    expect(await screen.findByText('엔비디아')).toBeInTheDocument();
  });

  it('분류표를 받지 못하면 원인과 다시 시도', async () => {
    const { http, HttpResponse } = await import('msw');
    server.use(
      http.get('*/categories', () =>
        HttpResponse.json(
          { code: 'INTERNAL', message: '분류표를 읽지 못했습니다.', hint: '앱을 다시 시작하세요.' },
          { status: 500 },
        ),
      ),
    );
    await view();
    expect(await screen.findByText('분류를 불러오지 못했습니다')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
  });
});
