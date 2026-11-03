import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { errorResponse } from '../../mocks/handlers';
import { App } from '../../app/App';
import { emit, renderWithServices } from '../../test/render';
import { mock, server } from '../../test/server';
import { choose, findSelectButton } from '../../test/select';

function renderAlerts(hash = '#/alerts') {
  window.location.hash = hash;
  return renderWithServices(<App />);
}

const watchSection = () => screen.getByRole('region', { name: '감시 종목' });
const historySection = () => screen.getByRole('region', { name: '알림 이력' });
/** 종목 하나의 구역(펼친 상태의 규칙 목록이 들어 있다). */
const panel = (name: string) => screen.getByRole('region', { name: new RegExp(`^${name}`) });
const toggle = (name: string) =>
  within(watchSection()).getByRole('button', { name: new RegExp(`^${name}`) });

describe('감시 종목 목록', () => {
  it('종목마다 규칙 수, 처음에는 접혀 있다', async () => {
    renderAlerts();
    const samsung = await within(watchSection()).findByRole('button', { name: /^삼성전자/ });
    expect(samsung).toHaveAttribute('aria-expanded', 'false');
    expect(samsung).toHaveTextContent('규칙 2개');
    expect(toggle('SK하이닉스')).toHaveTextContent('규칙 1개');
    expect(toggle('애플')).toHaveTextContent('규칙 없음');
  });

  it('#/symbols/KR/005930(알림 클릭 경로)은 그 종목을 펼친 상태', async () => {
    renderAlerts('#/symbols/KR/005930');
    const samsung = await within(watchSection()).findByRole('button', { name: /^삼성전자/ });
    expect(samsung).toHaveAttribute('aria-expanded', 'true');
    const rules = within(panel('삼성전자')).getByRole('list', { name: '삼성전자 규칙' });
    expect(within(rules).getByText('목표가 71,000원 이상')).toBeInTheDocument();
    expect(within(rules).getByText('5일·20일 이동평균 골든크로스')).toBeInTheDocument();
    expect(within(rules).getByText('장중 실시간')).toBeInTheDocument();
    expect(within(rules).getByText('장 마감 후(그날 종가)')).toBeInTheDocument();
    expect(within(rules).getByText('마지막 알림 11월 3일 13:58')).toBeInTheDocument();
  });

  it('종목을 누르면 펼치고 주소가 그 종목으로, 다시 누르면 접고 #/alerts', async () => {
    renderAlerts();
    await userEvent.click(
      await within(watchSection()).findByRole('button', { name: /^SK하이닉스/ }),
    );
    await waitFor(() => expect(window.location.hash).toBe('#/symbols/KR/000660'));
    expect(toggle('SK하이닉스')).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle('SK하이닉스'));
    await waitFor(() => expect(window.location.hash).toBe('#/alerts'));
  });

  it('감시 목록에 없는 종목 주소면 알리고 바로 추가할 수 있다', async () => {
    renderAlerts('#/symbols/KR/035420');
    expect(
      await screen.findByText('이 종목(국내 035420)은 감시 목록에 없습니다.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '감시 종목에 추가' }));
    expect(await within(watchSection()).findByRole('button', { name: /^NAVER/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('비었으면 할 일을 알려 준다', async () => {
    mock.db.watchItems = [];
    renderAlerts();
    expect(
      await within(watchSection()).findByText(
        '아직 감시 종목이 없습니다. 종목 추가를 눌러 종목을 찾고, 알림 규칙을 만드세요.',
      ),
    ).toBeInTheDocument();
  });

  it('불러오기 오류는 원인과 해결 방법', async () => {
    server.use(
      http.get('*/watchlist', () =>
        errorResponse(
          503,
          'DB_UNAVAILABLE',
          '저장소가 준비되지 않았습니다.',
          '앱을 다시 시작해 주세요.',
        ),
      ),
    );
    renderAlerts();
    expect(await within(watchSection()).findByText(/앱을 다시 시작해 주세요/)).toBeInTheDocument();
  });
});

describe('감시 종목 추가·삭제', () => {
  it('검색해서 추가하면 그 종목을 펼친다', async () => {
    renderAlerts();
    await userEvent.click(await screen.findByRole('button', { name: '종목 추가' }));
    await userEvent.type(screen.getByRole('searchbox', { name: '종목 검색' }), 'NAVER');
    await userEvent.click(await screen.findByRole('button', { name: 'NAVER 추가' }));
    await waitFor(() => expect(window.location.hash).toBe('#/symbols/KR/035420'));
    expect(await within(watchSection()).findByRole('button', { name: /^NAVER/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(mock.db.watchItems.some((w) => w.code === '035420')).toBe(true);
  });

  it('이미 감시 중인 종목은 버튼 대신 "감시 중"', async () => {
    renderAlerts();
    await userEvent.click(await screen.findByRole('button', { name: '종목 추가' }));
    await userEvent.type(screen.getByRole('searchbox', { name: '종목 검색' }), '삼성');
    const results = await screen.findByRole('list', { name: '검색 결과' });
    const item = within(results).getByText('삼성전자').closest('li') as HTMLElement;
    expect(within(item).getByText('감시 중')).toBeInTheDocument();
    expect(within(results).getByRole('button', { name: '삼성전자우 추가' })).toBeInTheDocument();
  });

  it('중복(409)이면 사이드카 문구를 그대로 보여 준다', async () => {
    server.use(
      http.post('*/watchlist', () =>
        errorResponse(409, 'WATCHLIST_DUPLICATE', '이미 감시 중인 종목입니다: NAVER'),
      ),
    );
    renderAlerts();
    await userEvent.click(await screen.findByRole('button', { name: '종목 추가' }));
    await userEvent.type(screen.getByRole('searchbox', { name: '종목 검색' }), 'NAVER');
    await userEvent.click(await screen.findByRole('button', { name: 'NAVER 추가' }));
    expect(await screen.findByText('이미 감시 중인 종목입니다: NAVER')).toBeInTheDocument();
  });

  it('검색 결과가 없으면 안내', async () => {
    renderAlerts();
    await userEvent.click(await screen.findByRole('button', { name: '종목 추가' }));
    await userEvent.type(screen.getByRole('searchbox', { name: '종목 검색' }), 'zzzz');
    expect(await screen.findByText(/검색 결과가 없습니다/)).toBeInTheDocument();
  });

  it('빼기: 규칙도 함께 지워진다고 확인한 뒤 지운다', async () => {
    renderAlerts('#/symbols/KR/005930');
    const part = await waitFor(() => panel('삼성전자'));
    await userEvent.click(within(part).getByRole('button', { name: '감시 종목에서 빼기' }));
    expect(
      within(part).getByText('삼성전자를 감시 목록에서 뺄까요? 규칙 2개도 함께 지워집니다.'),
    ).toBeInTheDocument();
    await userEvent.click(within(part).getByRole('button', { name: '빼기' }));
    await waitFor(() =>
      expect(
        within(watchSection()).queryByRole('button', { name: /^삼성전자/ }),
      ).not.toBeInTheDocument(),
    );
    expect(window.location.hash).toBe('#/alerts');
  });

  it('빼기를 취소하면 그대로', async () => {
    renderAlerts('#/symbols/KR/005930');
    const part = await waitFor(() => panel('삼성전자'));
    await userEvent.click(within(part).getByRole('button', { name: '감시 종목에서 빼기' }));
    await userEvent.click(within(part).getByRole('button', { name: '취소' }));
    expect(within(part).queryByText(/뺄까요/)).not.toBeInTheDocument();
    expect(mock.db.watchItems).toHaveLength(3);
  });
});

describe('규칙 편집기', () => {
  async function openEditor(hash = '#/symbols/KR/000660', name = 'SK하이닉스') {
    renderAlerts(hash);
    const part = await waitFor(() => panel(name));
    await userEvent.click(within(part).getByRole('button', { name: '규칙 추가' }));
    const form = within(part).getByRole('form', { name: '새 규칙' });
    return { part, form };
  }

  it('종류 → 파라미터(필수·기본값) → 확인 시점 → 저장', async () => {
    const { part, form } = await openEditor();
    const kind = await within(form).findByRole('combobox', { name: '종류' });
    await userEvent.selectOptions(kind, 'rsi');
    expect(within(form).getByRole('textbox', { name: '기간(일)' })).toHaveValue('14');
    expect(within(form).getByRole('textbox', { name: '과매수 기준' })).toHaveValue('70');
    expect(within(form).getByRole('radio', { name: '장 마감 후(그날 종가)' })).toBeChecked();
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: '조건' }), 'oversold');
    await userEvent.click(within(form).getByRole('radio', { name: '장중 실시간' }));
    await userEvent.click(within(form).getByRole('button', { name: '저장' }));
    const rules = within(part).getByRole('list', { name: 'SK하이닉스 규칙' });
    expect(await within(rules).findByText('RSI(14) 30 이하 과매도 진입')).toBeInTheDocument();
    const created = mock.db.rules.at(-1);
    expect(created).toMatchObject({ watchlist_id: 2, kind: 'rsi', timing: 'realtime' });
    expect(created?.params).toMatchObject({ direction: 'oversold', period: 14 });
    expect(within(part).queryByRole('form', { name: '새 규칙' })).not.toBeInTheDocument();
  });

  it('목표가는 필수: 비우면 보내지 않고 칸에 이유', async () => {
    const posts: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST' && request.url.endsWith('/alerts/rules'))
        posts.push(request.url);
    });
    const { form } = await openEditor();
    await userEvent.selectOptions(
      await within(form).findByRole('combobox', { name: '종류' }),
      'price_above',
    );
    await userEvent.click(within(form).getByRole('button', { name: '저장' }));
    const price = within(form).getByRole('textbox', { name: '목표가(원)' });
    expect(price).toHaveAttribute('aria-invalid', 'true');
    expect(price).toHaveAccessibleDescription(/목표가를 입력하세요/);
    expect(posts).toHaveLength(0);
  });

  it('사이드카 검증 오류(422)의 message와 hint를 보여 준다', async () => {
    server.use(
      http.post('*/alerts/rules', () =>
        errorResponse(
          422,
          'ALERT_RULE_INVALID',
          '알림 조건 값이 올바르지 않습니다.',
          '확인할 항목: params',
        ),
      ),
    );
    const { form } = await openEditor();
    await userEvent.selectOptions(
      await within(form).findByRole('combobox', { name: '종류' }),
      'ma_cross',
    );
    const fast = within(form).getByRole('textbox', { name: '짧은 이동평균(일)' });
    await userEvent.clear(fast);
    await userEvent.type(fast, '30');
    await userEvent.click(within(form).getByRole('button', { name: '저장' }));
    expect(await within(form).findByText('알림 조건 값이 올바르지 않습니다.')).toBeInTheDocument();
    expect(within(form).getByText('확인할 항목: params')).toBeInTheDocument();
  });

  it('미리보기: 지금 지표값과 조건 충족 여부', async () => {
    let body: unknown = null;
    server.use(
      http.post('*/alerts/rules/preview', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          state: true,
          value: 198500,
          message: '현재가 198,500 — 목표가 190,000 이상',
        });
      }),
    );
    const { form } = await openEditor();
    await userEvent.selectOptions(
      await within(form).findByRole('combobox', { name: '종류' }),
      'price_above',
    );
    await userEvent.type(within(form).getByRole('textbox', { name: '목표가(원)' }), '190000');
    await userEvent.click(within(form).getByRole('button', { name: '현재 값 미리보기' }));
    expect(
      await within(form).findByText('현재가 198,500 — 목표가 190,000 이상'),
    ).toBeInTheDocument();
    expect(within(form).getByText('지금 조건을 충족합니다')).toBeInTheDocument();
    expect(body).toEqual({
      watchlist_id: 2,
      kind: 'price_above',
      params: { price: 190000 },
      timing: 'realtime',
    });
  });

  it('미리보기에서 계산할 수 없으면(일봉 부족) 그렇게 말한다', async () => {
    server.use(
      http.post('*/alerts/rules/preview', () =>
        HttpResponse.json({
          state: null,
          value: null,
          message: '일봉이 부족합니다 (필요 21일, 있음 3일)',
        }),
      ),
    );
    const { form } = await openEditor();
    await userEvent.selectOptions(
      await within(form).findByRole('combobox', { name: '종류' }),
      'ma_break',
    );
    await userEvent.click(within(form).getByRole('button', { name: '현재 값 미리보기' }));
    expect(await within(form).findByText(/일봉이 부족합니다/)).toBeInTheDocument();
    expect(within(form).getByText('지금은 계산할 수 없습니다')).toBeInTheDocument();
  });

  it('미리보기 오류도 원인과 해결 방법', async () => {
    server.use(
      http.post('*/alerts/rules/preview', () =>
        errorResponse(
          400,
          'KIS_NOT_CONFIGURED',
          '한국투자증권 키가 없습니다.',
          '설정에서 키를 넣으세요.',
        ),
      ),
    );
    const { form } = await openEditor();
    await userEvent.selectOptions(
      await within(form).findByRole('combobox', { name: '종류' }),
      'rsi',
    );
    await userEvent.click(within(form).getByRole('button', { name: '현재 값 미리보기' }));
    expect(await within(form).findByText(/설정에서 키를 넣으세요/)).toBeInTheDocument();
  });

  it('수정: 저장된 값으로 열고 PATCH', async () => {
    renderAlerts('#/symbols/KR/005930');
    const part = await waitFor(() => panel('삼성전자'));
    const rules = within(part).getByRole('list', { name: '삼성전자 규칙' });
    const row = within(rules).getByText('목표가 71,000원 이상').closest('li') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: '수정' }));
    const form = within(part).getByRole('form', { name: '규칙 수정' });
    expect(within(form).getByRole('combobox', { name: '종류' })).toBeDisabled();
    const price = within(form).getByRole('textbox', { name: '목표가(원)' });
    expect(price).toHaveValue('71000');
    await userEvent.clear(price);
    await userEvent.type(price, '72,500');
    await userEvent.click(within(form).getByRole('button', { name: '저장' }));
    expect(await within(rules).findByText('목표가 72,500원 이상')).toBeInTheDocument();
    expect(mock.db.rules.find((r) => r.id === 4)?.params).toEqual({ price: 72500 });
  });

  it('켜기·끄기', async () => {
    renderAlerts('#/symbols/KR/005930');
    const part = await waitFor(() => panel('삼성전자'));
    const on = within(part).getByRole('checkbox', { name: '목표가 71,000원 이상 켜짐' });
    expect(on).toBeChecked();
    await userEvent.click(on);
    await waitFor(() => expect(on).not.toBeChecked());
    expect(mock.db.rules.find((r) => r.id === 4)?.enabled).toBe(false);
    const off = within(part).getByRole('checkbox', { name: '5일·20일 이동평균 골든크로스 켜짐' });
    expect(off).not.toBeChecked();
  });

  it('삭제: 확인한 뒤 지운다', async () => {
    renderAlerts('#/symbols/KR/005930');
    const part = await waitFor(() => panel('삼성전자'));
    const rules = within(part).getByRole('list', { name: '삼성전자 규칙' });
    const row = within(rules)
      .getByText('5일·20일 이동평균 골든크로스')
      .closest('li') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: '삭제' }));
    await userEvent.click(within(row).getByRole('button', { name: '규칙 삭제' }));
    await waitFor(() =>
      expect(within(rules).queryByText('5일·20일 이동평균 골든크로스')).not.toBeInTheDocument(),
    );
    expect(mock.db.rules.some((r) => r.id === 5)).toBe(false);
  });

  it('규칙이 없는 종목은 할 일을 알려 준다', async () => {
    renderAlerts('#/symbols/US/AAPL');
    const part = await waitFor(() => panel('애플'));
    expect(
      within(part).getByText('아직 규칙이 없습니다. 규칙 추가를 눌러 알림 조건을 만드세요.'),
    ).toBeInTheDocument();
  });

  it('미국 종목의 목표가는 달러', async () => {
    const { form } = await openEditor('#/symbols/US/AAPL', '애플');
    await userEvent.selectOptions(
      await within(form).findByRole('combobox', { name: '종류' }),
      'price_below',
    );
    expect(within(form).getByRole('textbox', { name: '목표가($)' })).toBeInTheDocument();
  });
});

describe('알림 이력', () => {
  it('시각·종목·내용, 새 알림은 위에 더한다', async () => {
    const { stream } = renderAlerts();
    const table = await within(historySection()).findByRole('table', { name: '알림 이력' });
    await within(table).findByText('삼성전자 현재가 71,400 — 목표가 71,000 이상');
    expect(within(table).getAllByRole('row')).toHaveLength(4); // 머리 + 3
    const source = await stream();
    emit(source, 'alert.fired', {
      id: 300,
      rule_id: 6,
      fired_at: '2026-11-03T15:10:00+09:00',
      value: 71,
      message: 'SK하이닉스 RSI(14) 71.0 — 과매수 진입',
      market: 'KR',
      code: '000660',
      name: 'SK하이닉스',
      kind: 'rsi',
    });
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(5));
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('SK하이닉스 RSI(14) 71.0');
  });

  it('종목 필터와 종류 필터', async () => {
    renderAlerts();
    const part = historySection();
    const table = await within(part).findByRole('table', { name: '알림 이력' });
    await within(table).findByText(/삼성전자 현재가/);
    await choose(part, '종목', 'SK하이닉스');
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));
    expect(within(table).getByText(/SK하이닉스 RSI/)).toBeInTheDocument();
    await choose(part, '종목', '전체 종목');
    await choose(part, '종류', '분석 완료·실패');
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));
    expect(within(table).getByText('AI 분석 완료: 삼성전자 — 비중확대')).toBeInTheDocument();
    await choose(part, '종류', 'MACD 시그널선 교차');
    expect(await within(part).findByText('조건에 맞는 알림이 없습니다.')).toBeInTheDocument();
  });

  it('종목 주소로 열면 그 종목의 이력만', async () => {
    renderAlerts('#/symbols/KR/000660');
    const part = historySection();
    expect(await findSelectButton(part, '종목')).toHaveAccessibleName('종목 SK하이닉스');
    const table = await within(part).findByRole('table', { name: '알림 이력' });
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));
  });

  it('알림 행을 누르면 그 종목(알림 클릭 경로)으로', async () => {
    renderAlerts();
    const table = await within(historySection()).findByRole('table', { name: '알림 이력' });
    await userEvent.click(await within(table).findByText(/SK하이닉스 RSI/));
    await waitFor(() => expect(window.location.hash).toBe('#/symbols/KR/000660'));
  });

  it('비었으면 할 일을 알려 준다', async () => {
    mock.db.events = [];
    renderAlerts();
    expect(
      await within(historySection()).findByText(
        '아직 울린 알림이 없습니다. 규칙을 만들면 조건이 맞을 때 여기에 쌓입니다.',
      ),
    ).toBeInTheDocument();
  });

  it('오류는 원인과 해결 방법', async () => {
    server.use(
      http.get('*/alerts/events', () =>
        errorResponse(
          500,
          'INTERNAL',
          '예상하지 못한 오류가 발생했습니다.',
          '로그 폴더를 확인해 주세요.',
        ),
      ),
    );
    renderAlerts();
    expect(
      await within(historySection()).findByText(/로그 폴더를 확인해 주세요/),
    ).toBeInTheDocument();
  });
});
