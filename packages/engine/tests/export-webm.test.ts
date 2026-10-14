/**
 * M3-5 WebM(VP9/Opus) 내보내기를 실제 엔진(napi)으로 검증한다. export.formats 에 webm 이 있고, WebM 프리셋 두 개가
 * 목록에 나오며, 데모 영상을 webm 으로 내보낸 파일을 ffprobe 가 matroska,webm 컨테이너 + vp9 + opus 로 읽고 길이가 맞는지,
 * ffmpeg 가 디코드 오류 없이 끝까지 읽는지(Chrome 이 재생할 수 있는 구조) 본다. 1080p 18초 실측은 WEBM_BENCH=1 일 때만.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { T, cleanup, exec, ffprobe, hasFfprobe, hasNativeBinding, loadNapi, sleep, tmpDir, type NapiEngine, type NapiModule } from './helpers';

const native = hasNativeBinding();
const d = native ? describe : describe.skip;

let mod: NapiModule;
let work: string;

beforeAll(() => {
  if (!native) return;
  mod = loadNapi();
  work = tmpDir('export-webm');
});
afterAll(() => {
  if (work) cleanup(work);
});

/** 데모 영상(OceanSunset, 1080p 23.976, 18초)을 V1 0초에 놓은 엔진. */
function withDemo(width: number, height: number, fps: number): NapiEngine {
  const engine = new mod.Engine();
  exec(engine, 'file.newProject', { name: 'export-webm' });
  exec(engine, 'file.newSequence', { name: 'seq', width, height, fps });
  const demo = exec<{ items: number[] }>(engine, 'file.importDemoFootage', { scene: 'OceanSunset' });
  exec(engine, 'timeline.place', { item: demo.items[0], track: 'V1', time: 0, insert: true });
  return engine;
}

interface QueueItem {
  id: number;
  job: number | null;
  path: string;
  status: string;
  error: string | null;
}

/** 큐에 넣고 끝날 때까지 펌프한다. 걸린 시간(초)과 작업 결과를 돌려준다. */
async function exportTo(engine: NapiEngine, path: string, params: Record<string, unknown>, timeoutMs = 120_000) {
  const added = exec<{ added: number[] }>(engine, 'export.queue.add', { format: 'webm', path, start: true, ...params });
  const id = added.added[0]!;
  const t0 = Date.now();
  let item: QueueItem | undefined;
  while (true) {
    engine.pumpJobs(16);
    const list = exec<{ running: boolean; items: QueueItem[] }>(engine, 'export.queue.list');
    item = list.items.find((i) => i.id === id);
    if (!item) throw new Error('queue item vanished');
    if (!list.running && item.status !== 'encoding' && item.status !== 'ready') break;
    if (Date.now() - t0 > timeoutMs) throw new Error(`export timed out: ${JSON.stringify(list)}`);
    await sleep(30);
  }
  expect(item.error).toBeNull();
  expect(item.status).toBe('done');
  const jobs = exec<Array<{ id: number; result: { frames: number; bytes: number; seconds: number } | null }>>(engine, 'jobs.list');
  const job = jobs.find((j) => j.id === item!.job);
  expect(item.path).toBe(path);
  expect(existsSync(path), `${path} written`).toBe(true);
  return { seconds: (Date.now() - t0) / 1000, result: job?.result ?? null };
}

/** `ffmpeg -v error -i file -f null -`: 디코드 오류가 있으면 stderr 에 찍힌다. */
function ffmpegDecodeErrors(path: string): string {
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    return '';
  } catch (e) {
    return String((e as { stderr?: Buffer }).stderr ?? e);
  }
}

d('WebM 내보내기', () => {
  it('export.formats 에 webm(확장자 webm, 영상+소리, available) 이 있고 WebM 프리셋 두 개가 목록에 나온다', () => {
    const engine = new mod.Engine();
    const formats = exec<Array<{ id: string; label: string; extension: string; available: boolean; video: boolean; audio: boolean }>>(engine, 'export.formats');
    const webm = formats.find((f) => f.id === 'webm');
    expect(webm).toMatchObject({ extension: 'webm', available: true, video: true, audio: true });
    expect(webm?.label).toContain('WebM');
    const presets = exec<{ presets: Array<{ name: string; format: string; extension: string; frameSize: [number, number] | null }> }>(
      engine,
      'export.presets.list',
      {
        format: 'webm',
      },
    ).presets;
    expect(presets.map((p) => [p.format, p.extension, p.frameSize])).toEqual([
      ['webm', 'webm', [1920, 1080]],
      ['webm', 'webm', [1280, 720]],
    ]);
    // 해석: Opus 는 48 kHz 스테레오, 비트레이트는 프리셋의 8 Mbps
    const seqEngine = withDemo(1920, 1080, 30);
    const r = exec<{ output: { width: number; height: number; sampleRate: number; channels: number; targetKbps: number } }>(seqEngine, 'export.resolve', {
      preset: presets[0]!.name,
    });
    expect(r.output).toMatchObject({ width: 1920, height: 1080, sampleRate: 48000, channels: 2, targetKbps: 8000 });
    // 2-pass 는 WebM 에 없다
    expect(() => exec(seqEngine, 'export.resolve', { preset: presets[0]!.name, bitrateMode: 'vbr2Pass' })).toThrow();
  });

  it('데모 2초를 320x180 webm 으로 내보내면 ffprobe 가 matroska,webm + vp9 + opus 로 읽고 ffmpeg 디코드 오류가 없다', async () => {
    const engine = withDemo(320, 180, 30);
    const out = join(work, 'short.webm');
    const { result } = await exportTo(engine, out, { range: 'custom', startSeconds: 0, endSeconds: 2, bitrateKbps: 600 });
    expect(result?.frames).toBe(60);
    expect(statSync(out).size).toBeGreaterThan(10_000);
    if (!hasFfprobe()) return;
    const probe = ffprobe(out);
    expect(probe.format.format_name).toBe('matroska,webm');
    const video = probe.streams.find((s) => s.codec_type === 'video');
    const audio = probe.streams.find((s) => s.codec_type === 'audio');
    expect(video).toMatchObject({ codec_name: 'vp9', width: 320, height: 180 });
    expect(video?.r_frame_rate).toBe('30/1');
    expect(audio).toMatchObject({ codec_name: 'opus' });
    expect(Math.abs(Number(probe.format.duration) - 2)).toBeLessThan(0.05);
    expect(ffmpegDecodeErrors(out)).toBe('');
    // 프레임 수: ffprobe 로 비디오 패킷을 센다
    const packets = execFileSync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v',
      '-count_packets',
      '-show_entries',
      'stream=nb_read_packets',
      '-of',
      'csv=p=0',
      out,
    ])
      .toString()
      .trim();
    expect(Number(packets)).toBe(60);
  });

  it('소리를 빼면 비디오 트랙만 있고, 경로에 확장자가 없으면 .webm 을 붙인다', async () => {
    const engine = withDemo(320, 180, 30);
    const out = join(work, 'silent');
    const added = exec<{ added: number[]; items: Array<{ id: number; path: string }> }>(engine, 'export.queue.add', {
      format: 'webm',
      path: out,
      audio: false,
      range: 'custom',
      startSeconds: 0,
      endSeconds: 1,
    });
    const item = added.items.find((i) => i.id === added.added[0]);
    expect(item?.path).toBe(`${out}.webm`);
    exec(engine, 'export.queue.start');
    const t0 = Date.now();
    while (exec<{ running: boolean }>(engine, 'export.queue.list').running) {
      engine.pumpJobs(16);
      if (Date.now() - t0 > 60_000) throw new Error('timed out');
      await sleep(20);
    }
    expect(existsSync(`${out}.webm`)).toBe(true);
    if (!hasFfprobe()) return;
    const probe = ffprobe(`${out}.webm`);
    expect(probe.streams.map((s) => s.codec_type)).toEqual(['video']);
    expect(ffmpegDecodeErrors(`${out}.webm`)).toBe('');
  });

  it('실측: 1080p 18초 데모를 WebM 1080p 프리셋과 H.264 1080p 프리셋으로 내보내 시간·크기를 적는다 (WEBM_BENCH=1)', async () => {
    if (!process.env['WEBM_BENCH']) return;
    const engine = withDemo(1920, 1080, 30);
    const presets = exec<{ presets: Array<{ name: string; format: string; frameSize: [number, number] | null }> }>(engine, 'export.presets.list').presets;
    const webmHd = presets.find((p) => p.format === 'webm' && p.frameSize?.[0] === 1920)!;
    const h264Hd = presets.find((p) => p.format === 'h264' && p.frameSize?.[0] === 1920)!;
    const rows: string[] = [];
    for (const [label, preset, format, ext] of [
      ['webm', webmHd.name, 'webm', 'webm'],
      ['h264', h264Hd.name, 'h264', 'mp4'],
    ] as const) {
      const out = join(work, `bench-${label}.${ext}`);
      const { seconds, result } = await exportTo(engine, out, { preset, format }, 1_800_000);
      const size = statSync(out).size;
      rows.push(
        `${label}: ${seconds.toFixed(1)}s, ${(size / 1024 / 1024).toFixed(1)} MB, ${result?.frames} frames, ${((result?.frames ?? 0) / seconds).toFixed(2)} fps`,
      );
      if (hasFfprobe()) expect(ffmpegDecodeErrors(out)).toBe('');
    }
    console.log(rows.join('\n'));
  }, 3_700_000);
});
