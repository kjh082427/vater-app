import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { briefingKr } from '../../mocks/fixtures';
import { errorResponse } from '../../mocks/handlers';
import { emit, renderWithServices } from '../../test/render';
import { mock, server } from '../../test/server';

function renderAt(hash: string) {
  window.location.hash = hash;
  return renderWithServices(<App />);
}

const region = (name: string | RegExp) => screen.getByRole('region', { name });

describe('브리핑 목록', () => {
  it('날짜·시장별, AI 한 줄 요약 또는 "AI 해석 없음(데이터만)"', async () => {
    renderAt('#/briefings');
    const list = await within(await waitFor(() => region('브리핑 목록'))).findByRole('list', {
      name: '브리핑',
    });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const kr = within(list).getByRole('link', { name: '11월 2일(월) 국내' });
    expect(kr).toHaveAttribute('href', '#/briefings/21');
    const krItem = kr.closest('li') as HTMLElement;
    expect(
      within(krItem)
        .getByText(/반도체 대형주가/)
        .closest('[data-voice="ai"]'),
    ).not.toBeNull();
    const usItem = within(list)
      .getByRole('link', { name: '11월 2일(월) 미국' })
      .closest('li') as HTMLElement;
    expect(within(usItem).getByText('AI 해석 없음(데이터만)')).toBeInTheDocument();
  });

  it('일부 항목이 빠진 브리핑은 빠진 항목을 적는다', async () => {
    const kr = mock.db.briefings.find((b) => b.id === 21);
    if (!kr) throw new Error('fixture');
    kr.status = 'partial';
    kr.missing = ['sectors', 'flows'];
    renderAt('#/briefings');
    const list = await within(await waitFor(() => region('브리핑 목록'))).findByRole('list', {
      name: '브리핑',
    });
    expect(within(list).getByText('빠진 항목: 업종, 수급')).toBeInTheDocument();
  });

  it('시장 탭으로 거른다', async () => {
    renderAt('#/briefings');
    const part = await waitFor(() => region('브리핑 목록'));
    await within(part).findByRole('list', { name: '브리핑' });
    await userEvent.click(within(part).getByRole('tab', { name: '미국' }));
    const list = await within(part).findByRole('list', { name: '브리핑' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
    expect(within(list).getByRole('link', { name: '11월 2일(월) 미국' })).toBeInTheDocument();
  });

  it('없으면 언제 만들어지는지와 지금 만들기', async () => {
    mock.db.briefings = [];
    renderAt('#/briefings');
    expect(
      await within(await waitFor(() => region('브리핑 목록'))).findByText(
        '아직 브리핑이 없습니다. 거래일마다 국내 16:00, 미국 07:00에 자동으로 만들어집니다. 지금 만들기로 바로 만들 수도 있습니다.',
      ),
    ).toBeInTheDocument();
  });

  it('오류면 원인과 해결 방법', async () => {
    server.use(
      http.get('*/briefings', () =>
        errorResponse(
          503,
          'DB_UNAVAILABLE',
          '저장소가 준비되지 않았습니다.',
          '앱을 다시 시작해 주세요.',
        ),
      ),
    );
    renderAt('#/briefings');
    expect(
      await within(await waitFor(() => region('브리핑 목록'))).findByText(
        /앱을 다시 시작해 주세요/,
      ),
    ).toBeInTheDocument();
  });
});

describe('지금 만들기', () => {
  it('202 → 만드는 중 → briefing.status done → 도착, 목록을 다시 불러온다', async () => {
    let body: unknown = null;
    server.use(
      http.post('*/briefings/run', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ market: 'KR', date: '2026-11-03' }, { status: 202 });
      }),
    );
    const { stream } = renderAt('#/briefings');
    await userEvent.click(await screen.findByRole('button', { name: '국내 지금 만들기' }));
    expect(body).toEqual({ market: 'KR' });
    expect(
      await screen.findByText('국내 11월 3일(화) 브리핑을 만드는 중입니다.'),
    ).toBeInTheDocument();
    const source = await stream();
    mock.db.briefings.unshift({ ...briefingKr, id: 22, date: '2026-11-03' });
    emit(source, 'briefing.status', { market: 'KR', date: '2026-11-03', status: 'done', id: 22 });
    expect(await screen.findByText('국내 11월 3일(화) 브리핑이 도착했습니다.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '도착한 브리핑 읽기' })).toHaveAttribute(
      'href',
      '#/briefings/22',
    );
    const list = within(region('브리핑 목록')).getByRole('list', { name: '브리핑' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3));
  });

  it('보유 내역이 있어도 만들기 요청에는 시장만 담긴다(개인정보를 AI에 보내지 않는다)', async () => {
    mock.db.connections = [
      {
        id: 1,
        broker_id: 'kis',
        account_mask: '****7801',
        status: 'ok',
        last_synced_at: '2026-11-06T14:00:00+09:00',
        last_error: null,
        server: 'prod',
      },
    ];
    mock.db.holdings = [
      {
        broker_id: 'kis',
        connection_id: 1,
        market: 'KR',
        code: '005930',
        name: '삼성전자',
        quantity: '15',
        avg_price: 64000,
        currency: 'KRW',
        source: 'api',
        updated_at: '2026-11-06T14:00:00+09:00',
        supported: true,
        unsupported_reason: null,
        is_new: false,
      },
    ];
    const bodies: string[] = [];
    server.events.on('request:start', async ({ request }) => {
      if (request.method !== 'GET') bodies.push(await request.clone().text());
    });
    server.use(
      http.post('*/briefings/run', () =>
        HttpResponse.json({ market: 'KR', date: '2026-11-03' }, { status: 202 }),
      ),
    );
    renderAt('#/briefings');
    await userEvent.click(await screen.findByRole('button', { name: '국내 지금 만들기' }));
    await screen.findByText('국내 11월 3일(화) 브리핑을 만드는 중입니다.');
    expect(bodies).toEqual(['{"market":"KR"}']);
  });

  it('만들다 실패하면(briefing.status failed) 원인', async () => {
    server.use(
      http.post('*/briefings/run', () =>
        HttpResponse.json({ market: 'US', date: '2026-11-02' }, { status: 202 }),
      ),
    );
    const { stream } = renderAt('#/briefings');
    await userEvent.click(await screen.findByRole('button', { name: '미국 지금 만들기' }));
    await screen.findByText('미국 11월 2일(월) 브리핑을 만드는 중입니다.');
    const source = await stream();
    emit(source, 'briefing.status', {
      market: 'US',
      date: '2026-11-02',
      status: 'failed',
      error: {
        code: 'BRIEFING_NO_DATA',
        message: '한국투자증권에서 브리핑 데이터를 받지 못했습니다.',
      },
    });
    expect(await screen.findByText('브리핑을 만들지 못했습니다')).toBeInTheDocument();
    expect(
      screen.getByText(/한국투자증권에서 브리핑 데이터를 받지 못했습니다/),
    ).toBeInTheDocument();
  });

  it.each([
    ['BRIEFING_BUSY', '브리핑을 만드는 중입니다.', '끝난 뒤 다시 시도하세요.'],
    [
      'BRIEFING_NO_SESSION',
      '지금은 지난 거래일 브리핑을 만들 수 없습니다.',
      '다음 장이 열려 있어 데이터가 섞입니다. 오늘 장 마감 10분 뒤에 다시 시도하세요.',
    ],
  ])('409 %s: message와 hint', async (code, message, hint) => {
    server.use(http.post('*/briefings/run', () => errorResponse(409, code, message, hint)));
    renderAt('#/briefings');
    await userEvent.click(await screen.findByRole('button', { name: '국내 지금 만들기' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByText(hint)).toBeInTheDocument();
  });

  it('자동 일정으로 만드는 중이어도(briefing.status running) 알린다', async () => {
    const { stream } = renderAt('#/briefings');
    await waitFor(() => region('브리핑 목록'));
    const source = await stream();
    emit(source, 'briefing.status', { market: 'KR', date: '2026-11-03', status: 'running' });
    expect(
      await screen.findByText('국내 11월 3일(화) 브리핑을 만드는 중입니다.'),
    ).toBeInTheDocument();
  });
});

describe('브리핑 상세: 국내', () => {
  it('AI 문장 6개(머리 + 항목 5개)는 AiText, 숫자는 데이터 표', async () => {
    renderAt('#/briefings/21');
    expect(
      await screen.findByRole('heading', { level: 1, name: '11월 2일(월) 국내 시장 브리핑' }),
    ).toBeInTheDocument();
    const ai = document.querySelectorAll('[data-voice="ai"]');
    expect(ai).toHaveLength(6);
    expect(ai[0]).toHaveTextContent(/반도체 대형주가 지수를 끌어올렸고/);
    expect(
      screen.getByText(/코스피는 장 초반 약세를 딛고/).closest('[data-voice="ai"]'),
    ).not.toBeNull();
    expect(screen.getByText('투자 판단 보조용이며 투자 권유가 아닙니다.')).toBeInTheDocument();
  });

  it('지수 표와 미니 차트(색 = 그날 전일 대비)', async () => {
    renderAt('#/briefings/21');
    const part = await waitFor(() => region('지수'));
    const table = within(part).getByRole('table', { name: '지수' });
    const kosdaq = within(table).getByRole('row', { name: /코스닥/ });
    expect(within(kosdaq).getByText('742.15')).toBeInTheDocument();
    expect(within(kosdaq).getByText('−4.12')).toHaveAttribute('data-direction', 'down');
    expect(
      within(kosdaq).getByRole('img', { name: '코스닥 최근 30일 종가, 하락' }),
    ).toBeInTheDocument();
  });

  it('업종: 상승·하락·보합 종목 수와 업종 등락률', async () => {
    renderAt('#/briefings/21');
    const part = await waitFor(() => region('업종'));
    expect(within(part).getByText('상승 512 · 하락 318 · 보합 76')).toBeInTheDocument();
    const table = within(part).getByRole('table', { name: '코스피 업종' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[0]?.textContent)).toEqual([
      '전기전자',
      '화학',
      '음식료품',
    ]);
    expect(within(rows[0] as HTMLElement).getByText('+2.30%')).toHaveAttribute(
      'data-direction',
      'up',
    );
    expect(within(rows[1] as HTMLElement).getByText('0.00%')).toHaveAttribute(
      'data-direction',
      'flat',
    );
  });

  it('수급: 백만원 → 억, 순매수 빨강·순매도 파랑, 작은 값도 0억이 아님', async () => {
    renderAt('#/briefings/21');
    const part = await waitFor(() => region('수급'));
    // 가로 막대(DivergingBar): 순매수는 오른쪽(빨강), 순매도는 왼쪽(파랑), 0은 막대 없음
    const kospi = within(part).getByRole('img', { name: /투자자별 순매수 · 코스피/ });
    expect(within(kospi).getByText('+3,124억')).toBeInTheDocument();
    expect(kospi.querySelector('[data-row="외국인"] [data-side="right"]')).not.toBeNull();
    expect(within(kospi).getByText('−1,520억')).toBeInTheDocument();
    expect(kospi.querySelector('[data-row="기관"] [data-side="left"]')).not.toBeNull();
    const kosdaq = within(part).getByRole('img', { name: /투자자별 순매수 · 코스닥/ });
    expect(within(kosdaq).getByText('+0.4억')).toBeInTheDocument();
    expect(within(kosdaq).getByText('−3.2억')).toBeInTheDocument();
    expect(within(kosdaq).getByText('0.0억')).toBeInTheDocument();
  });

  it('상위 종목: 상승률·하락률·거래대금(억 원) 탭', async () => {
    renderAt('#/briefings/21');
    const part = await waitFor(() => region('상위 종목'));
    expect(within(part).getByRole('table', { name: '상승률 상위' })).toHaveTextContent('가나전자');
    await userEvent.click(within(part).getByRole('tab', { name: '거래대금' }));
    const table = within(part).getByRole('table', { name: '거래대금 상위' });
    expect(
      within(table).getByRole('columnheader', { name: '거래대금(억 원)' }),
    ).toBeInTheDocument();
    const samsung = within(table).getByRole('row', { name: /삼성전자/ });
    expect(within(samsung).getByText('18,240')).toBeInTheDocument();
    expect(within(samsung).getByText('71,400원')).toBeInTheDocument();
    const hynix = within(table).getByRole('row', { name: /SK하이닉스/ });
    expect(within(hynix).getByText('9.5')).toBeInTheDocument();
  });

  it('내 감시 종목과 그날 알림', async () => {
    renderAt('#/briefings/21');
    const watch = await waitFor(() => region('내 감시 종목'));
    const row = within(within(watch).getByRole('table', { name: '내 감시 종목' })).getByRole(
      'row',
      {
        name: /SK하이닉스/,
      },
    );
    expect(within(row).getByText('198,500원')).toBeInTheDocument();
    expect(within(row).getByText('−1.63%')).toHaveAttribute('data-direction', 'down');
    expect(
      within(watch).getByText('삼성전자 현재가 71,400 — 목표가 71,000 이상'),
    ).toBeInTheDocument();
  });

  it('빠진 항목은 그 자리에서 알린다', async () => {
    const kr = mock.db.briefings.find((b) => b.id === 21);
    if (!kr) throw new Error('fixture');
    kr.status = 'partial';
    kr.missing = ['flows', 'movers'];
    const data = { ...kr.data };
    delete data.flows;
    delete data.movers;
    kr.data = data;
    renderAt('#/briefings/21');
    const flows = await waitFor(() => region('수급'));
    expect(within(flows).getByText('수급 자료를 받지 못했습니다.')).toBeInTheDocument();
    expect(
      within(region('상위 종목')).getByText('상위 종목 자료를 받지 못했습니다.'),
    ).toBeInTheDocument();
    expect(screen.getByText('빠진 항목: 수급, 상위 종목')).toBeInTheDocument();
  });
});

describe('브리핑 상세: 미국', () => {
  it('지수 3개, 업종·수급·상위 종목은 없음(해당 없음), AI 해석이 없으면 데이터만', async () => {
    renderAt('#/briefings/20');
    expect(
      await screen.findByRole('heading', { level: 1, name: '11월 2일(월) 미국 시장 브리핑' }),
    ).toBeInTheDocument();
    expect(screen.getByText('AI 해석 없음(데이터만)')).toBeInTheDocument();
    // AI 해석만 빠졌으면 머리에 "일부 항목 빠짐"이라고 하지 않는다(무엇이 빠졌는지 그대로)
    expect(screen.getByText('11월 3일 07:00 만듦 · AI 해석 없음')).toBeInTheDocument();
    expect(screen.queryByText(/일부 항목 빠짐/)).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-voice="ai"]')).toHaveLength(0);
    const table = within(region('지수')).getByRole('table', { name: '지수' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByRole('row', { name: /나스닥100/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '업종' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '수급' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '상위 종목' })).not.toBeInTheDocument();
    const watch = within(region('내 감시 종목')).getByRole('row', { name: /애플/ });
    expect(within(watch).getByText('$227.48')).toBeInTheDocument();
    expect(
      within(region('내 감시 종목')).getByText('그날 울린 알림이 없습니다.'),
    ).toBeInTheDocument();
  });

  it('없는 브리핑이면 안내와 목록 링크', async () => {
    renderAt('#/briefings/999');
    expect(await screen.findByText('요청한 경로가 없습니다.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '브리핑 목록' })).toHaveAttribute(
      'href',
      '#/briefings',
    );
  });
});

describe('브리핑 상세: 내 자산 구역(스펙 15장)', () => {
  const assets = {
    change_krw: 130236,
    change_pct: 1.21,
    currencies: {
      KRW: { change: 111000, change_pct: 1.05 },
      USD: { change: 13.74, change_pct: 2.1 },
    },
    top: { code: '005930', name: '삼성전자', amount: 111000, currency: 'KRW' },
    bottom: { code: 'AAPL', name: '애플', amount: -3.21, currency: 'USD' },
  };
  const kr = () => {
    const b = mock.db.briefings.find((x) => x.id === 21);
    if (!b) throw new Error('fixture');
    return b;
  };

  it('전체 변화와 통화별 변화, 가장 많이 기여한·빠진 종목을 보여 주고 AI를 거치지 않았다고 알린다', async () => {
    kr().my_assets = assets;
    renderAt('#/briefings/21');
    const card = await waitFor(() => region('내 자산'));
    expect(within(card).getByText('+130,236원')).toHaveAttribute('data-direction', 'up');
    expect(within(card).getByText('+1.21%')).toBeInTheDocument();
    // 원화 변화와 가장 많이 기여한 종목(삼성전자) 둘 다 +111,000원
    expect(within(card).getAllByText('+111,000원')).toHaveLength(2);
    expect(within(card).getByText('+$13.74')).toBeInTheDocument();
    expect(within(card).getByText('삼성전자')).toBeInTheDocument();
    expect(within(card).getByText('−$3.21')).toHaveAttribute('data-direction', 'down');
    expect(
      within(card).getByText(/앱이 계산한 값입니다\. AI를 거치지 않습니다/),
    ).toBeInTheDocument();
    // AI 해석 꼬리표가 붙지 않는다
    expect(within(card).queryByText('AI 해석')).not.toBeInTheDocument();
  });

  it('보유 내역이 없으면(my_assets null) 이 구역을 숨긴다', async () => {
    kr().my_assets = null;
    renderAt('#/briefings/21');
    await screen.findByRole('region', { name: '지수' });
    expect(screen.queryByRole('region', { name: '내 자산' })).not.toBeInTheDocument();
  });

  it('my_assets 필드가 아예 없어도 숨긴다', async () => {
    delete kr().my_assets;
    renderAt('#/briefings/21');
    await screen.findByRole('region', { name: '지수' });
    expect(screen.queryByRole('region', { name: '내 자산' })).not.toBeInTheDocument();
  });

  it('top·bottom이 null이면 "해당 없음", 전일 기록이 없어 변화가 null이면 —와 이유', async () => {
    kr().my_assets = {
      change_krw: null,
      change_pct: null,
      currencies: { KRW: { change: null, change_pct: null } },
      top: null,
      bottom: null,
    };
    renderAt('#/briefings/21');
    const card = await waitFor(() => region('내 자산'));
    expect(within(card).getAllByText('해당 없음')).toHaveLength(2);
    expect(
      within(card).getByText(/전일 기록이나 종가·환율이 없어 변화를 계산하지 못했습니다/),
    ).toBeInTheDocument();
    expect(within(card).getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('계산이 실패해 my_assets가 빠졌으면 빠진 항목에 "내 자산"', async () => {
    kr().status = 'partial';
    kr().missing = ['my_assets'];
    renderAt('#/briefings/21');
    expect(await screen.findByText('빠진 항목: 내 자산')).toBeInTheDocument();
  });
});

describe('브리핑 상세: AI 해석이 없을 때(v0.2.1 21장 5번)', () => {
  /** 미국 브리핑(20번)의 해석이 빠진 이유를 정한다. */
  function failWith(code: string) {
    const us = mock.db.briefings.find((b) => b.id === 20);
    if (!us) throw new Error('fixture');
    us.interpret_error = { code, message: '사이드카 문구' };
  }

  it.each([
    ['LLM_BUSY', '구글 AI 서버가 혼잡합니다. 잠시 후 자동으로 다시 시도합니다.'],
    ['LLM_RATE_LIMITED', '무료 사용량의 분당 한도에 걸려 잠시 기다립니다.'],
    [
      'LLM_DAILY_LIMIT',
      '오늘 무료 사용량을 다 썼습니다. 내일 다시 시도하거나 로컬 AI로 바꿔 주세요.',
    ],
    [
      'BRIEFING_LLM_FAILED',
      'AI 해석을 끝내지 못했습니다. 잠시 뒤 [AI 해석 다시 만들기]를 눌러 주세요.',
    ],
  ])('%s: 이유를 보이고 [AI 해석 다시 만들기]를 둔다', async (code, text) => {
    failWith(code);
    renderAt('#/briefings/20');
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByText('AI 해석 없음(데이터만)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI 해석 다시 만들기' })).toBeEnabled();
    expect(screen.queryByRole('link', { name: '설정 열기' })).not.toBeInTheDocument();
  });

  it.each([
    ['LLM_KEY_INVALID', 'AI 키가 맞지 않습니다. 설정에서 키를 확인해 주세요.'],
    ['LLM_KEY_MISSING', 'AI 키가 없습니다. 설정에서 키를 넣어 주세요.'],
  ])('%s: 다시 만들기 대신 [설정 열기]', async (code, text) => {
    failWith(code);
    renderAt('#/briefings/20');
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '설정 열기' })).toHaveAttribute('href', '#/settings');
    expect(screen.queryByRole('button', { name: 'AI 해석 다시 만들기' })).not.toBeInTheDocument();
  });

  it('모르는 코드는 사이드카가 준 문구를 그대로 보인다', async () => {
    failWith('SOMETHING_NEW');
    renderAt('#/briefings/20');
    expect(await screen.findByText('사이드카 문구')).toBeInTheDocument();
  });

  it('이유가 없어도(옛 브리핑) 다시 만들기는 쓸 수 있다', async () => {
    renderAt('#/briefings/20');
    expect(await screen.findByRole('button', { name: 'AI 해석 다시 만들기' })).toBeEnabled();
  });

  it('해석이 있는 브리핑에는 다시 만들기를 두지 않는다', async () => {
    renderAt('#/briefings/21');
    await screen.findByRole('heading', { level: 1, name: /국내 시장 브리핑/ });
    expect(screen.queryByRole('button', { name: 'AI 해석 다시 만들기' })).not.toBeInTheDocument();
  });

  it('[AI 해석 다시 만들기] → POST → 만드는 중 → SSE done이면 해석이 나타난다', async () => {
    failWith('LLM_BUSY');
    const calls: string[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (request.method === 'POST') calls.push(url.pathname);
    });
    const { stream } = renderAt('#/briefings/20');
    await userEvent.click(await screen.findByRole('button', { name: 'AI 해석 다시 만들기' }));
    await waitFor(() => expect(calls).toEqual(['/briefings/20/interpret']));
    expect(await screen.findByText(/AI 해석을 만드는 중입니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AI 해석/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // 이전 이유는 만드는 동안 숨긴다
    expect(screen.queryByText(/구글 AI 서버가 혼잡합니다/)).not.toBeInTheDocument();

    const source = await stream();
    emit(source, 'briefing.status', { market: 'US', date: '2026-11-02', status: 'running' });
    expect(screen.getByText(/AI 해석을 만드는 중입니다/)).toBeInTheDocument();
    const us = mock.db.briefings.find((b) => b.id === 20);
    if (!us) throw new Error('fixture');
    Object.assign(us, {
      status: 'done',
      missing: [],
      interpret_error: null,
      headline: '나스닥이 올랐습니다. (예시)',
      text: { headline: '나스닥이 올랐습니다. (예시)', market: '지수가 올랐습니다.' },
    });
    emit(source, 'briefing.status', { market: 'US', date: '2026-11-02', status: 'done', id: 20 });
    expect(await screen.findByText('나스닥이 올랐습니다. (예시)')).toBeInTheDocument();
    expect(screen.queryByText(/AI 해석을 만드는 중입니다/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'AI 해석 다시 만들기' })).not.toBeInTheDocument();
  });

  it('SSE가 실패로 끝나면 새 이유를 보이고 다시 누를 수 있다', async () => {
    const { stream } = renderAt('#/briefings/20');
    await userEvent.click(await screen.findByRole('button', { name: 'AI 해석 다시 만들기' }));
    await screen.findByText(/AI 해석을 만드는 중입니다/);
    const source = await stream();
    const us = mock.db.briefings.find((b) => b.id === 20);
    if (!us) throw new Error('fixture');
    us.interpret_error = { code: 'LLM_DAILY_LIMIT', message: '사이드카 문구' };
    emit(source, 'briefing.status', {
      market: 'US',
      date: '2026-11-02',
      status: 'failed',
      id: 20,
      error: { code: 'LLM_DAILY_LIMIT', message: '사이드카 문구', hint: null },
    });
    expect(await screen.findByText(/오늘 무료 사용량을 다 썼습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/AI 해석을 만드는 중입니다/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI 해석 다시 만들기' })).toBeEnabled();
  });

  it('SSE 실패가 BRIEFING_BUSY면 다른 브리핑을 만드는 중이라고 알린다', async () => {
    const { stream } = renderAt('#/briefings/20');
    await userEvent.click(await screen.findByRole('button', { name: 'AI 해석 다시 만들기' }));
    await screen.findByText(/AI 해석을 만드는 중입니다/);
    const source = await stream();
    emit(source, 'briefing.status', {
      market: 'US',
      date: '2026-11-02',
      status: 'failed',
      id: 20,
      error: {
        code: 'BRIEFING_BUSY',
        message: '브리핑을 만드는 중입니다.',
        hint: '끝난 뒤 다시 시도하세요.',
      },
    });
    expect(await screen.findByText('브리핑을 만드는 중입니다.')).toBeInTheDocument();
    expect(screen.getByText(/끝난 뒤 다시 시도하세요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI 해석 다시 만들기' })).toBeEnabled();
  });

  it('이미 만드는 중이면(409) 만드는 중으로 보인다', async () => {
    server.use(
      http.post('*/briefings/:bid/interpret', () =>
        errorResponse(
          409,
          'BRIEFING_BUSY',
          '브리핑을 만드는 중입니다.',
          '끝난 뒤 다시 시도하세요.',
        ),
      ),
    );
    renderAt('#/briefings/20');
    await userEvent.click(await screen.findByRole('button', { name: 'AI 해석 다시 만들기' }));
    expect(await screen.findByText(/AI 해석을 만드는 중입니다/)).toBeInTheDocument();
  });

  it('브리핑이 없으면(404) 원인을 보인다', async () => {
    server.use(
      http.post('*/briefings/:bid/interpret', () =>
        errorResponse(404, 'BRIEFING_NOT_FOUND', '브리핑이 없습니다.'),
      ),
    );
    renderAt('#/briefings/20');
    await userEvent.click(await screen.findByRole('button', { name: 'AI 해석 다시 만들기' }));
    expect(await screen.findByText('브리핑이 없습니다.')).toBeInTheDocument();
    expect(screen.queryByText(/AI 해석을 만드는 중입니다/)).not.toBeInTheDocument();
  });

  it('요청 본문은 비어 있다(보유·감시 정보를 보내지 않는다)', async () => {
    let body = 'unset';
    server.events.on('request:start', async ({ request }) => {
      if (
        request.method === 'POST' &&
        new URL(request.url).pathname === '/briefings/20/interpret'
      ) {
        body = await request.clone().text();
      }
    });
    renderAt('#/briefings/20');
    await userEvent.click(await screen.findByRole('button', { name: 'AI 해석 다시 만들기' }));
    await waitFor(() => expect(body).not.toBe('unset'));
    expect(body).toBe('');
  });
});
