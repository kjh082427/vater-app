/**
 * v2 보유 흐름(흉내 증권사 서버): 연결 → 업로드 → 내 보유 → 해제.
 * mock.html?brokers=1: 키움·메리츠를 연결하면 정해 둔 보유 종목이 들어온다. 실제 증권사·AI는 부르지 않고,
 * 키는 가짜 값만 넣는다. 화면 캡처는 VATER_SHOTS_DIR을 줄 때만(1280×800, 1024×600, 1280×720=1080p 배율 1.5).
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = process.env.VATER_SHOTS_DIR;
// 1920×1080을 배율 150%로 쓰는 창은 CSS 1280×720이다
const SIZES = [
  { name: '1280x800', viewport: { width: 1280, height: 800 } },
  { name: '1024x600', viewport: { width: 1024, height: 600 } },
  { name: '1280x720-배율1.5', viewport: { width: 1280, height: 720 } },
];

/** 세 크기로 찍고 가로로 넘치지 않는지 본다(1024 아래로는 줄이지 않는 앱이라 문서 너비 = 창 너비여야 한다). */
async function shoot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const original = page.viewportSize();
  for (const s of SIZES) {
    await page.setViewportSize(s.viewport);
    await page.waitForTimeout(250);
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(wide, `${name} ${s.name}: 가로로 넘침`).toBeLessThanOrEqual(1);
    await page.screenshot({ path: join(SHOTS, `${name}-${s.name}.png`) });
  }
  if (original) await page.setViewportSize(original);
}

async function connectKey(page: Page, broker: string) {
  const card = page.getByRole('region', { name: '증권사 연결' });
  await card.getByRole('button', { name: '연결 추가' }).click();
  await card.getByRole('button', { name: /^증권사 / }).click();
  await page.getByRole('option', { name: broker }).click();
  await card.getByLabel('앱키').fill(`fake-key-${broker}-0000000000`);
  await card.getByLabel('앱시크릿').fill(`fake-secret-${broker}-1111111111`);
  await card.getByRole('button', { name: '연결', exact: true }).click();
  await expect(
    card.getByRole('list', { name: '연결한 증권사' }).getByText(broker, { exact: true }),
  ).toBeVisible();
}

test('연결 → 업로드 → 내 보유 → 해제', async ({ page }) => {
  await page.goto('/mock.html?brokers=1#/settings');

  await test.step('증권사 연결: 키움과 메리츠(키는 다시 보이지 않는다)', async () => {
    await connectKey(page, '키움');
    await connectKey(page, '메리츠');
    const card = page.getByRole('region', { name: '증권사 연결' });
    const list = card.getByRole('list', { name: '연결한 증권사' });
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list.getByText(/^키 [0-9a-f]{4}$/)).toHaveCount(2);
    await expect(list.getByText('연결됨')).toHaveCount(2);
    await expect(page.locator('body')).not.toContainText('fake-key-');
    await expect(page.locator('body')).not.toContainText('fake-secret-');
    await shoot(page, 'settings-connections');
  });

  await test.step('업로드: 새 종목 알림, 확인 창, 체크 해제 종목은 올리지 않는다', async () => {
    await page.evaluate(() => {
      location.hash = '#/alerts';
    });
    await expect(page.getByRole('button', { name: '연결한 증권사 모두' })).toBeVisible();
    // NAVER, 엔비디아(삼성전자는 이미 감시 중)
    await expect(page.getByText('새 종목 2개')).toBeVisible();
    await page.getByRole('button', { name: '연결한 증권사 모두' }).click();
    const dialog = page.getByRole('dialog', { name: /보유 종목 올리기/ });
    await expect(dialog.getByRole('checkbox', { name: /NAVER/ })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: /삼성전자/ })).toBeDisabled();
    await expect(dialog.getByText('이미 감시 중')).toBeVisible();
    await expect(dialog.getByText('감시 종목은 브리핑 작성 때 AI로 전송됩니다.')).toBeVisible();
    await shoot(page, 'upload-dialog');
    await dialog.getByRole('checkbox', { name: /엔비디아/ }).uncheck();
    await dialog.getByRole('button', { name: /감시 종목에 올리기/ }).click();
    await expect(page.getByText(/1종목을 감시 종목에 올렸습니다/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^NAVER/ })).toBeVisible();
    // 체크하지 않은 엔비디아는 올리지 않았지만 다시 새 종목으로 세지 않는다
    await expect(page.getByText(/새 종목/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^엔비디아/ })).toHaveCount(0);
  });

  await test.step('내 보유: 주가 그래프와 카드, 칩 전환을 기억한다', async () => {
    await page.evaluate(() => {
      location.hash = '#/symbols/KR/005930';
    });
    const card = page.getByRole('region', { name: '내 보유' });
    await expect(page.getByRole('img', { name: /삼성전자 일봉 종가/ })).toBeVisible();
    await expect(card.getByText('총 15주 · 평단가 64,000원')).toBeVisible();
    await expect(card.getByText('1,071,000원')).toBeVisible();
    await expect(card.getByText('+111,000원 (+11.56%)')).toBeVisible();
    await expect(card.getByRole('button', { name: '키움 10주' })).toBeVisible();
    await expect(card.getByRole('button', { name: '메리츠 5주' })).toBeVisible();
    await shoot(page, 'my-holdings');
    await card.getByRole('button', { name: '키움 10주' }).click();
    await expect(card.getByRole('button', { name: '키움 66.7%' })).toBeVisible();
    await expect(card.getByRole('button', { name: '메리츠 33.3%' })).toBeVisible();
    // 견본 자료는 새로 고치면 처음으로 돌아가므로, 화면을 떠났다 돌아와 기억을 본다
    await page.evaluate(() => {
      location.hash = '#/alerts';
    });
    await expect(page.getByRole('button', { name: '연결한 증권사 모두' })).toBeVisible();
    await page.evaluate(() => {
      location.hash = '#/symbols/KR/005930';
    });
    await expect(
      page.getByRole('region', { name: '내 보유' }).getByRole('button', { name: '키움 66.7%' }),
    ).toBeVisible();
  });

  await test.step('해제: 키움 연결을 끊고 데이터를 지우면 합계에서 빠진다', async () => {
    await page.evaluate(() => {
      location.hash = '#/settings';
    });
    const conns = page.getByRole('region', { name: '증권사 연결' });
    await conns.getByRole('button', { name: /^키움 키 [0-9a-f]{4} 연결 해제$/ }).click();
    const dialog = page.getByRole('dialog', { name: '키움 연결 해제' });
    await expect(dialog.getByText(/기존 데이터를 삭제할까요/)).toBeVisible();
    await expect(
      dialog.getByText(/자산 추이의 지난 기록과 감시 종목·규칙은 남습니다/),
    ).toBeVisible();
    await dialog.getByRole('button', { name: '데이터 삭제' }).click();
    await expect(
      conns.getByRole('list', { name: '연결한 증권사' }).getByRole('listitem'),
    ).toHaveCount(1);
    await page.evaluate(() => {
      location.hash = '#/symbols/KR/005930';
    });
    const card = page.getByRole('region', { name: '내 보유' });
    await expect(card.getByText('총 5주 · 평단가 64,000원')).toBeVisible();
    await expect(card.getByRole('button', { name: /키움/ })).toHaveCount(0);
  });
});

test('대시보드 칸: 내 보유 종목과 자산 추이, 총 평가금액', async ({ page }) => {
  await page.goto('/mock.html?brokers=1#/settings');
  await connectKey(page, '키움');
  await page.evaluate(() => {
    location.hash = '#/home';
  });
  await page.getByRole('button', { name: '배치 편집' }).click();
  for (const [n, label] of [
    [3, '내 보유 종목'],
    [4, '자산 추이'],
  ] as const) {
    await page.getByRole('button', { name: `칸 ${n} 내용 바꾸기` }).click();
    const picker = page.getByRole('dialog', { name: `칸 ${n}에 보여 줄 내용` });
    await picker.getByRole('button', { name: new RegExp(`^${label}`) }).click();
  }
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('region', { name: '칸 3: 내 보유 종목' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: '칸 3: 내 보유 종목' }).getByRole('row', { name: /삼성전자/ }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: '칸 4: 자산 추이' })
      .getByRole('img', { name: /주식 평가금액/ }),
  ).toBeVisible();
  await shoot(page, 'dashboard-holdings');
});
