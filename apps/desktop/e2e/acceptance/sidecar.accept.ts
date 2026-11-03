/**
 * U6·U7·U8·U15: 셸이 알려 주는 사이드카 상태와 화면(스펙 2-1, 8장).
 */
import { expect, main, openApp, sidecarRequests, Stack, test } from './harness';

test('U15 창을 다시 연 것과 같은 상황(새로 고침): 같은 사이드카에 다시 붙고 자료가 그대로다', async ({
  page,
  stack,
  shell,
  log,
}) => {
  await stack.setup();
  await stack.watchAbove('005930', 60000);
  await openApp(page);
  const table = main(page).getByRole('table', { name: '감시 종목' });
  await expect(table.getByRole('row', { name: /삼성전자/ })).toBeVisible();
  const infoCalls = shell.count('get_sidecar_info');

  await page.reload();
  await expect(main(page).getByRole('heading', { level: 1, name: '홈' })).toBeVisible();
  await expect(table.getByRole('row', { name: /삼성전자/ })).toBeVisible();
  await openApp(page, '#/alerts');
  await expect(
    main(page).getByRole('region', { name: '감시 종목' }).getByText('삼성전자').first(),
  ).toBeVisible();

  // 셸에 다시 물어서 같은 포트·토큰을 받았다(사이드카는 그대로 하나)
  expect(shell.count('get_sidecar_info')).toBeGreaterThan(infoCalls);
  expect(stack.alive).toBe(true);
  const ports = new Set(sidecarRequests(log).map((r) => new URL(r.url()).port));
  expect([...ports]).toEqual([String(stack.port)]);
  expect(log.errors).toEqual([]);
});

test('U6 사이드카 재시작: 새 포트·새 토큰으로 다시 붙고, 옛 토큰으로 가는 요청이 없다', async ({
  page,
  stack,
  shell,
  log,
}) => {
  await stack.setup();
  await stack.watchAbove('005930', 60000);
  await openApp(page);
  const table = main(page).getByRole('table', { name: '감시 종목' });
  await expect(table.getByRole('row', { name: /삼성전자/ })).toBeVisible();
  await stack.waitSubscribed('005930');

  // 비정상 종료 → 셸이 알아채고(starting) 다시 띄운다(ready)
  await stack.kill('SIGKILL');
  shell.state = 'starting';
  await shell.emit('sidecar-state', { state: 'starting' });
  // SSE가 먼저 끊겨 "연결 끊김" 배너가 앞선다(시작 중 배너보다 우선)
  await expect(page.getByText('연결 끊김: 화면이 최신이 아닐 수 있습니다')).toBeVisible();

  const next = await Stack.start(stack.dataDir);
  expect(next.port).not.toBe(stack.port);
  expect(next.token).not.toBe(stack.token);
  shell.stack = next;
  shell.state = 'ready';
  const switchedAt = log.requests.length;
  await shell.emit('sidecar-state', { state: 'ready', port: next.port });

  // SSE가 새 사이드카로 다시 열리고, 배너가 사라지고, 목록을 다시 불러온다
  await expect
    .poll(() =>
      sidecarRequests({ ...log, requests: log.requests.slice(switchedAt) }).some(
        (r) => new URL(r.url()).pathname === '/events' && r.url().includes(next.token),
      ),
    )
    .toBe(true);
  await expect(page.getByText('Vater 백그라운드 서비스를 시작하는 중입니다')).toHaveCount(0);
  await expect(page.getByText('연결 끊김: 화면이 최신이 아닐 수 있습니다')).toHaveCount(0);
  await expect(table.getByRole('row', { name: /삼성전자/ })).toBeVisible();

  // 새 사이드카에서 일어난 일이 화면에 온다(SSE): 감시를 멈추면 사이드바가 바뀐다
  await page.waitForTimeout(500);
  expect((await next.api('/alerts/pause', { method: 'POST' })).status).toBe(200);
  await expect(page.getByRole('complementary').getByText('감시 일시 중지됨')).toBeVisible();

  const after = sidecarRequests({ ...log, requests: log.requests.slice(switchedAt) });
  expect(after.length).toBeGreaterThan(0);
  const stale = [];
  for (const r of after) {
    const auth = (await r.allHeaders()).authorization ?? '';
    if (r.url().includes(stack.token) || auth.includes(stack.token)) stale.push(r.url());
    if (new URL(r.url()).port === String(stack.port)) stale.push(r.url());
  }
  expect(stale).toEqual([]);
});

test('U7 사이드카가 끝내 안 뜸(failed): 오류 화면과 해결 방법', async ({ page, shell }) => {
  shell.state = 'failed';
  await openApp(page);
  await expect(
    page.getByText('Vater 백그라운드 서비스를 실행하지 못했습니다').first(),
  ).toBeVisible();
  await expect(
    page.getByText('앱을 완전히 종료(트레이 메뉴 > 종료)한 뒤 다시 실행하세요.').first(),
  ).toBeVisible();
});

test('U7b 오류 화면의 [로그 폴더 열기](스펙 8장 표: 사이드카 비정상 종료)', async ({
  page,
  shell,
}) => {
  // 제품 결함: 사이드카 실패 화면에 [로그 폴더 열기]가 없다(셸 커맨드도 없음). 스펙 8장 표와 다르다.
  test.fail();
  shell.state = 'failed';
  await openApp(page);
  await expect(
    page.getByText('Vater 백그라운드 서비스를 실행하지 못했습니다').first(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '로그 폴더 열기' })).toBeVisible({
    timeout: 3_000,
  });
});

test('U8 사이드카가 늦게 뜸(starting 40초 → ready): 화면이 포기하지 않고 붙는다', async ({
  page,
  stack,
  shell,
}) => {
  test.setTimeout(120_000);
  await stack.setup();
  await stack.watchAbove('005930', 60000);
  shell.state = 'starting';
  await openApp(page);
  await expect(page.getByText('Vater 백그라운드 서비스를 시작하는 중입니다')).toBeVisible();
  await page.waitForTimeout(40_000);
  shell.state = 'ready';
  await shell.emit('sidecar-state', { state: 'ready', port: stack.port });
  await expect(page.getByText('Vater 백그라운드 서비스를 시작하는 중입니다')).toHaveCount(0);
  await expect(
    main(page)
      .getByRole('table', { name: '감시 종목' })
      .getByRole('row', { name: /삼성전자/ }),
  ).toBeVisible();
  // 마법사로 잘못 가지 않았다(키는 있다)
  expect(page.url()).not.toContain('#/welcome');
});
