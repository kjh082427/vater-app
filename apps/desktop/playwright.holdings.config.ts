import { defineConfig } from '@playwright/test';

// v2 보유 흐름 테스트: 사이드카 없이 견본 자료(mock.html, 흉내 증권사 서버)로 돈다. 실행: npm run e2e:holdings
// 실제 증권사·AI는 부르지 않는다. 화면 캡처는 VATER_SHOTS_DIR=<폴더>를 주면 그 폴더에만 저장한다.
export default defineConfig({
  testDir: './e2e',
  testMatch: /holdings\.spec\.ts/,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    url: 'http://localhost:5174/mock.html',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  use: {
    baseURL: 'http://localhost:5174',
    viewport: { width: 1280, height: 800 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  },
});
