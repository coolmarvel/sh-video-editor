/**
 * 텍스트·제목 클립과 자막 e2e(웹, wasm 엔진): 텍스트 추가(T, 속성 도구 줄) 뒤 인스펙터 "텍스트" 탭에서 내용을 바꾸면
 * 모니터가 갱신되고, 9칸 위치 프리셋과 모니터 위 끌기가 위치를 옮기며, 자막 탭에서 자막 추가·SRT 가져오기·내보내기가
 * 된다. 1440 과 390 두 뷰포트(playwright.config.ts). 한글 제목이 렌더된 스크린샷을 결과 폴더에 남긴다.
 */
import type { Page } from '@playwright/test';
import { expect, makeDemoSequence, test, ui } from './fixtures';

/** 모니터 캔버스 픽셀의 간단한 지문(검정 아닌 픽셀 수와 밝기 합). 흰 글자가 얹히면 밝기 합이 커진다 */
function canvasSignature(page: Page): Promise<{ lit: number; sum: number }> {
  return page.locator('.mon-canvas').evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d');
    if (!ctx) return { lit: -1, sum: -1 };
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const v = (data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0);
      if (v > 24) lit += 1;
      sum += v;
    }
    return { lit, sum };
  });
}

interface ShBridge {
  execute(id: string, params?: Record<string, unknown>): Promise<unknown>;
}

/** 엔진 graphics.list 로 첫 텍스트 레이어의 position(시퀀스 px)을 읽는다 */
function layerPosition(page: Page, clip: number): Promise<[number, number]> {
  return page.evaluate(async (id) => {
    const b = (window as unknown as { shBridge: ShBridge }).shBridge;
    const r = (await b.execute('graphics.list', { clip: id })) as { layers: Array<{ position: [number, number] }> };
    return r.layers[0]!.position;
  }, clip);
}

async function selectedClip(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const b = (window as unknown as { shBridge: ShBridge }).shBridge;
    const seq = (await b.execute('sequence.inspect')) as { selection: number[] };
    return seq.selection[0] ?? -1;
  });
}

const tools = (page: Page) => page.getByRole('toolbar', { name: '속성 도구' });
const textarea = (page: Page) => page.getByRole('textbox', { name: '텍스트 내용' });
const anchorGrid = (page: Page) => page.getByRole('group', { name: '위치 프리셋' });

test.describe('텍스트 클립', () => {
  test('텍스트 추가 후 인스펙터에서 내용을 바꾸면 모니터가 갱신된다', async ({ app }, testInfo) => {
    await makeDemoSequence(app);
    // 첫 프레임은 비동기로 그려진다
    await expect.poll(async () => (await canvasSignature(app)).lit, { timeout: 15_000 }).toBeGreaterThan(0);
    const before = await canvasSignature(app);

    await tools(app).getByRole('button', { name: '텍스트 추가' }).click();
    await expect(ui.status(app)).toContainText('텍스트 클립을 만들었습니다');
    // V2 에 5초 텍스트 클립이 생기고 선택된다
    await expect(ui.videoClips(app)).toHaveCount(2);
    await expect(app.locator('.tl-clip.is-selected')).toHaveCount(1);
    await expect(app.getByRole('tab', { name: '텍스트' })).toHaveAttribute('aria-selected', 'true');
    await expect(textarea(app)).toHaveValue('텍스트를 입력하세요');
    await expect(app.getByRole('combobox', { name: '글꼴', exact: true })).toHaveValue('Pretendard');

    // 텍스트가 그려지면 모니터 그림이 바뀐다
    await expect.poll(async () => (await canvasSignature(app)).sum, { timeout: 15_000 }).not.toBe(before.sum);
    const withDefault = await canvasSignature(app);

    await textarea(app).fill('안녕하세요 한글 제목\nKorean Title');
    await textarea(app).press('Control+Enter');
    await expect(ui.status(app)).toContainText('텍스트를 바꿨습니다');
    await expect(app.locator('.tl-clip.is-selected .tl-clip__name')).toContainText('안녕하세요 한글 제목');
    await expect.poll(async () => (await canvasSignature(app)).sum, { timeout: 15_000 }).not.toBe(withDefault.sum);

    // 크기를 키우면 글자 픽셀이 늘어난다
    const sizeBefore = await canvasSignature(app);
    await app.getByRole('spinbutton', { name: '크기' }).fill('160');
    await app.getByRole('spinbutton', { name: '크기' }).press('Enter');
    await expect(ui.status(app)).toContainText('글자 크기를 바꿨습니다');
    await expect.poll(async () => (await canvasSignature(app)).sum, { timeout: 15_000 }).toBeGreaterThan(sizeBefore.sum);

    // 한글 제목이 모니터에 그려진 화면을 남긴다
    const shot = testInfo.outputPath(`korean-title-${testInfo.project.name}.png`);
    await app.screenshot({ path: shot, fullPage: false });
    testInfo.attachments.push({ name: 'korean-title', path: shot, contentType: 'image/png' });
  });

  test('9칸 프리셋과 모니터 위 끌기가 위치를 옮긴다, 단축키 T 도 텍스트를 만든다', async ({ app }) => {
    await makeDemoSequence(app);
    await app.locator('.tl-ruler').click({ position: { x: 60, y: 6 } });
    await app.keyboard.press('t');
    await expect(ui.status(app)).toContainText('텍스트 클립을 만들었습니다');
    await expect(ui.videoClips(app)).toHaveCount(2);
    const clip = await selectedClip(app);
    expect(clip).toBeGreaterThan(0);
    const center = await layerPosition(app, clip);

    await anchorGrid(app).getByRole('button', { name: '오른쪽 아래' }).click();
    await expect(ui.status(app)).toContainText('텍스트 위치를 옮겼습니다');
    const corner = await layerPosition(app, clip);
    expect(corner[0]).toBeGreaterThan(center[0]);
    expect(corner[1]).toBeGreaterThan(center[1]);
    await expect(anchorGrid(app).getByRole('button', { name: '오른쪽 아래' })).toHaveAttribute('aria-pressed', 'true');

    // 가운데로 되돌린 뒤 모니터 위 상자를 왼쪽 위로 끈다(모바일에서는 모서리가 다른 패널과 겹친다)
    await anchorGrid(app).getByRole('button', { name: '가운데' }).click();
    await expect(anchorGrid(app).getByRole('button', { name: '가운데' })).toHaveAttribute('aria-pressed', 'true');
    const centered = await layerPosition(app, clip);
    expect(centered[0]).toBeLessThan(corner[0]);
    const box = app.getByTestId('text-overlay').getByRole('button').first();
    await expect(box).toBeVisible();
    const b = await box.boundingBox();
    if (!b) throw new Error('overlay box');
    await app.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await app.mouse.down();
    await app.mouse.move(b.x + b.width / 2 - 40, b.y + b.height / 2 - 30, { steps: 5 });
    await app.mouse.up();
    await expect(ui.status(app)).toContainText('텍스트 위치를 옮겼습니다');
    const dragged = await layerPosition(app, clip);
    expect(dragged[0]).toBeLessThan(centered[0]);
    expect(dragged[1]).toBeLessThan(centered[1]);
    // X 입력란도 같은 값을 보인다
    await expect(app.getByRole('spinbutton', { name: 'X' })).toHaveValue(String(Math.round(dragged[0])));
  });

  test('제목 프리셋(하단 자막 띠)은 배경을 켜고 메뉴에도 텍스트 추가가 있다', async ({ app }) => {
    await makeDemoSequence(app);
    await tools(app).getByRole('button', { name: '하단 자막 띠' }).click();
    await expect(ui.status(app)).toContainText('하단 자막 띠: 텍스트 클립을 만들었습니다');
    await expect(app.getByRole('checkbox', { name: '배경 사용' })).toBeChecked();
    await expect(app.getByRole('combobox', { name: '글꼴 스타일' })).toHaveValue('Regular');
    await app.getByRole('menubar').getByRole('button', { name: '클립' }).click();
    await expect(app.getByRole('menuitem', { name: /^텍스트 추가/ })).toContainText('T');
    await app.keyboard.press('Escape');
  });
});

test.describe('자막', () => {
  test('자막을 추가·편집하고 SRT 로 내보내고 가져온다', async ({ app }) => {
    await makeDemoSequence(app);
    await app.getByRole('tab', { name: '자막' }).click();
    const tab = app.getByTestId('captions-tab');
    await expect(tab).toContainText('자막 트랙이 없습니다');
    await expect.poll(async () => (await canvasSignature(app)).lit, { timeout: 15_000 }).toBeGreaterThan(0);
    const before = await canvasSignature(app);

    await tab.getByRole('button', { name: '자막 추가' }).click();
    await expect(ui.status(app)).toContainText('자막을 추가했습니다');
    await expect(app.getByTestId('caption-cue')).toHaveCount(1);
    await expect.poll(async () => (await canvasSignature(app)).sum, { timeout: 15_000 }).not.toBe(before.sum);

    const cueText = app.getByRole('textbox', { name: '자막 내용' });
    await cueText.fill('첫 번째 한글 자막');
    await cueText.blur();
    await expect(ui.status(app)).toContainText('자막 내용을 바꿨습니다');
    await app.getByRole('textbox', { name: '끝(초)' }).fill('1.5');
    await app.getByRole('textbox', { name: '끝(초)' }).blur();
    await expect(ui.status(app)).toContainText('자막 시간을 바꿨습니다');

    const download = app.waitForEvent('download');
    await tab.getByRole('button', { name: 'SRT 내보내기' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('자막.srt');
    const body = await (await file.createReadStream()).toArray();
    const text = Buffer.concat(body).toString('utf8');
    // 데모 시퀀스는 23.976fps 라 1.5초가 프레임 경계(1.5015초)로 맞춰진다
    expect(text).toMatch(/00:00:00,000 --> 00:00:01,50\d/);
    expect(text.trim().split('\n').pop()).toBe('첫 번째 한글 자막');

    await app.getByLabel('SRT 파일').setInputFiles({
      name: 'intro.srt',
      mimeType: 'text/plain',
      buffer: Buffer.from('1\n00:00:02,000 --> 00:00:04,000\n가져온 자막\n\n2\n00:00:05,000 --> 00:00:06,000\nSecond\n'),
    });
    await expect(ui.status(app)).toContainText('SRT 자막을 가져왔습니다');
    await expect(tab.getByRole('status')).toContainText('자막 2개를 가져왔습니다');
    await expect(app.getByTestId('caption-cue')).toHaveCount(2);
    await expect(app.getByTestId('caption-cue').first()).toContainText('');
    await expect(app.getByRole('textbox', { name: '자막 내용' }).first()).toHaveValue('가져온 자막');
  });
});
