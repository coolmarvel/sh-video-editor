/**
 * 병렬 인코더(VP9 타일 열, HEVC WPP, AV1 행 단위 결정; docs/guides/webm-export.md 4절)와 H.264 슬라이스가 웹(wasm, 한 스레드)과
 * 데스크톱(napi, 여러 스레드)에서 같은 파일을 쓰는지 본다: 같은 편집본을 WebM·H.264·HEVC·AV1 로 두 엔진에서 내보내 바이트가 같고,
 * ffprobe 코덱·프레임 수가 맞고 ffmpeg 가 오류 없이 디코드한다. 편집본은 슈퍼블록·CTU 행이 여럿인 크기(400x240)라 병렬 경로를 지난다.
 *
 * 영상만(audio: false), 데모 장면은 OceanSunset: 두 엔진에서 화면 렌더가 비트 단위로 같다. 데모 생성기는 sin·exp·powf·atan2 를
 * 쓰는데 C 라이브러리(네이티브)와 Rust libm(브라우저 wasm)의 마지막 비트가 가끔 달라 Aurora 화면은 30 프레임 중 3 프레임의 5 샘플이
 * 1 다르고 OceanSunset 소리도 1초에 한 샘플이 다르다(2026-10-16 측정). 그 차이로 예전에 "HEVC 는 wasm 과 napi 바이트가 다르다" 로
 * 보였지만 인코더 탓이 아니다: hevcenc·h264enc(내보내기는 슬라이스 수를 높이로 정한다)·opusenc 는 같은 입력이면 두 타깃에서 같은 바이트.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, exec, ffprobe, hasFfprobe, hasNativeBinding, hasWasm, loadNapi, loadWasm, sleep, tmpDir, type NapiModule, type WasmModule } from './helpers';

const ready = hasNativeBinding() && hasWasm();
const d = ready ? describe : describe.skip;

let napi: NapiModule;
let wasm: WasmModule;
let work: string;

beforeAll(async () => {
  if (!ready) return;
  napi = loadNapi();
  wasm = await loadWasm();
  work = tmpDir('export-parallel');
});
afterAll(() => {
  if (work) cleanup(work);
});

type Engine = { execute(id: string, p?: string | null): string; pumpJobs(ms: number): boolean };

function setup(engine: Engine): void {
  exec(engine, 'file.newProject', { name: 'parallel' });
  exec(engine, 'file.newSequence', { name: 'seq', width: 400, height: 240, fps: 30 });
  const demo = exec<{ items: number[] }>(engine, 'file.importDemoFootage', { scene: 'OceanSunset' });
  exec(engine, 'timeline.place', { item: demo.items[0], track: 'V1', time: 0, insert: true });
}

async function exportOne(engine: Engine, path: string, format: string, kbps: number): Promise<void> {
  const added = exec<{ added: number[] }>(engine, 'export.queue.add', {
    format,
    path,
    start: true,
    width: 400,
    height: 240,
    bitrateKbps: kbps,
    range: 'custom',
    startSeconds: 0,
    endSeconds: 1,
    audio: false,
  });
  const id = added.added[0]!;
  for (let i = 0; i < 200_000; i++) {
    engine.pumpJobs(16);
    const list = exec<{ running: boolean; items: Array<{ id: number; status: string; error: string | null }> }>(engine, 'export.queue.list');
    const item = list.items.find((x) => x.id === id)!;
    if (!list.running && item.status !== 'encoding' && item.status !== 'ready') {
      expect(item.error).toBeNull();
      expect(item.status).toBe('done');
      return;
    }
    await sleep(5);
  }
  throw new Error('export did not finish');
}

d('병렬 인코더: wasm(한 스레드)과 napi(여러 스레드)가 같은 파일', () => {
  for (const [format, ext, codec, kbps, same] of [
    ['webm', 'webm', 'vp9', 1500, true],
    ['h264', 'mp4', 'h264', 1500, true],
    ['hevc', 'mp4', 'hevc', 1500, true],
    ['av1', 'mp4', 'av1', 1500, true],
  ] as const) {
    it(`${format}: ${same ? '바이트가 같고 ' : ''}ffprobe ${codec}·30 프레임, ffmpeg 디코드 오류 0`, async () => {
      const native = new napi.Engine();
      setup(native);
      const nativePath = join(work, `native.${ext}`);
      await exportOne(native, nativePath, format, kbps);

      const web = new wasm.Engine();
      setup(web);
      const webPath = `/out/web.${ext}`;
      await exportOne(web, webPath, format, kbps);
      const bytes = web.takeWrittenFile(webPath);
      expect(bytes, 'wasm wrote the file').toBeDefined();
      web.free();

      const fromNative = readFileSync(nativePath);
      if (same) expect(Buffer.from(bytes!).equals(fromNative), `${format}: wasm ${bytes!.length} bytes vs napi ${fromNative.length}`).toBe(true);
      if (hasFfprobe()) {
        const webFile = join(work, `web.${ext}`);
        writeFileSync(webFile, bytes!);
        for (const file of [webFile, nativePath]) {
          const probe = ffprobe(file);
          const video = probe.streams.find((s) => s.codec_type === 'video');
          expect(video?.codec_name).toBe(codec);
          const frames = execFileSync(
            'ffprobe',
            ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file],
            {
              encoding: 'utf8',
            },
          ).trim();
          expect(Number(frames)).toBe(30);
          const errors = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
          expect(errors).toBe('');
        }
      }
    }, 600_000);
  }
});
