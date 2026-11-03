/**
 * 화면 캡처(배율 1.5): VATER_SHOTS=1 npm run e2e -- shots
 * 견본 자료(mock.html)로 찍어 docs/design/screens/shots/에 저장한다. 평소 흐름 테스트에서는 건너뛴다.
 */
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, '../../../docs/design/screens/shots');

test.skip(process.env.VATER_SHOTS !== '1', '캡처는 VATER_SHOTS=1일 때만');
test.use({ deviceScaleFactor: 1.5, viewport: { width: 1280, height: 800 } });

test('홈 배율 1.5', async ({ page }) => {
  await page.goto('/mock.html?running=1#/home');
  await expect(page.getByRole('table', { name: '지수' })).toBeVisible();
  await expect(page.getByText(/마지막 수신/)).toBeVisible();
  await page.screenshot({ path: `${OUT}/home-1280x800@1.5x.png` });
});

test('첫 실행 마법사 배율 1.5', async ({ page }) => {
  await page.goto('/mock.html?nokey=1#/welcome');
  await expect(page.getByRole('heading', { level: 2, name: 'Vater를 소개합니다' })).toBeVisible();
  await page.screenshot({ path: `${OUT}/welcome-1280x800@1.5x.png` });
  await page.getByRole('button', { name: '다음' }).click();
  await page.getByRole('button', { name: '연결 테스트' }).click();
  await expect(page.getByText(/연결됨: 실전 서버/)).toBeVisible();
  await page.screenshot({ path: `${OUT}/welcome-kis-1280x800@1.5x.png` });
});

test('마법사 한투 단계 1024×600', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto('/mock.html?nokey=1#/welcome');
  await page.getByRole('button', { name: '다음' }).click();
  await expect(page.getByRole('heading', { level: 2, name: '한국투자증권 연결' })).toBeVisible();
  await page.screenshot({ path: `${OUT}/welcome-kis-1024x600@1.5x.png` });
});
