/**
 * 오디오 정리(M3-8)·텍스트 기반 편집(M3-7) 웹 e2e: 데모 영상의 소리 클립에 "음성 깨끗하게" 를 걸면 엔진에 denoise, dereverb,
 * speech_enhance 가 붙고 "원래대로" 로 빠지는지, "소리 크기 맞추기" 뒤 상태 줄과 결과 문구, 전사 탭의 빈 상태 안내(웹: 데스크톱
 * 전용), transcript.set 으로 전사를 넣은 뒤 문장 목록·검색·이동·지우기, 클립 우클릭의 "장면마다 자르기" 토스트.
 * 데스크톱(1440)·모바일(390) 두 뷰포트(playwright.config.ts projects).
 */
import { clickRuler, engineSequence, enginePlayhead, expect, makeDemoSequence, test, toasts, ui } from './fixtures';

interface ShBridge {
  execute(id: string, params?: Record<string, unknown>): Promise<unknown>;
  playhead(): Promise<number>;
}
type Page = import('@playwright/test').Page;
const exec = <T>(page: Page, id: string, params?: Record<string, unknown>) =>
  page.evaluate(([i, p]) => (window as unknown as { shBridge: ShBridge }).shBridge.execute(i, p) as Promise<T>, [id, params] as const);

interface EssentialInfo {
  clips: Array<{ clip: number; type: string | null; effects: Array<{ effect: string; enabled: boolean }> }>;
}
interface SeqInfo {
  audio: Array<{ items: Array<{ clip: number; item: number; start: number; end: number }> }>;
  duration: number;
  in: number | null;
  out: number | null;
}

async function openAudioTab(app: Page): Promise<void> {
  await app.locator('.tl-lane--audio .tl-clip').first().click();
  await expect(ui.status(app)).toHaveText('클립을 선택했습니다');
  await app.getByRole('tab', { name: '오디오' }).click();
  await expect(app.getByTestId('audio-cleanup')).toBeVisible();
}

test.describe('음성 깨끗하게', () => {
  test('버튼 한 번으로 세 효과가 붙고 원래대로로 빠진다', async ({ app }) => {
    await makeDemoSequence(app);
    await openAudioTab(app);
    await expect(app.getByTestId('audio-clean-state')).toHaveText('적용 안 됨');
    await expect(app.getByRole('button', { name: '원래대로' })).toBeDisabled();
    // 강도 "강"
    const slider = app.getByRole('slider', { name: '음성 깨끗하게 강도' });
    await slider.focus();
    await app.keyboard.press('End');
    await expect(app.getByTestId('audio-clean-strength')).toHaveText('강');
    const t0 = Date.now();
    await app.getByRole('button', { name: '음성 깨끗하게', exact: true }).click();
    await expect(ui.status(app)).toHaveText(/^음성 깨끗하게\(강\)를 클립 1개에 적용했습니다 \([\d.]+초\)$/);
    const elapsed = Date.now() - t0;
    await expect(app.getByTestId('audio-clean-state')).toHaveText('적용됨(강)');
    const seq = await exec<SeqInfo>(app, 'sequence.inspect');
    const clip = seq.audio[0]!.items[0]!.clip;
    const info = await exec<EssentialInfo>(app, 'essentialSound.inspect', { clips: [clip] });
    expect(info.clips[0]!.type).toBe('Dialogue');
    expect(info.clips[0]!.effects.map((e) => e.effect)).toEqual(expect.arrayContaining(['denoise', 'dereverb', 'speech_enhance']));
    const status = (await ui.status(app).textContent()) ?? '';
    test.info().annotations.push({ type: 'voice-cleanup', description: `status=${status} wall=${elapsed}ms` });
    // 실행 취소 한 단계로 유형까지 돌아간다
    await app.getByRole('button', { name: '원래대로' }).click();
    await expect(ui.status(app)).toHaveText('음성 깨끗하게를 껐습니다 (클립 1개)');
    await expect(app.getByTestId('audio-clean-state')).toHaveText('적용 안 됨');
    const after = await exec<EssentialInfo>(app, 'essentialSound.inspect', { clips: [clip] });
    expect(after.clips[0]!.type).toBe('Dialogue');
    expect(after.clips[0]!.effects.filter((e) => ['denoise', 'dereverb', 'speech_enhance'].includes(e.effect))).toEqual([]);
    // 재생이 효과를 거친 소리를 내는지(AudioContext 가 running 이고 블록을 당긴다)
    await app.getByRole('button', { name: '음성 깨끗하게', exact: true }).click();
    await expect(ui.status(app)).toHaveText(/적용했습니다/);
    await app.getByRole('button', { name: '재생', exact: true }).click();
    await expect
      .poll(async () => app.evaluate(() => (window as unknown as { shAudio: { stats(): { chunks: number } } }).shAudio.stats().chunks), { timeout: 10_000 })
      .toBeGreaterThan(2);
    await app.getByRole('button', { name: '정지', exact: true }).click();
  });
});

test.describe('소리 크기 맞추기', () => {
  test('목표를 고르고 맞추면 측정값과 게인이 보인다', async ({ app }) => {
    await makeDemoSequence(app);
    await openAudioTab(app);
    await app.getByRole('radio', { name: /-16 LUFS/ }).check();
    await app.getByRole('button', { name: '소리 크기 맞추기', exact: true }).click();
    await expect(ui.status(app)).toHaveText(/^소리 크기를 -16 LUFS 로 맞췄습니다: 측정 -?[\d.]+ LUFS, 게인 [+-]?[\d.]+ dB \(클립 1개\), 정점 -?[\d.]+ dB/, {
      timeout: 30_000,
    });
    const result = app.getByTestId('audio-loudness-result');
    await expect(result).toContainText('LUFS');
    await expect(result).not.toContainText('근사');
    const seq = await exec<SeqInfo>(app, 'sequence.inspect');
    const clip = seq.audio[0]!.items[0]!.clip;
    const info = await exec<{ clips: Array<{ type: string | null; settings: { loudness: { target_lufs: number | null; measured_lufs: number | null } } }> }>(
      app,
      'essentialSound.inspect',
      { clips: [clip] },
    );
    expect(info.clips[0]!.settings.loudness.target_lufs).toBe(-16);
    expect(info.clips[0]!.settings.loudness.measured_lufs).not.toBeNull();
    test.info().annotations.push({ type: 'loudness', description: (await result.textContent()) ?? '' });
  });
});

test.describe('전사 탭', () => {
  test('전사가 없으면 자막 탭의 자동 자막으로 안내한다(웹도 자동 자막이 있다)', async ({ app }) => {
    await makeDemoSequence(app);
    await app.getByRole('tab', { name: '전사' }).click();
    const empty = app.getByTestId('transcript-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('자동 자막 만들기');
    await expect(empty.getByRole('button', { name: '자막 탭으로' })).toHaveCount(1);
    await expect(app.getByRole('list', { name: '전사 문장' })).toHaveCount(0);
  });

  test('전사를 넣으면 문장 목록, 검색, 이동, 지우기가 된다', async ({ app }) => {
    await makeDemoSequence(app);
    const T = 254_016_000_000;
    const seq = await exec<SeqInfo>(app, 'sequence.inspect');
    const item = seq.audio[0]!.items[0]!.item;
    const words = [
      ['안녕하세요', 0.2, 0.8],
      ['오늘은', 1.0, 1.4],
      ['오로라', 1.5, 2.0],
      ['편집을', 4.0, 4.4],
      ['시작합니다', 4.5, 5.2],
    ].map(([text, a, b]) => ({ text, start: (a as number) * T, end: (b as number) * T }));
    await exec(app, 'transcript.set', { item, transcript: { language: 'ko', source: 'e2e', speakers: [{ name: '진행자' }], words } });
    await app.getByRole('tab', { name: '전사' }).click();
    const rows = app.getByTestId('transcript-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('안녕하세요 오늘은 오로라');
    await expect(rows.nth(1)).toContainText('편집을 시작합니다');
    await expect(rows.nth(1)).toContainText('00:04.0');
    // 검색
    await app.getByRole('searchbox', { name: '전사 검색' }).fill('편집');
    await expect(app.locator('.tr-row--hit')).toHaveCount(1);
    await expect(app.locator('.tr-search__count')).toHaveText('1곳');
    // 문장 클릭 = 플레이헤드 이동(4초, 프레임 스냅)
    await rows.nth(1).getByRole('button').click();
    await expect(ui.current(app)).toHaveText(/^00:00:0[34]:\d\d$/);
    const { frameTicks } = await engineSequence(app);
    expect(Math.abs((await enginePlayhead(app)) - 4 * T)).toBeLessThanOrEqual(frameTicks);
    await expect(rows.nth(1)).toHaveAttribute('aria-current', 'time');
    // 두 번째 문장을 지우면 편집본이 그만큼 짧아진다
    await rows.nth(1).getByRole('checkbox').click();
    await app.getByRole('button', { name: '지우기 (1)' }).click();
    await expect(ui.status(app)).toHaveText(/^문장 1개를 지웠습니다 \(1\.[23]초\)$/);
    await expect(rows).toHaveCount(1);
    const after = await exec<SeqInfo>(app, 'sequence.inspect');
    expect(after.duration).toBeLessThan(seq.duration);
    await expect(ui.clips(app)).toHaveCount(4);
    // 무음 자동 제거: 2.0 -> (지운 뒤) 첫 문장 뒤 남은 틈은 없어 0곳
    await app.getByRole('button', { name: '무음 자동 제거' }).click();
    await expect(ui.status(app)).toHaveText(/무음/);
  });
});

test.describe('장면마다 자르기', () => {
  test('클립 우클릭 메뉴에서 실행하면 결과 토스트가 뜬다', async ({ app }) => {
    await makeDemoSequence(app);
    // 분석 시간을 줄이려고 클립을 눈금자 앞쪽에서 자르고 앞 조각만 분석한다(우클릭한 클립이 선택에 없으면 그 클립만 대상)
    await clickRuler(app, 120);
    await expect(ui.current(app)).not.toHaveText('00:00:00:00');
    await ui.tool(app, '자르기').click();
    await expect(ui.status(app)).toHaveText('자르기: 2곳');
    await expect(ui.videoClips(app)).toHaveCount(2);
    const video = ui.videoClips(app).first();
    await video.click({ button: 'right' });
    const menu = app.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: '장면마다 자르기' })).toBeEnabled();
    const t0 = Date.now();
    await menu.getByRole('menuitem', { name: '장면마다 자르기' }).click();
    // 분석은 엔진 잡: 상태 줄 잡 칸에 "장면 찾기 N%" 와 취소가 보이고 끝나면 사라진다
    const pane = app.getByTestId('jobs-pane');
    await expect(pane.getByTestId('jobs-text')).toHaveText(/^장면 찾기 \d+%$/);
    await expect(pane.getByRole('progressbar', { name: '장면 찾기' })).toBeVisible();
    await expect(toasts(app).filter({ hasText: /장면/ })).toBeVisible({ timeout: 60_000 });
    await expect(pane).toHaveCount(0);
    // 상태 줄은 우리 문구이거나, 엔진이 보낸 toast 이벤트(찾지 못했을 때 영어 문구)가 뒤이어 덮을 수 있다
    await expect(ui.status(app)).toHaveText(
      /^(장면 \d+곳에서 잘랐습니다 \(클립 1개\)|장면이 바뀌는 곳을 찾지 못했습니다|장면이 바뀌는 곳을 찾지 못했습니다\.)$/,
    );
    test.info().annotations.push({ type: 'scene-detect', description: `${(await ui.status(app).textContent()) ?? ''} wall=${Date.now() - t0}ms` });
  });
});
