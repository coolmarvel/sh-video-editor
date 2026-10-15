/**
 * 사용성 피드백 반영 e2e(웹, 1440 과 390): 첫 화면 안내 카드, 데모 영상을 빈 타임라인에 끌어다 놓으면 편집본 자동 생성,
 * 미디어 우클릭 메뉴로 삭제, Delete 키 삭제, 토스트 자동 닫힘·닫기, 클립 우클릭 메뉴, Alt 드래그 트림이 한쪽만 움직이는지,
 * 도움말 > 사용 안내(상세는 usage.spec.ts), 소리로 싱크 맞추기.
 */
import { enginePlayhead, engineSequence, expect, makeDemoSequence, test, toasts, ui } from './fixtures';

const T = 254_016_000_000;

interface ShBridge {
  execute(id: string, params?: Record<string, unknown>): Promise<unknown>;
}
interface Clip {
  clip: number;
  start: number;
  end: number;
  link: number | null;
  name: string;
}
interface Seq {
  video: Array<{ id: number; items: Clip[] }>;
  audio: Array<{ id: number; items: Clip[] }>;
  selection: number[];
}
const seqOf = (page: Parameters<typeof enginePlayhead>[0]) =>
  page.evaluate(async () => (await (window as unknown as { shBridge: ShBridge }).shBridge.execute('sequence.inspect')) as Seq);

test.describe('첫 화면 안내', () => {
  test('편집본이 없으면 타임라인 자리에 네 단계 안내 카드와 버튼 두 개가 보이고, 시퀀스라는 말이 화면에 없다', async ({ app }) => {
    const card = ui.timeline(app).getByLabel('사용 안내');
    await expect(card).toBeVisible();
    await expect(card.getByText('미디어 가져오기')).toBeVisible();
    await expect(card.getByText('타임라인으로 끌어다 놓기')).toBeVisible();
    await expect(card.getByText('자르고 다듬기')).toBeVisible();
    await expect(card.getByText('내보내기', { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: '파일 가져오기' })).toBeVisible();
    await expect(card.getByRole('button', { name: '데모 영상 넣기' })).toBeEnabled();
    await expect(app.getByRole('menubar')).not.toContainText('시퀀스');
    await expect(app.getByRole('menubar').getByRole('button', { name: '타임라인' })).toBeVisible();
    expect(await app.locator('body').innerText()).not.toContain('시퀀스');
  });

  test('도움말 > 사용 안내는 사용법 문서(docs/guides/usage.md)를 대화상자로 보인다', async ({ app }) => {
    await app.getByRole('menubar').getByRole('button', { name: '도움말' }).click();
    await app.getByRole('menuitem', { name: '사용 안내' }).click();
    const dialog = app.getByRole('dialog', { name: '사용 안내' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { level: 1, name: 'SH Video Editor 사용법' })).toBeVisible();
    await expect(dialog.getByRole('navigation', { name: '목차' })).toBeVisible();
    await dialog.getByRole('button', { name: '확인' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('데모 영상 넣기 버튼은 데모 영상 6개로 데모 편집본을 만든다', async ({ app }) => {
    await ui.timeline(app).getByLabel('사용 안내').getByRole('button', { name: '데모 영상 넣기' }).click();
    await expect(ui.timeline(app).locator('.sh-panel__title')).toContainText('타임라인 - 데모 편집본', { timeout: 30_000 });
    await expect(ui.videoClips(app)).toHaveCount(6);
    const media = app.getByRole('region', { name: '미디어' });
    await expect(media.getByTitle('데모 편집본 (편집본)')).toBeVisible();
    await expect(app.locator('.mon-canvas')).toBeVisible();
  });
});

test.describe('미디어와 타임라인', () => {
  test('데모 영상을 빈 타임라인(안내 카드)에 끌어다 놓으면 그 영상 설정의 편집본이 자동으로 생긴다', async ({ app }) => {
    await app.getByRole('button', { name: '데모 영상', exact: true }).click();
    await app.getByRole('menuitem', { name: '바다 노을' }).click();
    const item = app.getByRole('region', { name: '미디어' }).getByTitle('Ocean_Sunset.mp4 (영상)');
    await expect(item).toBeVisible();
    await item.dragTo(ui.timeline(app).getByLabel('사용 안내'));
    await expect(ui.timeline(app).locator('.sh-panel__title')).toContainText('타임라인 - 제목 없음');
    await expect(ui.clips(app)).toHaveCount(2);
    await expect(ui.total(app)).toHaveText('00:00:18:00');
    const { frameTicks } = await engineSequence(app);
    expect(frameTicks).toBe((T * 1001) / 24000);
    await expect(toasts(app).filter({ hasText: '편집을 시작합니다' })).toBeVisible();
    // 더블클릭하면 끝에 덧붙는다
    await item.dblclick();
    await expect(ui.videoClips(app)).toHaveCount(2);
    await expect(toasts(app).filter({ hasText: '타임라인 끝에 넣었습니다' })).toBeVisible();
  });

  test('미디어 우클릭 메뉴로 삭제하면 확인 뒤 항목과 타임라인 클립이 사라진다', async ({ app }) => {
    await makeDemoSequence(app);
    const media = app.getByRole('region', { name: '미디어' });
    const item = media.getByTitle('Aurora_Timelapse.mp4 (영상)');
    await item.click({ button: 'right' });
    const menu = app.getByRole('menu', { name: 'Aurora_Timelapse.mp4 메뉴' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText(['타임라인에 넣기', '새 편집본으로 열기', '이름 바꾸기...', '폴더 만들기...', /^삭제/]);
    await menu.getByRole('menuitem', { name: /^삭제/ }).click();
    const confirm = app.getByRole('alertdialog', { name: '삭제' });
    await expect(confirm).toContainText('타임라인에 놓인 클립도 함께 사라집니다');
    await confirm.getByRole('button', { name: '삭제' }).click();
    await expect(item).toHaveCount(0);
    await expect(ui.clips(app)).toHaveCount(0);
    await expect(ui.status(app)).toHaveText('삭제: 1개');
    // 이름 바꾸기 대화상자
    await media.getByTitle('제목 없음 (편집본)').click({ button: 'right' });
    await app.getByRole('menuitem', { name: '이름 바꾸기...' }).click();
    const prompt = app.getByRole('dialog', { name: '이름 바꾸기' });
    await prompt.getByLabel('이름').fill('첫 편집');
    await prompt.getByRole('button', { name: '바꾸기' }).click();
    await expect(media.getByTitle('첫 편집 (편집본)')).toBeVisible();
    await expect(ui.timeline(app).locator('.sh-panel__title')).toContainText('타임라인 - 첫 편집');
  });

  test('미디어 패널에서 항목을 고르고 Delete 를 누르면 그 항목이 지워진다(타임라인 선택은 그대로)', async ({ app }) => {
    await makeDemoSequence(app);
    await app.getByRole('button', { name: '데모 영상', exact: true }).click();
    await app.getByRole('menuitem', { name: '숲' }).click();
    const media = app.getByRole('region', { name: '미디어' });
    const forest = media.getByTitle('Misty_Forest.mp4 (영상)');
    await expect(forest).toBeVisible();
    await forest.click();
    await app.keyboard.press('Delete');
    await app.getByRole('alertdialog', { name: '삭제' }).getByRole('button', { name: '삭제' }).click();
    await expect(forest).toHaveCount(0);
    await expect(ui.clips(app)).toHaveCount(2);
    // 타임라인을 누른 뒤 Delete 는 클립 삭제
    await ui.videoClips(app).first().click();
    await expect(app.locator('.tl-clip.is-selected')).toHaveCount(2);
    await app.keyboard.press('Delete');
    await expect(ui.status(app)).toHaveText('삭제: 클립 2개');
    await expect(ui.clips(app)).toHaveCount(0);
  });

  test('크롬 글꼴은 맑은 고딕 우선이고 굵기를 흉내 내지 않는다(번진 굵은 글씨 방지)', async ({ app }) => {
    const root = app.locator('.ve-root');
    await expect(root).toHaveCSS('font-synthesis-weight', 'none');
    const family = await root.evaluate((e) => getComputedStyle(e).fontFamily);
    expect(family.startsWith('"Malgun Gothic"')).toBe(true);
  });

  test('토스트는 6초 뒤 사라지고 닫기 버튼으로 바로 닫힌다', async ({ app }) => {
    await app.getByRole('button', { name: '데모 영상', exact: true }).click();
    await app.getByRole('menuitem', { name: '오로라' }).click();
    const toast = toasts(app).filter({ hasText: '데모 영상을 넣었습니다' });
    await expect(toast).toBeVisible();
    await expect(toast.getByRole('button', { name: '알림 닫기' })).toBeVisible();
    await expect(toast).toHaveCount(0, { timeout: 8000 });
    await app.getByRole('button', { name: '데모 영상', exact: true }).click();
    await app.getByRole('menuitem', { name: '숲' }).click();
    const second = toasts(app).filter({ hasText: '데모 영상을 넣었습니다' });
    await expect(second).toBeVisible();
    await second.getByRole('button', { name: '알림 닫기' }).click();
    await expect(second).toHaveCount(0);
    // 미디어 패널 안에는 인라인 알림이 없다
    await expect(app.getByRole('region', { name: '미디어' }).locator('.sh-alert')).toHaveCount(0);
  });
});

test.describe('클립 우클릭과 Alt 드래그', () => {
  test('클립 우클릭 메뉴에 자르기·삭제·소리 분리·싱크·음소거가 있고, 소리 분리 뒤 연결 아이콘이 사라진다', async ({ app }) => {
    await makeDemoSequence(app);
    await expect(app.locator('.tl-clip__link')).toHaveCount(2);
    await ui.videoClips(app).first().click({ button: 'right' });
    const menu = app.getByRole('menu', { name: 'Aurora_Timelapse.mp4 메뉴' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText([
      /^자르기/,
      /^삭제/,
      /^리플 삭제/,
      '복제',
      /^속도, 길이/,
      '장면마다 자르기',
      '흔들림 줄이기',
      /^소리 분리\(연결 해제\)/,
      '소리로 싱크 맞추기',
      /^끄기/,
      '이름 바꾸기...',
    ]);
    await menu.getByRole('menuitem', { name: '소리 분리(연결 해제)' }).click();
    await expect(toasts(app).filter({ hasText: '소리를 분리했습니다' })).toBeVisible();
    await expect(app.locator('.tl-clip__link')).toHaveCount(0);
    // 소리 클립 메뉴는 음소거 문구, 빈 레인은 타임라인 메뉴
    await app.locator('.tl-lane--audio .tl-clip').first().click({ button: 'right' });
    await expect(app.getByRole('menuitem', { name: '음소거' })).toBeVisible();
    await app.keyboard.press('Escape');
    await expect(app.getByRole('menu')).toHaveCount(0);
    await app
      .locator('.tl-lane--video')
      .first()
      .click({ button: 'right', position: { x: 1200, y: 10 } });
    await expect(app.getByRole('menu', { name: '타임라인 메뉴' })).toBeVisible();
    await app.keyboard.press('Escape');
  });

  test('Alt 를 누르고 소리 클립 시작을 끌면 영상은 그대로다(보통 드래그는 둘 다)', async ({ app }) => {
    await makeDemoSequence(app);
    const audio = app.locator('.tl-lane--audio .tl-clip').first();
    const handle = audio.locator('.tl-clip__handle--in');
    await expect(handle).toHaveAttribute('title', '끌어서 길이 조절. Alt 를 누르면 소리/영상만');
    // hover 가 핸들을 화면 안으로 스크롤하고 포인터를 그 위에 둔다(모바일은 타임라인이 세로로 스크롤된다)
    await handle.hover();
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await app.keyboard.down('Alt');
    await app.mouse.down();
    await app.mouse.move(x + 30, y, { steps: 5 });
    await app.mouse.move(x + 60, y, { steps: 5 });
    await app.mouse.up();
    await app.keyboard.up('Alt');
    await expect(ui.status(app)).toContainText('(이 클립만)');
    let seq = await seqOf(app);
    expect(seq.video[0]!.items[0]!.start).toBe(0);
    expect(seq.audio[0]!.items[0]!.start).toBeGreaterThan(0);
    expect(seq.video[0]!.items[0]!.link).toBe(seq.audio[0]!.items[0]!.link);
    // 보통 드래그는 둘 다 움직인다
    const vhandle = ui.videoClips(app).first().locator('.tl-clip__handle--in');
    await vhandle.hover();
    const vbox = (await vhandle.boundingBox())!;
    const vx = vbox.x + vbox.width / 2;
    const vy = vbox.y + vbox.height / 2;
    await app.mouse.down();
    await app.mouse.move(vx + 30, vy, { steps: 5 });
    await app.mouse.move(vx + 60, vy, { steps: 5 });
    await app.mouse.up();
    await expect(ui.status(app)).toContainText('시작 트림');
    await expect(ui.status(app)).not.toContainText('(이 클립만)');
    seq = await seqOf(app);
    expect(seq.video[0]!.items[0]!.start).toBeGreaterThan(0);
    expect(seq.audio[0]!.items[0]!.start).toBeGreaterThan(seq.video[0]!.items[0]!.start);
  });

  test('소리로 싱크 맞추기: 1초 밀어 둔 같은 소리의 클립을 영상에 맞춰 되돌린다', async ({ app }) => {
    await makeDemoSequence(app);
    // 따로 녹음한 소리처럼 같은 소스를 A2 에 1초 늦게 놓는다(QA 훅)
    await app.evaluate(async (tick) => {
      const b = (window as unknown as { shBridge: ShBridge }).shBridge;
      const s = (await b.execute('sequence.inspect')) as { audio: Array<{ id: number; items: Array<{ item: number }> }> };
      await b.execute('timeline.place', { item: s.audio[0]!.items[0]!.item, track: 'A2', time: tick, insert: false });
    }, T);
    await app.getByRole('menubar').getByRole('button', { name: '보기' }).click();
    await app.getByRole('menuitem', { name: '타임라인 전체 보기' }).click();
    await expect(ui.clips(app)).toHaveCount(3);
    await ui.videoClips(app).first().click();
    await app
      .locator('.tl-lane--audio')
      .nth(1)
      .locator('.tl-clip')
      .click({ modifiers: ['Shift'] });
    await expect(app.locator('.tl-clip.is-selected')).toHaveCount(3);
    await app.locator('.tl-lane--audio').nth(1).locator('.tl-clip').click({ button: 'right' });
    await app.getByRole('menuitem', { name: '소리로 싱크 맞추기' }).click();
    await expect(toasts(app).filter({ hasText: '기준으로 클립 1개를 옮겨 싱크를 맞췄습니다' })).toBeVisible({ timeout: 30_000 });
    const seq = await seqOf(app);
    expect(seq.audio[1]!.items[0]!.start).toBe(0);
    expect(seq.video[0]!.items[0]!.start).toBe(0);
    expect(await enginePlayhead(app)).toBeGreaterThanOrEqual(0);
  });
});
