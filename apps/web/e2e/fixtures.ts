/**
 * 웹 e2e 공통 fixture: 콘솔 오류·페이지 오류를 모으고, 앱이 엔진과 연결될 때까지 기다린다.
 * 화면 요소는 역할·문구로 찾는다(data-testid 는 모니터 타임코드에만 있다).
 */
import { test as base, expect, type Locator, type Page } from '@playwright/test';

export interface ConsoleLog {
  errors: string[];
  warnings: string[];
}

export const test = base.extend<{ app: Page; logs: ConsoleLog }>({
  logs: async ({ page }, use) => {
    const logs: ConsoleLog = { errors: [], warnings: [] };
    page.on('console', (msg) => {
      if (msg.type() === 'error') logs.errors.push(msg.text());
      else if (msg.type() === 'warning') logs.warnings.push(msg.text());
    });
    page.on('pageerror', (err) => logs.errors.push(`pageerror: ${err.message}`));
    await use(logs);
  },
  app: async ({ page, logs }, use) => {
    await page.goto('/');
    await expect(page.locator('.ve-status')).toContainText(/준비됨: 커맨드 \d+개/, { timeout: 60_000 });
    await use(page);
    expect(logs.errors, `콘솔 오류: ${logs.errors.join('\n')}`).toEqual([]);
  },
});

export { expect };

export const ui = {
  status: (page: Page): Locator => page.locator('.ve-status .sh-pane').first(),
  timeline: (page: Page): Locator => page.getByRole('region', { name: '타임라인' }),
  clips: (page: Page): Locator => page.locator('.tl-clip'),
  videoClips: (page: Page): Locator => page.locator('.tl-lane--video .tl-clip'),
  current: (page: Page): Locator => page.getByTestId('mon-current'),
  total: (page: Page): Locator => page.getByTestId('mon-total'),
  tool: (page: Page, name: string): Locator => page.getByRole('toolbar', { name: '타임라인 도구' }).getByRole('button', { name, exact: true }),
};

/** 데모 영상(오로라)을 넣고 그 항목으로 시퀀스를 만든다. 끝나면 V1 에 클립 하나, A1 에 클립 하나. */
export async function makeDemoSequence(page: Page): Promise<void> {
  await page.getByRole('button', { name: '데모 영상' }).click();
  await page.getByRole('menuitem', { name: '오로라' }).click();
  await expect(page.getByRole('status').filter({ hasText: '데모 영상을 넣었습니다.' })).toBeVisible();
  await page.getByRole('button', { name: '시퀀스 만들기', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '으로 시퀀스를 만들었습니다.' })).toBeVisible();
  await expect(ui.videoClips(page)).toHaveCount(1);
  await expect(ui.clips(page)).toHaveCount(2);
  await expect(ui.total(page)).toHaveText('00:00:16:00');
}

/** 눈금자의 x(px, 눈금자 왼쪽 기준)를 클릭해 플레이헤드를 옮긴다. */
export async function clickRuler(page: Page, x: number): Promise<void> {
  const ruler = page.locator('.tl-ruler');
  await ruler.scrollIntoViewIfNeeded();
  await ruler.click({ position: { x, y: 6 } });
}

/** 타임코드 문자열을 비교용 프레임 수로(명목 fps 기준). 표시 순서를 따지는 데만 쓴다 */
export function timecodeToFrames(tc: string, fps = 30): number {
  const [h, m, s, f] = tc.split(':').map(Number) as [number, number, number, number];
  return ((h * 60 + m) * 60 + s) * fps + f;
}

interface ShBridge {
  playhead(): Promise<number>;
  execute(id: string, params?: Record<string, unknown>): Promise<unknown>;
}

/** QA 훅(window.shBridge)으로 엔진 플레이헤드(tick)를 읽는다. 플레이헤드 SSOT 는 엔진이다 */
export function enginePlayhead(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { shBridge: ShBridge }).shBridge.playhead());
}

/** 활성 시퀀스의 한 프레임 tick 과 길이(tick) */
export function engineSequence(page: Page): Promise<{ frameTicks: number; duration: number }> {
  return page.evaluate(async () => {
    const b = (window as unknown as { shBridge: ShBridge }).shBridge;
    const seq = (await b.execute('sequence.inspect')) as {
      duration: number;
      settings: { frame_rate: { num: number; den: number } };
    };
    return {
      frameTicks: (254_016_000_000 * seq.settings.frame_rate.den) / seq.settings.frame_rate.num,
      duration: seq.duration,
    };
  });
}
