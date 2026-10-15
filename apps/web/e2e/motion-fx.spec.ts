/**
 * 속도 램프·크로마키·작은 화면·흔들림 줄이기 e2e(웹, wasm 엔진, M3-2·M3-3·M3-9): 속도 탭의 프리셋이 time_remap speed 키프레임을
 * 만들고(effects.keyframes 로 확인) 배지 "램프" 와 곡선 편집기가 보인다. 효과 탭의 배경 지우기가 ultra_key 를 붙이고 스포이트가 모니터
 * 픽셀 색을 키 색으로 넣는다. 작은 화면 프리셋이 motion 위치·크기를 바꾼다. 흔들림 줄이기가 warp_stabilizer 를 붙이고 분석 잡의 진행률을
 * 상태 줄 잡 칸에 보이며(취소 가능) 끝나면 분석 시간을 상태 줄에 적는다. 1440 과 390 두 뷰포트(playwright.config.ts).
 */
import type { Page } from '@playwright/test';
import { engineSequence, expect, makeDemoSequence, test, ui } from './fixtures';

interface ShBridge {
  execute(id: string, params?: Record<string, unknown>): Promise<unknown>;
  setPlayhead(tick: number): Promise<void>;
}

const T = 254_016_000_000;

interface InspectedEffect {
  effect: string;
  enabled: boolean;
  params: Record<string, { keyframes: number; value: unknown }>;
}

function bridge(page: Page) {
  return {
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

/** 엔진의 첫 영상 클립 */
async function firstClip(page: Page): Promise<{ clip: number; duration: number; effects: InspectedEffect[] }> {
  const seq = await bridge(page).execute<{ video: { items: { clip: number; duration: number; effects: InspectedEffect[] }[] }[] }>('sequence.inspect');
  return seq.video[0]!.items[0]!;
}

/** `effects.keyframes` 로 time_remap speed 키프레임 목록 */
async function rampKeyframes(page: Page, clip: number): Promise<Array<{ time: number; value: number }>> {
  const r = await bridge(page).execute<{ params: { speed: { keyframes: Array<{ time: number; value: number }> } } }>('effects.keyframes', {
    clip,
    effect: 'time_remap',
    param: 'speed',
  });
  return r.params.speed.keyframes;
}

const inspector = (page: Page) => page.getByRole('region', { name: '속성' });

async function selectFirstClip(page: Page): Promise<void> {
  await makeDemoSequence(page);
  await bridge(page).setPlayhead(3 * T);
  await expect(ui.current(page)).toHaveText('00:00:03:00');
  await ui.videoClips(page).first().click();
  await expect(ui.status(page)).toHaveText('클립을 선택했습니다');
}

test.describe('속도 곡선(램프)', () => {
  test('프리셋은 time_remap speed 키프레임을 만들고 배지·곡선 편집기가 보이며 실행 취소 한 번에 사라진다', async ({ app }, testInfo) => {
    await selectFirstClip(app);
    const { clip } = await firstClip(app);
    await inspector(app).getByRole('tab', { name: '속도' }).click();
    const section = app.getByTestId('speed-curve-section');
    await expect(section).toBeVisible();
    await expect(section.getByRole('button', { name: '곡선 지우기' })).toBeDisabled();
    await section.getByRole('button', { name: '몽타주' }).click();
    await expect(ui.status(app)).toContainText('속도 곡선을 넣었습니다: 몽타주');
    const kfs = await rampKeyframes(app, clip);
    expect(kfs.map((k) => k.value)).toEqual([50, 100, 300]);
    expect(kfs[0]!.time).toBe(0);
    await expect(app.getByTestId('speed-curve')).toHaveAttribute('data-points', '3');
    await expect(app.getByTestId('speed-curve-summary')).toContainText('점 3개, 0.5x ~ 3x');
    await expect(ui.videoClips(app).first().locator('[data-speed-badge]')).toHaveText('램프');
    await expect(ui.videoClips(app).first().locator('[data-keyframe-markers]')).toHaveAttribute('data-keyframe-markers', '3');
    // 클립 길이는 그대로
    const after = await firstClip(app);
    expect(after.duration).toBe((await firstClip(app)).duration);
    await testInfo.attach('ramp', { body: await app.screenshot(), contentType: 'image/png' });

    // 히어로로 바꾸면 4개, 실행 취소 한 번이면 몽타주 3개로
    await section.getByRole('button', { name: '히어로' }).click();
    await expect(ui.status(app)).toContainText('히어로');
    await expect.poll(async () => (await rampKeyframes(app, clip)).length).toBe(4);
    await app.keyboard.press('Control+z');
    await expect.poll(async () => (await rampKeyframes(app, clip)).map((k) => k.value)).toEqual([50, 100, 300]);
    await expect(app.getByTestId('speed-curve')).toHaveAttribute('data-points', '3');
    // 곡선 지우기
    await section.getByRole('button', { name: '곡선 지우기' }).click();
    await expect.poll(async () => (await rampKeyframes(app, clip)).length).toBe(0);
    await expect(ui.videoClips(app).first().locator('[data-speed-badge]')).toHaveCount(0);
  });
});

test.describe('배경 지우기, 작은 화면', () => {
  test('배경 지우기 켜기는 ultra_key 를 붙이고 스포이트가 모니터 픽셀을 키 색으로 넣는다', async ({ app }) => {
    await selectFirstClip(app);
    await inspector(app).getByRole('tab', { name: '효과' }).click();
    const section = app.getByTestId('chroma-key-section');
    await section.getByRole('button', { name: '배경 지우기 켜기' }).click();
    await expect(ui.status(app)).toHaveText('효과를 추가했습니다: 배경 지우기(크로마키)');
    let { effects } = await firstClip(app);
    const key = effects.find((e) => e.effect === 'ultra_key');
    expect(key).toBeDefined();
    const rgb255 = (v: unknown) => (v as number[]).map((c) => Math.round(c * 255));
    // 엔진 기본 키 색(0, 0.8, 0.2)은 f32 라 소수가 흔들린다. 8비트로 비교
    expect(rgb255(key!.params['key_color']!.value)).toEqual([0, 204, 51, 255]);
    await expect(section.getByRole('slider', { name: '허용치' })).toHaveValue('50');
    await expect(section.getByRole('slider', { name: '부드러움' })).toHaveValue('0');

    // 스포이트: 모니터 가운데 픽셀(오로라 데모는 녹색이 아니다)
    await section.getByRole('button', { name: '스포이트', exact: true }).click();
    await expect(ui.status(app)).toContainText('클릭하세요');
    const overlay = app.getByTestId('chroma-pick-overlay');
    await expect(overlay).toBeVisible();
    const box = (await app.locator('.mon-canvas').boundingBox())!;
    await app.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(ui.status(app)).toContainText('키 색을 골랐습니다: #');
    await expect(overlay).toHaveCount(0);
    ({ effects } = await firstClip(app));
    const picked = effects.find((e) => e.effect === 'ultra_key')!;
    expect(picked.enabled).toBe(true);
    expect(rgb255(picked.params['key_color']!.value)).not.toEqual([0, 204, 51, 255]);
    // 끄기
    await section.getByRole('button', { name: '끄기' }).click();
    await expect.poll(async () => (await firstClip(app)).effects.some((e) => e.effect === 'ultra_key')).toBe(false);
  });

  test('작은 화면 프리셋은 motion 위치·크기를 모서리 값으로 바꾼다', async ({ app }) => {
    await selectFirstClip(app);
    await inspector(app).getByRole('tab', { name: '효과' }).click();
    const section = app.getByTestId('pip-section');
    await section.getByRole('radio', { name: '33%' }).click();
    await section.getByRole('button', { name: '오른쪽 위' }).click();
    await expect(ui.status(app)).toHaveText('작은 화면: 오른쪽 위 33%');
    const { effects } = await firstClip(app);
    const motion = effects.find((e) => e.effect === 'motion')!;
    expect(motion.params['scale']!.value).toBe(33);
    // 1920x1080: 여백 54, 폭 633.6 -> 가운데 x = 1920 - 54 - 316.8, y = 54 + 178.2
    const pos = motion.params['position']!.value as [number, number];
    expect(pos[0]).toBeGreaterThan(1920 / 2);
    expect(pos[1]).toBeLessThan(1080 / 2);
    expect(Math.round(pos[0])).toBe(Math.round(1920 - 54 - (1920 * 0.33) / 2));
    await expect(section.getByRole('button', { name: '오른쪽 위' })).toHaveAttribute('aria-pressed', 'true');
    await expect(app.getByTestId('transform-overlay').locator('.kf-box')).toHaveCount(1);
  });
});

test.describe('흔들림 줄이기', () => {
  test('warp_stabilizer 를 붙이고 분석 잡의 진행률을 상태 줄 잡 칸에 보이며 끝나면 분석 시간을 상태 줄에 적는다', async ({ app }, testInfo) => {
    await selectFirstClip(app);
    await inspector(app).getByRole('tab', { name: '효과' }).click();
    const section = app.getByTestId('stabilize-section');
    const t0 = Date.now();
    await section.getByRole('button', { name: '흔들림 줄이기' }).click();
    // 분석 중: 상태 줄 잡 칸(진행 막대 + "흔들림 분석 N%" + 취소)과 절의 "분석 중... N%"
    const pane = app.getByTestId('jobs-pane');
    await expect(pane).toBeVisible();
    await expect(pane.getByTestId('jobs-text')).toHaveText(/^흔들림 분석 \d+%$/);
    await expect(pane.getByRole('progressbar', { name: '흔들림 분석' })).toBeVisible();
    await expect(pane.getByTestId('jobs-cancel')).toBeVisible();
    await expect(section.getByTestId('stabilize-progress')).toContainText('분석 중...');
    // 효과는 이미 붙어 "해제" 가 보이지만 분석 중에는 잠긴다
    await expect(section.getByRole('button', { name: '해제' })).toBeDisabled();
    // 진행률이 올라간다
    const pct = async () => Number(((await pane.getByTestId('jobs-text').textContent()) ?? '').replace(/[^0-9]/g, ''));
    const first = await pct();
    await expect.poll(pct, { timeout: 120_000 }).toBeGreaterThan(first);
    await expect(ui.status(app)).toContainText('흔들림 줄이기를 적용했습니다', { timeout: 120_000 });
    await expect(pane).toHaveCount(0);
    const elapsed = Date.now() - t0;
    const status = await ui.status(app).textContent();
    testInfo.annotations.push({ type: 'analysis', description: `${status} (벽시계 ${(elapsed / 1000).toFixed(1)}초)` });
    expect(status).toMatch(/분석 \d+\.\d초, 2D 근사/);
    const { effects } = await firstClip(app);
    expect(effects.some((e) => e.effect === 'warp_stabilizer')).toBe(true);
    await expect(section.getByRole('slider', { name: '부드러움' })).toHaveValue('50');
    await section.getByRole('button', { name: '해제' }).click();
    await expect.poll(async () => (await firstClip(app)).effects.some((e) => e.effect === 'warp_stabilizer')).toBe(false);
  });

  test('상태 줄 잡 칸의 취소를 누르면 분석을 멈추고 효과를 뗀다', async ({ app }) => {
    await selectFirstClip(app);
    await inspector(app).getByRole('tab', { name: '효과' }).click();
    const section = app.getByTestId('stabilize-section');
    await section.getByRole('button', { name: '흔들림 줄이기' }).click();
    const pane = app.getByTestId('jobs-pane');
    await expect(pane.getByTestId('jobs-text')).toHaveText(/^흔들림 분석 \d+%$/);
    await expect.poll(async () => (await firstClip(app)).effects.some((e) => e.effect === 'warp_stabilizer')).toBe(true);
    await pane.getByTestId('jobs-cancel').click();
    await expect(ui.status(app)).toHaveText('흔들림 분석을 취소하고 효과를 뗐습니다', { timeout: 30_000 });
    await expect(pane).toHaveCount(0);
    await expect(app.getByRole('status').filter({ hasText: '흔들림 분석을 취소했습니다' })).toBeVisible();
    await expect.poll(async () => (await firstClip(app)).effects.some((e) => e.effect === 'warp_stabilizer')).toBe(false);
    await expect(section.getByRole('button', { name: '흔들림 줄이기' })).toBeEnabled();
  });
});
