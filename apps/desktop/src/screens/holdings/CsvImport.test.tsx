import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CsvPreview } from '../../api/types';
import { holding } from '../../test/holdings';
import { renderWithServices } from '../../test/render';
import { choose } from '../../test/select';
import { mock, server } from '../../test/server';
import { ManualDialog } from './ManualForm';

const onSaved = vi.fn();
const CSV = '종목명,수량,평균단가\n삼성전자,10,64000\n애플,0.5,200\n없는종목,3,1000\n';

async function openCsv() {
  renderWithServices(
    <ManualDialog onClose={() => undefined} onChanged={() => undefined} onCsvDone={onSaved} />,
  );
  const d = await screen.findByRole('dialog', { name: '보유 종목 직접 추가' });
  await userEvent.click(within(d).getByRole('button', { name: '파일로 가져오기' }));
  return d;
}

async function upload(d: HTMLElement, text = CSV) {
  const file = new File([text], 'holdings.csv', { type: 'text/csv' });
  await userEvent.upload(within(d).getByLabelText('CSV 파일'), file);
}

function capture() {
  const seen: { method: string; url: URL; type: string | null; body: string }[] = [];
  server.events.on('request:start', async ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.includes('/holdings/csv/')) {
      seen.push({
        method: request.method,
        url,
        type: request.headers.get('content-type'),
        body: await request.clone().text(),
      });
    }
  });
  return seen;
}

beforeEach(() => onSaved.mockClear());

describe('CSV 가져오기', () => {
  it('파일 → 증권사 → 열 확인 → 미리보기(오류 행 이유) → 변경 요약 → 올리기', async () => {
    const calls = capture();
    const d = await openCsv();
    await upload(d);
    expect(within(d).getByText('증권사를 고르세요.')).toBeInTheDocument();
    await userEvent.click(within(d).getByRole('radio', { name: '삼성' }));
    // 열은 이름으로 추정한다
    expect(await within(d).findByRole('button', { name: /^종목명 열 종목명/ })).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: /^수량 열 수량/ })).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: /^평균 매수가 열 평균단가/ })).toBeInTheDocument();
    const table = await within(d).findByRole('table', { name: '미리보기' });
    const bad = within(table).getByRole('row', { name: /없는종목/ });
    expect(within(bad).getByText('종목을 찾을 수 없습니다.')).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /삼성전자/ })).toHaveTextContent('올릴 수 있음');
    expect(within(d).getByText('추가 2 · 변경 0 · 삭제 0')).toBeInTheDocument();
    expect(within(d).getByText(/1행은 올리지 않습니다/)).toBeInTheDocument();
    await userEvent.click(within(d).getByRole('button', { name: /올리기/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('samsung'));
    const commit = calls.find((c) => c.url.pathname.endsWith('/commit'));
    expect(JSON.parse(commit?.body ?? '{}')).toEqual({
      broker_id: 'samsung',
      rows: [
        { market: 'KR', code: '005930', quantity: '10', avg_price: 64000 },
        { market: 'US', code: 'AAPL', quantity: '0.5', avg_price: 200 },
      ],
    });
    expect(mock.db.holdings.filter((h) => h.broker_id === 'samsung')).toHaveLength(2);
    // 파일은 바이트 그대로 text/csv로 보낸다(CP949도 사이드카가 읽는다)
    const preview = calls.find((c) => c.url.pathname.endsWith('/preview'));
    expect(preview?.type).toBe('text/csv');
    expect(preview?.body).toBe(CSV);
    expect(preview?.url.searchParams.get('broker_id')).toBe('samsung');
  });

  it('같은 증권사로 다시 가져오면 달라지는 내용(추가·변경·삭제)을 먼저 보여 준다', async () => {
    mock.db.holdings = [
      holding({
        broker_id: 'samsung',
        connection_id: 0,
        code: '005930',
        name: '삼성전자',
        source: 'manual',
      }),
      holding({
        broker_id: 'samsung',
        connection_id: 0,
        code: '000660',
        name: 'SK하이닉스',
        source: 'manual',
      }),
    ];
    const d = await openCsv();
    await upload(d);
    await userEvent.click(within(d).getByRole('radio', { name: '삼성' }));
    expect(await within(d).findByText('추가 1 · 변경 1 · 삭제 1')).toBeInTheDocument();
  });

  it('열을 바꾸면 그 열로 미리보기를 다시 받는다', async () => {
    const calls = capture();
    const d = await openCsv();
    await upload(d, '종목명,수량,평단,매입가\n삼성전자,10,64000,1\n');
    await userEvent.click(within(d).getByRole('radio', { name: '삼성' }));
    await within(d).findByRole('table', { name: '미리보기' });
    await choose(d, '평균 매수가 열', '매입가');
    await waitFor(() => {
      const last = [...calls].reverse().find((c) => c.url.pathname.endsWith('/preview'));
      expect(last?.url.searchParams.get('avg_price_col')).toBe('매입가');
    });
  });

  it('열을 바꾸는 동안 새 결과가 올 때까지 이전 미리보기와 열 선택 칸을 그대로 둔다', async () => {
    const d = await openCsv();
    await upload(d, '종목명,수량,평단,매입가\n삼성전자,10,64000,1\n');
    await userEvent.click(within(d).getByRole('radio', { name: '삼성' }));
    await within(d).findByRole('table', { name: '미리보기' });
    const before = within(d).getByRole('button', { name: /^평균 매수가 열/ });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.post('*/holdings/csv/preview', async () => {
        await gate;
        return HttpResponse.json({
          columns: [],
          guess: { name: null, code: null, quantity: null, avg_price: null },
          rows: [],
          changes: { added: 0, updated: 0, removed: 0 },
        } satisfies CsvPreview);
      }),
    );
    await choose(d, '평균 매수가 열', '매입가');
    expect(await within(d).findByText(/파일을 읽는 중/)).toBeInTheDocument();
    expect(within(d).getByRole('table', { name: '미리보기' })).toBeInTheDocument();
    expect(before).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: /올리기/ })).toBeDisabled();
    release();
    await waitFor(() => expect(within(d).queryByText(/파일을 읽는 중/)).not.toBeInTheDocument());
  });

  it('찾지 못한 종목 행의 평균 매수가에는 "원"을 붙이지 않는다', async () => {
    const d = await openCsv();
    await upload(d, '종목명,수량,평균단가\n없는종목,3,1000\n');
    await userEvent.click(within(d).getByRole('radio', { name: '삼성' }));
    const row = within(await within(d).findByRole('table', { name: '미리보기' })).getByRole('row', {
      name: /없는종목/,
    });
    expect(within(row).getByText('1,000')).toBeInTheDocument();
    expect(within(row).queryByText(/원/)).not.toBeInTheDocument();
  });

  it('올리기가 실패한 뒤 열을 바꾸면 그 오류는 지운다', async () => {
    server.use(
      http.post('*/holdings/csv/commit', () =>
        HttpResponse.json(
          { code: 'CSV_INVALID', message: '올릴 수 없는 파일입니다.', hint: null },
          { status: 422 },
        ),
      ),
    );
    const d = await openCsv();
    await upload(d, '종목명,수량,평단,매입가\n삼성전자,10,64000,1\n');
    await userEvent.click(within(d).getByRole('radio', { name: '삼성' }));
    await within(d).findByRole('table', { name: '미리보기' });
    await userEvent.click(within(d).getByRole('button', { name: /올리기/ }));
    expect(await within(d).findByText('올릴 수 없는 파일입니다.')).toBeInTheDocument();
    await choose(d, '평균 매수가 열', '매입가');
    await waitFor(() =>
      expect(within(d).queryByText('올릴 수 없는 파일입니다.')).not.toBeInTheDocument(),
    );
  });

  it('후보에서 고르면 그 행이 올릴 수 있게 된다(이름이 맞지 않을 때도 후보가 온다)', async () => {
    const preview: CsvPreview = {
      columns: ['종목명', '수량', '평균단가'],
      guess: { name: '종목명', code: null, quantity: '수량', avg_price: '평균단가' },
      rows: [
        {
          row: 2,
          name: '삼성',
          market: null,
          code: null,
          quantity: '10',
          avg_price: 64000,
          error: '같은 이름의 종목이 여럿입니다. 하나를 골라 주세요.',
          candidates: [
            { market: 'KR', code: '005930', name: '삼성전자' },
            { market: 'KR', code: '005935', name: '삼성전자우' },
          ],
        },
      ],
      changes: { added: 0, updated: 0, removed: 0 },
    };
    server.use(http.post('*/holdings/csv/preview', () => HttpResponse.json(preview)));
    const calls = capture();
    const d = await openCsv();
    await upload(d);
    await userEvent.click(within(d).getByRole('radio', { name: '삼성' }));
    const table = await within(d).findByRole('table', { name: '미리보기' });
    expect(within(table).getByText(/같은 이름의 종목이 여럿입니다/)).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: /올리기/ })).toBeDisabled();
    await choose(table, '삼성 후보', '삼성전자우 005935');
    expect(within(table).getByRole('row', { name: /삼성/ })).toHaveTextContent('올릴 수 있음');
    expect(within(d).getByText('추가 1 · 변경 0 · 삭제 0')).toBeInTheDocument();
    await userEvent.click(within(d).getByRole('button', { name: /올리기/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const commit = calls.find((c) => c.url.pathname.endsWith('/commit'));
    expect(JSON.parse(commit?.body ?? '{}').rows).toEqual([
      { market: 'KR', code: '005935', quantity: '10', avg_price: 64000 },
    ]);
  });

  it('후보로 고른 종목이 다른 행과 겹치면 같은 종목이 두 번이라 올리지 않는다', async () => {
    const preview: CsvPreview = {
      columns: ['종목명', '수량', '평균단가'],
      guess: { name: '종목명', code: null, quantity: '수량', avg_price: '평균단가' },
      rows: [
        {
          row: 2,
          name: '삼성전자',
          market: 'KR',
          code: '005930',
          quantity: '10',
          avg_price: 64000,
          error: null,
          candidates: [],
        },
        {
          row: 3,
          name: '삼성',
          market: null,
          code: null,
          quantity: '5',
          avg_price: 60000,
          error: '같은 이름의 종목이 여럿입니다. 하나를 골라 주세요.',
          candidates: [{ market: 'KR', code: '005930', name: '삼성전자' }],
        },
      ],
      changes: { added: 1, updated: 0, removed: 0 },
    };
    server.use(http.post('*/holdings/csv/preview', () => HttpResponse.json(preview)));
    const d = await openCsv();
    await upload(d);
    await userEvent.click(within(d).getByRole('radio', { name: '삼성' }));
    const table = await within(d).findByRole('table', { name: '미리보기' });
    await choose(table, '삼성 후보', '삼성전자 005930');
    expect(within(table).getByText('같은 종목이 두 번 있습니다.')).toBeInTheDocument();
  });

  it('올릴 행이 하나도 없으면 [올리기]가 막힌다(빈 목록은 422)', async () => {
    const d = await openCsv();
    await upload(d, '종목명,수량,평균단가\n없는종목,3,1000\n');
    await userEvent.click(within(d).getByRole('radio', { name: '삼성' }));
    await within(d).findByRole('table', { name: '미리보기' });
    expect(within(d).getByRole('button', { name: /올리기/ })).toBeDisabled();
  });

  it('수량 열을 모르면 열을 고르라고 안내하고 표는 비어 있다', async () => {
    const d = await openCsv();
    await upload(d, '이름,보유\n삼성전자,10\n');
    await userEvent.click(within(d).getByRole('radio', { name: '삼성' }));
    expect(
      await within(d).findByText(/종목, 수량, 평균 매수가 열을 골라 주세요/),
    ).toBeInTheDocument();
  });

  it('파일이 너무 크거나 형식이 틀리면 사이드카의 원인과 hint를 보인다', async () => {
    server.use(
      http.post('*/holdings/csv/preview', () =>
        HttpResponse.json(
          { code: 'CSV_INVALID', message: '파일은 1,000행까지입니다.', hint: '나눠서 가져오세요.' },
          { status: 422 },
        ),
      ),
    );
    const d = await openCsv();
    await upload(d);
    await userEvent.click(within(d).getByRole('radio', { name: '삼성' }));
    expect(await within(d).findByText(/파일은 1,000행까지입니다/)).toBeInTheDocument();
    expect(within(d).getByText(/나눠서 가져오세요/)).toBeInTheDocument();
  });
});
