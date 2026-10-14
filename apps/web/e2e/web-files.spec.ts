/**
 * 웹 파일 e2e(1440 과 390): 브라우저 안(OPFS) 저장 -> 새로고침 -> 최근 프로젝트에서 열기(클립 수 같음), 파일 메뉴 최근 프로젝트,
 * 내 컴퓨터로 받기(다운로드), 내보내기 -> 다운로드 이벤트로 mp4 바이트 > 0, 자동 저장 스냅샷 -> 새로고침 -> 복구 제안 -> 복구 -> 저장.
 */
import { statSync } from 'node:fs';
import { clickRuler, expect, makeDemoSequence, test, toasts, ui } from './fixtures';

async function saveInBrowser(app: Parameters<typeof makeDemoSequence>[0], name: string): Promise<void> {
  await app.keyboard.press('Control+s');
  const dialog = app.getByRole('dialog', { name: '브라우저에 저장' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('이름').fill(name);
  await dialog.getByRole('button', { name: '브라우저에 저장' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(toasts(app).filter({ hasText: `브라우저 안에 저장했습니다: ${name}` })).toBeVisible();
}

test.describe('웹 파일', () => {
  test('브라우저에 저장하고 새로고침한 뒤 최근 프로젝트에서 열면 같은 클립 수', async ({ app }) => {
    await makeDemoSequence(app);
    await saveInBrowser(app, '웹 저장 테스트');
    await expect(app.locator('.ve-status')).toContainText('웹 저장 테스트');
    await expect(app.locator('.ve-status')).toContainText('저장됨');
    await expect.poll(() => app.title()).toBe('웹 저장 테스트 - SH Video Editor');

    await app.reload();
    await expect(app.locator('.ve-status')).toContainText(/준비됨: 커맨드 \d+개/, { timeout: 60_000 });
    const recent = ui.timeline(app).getByLabel('최근 프로젝트');
    await expect(recent).toBeVisible();
    await expect(recent.getByRole('button', { name: /웹 저장 테스트/ })).toBeVisible();
    // 파일 메뉴 하위 메뉴에도 같은 항목
    await app.getByRole('menubar').getByRole('button', { name: '파일' }).click();
    await app.getByRole('menuitem', { name: '최근 프로젝트' }).click();
    await expect(app.getByRole('menu', { name: '최근 프로젝트' }).getByRole('menuitem', { name: '웹 저장 테스트' })).toBeVisible();
    await app.keyboard.press('Escape');
    await app.keyboard.press('Escape');
    await expect(app.getByRole('menu')).toHaveCount(0);

    await recent.getByRole('button', { name: /웹 저장 테스트/ }).click();
    await expect(toasts(app).filter({ hasText: '열었습니다: 웹 저장 테스트' })).toBeVisible();
    await expect(ui.clips(app)).toHaveCount(2);
    await expect(ui.total(app)).toHaveText('00:00:16:00');
    await expect(app.getByRole('dialog')).toHaveCount(0);
  });

  test('열기 대화상자는 브라우저 안 목록을 보이고, 내 컴퓨터로 받기는 .fcproj 를 내려받는다', async ({ app }) => {
    await makeDemoSequence(app);
    await saveInBrowser(app, '목록용');
    await app.keyboard.press('Control+o');
    const open = app.getByRole('dialog', { name: '프로젝트 열기' });
    await expect(open).toBeVisible();
    await expect(open.getByRole('table', { name: '브라우저 안 프로젝트' })).toContainText('목록용');
    await open.getByRole('button', { name: '취소' }).click();
    await expect(open).toHaveCount(0);

    await app.keyboard.press('Control+Shift+s');
    const save = app.getByRole('dialog', { name: '브라우저에 저장' });
    await expect(save.getByLabel('이름')).toHaveValue('목록용');
    const download = app.waitForEvent('download');
    await save.getByRole('button', { name: '내 컴퓨터로 받기' }).click();
    const dl = await download;
    expect(dl.suggestedFilename()).toBe('목록용.fcproj');
    const path = await dl.path();
    expect(statSync(path).size).toBeGreaterThan(0);
    await expect(save).toHaveCount(0);
  });

  test('내보내기는 끝나면 mp4 를 다운로드한다', async ({ app }) => {
    test.setTimeout(240_000);
    await makeDemoSequence(app);
    // wasm 소프트웨어 인코드는 느리므로 약 2초(60px/s 줌에서 120px)만 남기고 지운다
    await clickRuler(app, 120);
    await ui.tool(app, '자르기').click();
    await expect(ui.clips(app)).toHaveCount(4);
    await ui.videoClips(app).nth(1).click();
    await ui.tool(app, '삭제').click();
    await expect(ui.clips(app)).toHaveCount(2);
    await app.keyboard.press('Control+m');
    const dialog = app.getByRole('dialog', { name: '내보내기' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('파일 이름')).toHaveValue('제목 없음.mp4');
    await expect(dialog.getByRole('button', { name: '찾아보기' })).toHaveCount(0);
    await expect(dialog).not.toContainText('준비 중');
    await dialog.getByLabel('프리셋', { exact: true }).selectOption('720p');
    await expect(dialog).toContainText(/1280 x 720, [\d.]+ fps, [0-3]\.\d초/);
    const download = app.waitForEvent('download', { timeout: 200_000 });
    await dialog.getByRole('button', { name: '내보내기' }).click();
    await expect(dialog.getByRole('progressbar')).toBeVisible();
    const dl = await download;
    expect(dl.suggestedFilename()).toBe('제목 없음.mp4');
    const path = await dl.path();
    expect(statSync(path).size).toBeGreaterThan(0);
    await expect(dialog.getByRole('status').filter({ hasText: '내보냈습니다: 제목 없음.mp4' })).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('button', { name: '닫기' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('자동 저장 스냅샷은 새로고침 뒤 복구 후보로 제안되고, 복구 뒤 저장은 원래 이름으로 간다', async ({ app }) => {
    await makeDemoSequence(app);
    await expect(app.locator('.ve-status').getByTitle('자동 저장 켜짐')).toBeVisible();
    // 30초를 기다리지 않고 한 주기를 바로 돌린다(QA 훅)
    const snapped = await app.evaluate(() => (window as unknown as { shWebAutosaveTick: () => Promise<boolean> }).shWebAutosaveTick());
    expect(snapped).toBe(true);

    await app.reload();
    await expect(app.locator('.ve-status')).toContainText(/준비됨: 커맨드 \d+개/, { timeout: 60_000 });
    const recovery = app.getByRole('dialog', { name: '저장하지 않은 변경 복구' });
    await expect(recovery).toBeVisible({ timeout: 20_000 });
    await expect(recovery).toContainText("'제목 없음' 의 저장하지 않은 변경");
    await recovery.getByRole('button', { name: '복구' }).click();
    await expect(recovery).toHaveCount(0);
    await expect(toasts(app).filter({ hasText: '되살렸습니다' })).toBeVisible();
    await expect(ui.clips(app)).toHaveCount(2);

    await app.keyboard.press('Control+s');
    const save = app.getByRole('dialog', { name: '브라우저에 저장' });
    await expect(save.getByLabel('이름')).toHaveValue('제목 없음');
    await save.getByLabel('이름').fill('복구본');
    await save.getByRole('button', { name: '브라우저에 저장' }).click();
    await expect(save).toHaveCount(0);
    await expect(app.locator('.ve-status')).toContainText('복구본');

    // 저장했으니 다음 새로고침에는 복구를 묻지 않는다
    await app.reload();
    await expect(app.locator('.ve-status')).toContainText(/준비됨: 커맨드 \d+개/, { timeout: 60_000 });
    await expect(
      ui
        .timeline(app)
        .getByLabel('최근 프로젝트')
        .getByRole('button', { name: /복구본/ }),
    ).toBeVisible();
    await expect(app.getByRole('dialog')).toHaveCount(0);
  });
});
