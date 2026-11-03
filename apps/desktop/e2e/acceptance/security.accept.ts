/**
 * U16: 보안(성공 기준 6, 스펙 2-1). 빌드 결과에 키·토큰이 없고, 화면이 부르는 경로와 사이드카가 부르는
 * 한투 경로에 주문·정정·취소가 없으며, 화면을 한 바퀴 도는 동안 콘솔 오류가 없다.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, FAKE_SECRET_VALUES, main, openApp, sidecarRequests, test } from './harness';

const DESKTOP = resolve(import.meta.dirname, '../..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

test('U16a 빌드 결과(dist)에 키·토큰 문자열이 없다', async ({ stack }) => {
  test.setTimeout(180_000);
  const out = mkdtempSync(join(tmpdir(), 'vater-accept-dist-'));
  try {
    const env = { ...process.env };
    delete env.VITE_SIDECAR_URL;
    delete env.VITE_SIDECAR_TOKEN;
    const built = spawnSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], {
      cwd: DESKTOP,
      env,
      encoding: 'utf8',
    });
    expect(built.status, built.stderr).toBe(0);
    const texts = files(out)
      .filter((f) => /\.(js|html|css|json|map|txt)$/.test(f))
      .map((f) => ({ f, text: readFileSync(f, 'utf8') }));
    expect(texts.length).toBeGreaterThan(0);
    const found: string[] = [];
    for (const { f, text } of texts) {
      for (const secret of [...FAKE_SECRET_VALUES, stack.token]) {
        if (text.includes(secret)) found.push(`${f}: 가짜 키·토큰`);
      }
      // 셸 토큰 모양(64자 16진수), 한투 앱키 모양(PS로 시작하는 36자)
      if (/\b[0-9a-f]{64}\b/.test(text)) found.push(`${f}: 64자 16진수`);
      if (/\bPS[A-Za-z0-9]{34}\b/.test(text)) found.push(`${f}: 앱키 모양`);
      if (/VITE_SIDECAR_TOKEN["']?\s*[:=]\s*["'][^"']+["']/.test(text)) {
        found.push(`${f}: 개발용 토큰 값`);
      }
    }
    expect(found).toEqual([]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('U16b 화면을 한 바퀴: 주문·정정·취소 경로 없음, 콘솔 오류 0', async ({
  page,
  stack,
  shell,
  log,
}) => {
  void shell;
  await stack.setup();
  await stack.watchAbove('005930', 60000);
  await stack.ctl('/analysis', { stage_sec: 0.1 });
  const { id } = await stack.json<{ id: number }>('/analyses', {
    method: 'POST',
    body: JSON.stringify({ market: 'KR', code: '005930' }),
  });
  await stack.json('/briefings/run', { method: 'POST', body: JSON.stringify({ market: 'KR' }) });
  await expect
    .poll(async () => (await stack.json<{ status: string }>(`/analyses/${id}`)).status)
    .toBe('done');

  const visits: [string, string | RegExp][] = [
    ['#/home', '홈'],
    ['#/analyses', '분석'],
    [`#/analyses/${id}`, '삼성전자 분석'],
    ['#/alerts', '감시·알림'],
    ['#/symbols/KR/005930', '감시·알림'],
    ['#/briefings', '브리핑'],
    ['#/settings', '설정'],
  ];
  await openApp(page, '#/home');
  for (const [hash, heading] of visits) {
    await page.evaluate((h) => {
      window.location.hash = h;
    }, hash);
    await expect(main(page).getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await page.waitForTimeout(500);
  }
  const items = await stack.json<{ id: number }[]>('/briefings');
  await page.evaluate((h) => {
    window.location.hash = h;
  }, `#/briefings/${items[0]?.id}`);
  await expect(main(page).getByRole('table', { name: '지수' })).toBeVisible();
  // 화면에서 분석 하나를 더 시작해 쓰기 요청도 지나가게 한다
  await page.evaluate(() => {
    window.location.hash = '#/analyses';
  });
  const form = page.getByRole('form', { name: '새 분석' });
  await form.getByRole('searchbox', { name: '종목 검색' }).fill('삼성');
  await form.getByRole('button', { name: '삼성전자 선택' }).click();
  await form.getByRole('button', { name: '분석 시작' }).click();
  await expect(page.getByRole('img', { name: /^AI 의견 매수/ })).toBeVisible({ timeout: 15_000 });

  const paths = [
    ...new Set(sidecarRequests(log).map((r) => `${r.method()} ${new URL(r.url()).pathname}`)),
  ].sort();
  test.info().annotations.push({ type: 'U16 sidecar paths', description: paths.join(', ') });
  expect(paths.filter((p) => /order|trading|매매|주문/i.test(p))).toEqual([]);
  const kisPaths = [...new Set((await stack.state()).rest_paths)];
  test.info().annotations.push({ type: 'U16 KIS paths', description: kisPaths.join(', ') });
  // 한투 주문·정정·취소는 /uapi/.../trading/order-* 아래에 있다
  expect(kisPaths.filter((p) => /\/trading\/|order/i.test(p))).toEqual([]);
  expect(log.errors).toEqual([]);
  expect(log.httpErrors).toEqual([]);
});
