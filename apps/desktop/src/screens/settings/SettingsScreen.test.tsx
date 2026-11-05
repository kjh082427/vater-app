import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { SettingsScreen } from './SettingsScreen';
import { errorResponse } from '../../mocks/handlers';
import { emit, renderWithServices } from '../../test/render';
import { mock, server } from '../../test/server';
import { choose, selectButton } from '../../test/select';

const FAKE_KEY = 'PSfakeAppKey0000000000000000000000';
const FAKE_SECRET = 'fake-secret-value-for-tests-only';

function renderSettings() {
  window.location.hash = '#/settings';
  return renderWithServices(<App />);
}

const region = (name: string) => screen.getByRole('region', { name });

/** 이 요청들의 본문을 모은다. */
function capture(method: string, pathPrefix: string) {
  const seen: { path: string; body: unknown }[] = [];
  server.events.on('request:start', async ({ request }) => {
    const url = new URL(request.url);
    if (request.method === method && url.pathname.startsWith(pathPrefix)) {
      const text = await request.clone().text();
      seen.push({ path: url.pathname + url.search, body: text ? JSON.parse(text) : null });
    }
  });
  return seen;
}

describe('증권사 연결', () => {
  it('설정에 증권사 연결 칸이 있고 조회 전용임을 알린다', async () => {
    renderSettings();
    const part = await waitFor(() => region('증권사 연결'));
    expect(within(part).getByText(/주문은 하지 않습니다/)).toBeInTheDocument();
    expect(await within(part).findByText(/연결한 증권사가 없습니다/)).toBeInTheDocument();
  });
});

describe('한국투자증권', () => {
  it('키는 쓰기 전용: 저장하면 칸을 비우고 "저장됨", 값은 화면 어디에도 다시 보이지 않는다', async () => {
    mock.db.secrets.KIS_APP_KEY = false;
    mock.db.secrets.KIS_APP_SECRET = false;
    const puts = capture('PUT', '/secrets/');
    // 앱키가 없으면 앱은 마법사로 보내므로 설정 화면만 그린다
    const view = renderWithServices(<SettingsScreen />);
    const part = await waitFor(() => region('한국투자증권'));
    expect(await within(part).findByText('앱키 없음')).toBeInTheDocument();
    const key = within(part).getByLabelText('앱키');
    expect(key).toHaveAttribute('type', 'password');
    expect(key).toHaveAttribute('autocomplete', 'off');
    await userEvent.type(key, FAKE_KEY);
    await userEvent.type(within(part).getByLabelText('앱시크릿'), FAKE_SECRET);
    await userEvent.click(within(part).getByRole('button', { name: '키 저장' }));
    expect(await within(part).findByText('저장됨')).toBeInTheDocument();
    expect(puts).toEqual([
      { path: '/secrets/KIS_APP_KEY', body: { value: FAKE_KEY } },
      { path: '/secrets/KIS_APP_SECRET', body: { value: FAKE_SECRET } },
    ]);
    expect(within(part).getByLabelText('앱키')).toHaveValue('');
    expect(within(part).getByLabelText('앱시크릿')).toHaveValue('');
    expect(await within(part).findByText('앱키 저장됨')).toBeInTheDocument();
    expect(view.container.innerHTML).not.toContain(FAKE_KEY);
    expect(view.container.innerHTML).not.toContain(FAKE_SECRET);
  });

  it('빈 칸은 보내지 않는다(저장된 키를 지우지 않음)', async () => {
    const puts = capture('PUT', '/secrets/');
    renderSettings();
    const part = await waitFor(() => region('한국투자증권'));
    await userEvent.type(within(part).getByLabelText('HTS ID'), '  ');
    await userEvent.click(within(part).getByRole('button', { name: '키 저장' }));
    expect(await within(part).findByText('바꿀 값을 입력하세요.')).toBeInTheDocument();
    expect(puts).toEqual([]);
  });

  it('저장 실패는 원인', async () => {
    server.use(
      http.put('*/secrets/:name', () =>
        errorResponse(503, 'SECRETS_UNAVAILABLE', '비밀키 저장소가 준비되지 않았습니다.'),
      ),
    );
    renderSettings();
    const part = await waitFor(() => region('한국투자증권'));
    await userEvent.type(within(part).getByLabelText('앱키'), FAKE_KEY);
    await userEvent.click(within(part).getByRole('button', { name: '키 저장' }));
    expect(
      await within(part).findByText('비밀키 저장소가 준비되지 않았습니다.'),
    ).toBeInTheDocument();
    expect(within(part).queryByText('저장됨')).not.toBeInTheDocument();
  });

  it('두 번째 키 저장이 실패하면 저장된 첫 값은 칸에서 지우고, 실패한 칸만 남긴다', async () => {
    server.use(
      http.put('*/secrets/KIS_APP_SECRET', () =>
        errorResponse(503, 'SECRETS_UNAVAILABLE', '비밀키 저장소가 준비되지 않았습니다.'),
      ),
    );
    renderSettings();
    const part = await waitFor(() => region('한국투자증권'));
    await userEvent.type(within(part).getByLabelText('앱키'), FAKE_KEY);
    await userEvent.type(within(part).getByLabelText('앱시크릿'), FAKE_SECRET);
    await userEvent.click(within(part).getByRole('button', { name: '키 저장' }));
    expect(
      await within(part).findByText('비밀키 저장소가 준비되지 않았습니다.'),
    ).toBeInTheDocument();
    expect(within(part).getByLabelText('앱키')).toHaveValue('');
    expect(within(part).getByLabelText('앱시크릿')).toHaveValue(FAKE_SECRET);
  });

  it('실전/모의 서버', async () => {
    const patches = capture('PATCH', '/settings');
    renderSettings();
    const part = await waitFor(() => region('한국투자증권'));
    expect(await within(part).findByRole('radio', { name: '실전' })).toBeChecked();
    await userEvent.click(within(part).getByRole('radio', { name: '모의' }));
    await waitFor(() =>
      expect(patches).toEqual([{ path: '/settings', body: { 'kis.server': 'vps' } }]),
    );
    expect(within(part).getByRole('radio', { name: '모의' })).toBeChecked();
  });

  it('연결 테스트 성공: 서버와 삼성전자 현재가', async () => {
    renderSettings();
    const part = await waitFor(() => region('한국투자증권'));
    await userEvent.click(within(part).getByRole('button', { name: '연결 테스트' }));
    expect(
      await within(part).findByText('연결됨: 실전 서버 · 삼성전자 현재가 71,400원'),
    ).toBeInTheDocument();
  });

  it('서버를 바꾸면 이전 연결 테스트 결과를 지운다(저장된 키·서버와 맞지 않으므로)', async () => {
    renderSettings();
    const part = await waitFor(() => region('한국투자증권'));
    await userEvent.click(within(part).getByRole('button', { name: '연결 테스트' }));
    await within(part).findByText(/연결됨: 실전 서버/);
    await userEvent.click(within(part).getByRole('radio', { name: '모의' }));
    await waitFor(() => expect(within(part).queryByText(/연결됨:/)).not.toBeInTheDocument());
  });

  it('연결 테스트 실패: message와 hint', async () => {
    server.use(
      http.post('*/settings/kis/test', () =>
        errorResponse(
          401,
          'KIS_AUTH_INVALID',
          '한국투자증권 인증에 실패했습니다.',
          '앱키와 앱시크릿, 실전/모의 서버 선택을 확인해 주세요.',
        ),
      ),
    );
    renderSettings();
    const part = await waitFor(() => region('한국투자증권'));
    await userEvent.click(within(part).getByRole('button', { name: '연결 테스트' }));
    expect(await within(part).findByText('한국투자증권 인증에 실패했습니다.')).toBeInTheDocument();
    expect(within(part).getByText(/실전\/모의 서버 선택을 확인해 주세요/)).toBeInTheDocument();
  });
});

describe('AI 엔진', () => {
  it('AI 사용 방식', async () => {
    const patches = capture('PATCH', '/settings');
    renderSettings();
    const part = await waitFor(() => region('AI 엔진'));
    await waitFor(() =>
      expect(selectButton(part, 'AI 사용 방식')).toHaveAccessibleName('AI 사용 방식 클라우드'),
    );
    await choose(part, 'AI 사용 방식', '혼합');
    await waitFor(() =>
      expect(patches).toContainEqual({ path: '/settings', body: { 'llm.preset': 'mixed' } }),
    );
  });

  it('클라우드: 제공자 키 저장(쓰기 전용)과 연결 테스트', async () => {
    const puts = capture('PUT', '/secrets/');
    const posts = capture('POST', '/settings/llm/test');
    const view = renderSettings();
    const part = await waitFor(() => region('클라우드 AI'));
    expect(await within(part).findByText('Google Gemini 키 저장됨')).toBeInTheDocument();
    await userEvent.type(within(part).getByLabelText('Google Gemini 키'), 'fake-llm-key');
    await userEvent.click(within(part).getByRole('button', { name: '키 저장' }));
    expect(await within(part).findByText('저장됨')).toBeInTheDocument();
    expect(puts).toEqual([{ path: '/secrets/LLM_GOOGLE_KEY', body: { value: 'fake-llm-key' } }]);
    expect(view.container.innerHTML).not.toContain('fake-llm-key');
    await userEvent.click(within(part).getByRole('button', { name: '연결 테스트' }));
    expect(
      await within(part).findByText('연결됨: 모델 12개를 쓸 수 있습니다.'),
    ).toBeInTheDocument();
    expect(posts[0]?.path).toBe('/settings/llm/test?provider=google');
  });

  it('클라우드 연결 테스트 실패와 기본 모델이 없을 때', async () => {
    server.use(
      http.post('*/settings/llm/test', () =>
        HttpResponse.json({
          ok: true,
          provider: 'google',
          model_count: 3,
          defaults_available: false,
        }),
      ),
    );
    renderSettings();
    const part = await waitFor(() => region('클라우드 AI'));
    await userEvent.click(await within(part).findByRole('button', { name: '연결 테스트' }));
    expect(await within(part).findByText(/기본 모델을 이 키로 쓸 수 없습니다/)).toBeInTheDocument();
    server.use(
      http.post('*/settings/llm/test', () =>
        errorResponse(
          401,
          'LLM_KEY_INVALID',
          '클라우드 AI 키가 올바르지 않습니다.',
          '키를 다시 확인하세요.',
        ),
      ),
    );
    await userEvent.click(within(part).getByRole('button', { name: '연결 테스트' }));
    expect(
      await within(part).findByText('클라우드 AI 키가 올바르지 않습니다.'),
    ).toBeInTheDocument();
  });

  it('제공자를 바꾸면 그 제공자의 키 칸과 모델 기본값', async () => {
    const patches = capture('PATCH', '/settings');
    renderSettings();
    const part = await waitFor(() => region('클라우드 AI'));
    await choose(part, '제공자', /OpenAI 호환 서버/);
    await waitFor(() =>
      expect(patches).toContainEqual({
        path: '/settings',
        body: { 'llm.cloud_provider': 'compat' },
      }),
    );
    expect(await within(part).findByLabelText('OpenAI 호환 서버 (기타) 키')).toBeInTheDocument();
    expect(within(part).getByLabelText('서버 주소')).toBeInTheDocument();
  });

  it('로컬: 하드웨어 등급, 추천 모델, Ollama 상태', async () => {
    renderSettings();
    const part = await waitFor(() => region('로컬 AI'));
    expect(await within(part).findByText('NVIDIA GPU (VRAM 12~16GB)')).toBeInTheDocument();
    expect(within(part).getByText(/NVIDIA GeForce RTX 4070 · VRAM 12.0GB/)).toBeInTheDocument();
    expect(within(part).getByText('Ollama 0.40.13 · 실행 중')).toBeInTheDocument();
    const list = within(part).getByRole('list', { name: '로컬 모델' });
    const small = within(list).getByText('Qwen 3.5 4B').closest('li') as HTMLElement;
    expect(within(small).getByText('설치됨')).toBeInTheDocument();
    const big = within(list).getByText('Qwen 3.5 9B').closest('li') as HTMLElement;
    expect(within(big).getByText('추천')).toBeInTheDocument();
    expect(within(big).getByRole('button', { name: 'Qwen 3.5 9B 받기' })).toBeInTheDocument();
  });

  it('모델 받기: SSE llm.pull 진행률 → 끝나면 설치됨', async () => {
    const { stream } = renderSettings();
    const part = await waitFor(() => region('로컬 AI'));
    await userEvent.click(await within(part).findByRole('button', { name: 'Qwen 3.5 9B 받기' }));
    const source = await stream();
    emit(source, 'llm.pull', {
      tag: 'qwen3.5:9b',
      status: 'pulling',
      completed: 2_947_500_000,
      total: 6_550_000_000,
      percent: 45,
    });
    const bar = await within(part).findByRole('progressbar', { name: 'Qwen 3.5 9B 받는 중' });
    expect(bar).toHaveAttribute('aria-valuenow', '45');
    expect(within(part).getByText('45% · 2.9 / 6.6GB')).toBeInTheDocument();
    mock.db.ollama.models.push({ name: 'qwen3.5:9b-16k', size: 6_550_000_000 });
    emit(source, 'llm.pull', { tag: 'qwen3.5:9b', status: 'done', variant: 'qwen3.5:9b-16k' });
    const big = within(within(part).getByRole('list', { name: '로컬 모델' }))
      .getByText('Qwen 3.5 9B')
      .closest('li') as HTMLElement;
    expect(await within(big).findByText('설치됨')).toBeInTheDocument();
    expect(within(part).queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('진행률은 정수 %로 보인다(사이드카가 소수를 보내도)', async () => {
    const { stream } = renderSettings();
    const part = await waitFor(() => region('로컬 AI'));
    await userEvent.click(await within(part).findByRole('button', { name: 'Qwen 3.5 9B 받기' }));
    const source = await stream();
    emit(source, 'llm.pull', {
      tag: 'qwen3.5:9b',
      status: 'pulling',
      completed: 1_000_000_000,
      total: 2_000_000_000,
      percent: 45.6,
    });
    expect(await within(part).findByText('46% · 1.0 / 2.0GB')).toBeInTheDocument();
  });

  it('모델 받기 실패(SSE error)는 원인', async () => {
    const { stream } = renderSettings();
    const part = await waitFor(() => region('로컬 AI'));
    await userEvent.click(await within(part).findByRole('button', { name: 'Qwen 3.5 9B 받기' }));
    const source = await stream();
    emit(source, 'llm.pull', {
      tag: 'qwen3.5:9b',
      status: 'error',
      code: 'OLLAMA_PULL_FAILED',
      message: '모델을 받지 못했습니다.',
      hint: '인터넷 연결과 디스크 공간을 확인하세요.',
    });
    expect(await within(part).findByText('모델을 받지 못했습니다.')).toBeInTheDocument();
    expect(within(part).getByText('인터넷 연결과 디스크 공간을 확인하세요.')).toBeInTheDocument();
  });

  it('Ollama가 꺼져 있으면 받기 대신 시작, 설치가 안 되어 있으면 설치(진행 단계 SSE)', async () => {
    mock.db.ollama = { installed: false, running: false, version: null, models: [], loaded: [] };
    const { stream } = renderSettings();
    const part = await waitFor(() => region('로컬 AI'));
    expect(await within(part).findByText('Ollama가 설치되어 있지 않습니다.')).toBeInTheDocument();
    await userEvent.click(within(part).getByRole('button', { name: 'Ollama 설치' }));
    const source = await stream();
    emit(source, 'llm.install', { stage: 'download' });
    expect(await within(part).findByText('설치 파일을 내려받는 중입니다.')).toBeInTheDocument();
    emit(source, 'llm.install', { stage: 'verify' });
    expect(
      await within(part).findByText('설치 파일의 서명을 확인하는 중입니다.'),
    ).toBeInTheDocument();
    mock.db.ollama = { installed: true, running: true, version: '0.40.13', models: [], loaded: [] };
    emit(source, 'llm.install', { stage: 'done' });
    expect(await within(part).findByText('Ollama 0.40.13 · 실행 중')).toBeInTheDocument();
  });

  it('설치됐지만 꺼져 있으면 [Ollama 시작]', async () => {
    mock.db.ollama = { ...mock.db.ollama, running: false, version: null };
    renderSettings();
    const part = await waitFor(() => region('로컬 AI'));
    await userEvent.click(await within(part).findByRole('button', { name: 'Ollama 시작' }));
    expect(await within(part).findByText(/실행 중/)).toBeInTheDocument();
  });

  it('모델 삭제는 확인한 뒤', async () => {
    const deletes = capture('DELETE', '/llm/models/');
    renderSettings();
    const part = await waitFor(() => region('로컬 AI'));
    const list = await within(part).findByRole('list', { name: '로컬 모델' });
    const small = within(list).getByText('Qwen 3.5 4B').closest('li') as HTMLElement;
    await userEvent.click(within(small).getByRole('button', { name: '삭제' }));
    await userEvent.click(within(small).getByRole('button', { name: '모델 삭제' }));
    await waitFor(() =>
      expect(deletes).toEqual([{ path: '/llm/models/qwen3.5%3A4b', body: null }]),
    );
    expect(
      await within(small).findByRole('button', { name: 'Qwen 3.5 4B 받기' }),
    ).toBeInTheDocument();
  });

  it('로컬 모델 고르기(설치된 것만)', async () => {
    const patches = capture('PATCH', '/settings');
    renderSettings();
    const part = await waitFor(() => region('로컬 AI'));
    await choose(part, '분석에 쓸 로컬 모델', 'Qwen 3.5 4B');
    await waitFor(() =>
      expect(patches).toContainEqual({
        path: '/settings',
        body: { 'llm.local_model': 'qwen3.5:4b' },
      }),
    );
  });
});

describe('분석·브리핑·일반', () => {
  it('토론 라운드', async () => {
    const patches = capture('PATCH', '/settings');
    renderSettings();
    const part = await waitFor(() => region('분석 기본값'));
    await choose(part, '토론 라운드', '2회');
    await waitFor(() =>
      expect(patches).toContainEqual({ path: '/settings', body: { 'analysis.debate_rounds': 2 } }),
    );
  });

  it('브리핑 시각 검증 오류(422)는 message를 그대로', async () => {
    renderSettings();
    const part = await waitFor(() => region('브리핑'));
    const time = await within(part).findByLabelText('국내 브리핑 시각');
    await userEvent.clear(time);
    await userEvent.type(time, '25:00');
    await userEvent.click(within(part).getByRole('button', { name: '브리핑 설정 저장' }));
    expect(
      await within(part).findByText(
        "설정 'briefing.kr.time' 값이 올바르지 않습니다: HH:MM 형식(00:00~23:59)이어야 합니다",
      ),
    ).toBeInTheDocument();
  });

  it('브리핑 켜기·끄기와 시각 저장', async () => {
    const patches = capture('PATCH', '/settings');
    renderSettings();
    const part = await waitFor(() => region('브리핑'));
    await userEvent.click(await within(part).findByRole('switch', { name: '미국 브리핑 만들기' }));
    const time = within(part).getByLabelText('국내 브리핑 시각');
    await userEvent.clear(time);
    await userEvent.type(time, '16:30');
    await userEvent.click(within(part).getByRole('button', { name: '브리핑 설정 저장' }));
    await waitFor(() =>
      expect(patches).toContainEqual({
        path: '/settings',
        body: {
          'briefing.kr.enabled': true,
          'briefing.kr.time': '16:30',
          'briefing.us.enabled': false,
          'briefing.us.time': '07:00',
        },
      }),
    );
    expect(await within(part).findByText('저장됨')).toBeInTheDocument();
  });

  it('부팅 시 자동 실행은 플랫폼 어댑터, 버전은 /health', async () => {
    const view = renderSettings();
    const part = await waitFor(() => region('일반'));
    const auto = await within(part).findByRole('switch', { name: '부팅 시 자동 실행' });
    await waitFor(() => expect(auto).toBeChecked());
    await userEvent.click(auto);
    await waitFor(() => expect(auto).not.toBeChecked());
    expect(await view.shell.platform.getAutostart()).toBe(false);
    expect(within(part).getByText('0.1.0')).toBeInTheDocument();
  });

  it('버전은 셸이 알면 셸의 값(설치한 앱의 버전)', async () => {
    window.location.hash = '#/settings';
    renderWithServices(<App />, { appVersion: '0.9.1' });
    const part = await waitFor(() => region('일반'));
    expect(await within(part).findByText('0.9.1')).toBeInTheDocument();
  });

  it('업데이트 확인: 최신', async () => {
    renderSettings();
    const part = await waitFor(() => region('일반'));
    await userEvent.click(within(part).getByRole('button', { name: '업데이트 확인' }));
    expect(await within(part).findByText('최신 버전입니다.')).toBeInTheDocument();
    expect(within(part).queryByRole('button', { name: '지금 설치' })).not.toBeInTheDocument();
  });

  it('업데이트 확인: 공개 키가 없는 빌드', async () => {
    const view = renderSettings();
    view.shell.setUpdate({ state: 'disabled' });
    const part = await waitFor(() => region('일반'));
    await userEvent.click(within(part).getByRole('button', { name: '업데이트 확인' }));
    expect(
      await within(part).findByText('이 빌드에서는 업데이트를 쓸 수 없습니다.'),
    ).toBeInTheDocument();
  });

  it('업데이트 확인: 실패하면 그 문구, 다시 누를 수 있다', async () => {
    const view = renderSettings();
    view.shell.setUpdate(new Error('연결할 수 없습니다'));
    const part = await waitFor(() => region('일반'));
    const button = within(part).getByRole('button', { name: '업데이트 확인' });
    await userEvent.click(button);
    expect(await within(part).findByText(/연결할 수 없습니다/)).toBeInTheDocument();
    expect(button).toBeEnabled();
  });

  it('설정을 열면 조용히 확인해서, 새 버전이면 누르지 않아도 [지금 설치]가 보인다', async () => {
    window.location.hash = '#/settings';
    renderWithServices(<App />, { update: { state: 'available', version: '0.3.0' } });
    const part = await waitFor(() => region('일반'));
    expect(await within(part).findByRole('button', { name: '지금 설치' })).toBeInTheDocument();
  });

  it('설정을 열 때의 조용한 확인은 실패해도, 최신이어도 아무것도 보이지 않는다', async () => {
    window.location.hash = '#/settings';
    renderWithServices(<App />, { update: new Error('연결할 수 없습니다') });
    const part = await waitFor(() => region('일반'));
    await within(part).findByRole('button', { name: '업데이트 확인' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(within(part).queryByText(/연결할 수 없습니다/)).not.toBeInTheDocument();
    expect(within(part).queryByText('최신 버전입니다.')).not.toBeInTheDocument();
  });

  it('새 버전: [지금 설치]가 설치를 부르고 안내한다. 실패하면 그 문구', async () => {
    const view = renderSettings();
    view.shell.setUpdate({ state: 'available', version: '0.3.0', notes: '알림 수정' });
    const part = await waitFor(() => region('일반'));
    await userEvent.click(within(part).getByRole('button', { name: '업데이트 확인' }));
    expect(await within(part).findByText('새 버전 0.3.0이(가) 있습니다.')).toBeInTheDocument();
    expect(within(part).getByText('알림 수정')).toBeInTheDocument();
    expect(within(part).getByText('설치하면 앱이 다시 시작됩니다.')).toBeInTheDocument();
    view.shell.failInstall(new Error('내려받지 못했습니다'));
    await userEvent.click(within(part).getByRole('button', { name: '지금 설치' }));
    await waitFor(() => expect(view.shell.updateInstalls).toBe(1));
    expect(await within(part).findByText(/내려받지 못했습니다/)).toBeInTheDocument();
    expect(within(part).getByRole('button', { name: '지금 설치' })).toBeEnabled();
  });

  it('창을 닫으면 트레이로', async () => {
    const patches = capture('PATCH', '/settings');
    renderSettings();
    const part = await waitFor(() => region('일반'));
    const tray = await within(part).findByRole('switch', { name: '창을 닫으면 트레이로 숨기기' });
    await waitFor(() => expect(tray).toBeChecked());
    await act(async () => {
      await userEvent.click(tray);
    });
    await waitFor(() =>
      expect(patches).toContainEqual({
        path: '/settings',
        body: { 'general.close_to_tray': false },
      }),
    );
  });
});
