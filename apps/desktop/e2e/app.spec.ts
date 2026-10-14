/**
 * 데스크톱 앱 e2e. 앱마다 새 userData 디렉토리를 써서 실제 사용자 데이터(자동 저장·복구 저널)를 건드리지 않는다.
 * 엔진 프로세스 강제 종료 뒤 복구는 recovery.spec.ts(`recovery` 프로젝트, 모든 스펙 뒤에 혼자 돈다).
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

const APP_DIR = resolve(__dirname, '..');
const OUT_MAIN = join(APP_DIR, 'out', 'main', 'index.js');

interface Ctx {
  app: ElectronApplication;
  page: Page;
  userData: string;
  errors: string[];
}

async function launch(): Promise<Ctx> {
  const userData = mkdtempSync(join(tmpdir(), 'sh-video-editor-e2e-'));
  const app = await electron.launch({
    args: [APP_DIR, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
    env: { ...process.env, SH_SMOKE: '', SH_BENCH: '' },
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await expect(page.locator('.ve-status')).toContainText(/준비됨: 커맨드 \d+개/, { timeout: 60_000 });
  return { app, page, userData, errors };
}

async function close(ctx: Ctx): Promise<void> {
  await ctx.app.close().catch(() => undefined);
  rmSync(ctx.userData, { recursive: true, force: true });
}

const status = (page: Page) => page.locator('.ve-status .sh-pane').first();
const clips = (page: Page) => page.locator('.tl-clip');
const videoClips = (page: Page) => page.locator('.tl-lane--video .tl-clip');
const tool = (page: Page, name: string) => page.getByRole('toolbar', { name: '타임라인 도구' }).getByRole('button', { name, exact: true });

async function makeDemoSequence(page: Page): Promise<void> {
  await page.getByRole('button', { name: '데모 영상', exact: true }).click();
  await page.getByRole('menuitem', { name: '바다 노을' }).click();
  await expect(page.getByRole('status').filter({ hasText: '데모 영상을 넣었습니다' })).toBeVisible();
  await page.getByRole('button', { name: '타임라인에 넣기', exact: true }).click();
  await expect(clips(page)).toHaveCount(2);
  // 바다 노을 데모는 18초
  await expect(page.getByTestId('mon-total')).toHaveText('00:00:18:00');
}

test.beforeAll(() => {
  if (!existsSync(OUT_MAIN)) throw new Error(`빌드된 앱이 없습니다: ${OUT_MAIN} (npm run build -w apps/desktop)`);
});

test('창 제목, 엔진 상태 줄, 데스크톱 호스트 기능', async () => {
  const ctx = await launch();
  try {
    const { app, page } = ctx;
    // 엔진의 기본 프로젝트 이름은 'Untitled' 다(화면의 '제목 없음' 과 다르다: 보고서의 UX 결함 참고)
    expect(await page.title()).toMatch(/^(Untitled|제목 없음) - SH Video Editor$/);
    const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
    expect(userData).toBe(ctx.userData);
    const windowTitle = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle());
    expect(windowTitle).toContain('SH Video Editor');
    await expect(page.locator('.ve-status')).toContainText('데스크톱');
    await expect(page.locator('.ve-version')).toContainText('sh-video-engine');
    await expect(page.locator('.ve-version')).not.toContainText('wasm');
    // 데스크톱만 있는 가져오기 버튼과 자동 저장 상태
    await expect(page.getByRole('button', { name: '가져오기', exact: true })).toBeVisible();
    await expect(page.locator('.ve-status').getByTitle('자동 저장 켜짐')).toBeVisible({ timeout: 15_000 });
    // 렌더러가 엔진 프로세스와 직접 이어져 있다
    const version = await page.evaluate(() => (window as unknown as { shEngine: { version(): Promise<string> } }).shEngine.version());
    expect(version).toContain('sh-video-engine');
    // 엔진 utility process: serviceName 은 node.mojom.NodeService, name 이 serviceName 옵션('SH Video Editor engine')
    const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, name: m.name ?? '', service: m.serviceName ?? '' })));
    expect(metrics.some((m) => m.type === 'Utility' && m.name === 'SH Video Editor engine')).toBe(true);
    expect(ctx.errors).toEqual([]);
  } finally {
    await close(ctx);
  }
});

test('메뉴바를 열고 닫고, 내보내기 대화상자가 열린다', async () => {
  const ctx = await launch();
  try {
    const { page } = ctx;
    const file = page.getByRole('menubar').getByRole('button', { name: '파일' });
    await file.click();
    await expect(page.getByRole('menu')).toBeVisible();
    const items = await page.getByRole('menuitem').allInnerTexts();
    expect(items.length).toBeGreaterThan(5);
    await file.click();
    await expect(page.getByRole('menu')).toHaveCount(0);

    await makeDemoSequence(page);
    await file.click();
    // 내보내기 항목(엔진 라벨 'Media…' 또는 한글화된 라벨)은 features/export 가 가로채 대화상자를 연다
    await page
      .getByRole('menuitem', { name: /Media|미디어 내보내기|내보내기/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: '내보내기' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('프리셋', { exact: true })).toBeVisible();
    // 기본 프리셋 5개 + SNS 프리셋(features/ratio)이 같은 콤보에 합쳐진다
    // 프리셋 목록은 엔진 응답(export.presets) 뒤에 채워진다. 부하가 높으면 늦으므로 폴링한다
    await expect.poll(() => dialog.getByLabel('프리셋', { exact: true }).locator('option').count()).toBeGreaterThanOrEqual(5);
    await expect(dialog.getByLabel('형식').locator('option')).toHaveCount(1);
    await expect(dialog).toContainText(/1920 x 1080, [\d.]+ fps, 18\.0초 \(\d+ 프레임\)/);
    await expect(dialog.getByRole('button', { name: '찾아보기' })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: '내보내기' })).toBeDisabled();
    await dialog.getByLabel('프리셋', { exact: true }).selectOption('720p');
    await expect(dialog).toContainText('1280 x 720');
    // Escape 는 대화상자 안에 포커스가 있을 때 닫힌다(대화상자 요소의 keydown)
    await dialog.getByLabel('프리셋', { exact: true }).press('Escape');
    await expect(dialog).toHaveCount(0);
    // Ctrl+M 단축키로도 열린다
    await page.keyboard.press('Control+m');
    await expect(page.getByRole('dialog', { name: '내보내기' })).toBeVisible();
    await page.getByRole('dialog', { name: '내보내기' }).getByRole('button', { name: '닫기' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(ctx.errors).toEqual([]);
  } finally {
    await close(ctx);
  }
});

test('데모 영상을 넣고 자르기·삭제·실행 취소', async () => {
  const ctx = await launch();
  try {
    const { page } = ctx;
    await makeDemoSequence(page);
    await expect(page.locator('.mon-canvas')).toBeVisible();
    const ruler = page.locator('.tl-ruler');
    await ruler.click({ position: { x: 150, y: 6 } });
    await expect(page.getByTestId('mon-current')).not.toHaveText('00:00:00:00');
    await tool(page, '자르기').click();
    await expect(status(page)).toHaveText('자르기: 2곳');
    await expect(clips(page)).toHaveCount(4);
    await videoClips(page).first().click();
    await expect(page.locator('.tl-clip.is-selected')).toHaveCount(2);
    await tool(page, '삭제').click();
    await expect(status(page)).toHaveText('삭제: 클립 2개');
    await expect(clips(page)).toHaveCount(2);
    await tool(page, '실행 취소').click();
    await expect(status(page)).toHaveText('실행 취소: Clear');
    await expect(clips(page)).toHaveCount(4);
    await expect(page.getByTestId('mon-total')).toHaveText('00:00:18:00');
    // 프로젝트 상태 줄이 수정됨으로 바뀌고 창 제목에도 반영된다
    await expect(page.locator('.ve-status')).toContainText('수정됨');
    await expect.poll(() => page.title()).toMatch(/^(Untitled|제목 없음) \(수정됨\) - SH Video Editor$/);
    expect(ctx.errors).toEqual([]);
  } finally {
    await close(ctx);
  }
});
