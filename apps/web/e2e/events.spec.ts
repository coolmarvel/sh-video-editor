/**
 * 엔진 이벤트 통합과 썸네일 e2e: 화면을 거치지 않고 bridge(window.shBridge)로 엔진을 바꿔도 1초 안에 미디어·타임라인 패널이
 * 따라오는지(폴링 하나가 drainEvents 로 받는다), 미디어 패널에 엔진이 만든 썸네일 img 가 보이는지, 엔진 토스트가 알림으로 오는지.
 */
import { expect, makeDemoSequence, test, ui } from './fixtures';

interface ShBridge {
  execute(id: string, params?: Record<string, unknown>): Promise<unknown>;
  setPlayhead(tick: number): Promise<void>;
  drainEvents?(): Promise<unknown[]>;
  renderItemThumbnail?(item: number, tick: number, width: number): Promise<{ width: number; height: number }>;
}
declare global {
  interface Window {
    shBridge: ShBridge;
    /** 호출 수 측정(이 스펙만): bridge.execute 를 감싸 커맨드 id 별로 센다 */
    __shExecCounts?: Record<string, number>;
  }
}

/** 화면이 bridge.execute 로 보내는 커맨드를 id 별로 센다(같은 객체를 화면이 쓰므로 메서드를 바꾸면 화면 호출도 잡힌다) */
async function countExecutes(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const b = window.shBridge;
    const counts: Record<string, number> = {};
    window.__shExecCounts = counts;
    const orig = b.execute.bind(b);
    b.execute = (id, params) => {
      counts[id] = (counts[id] ?? 0) + 1;
      return orig(id, params);
    };
  });
}

test.describe('엔진 이벤트 통합', () => {
  test('bridge 로 직접 가져오면 1초 안에 미디어 패널이 갱신된다', async ({ app }) => {
    await expect(app.getByText('영상, 사진, 음악 파일을 여기로 끌어다 놓으세요.')).toBeVisible();
    const t0 = Date.now();
    await app.evaluate(() => window.shBridge.execute('file.importDemoFootage', { scene: 'Dunes' }));
    await expect(app.getByRole('treeitem', { name: /Dunes/ })).toBeVisible({ timeout: 1000 });
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  test('bridge 로 시퀀스를 만들고 클립을 놓으면 1초 안에 타임라인이 갱신된다', async ({ app }) => {
    const item = await app.evaluate(async () => {
      const b = window.shBridge;
      const r = (await b.execute('file.importDemoFootage', { scene: 'Forest' })) as { items: number[] };
      return r.items[0]!;
    });
    await expect(app.getByRole('treeitem', { name: /Forest/ })).toBeVisible({ timeout: 1000 });
    await app.evaluate(() => window.shBridge.execute('file.newSequence', { name: '이벤트 시퀀스', width: 1280, height: 720, fps: 30 }));
    await expect(ui.timeline(app).locator('.sh-panel__title')).toContainText('타임라인 - 이벤트 시퀀스', { timeout: 1000 });
    await app.evaluate((id) => window.shBridge.execute('timeline.place', { item: id, track: 'V1', time: 0, insert: true }), item);
    await expect(ui.videoClips(app)).toHaveCount(1, { timeout: 1000 });
    // 데모 영상 길이만큼(장면마다 다르다). 0 이 아니고 프레임 경계
    await expect(ui.total(app)).toHaveText(/^00:00:(0[1-9]|[1-5]\d):00$/);
    // 플레이헤드도 신호로 따라온다(모니터 타임코드)
    await app.evaluate(() => window.shBridge.setPlayhead(254_016_000_000 * 2));
    await expect(ui.current(app)).toHaveText('00:00:02:00', { timeout: 1000 });
  });

  test('drainEvents 는 구조화된 이벤트를 주고 폴링이 비워 간다', async ({ app }) => {
    const first = await app.evaluate(async () => {
      const b = window.shBridge;
      if (!b.drainEvents) return null;
      await b.execute('file.newSequence', { name: 'ev', width: 640, height: 360, fps: 30 });
      // 폴링과 경쟁하므로 바로 비운다. 비어 있어도(폴링이 먼저 가져감) 실패는 아니다
      return b.drainEvents();
    });
    expect(first).not.toBeNull();
    for (const e of first ?? []) {
      expect(typeof (e as { type?: unknown }).type).toBe('string');
    }
    // 위에서 테스트가 이벤트를 가로챘을 수 있으니, 다시 한 번 바꾸고 이번에는 폴링이 받게 둔다
    await app.evaluate(() => window.shBridge.execute('file.newSequence', { name: 'ev2', width: 640, height: 360, fps: 30 }));
    await expect(ui.timeline(app).locator('.sh-panel__title')).toContainText('타임라인 - ev2', { timeout: 1000 });
    // 폴링이 비운 뒤에는 빈 배열
    await expect.poll(() => app.evaluate(() => window.shBridge.drainEvents!().then((v) => v.length))).toBe(0);
  });

  test('엔진 토스트는 알림과 상태 줄로 온다', async ({ app }) => {
    // 엔진이 Toast 이벤트를 내는 커맨드(스크럽 중 소리 토글). 화면을 거치지 않았는데도 폴링이 받아 알림으로 띄운다
    const r = (await app.evaluate(() => window.shBridge.execute('audio.toggleScrubbing'))) as { scrubAudio: boolean };
    const text = r.scrubAudio ? 'Audio during scrubbing on' : 'Audio during scrubbing off';
    await expect(app.getByRole('status').filter({ hasText: text })).toBeVisible({ timeout: 1000 });
    await expect(ui.status(app)).toContainText(text);
    await expect(ui.status(app)).not.toContainText('오류:');
  });
});

test.describe('썸네일', () => {
  test('미디어 패널 항목에 엔진이 만든 썸네일 img 가 보인다', async ({ app }) => {
    await makeDemoSequence(app);
    const thumbs = app.locator('.ve-media-thumb');
    // 데모 클립 + 시퀀스 항목 둘 다 그림이 있다
    await expect(thumbs).toHaveCount(2, { timeout: 15_000 });
    const first = thumbs.first();
    await expect(first).toBeVisible();
    const box = await first.boundingBox();
    expect(box?.width).toBeCloseTo(48, 0);
    expect(box?.height).toBeCloseTo(27, 0);
    const src = await first.getAttribute('src');
    expect(src?.startsWith('data:image/png;base64,')).toBe(true);
    // 실제로 그려진 그림(검정이 아님)
    const bright = await first.evaluate((img: HTMLImageElement) => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      if (!ctx) return -1;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if ((d[i] ?? 0) > 8 || (d[i + 1] ?? 0) > 8 || (d[i + 2] ?? 0) > 8) n++;
      return n;
    });
    expect(bright).toBeGreaterThan(0);
    // 타임라인 영상 클립에도 첫 프레임 썸네일 한 장
    await expect(app.locator('.tl-lane--video .tl-clip__thumb')).toHaveCount(1, { timeout: 15_000 });
  });

  test('bridge 의 renderItemThumbnail 은 요청한 폭의 프레임을 준다', async ({ app }) => {
    const size = await app.evaluate(async () => {
      const b = window.shBridge;
      const r = (await b.execute('file.importDemoFootage', { scene: 'Plasma' })) as { items: number[] };
      const f = await b.renderItemThumbnail!(r.items[0]!, 0, 64);
      return { width: f.width, height: f.height };
    });
    expect(size).toEqual({ width: 64, height: 36 });
  });

  test('데모 넣기와 타임라인에 넣기 동안 읽기 커맨드가 중복되지 않는다(커맨드 하나에 sequence.inspect 는 패널 수만큼만)', async ({ app }) => {
    await countExecutes(app);
    await makeDemoSequence(app);
    // 폴링 두 주기(정지 250ms)가 지나도록 기다려 뒤늦은 갱신까지 센다
    await app.waitForTimeout(700);
    const counts = (await app.evaluate(() => window.__shExecCounts)) ?? {};
    console.log(`[events] execute 호출 수: ${JSON.stringify(counts)}`);
    // 데모 넣기(1 커맨드) + 타임라인에 넣기(편집본 만들기 + 놓기 + 선택 해제, 트랜잭션 하나). 실행한 쪽의 읽기와 이벤트 구독자의
    // 읽기가 같은 revision 이면 하나로 합쳐진다(features/events/revision-gate.ts). 2026-10-14 실측: 수정 전 sequence.inspect 9,
    // project.inspect 7, media.status 5 / 수정 뒤 6, 4, 3. 상한은 실측 + 1
    expect(counts['sequence.inspect'] ?? 0).toBeLessThanOrEqual(7);
    expect(counts['project.inspect'] ?? 0).toBeLessThanOrEqual(5);
    expect(counts['media.status'] ?? 0).toBeLessThanOrEqual(4);
  });
});
