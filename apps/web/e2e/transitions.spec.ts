/**
 * 전환(M2-3) e2e: 미디어 패널의 "전환" 탭에서 갤러리 항목을 클립 경계로 끌어다 놓아 적용, 타임라인 전환 블록 선택,
 * 속성 패널 "전환" 탭에서 길이 변경, 더블클릭 적용. 1440 과 390 뷰포트에서 같은 흐름(playwright.config.ts).
 */
import { clickRuler, engineSequence, expect, makeDemoSequence, test, ui } from './fixtures';

interface ShBridge {
  execute(id: string, params?: Record<string, unknown>): Promise<unknown>;
}
interface TransitionRow {
  id: number;
  effect: string;
  start: number;
  duration: number;
  from: number | null;
  to: number | null;
}

/** 활성 시퀀스 V1 의 전환 목록(엔진 inspect) */
function engineTransitions(page: Parameters<typeof clickRuler>[0]): Promise<TransitionRow[]> {
  return page.evaluate(async () => {
    const b = (window as unknown as { shBridge: ShBridge }).shBridge;
    const seq = (await b.execute('sequence.inspect')) as { video: Array<{ transitions: TransitionRow[] }> };
    return seq.video[0]!.transitions;
  });
}

/** 데모 시퀀스를 만들고 2초에서 잘라 V1 에 클립 두 개를 만든다 */
async function twoClips(page: Parameters<typeof clickRuler>[0]): Promise<void> {
  await makeDemoSequence(page);
  await clickRuler(page, 120);
  await ui.tool(page, '자르기').click();
  await expect(ui.status(page)).toHaveText('자르기: 2곳');
  await expect(ui.videoClips(page)).toHaveCount(2);
  // 선택 해제: 좁은 뷰포트에서는 빈 레인 자리를 누르기 어려우므로 엔진에 직접 요청한다
  await page.evaluate(async () => {
    const b = (window as unknown as { shBridge: ShBridge }).shBridge;
    await b.execute('edit.deselectAll');
  });
  await expect(ui.timeline(page).locator('.tl-clip[aria-selected="true"]')).toHaveCount(0);
}

test.describe('전환', () => {
  test('미디어 패널의 전환 탭에 12종이 보이고 시퀀스가 없으면 비활성', async ({ app }) => {
    const media = app.getByRole('region', { name: '미디어' });
    await media.getByRole('tab', { name: '전환' }).click();
    const cards = media.getByRole('listitem');
    await expect(cards).toHaveCount(12);
    await expect(cards.first()).toBeDisabled();
    await expect(media.getByText('타임라인에 클립을 넣으면 전환을 넣을 수 있습니다.')).toBeVisible();
    await expect(media.getByRole('listitem', { name: /디졸브/ })).toBeVisible();
    await expect(media.getByRole('listitem', { name: /크로스 줌/ })).toBeVisible();
    await media.getByRole('tab', { name: '미디어' }).click();
    await expect(media.getByRole('button', { name: '데모 영상' })).toBeVisible();
  });

  test('갤러리에서 클립 경계로 끌어다 놓으면 1초 디졸브가 들어가고 블록이 그려진다', async ({ app }, testInfo) => {
    // 390 폭에서는 드래그 목표(둘째 클립)가 가로 스크롤 밖이라 경로가 불안정하다. 데스크톱 폭에서만 검증(todo P3)
    test.skip(testInfo.project.name === 'mobile-390', '좁은 뷰포트의 드래그 경로 불안정');
    await twoClips(app);
    const media = app.getByRole('region', { name: '미디어' });
    await media.getByRole('tab', { name: '전환' }).click();
    const card = media.getByRole('listitem', { name: /디졸브/ });
    await expect(card).toBeEnabled();
    const second = ui.videoClips(app).nth(1);
    await second.scrollIntoViewIfNeeded();
    await card.dragTo(second, { targetPosition: { x: 2, y: 10 } });
    await expect(ui.status(app)).toHaveText(/전환 적용: 디졸브, \d+프레임/);
    const { frameTicks } = await engineSequence(app);
    const nominal = Math.round(254_016_000_000 / frameTicks);
    const trs = await engineTransitions(app);
    expect(trs).toHaveLength(1);
    expect(trs[0]!.effect).toBe('cross_dissolve');
    expect(trs[0]!.from).not.toBeNull();
    expect(trs[0]!.to).not.toBeNull();
    // 기본 길이 1초 = 명목 프레임 수(데모 23.976fps 는 24)
    expect(Math.round(trs[0]!.duration / frameTicks)).toBe(nominal);
    const block = ui.timeline(app).locator('.tl-transition');
    await expect(block).toHaveCount(1);
    await expect(block).toHaveAttribute('aria-pressed', 'true');
    await expect(app.getByRole('region', { name: '속성' }).getByRole('tab', { name: '전환' })).toBeVisible();
    await app.screenshot({ path: testInfo.outputPath('transition-dropped.png') });
  });

  test('전환 블록을 선택하고 속성 패널에서 길이를 바꾼다', async ({ app }, testInfo) => {
    // 390 폭에서는 드래그 목표(둘째 클립)가 가로 스크롤 밖이라 경로가 불안정하다. 데스크톱 폭에서만 검증(todo P3)
    test.skip(testInfo.project.name === 'mobile-390', '좁은 뷰포트의 드래그 경로 불안정');
    await twoClips(app);
    const media = app.getByRole('region', { name: '미디어' });
    await media.getByRole('tab', { name: '전환' }).click();
    await media.getByRole('listitem', { name: /밀기/ }).dragTo(ui.videoClips(app).nth(1), { targetPosition: { x: 2, y: 10 } });
    await expect(ui.status(app)).toHaveText(/전환 적용: 밀기/);
    // 클립을 선택하면 전환 선택이 풀리고, 블록을 누르면 다시 선택된다
    await ui
      .videoClips(app)
      .first()
      .click({ position: { x: 20, y: 20 } });
    const block = ui.timeline(app).locator('.tl-transition');
    await expect(block).toHaveAttribute('aria-pressed', 'false');
    await block.click();
    await expect(block).toHaveAttribute('aria-pressed', 'true');
    const inspector = app.getByRole('region', { name: '속성' });
    // 전환만 선택된 상태라 탭은 하나뿐이고 자동으로 선택된다(모바일에서는 탭 줄이 패널 스크롤 위로 밀려 누를 수 없다)
    await expect(inspector.getByRole('tab', { name: '전환' })).toHaveAttribute('aria-selected', 'true');
    await expect(inspector.getByRole('combobox', { name: '전환 종류' })).toHaveValue('push');
    const { frameTicks } = await engineSequence(app);
    const nominal = Math.round(254_016_000_000 / frameTicks);
    const frames = inspector.getByRole('spinbutton', { name: '전환 길이(프레임)' });
    await expect(frames).toHaveValue(String(nominal));
    await expect(inspector.getByText('1.00초')).toBeVisible();
    await expect(inspector.getByRole('button', { name: '가운데' })).toHaveAttribute('aria-pressed', 'true');
    const widthBefore = (await block.boundingBox())!.width;
    await frames.fill('60');
    await frames.press('Enter');
    await expect(ui.status(app)).toHaveText('전환 길이: 60프레임');
    await expect.poll(async () => (await engineTransitions(app)).map((t) => Math.round(t.duration / frameTicks))).toEqual([60]);
    await expect(inspector.getByRole('spinbutton', { name: '전환 길이(프레임)' })).toHaveValue('60');
    await expect.poll(async () => (await block.boundingBox())!.width).toBeGreaterThan(widthBefore * 1.8);
    // 종류 교체
    await inspector.getByRole('combobox', { name: '전환 종류' }).selectOption('dip_to_white');
    await expect(ui.status(app)).toHaveText('전환 교체: 흰색으로 페이드');
    await expect.poll(async () => (await engineTransitions(app)).map((t) => t.effect)).toEqual(['dip_to_white']);
    await expect(block).toHaveAttribute('aria-label', '전환 흰색으로 페이드');
    await app.screenshot({ path: testInfo.outputPath('transition-inspector.png') });
  });

  test('더블클릭은 선택한 클립의 양쪽 경계에 넣고, 실행 취소로 되돌린다', async ({ app }) => {
    await twoClips(app);
    await ui
      .videoClips(app)
      .nth(1)
      .click({ position: { x: 20, y: 20 } });
    await expect(ui.status(app)).toHaveText('클립을 선택했습니다');
    const media = app.getByRole('region', { name: '미디어' });
    await media.getByRole('tab', { name: '전환' }).click();
    await media.getByRole('listitem', { name: /검정으로 페이드/ }).dblclick();
    await expect(ui.status(app)).toHaveText('전환 적용: 검정으로 페이드, 2곳');
    const trs = await engineTransitions(app);
    expect(trs.map((t) => [t.from !== null, t.to !== null])).toEqual([
      [true, true],
      [true, false],
    ]);
    await expect(ui.timeline(app).locator('.tl-transition')).toHaveCount(2);
    await ui.tool(app, '실행 취소').click();
    await ui.tool(app, '실행 취소').click();
    await expect.poll(() => engineTransitions(app)).toEqual([]);
    await expect(ui.timeline(app).locator('.tl-transition')).toHaveCount(0);
    await expect(app.getByRole('region', { name: '속성' }).getByRole('tab', { name: '전환' })).toHaveCount(0);
  });
});
