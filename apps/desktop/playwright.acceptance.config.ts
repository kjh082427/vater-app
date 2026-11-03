import { defineConfig } from '@playwright/test';

// 4단계 확인 U(화면 ↔ 실제 사이드카 프로세스). 실행: npm run e2e:acceptance
// 흐름 테스트(playwright.config.ts, 5173)와 겹치지 않게 Vite는 5183에서 띄우고, 파일 이름은 *.accept.ts로 둔다.
export default defineConfig({
  testDir: './e2e/acceptance',
  testMatch: '**/*.accept.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  webServer: {
    command: 'npx vite --port 5183 --strictPort',
    url: 'http://localhost:5183/',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  use: {
    viewport: { width: 1280, height: 800 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    // 화면(tauri.localhost, 가로챈 응답)에서 127.0.0.1 사이드카로: Chromium 로컬 네트워크 접근 허용
    permissions: ['local-network-access'],
  },
});
