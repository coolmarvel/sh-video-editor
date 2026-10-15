/**
 * 전환(M2-3) e2e: 미디어 패널의 "전환" 탭에서 갤러리 항목을 클립 경계로 끌어다 놓아 적용, 타임라인 전환 블록 선택,
 * 속성 패널 "전환" 탭에서 길이 변경, 더블클릭 적용. 1440 과 390 뷰포트에서 같은 흐름(playwright.config.ts).
 * 390 폭에서는 끌어다 놓을 목표(둘째 클립)가 가로 스크롤 밖이라 드래그 경로가 불안정했다(과거 skip 2건). 거기서는 같은 편집점에
 * 키보드로 넣는다: 둘째 클립 선택 -> 적용 위치 "앞" -> 카드에 포커스 -> Enter (TransitionGallery 의 onKeyDown, 더블클릭과 같은 store 경로).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { clickRuler, engineSequence, expect, makeDemoSequence, test, toasts, ui } from './fixtures';

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

/** 활성 시퀀스 V1 의 클립(엔진 inspect): 시작·끝·소스 시작(tick) */
function v1Items(page: Page): Promise<Array<{ start: number; end: number; sourceIn: number }>> {
  return page.evaluate(async () => {
    const b = (window as unknown as { shBridge: ShBridge }).shBridge;
    const seq = (await b.execute('sequence.inspect')) as { video: Array<{ items: Array<{ start: number; end: number; sourceIn: number }> }> };
    return seq.video[0]!.items.map(({ start, end, sourceIn }) => ({ start, end, sourceIn }));
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

/**
 * 갤러리 항목을 첫째·둘째 클립 사이 편집점에 넣는다. 데스크톱 폭은 둘째 클립 머리로 끌어다 놓기(새 전환이 선택된다),
 * 390 폭은 둘째 클립을 선택하고 "앞" 경계에 Enter 로 넣기(클립 선택이 남고 전환은 선택되지 않는다). 상태 줄 문구를 돌려준다.
 */
async function applyAtFirstCut(page: Page, project: string, name: RegExp): Promise<RegExp> {
  const media = page.getByRole('region', { name: '미디어' });
  const second = ui.videoClips(page).nth(1);
  if (project === 'mobile-390') {
    await second.click({ position: { x: 20, y: 20 } });
    await expect(ui.status(page)).toHaveText('클립을 선택했습니다');
    await media.getByRole('tab', { name: '전환' }).click();
    await media.getByRole('toolbar', { name: '전환 적용 위치' }).getByRole('button', { name: '앞' }).click();
    const card = media.getByRole('listitem', { name });
    await expect(card).toBeEnabled();
    await card.focus();
    await page.keyboard.press('Enter');
    return /1곳$/;
  }
  await media.getByRole('tab', { name: '전환' }).click();
  const card = media.getByRole('listitem', { name });
  await expect(card).toBeEnabled();
  await second.scrollIntoViewIfNeeded();
  await card.dragTo(second, { targetPosition: { x: 2, y: 10 } });
  return /\d+프레임$/;
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

  test('갤러리에서 클립 경계로 끌어다 놓으면(390 폭은 Enter) 1초 디졸브가 들어가고 블록이 그려진다', async ({ app }, testInfo) => {
    await twoClips(app);
    const mobile = testInfo.project.name === 'mobile-390';
    const tail = await applyAtFirstCut(app, testInfo.project.name, /디졸브/);
    await expect(ui.status(app)).toHaveText(new RegExp(`^전환 적용: 디졸브, ${tail.source}`));
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
    // 끌어다 놓기는 새 전환을 바로 선택한다. 키보드 적용은 클립 선택을 남기므로 블록을 눌러 선택한다
    if (mobile) {
      await expect(block).toHaveAttribute('aria-pressed', 'false');
      await block.click();
    }
    await expect(block).toHaveAttribute('aria-pressed', 'true');
    await expect(app.getByRole('region', { name: '속성' }).getByRole('tab', { name: '전환' })).toBeVisible();
    await app.screenshot({ path: testInfo.outputPath('transition-dropped.png') });
  });

  test('전환 블록을 선택하고 속성 패널에서 길이를 바꾼다', async ({ app }, testInfo) => {
    await twoClips(app);
    await applyAtFirstCut(app, testInfo.project.name, /밀기/);
    await expect(ui.status(app)).toHaveText(/^전환 적용: 밀기/);
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

  test.describe('핸들 자동으로 다듬기', () => {
    // 데모(생성) 영상은 끝이 없어 반복 프레임이 생기지 않는다. 끝이 있는 실제 파일(3초 막대)을 두 번 이어 붙인다
    let dir = '';
    let clip = '';
    test.beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'sh-e2e-handles-'));
      clip = join(dir, 'bars3.mp4');
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

    test('다듬지 않은 두 클립 사이 전환은 알림 버튼으로 양쪽을 리플 트림해 실제 프레임을 쓰고, 실행 취소 한 번에 되돌린다', async ({ app }, testInfo) => {
      const chooser = app.waitForEvent('filechooser');
      await app.getByRole('menubar').getByRole('button', { name: '파일' }).click();
      await app.getByRole('menuitem', { name: '미디어 가져오기...' }).click();
      await (await chooser).setFiles(clip);
      const item = app.getByRole('treeitem', { name: /bars3\.mp4/ });
      await expect(item).toBeVisible({ timeout: 20_000 });
      await item.click();
      await app.getByRole('button', { name: '타임라인에 넣기', exact: true }).click();
      await expect(ui.videoClips(app)).toHaveCount(1);
      // 같은 파일을 3초 뒤에 한 번 더(엔진에 직접): 두 클립 모두 소스 처음부터 끝까지라 핸들이 없다
      await app.evaluate(async () => {
        const b = (window as unknown as { shBridge: ShBridge }).shBridge;
        const seq = (await b.execute('sequence.inspect')) as { video: Array<{ items: Array<{ item: number; end: number }> }> };
        const first = seq.video[0]!.items[0]!;
        await b.execute('timeline.place', { item: first.item, track: 'V1', time: first.end, insert: true });
        await b.execute('edit.deselectAll');
      });
      await expect(ui.videoClips(app)).toHaveCount(2);

      await applyAtFirstCut(app, testInfo.project.name, /디졸브/);
      const notice = toasts(app).filter({ hasText: '끝 화면이 멈춰 보입니다' });
      await expect(notice).toBeVisible();
      await notice.getByRole('button', { name: '핸들 자동으로 다듬기' }).click();
      // 문구 끝에 "(미디어가 모자라 ...)" 가 없다 = 다듬은 뒤 엔진이 알린 반복 프레임이 0
      await expect(ui.status(app)).toHaveText(/^핸들 다듬기: (앞 클립 끝 \d+프레임, )?뒤 클립 처음 \d+프레임$/);

      // 두 클립은 맞닿은 채 컷이 앞으로 오고, 뒤 클립은 소스 중간에서 시작하며, 전환은 그대로 하나
      const [a, b] = await v1Items(app);
      expect(b!.start).toBe(a!.end);
      expect(b!.sourceIn).toBeGreaterThan(0);
      expect(await engineTransitions(app)).toHaveLength(1);
      // 실행 취소 한 번이 다듬기 전체(트림 둘 + 길이 다시 맞춤)를 되돌린다
      await ui.tool(app, '실행 취소').click();
      await expect(ui.status(app)).toHaveText('실행 취소: 핸들 다듬기');
      expect((await v1Items(app))[1]!.sourceIn).toBe(0);
    });
  });
});
