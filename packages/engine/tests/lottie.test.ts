/**
 * 엔진 기능 테스트(움직이는 스티커, M3-4). 바인딩을 거친 실제 엔진이 화면의 Lottie 스티커 10종(features/stickers/assets/*.json)을
 * `.json` 파일로 file.import 하면 반복되는 벡터 미디어(60초, 알파)가 되고, graphics.newFromFile {duration} 이 5초 클립을 만들며,
 * renderFrame 에 그 스티커의 색 픽셀이 정해진 자리에 보이고 시각이 바뀌면 그림도 바뀌는지(애니메이션) 본다(렌더 골든: 바이트 일치
 * 대신 픽셀 사실). Lottie 가 아닌 .json 은 거부. 같은 것을 wasm 에서도 한 번 돈다(putFile). 1080p 한 장 렌더 시간을 적는다.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  T,
  cleanup,
  exec,
  hasNativeBinding,
  hasWasm,
  loadNapi,
  loadWasm,
  nonBlackPixels,
  pixelsDiffer,
  tmpDir,
  type NapiEngine,
  type SequenceInfo,
  type WasmEngine,
} from './helpers';

const ASSETS = resolve(__dirname, '../../editor/src/features/stickers/assets');
/** 스티커 문서 크기(가로 = 세로) */
const DOC = 512;
/** 1080p 가운데에 놓인 512 문서의 (x, y) 를 0.25 배율 프레임 픽셀로 */
const at = (x: number, y: number) => ({ x: Math.round((960 - DOC / 2 + x) / 4), y: Math.round((540 - DOC / 2 + y) / 4) });

type Probe = { x: number; y: number; test: (rgb: [number, number, number]) => boolean; what: string };
const red = (c: [number, number, number]) => c[0] > 180 && c[1] < 110 && c[2] < 110;
const yellow = (c: [number, number, number]) => c[0] > 200 && c[1] > 170 && c[2] < 130;
const blue = (c: [number, number, number]) => c[2] > 180 && c[0] < 140;
const lightBlue = (c: [number, number, number]) => c[2] > 200 && c[1] > 150 && c[0] < 200;
const green = (c: [number, number, number]) => c[1] > 120 && c[0] < 120 && c[2] < 120;
const white = (c: [number, number, number]) => c[0] > 220 && c[1] > 220 && c[2] > 220;

/**
 * 1.5초(45프레임) 시점에 색이 정해진 자리(문서 좌표)와 그 색. 꽃가루는 조각이 움직여 자리를 정하지 않는다.
 * 두 시각(0.2초, 0.5초)의 프레임은 서로 달라야 한다(애니메이션).
 */
const GOLDEN: Record<string, Probe | null> = {
  'heart-beat': { x: 256, y: 256, test: red, what: '하트 가운데 빨강' },
  'star-spin': { x: 256, y: 256, test: yellow, what: '별 가운데 노랑' },
  'arrow-bounce': { x: 256, y: 220, test: blue, what: '화살표 몸통 파랑' },
  'exclamation-blink': { x: 256, y: 380, test: yellow, what: '삼각형 아래쪽 노랑' },
  'loading-dots': { x: 256, y: 256, test: lightBlue, what: '가운데 점 하늘색' },
  'check-draw': { x: 446, y: 256, test: green, what: '다 그려진 원 테두리 초록' },
  confetti: null,
  'bubble-wobble': { x: 256, y: 216, test: white, what: '말풍선 안 흰색' },
  'sparkle-twinkle': { x: 216, y: 276, test: yellow, what: '큰 반짝임 가운데 노랑' },
  'pin-drop': { x: 256, y: 110, test: red, what: '핀 머리 빨강' },
};

const assets = readdirSync(ASSETS)
  .filter((f) => f.endsWith('.json'))
  .sort();

function pixel(frame: { width: number; rgba: Uint8Array | Buffer }, x: number, y: number): [number, number, number] {
  const i = (y * frame.width + x) * 4;
  return [frame.rgba[i] ?? 0, frame.rgba[i + 1] ?? 0, frame.rgba[i + 2] ?? 0];
}

/** 프레임 안 (x, y) 둘레 3x3 에서 조건을 만족하는 픽셀이 하나라도 있는가(가장자리 안티에일리어싱 여유) */
function near(frame: { width: number; height: number; rgba: Uint8Array | Buffer }, p: Probe): boolean {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (p.test(pixel(frame, p.x + dx, p.y + dy))) return true;
  return false;
}

const napi = hasNativeBinding() ? describe : describe.skip;
const wasm = hasWasm() ? describe : describe.skip;

napi('Lottie 스티커 (napi)', () => {
  let engine: NapiEngine;
  let dir: string;

  beforeAll(() => {
    engine = new (loadNapi().Engine)();
    dir = tmpDir('lottie');
    exec(engine, 'file.newProject', { name: 'lottie' });
    exec(engine, 'file.newSequence', { name: 'seq', width: 1920, height: 1080, fps: 30 });
  });
  afterAll(() => cleanup(dir));

  it('에셋이 10개다', () => {
    expect(assets).toHaveLength(10);
    expect(Object.keys(GOLDEN).sort()).toEqual(assets.map((f) => f.replace(/\.json$/, '')).sort());
  });

  it.each(assets)('%s: .json 을 가져오면 60초 반복 미디어, 5초 클립, 1.5초 프레임의 색과 움직임', (file) => {
    const id = file.replace(/\.json$/, '');
    const path = join(dir, `sticker-${file}`);
    writeFileSync(path, readFileSync(join(ASSETS, file)));
    const r = exec<{ items: number[]; errors: unknown[]; warnings?: string[] }>(engine, 'file.import', { paths: [path] });
    expect(r.errors).toEqual([]);
    expect(r.items).toHaveLength(1);
    expect(r.warnings ?? []).toEqual([]);
    const proj = exec<{ root: { children: Array<{ item?: number; type?: string; duration?: number }> } }>(engine, 'project.inspect');
    const item = proj.root.children.find((c) => c.item === r.items[0]);
    expect(item?.duration).toBe(60 * T);
    expect(item?.type).not.toBe('Still Image');
    // 화면의 스티커 넣기와 같은 호출: 빈 트랙에 duration 만큼
    // (graphics.newFromFile 은 늘 새로 가져온다. 화면은 두 번째부터 timeline.place 로 항목을 다시 쓴다)
    const g = exec<{ clip: number; item: number }>(engine, 'graphics.newFromFile', { path, time: 0, duration: 5 * T });
    expect(g.item).not.toBe(r.items[0]);
    const seq = exec<SequenceInfo>(engine, 'sequence.inspect');
    const clip = seq.video.flatMap((t) => t.items).find((c) => c.clip === g.clip)!;
    expect(clip.duration).toBe(5 * T);
    const frame = (sec: number) => {
      const f = engine.renderFrame(Math.round(sec * T), 0.25);
      if (!f) throw new Error('renderFrame');
      return f;
    };
    const f15 = frame(1.5);
    expect(f15.width).toBe(480);
    // 스티커 자리(가운데 128x128) 안에 색 픽셀이 있고, 밖(왼쪽 위 구석)은 검정
    expect(nonBlackPixels(f15.rgba)).toBeGreaterThan(id === 'check-draw' ? 200 : 400);
    expect(pixel(f15, 4, 4)).toEqual([0, 0, 0]);
    const probe = GOLDEN[id];
    if (probe) {
      const p = at(probe.x, probe.y);
      expect(near(f15, { ...probe, ...p }), `${id}: ${probe.what} at (${p.x}, ${p.y}) = ${pixel(f15, p.x, p.y)}`).toBe(true);
    }
    // 0.2초와 0.5초는 다른 그림(움직임)
    const f02 = frame(0.2);
    const f05 = frame(0.5);
    expect(pixelsDiffer(f02.rgba, f05.rgba), `${id} animates`).toBeGreaterThan(40);
    // 반복: 문서 길이 뒤의 프레임은 처음과 같다(op/fr 초 뒤)
    const doc = JSON.parse(readFileSync(join(ASSETS, file), 'utf8')) as { op: number; fr: number };
    const loop = doc.op / doc.fr;
    expect(pixelsDiffer(frame(0.5).rgba, frame(0.5 + loop).rgba), `${id} loops every ${loop}s`).toBeLessThan(8);
    exec(engine, 'edit.clear', { clips: [g.clip] });
  });

  it('Lottie 가 아닌 .json 은 가져오기를 거부한다', () => {
    const path = join(dir, 'not-lottie.json');
    writeFileSync(path, '{"hello": 1}');
    // 하나만 가져오다 실패하면 커맨드 자체가 오류다(여럿이면 errors 목록)
    expect(() => exec(engine, 'file.import', { paths: [path] })).toThrow(/not a Lottie animation/);
    expect(() => exec(engine, 'graphics.newFromFile', { path, time: 0 })).toThrow(/not a Lottie animation/);
  });

  it('1080p 한 장 렌더 시간(실측, 상한 2초)', () => {
    const path = join(dir, 'sticker-confetti.json');
    const g = exec<{ clip: number }>(engine, 'graphics.newFromFile', { path, time: 0, duration: 5 * T });
    const time = (tick: number) => {
      const t0 = performance.now();
      const f = engine.renderFrame(tick, 1.0);
      const ms = performance.now() - t0;
      if (!f) throw new Error('renderFrame');
      expect(f.width).toBe(1920);
      return ms;
    };
    const first = time(T);
    const again = time(T);
    const other = time(2 * T);
    // eslint-disable-next-line no-console
    console.log(`[lottie napi] 1080p renderFrame confetti: first ${first.toFixed(1)}ms, cached ${again.toFixed(1)}ms, new frame ${other.toFixed(1)}ms`);
    expect(first).toBeLessThan(2000);
    exec(engine, 'edit.clear', { clips: [g.clip] });
  });
});

wasm('Lottie 스티커 (wasm)', () => {
  let e: WasmEngine;

  beforeAll(async () => {
    const mod = await loadWasm();
    e = new mod.Engine();
  });
  afterAll(() => e?.free());

  function parseFrame(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
    const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
    return { width: view.getUint32(0, true), height: view.getUint32(4, true), rgba: bytes.subarray(8) };
  }

  it('putFile 한 .json 을 가져와 5초 클립으로 놓으면 프레임에 하트의 빨강이 보이고 시각마다 다르다', () => {
    exec(e, 'file.newProject', { name: 'lottie-wasm' });
    exec(e, 'file.newSequence', { name: 'seq', width: 1920, height: 1080, fps: 30 });
    const path = '/stickers/sticker-heart-beat.json';
    e.putFile(path, new Uint8Array(readFileSync(join(ASSETS, 'heart-beat.json'))));
    const g = exec<{ clip: number; item: number }>(e, 'graphics.newFromFile', { path, time: 0, duration: 5 * T });
    const seq = exec<SequenceInfo>(e, 'sequence.inspect');
    expect(seq.video.flatMap((t) => t.items).find((c) => c.clip === g.clip)?.duration).toBe(5 * T);
    const frame = (sec: number) => parseFrame(e.renderFrame(BigInt(Math.round(sec * T)), 0.25));
    const f15 = frame(1.5);
    expect(f15.width).toBe(480);
    const p = at(256, 256);
    expect(near(f15, { x: p.x, y: p.y, test: red, what: '하트' })).toBe(true);
    expect(pixelsDiffer(frame(0.2).rgba, frame(0.5).rgba)).toBeGreaterThan(40);
    const t0 = performance.now();
    const full = parseFrame(e.renderFrame(BigInt(T), 1.0));
    const ms = performance.now() - t0;
    expect(full.width).toBe(1920);
    // eslint-disable-next-line no-console
    console.log(`[lottie wasm] 1080p renderFrame heart-beat: ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(5000);
  });
});
