/**
 * U14: 화면 이동(스펙 9-3). 셸이 알림 클릭으로 보내는 `navigate` 4종이 그 항목을 펼친 화면을 연다.
 * 경로는 사이드카가 실제로 stdout notify에 실어 보낸 값을 쓴다.
 */
import { expect, main, openApp, test } from './harness';

test('U14 셸 navigate 4종: 종목·분석·브리핑·감시·알림 화면이 해당 항목을 펼친 채 열린다', async ({
  page,
  stack,
  shell,
}) => {
  await stack.setup();
  await stack.watchAbove('005930', 60000);
  await stack.ctl('/analysis', { stage_sec: 0.1 });
  const { id: analysisId } = await stack.json<{ id: number }>('/analyses', {
    method: 'POST',
    body: JSON.stringify({ market: 'KR', code: '005930' }),
  });
  await stack.json('/briefings/run', { method: 'POST', body: JSON.stringify({ market: 'KR' }) });
  await expect
    .poll(() => stack.notifies.map((n) => n.route), { timeout: 15_000 })
    .toEqual(
      expect.arrayContaining([
        `/analyses/${analysisId}`,
        expect.stringMatching(/^\/briefings\/\d+$/),
      ]),
    );
  const briefingRoute = stack.notifies.find((n) => n.route?.startsWith('/briefings/'))?.route ?? '';

  await openApp(page, '#/home');
  await expect(main(page).getByRole('heading', { level: 1, name: '홈' })).toBeVisible();

  // 1) 가격 알림 → 그 종목의 감시·알림(규칙이 펼쳐짐)
  await shell.emit('navigate', { route: '/symbols/KR/005930' });
  await expect(page).toHaveURL(/#\/symbols\/KR\/005930$/);
  const panel = page.getByRole('region', { name: /^삼성전자/ });
  await expect(panel.getByRole('list', { name: '삼성전자 규칙' })).toBeVisible();
  await expect(panel.getByText(/60,000/).first()).toBeVisible();

  // 2) 분석 완료 알림 → 결과 화면
  await shell.emit('navigate', { route: `/analyses/${analysisId}` });
  await expect(page).toHaveURL(new RegExp(`#/analyses/${analysisId}$`));
  await expect(main(page).getByRole('heading', { level: 1, name: '삼성전자 분석' })).toBeVisible();
  await expect(page.getByRole('img', { name: /^AI 의견 매수/ })).toBeVisible();

  // 3) 브리핑 도착 알림 → 브리핑 상세
  await shell.emit('navigate', { route: briefingRoute });
  await expect(page).toHaveURL(new RegExp(`#${briefingRoute}$`));
  await expect(
    main(page).getByRole('heading', { level: 1, name: /국내 시장 브리핑$/ }),
  ).toBeVisible();
  await expect(main(page).getByRole('table', { name: '지수' })).toBeVisible();

  // 4) 감시·알림 목록
  await shell.emit('navigate', { route: '/alerts' });
  await expect(page).toHaveURL(/#\/alerts$/);
  await expect(main(page).getByRole('heading', { level: 1, name: '감시·알림' })).toBeVisible();
  await expect(page.getByRole('region', { name: '알림 이력' })).toBeVisible();

  // 모르는 경로는 무시한다(지금 화면 그대로)
  await shell.emit('navigate', { route: '/nowhere' });
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/#\/alerts$/);
});
