import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { AnalysisDetail } from '../../api/types';
import { App } from '../../app/App';
import { analysisDone } from '../../mocks/fixtures';
import { errorResponse } from '../../mocks/handlers';
import { emit, renderWithServices } from '../../test/render';
import { mock, server } from '../../test/server';
import { choose } from '../../test/select';

function renderAt(hash: string) {
  window.location.hash = hash;
  return renderWithServices(<App />);
}

const region = (name: string | RegExp) => screen.getByRole('region', { name });

function setAnalysis(id: number, patch: Partial<AnalysisDetail>) {
  const found = mock.db.analyses.find((a) => a.id === id);
  if (!found) throw new Error(`analysis ${id}`);
  Object.assign(found, patch);
}

function addRunning(id = 40): AnalysisDetail {
  const running: AnalysisDetail = {
    ...analysisDone,
    id,
    status: 'running',
    decision: null,
    decision_ko: null,
    decision_changed: false,
    summary: null,
    price_target: null,
    time_horizon: null,
    reports: null,
    timings: null,
    tokens: null,
  };
  mock.db.analyses.push(running);
  return running;
}

describe('새 분석', () => {
  it('종목 검색 → 선택 → 분석 시작 → 진행 SSE → 완료', async () => {
    let body: unknown = null;
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'POST' && new URL(request.url).pathname === '/analyses') {
        body = await request.clone().json();
      }
    });
    const { stream } = renderAt('#/analyses');
    const form = await screen.findByRole('form', { name: '새 분석' });
    await userEvent.type(within(form).getByRole('searchbox', { name: '종목 검색' }), '삼성');
    await userEvent.click(await within(form).findByRole('button', { name: '삼성전자 선택' }));
    expect(within(form).getByText('삼성전자')).toBeInTheDocument();
    await userEvent.click(within(form).getByRole('button', { name: '분석 시작' }));
    await waitFor(() => expect(window.location.hash).toBe('#/analyses/100'));
    expect(body).toEqual({ market: 'KR', code: '005930' });

    const progress = await screen.findByRole('region', { name: '진행' });
    expect(within(progress).getByText('대기 중')).toBeInTheDocument();
    const source = await stream();
    setAnalysis(100, { status: 'running' });
    emit(source, 'analysis.status', { id: 100, status: 'running' });
    emit(source, 'analysis.progress', {
      id: 100,
      stage: 'analysts',
      node: 'Market Analyst',
      elapsed_sec: 95,
    });
    emit(source, 'analysis.progress', {
      id: 100,
      stage: 'research',
      node: 'Bull Researcher',
      elapsed_sec: 150,
    });
    const steps = await within(progress).findByRole('list', { name: '진행 단계' });
    const analysts = within(steps).getByText('애널리스트').closest('li') as HTMLElement;
    expect(analysts).toHaveTextContent('완료');
    expect(analysts).toHaveTextContent('1분 35초');
    const research = within(steps).getByText('강세·약세 토론').closest('li') as HTMLElement;
    expect(research).toHaveTextContent('진행 중');
    expect(research).toHaveTextContent('55초');
    expect(within(steps).getByText('트레이더').closest('li')).toHaveTextContent('대기');
    expect(within(progress).getByText('경과 2분 30초')).toBeInTheDocument();

    setAnalysis(100, { ...analysisDone, id: 100 });
    emit(source, 'analysis.status', { id: 100, status: 'done', decision: 'Overweight' });
    expect(
      await screen.findByRole('img', {
        name: /AI 의견 비중확대: 매도부터 매수까지 5단계 중 4단계/,
      }),
    ).toBeInTheDocument();
  });

  it('기준일과 AI 사용 방식을 고르면 함께 보낸다', async () => {
    let body: unknown = null;
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'POST' && new URL(request.url).pathname === '/analyses') {
        body = await request.clone().json();
      }
    });
    renderAt('#/analyses');
    const form = await screen.findByRole('form', { name: '새 분석' });
    await userEvent.type(within(form).getByRole('searchbox', { name: '종목 검색' }), 'AAPL');
    await userEvent.click(await within(form).findByRole('button', { name: '애플 선택' }));
    await userEvent.type(within(form).getByLabelText('기준일'), '2026-10-30');
    await choose(form, 'AI 사용 방식', '로컬');
    await userEvent.click(within(form).getByRole('button', { name: '분석 시작' }));
    await waitFor(() =>
      expect(body).toEqual({ market: 'US', code: 'AAPL', as_of: '2026-10-30', preset: 'local' }),
    );
  });

  it('종목을 고르지 않으면 보내지 않고 이유', async () => {
    renderAt('#/analyses');
    const form = await screen.findByRole('form', { name: '새 분석' });
    await userEvent.click(within(form).getByRole('button', { name: '분석 시작' }));
    expect(within(form).getByText('분석할 종목을 먼저 고르세요.')).toBeInTheDocument();
  });

  it('시작할 수 없으면(키 없음 등) 원인과 해결 방법', async () => {
    server.use(
      http.post('*/analyses', () =>
        errorResponse(
          400,
          'LLM_KEY_MISSING',
          '클라우드 AI 키가 없습니다.',
          '설정 > AI 엔진에서 키를 넣으세요.',
        ),
      ),
    );
    renderAt('#/analyses');
    const form = await screen.findByRole('form', { name: '새 분석' });
    await userEvent.type(within(form).getByRole('searchbox', { name: '종목 검색' }), '삼성');
    await userEvent.click(await within(form).findByRole('button', { name: '삼성전자 선택' }));
    await userEvent.click(within(form).getByRole('button', { name: '분석 시작' }));
    expect(await within(form).findByText('클라우드 AI 키가 없습니다.')).toBeInTheDocument();
    expect(within(form).getByText('설정 > AI 엔진에서 키를 넣으세요.')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/analyses');
  });

  it('주소의 쿼리로 종목·기준일을 미리 채운다(프리셋 바꿔 다시 분석)', async () => {
    renderAt('#/analyses?market=US&code=AAPL&as_of=2026-11-02');
    const form = await screen.findByRole('form', { name: '새 분석' });
    expect(await within(form).findByText('AAPL')).toBeInTheDocument();
    expect(within(form).getByLabelText('기준일')).toHaveValue('2026-11-02');
  });
});

describe('진행 타임라인', () => {
  it('other 단계는 보이지 않고, 그 시간은 어느 단계에도 더하지 않는다', async () => {
    addRunning(40);
    const { stream } = renderAt('#/analyses/40');
    const progress = await screen.findByRole('region', { name: '진행' });
    const source = await stream();
    emit(source, 'analysis.progress', {
      id: 40,
      stage: 'analysts',
      node: 'Market Analyst',
      elapsed_sec: 60,
    });
    emit(source, 'analysis.progress', {
      id: 40,
      stage: 'other',
      node: 'Msg Clear Market',
      elapsed_sec: 70,
    });
    emit(source, 'analysis.progress', {
      id: 40,
      stage: 'analysts',
      node: 'News Analyst',
      elapsed_sec: 100,
    });
    emit(source, 'analysis.progress', { id: 41, stage: 'trader', node: 'Trader', elapsed_sec: 5 });
    const steps = within(progress).getByRole('list', { name: '진행 단계' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(5);
    expect(within(progress).queryByText(/other|Msg Clear/)).not.toBeInTheDocument();
    const analysts = within(steps).getByText('애널리스트').closest('li') as HTMLElement;
    await waitFor(() => expect(analysts).toHaveTextContent('1분 30초'));
    expect(analysts).toHaveTextContent('진행 중');
    expect(within(steps).getByText('트레이더').closest('li')).toHaveTextContent('대기');
  });

  it('다른 화면에 있는 동안 받은 진행도 분석 화면을 열면 보인다(홈과 같은 진행 상황)', async () => {
    addRunning(40);
    const { stream } = renderAt('#/home');
    await screen.findByRole('heading', { level: 1, name: '홈' });
    const source = await stream();
    emit(source, 'analysis.progress', {
      id: 40,
      stage: 'analysts',
      node: 'Market Analyst',
      elapsed_sec: 412.4,
    });
    emit(source, 'analysis.progress', {
      id: 40,
      stage: 'research',
      node: 'Bull Researcher',
      elapsed_sec: 530,
    });
    act(() => {
      window.location.hash = '#/analyses/40';
    });
    const progress = await screen.findByRole('region', { name: '진행' });
    const steps = within(progress).getByRole('list', { name: '진행 단계' });
    expect(within(steps).getByText('애널리스트').closest('li')).toHaveTextContent('6분 52초');
    expect(within(steps).getByText('강세·약세 토론').closest('li')).toHaveTextContent('진행 중');
    expect(within(progress).getByText('경과 8분 50초')).toBeInTheDocument();
  });

  it('구글 AI 혼잡·분당 한도로 기다리는 중이면 그 문구, 다음 진행이 오면 사라진다(v2 설계 20장)', async () => {
    addRunning(40);
    const { stream } = renderAt('#/analyses/40');
    const progress = await screen.findByRole('region', { name: '진행' });
    const source = await stream();
    emit(source, 'analysis.progress', {
      id: 40,
      stage: 'analysts',
      node: 'Market Analyst',
      elapsed_sec: 60,
    });
    const busy = '구글 AI 서버가 혼잡합니다. 잠시 후 자동으로 다시 시도합니다.';
    emit(source, 'analysis.progress', {
      id: 40,
      stage: 'other',
      node: 'gemini-3.5-flash-lite',
      elapsed_sec: 200,
      wait: { reason: 'busy', message: busy, seconds: 20 },
    });
    expect(await within(progress).findByText(busy)).toBeInTheDocument();
    expect(within(progress).getByText('경과 1분')).toBeInTheDocument(); // 기다림은 진행 시간에 넣지 않는다
    emit(source, 'analysis.progress', {
      id: 40,
      stage: 'analysts',
      node: 'News Analyst',
      elapsed_sec: 240,
      wait: null,
    });
    await waitFor(() => expect(within(progress).queryByText(busy)).not.toBeInTheDocument());
    const steps = within(progress).getByRole('list', { name: '진행 단계' });
    expect(within(steps).getByText('애널리스트').closest('li')).toHaveTextContent('4분');
  });

  it('진행 소식을 아직 못 받았으면 모두 대기로 보이지 않고 "단계 확인 중"과 요청 시각', async () => {
    addRunning(40);
    renderAt('#/analyses/40');
    const progress = await screen.findByRole('region', { name: '진행' });
    expect(within(progress).getByText(/단계 확인 중/)).toBeInTheDocument();
    expect(within(progress).getByText('요청 11월 3일 12:41')).toBeInTheDocument();
    const steps = within(progress).getByRole('list', { name: '진행 단계' });
    expect(within(steps).queryByText('대기')).not.toBeInTheDocument();
  });

  it('취소: 지금 단계가 끝나면 멈춘다고 알리고, cancelled가 오면 취소됨', async () => {
    addRunning(40);
    server.use(
      http.post('*/analyses/40/cancel', () => HttpResponse.json({ id: 40, status: 'cancelling' })),
    );
    const { stream } = renderAt('#/analyses/40');
    const progress = await screen.findByRole('region', { name: '진행' });
    await userEvent.click(within(progress).getByRole('button', { name: '분석 취소' }));
    expect(await within(progress).findByText(/지금 단계가 끝나면 멈춥니다/)).toBeInTheDocument();
    const source = await stream();
    setAnalysis(40, { status: 'cancelled' });
    emit(source, 'analysis.status', { id: 40, status: 'cancelled' });
    expect(await screen.findByText('분석을 취소했습니다.')).toBeInTheDocument();
  });

  it('대기 중에 취소하면 바로 취소됨', async () => {
    addRunning(40);
    setAnalysis(40, { status: 'queued' });
    renderAt('#/analyses/40');
    const progress = await screen.findByRole('region', { name: '진행' });
    await userEvent.click(within(progress).getByRole('button', { name: '분석 취소' }));
    expect(await screen.findByText('분석을 취소했습니다.')).toBeInTheDocument();
  });

  it('취소가 거절되면(이미 끝남) 사이드카 문구', async () => {
    addRunning(40);
    server.use(
      http.post('*/analyses/40/cancel', () =>
        errorResponse(
          409,
          'ANALYSIS_NOT_CANCELLABLE',
          '이미 끝난 분석은 취소할 수 없습니다 (done).',
        ),
      ),
    );
    renderAt('#/analyses/40');
    const progress = await screen.findByRole('region', { name: '진행' });
    await userEvent.click(within(progress).getByRole('button', { name: '분석 취소' }));
    expect(
      await within(progress).findByText('이미 끝난 분석은 취소할 수 없습니다 (done).'),
    ).toBeInTheDocument();
  });
});

describe('결과', () => {
  it('의견 눈금, 3줄 요약(AI), 목표가·기간, 면책 두 줄', async () => {
    renderAt('#/analyses/7');
    expect(
      await screen.findByRole('heading', { level: 1, name: '삼성전자 분석' }),
    ).toBeInTheDocument();
    const opinion = region('AI 의견');
    expect(within(opinion).getByRole('img', { name: /AI 의견 비중확대/ })).toBeInTheDocument();
    const summary = within(opinion).getByRole('list', { name: '핵심 근거' });
    expect(within(summary).getAllByRole('listitem')).toHaveLength(3);
    expect(summary.closest('[data-voice="ai"]')).not.toBeNull();
    expect(within(opinion).getByText('AI 요약')).toBeInTheDocument();
    expect(within(opinion).getByText('목표가 82,000원 · 기간 6개월')).toBeInTheDocument();
    expect(within(opinion).getByText(/직전 분석과 결정이 달라졌습니다/)).toBeInTheDocument();
    expect(
      within(opinion).getByText(
        '투자 판단 보조용이며 투자 권유가 아닙니다. 모델과 실행에 따라 결론이 달라질 수 있습니다.',
      ),
    ).toBeInTheDocument();
  });

  it.each([
    ['Buy', '매수', '5단계 중 5단계'],
    ['Overweight', '비중확대', '5단계 중 4단계'],
    ['Hold', '보유', '5단계 중 3단계'],
    ['Underweight', '비중축소', '5단계 중 2단계'],
    ['Sell', '매도', '5단계 중 1단계'],
    ['REVIEW', '검토 필요', '사람이 검토해야 합니다'],
  ])('결정 %s → %s', async (decision, label, spoken) => {
    setAnalysis(7, { decision });
    renderAt('#/analyses/7');
    const scale = await within(await waitFor(() => region('AI 의견'))).findByRole('img', {
      name: new RegExp(`AI 의견 ${label}`),
    });
    expect(scale).toHaveAccessibleName(expect.stringContaining(spoken));
    expect(scale).toHaveTextContent(label);
  });

  it('모르는 결정 값은 검토 필요로 본다', async () => {
    setAnalysis(7, { decision: 'Strong Buy' });
    renderAt('#/analyses/7');
    expect(
      await within(await waitFor(() => region('AI 의견'))).findByRole('img', { name: /검토 필요/ }),
    ).toBeInTheDocument();
  });

  it('에이전트별 탭: 빈 보고서는 빼고, 애널리스트 원문에는 "원문(영어일 수 있음)"', async () => {
    renderAt('#/analyses/7');
    const reports = await waitFor(() => region('에이전트 보고서'));
    const tabs = within(reports)
      .getAllByRole('tab')
      .map((t) => t.textContent);
    expect(tabs).toEqual([
      '시장 분석',
      '뉴스 분석',
      '재무 분석',
      '리서치 매니저',
      '트레이더',
      '포트폴리오 매니저',
    ]);
    const panel = within(reports).getByRole('tabpanel');
    expect(within(panel).getByText(/Market analysis: price is above/)).toBeInTheDocument();
    expect(within(panel).getByText('원문(영어일 수 있음)')).toBeInTheDocument();
    await userEvent.click(within(reports).getByRole('tab', { name: '트레이더' }));
    const trader = within(reports).getByRole('tabpanel');
    expect(within(trader).getByText(/분할 접근을 제안합니다/)).toBeInTheDocument();
    expect(within(trader).queryByText('원문(영어일 수 있음)')).not.toBeInTheDocument();
    expect(
      within(trader)
        .getByText(/분할 접근을/)
        .closest('[data-voice="ai"]'),
    ).not.toBeNull();
  });

  it('실행 정보: 프리셋, 모델, 단계별·전체 시간, 토큰', async () => {
    renderAt('#/analyses/7');
    const info = await waitFor(() => region('실행 정보'));
    expect(within(info).getByText('클라우드')).toBeInTheDocument();
    expect(within(info).getByText('google · gemini-3-pro')).toBeInTheDocument();
    expect(within(info).getByText('google · gemini-3-flash')).toBeInTheDocument();
    expect(within(info).getByText('15분 55초')).toBeInTheDocument(); // 412.4+188.1+61+240.7+52.3 = 954.5
    expect(within(info).getByText('입력 182,340 · 출력 24,120')).toBeInTheDocument();
    const steps = within(info).getByRole('table', { name: '단계별 시간' });
    expect(within(steps).getByRole('row', { name: /애널리스트/ })).toHaveTextContent('6분 52초');
  });
  it('대체 모델이 답했으면 실행 정보에 표시', async () => {
    setAnalysis(7, {
      models: {
        deep: { provider: 'google', model: 'gemini-3-pro', fallbacks: ['gemini-3.5-flash'] },
        quick: { provider: 'google', model: 'gemini-3-flash', fallbacks: [] },
      },
    });
    renderAt('#/analyses/7');
    const info = await waitFor(() => region('실행 정보'));
    expect(
      within(info).getByText('google · gemini-3-pro (혼잡·한도로 대체: gemini-3.5-flash)'),
    ).toBeInTheDocument();
    expect(within(info).getByText('google · gemini-3-flash')).toBeInTheDocument();
  });
});

describe('실패', () => {
  it('오류 메시지·hint와 [다시 시도](체크포인트로 이어서)', async () => {
    renderAt('#/analyses/6');
    const failed = await waitFor(() => region('분석 실패'));
    expect(within(failed).getByText('클라우드 AI 호출 한도를 넘었습니다.')).toBeInTheDocument();
    expect(within(failed).getByText(/끝난 단계는 건너뜁니다/)).toBeInTheDocument();
    const steps = within(failed).getByRole('list', { name: '진행 단계' });
    expect(within(steps).getByText('애널리스트').closest('li')).toHaveTextContent('2분');
    await userEvent.click(within(failed).getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(window.location.hash).toBe('#/analyses/100'));
    expect(await screen.findByRole('region', { name: '진행' })).toBeInTheDocument();
    expect(mock.db.analyses.find((a) => a.id === 100)).toMatchObject({
      code: 'AAPL',
      as_of: analysisDone.as_of,
      preset: 'cloud',
    });
  });

  it('[AI 사용 방식 바꿔 새로 분석]은 같은 종목·기준일로 새 분석 폼', async () => {
    renderAt('#/analyses/6');
    const failed = await waitFor(() => region('분석 실패'));
    await userEvent.click(
      within(failed).getByRole('button', { name: 'AI 사용 방식 바꿔 새로 분석' }),
    );
    await waitFor(() =>
      expect(window.location.hash).toBe('#/analyses?market=US&code=AAPL&as_of=2026-11-03'),
    );
  });

  it('하루 한도: 사이드카 문구, [AI 사용 방식 바꿔 새로 분석]이 먼저(v2 설계 20장)', async () => {
    const message = '오늘 무료 사용량을 다 썼습니다. 내일 다시 시도하거나 로컬 AI로 바꿔 주세요.';
    setAnalysis(6, { error: { code: 'LLM_DAILY_LIMIT', message, hint: null } });
    renderAt('#/analyses/6');
    const failed = await waitFor(() => region('분석 실패'));
    expect(within(failed).getByText(message)).toBeInTheDocument();
    const change = within(failed).getByRole('button', { name: 'AI 사용 방식 바꿔 새로 분석' });
    expect(change).toHaveAttribute('data-variant', 'primary');
    const retry = within(failed).getByRole('button', { name: '다시 시도' });
    expect(retry).toHaveAttribute('data-variant', 'secondary');
  });

  it('혼잡·분당 한도로 끝내 실패: 문구와 [다시 시도]', async () => {
    const message =
      '분석을 끝내지 못했습니다. 마친 단계는 저장됐으니 잠시 뒤 [다시 시도]를 눌러 주세요.';
    setAnalysis(6, {
      error: { code: 'LLM_BUSY', message, hint: '구글 AI 서버가 계속 혼잡했습니다.' },
    });
    renderAt('#/analyses/6');
    const failed = await waitFor(() => region('분석 실패'));
    expect(within(failed).getByText(message)).toBeInTheDocument();
    expect(within(failed).getByText('구글 AI 서버가 계속 혼잡했습니다.')).toBeInTheDocument();
    const retry = within(failed).getByRole('button', { name: '다시 시도' });
    expect(retry).toHaveAttribute('data-variant', 'primary');
  });

  it('키 오류: 다시 시도 대신 [설정 열기]', async () => {
    setAnalysis(6, {
      error: { code: 'LLM_KEY_INVALID', message: 'Google Gemini 키가 거부되었습니다.', hint: null },
    });
    renderAt('#/analyses/6');
    const failed = await waitFor(() => region('분석 실패'));
    expect(within(failed).queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument();
    await userEvent.click(within(failed).getByRole('button', { name: '설정 열기' }));
    await waitFor(() => expect(window.location.hash).toBe('#/settings'));
  });

  it('다시 시도가 거절되면 사이드카 문구', async () => {
    server.use(
      http.post('*/analyses/6/retry', () =>
        errorResponse(
          409,
          'ANALYSIS_NOT_RETRYABLE',
          '실패하거나 취소한 분석만 다시 시도할 수 있습니다.',
        ),
      ),
    );
    renderAt('#/analyses/6');
    const failed = await waitFor(() => region('분석 실패'));
    await userEvent.click(within(failed).getByRole('button', { name: '다시 시도' }));
    expect(
      await within(failed).findByText('실패하거나 취소한 분석만 다시 시도할 수 있습니다.'),
    ).toBeInTheDocument();
  });

  it('없는 분석이면 안내와 목록 링크', async () => {
    renderAt('#/analyses/999');
    expect(await screen.findByText('요청한 경로가 없습니다.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '분석 목록' })).toHaveAttribute('href', '#/analyses');
  });
});

describe('이력', () => {
  it('종목·기준일·상태/의견, 결정이 바뀐 분석 표시, 행을 누르면 결과', async () => {
    renderAt('#/analyses');
    const history = await waitFor(() => region('분석 이력'));
    const table = await within(history).findByRole('table', { name: '분석 이력' });
    const done = within(table).getByRole('row', { name: /삼성전자/ });
    expect(within(done).getByRole('img', { name: /AI 의견 비중확대/ })).toBeInTheDocument();
    expect(within(done).getByText('직전과 다름')).toBeInTheDocument();
    const failed = within(table).getByRole('row', { name: /애플/ });
    expect(within(failed).getByText('실패')).toBeInTheDocument();
    expect(within(failed).queryByText('직전과 다름')).not.toBeInTheDocument();
    await userEvent.click(within(done).getByText('삼성전자'));
    await waitFor(() => expect(window.location.hash).toBe('#/analyses/7'));
  });

  it('종목별로 거른다(GET /analyses?market=&code=)', async () => {
    const queries: string[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname === '/analyses' && request.method === 'GET') queries.push(url.search);
    });
    renderAt('#/analyses');
    const history = await waitFor(() => region('분석 이력'));
    await within(history).findByRole('table', { name: '분석 이력' });
    await choose(history, '종목', '애플');
    await waitFor(() => expect(queries).toContain('?market=US&code=AAPL&limit=50'));
    const table = within(history).getByRole('table', { name: '분석 이력' });
    await waitFor(() => expect(within(table).queryByText('삼성전자')).not.toBeInTheDocument());
  });

  it('분석 상태 SSE로 목록을 다시 불러온다', async () => {
    const { stream } = renderAt('#/analyses');
    const history = await waitFor(() => region('분석 이력'));
    const table = await within(history).findByRole('table', { name: '분석 이력' });
    const source = await stream();
    addRunning(45);
    act(() => source.emit('analysis.status', { id: 45, status: 'running' }));
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(4));
  });

  it('비었으면 할 일을 알려 준다', async () => {
    mock.db.analyses = [];
    renderAt('#/analyses');
    expect(
      await within(await waitFor(() => region('분석 이력'))).findByText(
        '아직 분석한 종목이 없습니다. 위에서 종목을 골라 분석을 시작하세요.',
      ),
    ).toBeInTheDocument();
  });

  it('오류면 원인과 해결 방법', async () => {
    server.use(
      http.get('*/analyses', () =>
        errorResponse(
          503,
          'DB_UNAVAILABLE',
          '저장소가 준비되지 않았습니다.',
          '앱을 다시 시작해 주세요.',
        ),
      ),
    );
    renderAt('#/analyses');
    expect(
      await within(await waitFor(() => region('분석 이력'))).findByText(/앱을 다시 시작해 주세요/),
    ).toBeInTheDocument();
  });
});
