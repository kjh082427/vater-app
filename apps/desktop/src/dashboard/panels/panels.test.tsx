import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { analysisDone } from '../../mocks/fixtures';
import { errorResponse } from '../../mocks/handlers';
import { FakeEventSource } from '../../test/FakeEventSource';
import { emit, renderWithServices } from '../../test/render';
import { mock, server } from '../../test/server';
import { DashboardView } from '../DashboardView';
import { templateRoot } from '../layout/templates';

/** 옛 홈의 영역 테스트를 칸 내용으로 옮겼다: 칸 하나짜리 대시보드(넓이 1048px)로 그린다. */
const NAME: Record<string, string> = { '최근 브리핑': '브리핑 요약' };
const section = (name: string) =>
  screen.getByRole('region', { name: `칸 1: ${NAME[name] ?? name}` });

function renderPanel(
  type: string,
  options: Record<string, unknown> = {},
  render: { retryDelaysMs?: number[] } = {},
) {
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
    render,
  );
}

const serverError = () =>
  errorResponse(
    500,
    'INTERNAL',
    '예상하지 못한 오류가 발생했습니다.',
    '로그 폴더를 확인해 주세요.',
  );

describe('최근 브리핑', () => {
  it('국내: AI 한 줄 요약, 수급 막대, 브리핑 읽기', async () => {
    renderPanel('briefing');
    const card = section('최근 브리핑');
    const lead = await within(card).findByText(/반도체 대형주가 지수를 끌어올렸고/);
    expect(lead.closest('[data-voice="ai"]')).not.toBeNull();
    expect(within(card).getByText('AI 해석')).toBeInTheDocument();
    expect(within(card).getByText('11월 2일(월) 국내 마감 · 16:00 생성')).toBeInTheDocument();

    const bars = within(card).getByRole('img', { name: /투자자별 순매수 · 코스피/ });
    expect(within(bars).getByText('+3,124억')).toBeInTheDocument();
    expect(within(bars).getByText('−1,520억')).toBeInTheDocument();
    expect(within(card).getByText(/투자 권유가 아닙니다/)).toBeInTheDocument();

    expect(within(card).getByRole('link', { name: /브리핑 읽기/ })).toHaveAttribute(
      'href',
      '#/briefings/21',
    );
  });

  it('미국(옵션): AI 해석이 없으면 "AI 해석 없음(데이터만)"(빠진 항목에 다시 쓰지 않음)', async () => {
    renderPanel('briefing', { market: 'US' });
    const card = section('최근 브리핑');
    expect(await within(card).findByText('S&P500')).toBeInTheDocument();
    expect(within(card).getByText('AI 해석 없음(데이터만)')).toBeInTheDocument();
    expect(within(card).queryByText(/빠진 항목/)).not.toBeInTheDocument();
    expect(within(card).getByText('11월 2일(월) 미국 마감 · 07:00 생성')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /브리핑 읽기/ })).toHaveAttribute(
      'href',
      '#/briefings/20',
    );
  });

  it('브리핑이 없으면 언제 만들어지는지 알려 준다', async () => {
    mock.db.briefings = [];
    renderPanel('briefing');
    expect(
      await within(section('최근 브리핑')).findByText(
        '아직 국내 브리핑이 없습니다. 거래일마다 16:00에 자동으로 만들어집니다.',
      ),
    ).toBeInTheDocument();
  });

  it('시장 브리핑이 꺼져 있으면 설정으로 안내', async () => {
    mock.db.briefings = [];
    mock.db.settings['briefing.kr.enabled'] = false;
    renderPanel('briefing');
    const card = section('최근 브리핑');
    expect(await within(card).findByText(/국내 브리핑이 꺼져 있습니다/)).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: '설정 열기' })).toHaveAttribute(
      'href',
      '#/settings',
    );
  });

  it('오류면 원인과 해결 방법, [다시 시도]로 다시 불러온다', async () => {
    let fail = true;
    server.use(http.get('*/briefings', () => (fail ? serverError() : undefined)));
    renderPanel('briefing');
    const card = section('최근 브리핑');
    expect(await within(card).findByText(/로그 폴더를 확인해 주세요/)).toBeInTheDocument();
    fail = false;
    await userEvent.click(
      within(card).getAllByRole('button', { name: '다시 시도' })[0] as HTMLElement,
    );
    expect(await within(card).findByText(/반도체 대형주/)).toBeInTheDocument();
  });

  it('지수 자료가 빠졌으면 표 대신 안내', async () => {
    const kr = mock.db.briefings.find((b) => b.market === 'KR');
    if (!kr) throw new Error('fixture');
    kr.data = { market: 'KR' };
    kr.missing = ['indices'];
    kr.status = 'partial';
    renderPanel('briefing');
    const card = section('최근 브리핑');
    expect(await within(card).findByText('빠진 항목: 지수')).toBeInTheDocument();
    expect(within(card).queryByRole('table', { name: '지수' })).not.toBeInTheDocument();
  });
});

describe('감시 종목', () => {
  it('현재가·전일 대비·등락률·수신 상태', async () => {
    renderPanel('watchlist');
    const table = await within(section('감시 종목')).findByRole('table', { name: '감시 종목' });
    const samsung = await within(table).findByRole('row', { name: /삼성전자/ });
    expect(within(samsung).getByText('71,400원')).toBeInTheDocument();
    expect(within(samsung).getByText('+1,200')).toHaveAttribute('data-direction', 'up');
    expect(within(samsung).getByText('+1.71%')).toHaveAttribute('data-direction', 'up');
    expect(within(samsung).getByText('실시간')).toBeInTheDocument();

    const hynix = within(table).getByRole('row', { name: /SK하이닉스/ });
    expect(within(hynix).getByText('−3,300')).toHaveAttribute('data-direction', 'down');
    expect(within(hynix).getByText('30초마다 확인')).toBeInTheDocument();

    const apple = within(table).getByRole('row', { name: /애플/ });
    expect(within(apple).getByText('$227.48')).toBeInTheDocument();
    expect(within(apple).getByText('+$2.13')).toBeInTheDocument();
    expect(within(apple).getByText('장 마감')).toBeInTheDocument();
    expect(within(section('감시 종목')).getByText('3종목 · 상승 2 · 하락 1')).toBeInTheDocument();
  });

  it('SSE quote로 시세가 바뀐다', async () => {
    const { stream } = renderPanel('watchlist');
    const table = await within(section('감시 종목')).findByRole('table', { name: '감시 종목' });
    await within(table).findByText('71,400원');
    const source = await stream();
    emit(source, 'quote', {
      market: 'KR',
      code: '005930',
      price: 70100,
      change: -100,
      change_pct: -0.14,
      at: '2026-11-03T14:40:00+09:00',
      source: 'realtime',
    });
    const samsung = within(table).getByRole('row', { name: /삼성전자/ });
    expect(await within(samsung).findByText('70,100원')).toBeInTheDocument();
    expect(within(samsung).getByText('−100')).toHaveAttribute('data-direction', 'down');
    expect(within(samsung).getByText('−0.14%')).toBeInTheDocument();
  });

  it('alerts.state의 수신 상태로 바뀐다(끊김)', async () => {
    const { stream } = renderPanel('watchlist');
    const table = await within(section('감시 종목')).findByRole('table', { name: '감시 종목' });
    await within(table).findByText('실시간');
    const source = await stream();
    emit(source, 'alerts.state', {
      ...mock.db.monitor,
      state: 'offline',
      feeds: mock.db.monitor.feeds.map((f) => ({ ...f, feed: 'offline' as const })),
    });
    expect(await within(table).findAllByText('끊김 · 재연결 중')).toHaveLength(3);
  });

  it('SSE가 끊긴 동안 수신 열은 실시간이라고 말하지 않는다', async () => {
    const { stream } = renderPanel('watchlist', {}, { retryDelaysMs: [60_000] });
    const table = await within(section('감시 종목')).findByRole('table', { name: '감시 종목' });
    await within(table).findByText('실시간');
    const source = await stream();
    act(() => source.fail());
    // 장 마감 종목은 그대로(실시간이라고 주장하지 않으므로), 나머지는 끊김
    expect(await within(table).findAllByText('끊김 · 재연결 중')).toHaveLength(2);
    expect(within(table).queryByText('실시간')).not.toBeInTheDocument();
    expect(within(table).getByText('장 마감')).toBeInTheDocument();
  });

  it('가격이 없으면 "—"와 "데이터 없음"', async () => {
    mock.db.watchQuotes = mock.db.watchQuotes.map((q) =>
      q.code === '005930' ? { ...q, price: null, change: null, change_pct: null } : q,
    );
    renderPanel('watchlist');
    const table = await within(section('감시 종목')).findByRole('table', { name: '감시 종목' });
    const samsung = await within(table).findByRole('row', { name: /삼성전자/ });
    expect(within(samsung).getAllByText('—')).toHaveLength(3);
    expect(within(samsung).getAllByText('데이터 없음')).toHaveLength(3);
  });

  it('실시간 규칙이 없는 장중 종목(idle)은 그렇게 알린다', async () => {
    mock.db.watchQuotes = mock.db.watchQuotes.map((q) =>
      q.code === '005930' ? { ...q, feed: 'idle' as const } : q,
    );
    renderPanel('watchlist');
    const table = await within(section('감시 종목')).findByRole('table', { name: '감시 종목' });
    const samsung = await within(table).findByRole('row', { name: /삼성전자/ });
    expect(within(samsung).getByText('실시간 규칙 없음')).toBeInTheDocument();
  });

  it('행을 누르면 그 종목의 감시·알림으로', async () => {
    renderPanel('watchlist');
    const table = await within(section('감시 종목')).findByRole('table', { name: '감시 종목' });
    await userEvent.click(await within(table).findByText('SK하이닉스'));
    await waitFor(() => expect(window.location.hash).toBe('#/symbols/KR/000660'));
  });

  it('비었으면 할 일을 알려 주고 [종목 추가]는 감시·알림으로', async () => {
    mock.db.watchQuotes = [];
    renderPanel('watchlist');
    const part = section('감시 종목');
    expect(await within(part).findByText(/감시 종목이 없습니다/)).toBeInTheDocument();
    await userEvent.click(within(part).getByRole('link', { name: '종목 추가' }));
    await waitFor(() => expect(window.location.hash).toBe('#/alerts'));
  });

  it('오류면 원인과 해결 방법', async () => {
    server.use(http.get('*/watchlist/quotes', serverError));
    renderPanel('watchlist');
    expect(
      await within(section('감시 종목')).findByText(/로그 폴더를 확인해 주세요/),
    ).toBeInTheDocument();
  });
});

describe('최근 알림', () => {
  it('칸 높이만큼(5~10개) 시각과 함께, 새 알림(alert.fired)은 위에 더한다', async () => {
    let limit: string | null = null;
    server.use(
      http.get('*/alerts/events', ({ request }) => {
        limit = new URL(request.url).searchParams.get('limit');
        return HttpResponse.json(mock.db.events);
      }),
    );
    const { stream } = renderPanel('recent-alerts');
    const part = section('최근 알림');
    const list = await within(part).findByRole('list');
    expect(limit).toBe('100');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(
      within(list).getByText('삼성전자 현재가 71,400 — 목표가 71,000 이상'),
    ).toBeInTheDocument();
    expect(within(list).getByText('11월 3일 13:58 · 목표가 이상')).toBeInTheDocument();
    const source = await stream();
    for (let i = 0; i < 3; i += 1) {
      emit(source, 'alert.fired', {
        id: 200 + i,
        rule_id: 4,
        fired_at: '2026-11-03T15:00:00+09:00',
        value: 72000,
        message: `새 알림 ${i}`,
        market: 'KR',
        code: '005930',
        name: '삼성전자',
        kind: 'price_above',
      });
    }
    // 칸 높이 576px → 8줄까지: 원래 3개 + 새 3개
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(6));
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('새 알림 2');
  });

  it('종목 알림은 그 종목의 감시·알림으로 가는 링크', async () => {
    renderPanel('recent-alerts');
    const link = await within(section('최근 알림')).findByRole('link', {
      name: /삼성전자 현재가 71,400/,
    });
    expect(link).toHaveAttribute('href', '#/symbols/KR/005930');
  });

  it('비었으면 할 일을 알려 준다', async () => {
    mock.db.events = [];
    renderPanel('recent-alerts');
    expect(
      await within(section('최근 알림')).findByText(/아직 울린 알림이 없습니다/),
    ).toBeInTheDocument();
  });

  it('오류면 원인과 해결 방법', async () => {
    server.use(http.get('*/alerts/events', serverError));
    renderPanel('recent-alerts');
    expect(await within(section('최근 알림')).findByText(/로그 폴더를/)).toBeInTheDocument();
  });
});

describe('진행 중인 분석', () => {
  function addRunning() {
    mock.db.analyses.push({
      ...analysisDone,
      id: 30,
      code: '000660',
      name: 'SK하이닉스',
      status: 'running',
      decision: null,
      decision_ko: null,
    });
  }

  it('진행 단계와 경과 시간이 SSE로 바뀌고, other 단계는 보이지 않는다', async () => {
    addRunning();
    const { stream } = renderPanel('running-analyses');
    const part = section('진행 중인 분석');
    const link = await within(part).findByRole('link', { name: /SK하이닉스/ });
    expect(link).toHaveAttribute('href', '#/analyses/30');
    expect(within(part).getByText('실행 중')).toBeInTheDocument();
    const source = await stream();
    emit(source, 'analysis.progress', {
      id: 30,
      stage: 'research',
      node: 'Bull Researcher',
      elapsed_sec: 412.4,
    });
    expect(
      await within(part).findByText('실행 중 · 강세·약세 토론 · 6분 52초'),
    ).toBeInTheDocument();
    emit(source, 'analysis.progress', {
      id: 30,
      stage: 'other',
      node: 'Msg Clear',
      elapsed_sec: 420,
    });
    expect(await within(part).findByText('실행 중 · 강세·약세 토론 · 7분')).toBeInTheDocument();
    expect(within(part).queryByText(/other/)).not.toBeInTheDocument();
  });

  it('새로 들어온 분석(queued)이 나타나고, 끝나면 사라진다', async () => {
    const { stream } = renderPanel('running-analyses');
    const part = section('진행 중인 분석');
    await within(part).findByText(/진행 중인 분석이 없습니다/);
    const source = await stream();
    mock.db.analyses.push({
      ...analysisDone,
      id: 31,
      code: 'AAPL',
      market: 'US',
      name: '애플',
      status: 'queued',
    });
    emit(source, 'analysis.status', { id: 31, status: 'queued' });
    expect(await within(part).findByRole('link', { name: /애플/ })).toBeInTheDocument();
    expect(within(part).getByText('대기 중')).toBeInTheDocument();
    emit(source, 'analysis.status', { id: 31, status: 'done', decision: 'Hold' });
    await waitFor(() =>
      expect(within(part).queryByRole('link', { name: /애플/ })).not.toBeInTheDocument(),
    );
  });

  it('비었으면 [새 분석]을 알려 준다', async () => {
    renderPanel('running-analyses');
    expect(
      await within(section('진행 중인 분석')).findByText(/진행 중인 분석이 없습니다/),
    ).toBeInTheDocument();
  });

  it('오류면 원인과 해결 방법', async () => {
    server.use(http.get('*/analyses', serverError));
    renderPanel('running-analyses');
    expect(await within(section('진행 중인 분석')).findByText(/로그 폴더를/)).toBeInTheDocument();
  });
});

describe('사이드카 재시작 뒤', () => {
  it('SSE가 다시 열리면 감시 종목을 다시 불러온다', async () => {
    const { stream, shell } = renderPanel('watchlist');
    const table = await within(section('감시 종목')).findByRole('table', { name: '감시 종목' });
    await within(table).findByText('71,400원');
    await stream();
    mock.db.watchQuotes = mock.db.watchQuotes.map((q) =>
      q.code === '005930' ? { ...q, price: 69900 } : q,
    );
    act(() => shell.restart({ state: 'ready', baseUrl: 'http://127.0.0.1:41001', token: 't2' }));
    await waitFor(() => expect(FakeEventSource.all).toHaveLength(2));
    expect(FakeEventSource.latest.url).toBe('http://127.0.0.1:41001/events?token=t2');
    act(() => FakeEventSource.latest.open());
    expect(await within(table).findByText('69,900원')).toBeInTheDocument();
  });
});
