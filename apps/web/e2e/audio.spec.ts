/**
 * 오디오 e2e(웹): 재생 중 AudioContext 가 running 이고 블록을 당기며 A/V 드리프트가 1프레임 아래인지, 음소거 토글(버튼·M),
 * 인스펙터 "오디오" 탭의 볼륨 슬라이더가 엔진 게인을 바꾸는지, 영상에 붙은 소리 클립의 파형, 음악 탭. 헤드리스에서는
 * 소리 대신 노드 그래프 상태(window.shAudio)로 본다.
 */
import { clickRuler, expect, makeDemoSequence, test, ui } from './fixtures';

interface AudioStats {
  contextState: string;
  driftFrames: number;
  maxDriftFrames: number;
  underruns: number;
  resyncs: number;
  lastResyncFrames: number;
  chunks: number;
  fetchMs: number;
}
const audioStats = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { shAudio: { stats(): AudioStats } }).shAudio.stats());

test.describe('오디오 재생', () => {
  test('재생하면 AudioContext 가 running 이고 블록을 당기며 드리프트가 1프레임 아래다', async ({ app }) => {
    await makeDemoSequence(app);
    await app.getByRole('button', { name: '재생', exact: true }).click();
    await expect.poll(async () => (await audioStats(app)).chunks, { timeout: 10_000 }).toBeGreaterThan(3);
    const running = await audioStats(app);
    expect(running.contextState).toBe('running');
    // 1초 뒤와 3초 뒤의 어긋남을 재어 "1초에 1프레임 이하" 를 본다(절대값은 시작 직후를 빼고 2프레임 안)
    await app.waitForTimeout(1000);
    const d1 = (await audioStats(app)).driftFrames;
    await app.waitForTimeout(2000);
    const d2 = (await audioStats(app)).driftFrames;
    await app.getByRole('button', { name: '정지', exact: true }).click();
    const s = await audioStats(app);
    expect(s.chunks).toBeGreaterThan(5);
    expect(Math.abs(d2 - d1) / 2, `A/V 드리프트 변화 ${d1} -> ${d2} 프레임 (2초)`).toBeLessThan(1);
    expect(Math.abs(d2), `A/V 어긋남 ${d2} 프레임`).toBeLessThan(2);
    // 시계가 멈출 만큼 무거운 부하(동시 빌드)에서는 재동기로 다시 잇는다(2회까지 허용)
    expect(s.resyncs, `재동기 ${s.resyncs}회(마지막 ${s.lastResyncFrames} 프레임)`).toBeLessThanOrEqual(2);
    test.info().annotations.push({ type: 'audio', description: JSON.stringify({ d1, d2, ...s }) });
  });

  test('음소거 버튼과 M 키가 토글되고 보기 메뉴에 체크가 보인다', async ({ app }) => {
    await makeDemoSequence(app);
    const mute = app.getByRole('button', { name: '소리 끄기' });
    await expect(mute).toHaveAttribute('aria-pressed', 'false');
    await mute.click();
    await expect(app.getByRole('button', { name: '소리 켜기' })).toHaveAttribute('aria-pressed', 'true');
    if (app.viewportSize()?.width !== 390) await expect(app.getByRole('slider', { name: '마스터 볼륨' })).toBeDisabled();
    await app.locator('.mon-stage').click();
    await app.keyboard.press('m');
    await expect(app.getByRole('button', { name: '소리 끄기' })).toHaveAttribute('aria-pressed', 'false');
    await app.getByRole('menubar').getByRole('button', { name: '보기' }).click();
    await expect(app.getByRole('menuitemcheckbox', { name: /소리 끄기, 켜기/ })).toBeVisible();
    await app.keyboard.press('Escape');
  });
});

test.describe('인스펙터 오디오 탭', () => {
  test('소리 클립을 선택하면 오디오 탭이 보이고 볼륨 슬라이더가 엔진 게인을 바꾼다', async ({ app }) => {
    await makeDemoSequence(app);
    await app.locator('.tl-lane--audio .tl-clip').first().click();
    await expect(ui.status(app)).toHaveText('클립을 선택했습니다');
    const tab = app.getByRole('tab', { name: '오디오' });
    await expect(tab).toBeVisible();
    await tab.click();
    const slider = app.getByRole('slider', { name: '클립 볼륨(dB)' });
    await expect(slider).toBeVisible();
    // 키보드로 1 dB 씩 내리고 keyup 이 확정한다(헤드리스 크로미움은 range 트랙 클릭으로 값을 옮기지 않는다)
    await slider.focus();
    await app.keyboard.press('ArrowLeft');
    await expect(ui.status(app)).toHaveText('볼륨 -1 dB');
    await app.keyboard.press('ArrowLeft');
    await expect(ui.status(app)).toHaveText('볼륨 -2 dB');
    await expect(app.getByTestId('audio-gain-value')).toHaveText('-2 dB');
    const db = -2;
    const gain = await app.evaluate(async () => {
      const b = (window as unknown as { shBridge: { execute(id: string): Promise<unknown> } }).shBridge;
      const seq = (await b.execute('sequence.inspect')) as { audio: Array<{ items: Array<{ gainDb: number }> }> };
      return seq.audio[0]?.items[0]?.gainDb;
    });
    expect(gain).toBe(db);
    // 음소거 체크 = -96 dB
    await app.getByRole('checkbox', { name: '음소거' }).click();
    await expect(ui.status(app)).toHaveText('클립 소리를 껐습니다');
    await expect(app.getByTestId('audio-gain-value')).toHaveText('꺼짐');
    // 페이드 인 적용
    await app.getByRole('button', { name: '적용' }).first().click();
    await expect(ui.status(app)).toHaveText('페이드 인 1초를 걸었습니다');
    await expect(app.locator('.au-fade-current').first()).toHaveText('현재 1.00초');
  });
});

test.describe('파형과 음악 탭', () => {
  test('영상에 붙은 소리 클립에 파형이 그려지고 줌에 따라 열 수가 바뀐다', async ({ app }) => {
    await makeDemoSequence(app);
    const wave = app.getByTestId('clip-waveform');
    await expect(wave).toHaveCount(1);
    await expect(wave.locator('path')).toHaveAttribute('d', /^M0 .* Z$/);
    // 자르면 두 조각 모두 파형이 있다(소스 구간을 잘라 쓴다)
    await clickRuler(app, 120);
    await expect(ui.current(app)).not.toHaveText('00:00:00:00');
    await ui.tool(app, '자르기').click();
    await expect(ui.status(app)).toHaveText('자르기: 2곳');
    await expect(app.getByTestId('clip-waveform')).toHaveCount(2);
    // 줌을 바꾸면 열 수(viewBox)가 바뀐다
    const first = app.getByTestId('clip-waveform').first();
    const before = await first.getAttribute('viewBox');
    await ui.tool(app, '확대').click();
    await expect.poll(() => first.getAttribute('viewBox')).not.toBe(before);
    await app.locator('.tl-scroll').screenshot({ path: test.info().outputPath('audio-waveform.png') });
  });

  test('음악 탭에서 프로젝트의 소리를 플레이헤드 자리에 넣는다', async ({ app }) => {
    await makeDemoSequence(app);
    await app.getByRole('tab', { name: '음악' }).click();
    const lib = app.getByTestId('music-library');
    await expect(lib.getByRole('list', { name: '생성 음원' }).getByRole('listitem')).toHaveCount(6);
    const row = lib.getByRole('list', { name: '소리 항목' }).getByRole('listitem').filter({ hasText: 'Aurora_Timelapse.mp4' });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: '넣기' }).click();
    await expect(ui.status(app)).toHaveText('소리 클립을 놓았습니다');
    await expect(ui.clips(app)).toHaveCount(3);
    await expect(app.getByTestId('clip-waveform')).toHaveCount(2);
    await app.getByRole('tab', { name: '미디어' }).click();
    await expect(app.getByRole('button', { name: '데모 영상' })).toBeVisible();
  });
});
