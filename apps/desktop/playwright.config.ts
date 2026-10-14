/**
 * 데스크톱 e2e(Playwright `_electron`). 빌드된 앱(out/)을 띄워 창·엔진 utility process·메뉴·편집·내보내기 대화상자·
 * 엔진 프로세스 강제 종료 뒤 복구를 검증한다. 헤드리스 환경에서는 xvfb-run 으로 감싼다.
 * 실행: 루트에서 `npm run test:e2e:desktop` (먼저 `npm run build -w apps/desktop`).
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: './e2e/.results',
  use: { trace: 'retain-on-failure' },
});
