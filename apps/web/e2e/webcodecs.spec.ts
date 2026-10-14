/**
 * WebCodecs 디코더(M4-4): cross-origin isolation 이 있는 실제 Chromium 에서 H.264 corpus 를 넣으면 엔진이 브라우저
 * 디코더(perf.stats 의 decode.hardware.backend "WebCodecs")로 그리고, 하드웨어 디코딩을 끄고 다시 연 같은 파일(소프트웨어
 * 디코더)과 같은 그림이 나온다. corpus 가 없으면(`packages/engine/tests/corpus/gen.sh`) skip.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';

const H264 = join(import.meta.dirname, '..', '..', '..', 'packages', 'engine', 'tests', 'corpus', 'out', 'galaxy_h264_high_1080p30_aac48k.mp4');

interface Bridge {
  version(): Promise<string>;
  execute(id: string, params?: Record<string, unknown>): Promise<unknown>;
  registerFiles(files: File[]): Promise<string[]>;
  renderFrame(tick: number, scale: number): Promise<{ width: number; height: number; rgba: Uint8ClampedArray } | null>;
}

interface Result {
  version: string;
  isolated: boolean;
  hw: { backend: string | null; frames: number; sessions: number; fallbacks: number; declined: number };
  size: [number, number];
  meanDiff: number;
  bright: number;
}

test.describe('WebCodecs', () => {
  test('H.264 는 브라우저 디코더로 그리고 소프트웨어 디코더와 같은 그림이다', async ({ app }) => {
    test.skip(!existsSync(H264), 'H.264 corpus 없음');
    const b64 = readFileSync(H264).toString('base64');
    const r: Result = await app.evaluate(async (b64) => {
      const b = (window as unknown as { shBridge: Bridge }).shBridge;
      const T = 254_016_000_000;
      const tick = Math.round(10 * (T / 30));
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const stats = async () => ((await b.execute('perf.stats')) as { decode: { hardware: Result['hw'] } }).decode.hardware;
      const render = async (name: string): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }> => {
        const paths = await b.registerFiles([new File([bytes], name, { type: 'video/mp4' })]);
        const imp = (await b.execute('file.import', { paths })) as { items: number[] };
        await b.execute('file.newSequence', { name, width: 1920, height: 1080, fps: 30 });
        await b.execute('timeline.place', { item: imp.items[0], track: 'V1', time: 0, insert: true });
        const f = await b.renderFrame(tick, 0.5);
        if (!f) throw new Error('프레임 없음');
        return f;
      };
      await b.execute('file.newProject', { name: 'webcodecs' });
      const web = await render('galaxy-webcodecs.mp4');
      const hw = await stats();
      await b.execute('prefs.set', { key: 'playback.hardwareDecoding', value: 'off' });
      const sw = await render('galaxy-software.mp4');
      await b.execute('prefs.set', { key: 'playback.hardwareDecoding', value: 'auto' });
      let sum = 0;
      let bright = 0;
      for (let i = 0; i < web.rgba.length; i += 4) {
        sum +=
          Math.abs((web.rgba[i] ?? 0) - (sw.rgba[i] ?? 0)) +
          Math.abs((web.rgba[i + 1] ?? 0) - (sw.rgba[i + 1] ?? 0)) +
          Math.abs((web.rgba[i + 2] ?? 0) - (sw.rgba[i + 2] ?? 0));
        if ((web.rgba[i] ?? 0) > 8 || (web.rgba[i + 1] ?? 0) > 8 || (web.rgba[i + 2] ?? 0) > 8) bright += 1;
      }
      return {
        version: await b.version(),
        isolated: globalThis.crossOriginIsolated === true,
        hw,
        size: [web.width, web.height],
        meanDiff: sum / ((web.rgba.length / 4) * 3),
        bright,
      };
    }, b64);
    expect(r.isolated).toBe(true);
    expect(r.version).toContain('hw: WebCodecs');
    expect(r.hw.backend).toBe('WebCodecs');
    expect(r.hw.sessions).toBeGreaterThanOrEqual(1);
    expect(r.hw.frames).toBeGreaterThan(0);
    expect(r.hw.fallbacks).toBe(0);
    expect(r.size).toEqual([960, 540]);
    expect(r.bright).toBeGreaterThan(960 * 540 * 0.5);
    // 두 디코더 모두 규격 적합이라 같은 YUV 를 내고, 같은 색 변환을 거치므로 거의 같은 RGB 가 나온다
    expect(r.meanDiff).toBeLessThan(1.0);
  });
});
