import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';
import { errorResponse } from '../../mocks/handlers';
import { renderWithServices } from '../../test/render';
import { mock, server } from '../../test/server';
import { WelcomeScreen } from './WelcomeScreen';

function renderWizard() {
  window.location.hash = '#/welcome';
  mock.db.secrets.KIS_APP_KEY = false;
  mock.db.secrets.KIS_APP_SECRET = false;
  return renderWithServices(<WelcomeScreen />);
}

const step = () => screen.getByRole('heading', { level: 2 });
const next = () => screen.getByRole('button', { name: '다음' });

async function toKisStep() {
  await userEvent.click(next());
  await waitFor(() => expect(step()).toHaveTextContent('한국투자증권 연결'));
}

const SAVE_AND_TEST = '저장하고 연결 테스트';

async function passKisTest() {
  await userEvent.type(screen.getByLabelText('앱키'), 'fake-app-key');
  await userEvent.type(screen.getByLabelText('앱시크릿'), 'fake-app-secret');
  await userEvent.click(screen.getByRole('button', { name: SAVE_AND_TEST }));
  await screen.findByText(/연결됨: 실전 서버/);
}

describe('첫 실행 마법사', () => {
  it('단계 5개와 지금 단계, ① 환영·면책', async () => {
    renderWizard();
    expect(screen.getByRole('heading', { level: 1, name: 'Vater 시작하기' })).toBeInTheDocument();
    const steps = screen.getByRole('list', { name: '단계' });
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['1환영', '2한투 연결', '3AI 엔진', '4감시 종목', '5완료']);
    expect(within(steps).getByText('환영').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(step()).toHaveTextContent('Vater를 소개합니다');
    expect(screen.getByText(/투자 판단 보조용이며 투자 권유가 아닙니다/)).toBeInTheDocument();
    expect(screen.getByText(/주문 기능이 없습니다/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '뒤로' })).not.toBeInTheDocument();
  });

  it('② 한투: 입력한 키를 저장하고 바로 그 키로 시험한다(한 동작), 통과해야 다음(건너뛰기 없음)', async () => {
    let fail = true;
    const order: string[] = [];
    server.events.on('request:start', ({ request }) => {
      const path = new URL(request.url).pathname;
      if (request.method !== 'GET') order.push(`${request.method} ${path}`);
    });
    server.use(
      http.post('*/settings/kis/test', () =>
        fail
          ? errorResponse(
              401,
              'KIS_AUTH_INVALID',
              '한국투자증권 인증에 실패했습니다.',
              '앱키와 앱시크릿, 실전/모의 서버 선택을 확인해 주세요.',
            )
          : undefined,
      ),
    );
    renderWizard();
    await toKisStep();
    expect(next()).toBeDisabled();
    expect(screen.queryByRole('button', { name: /건너뛰기|나중에/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '연결 테스트' })).not.toBeInTheDocument();
    expect(screen.getByText('연결 테스트에 성공하면 다음으로 갈 수 있습니다.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('앱키'), 'fake-app-key');
    await userEvent.type(screen.getByLabelText('앱시크릿'), 'fake-app-secret');
    await userEvent.click(screen.getByRole('button', { name: SAVE_AND_TEST }));
    expect(await screen.findByText('한국투자증권 인증에 실패했습니다.')).toBeInTheDocument();
    expect(order).toEqual([
      'PUT /secrets/KIS_APP_KEY',
      'PUT /secrets/KIS_APP_SECRET',
      'POST /settings/kis/test',
    ]);
    expect(next()).toBeDisabled();

    // 서버를 바꾸면 이전 결과를 지운다. 키는 이미 저장되어 있으니 칸이 비어도 시험만 한다
    fail = false;
    await userEvent.click(screen.getByRole('radio', { name: '모의' }));
    await waitFor(() =>
      expect(screen.queryByText('한국투자증권 인증에 실패했습니다.')).not.toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole('button', { name: SAVE_AND_TEST }));
    expect(
      await screen.findByText('연결됨: 모의 서버 · 삼성전자 현재가 71,400원'),
    ).toBeInTheDocument();
    expect(next()).toBeEnabled();
    await userEvent.click(next());
    await waitFor(() => expect(step()).toHaveTextContent('AI 엔진'));
  });

  it('통과한 뒤 키를 바꾸거나 서버를 바꾸면 "연결됨"을 지우고 다시 시험해야 한다', async () => {
    renderWizard();
    await toKisStep();
    await passKisTest();
    expect(next()).toBeEnabled();
    await userEvent.click(screen.getByRole('radio', { name: '모의' }));
    await waitFor(() => expect(screen.queryByText(/연결됨:/)).not.toBeInTheDocument());
    expect(next()).toBeDisabled();
  });

  it('키가 없는데 비운 채로 누르면 이유를 알려 준다', async () => {
    renderWizard();
    await toKisStep();
    await userEvent.click(screen.getByRole('button', { name: SAVE_AND_TEST }));
    expect(await screen.findByText('앱키와 앱시크릿을 입력하세요.')).toBeInTheDocument();
    expect(next()).toBeDisabled();
  });

  it('키를 받는 방법을 펼쳐 볼 수 있다', async () => {
    renderWizard();
    await toKisStep();
    await userEvent.click(screen.getByText('앱키는 어디서 받나요?'));
    expect(screen.getByText(/KIS Developers/)).toBeVisible();
  });

  it('뒤로', async () => {
    renderWizard();
    await toKisStep();
    await userEvent.click(screen.getByRole('button', { name: '뒤로' }));
    expect(step()).toHaveTextContent('Vater를 소개합니다');
  });

  it('③ AI 엔진: "나중에"도 다음으로, 클라우드를 고르면 프리셋과 키 칸', async () => {
    const patches: unknown[] = [];
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'PATCH') patches.push(await request.clone().json());
    });
    renderWizard();
    await toKisStep();
    await passKisTest();
    await userEvent.click(next());
    await waitFor(() => expect(step()).toHaveTextContent('AI 엔진'));
    expect(
      await screen.findByText(/이 PC\(NVIDIA GPU \(VRAM 12~16GB\)\)에는 혼합을 권합니다/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: '클라우드 AI 키 넣기' }));
    await waitFor(() => expect(patches).toContainEqual({ 'llm.preset': 'cloud' }));
    expect(await screen.findByLabelText('Google Gemini 키')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: '이 PC에 로컬 AI 설치' }));
    expect(await screen.findByRole('list', { name: '로컬 모델' })).toBeInTheDocument();
    await waitFor(() => expect(patches).toContainEqual({ 'llm.preset': 'mixed' }));
    await userEvent.click(screen.getByRole('radio', { name: '나중에' }));
    expect(screen.getByText(/설정 > AI 엔진에서 언제든 정할 수 있습니다/)).toBeInTheDocument();
    await userEvent.click(next());
    await waitFor(() => expect(step()).toHaveTextContent('감시 종목'));
  });

  it('④ 감시 종목(선택): 검색해서 추가, 안 해도 다음', async () => {
    mock.db.watchItems = [];
    renderWizard();
    await toKisStep();
    await passKisTest();
    await userEvent.click(next());
    await userEvent.click(next());
    await waitFor(() => expect(step()).toHaveTextContent('감시 종목'));
    await userEvent.type(screen.getByRole('searchbox', { name: '종목 검색' }), 'NAVER');
    await userEvent.click(await screen.findByRole('button', { name: 'NAVER 추가' }));
    const added = await screen.findByRole('list', { name: '추가한 종목' });
    expect(within(added).getByText('NAVER')).toBeInTheDocument();
    expect(next()).toBeEnabled();
  });

  it('⑤ 완료: 부팅 시 자동 실행 기본 켬, 끄고 시작하면 플랫폼에 끔, 홈으로', async () => {
    const view = renderWizard();
    await toKisStep();
    await passKisTest();
    for (let i = 0; i < 2; i += 1) await userEvent.click(next());
    await userEvent.click(next());
    await waitFor(() => expect(step()).toHaveTextContent('준비가 끝났습니다'));
    const auto = screen.getByRole('switch', { name: '부팅 시 자동 실행' });
    expect(auto).toBeChecked();
    await userEvent.click(auto);
    await userEvent.click(screen.getByRole('button', { name: '시작하기' }));
    await waitFor(() => expect(window.location.hash).toBe('#/home'));
    expect(await view.shell.platform.getAutostart()).toBe(false);
  });

  it('완료 기본값이면 자동 실행을 켠다', async () => {
    const view = renderWizard();
    await view.shell.platform.setAutostart(false);
    await toKisStep();
    await passKisTest();
    for (let i = 0; i < 3; i += 1) await userEvent.click(next());
    await userEvent.click(await screen.findByRole('button', { name: '시작하기' }));
    await waitFor(() => expect(window.location.hash).toBe('#/home'));
    expect(await view.shell.platform.getAutostart()).toBe(true);
  });
});

describe('다른 증권사 안내', () => {
  it('한투만 필수이고 키움·메리츠는 나중에 설정에서 연결한다고 알린다', async () => {
    renderWizard();
    await toKisStep();
    expect(
      await screen.findByText(/키움·메리츠 연결과 보유 종목 입력은 시작한 뒤/),
    ).toBeInTheDocument();
  });
});
