/**
 * M3-5 HEVC(H.265) 소프트웨어 내보내기를 실제 엔진(napi)으로 검증한다. export.formats 에 hevc 가 available 로 있고,
 * HEVC 프리셋 두 개가 목록에 나오며, 데모 영상을 hevc 로 내보낸 mp4 를 ffprobe 가 hevc Main + aac 로 읽고 길이가 맞는지,
 * ffmpeg 가 디코드 오류 없이 끝까지 읽는지 본다. 1080p 18초 실측(HEVC 와 H.264 비교)은 HEVC_BENCH=1 일 때만.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, exec, ffprobe, hasFfprobe, hasNativeBinding, loadNapi, sleep, tmpDir, type NapiEngine, type NapiModule } from './helpers';

const native = hasNativeBinding();
const d = native ? describe : describe.skip;

let mod: NapiModule;
let work: string;

beforeAll(() => {
  if (!native) return;
  mod = loadNapi();
  work = tmpDir('export-hevc');
});
afterAll(() => {
  if (work) cleanup(work);
});

/** 데모 영상(OceanSunset, 1080p 23.976, 18초)을 V1 0초에 놓은 엔진. */
function withDemo(width: number, height: number, fps: number): NapiEngine {
  const engine = new mod.Engine();
  exec(engine, 'file.newProject', { name: 'export-hevc' });
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
async function exportTo(engine: NapiEngine, path: string, params: Record<string, unknown>, timeoutMs = 300_000) {
  const added = exec<{ added: number[] }>(engine, 'export.queue.add', { format: 'hevc', path, start: true, ...params });
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

d('HEVC 내보내기', () => {
  it('export.formats 에 hevc(확장자 mp4, 영상+소리, available) 가 있고 HEVC 프리셋 두 개가 목록에 나온다', () => {
    const engine = new mod.Engine();
    const formats = exec<Array<{ id: string; label: string; extension: string; available: boolean; video: boolean; audio: boolean }>>(engine, 'export.formats');
    const hevc = formats.find((f) => f.id === 'hevc');
    expect(hevc).toMatchObject({ extension: 'mp4', available: true, video: true, audio: true });
    expect(hevc?.label).toContain('HEVC');
    const presets = exec<{ presets: Array<{ name: string; format: string; extension: string; frameSize: [number, number] | null }> }>(
      engine,
      'export.presets.list',
      { format: 'hevc' },
    ).presets;
    expect(presets.map((p) => [p.format, p.extension, p.frameSize])).toEqual([
      ['hevc', 'mp4', [1920, 1080]],
      ['hevc', 'mp4', [3840, 2160]],
    ]);
    // 해석: AAC 48 kHz 스테레오, 비트레이트는 프리셋의 12 Mbps(H.264 1080p 20 Mbps 의 60%)
    const seqEngine = withDemo(1920, 1080, 30);
    const r = exec<{ output: { width: number; height: number; sampleRate: number; channels: number; targetKbps: number } }>(seqEngine, 'export.resolve', {
      preset: presets[0]!.name,
    });
    expect(r.output).toMatchObject({ width: 1920, height: 1080, sampleRate: 48000, channels: 2, targetKbps: 12000 });
    // 2-pass 는 HEVC 에 없다
    expect(() => exec(seqEngine, 'export.resolve', { preset: presets[0]!.name, bitrateMode: 'vbr2Pass' })).toThrow();
  });

  it('데모 2초를 320x180 hevc 로 내보내면 ffprobe 가 mp4 + hevc Main + aac 로 읽고 ffmpeg 디코드 오류가 없다', async () => {
    const engine = withDemo(320, 180, 30);
    const out = join(work, 'short.mp4');
    const { result } = await exportTo(engine, out, { range: 'custom', startSeconds: 0, endSeconds: 2, bitrateKbps: 600 });
    expect(result?.frames).toBe(60);
    expect(statSync(out).size).toBeGreaterThan(10_000);
    if (!hasFfprobe()) return;
    const probe = ffprobe(out);
    expect(probe.format.format_name).toContain('mp4');
    const video = probe.streams.find((s) => s.codec_type === 'video');
    const audio = probe.streams.find((s) => s.codec_type === 'audio');
    expect(video).toMatchObject({ codec_name: 'hevc', width: 320, height: 180 });
    expect(video?.r_frame_rate).toBe('30/1');
    // 프로파일은 helpers.ffprobe 가 묻지 않으므로 따로 묻는다: Main(8비트 4:2:0)
    const profile = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=profile', '-of', 'csv=p=0', out])
      .toString()
      .trim();
    expect(profile).toBe('Main');
    expect(audio).toMatchObject({ codec_name: 'aac' });
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

  it('소리를 빼면 비디오 트랙만 있고, 경로에 확장자가 없으면 .mp4 를 붙인다', async () => {
    const engine = withDemo(320, 180, 30);
    const out = join(work, 'silent');
    const added = exec<{ added: number[]; items: Array<{ id: number; path: string }> }>(engine, 'export.queue.add', {
      format: 'hevc',
      path: out,
      audio: false,
      range: 'custom',
      startSeconds: 0,
      endSeconds: 1,
    });
    const item = added.items.find((i) => i.id === added.added[0]);
    expect(item?.path).toBe(`${out}.mp4`);
    exec(engine, 'export.queue.start');
    const t0 = Date.now();
    while (exec<{ running: boolean }>(engine, 'export.queue.list').running) {
      engine.pumpJobs(16);
      if (Date.now() - t0 > 120_000) throw new Error('timed out');
      await sleep(20);
    }
    expect(existsSync(`${out}.mp4`)).toBe(true);
    if (!hasFfprobe()) return;
    const probe = ffprobe(`${out}.mp4`);
    expect(probe.streams.map((s) => s.codec_type)).toEqual(['video']);
    expect(ffmpegDecodeErrors(`${out}.mp4`)).toBe('');
  });

  it('실측: 1080p 18초 데모를 HEVC 1080p 프리셋과 H.264 1080p 프리셋으로 내보내 시간·크기를 적는다 (HEVC_BENCH=1)', async () => {
    if (!process.env['HEVC_BENCH']) return;
    const engine = withDemo(1920, 1080, 30);
    const presets = exec<{ presets: Array<{ name: string; format: string; frameSize: [number, number] | null }> }>(engine, 'export.presets.list').presets;
    const hevcHd = presets.find((p) => p.format === 'hevc' && p.frameSize?.[0] === 1920)!;
    const h264Hd = presets.find((p) => p.format === 'h264' && p.frameSize?.[0] === 1920)!;
    const rows: string[] = [];
    for (const [label, preset, format] of [
      ['hevc', hevcHd.name, 'hevc'],
      ['h264', h264Hd.name, 'h264'],
    ] as const) {
      const out = join(work, `bench-${label}.mp4`);
      const { seconds, result } = await exportTo(engine, out, { preset, format }, 3_600_000);
      const size = statSync(out).size;
      rows.push(
        `${label}: ${seconds.toFixed(1)}s, ${(size / 1024 / 1024).toFixed(1)} MB, ${result?.frames} frames, ${((result?.frames ?? 0) / seconds).toFixed(2)} fps`,
      );
      if (hasFfprobe()) expect(ffmpegDecodeErrors(out)).toBe('');
    }
    console.log(rows.join('\n'));
  }, 7_300_000);
});
