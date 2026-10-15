/**
 * 데스크톱 e2e(Playwright `_electron`). 빌드된 앱(out/)을 띄워 창·엔진 utility process·메뉴·편집·내보내기 대화상자·
 * 캐시·자동 자막 대화상자·엔진 프로세스 강제 종료 뒤 복구를 검증한다. 헤드리스 환경에서는 xvfb-run 으로 감싼다.
 * 실행: 루트에서 `npm run test:e2e:desktop` (먼저 `npm run build -w apps/desktop`).
 * 프로젝트: `app`(일반 스펙) 뒤에 `recovery`(엔진 강제 종료 복구, e2e/recovery.spec.ts)가 돈다. 복구 테스트는 CPU 경합에
 * 민감해 다른 앱 인스턴스가 모두 끝난 뒤 혼자 돌게 한다(`dependencies`). 복구만 보려면 `--project recovery --no-deps`.
 * 재시도: CI 에서만 1회(flaky 감지). 로컬은 0.
 */
import { defineConfig } from '@playwright/test';

const CI = Boolean(process.env['CI']);

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never', outputFolder: './e2e/.report' }]] : [['list']],
  outputDir: './e2e/.results',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'app', testIgnore: /recovery\.spec\.ts$/ },
    { name: 'recovery', testMatch: /recovery\.spec\.ts$/, dependencies: ['app'] },
  ],
});
