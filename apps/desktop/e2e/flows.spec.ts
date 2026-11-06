/**
 * 실제 개발 모드 사이드카와 맞춰 보는 흐름 테스트. 단위 테스트(MSW)가 못 보는 것:
 * CORS(http://localhost:5173), 진짜 EventSource와 ?token=, 이름 있는 SSE 이벤트, 실제 오류 본문({code, message, hint}).
 * 사이드카 하나를 순서대로 쓴다(앞 테스트가 저장한 키·종목을 뒤 테스트가 쓴다).
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { STACK_FILE, type StackInfo } from './stack';

test.describe.configure({ mode: 'serial' });

const FAKE_KIS_KEY = 'PSe2eFAKEappKEY0000000000000000000000';
const FAKE_KIS_SECRET = 'e2e-fake-app-secret-not-a-real-key';
const FAKE_LLM_KEY = 'e2e-fake-llm-key-not-real';

function stack(): StackInfo {
  return JSON.parse(readFileSync(STACK_FILE, 'utf8')) as StackInfo;
}

/** 테스트가 사이드카를 직접 부른다(화면 밖에서 상태를 바꾸거나 확인할 때). */
async function api(path: string, init: RequestInit = {}) {
  const { base, token } = stack();
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
}

/** 화면이 쓴 요청이 사이드카에서 실패한 콘솔 오류(CORS 등)를 모은다. */
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('첫 실행: 키가 없으면 마법사, 가짜 키는 저장되지만 연결 테스트가 실패해 다음으로 못 간다', async ({
  page,
}) => {
  const errors = watchConsole(page);
  await page.goto('/#/home');
  await expect(page).toHaveURL(/#\/welcome$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Vater 시작하기' })).toBeVisible();

  await page.getByRole('button', { name: '다음' }).click();
  await expect(page.getByRole('heading', { level: 2, name: '한국투자증권 연결' })).toBeVisible();
  await expect(page.getByRole('button', { name: '다음' })).toBeDisabled();

  await page.getByLabel('앱키').fill(FAKE_KIS_KEY);
  await page.getByLabel('앱시크릿').fill(FAKE_KIS_SECRET);
  // 한 동작: 입력한 키를 저장한 다음 바로 그 키로 연결 테스트
  await page.getByRole('button', { name: '저장하고 연결 테스트' }).click();
  await expect(page.getByText('저장됨', { exact: true })).toBeVisible();
  await expect(page.getByText('앱키 저장됨')).toBeVisible();
  await expect(page.getByLabel('앱키')).toHaveValue('');
  const html = await page.content();
  expect(html).not.toContain(FAKE_KIS_KEY);
  expect(html).not.toContain(FAKE_KIS_SECRET);

  const secrets = await (await api('/secrets')).text();
  expect(JSON.parse(secrets)).toMatchObject({ KIS_APP_KEY: true, KIS_APP_SECRET: true });
  expect(secrets).not.toContain(FAKE_KIS_KEY);

  // 가짜 키: 한투가 거절하거나(KIS_AUTH_INVALID) 인터넷이 없으면 연결 실패. 어느 쪽이든 원인이 보인다.
  const failure = page.getByRole('status').filter({ hasText: '한국투자증권' });
  await expect(failure.first()).toBeVisible({ timeout: 45_000 });
  // 어떤 실패였는지 보고서에 남긴다(인터넷이 되는 PC는 인증 실패, 아니면 연결 실패)
  test.info().annotations.push({
    type: 'kis-test',
    description: (await failure.first().textContent()) ?? '',
  });
  console.log(`kis-test: ${(await failure.first().textContent()) ?? ''}`);
  await expect(page.getByRole('button', { name: '다음' })).toBeDisabled();
  await expect(page.getByText('연결 테스트에 성공하면 다음으로 갈 수 있습니다.')).toBeVisible();
  expect(errors.filter((e) => /CORS|Failed to fetch/i.test(e))).toEqual([]);
});

test('감시 종목과 규칙을 만들면 목록에 남고, 실제 422 오류의 hint가 보인다', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('/#/alerts');
  await expect(page.getByRole('heading', { level: 1, name: '감시·알림' })).toBeVisible();
  const watch = page.getByRole('region', { name: '감시 종목' });
  await expect(watch.getByText(/아직 감시 종목이 없습니다/)).toBeVisible();

  await page.getByRole('button', { name: '종목 검색으로 추가' }).click();
  await page.getByRole('searchbox', { name: '종목 검색' }).fill('삼성');
  await page.getByRole('button', { name: '삼성전자 추가' }).click();
  await expect(page).toHaveURL(/#\/symbols\/KR\/005930$/);
  const panel = page.getByRole('region', { name: /^삼성전자/ });
  await expect(
    panel.getByText('아직 규칙이 없습니다. 규칙 추가를 눌러 알림 조건을 만드세요.'),
  ).toBeVisible();

  // 사이드카 검증: 짧은 이동평균이 긴 것보다 길면 422 ALERT_RULE_INVALID
  await panel.getByRole('button', { name: '규칙 추가' }).click();
  const form = panel.getByRole('form', { name: '새 규칙' });
  await form.getByRole('combobox', { name: '종류' }).selectOption('ma_cross');
  await form.getByRole('textbox', { name: '짧은 이동평균(일)' }).fill('30');
  await form.getByRole('button', { name: '저장' }).click();
  await expect(form.getByText('알림 조건 값이 올바르지 않습니다.')).toBeVisible();
  await expect(form.getByText(/^확인할 항목:/)).toBeVisible();

  await form.getByRole('combobox', { name: '종류' }).selectOption('rsi');
  await form.getByRole('button', { name: '저장' }).click();
  const rules = panel.getByRole('list', { name: '삼성전자 규칙' });
  await expect(rules.getByText('RSI(14) 70 이상 과매수 진입')).toBeVisible();
  await expect(rules.getByText('장 마감 후(그날 종가)')).toBeVisible();

  // 새로 불러와도 사이드카 DB에 남아 있다
  await page.reload();
  await expect(
    page.getByRole('region', { name: /^삼성전자/ }).getByText('RSI(14) 70 이상 과매수 진입'),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: '알림 이력' }).getByText(/아직 울린 알림이 없습니다/),
  ).toBeVisible();
  expect(errors.filter((e) => /CORS|Failed to fetch/i.test(e))).toEqual([]);
});

test('SSE: 실제 EventSource(?token=)로 이름 있는 이벤트 alerts.state를 받아 화면이 바뀐다', async ({
  page,
}) => {
  const sse: string[] = [];
  page.on('request', (req) => {
    if (new URL(req.url()).pathname === '/events') sse.push(req.url());
  });
  await page.goto('/#/home');
  await expect(page.getByRole('heading', { level: 1, name: '홈' })).toBeVisible();
  await expect.poll(() => sse.length).toBeGreaterThan(0);
  expect(sse[0]).toContain(`?token=${stack().token}`);
  const side = page.getByRole('complementary');
  await expect(side.getByRole('button', { name: '감시 일시 중지' })).toBeEnabled();
  // 연결이 열린 뒤 화면 밖(트레이 메뉴처럼)에서 감시를 멈춘다 → 사이드카가 alerts.state를 보낸다
  await page.waitForTimeout(500);
  expect((await api('/alerts/pause', { method: 'POST' })).status).toBe(200);
  await expect(side.getByText('감시 일시 중지됨')).toBeVisible();
  await expect(
    page.getByRole('contentinfo', { name: '상태' }).getByText(/^마지막 수신 \d\d:\d\d:\d\d$/),
  ).toBeVisible();
  // 화면에서 다시 켠다
  await side.getByRole('button', { name: '감시 재개' }).click();
  await expect(side.getByText('감시 일시 중지됨')).toHaveCount(0);
  // 홈의 감시 종목: 가짜 키라 시세는 없다 → "—"와 "데이터 없음"
  const table = page.getByRole('table', { name: '감시 종목' });
  await expect(table.getByRole('row', { name: /삼성전자/ })).toBeVisible();
  await expect(
    table
      .getByRole('row', { name: /삼성전자/ })
      .getByText('데이터 없음')
      .first(),
  ).toBeAttached();
});

test('브리핑 목록은 비어 있으면 언제 만들어지는지 알려 준다', async ({ page }) => {
  await page.goto('/#/briefings');
  await expect(
    page.getByText(
      /아직 브리핑이 없습니다\. 거래일마다 국내 16:00, 미국 07:00에 자동으로 만들어집니다/,
    ),
  ).toBeVisible();
});

test('설정: 저장한 값이 남고, 잘못된 값은 사이드카 422 문구 그대로, 클라우드 키는 다시 보이지 않는다', async ({
  page,
}) => {
  await page.goto('/#/settings');
  const analysis = page.getByRole('region', { name: '분석 기본값' });
  await analysis.getByRole('button', { name: /^토론 라운드 / }).click();
  await page.getByRole('option', { name: '2회' }).click();
  await expect
    .poll(async () => (await (await api('/settings')).json())['analysis.debate_rounds'])
    .toBe(2);
  await page.reload();
  await expect(
    page
      .getByRole('region', { name: '분석 기본값' })
      .getByRole('button', { name: /^토론 라운드 / }),
  ).toHaveAccessibleName('토론 라운드 2회');

  const briefing = page.getByRole('region', { name: '브리핑' });
  await briefing.getByLabel('국내 브리핑 시각').fill('25:00');
  await briefing.getByRole('button', { name: '브리핑 설정 저장' }).click();
  await expect(
    briefing.getByText(
      "설정 'briefing.kr.time' 값이 올바르지 않습니다: HH:MM 형식(00:00~23:59)이어야 합니다",
    ),
  ).toBeVisible();

  const cloud = page.getByRole('region', { name: '클라우드 AI' });
  await cloud.getByLabel('Google Gemini 키').fill(FAKE_LLM_KEY);
  await cloud.getByRole('button', { name: '키 저장' }).click();
  await expect(cloud.getByText('저장됨', { exact: true })).toBeVisible();
  await expect(cloud.getByText('Google Gemini 키 저장됨')).toBeVisible();
  expect(await page.content()).not.toContain(FAKE_LLM_KEY);
  expect((await (await api('/secrets')).json()).LLM_GOOGLE_KEY).toBe(true);
});
