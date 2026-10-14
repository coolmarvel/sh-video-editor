/**
 * 웹 e2e: 속도(인스펙터 "속도" 탭, 2x 적용과 타임라인 배지, 역방향, 프레임 고정, 클립 메뉴 대화상자)와
 * 비율(시퀀스 > 화면 비율 로 9:16, 모니터 비율 변화, 내보내기 대화상자의 비율 막대와 SNS 프리셋). 1440 과 390 두 뷰포트.
 */
import { clickRuler, expect, makeDemoSequence, test, ui } from './fixtures';

const inspector = (app: Parameters<typeof makeDemoSequence>[0]) => app.getByRole('region', { name: '속성' });
const badge = (app: Parameters<typeof makeDemoSequence>[0]) => app.locator('.tl-lane--video .tl-clip [data-speed-badge]');

test.describe('속도', () => {
  test('클립을 선택해 2x 를 적용하면 길이가 절반이 되고 타임라인에 배지가 생긴다', async ({ app }) => {
    await makeDemoSequence(app);
    // 클립을 고르기 전에는 속도 탭이 없다(자막 탭 등은 선택 없이도 보인다)
    await expect(inspector(app).getByRole('tab', { name: '속도' })).toHaveCount(0);
    await ui.videoClips(app).first().click();
    await inspector(app).getByRole('tab', { name: '속도' }).click();
    const value = inspector(app).getByRole('spinbutton', { name: '배속' });
    await expect(value).toHaveValue('1');
    await value.fill('2');
    await expect(inspector(app).locator('[data-speed-result]')).toContainText('적용 후 길이 00:00:08:00 (지금 00:00:16:00');
    await expect(inspector(app).getByRole('radio', { name: '2x' })).toHaveAttribute('aria-checked', 'true');
    await inspector(app).getByRole('button', { name: '적용', exact: true }).click();
    await expect(ui.status(app)).toHaveText('속도 2x: 클립 2개');
    await expect(badge(app)).toHaveText('2x');
    await expect.poll(async () => ui.total(app).innerText()).toBe('00:00:08:00');
    await expect(inspector(app).locator('[data-speed-result]')).toContainText('(지금 00:00:08:00');

    // 빠른 선택 1x + 역방향
    await inspector(app).getByRole('radio', { name: '1x' }).click();
    await inspector(app).getByRole('checkbox', { name: '역방향 재생' }).check();
    await inspector(app).getByRole('button', { name: '적용', exact: true }).click();
    await expect(ui.status(app)).toHaveText('속도 1x, 역방향: 클립 2개');
    await expect(badge(app)).toHaveText('역');
    await expect.poll(async () => ui.total(app).innerText()).toBe('00:00:16:00');

    // 실행 취소 두 번이면 배지가 사라진다
    await ui.tool(app, '실행 취소').click();
    await ui.tool(app, '실행 취소').click();
    await expect(ui.status(app)).toHaveText('실행 취소: 속도, 길이');
    await expect(badge(app)).toHaveCount(0);
  });

  test('이 프레임 고정은 플레이헤드 자리에 2초 정지 구간을 끼워 넣는다', async ({ app }) => {
    await makeDemoSequence(app);
    await clickRuler(app, 120);
    await ui.videoClips(app).first().click();
    await inspector(app).getByRole('tab', { name: '속도' }).click();
    await inspector(app).getByRole('button', { name: '이 프레임 고정' }).click();
    await expect(ui.status(app)).toHaveText('이 프레임을 2초 동안 고정했습니다');
    await expect(ui.videoClips(app)).toHaveCount(3);
    await expect.poll(async () => ui.total(app).innerText()).toBe('00:00:18:00');
    await ui.tool(app, '실행 취소').click();
    await expect(ui.videoClips(app)).toHaveCount(1);
  });

  test('클립 메뉴의 속도, 길이 대화상자는 같은 폼을 쓴다', async ({ app }) => {
    await makeDemoSequence(app);
    await ui.videoClips(app).first().click();
    // 선택이 엔진에 반영되고 화면이 다시 읽힌 뒤에 메뉴를 연다(동작이 화면 store 의 선택을 읽는다)
    await expect(ui.status(app)).toHaveText('클립을 선택했습니다');
    await expect(app.locator('.tl-clip.is-selected')).toHaveCount(2);
    await app.getByRole('menubar').getByRole('button', { name: '클립' }).click();
    await app.getByRole('menuitem', { name: /^속도, 길이/ }).click();
    const dialog = app.getByRole('dialog', { name: '속도, 길이' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('spinbutton', { name: '배속' }).fill('0.5');
    await expect(dialog.locator('[data-speed-result]')).toContainText('적용 후 길이 00:00:32:00');
    await dialog.getByRole('button', { name: '적용' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(ui.status(app)).toHaveText('속도 0.5x: 클립 2개');
    await expect(badge(app)).toHaveText('0.5x');
    await expect.poll(async () => ui.total(app).innerText()).toBe('00:00:32:00');
  });
});

test.describe('비율', () => {
  const canvasBox = (app: Parameters<typeof makeDemoSequence>[0]) =>
    app.locator('.mon-canvas').evaluate((c: HTMLCanvasElement) => ({ w: c.clientWidth, h: c.clientHeight }));

  test('시퀀스 > 화면 비율 로 9:16 을 적용하면 모니터가 세로가 된다', async ({ app }) => {
    await makeDemoSequence(app);
    await expect.poll(async () => (await canvasBox(app)).w).toBeGreaterThan(0);
    const before = await canvasBox(app);
    expect(before.w).toBeGreaterThan(before.h);
    await app.getByRole('menubar').getByRole('button', { name: '타임라인' }).click();
    await app.getByRole('menuitem', { name: /^화면 비율/ }).click();
    const dialog = app.getByRole('dialog', { name: '화면 비율' });
    await expect(dialog).toContainText('지금 1920 x 1080 (16:9)');
    await dialog.getByRole('radio', { name: /^세로 9:16/ }).check();
    await dialog.getByRole('radio', { name: /^채우기/ }).check();
    await dialog.getByRole('button', { name: '적용' }).click();
    await expect(dialog).toHaveCount(0);
    // 설정 변경 + 클립 맞춤은 트랜잭션 한 단계(features/ratio/store.ts withTransaction)
    await expect(ui.status(app)).toHaveText('화면 비율 세로 9:16 (1080 x 1920), 클립 1개 채우기. 되돌리려면 실행 취소 한 번');
    await expect.poll(async () => (await canvasBox(app)).h).toBeGreaterThan(before.h / 2);
    const after = await canvasBox(app);
    expect(after.h).toBeGreaterThan(after.w);
    expect(Math.abs(after.w / after.h - 9 / 16)).toBeLessThan(0.02);
    const settings = await app.evaluate(async () => {
      const b = (window as unknown as { shBridge: { execute(id: string): Promise<unknown> } }).shBridge;
      return ((await b.execute('sequence.inspect')) as { settings: { width: number; height: number } }).settings;
    });
    expect(settings).toMatchObject({ width: 1080, height: 1920 });
    await expect(ui.total(app)).toHaveText('00:00:16:00');
    await ui.tool(app, '실행 취소').click();
    await expect(ui.status(app)).toHaveText('실행 취소: 화면 비율 세로 9:16');
    await expect.poll(async () => (await canvasBox(app)).w).toBeGreaterThan(before.h);
  });

  test('내보내기 대화상자의 비율 막대와 SNS 프리셋', async ({ app }) => {
    await makeDemoSequence(app);
    await app.getByRole('menubar').getByRole('button', { name: '파일' }).click();
    await app.getByRole('menuitem', { name: /^내보내기/ }).click();
    const dialog = app.getByRole('dialog', { name: '내보내기' });
    await expect(dialog).toBeVisible();
    const ratios = dialog.getByRole('radiogroup', { name: '화면 비율' });
    await expect(ratios.getByRole('radio', { name: '16:9' })).toHaveAttribute('aria-checked', 'true');
    const sns = dialog.getByRole('radiogroup', { name: 'SNS 프리셋' });
    await expect(sns.getByRole('radio')).toHaveCount(4);
    await expect(sns.getByRole('radio', { name: /YouTube 1080p/ })).toContainText('1920 x 1080, 23.976 fps');
    await expect(sns.getByRole('radio', { name: /Shorts, Reels/ })).toContainText('1080 x 1920');
    await expect(sns.getByRole('radio', { name: /Instagram 정사각/ })).toContainText('1080 x 1080');
    await expect(sns.getByRole('radio', { name: /YouTube 4K/ })).toContainText('3840 x 2160');
    await sns.getByRole('radio', { name: /Shorts, Reels/ }).click();
    await expect(sns.getByRole('radio', { name: /Shorts, Reels/ })).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByRole('combobox', { name: '프리셋' })).toHaveValue('sns-shorts');
    await expect(dialog).toContainText('1080 x 1920, 23.976 fps, 16.0초');
    // 비율 막대에서 1:1 을 누르면 시퀀스가 바뀌고 프리셋 해석이 다시 된다
    await ratios.getByRole('radio', { name: '1:1' }).click();
    await expect(ui.status(app)).toContainText('화면 비율 정사각 1:1 (1080 x 1080), 클립 1개 채우기');
    await expect(ratios.getByRole('radio', { name: '1:1' })).toHaveAttribute('aria-checked', 'true');
    await expect(dialog).toContainText('화면 비율 1080 x 1080 (1:1)');
    await dialog.getByRole('button', { name: '닫기' }).click();
    await expect(dialog).toHaveCount(0);
  });
});
