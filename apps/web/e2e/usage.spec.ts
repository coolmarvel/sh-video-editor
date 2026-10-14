/**
 * 사용법 문서 e2e(웹, 1440 과 390): 도움말 > 사용 안내가 docs/guides/usage.md 전체(목차 + 본문)를 대화상자로 보이고,
 * 목차 클릭으로 절이 이동하며, 첫 화면 안내 카드의 "자세히" 도 같은 대화상자를 연다. 390 폭에서는 목차가 위, 본문이 아래.
 */
import { expect, test, ui } from './fixtures';

async function openGuide(app: Parameters<typeof ui.timeline>[0]) {
  await app.getByRole('menubar').getByRole('button', { name: '도움말' }).click();
  await app.getByRole('menuitem', { name: '사용 안내' }).click();
  const dialog = app.getByRole('dialog', { name: '사용 안내' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('도움말 > 사용 안내', () => {
  test('사용법 문서 전체가 목차와 함께 열리고 목차 클릭으로 절이 이동한다', async ({ app }) => {
    const dialog = await openGuide(app);
    await expect(dialog.getByRole('heading', { level: 1, name: 'SH Video Editor 사용법' })).toBeVisible();
    const toc = dialog.getByRole('navigation', { name: '목차' });
    await expect(toc.getByRole('button', { name: '1. 5분 안에 첫 영상' })).toBeVisible();
    await expect(toc.getByRole('button', { name: '4. 단축키' })).toBeVisible();
    // 단축키 표가 문서 안에 그려진다(keymap.ts 와 같은 내용. 대조는 단위 테스트)
    const body = dialog.locator('.ve-usage__body');
    expect(await body.evaluate((el) => el.scrollTop)).toBe(0);

    await toc.getByRole('button', { name: '4. 단축키' }).click();
    await expect(toc.getByRole('button', { name: '4. 단축키' })).toHaveAttribute('aria-current', 'location');
    const heading = dialog.getByRole('heading', { level: 2, name: '4. 단축키' });
    await expect(heading).toBeInViewport();
    expect(await body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(dialog.getByRole('row', { name: 'Ctrl+K 플레이헤드에서 자르기 타임라인' })).toBeVisible();

    await toc.getByRole('button', { name: '6. 데스크톱과 웹의 차이' }).click();
    await expect(dialog.getByRole('heading', { level: 2, name: '6. 데스크톱과 웹의 차이' })).toBeInViewport();

    // 본문·대화상자가 뷰포트를 넘지 않는다(390 포함)
    const box = await dialog.boundingBox();
    const viewport = app.viewportSize();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(viewport!.width);
    expect(box!.height).toBeLessThanOrEqual(viewport!.height);
    expect(await app.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await dialog.getByRole('button', { name: '확인' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('첫 화면 안내 카드의 자세히 버튼이 같은 대화상자를 열고 Esc 로 닫힌다', async ({ app }) => {
    const card = ui.timeline(app).getByLabel('사용 안내');
    await card.getByRole('button', { name: '자세히' }).click();
    const dialog = app.getByRole('dialog', { name: '사용 안내' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { level: 1, name: 'SH Video Editor 사용법' })).toBeVisible();
    await app.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('좁은 화면에서는 목차가 본문 위에 놓인다', async ({ app }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', '390 폭에서만 본다');
    const dialog = await openGuide(app);
    const toc = await dialog.getByRole('navigation', { name: '목차' }).boundingBox();
    const body = await dialog.locator('.ve-usage__body').boundingBox();
    expect(toc && body && toc.y + toc.height <= body.y + 1).toBe(true);
    expect(toc && body && Math.abs(toc.x - body.x) < 2).toBe(true);
  });
});
