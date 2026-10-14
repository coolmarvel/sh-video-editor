/**
 * 실매체 호환성(로드맵 0002 의 2.2 1번, M4-2). 실제 폰·카메라 파일은 저장소에 없으므로 `corpus/gen.sh` 가 ffmpeg 로
 * 그 특성(H.264 High 1080p30/60, HEVC Main, VFR, 회전 메타데이터, 모노 오디오, 4K, 조각난 MP4, 오디오만, 사진)을 흉내낸
 * 짧은 파일을 만들고, 각 파일을 napi 바인딩을 거친 실제 엔진으로 왕복한다:
 * file.import -> project.items(해상도·프레임 속도·오디오가 ffprobe 와 일치) -> 클립으로 시퀀스 -> renderFrame 세 곳이
 * 검정이 아니고 ffmpeg 가 디코드한 같은 시각의 프레임과 비슷하다(회전 반영 포함) -> razor -> 320x180 H.264 내보내기 ->
 * ffprobe 로 코덱·길이 확인. ffmpeg/ffprobe 는 오라클로만 쓴다(엔진에 링크하지 않는다).
 * 알려진 실패는 KNOWN_FAILURES 에 원인과 함께 적고 it.fails 로 남긴다(고쳐지면 테스트가 실패해서 알려 준다).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  T,
  allClips,
  assertInvariants,
  cleanup,
  exec,
  hasFfprobe,
  hasNativeBinding,
  loadNapi,
  nonBlackPixels,
  sleep,
  tmpDir,
  type NapiEngine,
  type NapiModule,
  type SequenceInfo,
} from './helpers';

const CORPUS = join(__dirname, 'corpus');
const OUT = join(CORPUS, 'out');

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const native = hasNativeBinding();
const oracles = hasFfmpeg() && hasFfprobe();
const d = native && oracles ? describe : describe.skip;

/** 파일 이름 -> 실패 원인(엔진 크레이트와 메시지). 비어 있으면 전부 통과한다는 뜻. */
const KNOWN_FAILURES: Record<string, string> = {};

interface Probe {
  video?: { codec: string; profile: string; width: number; height: number; rFps: number; avgFps: number; rotation: number; frames: number | null };
  audio?: { codec: string; rate: number; channels: number };
  duration: number;
  container: string;
}

function ratio(s: string | undefined): number {
  if (!s) return 0;
  const [n, d] = s.split('/').map(Number);
  return d ? n! / d : 0;
}

/** ffprobe 오라클: 스트림·회전·길이. 회전은 tkhd 행렬에서 ffprobe 가 읽은 각도(-180..180). */
function probe(path: string): Probe {
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,codec_name,profile,width,height,r_frame_rate,avg_frame_rate,nb_frames,sample_rate,channels:stream_side_data=rotation:format=duration,format_name',
    '-of',
    'json',
    path,
  ]).toString();
  const j = JSON.parse(out) as {
    streams: Array<{
      codec_type: string;
      codec_name: string;
      profile?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      avg_frame_rate?: string;
      nb_frames?: string;
      sample_rate?: string;
      channels?: number;
      side_data_list?: Array<{ rotation?: number }>;
    }>;
    format: { duration?: string; format_name: string };
  };
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const p: Probe = { duration: Number(j.format.duration ?? 0), container: j.format.format_name };
  if (v) {
    p.video = {
      codec: v.codec_name,
      profile: v.profile ?? '',
      width: v.width ?? 0,
      height: v.height ?? 0,
      rFps: ratio(v.r_frame_rate),
      avgFps: ratio(v.avg_frame_rate),
      rotation: v.side_data_list?.find((s) => typeof s.rotation === 'number')?.rotation ?? 0,
      frames: v.nb_frames && v.nb_frames !== 'N/A' ? Number(v.nb_frames) : null,
    };
  }
  if (a) p.audio = { codec: a.codec_name, rate: Number(a.sample_rate), channels: a.channels ?? 0 };
  return p;
}

/** 회전을 반영한 표시 크기(세로 촬영은 폭 < 높이). */
function displaySize(p: Probe): [number, number] {
  const v = p.video!;
  return Math.abs(v.rotation) % 180 === 90 ? [v.height, v.width] : [v.width, v.height];
}

/** ffmpeg 가 디코드(회전 자동 적용)해 w x h 로 줄인 `seconds` 시각의 프레임, RGBA. */
function oracleFrame(path: string, seconds: number, w: number, h: number): Uint8Array {
  const args = ['-v', 'error', '-nostdin'];
  if (seconds > 0) args.push('-ss', seconds.toFixed(6));
  args.push('-i', path, '-frames:v', '1', '-vf', `scale=${w}:${h}:flags=bilinear`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-');
  const buf = execFileSync('ffmpeg', args, { maxBuffer: 64 << 20 });
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** 두 RGBA 프레임의 RGB 평균 절대 오차(0..255). */
function meanAbsDiff(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 3 < Math.min(a.length, b.length); i += 4) {
    sum += Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
    n += 3;
  }
  return n ? sum / n : 255;
}

const isStill = (f: string) => /\.(png|jpe?g)$/i.test(f);
const isAudioOnly = (p: Probe) => !p.video && !!p.audio;

let mod: NapiModule;
let work: string;
let files: string[] = [];
const report: string[] = [];

beforeAll(() => {
  if (!native || !oracles) return;
  mod = loadNapi();
  work = tmpDir('media-compat');
  execFileSync('bash', [join(CORPUS, 'gen.sh')], { stdio: 'ignore' });
  files = readdirSync(OUT)
    .filter((f) => !f.startsWith('.'))
    .sort();
});
afterAll(() => {
  if (work) cleanup(work);
  if (report.length) console.log(['', '실매체 코퍼스 결과', ...report].join('\n'));
});

async function exportTo(engine: NapiEngine, path: string): Promise<void> {
  const added = exec<{ added: number[] }>(engine, 'export.queue.add', { format: 'h264', width: 320, height: 180, path, start: true });
  const id = added.added[0]!;
  const t0 = Date.now();
  while (true) {
    engine.pumpJobs(16);
    const list = exec<{ running: boolean; items: Array<{ id: number; status: string; error: string | null }> }>(engine, 'export.queue.list');
    const item = list.items.find((i) => i.id === id)!;
    if (!list.running && item.status !== 'encoding' && item.status !== 'ready') {
      expect(item.error, 'export error').toBeNull();
      expect(item.status).toBe('done');
      return;
    }
    if (Date.now() - t0 > 180_000) throw new Error(`export timed out: ${JSON.stringify(list)}`);
    await sleep(20);
  }
}

d('실매체 코퍼스 왕복', () => {
  it('코퍼스가 만들어졌다(영상·오디오·사진)', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(
      files.some((f) => f.includes('hevc')),
      'libx265 로 만든 HEVC 파일',
    ).toBe(true);
    expect(files.some((f) => f.includes('rotate90'))).toBe(true);
    expect(files.some((f) => f.includes('vfr'))).toBe(true);
    expect(files.some((f) => f.endsWith('.mp3'))).toBe(true);
  });

  it('Linux 바인딩에는 하드웨어 디코더가 없다(hw: none), Windows 는 Media Foundation', () => {
    const hw = mod.hardwareDecoder();
    if (process.platform === 'win32') expect(hw).toBe('Media Foundation');
    else if (process.platform === 'darwin') expect(hw).toBe('VideoToolbox');
    else expect(hw).toBeNull();
    expect(mod.engineVersion()).toContain(`hw: ${hw ?? 'none'}`);
  });

  // 파일 목록은 beforeAll 뒤에야 알 수 있으므로 생성기가 만드는 이름을 여기서도 나열한다(없는 파일은 skip).
  const EXPECTED = [
    'galaxy_h264_high_1080p30_aac48k.mp4',
    'h264_high_1080p60.mp4',
    'iphone_hevc_main_1080p30.mp4',
    'screenrec_h264_vfr.mp4',
    'rotate90_portrait_h264.mp4',
    'rotate180_h264.mp4',
    'mono_audio_h264_720p.mp4',
    'h264_4k_2160p30.mp4',
    'fragmented_h264_720p.mp4',
    'audio_only.mp3',
    'audio_only.m4a',
    'photo.png',
    'photo.jpg',
  ];

  for (const file of EXPECTED) {
    const known = KNOWN_FAILURES[file];
    const t = known ? it.fails : it;
    t(`${file}${known ? ` (알려진 실패: ${known})` : ''}`, async () => {
      const path = join(OUT, file);
      if (!existsSync(path)) {
        report.push(`${file}: 생성 안 됨(인코더 없음), skip`);
        return;
      }
      const p = probe(path);
      const engine = new mod.Engine();
      exec(engine, 'file.newProject', { name: 'compat' });

      // 1. 가져오기
      const imp = exec<{ items: number[]; errors: string[] }>(engine, 'file.import', { paths: [path] });
      expect(imp.errors, 'import errors').toEqual([]);
      expect(imp.items).toHaveLength(1);
      const item = imp.items[0]!;

      // 2. 프로젝트 패널 열이 ffprobe 와 일치
      const rows = exec<{ rows: Array<{ item?: number; cells?: Record<string, string> }> }>(engine, 'project.items', { recursive: true });
      const cells = rows.rows.find((r) => r.item === item)?.cells ?? {};
      const notes: string[] = [];
      if (p.video) {
        const [ew, eh] = displaySize(p);
        // 프로젝트 패널의 Video Info 는 "W x H (PAR)"
        expect(cells['Video Info'], 'Video Info').toMatch(new RegExp(`^${ew} x ${eh}( \\(|$)`));
        const fps = parseFloat(cells['Frame Rate'] ?? '');
        if (!isStill(file)) {
          expect(fps, 'Frame Rate').toBeGreaterThan(0);
          const vfr = Math.abs(p.video.rFps - p.video.avgFps) > 0.01;
          if (vfr) notes.push(`VFR: 엔진 ${fps} fps, ffprobe r=${p.video.rFps} avg=${p.video.avgFps.toFixed(2)}`);
          else expect(fps, 'Frame Rate vs r_frame_rate').toBeCloseTo(p.video.rFps, 2);
        }
      }
      // 프로젝트 패널의 Audio Info 는 "<rate> Hz - Mono|Stereo|5.1|N ch"
      const channelLabel = { 1: 'Mono', 2: 'Stereo', 6: '5.1' }[p.audio?.channels ?? 0] ?? `${p.audio?.channels} ch`;
      if (p.audio) expect(cells['Audio Info'], 'Audio Info').toBe(`${p.audio.rate} Hz - ${channelLabel}`);
      else expect(cells['Audio Info'] ?? '').toBe('');

      // 3. 클립 크기·프레임 속도로 시퀀스를 만들고 클립을 놓는다
      const made = exec<{ sequence: number; clips: number[] }>(engine, 'file.newSequenceFromClip', { items: [item] });
      expect(made.clips.length).toBeGreaterThanOrEqual(1);
      const seq = exec<SequenceInfo>(engine, 'sequence.inspect');
      assertInvariants(seq, { frameAligned: false });
      if (p.video) {
        const [ew, eh] = displaySize(p);
        expect([seq.settings.width, seq.settings.height], 'sequence size follows display rotation').toEqual([ew, eh]);
      }
      const tracksWithClips = seq.video.filter((v) => v.items.length).length + seq.audio.filter((a) => a.items.length).length;
      expect(tracksWithClips).toBe((p.video ? 1 : 0) + (p.audio ? 1 : 0));
      const durationS = seq.duration / T;
      if (!isStill(file)) {
        // 미디어 길이(사진은 기본 정지 길이라 비교하지 않는다). 1 프레임 + 오디오 프라이밍 여유
        const tol = (p.video ? 1 / Math.max(p.video.avgFps, 1) : 0) + 0.1;
        expect(Math.abs(durationS - p.duration), `duration ${durationS} vs ffprobe ${p.duration}`).toBeLessThan(tol);
      }

      // 4. 세 곳의 프레임: 영상은 검정이 아니고, 오디오만이면 검정(시퀀스 기본 크기)
      const ft = (T * seq.settings.frame_rate.den) / seq.settings.frame_rate.num;
      const lastTick = Math.max(0, Math.floor((seq.duration - 1) / ft) * ft);
      const longest = Math.max(seq.settings.width, seq.settings.height);
      const scale = Math.min(1, 480 / longest);
      for (const tick of [0, Math.floor(seq.duration / 2 / ft) * ft, lastTick]) {
        const fr = engine.renderFrame(tick, scale);
        expect(fr, `frame at ${tick / T}s`).not.toBeNull();
        const total = fr!.width * fr!.height;
        const lit = nonBlackPixels(fr!.rgba);
        if (p.video) expect(lit / total, `non-black share at ${tick / T}s`).toBeGreaterThan(0.1);
        else expect(lit).toBe(0);
      }

      // 5. ffmpeg 가 디코드한 같은 시각의 프레임과 비교(회전·색·내용). VFR 은 이웃 프레임이 잡힐 수 있어 느슨하게
      if (p.video) {
        const at = isStill(file) ? 0 : Math.min(1, Math.floor(durationS / 2 / (1 / 30)) / 30);
        const tick = Math.round(at * T);
        const fr = engine.renderFrame(tick, scale)!;
        if (isStill(file) || Math.abs(p.video.rotation) % 180 === 90) {
          expect(fr.width < fr.height, 'portrait frame').toBe(
            p.video.rotation !== 0 && Math.abs(p.video.rotation) % 180 === 90 ? p.video.width > p.video.height : p.video.width < p.video.height,
          );
        }
        const ref = oracleFrame(path, at, fr.width, fr.height);
        const mad = meanAbsDiff(fr.rgba, ref);
        const vfr = Math.abs(p.video.rFps - p.video.avgFps) > 0.01;
        notes.push(`frame@${at}s MAD ${mad.toFixed(1)}`);
        expect(mad, `mean abs diff vs ffmpeg at ${at}s`).toBeLessThan(vfr ? 40 : 20);
      }

      // 6. razor (2초, 짧으면 중간)
      const cutAt = Math.floor(Math.min(2 * T, seq.duration / 2) / ft) * ft;
      const cut = exec<{ cuts: number }>(engine, 'timeline.razor', { time: cutAt });
      expect(cut.cuts).toBe(tracksWithClips);
      const after = exec<SequenceInfo>(engine, 'sequence.inspect');
      assertInvariants(after, { frameAligned: false });
      expect(allClips(after)).toHaveLength(tracksWithClips * 2);
      expect(after.duration).toBe(seq.duration);

      // 7. 320x180 H.264 내보내기 -> ffprobe
      const out = join(work, `${file}.out.mp4`);
      const t0 = Date.now();
      await exportTo(engine, out);
      const exportMs = Date.now() - t0;
      const q = probe(out);
      expect(q.video).toMatchObject({ codec: 'h264', width: 320, height: 180 });
      expect(q.video!.rFps).toBeCloseTo(seq.settings.frame_rate.num / seq.settings.frame_rate.den, 2);
      expect(Math.abs(q.duration - durationS), `export duration ${q.duration} vs sequence ${durationS}`).toBeLessThan(1 / q.video!.rFps + 0.15);
      if (p.audio) expect(q.audio?.codec).toBe('aac');
      notes.push(`export ${q.duration.toFixed(2)}s ${q.audio ? 'with' : 'no'} audio, ${exportMs} ms`);
      report.push(`${file}: OK. ${cells['Video Info'] ?? '-'} ${cells['Frame Rate'] ?? ''} ${cells['Audio Info'] ?? ''}; ${notes.join('; ')}`);
    });
  }

  it('깨진 파일(앞부분만 남은 MP4)은 예외일 뿐 크래시하지 않는다', () => {
    const src = join(OUT, 'galaxy_h264_high_1080p30_aac48k.mp4');
    if (!existsSync(src)) return;
    const bytes = readFileSync(src);
    const head = join(work, 'truncated-head.mp4');
    writeFileSync(head, bytes.subarray(0, 64 * 1024));
    const engine = new mod.Engine();
    exec(engine, 'file.newProject', { name: 'broken' });
    // faststart 라 moov 가 앞에 있다: 인덱스는 읽히고 샘플 데이터가 없다. 가져오기가 예외이거나, 되더라도 프레임이 거부돼야 한다
    let imported: { items: number[]; errors: string[] } | null = null;
    try {
      imported = exec(engine, 'file.import', { paths: [head] });
    } catch (e) {
      report.push(`truncated-head.mp4: import rejected (${(e as Error).message.slice(0, 120)})`);
    }
    if (imported && imported.items.length) {
      exec(engine, 'file.newSequenceFromClip', { items: imported.items });
      const fr = engine.renderFrame(T, 0.25);
      report.push(
        `truncated-head.mp4: imported with ${imported.errors.length} errors, frame ${fr ? `${fr.width}x${fr.height} lit=${nonBlackPixels(fr.rgba)}` : 'null'}`,
      );
    }
    const tail = join(work, 'truncated-tail.mp4');
    writeFileSync(tail, bytes.subarray(bytes.length - 64 * 1024));
    expect(() => exec(engine, 'file.import', { paths: [tail] })).toThrow();
    expect(mod.engineVersion()).toBeTruthy();
  });
});
