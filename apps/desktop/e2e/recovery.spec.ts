/**
 * 엔진 프로세스 강제 종료 뒤 복구 e2e(`recovery` 프로젝트: playwright.config.ts 가 다른 스펙이 모두 끝난 뒤 혼자 돌린다).
 * 엔진은 utility process 에 살므로 `app.getAppMetrics()` 로 pid 를 찾아 SIGKILL 하고, 렌더러가 `shEngine.onCrashed` 를 받고
 * 재시작된 엔진이 다른 pid 로 다시 응답하는지 본다.
 * 과거 사고(todo P3): 전체 스위트에서 CPU 경합 때 120초 타임아웃. 원인 후보 둘을 함께 막는다.
 *  1. 알림 리스너 등록(page.evaluate)을 기다리지 않고 바로 kill 해 알림을 놓칠 수 있었다. 등록을 먼저 끝내고 죽인다.
 *  2. 알림 대기가 무한이었다. 상한(CRASH_NOTICE_MS)을 두고 안 오면 현재 엔진 pid 를 다시 죽인다(최대 KILL_ATTEMPTS 회).
 * 단계마다 경과 시간을 로그로 남겨 실패 보고에서 어디서 멈췄는지 보이게 한다.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

const APP_DIR = resolve(__dirname, '..');
const OUT_MAIN = join(APP_DIR, 'out', 'main', 'index.js');
const APP_VERSION = (JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')) as { version: string }).version;

/** 문제 보고 파일(src/main/crash-report.ts 의 CrashReport) 중 이 테스트가 보는 부분 */
interface CrashReportFile {
  schema: number;
  app: { name: string; version: string };
  engine: { version: string | null };
  os: { platform: string; electron: string };
  exit: { code: number; signal: string | null };
  crashes: { total: number };
  recentCommands: Array<{ id: string; ok: boolean; at: number; ms: number }>;
  recentEdits: Array<{ id: string; ok: boolean; at: number; ms: number }>;
  memory: { main: { rss: number }; system: { total: number } };
}

/** 크래시 알림을 기다리는 상한(한 번의 kill 마다) */
const CRASH_NOTICE_MS = 20_000;
const KILL_ATTEMPTS = 3;

type CrashWindow = Window & {
  shEngine: { version(): Promise<string>; onCrashed(cb: (i: { code: number }) => void): () => void };
  __shCrash?: Promise<number>;
};

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

test.beforeAll(() => {
  if (!existsSync(OUT_MAIN)) throw new Error(`빌드된 앱이 없습니다: ${OUT_MAIN} (npm run build -w apps/desktop)`);
});

function enginePids(app: ElectronApplication): Promise<number[]> {
  return app.evaluate(({ app: a }) =>
    a
      .getAppMetrics()
      .filter((m) => m.type === 'Utility' && (m.name ?? '').includes('engine'))
      .map((m) => m.pid),
  );
}

async function makeDemoSequence(page: Page): Promise<void> {
  await page.getByRole('button', { name: '데모 영상', exact: true }).click();
  await page.getByRole('menuitem', { name: '바다 노을' }).click();
  // 복구가 빠르면(1초대) 크래시 전 토스트가 아직 떠 있어 둘이 될 수 있다. 마지막 것만 본다
  await expect(page.getByRole('status').filter({ hasText: '데모 영상을 넣었습니다' }).last()).toBeVisible();
  await page.getByRole('button', { name: '타임라인에 넣기', exact: true }).click();
  await expect(page.locator('.tl-clip')).toHaveCount(2);
  await expect(page.getByTestId('mon-total')).toHaveText('00:00:18:00');
}

test('엔진 프로세스를 강제 종료하면 렌더러가 알림을 받고 재시작된 엔진이 다시 응답한다', async () => {
  const t0 = Date.now();
  const log = (msg: string) => console.log(`[recovery +${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
  const userData = mkdtempSync(join(tmpdir(), 'sh-video-editor-e2e-recovery-'));
  const app = await electron.launch({
    args: [APP_DIR, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
    env: { ...process.env, SH_SMOKE: '', SH_BENCH: '' },
    timeout: 60_000,
  });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.ve-status')).toContainText(/준비됨: 커맨드 \d+개/, { timeout: 60_000 });
    log('앱 준비됨');
    await makeDemoSequence(page);
    log('데모 시퀀스 생성');

    const before = await enginePids(app);
    expect(before).toHaveLength(1);
    log(`엔진 pid ${before[0]}`);

    // 1. 알림 리스너를 먼저 등록하고(등록이 끝난 뒤에 kill) 결과는 window 에 둔다
    await page.evaluate(() => {
      const w = window as unknown as CrashWindow;
      w.__shCrash = new Promise<number>((resolveCode) => w.shEngine.onCrashed((i) => resolveCode(i.code)));
    });
    log('onCrashed 리스너 등록');

    // 2. kill 뒤 상한 안에 알림이 오지 않으면 현재 엔진 pid 를 다시 죽인다
    let code: number | null = null;
    for (let attempt = 1; attempt <= KILL_ATTEMPTS && code === null; attempt += 1) {
      const pids = await enginePids(app);
      const target = pids[0];
      if (target === undefined) throw new Error('엔진 utility process 가 없습니다');
      log(`SIGKILL ${attempt}/${KILL_ATTEMPTS}: pid ${target}`);
      process.kill(target, 'SIGKILL');
      code = await page.evaluate(
        ({ ms }) =>
          Promise.race([
            (window as unknown as CrashWindow).__shCrash as Promise<number>,
            new Promise<null>((resolveNull) => setTimeout(() => resolveNull(null), ms)),
          ]),
        { ms: CRASH_NOTICE_MS },
      );
      log(code === null ? `알림 없음(${CRASH_NOTICE_MS}ms), 엔진 pid 지금 ${JSON.stringify(await enginePids(app))}` : `크래시 알림 code=${code}`);
    }
    expect(typeof code, 'onCrashed 알림을 받지 못했다').toBe('number');

    // 재시작된 엔진이 다른 pid 로 응답한다
    await expect.poll(() => enginePids(app), { timeout: 20_000 }).not.toEqual(before);
    log(`재시작된 엔진 pid ${JSON.stringify(await enginePids(app))}`);
    const version = await page.evaluate(() => (window as unknown as CrashWindow).shEngine.version());
    expect(version).toContain('sh-video-engine');
    log('새 엔진 version 응답');

    // 문제 보고 파일(M4-6): <userData>/crash-reports/YYYY-MM-DD-HHMMSS.json 하나. 종료 코드·버전·마지막 커맨드가 들어 있다
    const reportDir = join(userData, 'crash-reports');
    await expect.poll(() => (existsSync(reportDir) ? readdirSync(reportDir).filter((f) => f.endsWith('.json')) : []), { timeout: 10_000 }).toHaveLength(1);
    const reportName = readdirSync(reportDir).find((f) => f.endsWith('.json'))!;
    expect(reportName).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}\.json$/);
    const report = JSON.parse(readFileSync(join(reportDir, reportName), 'utf8')) as CrashReportFile;
    expect(report.schema).toBe(1);
    expect(report.app.version).toBe(APP_VERSION);
    expect(report.engine.version).toContain('sh-video-engine');
    expect(report.os.platform).toBe(process.platform);
    expect(report.exit.code).toBe(code);
    if (process.platform !== 'win32') expect(report.exit.signal).toBe('SIGKILL');
    expect(report.crashes.total).toBe(1);
    expect(report.memory.main.rss).toBeGreaterThan(0);
    expect(report.memory.system.total).toBeGreaterThan(0);
    // 전체 마지막 20개는 화면의 읽기(inspect 류)로 차므로 편집 흐름은 recentEdits 에서 본다
    const ids = report.recentCommands.map((c) => c.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(20);
    const edits = report.recentEdits.map((c) => c.id);
    expect(edits).toContain('file.importDemoFootage');
    // "타임라인에 넣기" 는 편집본을 클립으로 만든다(file.newSequence fromItem, features/onboarding/edition.ts)
    expect(edits).toContain('file.newSequence');
    expect(edits.some((id) => /\.(inspect|list|items|status)$/.test(id))).toBe(false);
    expect(report.recentEdits.length).toBeLessThanOrEqual(20);
    for (const c of [...report.recentCommands, ...report.recentEdits]) {
      expect(typeof c.ok).toBe('boolean');
      expect(c.ms).toBeGreaterThanOrEqual(0);
      expect(c.at).toBeGreaterThan(0);
    }
    log(`문제 보고 파일 ${reportName}: 커맨드 ${ids.length}개, 편집 ${edits.length}개, 종료 코드 ${report.exit.code}`);

    // 토스트에 "폴더 열기" 버튼이 붙는다(누르면 OS 탐색기가 열리므로 여기서는 닫기만)
    const toast = page.getByRole('status').filter({ hasText: '문제 보고 파일을 남겼습니다' });
    await expect(toast).toBeVisible({ timeout: 20_000 });
    await expect(toast.getByRole('button', { name: '폴더 열기' })).toBeVisible();
    await toast.getByRole('button', { name: '알림 닫기' }).click();
    // 도움말 메뉴에도 폴더 열기 항목이 있다(데스크톱만)
    await page.getByRole('menubar').getByRole('button', { name: '도움말' }).click();
    await expect(page.getByRole('menuitem', { name: '문제 보고 폴더 열기' })).toBeVisible();
    await page.keyboard.press('Escape');
    log('문제 보고 토스트·메뉴 확인');

    // 화면은 살아 있고(새 엔진은 빈 세션) 다시 편집할 수 있다
    await expect(page.getByRole('menubar')).toBeVisible();
    await expect(page.getByText('타임라인이 비어 있습니다. 미디어를 타임라인에 넣으면 여기에 보입니다.')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.ve-status')).not.toContainText('오류:', { timeout: 20_000 });
    log('화면이 빈 세션으로 복구됨');
    await makeDemoSequence(page);
    await expect(page.locator('.mon-canvas')).toBeVisible();
    log('재편집 성공');
  } finally {
    await app.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true });
  }
});
