/**
 * 웹 편집기 e2e: 앱 로드와 wasm 엔진 준비, 데모 영상 넣기, 시퀀스 만들기, 타임라인 자르기·삭제·실행 취소,
 * 모니터 재생으로 타임코드 전진, 스크러버 탐색. 1440 과 390 뷰포트에서 같은 흐름을 돈다(playwright.config.ts).
 */
import {
  clickRuler,
  enginePlayhead,
  engineSequence,
  expect,
  makeDemoSequence,
  test,
  timecodeToFrames,
  ui,
} from './fixtures';

test.describe('앱 로드', () => {
  test('엔진이 준비되고 셸이 그려지며 가로 넘침이 없다', async ({ app, logs }) => {
    await expect(app).toHaveTitle(/SH Video Editor/);
    await expect(app.getByRole('menubar')).toBeVisible();
    await expect(app.getByRole('menubar').getByRole('button', { name: '파일' })).toBeVisible();
    await expect(app.getByRole('region', { name: '미디어' })).toBeVisible();
    await expect(app.getByRole('region', { name: '미리보기' })).toBeVisible();
    await expect(ui.timeline(app)).toBeVisible();
    await expect(app.locator('.ve-status')).toContainText('웹');
    await expect(app.locator('.ve-version')).toContainText('sh-video-engine');
    await expect(app.locator('.ve-version')).toContainText('wasm');
    await expect(app.getByText('열린 시퀀스가 없습니다. 파일 메뉴에서 시퀀스를 만드세요.')).toBeVisible();
    const overflow = await app.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
      root:
        (document.querySelector('.ve-root') as HTMLElement).scrollWidth -
        (document.querySelector('.ve-root') as HTMLElement).clientWidth,
    }));
    expect(overflow.doc, '문서 가로 넘침').toBeLessThanOrEqual(0);
    expect(overflow.body, 'body 가로 넘침').toBeLessThanOrEqual(0);
    expect(overflow.root, '.ve-root 가로 넘침').toBeLessThanOrEqual(0);
    expect(logs.warnings.filter((w) => /React|Warning/.test(w))).toEqual([]);
  });

  test('QA 훅(window.shBridge)으로 엔진을 직접 부를 수 있다', async ({ app }) => {
    const version = await app.evaluate(() =>
      (window as unknown as { shBridge: { version(): Promise<string> } }).shBridge.version(),
    );
    expect(version).toContain('wasm');
    const count = await app.evaluate(async () => {
      const b = (window as unknown as { shBridge: { commands(): Promise<unknown[]> } }).shBridge;
      return (await b.commands()).length;
    });
    expect(count).toBeGreaterThan(500);
    await expect(app.locator('.ve-status')).toContainText(`커맨드 ${count}개`);
  });

  test('메뉴를 열고 닫고 엔진 커맨드를 실행한다', async ({ app }) => {
    const file = app.getByRole('menubar').getByRole('button', { name: '파일' });
    await file.click();
    await expect(app.getByRole('menu')).toBeVisible();
    await expect(app.getByRole('menuitem').first()).toBeVisible();
    await file.click();
    await expect(app.getByRole('menu')).toHaveCount(0);
    // 파일 > 새 시퀀스는 엔진 커맨드로 바로 간다: 상태 줄에 결과가 적히고 타임라인이 생긴다
    await file.click();
    await app.getByRole('menuitem', { name: /^Sequence…/ }).click();
    await expect(app.getByRole('menu')).toHaveCount(0);
    await expect(app.locator('.ve-status')).toContainText('file.newSequence');
    await expect(app.locator('.ve-status')).not.toContainText('오류:');
    await expect(ui.timeline(app).locator('.sh-panel__title')).toContainText('타임라인 - ');
    await expect(app.locator('.mon-canvas')).toBeVisible();
  });
});

test.describe('편집 흐름', () => {
  test('데모 영상을 넣고 시퀀스를 만들면 타임라인·모니터가 채워진다', async ({ app }) => {
    await makeDemoSequence(app);
    await expect(ui.timeline(app).locator('.sh-panel__title')).toContainText('타임라인 - Aurora_Timelapse');
    await expect(app.locator('.tl-head__name').filter({ hasText: 'V1' })).toBeVisible();
    await expect(app.locator('.tl-head__name').filter({ hasText: 'A1' })).toBeVisible();
    await expect(app.locator('.mon-canvas')).toBeVisible();
    await expect(ui.current(app)).toHaveText('00:00:00:00');
    await expect(app.locator('.ve-status')).toContainText('렌더');
    // 캔버스에 실제 프레임이 그려진다(검정이 아니다). 첫 렌더는 비동기라 기다린다
    await expect
      .poll(
        () =>
          app.locator('.mon-canvas').evaluate((c: HTMLCanvasElement) => {
            const ctx = c.getContext('2d');
            if (!ctx) return -1;
            const data = ctx.getImageData(0, 0, c.width, c.height).data;
            let n = 0;
            for (let i = 0; i < data.length; i += 4) {
              if ((data[i] ?? 0) > 8 || (data[i + 1] ?? 0) > 8 || (data[i + 2] ?? 0) > 8) n++;
            }
            return n;
          }),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(1000);
    // 미디어 패널에는 영상 항목과 그 이름을 물려받은 시퀀스 항목이 함께 보인다
    const media = app.getByRole('region', { name: '미디어' });
    await expect(media.getByTitle('Aurora_Timelapse.mp4 (영상)')).toBeVisible();
    await expect(media.getByTitle('Aurora_Timelapse.mp4 (시퀀스)')).toBeVisible();
  });

  test('자르기, 선택·삭제, 실행 취소·다시 실행', async ({ app }) => {
    await makeDemoSequence(app);
    // 플레이헤드를 눈금자 클릭으로 옮긴다(60px/s 기본 줌에서 120px = 2초)
    await clickRuler(app, 120);
    await expect(ui.current(app)).not.toHaveText('00:00:00:00');
    const before = timecodeToFrames(await ui.current(app).innerText());
    expect(before).toBeGreaterThan(30);
    expect(before).toBeLessThan(120);

    await ui.tool(app, '자르기').click();
    await expect(ui.status(app)).toHaveText('자르기: 2곳');
    await expect(ui.videoClips(app)).toHaveCount(2);
    await expect(ui.clips(app)).toHaveCount(4);
    await expect(ui.total(app)).toHaveText('00:00:16:00');

    // 두 번째 영상 클립을 선택하면 연결된 소리 클립도 선택된다
    await ui.videoClips(app).nth(1).click();
    await expect(ui.status(app)).toHaveText('클립을 선택했습니다');
    await expect(app.locator('.tl-clip.is-selected')).toHaveCount(2);

    await ui.tool(app, '삭제').click();
    await expect(ui.status(app)).toHaveText('삭제: 클립 2개');
    await expect(ui.clips(app)).toHaveCount(2);

    await ui.tool(app, '실행 취소').click();
    await expect(ui.status(app)).toHaveText('실행 취소: Clear');
    await expect(ui.clips(app)).toHaveCount(4);
    await ui.tool(app, '다시 실행').click();
    await expect(ui.status(app)).toHaveText('다시 실행: Clear');
    await expect(ui.clips(app)).toHaveCount(2);
    await ui.tool(app, '실행 취소').click();
    await ui.tool(app, '실행 취소').click();
    await expect(ui.status(app)).toHaveText('실행 취소: Razor');
    await expect(ui.clips(app)).toHaveCount(2);
    await expect(ui.total(app)).toHaveText('00:00:16:00');
  });

  test('키보드: Ctrl+K 자르기, Delete 삭제, Ctrl+Z 되돌리기', async ({ app }) => {
    await makeDemoSequence(app);
    await clickRuler(app, 180);
    await ui.timeline(app).focus();
    await app.keyboard.press('Control+k');
    await expect(ui.status(app)).toHaveText('자르기: 2곳');
    await ui.videoClips(app).first().click();
    await expect(app.locator('.tl-clip.is-selected')).toHaveCount(2);
    await app.keyboard.press('Delete');
    await expect(ui.status(app)).toHaveText('삭제: 클립 2개');
    await expect(ui.clips(app)).toHaveCount(2);
    await app.keyboard.press('Control+z');
    await expect(ui.clips(app)).toHaveCount(4);
  });

  test('리플 삭제는 뒤 클립을 당겨 길이가 줄어든다', async ({ app }) => {
    await makeDemoSequence(app);
    await clickRuler(app, 240);
    await ui.tool(app, '자르기').click();
    await expect(ui.clips(app)).toHaveCount(4);
    await ui.tool(app, '리플').click();
    await expect(ui.tool(app, '리플')).toHaveAttribute('aria-pressed', 'true');
    await ui.videoClips(app).first().click();
    await ui.tool(app, '삭제').click();
    await expect(ui.status(app)).toHaveText('리플 삭제: 클립 2개');
    await expect(ui.clips(app)).toHaveCount(2);
    // 모니터는 project revision 을 300ms 주기로 보고 길이를 갱신한다
    await expect.poll(async () => timecodeToFrames(await ui.total(app).innerText())).toBeLessThan(480);
    expect(timecodeToFrames(await ui.total(app).innerText())).toBeGreaterThan(300);
    const { duration } = await engineSequence(app);
    expect(duration).toBeLessThan(16 * 254_016_000_000);
    expect(duration).toBeGreaterThan(10 * 254_016_000_000);
  });
});

test.describe('모니터', () => {
  test('재생하면 타임코드가 전진하고 정지하면 멈춘다', async ({ app }) => {
    await makeDemoSequence(app);
    const play = app.getByRole('button', { name: '재생', exact: true });
    await play.click();
    await expect(app.getByRole('button', { name: '정지', exact: true })).toBeVisible();
    await expect
      .poll(async () => timecodeToFrames(await ui.current(app).innerText()), { timeout: 10_000 })
      .toBeGreaterThan(5);
    await app.getByRole('button', { name: '정지', exact: true }).click();
    await expect(app.getByRole('button', { name: '재생', exact: true })).toBeVisible();
    const stopped = await ui.current(app).innerText();
    await app.waitForTimeout(600);
    await expect(ui.current(app)).toHaveText(stopped);
    expect(timecodeToFrames(stopped)).toBeGreaterThan(5);
    // 타임라인 플레이헤드도 같은 위치를 가리킨다(엔진이 SSOT)
    await expect(ui.timeline(app).locator('.tl-title__tc')).toHaveText(stopped);
  });

  test('스크러버와 프레임 이동', async ({ app }) => {
    await makeDemoSequence(app);
    // 데모 클립으로 만든 시퀀스는 클립의 프레임레이트(23.976)를 따른다. 프레임 수는 엔진 tick 으로 확인한다
    const { frameTicks, duration } = await engineSequence(app);
    const T = 254_016_000_000;
    // 16초 클립은 23.976 에서 384 프레임으로 올림된다(엔진이 프레임 경계로 맞춘다)
    expect(duration).toBe(384 * frameTicks);
    expect(frameTicks).toBe((T * 1001) / 24000);
    const slider = app.getByRole('slider', { name: '재생 위치' });
    const box = (await slider.boundingBox())!;
    await slider.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await expect.poll(() => enginePlayhead(app)).toBeGreaterThan(7 * T);
    const mid = await enginePlayhead(app);
    expect(mid).toBeLessThan(9 * T);
    expect(mid % frameTicks).toBe(0);
    await expect(ui.current(app)).toHaveText(/^00:00:0[78]:\d\d$/);
    await app.getByRole('button', { name: '다음 프레임' }).click();
    await expect.poll(() => enginePlayhead(app)).toBe(mid + frameTicks);
    await app.getByRole('button', { name: '이전 프레임' }).click();
    await expect.poll(() => enginePlayhead(app)).toBe(mid);
    await app.getByRole('button', { name: '이전 프레임' }).click();
    await expect.poll(() => enginePlayhead(app)).toBe(mid - frameTicks);
    await app.getByRole('button', { name: '끝으로' }).click();
    await expect.poll(() => enginePlayhead(app)).toBe(duration);
    await expect(ui.current(app)).toHaveText(await ui.total(app).innerText());
    await app.getByRole('button', { name: '처음으로' }).click();
    await expect(ui.current(app)).toHaveText('00:00:00:00');
    await slider.focus();
    await app.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => enginePlayhead(app)).toBe(5 * frameTicks);
    await app.keyboard.press('ArrowLeft');
    await expect.poll(() => enginePlayhead(app)).toBe(4 * frameTicks);
    await app.keyboard.press('End');
    await expect.poll(() => enginePlayhead(app)).toBe(duration);
    await app.keyboard.press('Home');
    await expect.poll(() => enginePlayhead(app)).toBe(0);
  });
});
