/**
 * 효과·필터 e2e(M2-4): 클립 선택 뒤 인스펙터 "효과" 탭에서 효과 추가, 슬라이더, 켜기 끄기, 삭제, 실행 취소. "색" 탭 슬라이더와 초기화.
 * 미디어 패널 "필터" 탭에서 프리셋 적용·교체·해제, 비교(원본 보기). 모니터 캔버스 픽셀로 실제 렌더가 바뀌는지 본다.
 * 1440 과 390 뷰포트 둘 다(playwright.config.ts).
 */
import { expect, makeDemoSequence, test, ui } from './fixtures';
import type { Page } from '@playwright/test';

interface ShBridge {
  execute(id: string, params?: Record<string, unknown>): Promise<unknown>;
}

/** 모니터 캔버스의 평균 밝기와 회색(R=G=B 근사) 비율 */
async function canvasStats(page: Page): Promise<{ luma: number; grayish: number }> {
  await page.waitForTimeout(450);
  return page.locator('.mon-canvas').evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d');
    if (!ctx) return { luma: -1, grayish: -1 };
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let luma = 0;
    let gray = 0;
    const n = c.width * c.height;
    for (let i = 0; i < n; i++) {
      const r = d[i * 4] ?? 0;
      const g = d[i * 4 + 1] ?? 0;
      const b = d[i * 4 + 2] ?? 0;
      luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (Math.abs(r - g) <= 2 && Math.abs(g - b) <= 2) gray++;
    }
    return { luma: luma / n, grayish: gray / n };
  });
}

/** 엔진의 첫 영상 클립 효과 id 목록(SSOT) */
function engineEffects(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const b = (window as unknown as { shBridge: ShBridge }).shBridge;
    const seq = (await b.execute('sequence.inspect')) as { video: { items: { effects: { effect: string; enabled: boolean }[] }[] }[] };
    return seq.video[0]!.items[0]!.effects.map((e) => `${e.effect}${e.enabled ? '' : '(off)'}`);
  });
}

async function selectFirstClip(page: Page): Promise<void> {
  await makeDemoSequence(page);
  // 가운데 프레임으로(첫 프레임은 어두울 수 있다)
  await page.evaluate(() => (window as unknown as { shBridge: { setPlayhead(t: number): Promise<void> } }).shBridge.setPlayhead(254_016_000_000 * 3));
  await ui.videoClips(page).first().click();
  await expect(ui.status(page)).toHaveText('클립을 선택했습니다');
}

const inspector = (page: Page) => page.getByRole('region', { name: '속성' });

test.describe('효과 탭', () => {
  test('효과 추가, 슬라이더, 켜기 끄기, 삭제, 실행 취소', async ({ app }) => {
    await selectFirstClip(app);
    const panel = inspector(app);
    await expect(panel.getByRole('tab', { name: '효과' })).toBeVisible();
    await expect(panel.getByRole('tab', { name: '색' })).toBeVisible();
    await panel.getByRole('tab', { name: '효과' }).click();
    await expect(panel.getByRole('group', { name: '기본' })).toBeVisible();
    await expect(panel.getByRole('slider', { name: '불투명도' })).toHaveValue('100');
    await expect(panel.getByText('추가한 효과가 없습니다', { exact: false })).toBeVisible();
    const before = await canvasStats(app);
    expect(before.grayish).toBeLessThan(0.5);

    // 흑백 추가: 목록에 생기고 모니터가 회색이 된다
    await panel.getByRole('button', { name: '효과 추가' }).click();
    await expect(app.getByRole('menu', { name: '효과 추가' }).getByRole('menuitem')).toHaveCount(9);
    await app.getByRole('menuitem', { name: '흑백' }).click();
    await expect(ui.status(app)).toHaveText('효과를 추가했습니다: 흑백');
    await expect(panel.locator('.fx-item[data-effect="black_white"]')).toBeVisible();
    expect(await engineEffects(app)).toEqual(['black_white', 'motion', 'opacity', 'time_remap']);
    await expect.poll(async () => (await canvasStats(app)).grayish, { timeout: 10_000 }).toBeGreaterThan(0.95);

    // 끄면 다시 컬러
    await panel.getByRole('checkbox', { name: '흑백 켜기' }).click();
    await expect(ui.status(app)).toHaveText('효과를 껐습니다: 흑백');
    expect(await engineEffects(app)).toEqual(['black_white(off)', 'motion', 'opacity', 'time_remap']);
    await expect.poll(async () => (await canvasStats(app)).grayish, { timeout: 10_000 }).toBeLessThan(0.5);
    await panel.getByRole('checkbox', { name: '흑백 켜기' }).click();
    await expect(ui.status(app)).toHaveText('효과를 켰습니다: 흑백');

    // 밝기와 대비 추가 + 슬라이더: 엔진 값이 바뀌고 밝아진다
    await panel.getByRole('button', { name: '효과 추가' }).click();
    await app.getByRole('menuitem', { name: '밝기와 대비' }).click();
    await expect(ui.status(app)).toHaveText('효과를 추가했습니다: 밝기와 대비');
    const item = panel.locator('.fx-item[data-effect="brightness_contrast"]');
    await expect(item).toBeVisible();
    const lumaBefore = (await canvasStats(app)).luma;
    const slider = item.getByRole('slider', { name: '밝기' });
    await slider.fill('70');
    await slider.dispatchEvent('pointerup');
    await expect(ui.status(app)).toHaveText('효과 값을 바꿨습니다');
    await expect(item.getByRole('textbox', { name: '밝기 값' })).toHaveValue('70');
    await expect
      .poll(
        async () => {
          const seq = (await app.evaluate(() => (window as unknown as { shBridge: ShBridge }).shBridge.execute('sequence.inspect'))) as {
            video: { items: { effects: { effect: string; params: Record<string, { value: unknown }> }[] }[] }[];
          };
          return seq.video[0]!.items[0]!.effects.find((e) => e.effect === 'brightness_contrast')!.params['brightness']!.value;
        },
        { timeout: 10_000 },
      )
      .toBe(70);
    await expect.poll(async () => (await canvasStats(app)).luma, { timeout: 10_000 }).toBeGreaterThan(lumaBefore + 10);

    // 숫자 입력으로 범위 밖 값은 잘린다
    const num = item.getByRole('textbox', { name: '대비 값' });
    await num.fill('500');
    await num.press('Enter');
    await expect(num).toHaveValue('100');

    // 삭제, 실행 취소(드래그는 한 단계)
    await item.getByRole('button', { name: '밝기와 대비 삭제' }).click();
    await expect(ui.status(app)).toHaveText('효과를 삭제했습니다: 밝기와 대비');
    expect(await engineEffects(app)).toEqual(['black_white', 'motion', 'opacity', 'time_remap']);
    await ui.tool(app, '실행 취소').click();
    await expect(ui.status(app)).toHaveText('실행 취소: 효과 제거');
    await expect(item).toBeVisible();
    await expect(item.getByRole('textbox', { name: '대비 값' })).toHaveValue('100');
    await ui.tool(app, '실행 취소').click();
    await expect(ui.status(app)).toHaveText('실행 취소: 효과 값 변경');
    await expect(item.getByRole('textbox', { name: '대비 값' })).toHaveValue('0');
    await ui.tool(app, '실행 취소').click();
    await expect(ui.status(app)).toHaveText('실행 취소: 효과 값 변경');
    await expect(item.getByRole('textbox', { name: '밝기 값' })).toHaveValue('0');
    await ui.tool(app, '실행 취소').click();
    await expect(ui.status(app)).toHaveText('실행 취소: 밝기와 대비 적용');
    await expect(item).toHaveCount(0);
  });

  test('기본 묶음: 불투명도 슬라이더와 위치 입력이 고정 효과로 간다', async ({ app }) => {
    await selectFirstClip(app);
    const panel = inspector(app);
    await panel.getByRole('tab', { name: '효과' }).click();
    const lumaBefore = (await canvasStats(app)).luma;
    const op = panel.getByRole('slider', { name: '불투명도' });
    await op.fill('30');
    await op.dispatchEvent('pointerup');
    await expect(ui.status(app)).toHaveText('효과 값을 바꿨습니다');
    await expect.poll(async () => (await canvasStats(app)).luma, { timeout: 10_000 }).toBeLessThan(lumaBefore * 0.6);
    const x = panel.getByRole('textbox', { name: '위치 X' });
    await expect(x).toHaveValue('960');
    await x.fill('100');
    await x.press('Enter');
    await expect(ui.status(app)).toHaveText('효과 값을 바꿨습니다');
    await expect
      .poll(async () => {
        const seq = (await app.evaluate(() => (window as unknown as { shBridge: ShBridge }).shBridge.execute('sequence.inspect'))) as {
          video: { items: { effects: { effect: string; params: Record<string, { value: unknown }> }[] }[] }[];
        };
        return seq.video[0]!.items[0]!.effects.find((e) => e.effect === 'motion')!.params['position']!.value;
      })
      // inspect 의 파라미터는 {kind, value} JSON (docs/guides/engine-commands.md). point 는 [x, y]
      .toEqual([100, 540]);
  });
});

test.describe('색 탭', () => {
  test('채도 0 은 흑백, 초기화는 lumetri 를 뗀다', async ({ app }) => {
    await selectFirstClip(app);
    const panel = inspector(app);
    await panel.getByRole('tab', { name: '색' }).click();
    await expect(panel.getByText('슬라이더를 움직이면 색 보정 효과가 붙습니다.')).toBeVisible();
    await expect(panel.getByRole('button', { name: '초기화' })).toBeDisabled();
    const sat = panel.getByRole('slider', { name: '채도' });
    await expect(sat).toHaveValue('100');
    await sat.fill('0');
    await sat.dispatchEvent('pointerup');
    await expect(ui.status(app)).toHaveText('색을 바꿨습니다');
    expect(await engineEffects(app)).toEqual(['lumetri', 'motion', 'opacity', 'time_remap']);
    await expect.poll(async () => (await canvasStats(app)).grayish, { timeout: 10_000 }).toBeGreaterThan(0.95);
    await panel.getByRole('button', { name: '초기화' }).click();
    await expect(ui.status(app)).toHaveText('색 보정을 초기화했습니다');
    expect(await engineEffects(app)).toEqual(['motion', 'opacity', 'time_remap']);
    await expect(sat).toHaveValue('100');
  });
});

test.describe('필터 갤러리', () => {
  test('프리셋 적용, 교체, 더블클릭 해제, 비교(원본 보기)', async ({ app }) => {
    await selectFirstClip(app);
    const media = app.getByRole('region', { name: '미디어' });
    await media.getByRole('tab', { name: '필터' }).click();
    await expect(media.getByRole('toolbar', { name: '미디어 도구' })).toBeHidden();
    const gallery = media.getByRole('tabpanel', { name: '필터' });
    await expect(gallery.getByRole('option')).toHaveCount(23);
    // 썸네일은 선택 클립 첫 프레임으로 만든다
    await expect.poll(() => gallery.locator('.fx-card__thumb[style]').count(), { timeout: 15_000 }).toBe(23);

    await gallery.getByRole('option', { name: '흑백', exact: true }).click();
    await expect(ui.status(app)).toHaveText('필터를 적용했습니다: 흑백');
    await expect(gallery.getByRole('option', { name: '흑백', exact: true })).toHaveAttribute('aria-selected', 'true');
    expect(await engineEffects(app)).toEqual(['lumetri', 'motion', 'opacity', 'time_remap']);
    await expect.poll(async () => (await canvasStats(app)).grayish, { timeout: 10_000 }).toBeGreaterThan(0.95);

    // 교체: lumetri 는 하나만
    await gallery.getByRole('option', { name: '황금빛 노을' }).click();
    await expect(ui.status(app)).toHaveText('필터를 적용했습니다: 황금빛 노을');
    expect(await engineEffects(app)).toEqual(['lumetri', 'motion', 'opacity', 'time_remap']);
    await expect(gallery.getByRole('option', { name: '황금빛 노을' })).toHaveAttribute('aria-selected', 'true');
    await expect(gallery.getByRole('option', { name: '흑백', exact: true })).toHaveAttribute('aria-selected', 'false');
    await expect.poll(async () => (await canvasStats(app)).grayish, { timeout: 10_000 }).toBeLessThan(0.5);

    // 비교: 효과가 꺼지고, 돌아오면 흔적 없이 복구
    await gallery.getByRole('button', { name: '비교(원본 보기)' }).click();
    await expect(ui.status(app)).toHaveText('원본 보기: 효과를 잠시 껐습니다');
    expect(await engineEffects(app)).toEqual(['lumetri(off)', 'motion', 'opacity', 'time_remap']);
    await expect(gallery.getByRole('option', { name: '황금빛 노을' })).toBeDisabled();
    await gallery.getByRole('button', { name: '비교(원본 보기)' }).click();
    await expect(ui.status(app)).toHaveText('효과를 다시 켰습니다');
    expect(await engineEffects(app)).toEqual(['lumetri', 'motion', 'opacity', 'time_remap']);

    // 더블클릭 해제
    await gallery.getByRole('option', { name: '황금빛 노을' }).dblclick();
    await expect(ui.status(app)).toHaveText('필터를 해제했습니다');
    expect(await engineEffects(app)).toEqual(['motion', 'opacity', 'time_remap']);
    await expect(gallery.getByRole('button', { name: '필터 해제' })).toBeDisabled();

    // 자체 프리셋(효과 조합)
    await gallery.getByRole('option', { name: '빈티지' }).click();
    await expect(ui.status(app)).toHaveText('필터를 적용했습니다: 빈티지');
    expect(await engineEffects(app)).toEqual(['tint', 'vignette', 'noise', 'motion', 'opacity', 'time_remap']);
    await gallery.getByRole('button', { name: '필터 해제' }).click();
    await expect(ui.status(app)).toHaveText('필터를 해제했습니다');
    expect(await engineEffects(app)).toEqual(['motion', 'opacity', 'time_remap']);

    await media.getByRole('tab', { name: '미디어' }).click();
    await expect(media.getByRole('toolbar', { name: '미디어 도구' })).toBeVisible();
  });

  test('클립 메뉴에서도 효과를 넣고 비교를 켤 수 있다', async ({ app }) => {
    await selectFirstClip(app);
    const clipMenu = app.getByRole('menubar').getByRole('button', { name: '클립' });
    await clipMenu.click();
    await app.getByRole('menuitem', { name: '효과 추가' }).hover();
    // 하위 메뉴가 자리를 잡은 뒤 누른다(열리는 중에 누르면 메뉴만 닫힐 수 있다)
    const sub = app.locator('.ve-dropdown--sub');
    await expect(sub).toBeVisible();
    await app.waitForTimeout(250);
    await sub.getByRole('menuitem', { name: '모자이크' }).click();
    await expect(ui.status(app)).toHaveText('효과를 추가했습니다: 모자이크');
    expect(await engineEffects(app)).toEqual(['mosaic', 'motion', 'opacity', 'time_remap']);
    await clipMenu.click();
    await app.getByRole('menuitemcheckbox', { name: '비교(원본 보기)' }).click();
    await expect(ui.status(app)).toHaveText('원본 보기: 효과를 잠시 껐습니다');
    await clipMenu.click();
    await app.getByRole('menuitemcheckbox', { name: '비교(원본 보기)' }).click();
    await expect(ui.status(app)).toHaveText('효과를 다시 켰습니다');
    expect(await engineEffects(app)).toEqual(['mosaic', 'motion', 'opacity', 'time_remap']);
  });
});
