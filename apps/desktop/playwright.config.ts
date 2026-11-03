import { defineConfig } from '@playwright/test';

// 흐름 테스트(스펙 10장 UI 흐름): Vite 개발 서버 + 개발 모드 사이드카. 실행: npm run e2e
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    // 사이드카 CORS가 개발 모드에서 허용하는 출처(스펙 2-1)
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 800 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  },
});
