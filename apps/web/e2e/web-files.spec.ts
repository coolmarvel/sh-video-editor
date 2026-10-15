/**
 * 웹 파일 e2e(1440 과 390): 브라우저 안(OPFS) 저장 -> 새로고침 -> 최근 프로젝트에서 열기(클립 수 같음), 파일 메뉴 최근 프로젝트,
 * 내 컴퓨터로 받기(다운로드), 내보내기 -> 다운로드 이벤트로 mp4 바이트 > 0, 자동 저장 스냅샷 -> 새로고침 -> 복구 제안 -> 복구 -> 저장,
 * 가져온 파일의 브라우저 안 보관(새로고침 뒤 다시 고르지 않고 그려짐, 열기 대화상자의 저장 공간 줄).
 * 큰 파일 실측은 SH_E2E_LARGE_MP4(경로)를 줄 때만 돈다(wasm 메모리·가져오기·탐색·보관 시간을 로그로 남긴다).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { clickRuler, expect, makeDemoSequence, test, toasts, ui } from './fixtures';

type Diag = {
  mediaIdle(): Promise<string | null>;
  wasmMemory(): Promise<number>;
  listFiles(): Promise<{ path: string; size: number; kind: string }[]>;
  ioStats(): Promise<{ rangeReads: number; blobReads: number; blobBytes: number; chunkHits: number; cacheBytes: number }>;
};
/** window.shBridge.diag 의 메서드 하나를 부른다 */
function diag<K extends keyof Diag>(page: Page, method: K): Promise<Awaited<ReturnType<Diag[K]>>> {
  return page.evaluate((m) => (window as unknown as { shBridge: { diag: Diag } }).shBridge.diag[m as K]() as Promise<never>, method);
}

/** 파일 > 미디어 가져오기... 로 고른다(브라우저 파일 선택) */
async function importViaMenu(app: Page, path: string): Promise<void> {
  const chooser = app.waitForEvent('filechooser');
  await app.getByRole('menubar').getByRole('button', { name: '파일' }).click();
  await app.getByRole('menuitem', { name: '미디어 가져오기...' }).click();
  await (await chooser).setFiles(path);
}

/** 모니터 평균 밝기와 색 있는 화소 비율 */
function canvasColor(page: Page): Promise<{ luma: number; colored: number }> {
  return page.locator('.mon-canvas').evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d');
    if (!ctx) return { luma: -1, colored: -1 };
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let luma = 0;
    let colored = 0;
    const n = c.width * c.height;
    for (let i = 0; i < n; i++) {
      const r = d[i * 4] ?? 0;
      const g = d[i * 4 + 1] ?? 0;
      const b = d[i * 4 + 2] ?? 0;
      luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 40) colored++;
    }
    return { luma: luma / n, colored: colored / n };
  });
}

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

  test.describe('가져온 파일 보관', () => {
    let dir = '';
    let clip = '';
    test.beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'sh-e2e-media-'));
      clip = join(dir, 'bars.mp4');
      execFileSync('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'smptebars=size=640x360:rate=30',
        '-t',
        '3',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        clip,
      ]);
    });
    test.afterAll(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    test('가져온 파일은 브라우저 안에 보관되어 새로고침 뒤 다시 고르지 않아도 그려진다', async ({ app }) => {
      await importViaMenu(app, clip);
      const item = app.getByRole('treeitem', { name: /bars\.mp4/ });
      await expect(item).toBeVisible({ timeout: 20_000 });
      await item.click();
      await app.getByRole('button', { name: '타임라인에 넣기', exact: true }).click();
      await expect(ui.videoClips(app)).toHaveCount(1);
      // 백그라운드 복사가 끝날 때까지
      expect(await diag(app, 'mediaIdle')).toBeNull();
      await saveInBrowser(app, '보관 테스트');

      await app.reload();
      await expect(app.locator('.ve-status')).toContainText(/준비됨: 커맨드 \d+개/, { timeout: 60_000 });
      // 다시 등록된 파일: 같은 엔진 경로, OPFS 사본
      const files = await diag(app, 'listFiles');
      expect(files.map((f) => f.path)).toContain('/files/bars.mp4');
      await ui
        .timeline(app)
        .getByLabel('최근 프로젝트')
        .getByRole('button', { name: /보관 테스트/ })
        .click();
      const opened = toasts(app).filter({ hasText: '열었습니다: 보관 테스트' });
      await expect(opened).toBeVisible();
      await expect(opened).not.toContainText('찾을 수 없는 미디어');
      await expect(app.getByRole('dialog', { name: '미디어 다시 연결' })).toHaveCount(0);
      await expect(ui.videoClips(app)).toHaveCount(1);
      await clickRuler(app, 60);
      await expect.poll(async () => (await canvasColor(app)).colored, { timeout: 15_000 }).toBeGreaterThan(0.3);

      // 열기 대화상자에 보관한 미디어와 저장 공간
      await app.keyboard.press('Control+o');
      const open = app.getByRole('dialog', { name: '프로젝트 열기' });
      await expect(open.getByTestId('web-storage')).toContainText('보관한 미디어 1개');
      await open.getByRole('button', { name: '취소' }).click();
    });

    test('큰 파일 실측(SH_E2E_LARGE_MP4 가 있을 때만)', async ({ app }) => {
      const big = process.env.SH_E2E_LARGE_MP4;
      test.skip(!big, 'SH_E2E_LARGE_MP4 없음');
      test.setTimeout(600_000);
      const size = statSync(big as string).size;
      const mem0 = await diag(app, 'wasmMemory');
      const t0 = Date.now();
      await importViaMenu(app, big as string);
      const name = (big as string).split('/').pop() as string;
      const item = app.getByRole('treeitem', { name: new RegExp(name.replace('.', '\\.')) });
      await expect(item).toBeVisible({ timeout: 120_000 });
      const importMs = Date.now() - t0;
      await item.click();
      await app.getByRole('button', { name: '타임라인에 넣기', exact: true }).click();
      await expect(ui.videoClips(app)).toHaveCount(1);
      const mem1 = await diag(app, 'wasmMemory');
      const io1 = await diag(app, 'ioStats');
      // 탐색: 뒤쪽 세 곳을 그린 시간(엔진 직접 호출)
      const seekMs = await app.evaluate(async () => {
        const b = (window as unknown as { shBridge: { renderFrame(t: number, s: number): Promise<unknown> } }).shBridge;
        const T = 254_016_000_000;
        const out: number[] = [];
        for (const sec of [30, 50, 10]) {
          const s = performance.now();
          await b.renderFrame(sec * T, 0.5);
          out.push(Math.round(performance.now() - s));
        }
        return out;
      });
      const c0 = Date.now();
      const copyError = await diag(app, 'mediaIdle');
      const copyMs = Date.now() - c0 + importMs;
      const mem2 = await diag(app, 'wasmMemory');
      const io2 = await diag(app, 'ioStats');
      const mb = (n: number) => Math.round(n / 1048576);
      console.log(
        `[large] file ${mb(size)}MB, import ${importMs}ms, seek ${seekMs.join('/')}ms, copy<=${copyMs}ms (error ${copyError}), wasm memory ${mb(mem0)} -> ${mb(mem1)} -> ${mb(mem2)} MB, blob read ${mb(io1.blobBytes)} -> ${mb(io2.blobBytes)} MB in ${io2.blobReads} reads`,
      );
      // 파일이 wasm 메모리로 통째로 올라오지 않는다: 가져오기·배치 뒤 메모리 증가와 Blob 에서 읽은 양이 파일보다 훨씬 작다.
      // (탐색 뒤의 증가는 디코드한 프레임 캐시라 파일 크기와 무관하다)
      expect(mem1 - mem0).toBeLessThan(64 << 20);
      expect(io2.blobBytes).toBeLessThan(size / 4);
    });
  });
});
