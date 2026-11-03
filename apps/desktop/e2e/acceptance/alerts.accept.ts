/**
 * U3·U4·U5·U9·U10: 알림 감시와 시세(스펙 4장, 7장, 8장, 성공 기준 2).
 * 실제 감시 루프와 실제 한투 WebSocket 클라이언트가 가짜 한투 서버에 소켓으로 붙는다.
 * 감시 시계는 화 10:00 KST(국내 장중)에서 실제 시간으로 흐르고, 폴링 간격은 10초다.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, main, openApp, test, type Stack } from './harness';

const MESSAGE = '삼성전자 현재가 61,000 — 목표가 60,000 이상';

function watchRow(page: Page): Locator {
  return main(page)
    .getByRole('table', { name: '감시 종목' })
    .getByRole('row', { name: /삼성전자/ });
}

/** 실시간 수신이 연결되고 감시 루프가 그것을 화면에 알릴 때까지. */
async function waitRealtime(page: Page, stack: Stack) {
  await stack.waitSubscribed('005930');
  await expect(watchRow(page).getByText('실시간', { exact: true })).toBeVisible({
    timeout: 25_000,
  });
}

/** 색: 상승은 빨강, 하락은 파랑(스펙 9-1). */
async function rgb(locator: Locator): Promise<[number, number, number]> {
  const color = await locator.evaluate((el) => getComputedStyle(el).color);
  const m = /(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/.exec(color);
  if (!m) throw new Error(`색을 읽지 못했습니다: ${color}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

test('U3 알림 끝까지: 화면에서 만든 목표가 규칙이 실시간 틱에 울리고 5초 안에 홈·이력에 보인다', async ({
  page,
  stack,
  shell,
  log,
}) => {
  void shell;
  await stack.setup();
  await openApp(page, '#/alerts');

  // 화면에서 감시 종목과 목표가 규칙을 만든다
  await page.getByRole('button', { name: '종목 추가' }).click();
  await page.getByRole('searchbox', { name: '종목 검색' }).fill('삼성');
  await page.getByRole('button', { name: '삼성전자 추가' }).click();
  await expect(page).toHaveURL(/#\/symbols\/KR\/005930$/);
  const panel = page.getByRole('region', { name: /^삼성전자/ });
  await panel.getByRole('button', { name: '규칙 추가' }).click();
  const form = panel.getByRole('form', { name: '새 규칙' });
  await form.getByRole('combobox', { name: '종류' }).selectOption('price_above');
  await form.getByRole('textbox', { name: '목표가(원)' }).fill('60000');
  await expect(form.getByRole('radio', { name: /실시간/ })).toBeChecked();
  await form.getByRole('button', { name: '저장' }).click();
  await expect(
    panel.getByRole('list', { name: '삼성전자 규칙' }).getByText(/60,000/),
  ).toBeVisible();

  await openApp(page, '#/home');
  await waitRealtime(page, stack);
  await stack.ctl('/tick', { code: '005930', price: 59000, pct: 0.85 }); // 기준값(거짓)
  await page.waitForTimeout(1_300); // 틱은 종목당 1초에 1번 평가한다

  const sent = Date.now();
  await stack.ctl('/tick', { code: '005930', price: 61000, pct: 4.27 });
  await main(page).getByText(MESSAGE).waitFor({ timeout: 5_000 });
  const screen = (Date.now() - sent) / 1000;
  await expect.poll(() => stack.notifies.length).toBeGreaterThan(0);
  const notify = stack.notifies[0];
  const shellLatency = notify ? (notify.at - sent) / 1000 : NaN;
  console.log(
    `U3 alert latency: screen ${(screen * 1000).toFixed(0)} ms, shell notify ${(shellLatency * 1000).toFixed(0)} ms (기준 5 s)`,
  );
  test.info().annotations.push({
    type: 'U3 latency',
    description: `screen ${screen.toFixed(2)} s, notify ${shellLatency.toFixed(2)} s`,
  });
  expect(screen).toBeLessThanOrEqual(5);
  expect(shellLatency).toBeLessThanOrEqual(5);
  // 셸로 가는 Windows 알림(stdout notify): 누르면 그 종목 화면으로
  expect(notify).toMatchObject({
    title: '알림: 삼성전자',
    body: '현재가 61,000 — 목표가 60,000 이상',
    route: '/symbols/KR/005930',
  });

  // 감시·알림 이력에도 1건
  await openApp(page, '#/alerts');
  const history = page.getByRole('region', { name: '알림 이력' });
  await expect(history.getByText(MESSAGE)).toBeVisible();
  await expect(history.getByRole('table', { name: '알림 이력' }).getByRole('row')).toHaveCount(2);
  const events = await stack.json<{ message: string }[]>('/alerts/events');
  expect(events.map((e) => e.message)).toEqual([MESSAGE]);
  expect(log.errors).toEqual([]);
});

test('U4 시세: 틱이 오면 홈 감시 종목의 현재가·전일 대비·등락률이 바뀌고(빨강/파랑), 수신은 실시간', async ({
  page,
  stack,
  shell,
}) => {
  void shell;
  await stack.setup();
  await stack.watchAbove('005930', 90000);
  await openApp(page);
  // 처음 값: 한투 REST 현재가(59,000원, 전일 대비 +500)
  await expect(watchRow(page).getByText('59,000원')).toBeVisible();
  await waitRealtime(page, stack);

  await stack.ctl('/tick', { code: '005930', price: 61000, pct: 4.27 });
  await expect(watchRow(page).getByText('61,000원')).toBeVisible({ timeout: 5_000 });
  const up = watchRow(page).locator('[data-direction]').filter({ hasText: '+2,500' });
  await expect(up).toHaveAttribute('data-direction', 'up');
  await expect(watchRow(page).getByText('+4.27%')).toBeVisible();
  const [ur, , ub] = await rgb(up);
  expect(ur).toBeGreaterThan(ub); // 빨강

  await page.waitForTimeout(1_300);
  await stack.ctl('/tick', { code: '005930', price: 57000, pct: -2.56 });
  await expect(watchRow(page).getByText('57,000원')).toBeVisible({ timeout: 5_000 });
  // 음수 부호는 빼기 기호 −(U+2212)다
  const down = watchRow(page).locator('[data-direction]').filter({ hasText: '\u22121,500' });
  await expect(down).toHaveAttribute('data-direction', 'down');
  await expect(watchRow(page).getByText('\u22122.56%')).toBeVisible();
  const [dr, , db] = await rgb(down);
  expect(db).toBeGreaterThan(dr); // 파랑
  await expect(watchRow(page).getByText('실시간', { exact: true })).toBeVisible();
});

test('U5 한투 WebSocket이 끊기면 수신 상태가 실시간 → 폴링(주기 확인), 다시 붙으면 실시간', async ({
  page,
  stack,
  shell,
}) => {
  void shell;
  await stack.setup();
  await stack.watchAbove('005930', 90000);
  await openApp(page);
  await waitRealtime(page, stack);
  const status = page.getByRole('contentinfo', { name: '상태' });
  await expect(status.getByText(/실시간 1/)).toBeVisible();

  await stack.ctl('/ws', { down: true });
  // 폴링은 화면에서 "10초마다 확인"(감시 종목)·"주기 확인 1"(상태 표시줄)로 보인다
  await expect(watchRow(page).getByText('10초마다 확인')).toBeVisible({ timeout: 25_000 });
  await expect(status.getByText(/주기 확인 1/)).toBeVisible();

  await stack.ctl('/ws', { down: false });
  await expect(watchRow(page).getByText('실시간', { exact: true })).toBeVisible({
    timeout: 25_000,
  });
  await expect(status.getByText(/실시간 1/)).toBeVisible();
  expect((await stack.state()).ws_accepted).toBeGreaterThanOrEqual(2); // 다시 붙었다
});

test('U9 인터넷 끊김: "오프라인: 알림 감시 일시 중지" 배너, 복구되면 사라진다', async ({
  page,
  stack,
  shell,
}) => {
  void shell;
  await stack.setup();
  await stack.watchAbove('005930', 90000);
  await openApp(page);
  await waitRealtime(page, stack);

  await stack.ctl('/offline', { on: true });
  await expect(page.getByText('오프라인: 알림 감시 일시 중지')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole('complementary').getByText('감시 멈춤 · 오프라인')).toBeVisible();

  await stack.ctl('/offline', { on: false });
  await expect(page.getByText('오프라인: 알림 감시 일시 중지')).toHaveCount(0, { timeout: 25_000 });
  await expect(page.getByRole('complementary').getByText('알림 감시 중')).toBeVisible();
});

test('U10a 한투 키 만료: 설정 > 연결 테스트가 KIS_AUTH_INVALID의 문구와 해결 방법을 보여 준다', async ({
  page,
  stack,
  shell,
}) => {
  void shell;
  await stack.setup();
  await openApp(page, '#/settings');
  await stack.ctl('/auth', { ok: false });
  const kis = main(page).getByRole('region', { name: '한국투자증권' });
  await kis.getByRole('button', { name: '연결 테스트' }).click();
  await expect(kis.getByText(/^한국투자증권 인증에 실패했습니다/)).toBeVisible();
  await expect(kis.getByText(/앱키와 .*서버 선택을 확인해 주세요/)).toBeVisible();
});

test('U10 한투 키 만료: "한국투자증권 키를 확인하세요" 배너와 [설정 열기](스펙 8장)', async ({
  page,
  stack,
  shell,
}) => {
  void shell;
  await stack.setup();
  await stack.watchAbove('005930', 90000);
  await openApp(page);
  await waitRealtime(page, stack);
  await stack.ctl('/auth', { ok: false });
  await stack.ctl('/ws', { drop: true }); // 다시 붙을 때 승인키가 거절된다
  await expect(page.getByText('한국투자증권 키를 확인하세요')).toBeVisible({ timeout: 30_000 });
  const open = page.getByRole('link', { name: '설정 열기' });
  await expect(open).toHaveAttribute('href', '#/settings');
  await open.click();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(main(page).getByRole('heading', { level: 1, name: '설정' })).toBeVisible();
});
