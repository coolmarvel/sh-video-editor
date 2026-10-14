/**
 * 데스크톱 사용자 템플릿 e2e: 데모 편집본을 템플릿으로 저장하면 userData/templates/<id>.json 과 <id>.png(플레이헤드 썸네일)가 생기고,
 * 다시 띄운 앱의 "내 템플릿" 에 보인다. userData 는 테스트마다 새 디렉토리.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

const APP_DIR = resolve(__dirname, '..');
const OUT_MAIN = join(APP_DIR, 'out', 'main', 'index.js');

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

test('편집본을 템플릿으로 저장하면 userData/templates 에 JSON 과 PNG 가 생기고 다시 띄워도 보인다', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'sh-video-editor-templates-'));
  const dir = join(userData, 'templates');
  const { app, page } = await launch(userData);
  try {
    await page.getByRole('button', { name: '데모 영상', exact: true }).click();
    await page.getByRole('menuitem', { name: '바다 노을' }).click();
    await expect(page.getByRole('status').filter({ hasText: '데모 영상을 넣었습니다' })).toBeVisible();
    await page.getByRole('button', { name: '타임라인에 넣기', exact: true }).click();
    await expect(page.locator('.tl-clip')).toHaveCount(2);
    const media = page.getByRole('region', { name: '미디어' });
    await media.getByRole('tab', { name: '템플릿' }).click();
    const gallery = page.getByTestId('template-gallery');
    await gallery.getByRole('button', { name: '지금 편집본을 템플릿으로 저장' }).click();
    const dialog = page.getByRole('dialog', { name: '편집본을 템플릿으로 저장' });
    await dialog.getByLabel('이름').fill('데스크톱 틀');
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(page.getByRole('status').filter({ hasText: '템플릿 "데스크톱 틀" 을 저장했습니다' })).toBeVisible({ timeout: 30_000 });
    await expect(gallery.locator('.tpl-card--user')).toHaveCount(1);

    const files = readdirSync(dir);
    const json = files.find((f) => f.endsWith('.json'));
    expect(json, `templates 디렉토리: ${files.join(', ')}`).toBeDefined();
    const id = json!.slice(0, -'.json'.length);
    expect(files).toContain(`${id}.png`);
    const saved = JSON.parse(readFileSync(join(dir, json!), 'utf8')) as { format: string; name: string; slots: unknown[]; settings: { width: number } };
    expect(saved).toMatchObject({ format: 'sh-video-editor-template', name: '데스크톱 틀', settings: { width: 1920 } });
    expect(saved.slots).toHaveLength(1);
    // PNG 시그니처
    expect(Array.from(readFileSync(join(dir, `${id}.png`)).subarray(0, 4))).toEqual([137, 80, 78, 71]);

    await page.reload();
    await expect(page.locator('.ve-status')).toContainText(/준비됨: 커맨드 \d+개/, { timeout: 60_000 });
    await page.getByRole('region', { name: '미디어' }).getByRole('tab', { name: '템플릿' }).click();
    const card = page.getByTestId('template-gallery').locator('.tpl-card--user');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('데스크톱 틀');
    await expect(card.locator('img.tpl-card__pic--thumb')).toHaveCount(1);
  } finally {
    await app.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true });
  }
});
