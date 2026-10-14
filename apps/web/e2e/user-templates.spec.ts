/**
 * 사용자 템플릿 e2e(웹, wasm 엔진, M3-6a): 데모 편집본에 큰 제목을 넣고 템플릿으로 저장하면 "내 템플릿" 에 카드가 생기고(IndexedDB,
 * 새로고침 뒤에도 남는다), 새 프로젝트에서 데모 영상을 고르고 적용하면 같은 구조(영상 슬롯 + 제목, 같은 크기)의 편집본이 생긴다.
 * 메뉴로 이름을 바꾸고 삭제한다. 1440 과 390 두 뷰포트(playwright.config.ts).
 */
import type { Page } from '@playwright/test';
import { expect, makeDemoSequence, test, ui } from './fixtures';

interface ShBridge {
  execute(id: string, params?: Record<string, unknown>): Promise<unknown>;
}

interface Inspect {
  name: string;
  settings: { width: number; height: number };
  video: { items: { name: string; effects: { effect: string; params: Record<string, { keyframes: number }> }[] }[] }[];
}

const inspector = (page: Page) => page.getByRole('region', { name: '속성' });
const media = (page: Page) => page.getByRole('region', { name: '미디어' });
const gallery = (page: Page) => page.getByTestId('template-gallery');

function inspect(page: Page): Promise<Inspect> {
  return page.evaluate(() => (window as unknown as { shBridge: ShBridge }).shBridge.execute('sequence.inspect')) as Promise<Inspect>;
}

/** 브라우저 안 템플릿 저장소를 비운다(다른 테스트·앞선 실행의 찌꺼기) */
async function clearTemplates(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('sh-video-editor-templates');
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      }),
  );
}

test.describe('사용자 템플릿', () => {
  test('편집본을 템플릿으로 저장하고 새 프로젝트에서 적용하면 같은 구조가 되고, 이름을 바꾸고 지운다', async ({ app }, testInfo) => {
    await clearTemplates(app);
    await makeDemoSequence(app);
    // 큰 제목(페이드 없음, 그림자) 하나
    await inspector(app).getByRole('button', { name: '큰 제목', exact: true }).click();
    await expect(ui.status(app)).toContainText('텍스트 클립을 만들었습니다');
    await expect(ui.videoClips(app)).toHaveCount(2);
    const before = await inspect(app);

    // 저장
    await media(app).getByRole('tab', { name: '템플릿' }).click();
    const g = gallery(app);
    await expect(g).toContainText('저장한 템플릿이 없습니다');
    await g.getByRole('button', { name: '지금 편집본을 템플릿으로 저장' }).click();
    const dialog = app.getByRole('dialog', { name: '편집본을 템플릿으로 저장' });
    await dialog.getByLabel('이름').fill('내 인트로');
    await dialog.getByLabel('설명').fill('데모 영상 위 큰 제목');
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(app.getByRole('status').filter({ hasText: '템플릿 "내 인트로" 을 저장했습니다' })).toBeVisible({ timeout: 30_000 });
    const card = g.locator('.tpl-card--user');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('내 인트로');
    await expect(card).toContainText('데모 영상 위 큰 제목');
    await expect(card).toContainText('슬롯 1개');
    // 썸네일(플레이헤드 프레임)이 들어간다
    await expect(card.locator('img.tpl-card__pic--thumb')).toHaveCount(1);
    await testInfo.attach('saved', { body: await app.screenshot(), contentType: 'image/png' });

    // 새로고침 뒤에도 남는다(IndexedDB). 새 프로젝트: 데모 영상을 넣고(선택됨) 적용
    await app.reload();
    await expect(app.locator('.ve-status')).toContainText(/준비됨: 커맨드 \d+개/, { timeout: 60_000 });
    await app.getByRole('button', { name: '데모 영상', exact: true }).click();
    await app.getByRole('menuitem', { name: '숲' }).click();
    await expect(app.getByRole('status').filter({ hasText: '데모 영상을 넣었습니다' })).toBeVisible();
    await media(app).getByRole('tab', { name: '템플릿' }).click();
    const card2 = gallery(app).locator('.tpl-card--user');
    await expect(card2).toHaveCount(1);
    await expect(gallery(app)).toContainText('고른 미디어 1개로');
    await card2.getByRole('button', { name: '만들기' }).click();
    await expect(app.getByRole('status').filter({ hasText: '템플릿으로 편집본을 만들었습니다' })).toBeVisible({ timeout: 30_000 });
    await expect(ui.videoClips(app)).toHaveCount(2);
    await expect(inspector(app).getByRole('tab', { name: '텍스트' })).toHaveAttribute('aria-selected', 'true');
    await expect(app.getByRole('textbox', { name: '텍스트 내용' })).toHaveValue('제목을 입력하세요');
    const after = await inspect(app);
    expect(after.name).toContain('내 인트로');
    expect(after.settings).toEqual(before.settings);
    const names = (s: Inspect) => s.video.flatMap((t) => t.items.map((c) => c.name)).sort();
    // 슬롯만 다른 미디어(숲)로 바뀌고 나머지(제목) 구조는 같다
    const isSlot = (n: string) => n.endsWith('.mp4');
    expect(names(after).filter((n) => !isSlot(n))).toEqual(names(before).filter((n) => !isSlot(n)));
    expect(names(after).filter(isSlot)).toEqual(['Misty_Forest.mp4']);
    // 숲 데모는 12초라 16초 슬롯이 미디어 길이로 잘린다
    await expect(ui.total(app)).toHaveText('00:00:12:00');

    // 이름 바꾸기(메뉴 버튼), 삭제(우클릭 메뉴 + 확인)
    await card2.getByRole('button', { name: '내 인트로 메뉴' }).click();
    await app.getByRole('menu', { name: '내 인트로 메뉴' }).getByRole('menuitem', { name: '이름 바꾸기...' }).click();
    const prompt = app.getByRole('dialog', { name: '템플릿 이름 바꾸기' });
    await prompt.getByLabel('이름').fill('바뀐 이름');
    await prompt.getByRole('button', { name: '바꾸기' }).click();
    await expect(card2).toContainText('바뀐 이름');
    await card2.click({ button: 'right' });
    await app.getByRole('menu', { name: '바뀐 이름 메뉴' }).getByRole('menuitem', { name: '삭제' }).click();
    const confirm = app.getByRole('alertdialog', { name: '템플릿 삭제' });
    await expect(confirm).toContainText('바뀐 이름');
    await confirm.getByRole('button', { name: '삭제' }).click();
    await expect(app.getByRole('status').filter({ hasText: '템플릿 "바뀐 이름" 을 지웠습니다' })).toBeVisible();
    await expect(gallery(app).locator('.tpl-card--user')).toHaveCount(0);
    await expect(gallery(app)).toContainText('저장한 템플릿이 없습니다');
  });

  test('가져오기: 템플릿 JSON 파일을 고르면 내 템플릿에 들어가고, 틀린 파일은 거부한다', async ({ app }) => {
    await clearTemplates(app);
    await media(app).getByRole('tab', { name: '템플릿' }).click();
    const g = gallery(app);
    const good = {
      format: 'sh-video-editor-template',
      version: 1,
      name: '가져온 카드',
      settings: { width: 1920, height: 1080, fps: 30 },
      slots: [],
      video: [
        {
          clips: [
            { kind: 'matte', start: 0, duration: 254_016_000_000 * 3, color: '#223344' },
            { kind: 'text', text: '가져온 제목', start: 0, duration: 254_016_000_000 * 3, size: 90 },
          ],
        },
      ],
      audio: [],
      transitions: [],
    };
    await g.getByLabel('템플릿 파일').setInputFiles({ name: 'card.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(good)) });
    await expect(app.getByRole('status').filter({ hasText: '템플릿 "가져온 카드" 을 가져왔습니다' })).toBeVisible();
    const card = g.locator('.tpl-card--user');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('미디어 없음');
    await g.getByLabel('템플릿 파일').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"x"}') });
    await expect(app.getByRole('alert').filter({ hasText: '템플릿을 가져오지 못했습니다' })).toBeVisible();
    await expect(card).toHaveCount(1);
    // 미디어 없이 만들 수 있다
    await card.getByRole('button', { name: '만들기' }).click();
    await expect(app.getByRole('status').filter({ hasText: '템플릿으로 편집본을 만들었습니다' })).toBeVisible({ timeout: 30_000 });
    await expect(ui.videoClips(app)).toHaveCount(2);
    await expect(ui.total(app)).toHaveText('00:00:03:00');
    const seq = await inspect(app);
    expect(seq.video.flatMap((t) => t.items.map((c) => c.name))).toEqual(expect.arrayContaining(['가져온 제목']));
    await clearTemplates(app);
  });
});
