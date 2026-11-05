import { readFileSync } from 'node:fs';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { connection, holding } from '../../test/holdings';
import { renderWithServices } from '../../test/render';
import { mock, server } from '../../test/server';
import { App } from '../../app/App';

function renderForm() {
  window.location.hash = '#/analyses';
  return renderWithServices(<App />);
}

function postedAnalyses() {
  const bodies: unknown[] = [];
  server.events.on('request:start', async ({ request }) => {
    if (request.method === 'POST' && new URL(request.url).pathname === '/analyses') {
      bodies.push(await request.clone().json());
    }
  });
  return bodies;
}

const formEl = () => screen.findByRole('form', { name: '새 분석' });

describe('분석 창에서 감시 종목 바로 고르기(스펙 19장)', () => {
  it('감시 종목을 누르면 검색 없이 그 종목이 선택된다', async () => {
    const posts = postedAnalyses();
    renderForm();
    const form = await formEl();
    const list = await within(form).findByRole('list', { name: '감시 종목에서 고르기' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    await userEvent.click(within(list).getByRole('button', { name: '감시 종목 SK하이닉스' }));
    expect(within(form).getByText('SK하이닉스')).toBeInTheDocument();
    expect(
      within(form).queryByRole('list', { name: '감시 종목에서 고르기' }),
    ).not.toBeInTheDocument();
    await userEvent.click(within(form).getByRole('button', { name: '분석 시작' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ market: 'KR', code: '000660' });
  });

  it('감시 종목이 없으면 목록을 숨긴다', async () => {
    mock.db.watchItems = [];
    mock.db.watchQuotes = [];
    renderForm();
    const form = await formEl();
    await within(form).findByRole('searchbox', { name: '종목 검색' });
    // 불러오기가 끝날 시간을 준다
    await new Promise((r) => setTimeout(r, 50));
    expect(
      within(form).queryByRole('list', { name: '감시 종목에서 고르기' }),
    ).not.toBeInTheDocument();
    expect(within(form).queryByText('감시 종목에서 고르기')).not.toBeInTheDocument();
  });

  it('검색은 그대로 쓸 수 있다', async () => {
    renderForm();
    const form = await formEl();
    await userEvent.type(within(form).getByRole('searchbox', { name: '종목 검색' }), 'NAVER');
    await userEvent.click(await within(form).findByRole('button', { name: 'NAVER 선택' }));
    expect(within(form).getByText('035420')).toBeInTheDocument();
  });

  it('제출 내용에는 고른 한 종목만 있다(감시 종목 전체나 보유 내역은 보내지 않는다)', async () => {
    mock.db.connections = [connection({ id: 1, broker_id: 'kis' })];
    mock.db.holdings = [holding({ code: '005930', name: '삼성전자', quantity: '15' })];
    mock.db.prices['KR:005930'] = 71400;
    const posts = postedAnalyses();
    const all: string[] = [];
    server.events.on('request:start', async ({ request }) => {
      if (request.method !== 'GET') all.push(await request.clone().text());
    });
    renderForm();
    const form = await formEl();
    await userEvent.click(await within(form).findByRole('button', { name: '감시 종목 삼성전자' }));
    await userEvent.click(within(form).getByRole('button', { name: '분석 시작' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ market: 'KR', code: '005930' });
    const text = all.join('\n');
    for (const secret of [
      '15',
      'quantity',
      'avg_price',
      '64000',
      'holdings',
      'SK하이닉스',
      '애플',
    ]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('목록에는 보유 여부나 수량을 표시하지 않는다', async () => {
    mock.db.connections = [connection({ id: 1, broker_id: 'kis' })];
    mock.db.holdings = [holding({ code: '005930', name: '삼성전자', quantity: '15' })];
    renderForm();
    const form = await formEl();
    const list = await within(form).findByRole('list', { name: '감시 종목에서 고르기' });
    expect(list).not.toHaveTextContent(/보유|15주|평단/);
  });

  it('[다른 종목]을 누르면 목록이 다시 보인다', async () => {
    renderForm();
    const form = await formEl();
    await userEvent.click(await within(form).findByRole('button', { name: '감시 종목 애플' }));
    await userEvent.click(within(form).getByRole('button', { name: '다른 종목' }));
    expect(
      await within(form).findByRole('list', { name: '감시 종목에서 고르기' }),
    ).toBeInTheDocument();
  });
});

describe('감시 종목 고르기 목록', () => {
  it('감시 종목이 많아도 목록은 높이 제한 안에서 스크롤한다', () => {
    const css = readFileSync('src/screens/analysis/analysis.module.css', 'utf8');
    const rule = /\.watchChoices\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/max-height:\s*[\d.]+rem/);
    expect(rule).toMatch(/overflow-y:\s*auto/);
  });
});
