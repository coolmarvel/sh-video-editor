/**
 * 웹 e2e(Playwright). `vite build` 뒤 `vite preview` 를 webServer 로 띄워 실제 Chromium 에서 화면과 wasm 엔진을
 * 함께 검증한다. 데스크톱(1440)과 모바일(390) 두 뷰포트. 네트워크는 localhost 만 쓴다.
 * 실행: 루트에서 `npm run test:e2e:web` (크로미움: `npx playwright install chromium`).
 * 포트: `SH_E2E_PORT` 가 있으면 그 포트, 없으면 빈 포트를 골라 같은 변수에 넣는다(워커 프로세스는 env 를 물려받아 같은 포트를 본다).
 * 재시도: CI 에서만 1회(flaky 감지: 리포트에 "flaky" 로 남는다). 로컬은 0.
 */
import { execFileSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';

/** 빈 TCP 포트 하나. 설정 파일은 동기로 읽히므로 자식 node 가 포트 0 으로 listen 해 번호를 돌려준다 */
function freePort(): number {
  const script = "const s=require('node:net').createServer();s.listen(0,()=>{process.stdout.write(String(s.address().port));s.close()})";
  return Number(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }).trim());
}

// 같은 기계에서 여러 워크트리가 동시에 e2e 를 돌릴 수 있게 포트를 자동으로 고른다. 고정하려면 SH_E2E_PORT=4175
if (!process.env['SH_E2E_PORT']) process.env['SH_E2E_PORT'] = String(freePort());
const PORT = Number(process.env['SH_E2E_PORT']);
const CI = Boolean(process.env['CI']);

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never', outputFolder: './e2e/.results/report' }]] : [['list']],
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
    // 포트를 직접 준 경우에만 떠 있는 서버를 재사용하게 된다(자동 포트는 늘 비어 있다)
    reuseExistingServer: !CI,
    timeout: 180_000,
    cwd: import.meta.dirname,
  },
});
