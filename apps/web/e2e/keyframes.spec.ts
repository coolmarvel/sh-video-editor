/**
 * 키프레임·스티커·템플릿 e2e(웹, wasm 엔진, M3-1·M3-4·M3-6): 모션 탭에서 불투명도 키프레임 두 개를 만들면 타임라인 클립에 마커가
 * 보이고 스크럽하면 모니터 밝기가 바뀐다. 스티커 탭에서 별을 넣으면 클립과 변형 상자가 생기고 모니터에 노란 픽셀이 보인다.
 * 움직이는 스티커(Lottie, 뛰는 하트)는 .json 으로 들어가 5초 클립이 되고 빨간 픽셀 수가 시각에 따라 달라진다.
 * 템플릿 탭에서 세로 Shorts 틀을 만들면 1080x1920 편집본에 제목·자막 띠가 들어간다. 1440 과 390 두 뷰포트(playwright.config.ts).
 */
import type { Page } from '@playwright/test';
import { engineSequence, expect, makeDemoSequence, test, ui } from './fixtures';

interface ShBridge {
  execute(id: string, params?: Record<string, unknown>): Promise<unknown>;
  setPlayhead(tick: number): Promise<void>;
}

const T = 254_016_000_000;

/** 모니터 캔버스의 평균 밝기, 노란(별) 픽셀 수, 빨간(하트) 픽셀 수 */
async function canvasStats(page: Page): Promise<{ luma: number; yellow: number; red: number }> {
  await page.waitForTimeout(450);
  return page.locator('.mon-canvas').evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d');
    if (!ctx) return { luma: -1, yellow: -1, red: -1 };
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let luma = 0;
    let yellow = 0;
    let red = 0;
    const n = c.width * c.height;
    for (let i = 0; i < n; i++) {
      const r = d[i * 4] ?? 0;
      const g = d[i * 4 + 1] ?? 0;
      const b = d[i * 4 + 2] ?? 0;
      luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (r > 200 && g > 160 && b < 120) yellow++;
      if (r > 180 && g < 110 && b < 110) red++;
    }
    return { luma: luma / n, yellow, red };
  });
}

function bridge(page: Page) {
  return {
    /** 명목 프레임(24 또는 30) 기준 n 초를 프레임 경계로 맞춰 옮긴다. 데모 영상은 23.976fps 라 n*T 는 02:23 처럼 표시된다 */
    setPlayhead: async (tick: number) => {
      const { frameTicks } = await engineSequence(page);
      const nominal = Math.round(T / frameTicks);
      const aligned = Math.round((tick / T) * nominal) * frameTicks;
      await page.evaluate((t) => (window as unknown as { shBridge: ShBridge }).shBridge.setPlayhead(t), aligned);
    },
    execute: <R>(id: string, params?: Record<string, unknown>) =>
      page.evaluate(
        ([i, p]) => (window as unknown as { shBridge: ShBridge }).shBridge.execute(i as string, p as Record<string, unknown>),
        [id, params],
      ) as Promise<R>,
  };
}

/** 엔진의 첫 영상 클립에서 효과 파라미터의 키프레임 수 */
async function keyframeCount(page: Page, effect: string, param: string): Promise<number> {
  const seq = await bridge(page).execute<{ video: { items: { effects: { effect: string; params: Record<string, { keyframes: number }> }[] }[] }[] }>(
    'sequence.inspect',
  );
  return seq.video[0]!.items[0]!.effects.find((e) => e.effect === effect)!.params[param]!.keyframes;
}

const inspector = (page: Page) => page.getByRole('region', { name: '속성' });
const media = (page: Page) => page.getByRole('region', { name: '미디어' });

test.describe('키프레임', () => {
  test('모션 탭에서 불투명도 키프레임 두 개를 만들면 마커가 보이고 스크럽하면 모니터가 바뀐다', async ({ app }, testInfo) => {
    await makeDemoSequence(app);
    const b = bridge(app);
    await b.setPlayhead(3 * T);
    await expect(ui.current(app)).toHaveText('00:00:03:00');
    await ui.videoClips(app).first().click();
    await expect(ui.status(app)).toHaveText('클립을 선택했습니다');
    const panel = inspector(app);
    await panel.getByRole('tab', { name: '모션' }).click();
    const tab = app.getByTestId('motion-tab');
    await expect(tab.getByRole('slider', { name: '불투명도' })).toHaveValue('100');
    const toggle = tab.getByRole('button', { name: '불투명도 키프레임', exact: true });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    const bright = await canvasStats(app);
    expect(bright.luma).toBeGreaterThan(5);

    // 3초에 첫 키프레임(현재 값 100)
    await toggle.click();
    await expect(ui.status(app)).toHaveText('키프레임을 추가했습니다');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(tab.getByText('키프레임 1개')).toBeVisible();
    expect(await keyframeCount(app, 'opacity', 'opacity')).toBe(1);
    const markers = ui.videoClips(app).first().locator('[data-keyframe-markers]');
    await expect(markers).toHaveAttribute('data-keyframe-markers', '1');

    // 5초로 옮겨 값을 0 으로: 두 번째 키프레임
    await b.setPlayhead(5 * T);
    await expect(ui.current(app)).toHaveText('00:00:05:00');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    const num = tab.getByRole('textbox', { name: '불투명도 값' });
    await num.fill('0');
    await num.press('Enter');
    await expect(ui.status(app)).toHaveText('키프레임 값을 바꿨습니다');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(tab.getByText('키프레임 2개')).toBeVisible();
    await expect(markers).toHaveAttribute('data-keyframe-markers', '2');
    expect(await keyframeCount(app, 'opacity', 'opacity')).toBe(2);
    // 보간 콤보가 보이고 홀드로 바꿀 수 있다
    await expect(tab.getByRole('combobox', { name: '불투명도 보간' })).toHaveValue('linear');

    // 5초는 투명(어둡다), 4초는 중간, 3초는 원래 밝기
    await expect.poll(async () => (await canvasStats(app)).luma, { timeout: 15_000 }).toBeLessThan(1);
    await b.setPlayhead(4 * T);
    await expect(ui.current(app)).toHaveText('00:00:04:00');
    await expect.poll(async () => (await canvasStats(app)).luma, { timeout: 15_000 }).toBeGreaterThan(1);
    const mid = await canvasStats(app);
    expect(mid.luma).toBeLessThan(bright.luma * 0.8);
    await expect(tab.getByRole('slider', { name: '불투명도' })).toHaveValue('50');
    await testInfo.attach('keyframes', { body: await app.screenshot(), contentType: 'image/png' });

    // 이전 키프레임으로
    await tab.getByRole('button', { name: '이전 키프레임' }).click();
    await expect(ui.current(app)).toHaveText('00:00:03:00');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // 실행 취소 두 번이면 키프레임이 없어지고 마커도 사라진다
    await app.keyboard.press('Control+z');
    await app.keyboard.press('Control+z');
    await expect.poll(() => keyframeCount(app, 'opacity', 'opacity')).toBe(0);
    await expect(markers).toHaveCount(0);
  });

  test('등장 프리셋(왼쪽에서)은 위치 키프레임 두 개를 만들고 변형 상자가 움직인다', async ({ app }) => {
    await makeDemoSequence(app);
    await ui.videoClips(app).first().click();
    await inspector(app).getByRole('tab', { name: '모션' }).click();
    const tab = app.getByTestId('motion-tab');
    await tab.getByRole('button', { name: '왼쪽에서' }).click();
    await expect(ui.status(app)).toHaveText('등장 애니메이션을 넣었습니다: 왼쪽에서');
    expect(await keyframeCount(app, 'motion', 'position')).toBe(2);
    await expect(ui.videoClips(app).first().locator('[data-keyframe-markers]')).toHaveAttribute('data-keyframe-markers', '2');
    // 0초에서는 화면 왼쪽 밖(X = 960 - 1920)
    await bridge(app).setPlayhead(0);
    await expect(ui.current(app)).toHaveText('00:00:00:00');
    await expect(tab.getByRole('slider', { name: '위치 X' })).toHaveValue('-960');
    const box = app.getByTestId('transform-overlay').locator('.kf-box');
    await expect(box).toHaveCount(1);
    const left0 = (await box.boundingBox())!.x;
    await bridge(app).setPlayhead(T);
    await expect(ui.current(app)).toHaveText('00:00:01:00');
    await expect(tab.getByRole('slider', { name: '위치 X' })).toHaveValue('960');
    await expect.poll(async () => (await box.boundingBox())!.x).toBeGreaterThan(left0 + 50);
  });
});

test.describe('스티커', () => {
  test('스티커 탭에서 별을 넣으면 5초 클립이 생기고 모니터에 노란 픽셀이 보이며 모션 탭이 열린다', async ({ app }, testInfo) => {
    await makeDemoSequence(app);
    await bridge(app).setPlayhead(2 * T);
    await expect(ui.current(app)).toHaveText('00:00:02:00');
    const before = await canvasStats(app);
    const m = media(app);
    await m.getByRole('tab', { name: '스티커' }).click();
    const gallery = app.getByTestId('sticker-gallery');
    await expect(gallery.locator('.stk-card')).toHaveCount(30);
    await gallery.getByRole('button', { name: '별', exact: true }).click();
    await expect(ui.status(app)).toHaveText('스티커를 넣었습니다: 별');
    await expect(ui.videoClips(app)).toHaveCount(2);
    await expect(app.locator('.tl-clip.is-selected')).toHaveCount(1);
    await expect(inspector(app).getByRole('tab', { name: '모션' })).toHaveAttribute('aria-selected', 'true');
    await expect(app.getByTestId('transform-overlay').locator('.kf-box')).toHaveCount(1);
    await expect.poll(async () => (await canvasStats(app)).yellow, { timeout: 15_000 }).toBeGreaterThan(before.yellow + 50);
    const seq = await bridge(app).execute<{ video: { items: { name: string; duration: number; start: number }[] }[] }>('sequence.inspect');
    const sticker = seq.video.flatMap((t) => t.items).find((c) => c.name.startsWith('sticker-star'));
    // 23.976fps 라 5초는 프레임 경계(5.005초)로 맞춰진다
    expect(Math.abs(sticker!.duration - 5 * T)).toBeLessThan(T / 20);
    expect(Math.abs(sticker!.start - 2 * T)).toBeLessThan(T / 20);
    await testInfo.attach('sticker', { body: await app.screenshot(), contentType: 'image/png' });
    // 같은 스티커를 다시 넣어도 미디어 항목은 하나(timeline.place 로 재사용)
    await bridge(app).setPlayhead(8 * T);
    await expect(ui.current(app)).toHaveText('00:00:08:00');
    await gallery.getByRole('button', { name: '별', exact: true }).click();
    await expect(ui.videoClips(app)).toHaveCount(3);
    const proj = await bridge(app).execute<{ root: { children: Array<{ name?: string; children?: unknown[] }> } }>('project.inspect');
    const flat = JSON.stringify(proj.root);
    expect(flat.split('sticker-star.png').length - 1).toBe(1);
  });

  test('움직이는 스티커(뛰는 하트)는 .json 으로 들어가 5초 클립이 되고 모니터의 빨간 픽셀이 시각마다 달라진다', async ({ app }, testInfo) => {
    await makeDemoSequence(app);
    const b = bridge(app);
    await b.setPlayhead(2 * T);
    await expect(ui.current(app)).toHaveText('00:00:02:00');
    const before = await canvasStats(app);
    const m = media(app);
    await m.getByRole('tab', { name: '스티커' }).click();
    const gallery = app.getByTestId('sticker-gallery');
    await expect(gallery.getByRole('heading', { name: '움직이는 스티커' })).toBeVisible();
    await expect(gallery.locator('.stk-card[data-animated]')).toHaveCount(10);
    await gallery.getByRole('button', { name: '뛰는 하트', exact: true }).click();
    await expect(ui.status(app)).toHaveText('스티커를 넣었습니다: 뛰는 하트');
    await expect(ui.videoClips(app)).toHaveCount(2);
    await expect(inspector(app).getByRole('tab', { name: '모션' })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(async () => (await canvasStats(app)).red, { timeout: 15_000 }).toBeGreaterThan(before.red + 50);
    const seq = await b.execute<{ video: { items: { name: string; duration: number; start: number }[] }[] }>('sequence.inspect');
    const sticker = seq.video.flatMap((t) => t.items).find((c) => c.name.startsWith('sticker-heart-beat'));
    expect(sticker!.name.endsWith('.json')).toBe(true);
    expect(Math.abs(sticker!.duration - 5 * T)).toBeLessThan(T / 20);
    // 0.2초 뒤(하트가 커진 때)와 0.5초 뒤(제 크기)의 빨간 픽셀 수가 다르다
    await b.setPlayhead(2.2 * T);
    const big = await canvasStats(app);
    await b.setPlayhead(2.5 * T);
    await expect.poll(async () => Math.abs((await canvasStats(app)).red - big.red), { timeout: 15_000 }).toBeGreaterThan(40);
    await testInfo.attach('animated-sticker', { body: await app.screenshot(), contentType: 'image/png' });
  });
});

test.describe('템플릿', () => {
  test('세로 Shorts 틀 템플릿은 고른 미디어로 1080x1920 편집본에 제목과 자막 띠를 만든다', async ({ app }, testInfo) => {
    await app.getByRole('button', { name: '데모 영상', exact: true }).click();
    await app.getByRole('menuitem', { name: '오로라' }).click();
    await expect(app.getByRole('status').filter({ hasText: '데모 영상을 넣었습니다' })).toBeVisible();
    const m = media(app);
    await m.getByRole('tab', { name: '템플릿' }).click();
    const gallery = app.getByTestId('template-gallery');
    await expect(gallery.locator('.tpl-card')).toHaveCount(4);
    await expect(gallery).toContainText('고른 미디어 1개로');
    await gallery.locator('[data-template="shorts-vertical"]').getByRole('button', { name: '만들기' }).click();
    await expect(app.getByRole('status').filter({ hasText: '템플릿으로 편집본을 만들었습니다' })).toBeVisible({ timeout: 30_000 });
    await expect(ui.videoClips(app)).toHaveCount(3);
    await expect(inspector(app).getByRole('tab', { name: '텍스트' })).toHaveAttribute('aria-selected', 'true');
    await expect(app.getByRole('textbox', { name: '텍스트 내용' })).toHaveValue('제목을 입력하세요');
    const seq = await bridge(app).execute<{ name: string; settings: { width: number; height: number }; video: { items: { name: string }[] }[] }>(
      'sequence.inspect',
    );
    expect(seq.settings).toMatchObject({ width: 1080, height: 1920 });
    expect(seq.name).toContain('세로 Shorts 틀');
    expect(seq.video.flatMap((t) => t.items.map((c) => c.name))).toEqual(expect.arrayContaining(['제목을 입력하세요', '자막을 입력하세요']));
    await expect.poll(async () => (await canvasStats(app)).luma, { timeout: 15_000 }).toBeGreaterThan(1);
    await testInfo.attach('template', { body: await app.screenshot(), contentType: 'image/png' });
  });

  test('인트로 제목은 미디어 없이도 만들어지고 슬라이드쇼는 선택이 없으면 안내만', async ({ app }) => {
    await media(app).getByRole('tab', { name: '템플릿' }).click();
    const gallery = app.getByTestId('template-gallery');
    await expect(gallery.locator('[data-template="slideshow"]').getByRole('button', { name: '만들기' })).toBeDisabled();
    await gallery.locator('[data-template="intro-title"]').getByRole('button', { name: '만들기' }).click();
    await expect(app.getByRole('status').filter({ hasText: '템플릿으로 편집본을 만들었습니다' })).toBeVisible({ timeout: 30_000 });
    await expect(ui.videoClips(app)).toHaveCount(3);
    await expect(ui.total(app)).toHaveText('00:00:05:00');
    expect(await keyframeCount(app, 'opacity', 'opacity')).toBe(0);
    const seq = await bridge(app).execute<{
      video: { items: { name: string; effects: { effect: string; params: Record<string, { keyframes: number }> }[] }[] }[];
    }>('sequence.inspect');
    const title = seq.video.flatMap((t) => t.items).find((c) => c.name === '제목을 입력하세요')!;
    expect(title.effects.find((e) => e.effect === 'opacity')!.params['opacity']!.keyframes).toBe(2);
  });
});
