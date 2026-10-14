/**
 * 엔진 기능 테스트(키프레임·스티커, M3-1·M3-4). 실제 엔진(napi)에서 위치 키프레임 두 개 사이의 중간 프레임이 선형 보간 위치에
 * 그려지는지(픽셀 중심), 홀드·이즈 보간이 선형과 다른지, 불투명도 0 -> 100 에서 밝기가 오르는지, 화면 모델(features/keyframes/model.ts)
 * 의 value_at 이식이 엔진과 1px 이내인지, 스티커 PNG 를 file.import 한 뒤 renderFrame 에 색 픽셀이 있는지, graphics.newFromFile 이
 * 빈 영상 트랙에 5초 클립을 만드는지 본다. 엔진 결과만 보고 화면은 부르지 않는다.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeKeyframe, valueAt } from '../../editor/src/features/keyframes/model';
import { presetKeyframes, motionPreset } from '../../editor/src/features/keyframes/presets';
import { T, allClips, cleanup, exec, hasNativeBinding, loadNapi, tmpDir, type NapiEngine, type SequenceInfo } from './helpers';

interface ParamInfo {
  keyframes: number;
  value: string;
}
interface ClipFx {
  clip: number;
  start: number;
  end: number;
  item: number;
  effects: Array<{ effect: string; params: Record<string, ParamInfo> }>;
}

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    let c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** 단색 원(투명 바탕) PNG. 화면의 스티커 래스터 결과와 같은 모양(RGBA8) */
function circlePng(size: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const r = size / 2 - 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      if (Math.hypot(x - size / 2, y - size / 2) <= r) {
        raw[i] = rgb[0];
        raw[i + 1] = rgb[1];
        raw[i + 2] = rgb[2];
        raw[i + 3] = 255;
      }
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

describe.skipIf(!hasNativeBinding())('키프레임·스티커(napi)', () => {
  let engine: NapiEngine;
  let dir: string;
  let png: string;
  let sticker: ClipFx;

  const clipOf = (id: number): ClipFx => {
    const seq = exec<SequenceInfo>(engine, 'sequence.inspect');
    const c = (allClips(seq) as unknown as ClipFx[]).find((x) => x.clip === id);
    if (!c) throw new Error(`clip ${id}`);
    return c;
  };
  const param = (id: number, effect: string, name: string): ParamInfo => {
    const fx = clipOf(id).effects.find((e) => e.effect === effect);
    const p = fx?.params[name];
    if (!p) throw new Error(`${effect}.${name}`);
    return p;
  };
  /** 초록 픽셀의 무게중심(시퀀스 px)과 수 */
  const centroid = (tick: number) => {
    const f = engine.renderFrame(tick, 0.25);
    if (!f) throw new Error('renderFrame');
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = 0; y < f.height; y++) {
      for (let x = 0; x < f.width; x++) {
        const i = (y * f.width + x) * 4;
        if ((f.rgba[i + 1] ?? 0) > 128 && (f.rgba[i] ?? 0) < 80 && (f.rgba[i + 2] ?? 0) < 80) {
          sx += x;
          sy += y;
          n++;
        }
      }
    }
    return { x: n ? (sx / n) * 4 : -1, y: n ? (sy / n) * 4 : -1, n };
  };
  const greenMean = (tick: number) => {
    const f = engine.renderFrame(tick, 0.25);
    if (!f) throw new Error('renderFrame');
    let s = 0;
    for (let i = 1; i < f.rgba.length; i += 4) s += f.rgba[i] ?? 0;
    return s / (f.width * f.height);
  };

  beforeAll(() => {
    engine = new (loadNapi().Engine)();
    dir = tmpDir('keyframes');
    png = join(dir, 'sticker-check.png');
    writeFileSync(png, circlePng(200, [0, 255, 0]));
    exec(engine, 'file.newProject', { name: 'kf' });
    exec(engine, 'file.newSequence', { name: 'seq', width: 1920, height: 1080, fps: 30 });
  });
  afterAll(() => cleanup(dir));

  it('스티커 PNG 를 file.import 하면 사진 항목이 되고, 플레이헤드 위 빈 트랙에 5초 클립으로 놓이며, 프레임에 색 픽셀이 있다', () => {
    const r = exec<{ items: number[]; errors: unknown[] }>(engine, 'file.import', { paths: [png] });
    expect(r.errors).toEqual([]);
    expect(r.items).toHaveLength(1);
    const proj = exec<{ root: { children: Array<{ item?: number; type?: string; name?: string }> } }>(engine, 'project.inspect');
    const item = proj.root.children.find((c) => c.item === r.items[0]);
    expect(item?.type).toBe('Still Image');
    const placed = exec<{ clips: number[] }>(engine, 'timeline.place', { item: r.items[0], track: 'V1', time: 0, duration: 5 * T, insert: false });
    sticker = clipOf(placed.clips[0]!);
    expect(sticker.end - sticker.start).toBe(5 * T);
    expect(sticker.effects.map((e) => e.effect)).toEqual(['motion', 'opacity', 'time_remap']);
    const c = centroid(T);
    // 200px 원이 가운데(960, 540). 0.25 배율이라 넓이는 약 pi * 25^2
    expect(c.n).toBeGreaterThan(1500);
    expect(c.n).toBeLessThan(2600);
    expect(Math.abs(c.x - 960)).toBeLessThan(6);
    expect(Math.abs(c.y - 540)).toBeLessThan(6);
    // 화면의 스티커 넣기와 같은 graphics.newFromFile 도 빈 트랙(V2)에 5초 클립을 만든다
    const g = exec<{ clip: number; item: number }>(engine, 'graphics.newFromFile', { path: png, time: 0 });
    const seq = exec<SequenceInfo>(engine, 'sequence.inspect');
    expect(seq.video[1]!.items.map((x) => x.clip)).toEqual([g.clip]);
    expect(seq.video[1]!.items[0]!.duration).toBe(5 * T);
    exec(engine, 'edit.clear', { clips: [g.clip] });
    expect(exec<SequenceInfo>(engine, 'sequence.inspect').video[1]!.items).toHaveLength(0);
  });

  it('위치 키프레임 두 개(200 -> 1720) 사이 중간 프레임은 선형 보간 위치(1px 이내)에 그려진다', () => {
    const id = sticker.clip;
    expect(param(id, 'motion', 'position').keyframes).toBe(0);
    exec(engine, 'effects.addKeyframe', { clip: id, effect: 'motion', param: 'position', time: 0 });
    expect(param(id, 'motion', 'position').keyframes).toBe(1);
    exec(engine, 'effects.setParam', { clip: id, effect: 'motion', param: 'position', value: [200, 540], time: 0 });
    exec(engine, 'effects.setParam', { clip: id, effect: 'motion', param: 'position', value: [1720, 540], time: 4 * T });
    expect(param(id, 'motion', 'position').keyframes).toBe(2);
    // inspect 의 value 는 플레이헤드(0) 시점의 보간값을 JSON 으로 준다(엔진 커맨드 보강 뒤). 전체 목록은 effects.keyframes
    expect(param(id, 'motion', 'position').value).toEqual([200, 540]);
    const start = centroid(0);
    const mid = centroid(2 * T);
    const quarter = centroid(T);
    const end = centroid(4 * T);
    expect(Math.abs(start.x - 200)).toBeLessThan(4);
    expect(Math.abs(end.x - 1720)).toBeLessThan(4);
    expect(Math.abs(mid.x - 960)).toBeLessThan(4);
    expect(Math.abs(quarter.x - 580)).toBeLessThan(4);
    // 화면 모델의 보간이 엔진과 같다
    const track = [makeKeyframe(0, [200, 540]), makeKeyframe(4 * T, [1720, 540])];
    expect((valueAt(track, 2 * T, [0, 0]) as [number, number])[0]).toBe(960);
    expect((valueAt(track, T, [0, 0]) as [number, number])[0]).toBe(580);
  });

  it('홀드는 앞 값을 유지하고, 이즈아웃은 느리게 시작하며(화면 모델과 같다), 되돌리면 선형이다', () => {
    const id = sticker.clip;
    exec(engine, 'effects.setInterpolation', { clip: id, effect: 'motion', param: 'position', mediaTime: 0, interpolation: 'hold' });
    expect(Math.abs(centroid(2 * T).x - 200)).toBeLessThan(4);
    exec(engine, 'effects.setInterpolation', { clip: id, effect: 'motion', param: 'position', mediaTime: 0, interpolation: 'easeOut' });
    const eased = centroid(T).x;
    expect(eased).toBeLessThan(580 - 50);
    const track = [{ ...makeKeyframe(0, [200, 540]), interp: 'easeOut' as const }, makeKeyframe(4 * T, [1720, 540])];
    expect(Math.abs((valueAt(track, T, [0, 0]) as [number, number])[0] - eased)).toBeLessThan(4);
    // 없는 시각은 거부
    expect(() => exec(engine, 'effects.setInterpolation', { clip: id, effect: 'motion', param: 'position', mediaTime: 3 * T, interpolation: 'hold' })).toThrow(
      /no keyframe/,
    );
    exec(engine, 'effects.setInterpolation', { clip: id, effect: 'motion', param: 'position', mediaTime: 0, interpolation: 'linear' });
    expect(Math.abs(centroid(T).x - 580)).toBeLessThan(4);
  });

  it('moveKeyframe, deleteKeyframe, addKeyframe 토글, toggleAnimation 이 개수를 바꾼다', () => {
    const id = sticker.clip;
    exec(engine, 'effects.moveKeyframe', { clip: id, effect: 'motion', param: 'position', mediaTime: 4 * T, to: 2 * T });
    expect(Math.abs(centroid(T).x - 960)).toBeLessThan(4);
    expect(param(id, 'motion', 'position').keyframes).toBe(2);
    exec(engine, 'effects.deleteKeyframe', { clip: id, effect: 'motion', param: 'position', mediaTime: 2 * T });
    expect(param(id, 'motion', 'position').keyframes).toBe(1);
    // 같은 자리 addKeyframe 은 토글(지움), 다른 자리는 추가
    exec(engine, 'effects.addKeyframe', { clip: id, effect: 'motion', param: 'position', time: 0 });
    expect(param(id, 'motion', 'position').keyframes).toBe(0);
    exec(engine, 'effects.addKeyframe', { clip: id, effect: 'motion', param: 'position', time: T });
    exec(engine, 'effects.addKeyframe', { clip: id, effect: 'motion', param: 'position', time: 3 * T });
    expect(param(id, 'motion', 'position').keyframes).toBe(2);
    exec(engine, 'effects.toggleAnimation', { clip: id, effect: 'motion', param: 'position' });
    expect(param(id, 'motion', 'position').keyframes).toBe(0);
    expect(engine.undo()).toBe('Toggle Animation');
    expect(param(id, 'motion', 'position').keyframes).toBe(2);
    expect(engine.redo()).toBe('Toggle Animation');
    expect(param(id, 'motion', 'position').keyframes).toBe(0);
  });

  it('불투명도 0 -> 100 키프레임(페이드 인 프리셋 값)에서 밝기가 단조 증가한다', () => {
    const id = sticker.clip;
    exec(engine, 'effects.setParam', { clip: id, effect: 'motion', param: 'position', value: [960, 540] });
    const preset = motionPreset('fadeIn')!;
    const points = presetKeyframes(preset, { start: sticker.start, end: sticker.end }, 100, 1920, T / 30);
    expect(points).toEqual([
      { time: 0, value: 0 },
      { time: T, value: 100 },
    ]);
    exec(engine, 'effects.addKeyframe', { clip: id, effect: 'opacity', param: 'opacity', time: points[0]!.time });
    for (const p of points) exec(engine, 'effects.setParam', { clip: id, effect: 'opacity', param: 'opacity', value: p.value, time: p.time });
    expect(param(id, 'opacity', 'opacity').keyframes).toBe(2);
    const g0 = greenMean(0);
    const gHalf = greenMean(T / 2);
    const g1 = greenMean(T);
    const g2 = greenMean(2 * T);
    expect(g0).toBeLessThan(0.5);
    expect(gHalf).toBeGreaterThan(g0 + 0.5);
    expect(g1).toBeGreaterThan(gHalf + 0.5);
    expect(Math.abs(g2 - g1)).toBeLessThan(0.2);
    // 중간은 양 끝 사이(합성은 감마 공간이라 정확히 절반은 아니다)
    expect(gHalf / g1).toBeGreaterThan(0.1);
    expect(gHalf / g1).toBeLessThan(0.9);
  });
});
