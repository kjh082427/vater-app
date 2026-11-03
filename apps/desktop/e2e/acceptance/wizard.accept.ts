/**
 * U1·U2: 첫 실행 마법사(스펙 9-2, 성공 기준 1). 가짜 한투가 키를 받아 주거나 거절한다.
 */
import { expect, main, openApp, test } from './harness';

// 화면에 입력하는 가짜 키. 실제 키가 아니다.
const KEY = 'PSwizardFAKEappKEY00000000000000000000';
const SECRET = 'wizard-fake-app-secret-not-a-real-key';

test('U1 첫 실행: 마법사 5단계를 마치면 홈으로 가고, 감시 종목이 홈에 있고, 키는 어디에도 보이지 않는다', async ({
  page,
  stack,
  shell,
  log,
}) => {
  const started = Date.now();
  await openApp(page);
  await expect(page).toHaveURL(/#\/welcome$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Vater 시작하기' })).toBeVisible();

  // ① 환영·면책
  await expect(page.getByText('Vater는 주문 기능이 없습니다.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '다음' }).click();

  // ② 한투 연결: 저장하고 연결 테스트 → 가짜 한투가 토큰을 주고 삼성전자 현재가를 돌려준다
  await expect(page.getByRole('heading', { level: 2, name: '한국투자증권 연결' })).toBeVisible();
  await expect(page.getByRole('button', { name: '다음' })).toBeDisabled();
  await page.getByLabel('앱키').fill(KEY);
  await page.getByLabel('앱시크릿').fill(SECRET);
  await page.getByRole('button', { name: '저장하고 연결 테스트' }).click();
  await expect(page.getByText('연결됨: 실전 서버 · 삼성전자 현재가 59,000원')).toBeVisible();
  await expect(page.getByLabel('앱키')).toHaveValue('');
  await page.getByRole('button', { name: '다음' }).click();

  // ③ AI 엔진: 나중에(기본)
  await expect(page.getByRole('heading', { level: 2, name: 'AI 엔진' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '나중에' })).toBeChecked();
  await page.getByRole('button', { name: '다음' }).click();

  // ④ 감시 종목 1개
  await expect(page.getByRole('heading', { level: 2, name: '감시 종목(선택)' })).toBeVisible();
  await page.getByRole('searchbox', { name: '종목 검색' }).fill('삼성');
  await page.getByRole('button', { name: '삼성전자 추가' }).click();
  await expect(page.getByRole('list', { name: '추가한 종목' }).getByText('삼성전자')).toBeVisible();
  await page.getByRole('button', { name: '다음' }).click();

  // ⑤ 완료: 부팅 시 자동 실행(기본 켬)
  await expect(page.getByRole('heading', { level: 2, name: '준비가 끝났습니다' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: '부팅 시 자동 실행' })).toBeChecked();
  await page.getByRole('button', { name: '시작하기' }).click();

  await expect(page).toHaveURL(/#\/home$/);
  await expect(main(page).getByRole('heading', { level: 1, name: '홈' })).toBeVisible();
  await expect(main(page).getByText('삼성전자').first()).toBeVisible();
  const seconds = (Date.now() - started) / 1000;
  console.log(`U1 wizard duration: ${seconds.toFixed(1)} s (기준 600 s)`);
  test.info().annotations.push({ type: 'U1 wizard', description: `${seconds.toFixed(1)} s` });
  expect(seconds).toBeLessThan(600);

  expect(shell.calls.filter((c) => c.cmd === 'set_autostart').map((c) => c.args)).toEqual([
    { enabled: true },
  ]);
  expect(shell.autostart).toBe(true);

  // 키 값은 화면에도, /secrets 응답에도 없다(있다/없다만)
  const html = await page.content();
  expect(html).not.toContain(KEY);
  expect(html).not.toContain(SECRET);
  const secrets = await (await stack.api('/secrets')).text();
  expect(JSON.parse(secrets)).toMatchObject({ KIS_APP_KEY: true, KIS_APP_SECRET: true });
  expect(secrets).not.toContain(KEY);
  expect(secrets).not.toContain(SECRET);
  // 화면이 받은 어떤 응답에도 키가 없다
  for (const r of log.requests) {
    // SSE(/events)는 끝나지 않는 응답이라 뺀다
    if (!r.url().startsWith('http://127.0.0.1:') || new URL(r.url()).pathname === '/events')
      continue;
    const res = await r.response();
    if (!res) continue;
    const body = await res.text().catch(() => '');
    expect(body).not.toContain(KEY);
    expect(body).not.toContain(SECRET);
  }
  // 가짜 한투가 토큰을 실제로 발급했다(연결 테스트가 가짜에 닿았다)
  expect((await stack.state()).tokens_issued).toBeGreaterThan(0);
  expect(log.errors).toEqual([]);
  // AI 엔진을 '나중에'로 두었으니 LLM 확인만 409(LLM 키 없음)다
  expect([...new Set(log.httpErrors)]).toEqual(['409 GET /llm/check']);
});

test('U2 마법사: 한투가 키를 거절하면 KIS_AUTH_INVALID의 문구와 해결 방법, [다음]은 꺼져 있다', async ({
  page,
  stack,
  shell,
}) => {
  void shell;
  await stack.ctl('/auth', { ok: false });
  await openApp(page, '#/welcome');
  await page.getByRole('button', { name: '다음' }).click();
  await page.getByLabel('앱키').fill(KEY);
  await page.getByLabel('앱시크릿').fill(SECRET);
  await page.getByRole('button', { name: '저장하고 연결 테스트' }).click();
  await expect(
    page.getByText('한국투자증권 인증에 실패했습니다: 유효하지 않은 AppKey입니다.'),
  ).toBeVisible();
  await expect(
    page.getByText('앱키와 앱시크릿, 실전/모의 서버 선택을 확인해 주세요.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '다음' })).toBeDisabled();
  await expect(page.getByText('연결 테스트에 성공하면 다음으로 갈 수 있습니다.')).toBeVisible();

  // 키를 고쳐(가짜 한투가 다시 받아 줌) 다시 시험하면 넘어갈 수 있다
  await stack.ctl('/auth', { ok: true });
  await page.getByLabel('앱키').fill(KEY);
  await page.getByLabel('앱시크릿').fill(SECRET);
  await page.getByRole('button', { name: '저장하고 연결 테스트' }).click();
  await expect(page.getByText(/^연결됨: 실전 서버/)).toBeVisible();
  await expect(page.getByRole('button', { name: '다음' })).toBeEnabled();
});
