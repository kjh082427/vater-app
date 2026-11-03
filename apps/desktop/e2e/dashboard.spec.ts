/**
 * 홈 대시보드 흐름(실제 개발 모드 사이드카): 저장한 배치가 사이드카 DB에 남는지 본다.
 * 이 파일은 flows.spec.ts보다 먼저 돌 수 있다. 한투 키를 넣지 않고(첫 실행 흐름을 건드리지 않게),
 * 마법사로 넘어가면 주소를 홈으로 되돌려 쓴다(마법사 확인은 창마다 한 번뿐). 기본 탭은 바꾸지 않는다.
 */
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

/** 홈(또는 hash)을 연다. 키가 없어 마법사로 가면 그 주소로 되돌린다. */
async function open(page: Page, hash = '#/home') {
  await page.goto(`/${hash}`);
  const home = page.getByRole('tablist', { name: '내 화면' });
  const welcome = page.getByRole('heading', { level: 2, name: 'Vater를 소개합니다' });
  // 마법사 확인(GET /secrets)은 화면이 뜬 뒤에 끝날 수 있다: 두 번까지 되돌린다
  for (let i = 0; i < 2; i++) {
    await expect(home.or(welcome)).toBeVisible();
    await page.waitForTimeout(500);
    if (await welcome.isVisible()) {
      await page.evaluate((h) => {
        location.hash = h;
      }, hash);
    }
  }
  await expect(home).toBeVisible();
}

async function pickContent(page: Page, n: number, label: string) {
  await page.getByRole('button', { name: `칸 ${n} 내용 바꾸기` }).click();
  const dialog = page.getByRole('dialog', { name: `칸 ${n}에 보여 줄 내용` });
  await dialog.getByRole('button', { name: new RegExp(`^${label}`) }).click();
  await expect(dialog).toHaveCount(0);
}

test('탭 추가 → 3칸 왼쪽 크게 → 내용 고르기 → 저장 → 새로 고침 뒤 그대로', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '화면 추가' }).click();
  await expect(page.getByRole('tab', { name: '새 화면 1', selected: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/home\?tab=d-/);
  const hash = new URL(page.url()).hash;

  await page.getByRole('button', { name: '배치 편집' }).click();
  const editor = page.getByRole('region', { name: '배치 편집' });
  await editor.getByRole('radiogroup', { name: '칸 수' }).getByRole('radio', { name: '3' }).click();
  await editor.getByText('왼쪽 크게 + 오른쪽 2').click();
  await expect(editor.getByRole('radio', { name: /왼쪽 크게 \+ 오른쪽 2/ })).toBeChecked();
  await pickContent(page, 1, '감시 종목');
  await pickContent(page, 2, '지수 차트');
  await pickContent(page, 3, '최근 알림');
  await editor.getByRole('button', { name: '저장' }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('region', { name: '칸 1: 감시 종목' })).toBeVisible();

  await open(page, hash);
  await expect(page.getByRole('tab', { name: '새 화면 1', selected: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '칸 1: 감시 종목' })).toBeVisible();
  await expect(page.getByRole('region', { name: '칸 2: 지수 차트' })).toBeVisible();
  await expect(page.getByRole('region', { name: '칸 3: 최근 알림' })).toBeVisible();
  // 가짜 키·키 없음: 지수는 값 없음으로 보이고 칸이 깨지지 않는다
  await expect(
    page.getByRole('region', { name: '칸 2: 지수 차트' }).getByText('데이터 없음').first(),
  ).toBeAttached();
});

test('경계선을 끌어 저장하면 새로 고침 뒤에도 비율이 남는다', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: '새 화면 1' }).click();
  const hash = new URL(page.url()).hash;
  await page.getByRole('button', { name: '배치 편집' }).click();
  const sep = page.getByRole('separator', { name: '칸 1과 칸 2·3 사이 경계선' });
  const before = Number(await sep.getAttribute('aria-valuenow'));
  const box = await sep.boundingBox();
  if (!box) throw new Error('경계선 위치 없음');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2, { steps: 5 });
  await expect(page.getByText(/^\d+ : \d+$/)).toBeVisible(); // 끄는 동안 비율 표시
  await page.mouse.up();
  const after = Number(await sep.getAttribute('aria-valuenow'));
  expect(after).toBeLessThan(before);
  await page
    .getByRole('region', { name: '배치 편집' })
    .getByRole('button', { name: '저장' })
    .click();
  await expect(page.getByRole('region', { name: '배치 편집' })).toHaveCount(0);

  await open(page, hash);
  await page.getByRole('button', { name: '배치 편집' }).click();
  await expect(page.getByRole('separator', { name: '칸 1과 칸 2·3 사이 경계선' })).toHaveAttribute(
    'aria-valuenow',
    String(after),
  );
});

test('1024×600 창에서는 가로 4열 틀이 막히고 이유가 보인다', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await open(page);
  await page.getByRole('button', { name: '배치 편집' }).click();
  const editor = page.getByRole('region', { name: '배치 편집' });
  await expect(editor.getByRole('radio', { name: /2×2 격자/ })).toBeChecked();
  const cols4 = editor.getByRole('radio', { name: /가로 4열/ });
  await expect(cols4).toBeDisabled();
  await expect(editor.getByText(/창이 작아 들어가지 않음: 칸 너비 약 189px/)).toBeVisible();
  await editor.getByRole('button', { name: '취소' }).click();
  await expect(editor).toHaveCount(0);
});
