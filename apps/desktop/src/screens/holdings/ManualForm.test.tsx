import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connection, holding } from '../../test/holdings';
import { renderWithServices } from '../../test/render';
import { mock, server } from '../../test/server';
import { ManualDialog } from './ManualForm';

function capture(method: string, pathPrefix: string) {
  const seen: { path: string; body: unknown }[] = [];
  server.events.on('request:start', async ({ request }) => {
    const url = new URL(request.url);
    if (request.method === method && url.pathname.startsWith(pathPrefix)) {
      const text = await request.clone().text();
      seen.push({ path: url.pathname, body: text ? JSON.parse(text) : null });
    }
  });
  return seen;
}

const onClose = vi.fn();
const onSaved = vi.fn();
const onCsvDone = vi.fn();
function open() {
  return renderWithServices(
    <ManualDialog onClose={onClose} onChanged={onSaved} onCsvDone={onCsvDone} />,
  );
}
const dialog = () => screen.findByRole('dialog', { name: '보유 종목 직접 추가' });

async function pickStock(d: HTMLElement, query: string, name: string) {
  await userEvent.type(within(d).getByLabelText('종목 검색'), query);
  await userEvent.click(await within(d).findByRole('button', { name: `${name} 선택` }));
}

beforeEach(() => {
  onClose.mockClear();
  onSaved.mockClear();
});

describe('보유 종목 직접 추가', () => {
  it('증권사는 클릭으로 고른다: 삼성과 미래에셋이 기본, 연결 중인 증권사는 없다', async () => {
    mock.db.connections = [connection({ id: 1, broker_id: 'kis' })];
    open();
    const d = await dialog();
    const group = await within(d).findByRole('radiogroup', { name: '증권사' });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('aria-label') ?? r.closest('label')?.textContent),
    ).toEqual(['메리츠', '키움', '삼성', '미래에셋']);
  });

  it('네 항목이 모두 필수다: 비우면 이유를 보이고 보내지 않는다', async () => {
    const puts = capture('PUT', '/holdings/manual');
    open();
    const d = await dialog();
    await userEvent.click(within(d).getByRole('button', { name: '저장' }));
    expect(await within(d).findByText('종목을 고르세요.')).toBeInTheDocument();
    expect(within(d).getByText('증권사를 고르세요.')).toBeInTheDocument();
    expect(within(d).getByText('수량을 입력하세요.')).toBeInTheDocument();
    expect(within(d).getByText('평균 매수가를 입력하세요.')).toBeInTheDocument();
    expect(puts).toEqual([]);
  });

  it('수량과 평균 매수가는 0보다 큰 숫자여야 한다', async () => {
    const puts = capture('PUT', '/holdings/manual');
    open();
    const d = await dialog();
    await pickStock(d, '삼성전자', '삼성전자');
    await userEvent.click(within(d).getByRole('radio', { name: '삼성' }));
    await userEvent.type(within(d).getByLabelText('수량'), '0');
    await userEvent.type(within(d).getByLabelText('평균 매수가(1주당, 원)'), 'abc');
    await userEvent.click(within(d).getByRole('button', { name: '저장' }));
    expect(await within(d).findByText('수량은 0보다 큰 숫자여야 합니다.')).toBeInTheDocument();
    expect(within(d).getByText('평균 매수가는 0보다 큰 숫자여야 합니다.')).toBeInTheDocument();
    expect(puts).toEqual([]);
  });

  it('저장하면 입력값을 그대로(문자열) 보내고, "직접 입력" 표시와 입력 날짜가 목록에 보인다', async () => {
    const puts = capture('PUT', '/holdings/manual');
    open();
    const d = await dialog();
    await pickStock(d, '삼성전자', '삼성전자');
    await userEvent.click(within(d).getByRole('radio', { name: '삼성' }));
    await userEvent.type(within(d).getByLabelText('수량'), '10');
    await userEvent.type(within(d).getByLabelText('평균 매수가(1주당, 원)'), '64,000');
    await userEvent.click(within(d).getByRole('button', { name: '저장' }));
    await waitFor(() =>
      expect(puts).toEqual([
        {
          path: '/holdings/manual',
          body: {
            broker_id: 'samsung',
            market: 'KR',
            code: '005930',
            quantity: '10',
            avg_price: '64000',
          },
        },
      ]),
    );
    const list = await within(d).findByRole('list', { name: '직접 입력한 보유' });
    const row = within(list).getByRole('listitem');
    expect(within(row).getByText('삼성전자')).toBeInTheDocument();
    expect(within(row).getByText('10주')).toBeInTheDocument();
    expect(within(row).getByText('평단가 64,000원')).toBeInTheDocument();
    expect(within(row).getByText(/직접 입력 · 11월 6일/)).toBeInTheDocument();
    // 칸은 비워 다음 종목을 받는다
    expect(within(d).getByLabelText('수량')).toHaveValue('');
    expect(onSaved).toHaveBeenCalled();
  });

  it('미국 종목은 달러 평균 매수가, 소수점 수량', async () => {
    const puts = capture('PUT', '/holdings/manual');
    open();
    const d = await dialog();
    await pickStock(d, 'AAPL', '애플');
    await userEvent.click(within(d).getByRole('radio', { name: '미래에셋' }));
    await userEvent.type(within(d).getByLabelText('수량'), '0.5');
    await userEvent.type(within(d).getByLabelText('평균 매수가(1주당, 달러)'), '200.25');
    await userEvent.click(within(d).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]?.body).toEqual({
      broker_id: 'mirae',
      market: 'US',
      code: 'AAPL',
      quantity: '0.5',
      avg_price: '200.25',
    });
    const row = within(await within(d).findByRole('list', { name: '직접 입력한 보유' })).getByRole(
      'listitem',
    );
    expect(within(row).getByText('0.5주')).toBeInTheDocument();
    expect(within(row).getByText('평단가 $200.25')).toBeInTheDocument();
  });

  it('[증권사 추가]: 이름을 한 번 등록하면 클릭 목록에 색 점과 함께 나타나고 골라진다', async () => {
    const posts = capture('POST', '/brokers');
    open();
    const d = await dialog();
    await userEvent.click(await within(d).findByRole('button', { name: '증권사 추가' }));
    await userEvent.type(within(d).getByLabelText('증권사 이름'), '토스증권');
    await userEvent.click(within(d).getByRole('button', { name: '추가' }));
    const radio = await within(d).findByRole('radio', { name: '토스증권' });
    expect(radio).toBeChecked();
    expect(posts).toEqual([{ path: '/brokers', body: { name: '토스증권' } }]);
    const dot = radio.closest('label')?.querySelector('[data-dot]') as HTMLElement;
    expect(dot.style.getPropertyValue('--broker-color')).toBe('#2E8B57');
  });

  it('같은 이름 증권사 추가는 이유를 보인다', async () => {
    open();
    const d = await dialog();
    await userEvent.click(await within(d).findByRole('button', { name: '증권사 추가' }));
    await userEvent.type(within(d).getByLabelText('증권사 이름'), '삼성');
    await userEvent.click(within(d).getByRole('button', { name: '추가' }));
    expect(await within(d).findByText(/이미 있는 증권사입니다/)).toBeInTheDocument();
  });

  async function withSaved() {
    mock.db.holdings = [
      holding({
        broker_id: 'samsung',
        connection_id: 0,
        code: '005930',
        name: '삼성전자',
        quantity: '10',
        source: 'manual',
      }),
    ];
  }

  it('수정: 종목과 증권사는 고정, 수량·평균 매수가를 고쳐 다시 저장한다', async () => {
    await withSaved();
    const puts = capture('PUT', '/holdings/manual');
    open();
    const d = await dialog();
    await userEvent.click(await within(d).findByRole('button', { name: '삼성전자 수정' }));
    expect(within(d).getByLabelText('수량')).toHaveValue('10');
    expect(within(d).getByLabelText('평균 매수가(1주당, 원)')).toHaveValue('64000');
    expect(within(d).queryByLabelText('종목 검색')).not.toBeInTheDocument();
    await userEvent.clear(within(d).getByLabelText('수량'));
    await userEvent.type(within(d).getByLabelText('수량'), '12');
    await userEvent.click(within(d).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]?.body).toEqual({
      broker_id: 'samsung',
      market: 'KR',
      code: '005930',
      quantity: '12',
      avg_price: '64000',
    });
    expect(await within(d).findByText('12주')).toBeInTheDocument();
  });

  it('삭제: 확인한 뒤에만 지운다', async () => {
    await withSaved();
    const dels = capture('DELETE', '/holdings/manual');
    open();
    const d = await dialog();
    await userEvent.click(await within(d).findByRole('button', { name: '삼성전자 삭제' }));
    expect(dels).toEqual([]);
    expect(within(d).getByText('삼성전자를 지울까요?')).toBeInTheDocument();
    await userEvent.click(within(d).getByRole('button', { name: '지우기' }));
    await waitFor(() =>
      expect(dels).toEqual([
        { path: '/holdings/manual', body: { broker_id: 'samsung', market: 'KR', code: '005930' } },
      ]),
    );
    await waitFor(() =>
      expect(within(d).queryByRole('list', { name: '직접 입력한 보유' })).not.toBeInTheDocument(),
    );
  });

  it('저장이 실패하면 원인과 hint를 보이고 입력은 남긴다', async () => {
    const { http, HttpResponse } = await import('msw');
    server.use(
      http.put('*/holdings/manual', () =>
        HttpResponse.json(
          {
            code: 'HOLDING_INVALID',
            message: 'API로 연결된 증권사는 직접 입력할 수 없습니다.',
            hint: '연결을 먼저 해제하세요.',
          },
          { status: 422 },
        ),
      ),
    );
    open();
    const d = await dialog();
    await pickStock(d, '삼성전자', '삼성전자');
    await userEvent.click(within(d).getByRole('radio', { name: '삼성' }));
    await userEvent.type(within(d).getByLabelText('수량'), '10');
    await userEvent.type(within(d).getByLabelText('평균 매수가(1주당, 원)'), '64000');
    await userEvent.click(within(d).getByRole('button', { name: '저장' }));
    expect(await within(d).findByText(/직접 입력할 수 없습니다/)).toBeInTheDocument();
    expect(within(d).getByText(/연결을 먼저 해제하세요/)).toBeInTheDocument();
    expect(within(d).getByLabelText('수량')).toHaveValue('10');
  });
});
