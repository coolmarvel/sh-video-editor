/**
 * 웹 e2e(Playwright). `vite build` 뒤 `vite preview` 를 webServer 로 띄워 실제 Chromium 에서 화면과 wasm 엔진을
 * 함께 검증한다. 데스크톱(1440)과 모바일(390) 두 뷰포트. 네트워크는 localhost 만 쓴다.
 * 실행: 루트에서 `npm run test:e2e:web` (크로미움: `npx playwright install chromium`).
 */
import { defineConfig, devices } from '@playwright/test';

// 다른 작업 트리의 e2e 와 겹치지 않게 포트를 바꿀 수 있다: SH_E2E_PORT=4185 npx playwright test ...
const PORT = Number(process.env['SH_E2E_PORT'] ?? 4175);

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: './e2e/.results',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'ko-KR',
  },
  projects: [
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'mobile-390',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true },
    },
  ],
  webServer: {
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
    cwd: import.meta.dirname,
  },
});
