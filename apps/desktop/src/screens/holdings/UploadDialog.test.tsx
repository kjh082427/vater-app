import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { AlertsScreen } from '../alerts/AlertsScreen';
import { renderWithServices } from '../../test/render';
import { connection, holding } from '../../test/holdings';
import { choose } from '../../test/select';
import { mock, server } from '../../test/server';

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

/** 삼성전자·SK하이닉스는 이미 감시 중. NAVER·엔비디아는 새 종목. 코스피 ETN은 지원하지 않음. */
function setup() {
  mock.db.connections = [
    connection({ id: 1, broker_id: 'kis', account_mask: '****7801' }),
    connection({ id: 2, broker_id: 'meritz', account_mask: '키 ab12' }),
  ];
  mock.db.holdings = [
    holding({ code: '005930', name: '삼성전자' }),
    holding({ code: '035420', name: 'NAVER', is_new: true }),
    holding({
      code: '530031',
      name: '삼성 레버리지 ETN',
      supported: false,
      unsupported_reason: '종목 목록에 없는 상품입니다(ETN 등).',
      is_new: true,
    }),
    holding({
      broker_id: 'meritz',
      connection_id: 2,
      market: 'US',
      code: 'NVDA',
      name: '엔비디아',
      quantity: '2.5',
      currency: 'USD',
      avg_price: 120,
      is_new: true,
    }),
  ];
  mock.db.symbols.push({
    market: 'US',
    code: 'NVDA',
    exchange: 'NAS',
    kind: 'stock',
    name: '엔비디아',
    name_en: 'NVIDIA',
  });
}

const render = () => renderWithServices(<AlertsScreen focus={null} />);
const dialog = () => screen.getByRole('dialog');

describe('업로드 버튼', () => {
  it('연결한 증권사만 버튼으로 보이고, 새 종목 수를 알린다(이미 감시 중·지원 안 함 제외)', async () => {
    setup();
    render();
    expect(await screen.findByRole('button', { name: '한국투자' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '메리츠' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '연결한 증권사 모두' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '키움' })).not.toBeInTheDocument();
    // NAVER, 엔비디아 2개(ETN은 지원 안 함)
    expect(screen.getByText('새 종목 2개')).toBeInTheDocument();
  });

  it('[보유 종목 직접 추가]는 연결이 없어도 늘 있고, 누르면 직접 추가 창을 연다', async () => {
    render();
    await userEvent.click(await screen.findByRole('button', { name: '보유 종목 직접 추가' }));
    expect(await screen.findByRole('dialog', { name: '보유 종목 직접 추가' })).toBeInTheDocument();
  });

  it('연결도 보유도 없으면 버튼 대신 연결 안내', async () => {
    render();
    expect(await screen.findByText(/증권사를 연결하면 보유 종목을 불러옵니다/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '연결한 증권사 모두' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '설정 > 증권사 연결' })).toHaveAttribute(
      'href',
      '#/settings',
    );
  });

  it('새 종목이 없으면 "새 종목" 표시를 숨긴다', async () => {
    mock.db.connections = [connection({ id: 1, broker_id: 'kis' })];
    mock.db.holdings = [holding({ code: '005930', name: '삼성전자' })];
    render();
    await screen.findByRole('button', { name: '한국투자' });
    expect(screen.queryByText(/새 종목/)).not.toBeInTheDocument();
  });
});

describe('업로드 확인 창', () => {
  it('증권사를 누르면 먼저 갱신하고 확인 창을 연다: 전부 체크, 감시 중과 지원 안 함은 체크 불가와 이유', async () => {
    setup();
    const syncs = capture('POST', '/holdings/sync');
    render();
    await userEvent.click(await screen.findByRole('button', { name: '한국투자' }));
    const d = await screen.findByRole('dialog', { name: /한국투자/ });
    await within(d).findByRole('checkbox', { name: /NAVER/ });
    expect(syncs).toEqual([{ path: '/holdings/sync', body: { broker_id: 'kis' } }]);
    expect(within(d).getByRole('checkbox', { name: /NAVER/ })).toBeChecked();
    const watched = within(d).getByRole('checkbox', { name: /삼성전자/ });
    expect(watched).toBeDisabled();
    expect(watched).not.toBeChecked();
    expect(within(d).getByText('이미 감시 중')).toBeInTheDocument();
    expect(within(d).getByRole('checkbox', { name: /삼성 레버리지 ETN/ })).toBeDisabled();
    expect(within(d).getByText(/종목 목록에 없는 상품입니다/)).toBeInTheDocument();
    // 메리츠 종목은 이 창에 없다
    expect(within(d).queryByRole('checkbox', { name: /엔비디아/ })).not.toBeInTheDocument();
  });

  it('안내 문구: 감시 종목은 브리핑 작성 때 AI로 전송됩니다', async () => {
    setup();
    render();
    await userEvent.click(await screen.findByRole('button', { name: '한국투자' }));
    await screen.findByRole('dialog');
    expect(screen.getByText('감시 종목은 브리핑 작성 때 AI로 전송됩니다.')).toBeInTheDocument();
    expect(screen.getByText(/보유 수량과 평단가는 AI로 보내지 않습니다/)).toBeInTheDocument();
  });

  it('체크를 해제한 종목은 items에 없고 seen으로만 보낸다', async () => {
    setup();
    const watches = capture('POST', '/holdings/watch');
    render();
    await userEvent.click(await screen.findByRole('button', { name: '연결한 증권사 모두' }));
    const d = await screen.findByRole('dialog');
    await userEvent.click(await within(d).findByRole('checkbox', { name: /엔비디아/ }));
    await userEvent.click(within(d).getByRole('button', { name: /감시 종목에 올리기/ }));
    await waitFor(() => expect(watches).toHaveLength(1));
    expect(watches[0]?.body).toEqual({
      items: [{ market: 'KR', code: '035420' }],
      seen: [{ market: 'US', code: 'NVDA' }],
    });
    expect(await screen.findByText(/1종목을 감시 종목에 올렸습니다/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // 새로 올린 종목이 목록에 있다
    expect(await screen.findByRole('button', { name: /^NAVER/ })).toBeInTheDocument();
  });

  it('전체 해제·전체 선택, 올릴 종목이 없으면 버튼이 막힌다', async () => {
    setup();
    render();
    await userEvent.click(await screen.findByRole('button', { name: '연결한 증권사 모두' }));
    const d = await screen.findByRole('dialog');
    await within(d).findByRole('checkbox', { name: /NAVER/ });
    const all = within(d).getByRole('checkbox', { name: '전체 선택' });
    expect(all).toBeChecked();
    await userEvent.click(all);
    expect(within(d).getByRole('checkbox', { name: /NAVER/ })).not.toBeChecked();
    expect(within(d).getByRole('button', { name: /감시 종목에 올리기/ })).toBeDisabled();
    await userEvent.click(all);
    expect(within(d).getByRole('checkbox', { name: /엔비디아/ })).toBeChecked();
    expect(within(d).getByText('2종목 선택')).toBeInTheDocument();
  });

  it('실패한 증권사만 오류를 보이고 나머지 종목은 그대로 보인다', async () => {
    setup();
    server.use(
      http.post('*/holdings/sync', () =>
        HttpResponse.json([
          { connection_id: 1, broker_id: 'kis', ok: true, error: null },
          {
            connection_id: 2,
            broker_id: 'meritz',
            ok: false,
            error: {
              code: 'BROKER_AUTH',
              message: '메리츠가 키를 거절했습니다.',
              hint: '키를 다시 연결하세요.',
            },
          },
        ]),
      ),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: '연결한 증권사 모두' }));
    const d = await screen.findByRole('dialog');
    await within(d).findByRole('checkbox', { name: /NAVER/ });
    expect(within(d).getByText(/메리츠가 키를 거절했습니다/)).toBeInTheDocument();
    expect(within(d).getByText(/키를 다시 연결하세요/)).toBeInTheDocument();
    expect(within(d).queryByText(/한국투자.*거절/)).not.toBeInTheDocument();
    // 저장된 메리츠 수량은 그대로 목록에 있다
    expect(within(d).getByRole('checkbox', { name: /엔비디아/ })).toBeInTheDocument();
  });

  it('규칙을 고르면 체크한 종목에 일괄 적용한다: 기본은 규칙 없음, 목표가는 보이지 않는다', async () => {
    setup();
    const watches = capture('POST', '/holdings/watch');
    render();
    await userEvent.click(await screen.findByRole('button', { name: '한국투자' }));
    const d = await screen.findByRole('dialog');
    await within(d).findByRole('checkbox', { name: /NAVER/ });
    await userEvent.click(within(d).getByRole('button', { name: /^알림 규칙 규칙 없음/ }));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options[0]).toBe('규칙 없음');
    expect(options.join('|')).not.toMatch(/목표가/);
    expect(options).toContain('전일 대비 등락률');
    await userEvent.click(screen.getByRole('option', { name: '전일 대비 등락률' }));
    await userEvent.click(within(d).getByRole('button', { name: /감시 종목에 올리기/ }));
    await waitFor(() => expect(watches).toHaveLength(1));
    expect((watches[0]?.body as { rule: unknown }).rule).toEqual({ kind: 'change_pct' });
  });

  it('평단가 알림은 퍼센트와 방향을 골라 일괄 적용한다(기본은 끔)', async () => {
    setup();
    const watches = capture('POST', '/holdings/watch');
    render();
    await userEvent.click(await screen.findByRole('button', { name: '한국투자' }));
    const d = await screen.findByRole('dialog');
    await within(d).findByRole('checkbox', { name: /NAVER/ });
    expect(within(d).queryByLabelText('평단가 대비(%)')).not.toBeInTheDocument();
    await choose(d, '알림 규칙', '평단가 대비 ±N%');
    const pct = within(d).getByLabelText('평단가 대비(%)');
    expect(pct).toHaveValue('10');
    await userEvent.clear(pct);
    await userEvent.type(pct, '15');
    await userEvent.click(within(d).getByRole('button', { name: /감시 종목에 올리기/ }));
    await waitFor(() => expect(watches).toHaveLength(1));
    expect((watches[0]?.body as { rule: unknown }).rule).toEqual({
      kind: 'avg_price_pct',
      params: { pct: 15, direction: 'down' },
    });
  });

  it('실시간 규칙이면 41종목 안내를 사용량과 함께, 마감 규칙이면 보이지 않는다', async () => {
    setup();
    render();
    await userEvent.click(await screen.findByRole('button', { name: '연결한 증권사 모두' }));
    const d = await screen.findByRole('dialog');
    await within(d).findByRole('checkbox', { name: /NAVER/ });
    expect(within(d).queryByText(/실시간 감시는 최대/)).not.toBeInTheDocument();
    await choose(d, '알림 규칙', '전일 대비 등락률');
    // 지금 실시간 1종목 + 올릴 2종목
    expect(
      within(d).getByText(
        '실시간 감시는 최대 41종목입니다. 넘는 종목은 약 30초마다 가격을 확인해 알림을 보냅니다. 사용량 3/41',
      ),
    ).toBeInTheDocument();
    await choose(d, '알림 규칙', '이동평균선 교차');
    expect(within(d).queryByText(/실시간 감시는 최대/)).not.toBeInTheDocument();
  });

  it('긴 목록(200종목)도 스크롤 칸 안에 모두 담고 전체 선택이 멈추지 않는다', async () => {
    mock.db.connections = [connection({ id: 1, broker_id: 'kis' })];
    mock.db.holdings = Array.from({ length: 200 }, (_, i) =>
      holding({ code: String(100000 + i), name: `종목${i}`, is_new: true }),
    );
    for (const h of mock.db.holdings) {
      mock.db.symbols.push({
        market: 'KR',
        code: h.code,
        exchange: 'KOSPI',
        kind: 'stock',
        name: h.name,
        name_en: null,
      });
    }
    render();
    await userEvent.click(await screen.findByRole('button', { name: '한국투자' }));
    const d = await screen.findByRole('dialog');
    const list = await within(d).findByRole('list', { name: '보유 종목' });
    expect(within(list).getAllByRole('checkbox')).toHaveLength(200);
    expect(within(d).getByText('200종목 선택')).toBeInTheDocument();
    await userEvent.click(within(d).getByRole('checkbox', { name: '전체 선택' }));
    expect(within(d).getByText('0종목 선택')).toBeInTheDocument();
  });

  it('올리기에 실패하면 창을 닫지 않고 원인을 보인다', async () => {
    setup();
    server.use(
      http.post('*/holdings/watch', () =>
        HttpResponse.json(
          {
            code: 'ALERT_RULE_INVALID',
            message: '규칙 값이 올바르지 않습니다.',
            hint: '값을 확인하세요.',
          },
          { status: 422 },
        ),
      ),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: '한국투자' }));
    const d = await screen.findByRole('dialog');
    await within(d).findByRole('checkbox', { name: /NAVER/ });
    await userEvent.click(within(d).getByRole('button', { name: /감시 종목에 올리기/ }));
    expect(await within(dialog()).findByText(/규칙 값이 올바르지 않습니다/)).toBeInTheDocument();
  });
});
