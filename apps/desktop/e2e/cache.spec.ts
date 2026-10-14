/**
 * 데스크톱 캐시·최근 프로젝트 e2e: 앱을 띄우면 userData/cache.sqlite 가 생기고, preload 의 cache API 로 기록한 최근 프로젝트가
 * 다시 띄운 화면의 안내 카드와 파일 메뉴에 보인다. userData 는 테스트마다 새 디렉토리.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

const APP_DIR = resolve(__dirname, '..');
const OUT_MAIN = join(APP_DIR, 'out', 'main', 'index.js');

interface CacheApi {
  recentProjects(limit?: number): Promise<Array<{ path: string; name: string; openedAt: number }>>;
  touchProject(path: string, name: string): Promise<void>;
  getThumb(key: { path: string; tick: number; width: number }): Promise<Uint8Array | null>;
  putThumb(key: { path: string; tick: number; width: number }, png: Uint8Array): Promise<void>;
}
type Win = { shEngine: { cache: CacheApi; execute(id: string, params?: string): Promise<string> } };

async function launch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [APP_DIR, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
    env: { ...process.env, SH_SMOKE: '', SH_BENCH: '' },
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  await expect(page.locator('.ve-status')).toContainText(/준비됨: 커맨드 \d+개/, { timeout: 60_000 });
  return { app, page };
}

test.beforeAll(() => {
  if (!existsSync(OUT_MAIN)) throw new Error(`빌드된 앱이 없습니다: ${OUT_MAIN} (npm run build -w apps/desktop)`);
});

test('cache.sqlite 가 생기고 최근 프로젝트가 안내 카드와 파일 메뉴에 보인다', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'sh-video-editor-cache-'));
  const { app, page } = await launch(userData);
  try {
    expect(existsSync(join(userData, 'cache.sqlite'))).toBe(true);
    // 실제 저장: 엔진 file.saveAs 는 OS 경로에 쓴다. 최근 기록은 화면 흐름(파일 대화상자)을 거치므로 여기서는 preload API 로 직접 기록한다
    const projectPath = join(userData, '최근 테스트.fcproj');
    await page.evaluate(
      async ({ path }) => {
        const w = window as unknown as Win;
        await w.shEngine.execute('file.saveAs', JSON.stringify({ path }));
        await w.shEngine.cache.touchProject(path, '최근 테스트');
      },
      { path: projectPath },
    );
    expect(existsSync(projectPath)).toBe(true);
    // 썸네일 캐시 왕복(경로 + mtime 키)
    writeFileSync(join(userData, 'fake.mp4'), 'x');
    const roundTrip = await page.evaluate(
      async ({ path }) => {
        const w = window as unknown as Win;
        const key = { path, tick: -1, width: 96 };
        await w.shEngine.cache.putThumb(key, new Uint8Array([137, 80, 78, 71, 1, 2, 3]));
        const back = await w.shEngine.cache.getThumb(key);
        return back ? Array.from(back) : null;
      },
      { path: join(userData, 'fake.mp4') },
    );
    expect(roundTrip).toEqual([137, 80, 78, 71, 1, 2, 3]);

    await page.reload();
    await expect(page.locator('.ve-status')).toContainText(/준비됨: 커맨드 \d+개/, { timeout: 60_000 });
    const recent = page.getByRole('region', { name: '타임라인' }).getByLabel('최근 프로젝트');
    await expect(recent.getByRole('button', { name: /최근 테스트/ })).toBeVisible();
    await page.getByRole('menubar').getByRole('button', { name: '파일' }).click();
    await page.getByRole('menuitem', { name: '최근 프로젝트' }).click();
    await expect(page.getByRole('menu', { name: '최근 프로젝트' }).getByRole('menuitem', { name: '최근 테스트' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await recent.getByRole('button', { name: /최근 테스트/ }).click();
    await expect(page.locator('.ve-toasts')).toContainText('열었습니다: 최근 테스트');
    await expect(page.locator('.ve-status')).toContainText('최근 테스트');
  } finally {
    await app.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true });
  }
});
