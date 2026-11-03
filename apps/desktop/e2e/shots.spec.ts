/**
 * 화면 캡처: VATER_SHOTS=1 npm run e2e -- shots
 * 견본 자료(mock.html)로 찍어 docs/design/screens/shots/에 저장한다(로컬 전용 design-preview/화면/에도 복사).
 * 창 1280×800·1024×600(배율 1)과 배율 1.5. 평소 흐름 테스트에서는 건너뛴다.
 */
import { expect, test, type Page } from '@playwright/test';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, '../../../docs/design/screens/shots');
// 저장소 밖(git 제외) 미리보기 폴더: 작업 트리(.claude/worktrees/…)에서 돌려도 본 저장소의 폴더에 둔다
const PREVIEW = resolve(import.meta.dirname, '../../../../../../design-preview/화면');
const ALT_PREVIEW = resolve(import.meta.dirname, '../../../design-preview/화면');

test.skip(process.env.VATER_SHOTS !== '1', '캡처는 VATER_SHOTS=1일 때만');

interface Shot {
  name: string;
  url: string;
  /** 다 그려졌는지 확인할 것. */
  ready: (page: Page) => Promise<void>;
  /** 찍기 전에 할 조작. */
  act?: (page: Page) => Promise<void>;
}

const visible = (fn: (page: Page) => ReturnType<Page['getByRole']>) => async (page: Page) => {
  await expect(fn(page).first()).toBeVisible();
};

const SHOTS: Shot[] = [
  {
    name: 'home',
    url: '/mock.html?running=1#/home',
    ready: visible((p) => p.getByRole('region', { name: '칸 4: 최근 알림' })),
  },
  {
    name: 'home-6',
    url: '/mock.html?six=1&running=1#/home?tab=six',
    ready: visible((p) => p.getByRole('region', { name: '칸 6: 지수 차트' })),
  },
  {
    name: 'home-edit',
    url: '/mock.html#/home',
    ready: visible((p) => p.getByRole('button', { name: '배치 편집' })),
    act: async (p) => {
      await p.getByRole('button', { name: '배치 편집' }).click();
      await expect(p.getByRole('region', { name: '배치 편집' })).toBeVisible();
    },
  },
  {
    name: 'home-pick',
    url: '/mock.html#/home',
    ready: visible((p) => p.getByRole('button', { name: '배치 편집' })),
    act: async (p) => {
      await p.getByRole('button', { name: '배치 편집' }).click();
      await p.getByRole('button', { name: '칸 1 내용 바꾸기' }).click();
      await expect(p.getByRole('dialog')).toBeVisible();
    },
  },
  {
    name: 'home-broken',
    url: '/mock.html?broken=1#/home',
    ready: visible((p) => p.getByText('저장된 화면 배치를 읽지 못해 기본 배치로 열었습니다.')),
  },
  {
    name: 'home-empty',
    url: '/mock.html?empty=1#/home',
    ready: visible((p) => p.getByText(/감시 종목이 없습니다/)),
  },
  {
    name: 'analyses',
    url: '/mock.html#/analyses',
    ready: visible((p) => p.getByRole('table', { name: '분석 이력' })),
  },
  {
    name: 'analysis-result',
    url: '/mock.html#/analyses/7',
    ready: visible((p) => p.getByRole('region', { name: 'AI 의견' })),
  },
  {
    name: 'analysis-running',
    url: '/mock.html?running=1#/analyses/40',
    ready: visible((p) => p.getByRole('region', { name: '진행' })),
  },
  {
    name: 'alerts',
    url: '/mock.html#/symbols/KR/005930',
    ready: visible((p) => p.getByRole('region', { name: '알림 이력' })),
  },
  {
    name: 'briefings',
    url: '/mock.html#/briefings',
    ready: visible((p) => p.getByRole('heading', { level: 1, name: '브리핑' })),
  },
  {
    name: 'briefing-kr',
    url: '/mock.html#/briefings/21',
    ready: visible((p) => p.getByRole('region', { name: '수급' })),
  },
  {
    name: 'settings',
    url: '/mock.html#/settings',
    ready: visible((p) => p.getByRole('region', { name: '분석 기본값' })),
  },
  {
    name: 'welcome',
    url: '/mock.html?nokey=1#/welcome',
    ready: visible((p) => p.getByRole('heading', { level: 2, name: 'Vater를 소개합니다' })),
  },
  {
    name: 'shell-offline',
    url: '/mock.html?offline=1#/home',
    ready: visible((p) => p.getByText('오프라인: 알림 감시 일시 중지')),
  },
];

function save(page: Page, file: string) {
  return page.screenshot({ path: `${OUT}/${file}` }).then(() => {
    for (const dir of [PREVIEW, ALT_PREVIEW]) {
      if (existsSync(resolve(dir, '..'))) {
        mkdirSync(dir, { recursive: true });
        copyFileSync(`${OUT}/${file}`, `${dir}/${file}`);
        break;
      }
    }
  });
}

for (const [w, h] of [
  [1280, 800],
  [1024, 600],
] as const) {
  test.describe(`${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });
    for (const shot of SHOTS) {
      test(shot.name, async ({ page }) => {
        await page.goto(shot.url);
        await shot.ready(page);
        await shot.act?.(page);
        await page.waitForTimeout(300);
        await save(page, `${shot.name}-${w}x${h}.png`);
      });
    }
  });
}

test.describe('배율 1.5', () => {
  test.use({ deviceScaleFactor: 1.5, viewport: { width: 1280, height: 800 } });
  for (const shot of SHOTS.filter((s) => ['home', 'home-edit', 'welcome'].includes(s.name))) {
    test(shot.name, async ({ page }) => {
      await page.goto(shot.url);
      await shot.ready(page);
      await shot.act?.(page);
      await page.waitForTimeout(300);
      await save(page, `${shot.name}-1280x800@1.5x.png`);
    });
  }
});
