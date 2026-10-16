/**
 * `sequence.inspect {effects: "summary"}`(performance-audit R1)를 실제 엔진 두 개(napi, wasm)로 본다. 기본 모양은 그대로이고, summary 는
 * 선택하지 않은 클립의 고정 효과에서 키프레임 없는 파라미터만 빼며, 나머지(클립 필드, 효과 목록과 순서, 선택 클립, 사용자 효과)는 같다.
 * 200 클립에서 크기가 기본의 60% 아래(실측 51%)인지도 본다.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { T, exec, hasNativeBinding, hasWasm, loadNapi, loadWasm, type NapiModule, type WasmModule } from './helpers';

type Engine = { execute(id: string, p?: string | null): string };
type Fx = { effect: string; params: Record<string, unknown>; summary?: boolean };
type Clip = { clip: number; effects: Fx[] } & Record<string, unknown>;
type Seq = { video: Array<{ items: Clip[] }>; audio: Array<{ items: Clip[] }> };

let napi: NapiModule | null = null;
let wasm: WasmModule | null = null;

beforeAll(async () => {
  if (hasNativeBinding()) napi = loadNapi();
  if (hasWasm()) wasm = await loadWasm();
});

function build(e: Engine, n: number): { first: number; second: number } {
  exec(e, 'file.newProject', { name: 'summary' });
  exec(e, 'file.newSequence', { name: 's', width: 1920, height: 1080, fps: 30 });
  const demo = exec<{ items: number[] }>(e, 'file.importDemoFootage', { scene: 'Plasma' });
  for (let i = 0; i < n; i++) exec(e, 'timeline.place', { item: demo.items[0], track: i % 2 ? 'V2' : 'V1', time: i * T, insert: false, duration: T });
  const seq = exec<Seq>(e, 'sequence.inspect');
  return { first: seq.video[0]!.items[0]!.clip, second: seq.video[0]!.items[1]!.clip };
}

const clips = (s: Seq) => [...s.video, ...s.audio].flatMap((t) => t.items);

function check(make: () => Engine) {
  it('기본은 그대로, summary 는 선택하지 않은 클립의 고정 효과 값만 뺀다', () => {
    const e = make();
    const { first, second } = build(e, 4);
    exec(e, 'effects.addKeyframe', { clip: second, effect: 'opacity', param: 'opacity', time: 0 });
    exec(e, 'effects.apply', { clips: [second], effect: 'gaussian_blur' });
    exec(e, 'timeline.select', { clips: [first] });
    const full = exec<Seq>(e, 'sequence.inspect');
    expect(exec<Seq>(e, 'sequence.inspect', { effects: 'full' })).toEqual(full);
    const brief = exec<Seq>(e, 'sequence.inspect', { effects: 'summary' });
    const [fc, bc] = [clips(full), clips(brief)];
    expect(bc.map((c) => c.clip)).toEqual(fc.map((c) => c.clip));
    for (let i = 0; i < fc.length; i++) {
      const { effects: fe, ...fr } = fc[i]!;
      const { effects: be, ...br } = bc[i]!;
      expect(br).toEqual(fr);
      expect(be.map((x) => x.effect)).toEqual(fe.map((x) => x.effect));
    }
    const byId = (list: Clip[], id: number) => list.find((c) => c.clip === id)!;
    expect(byId(bc, first)).toEqual(byId(fc, first));
    const fx = (c: Clip, name: string) => c.effects.find((x) => x.effect === name)!;
    const op = fx(byId(bc, second), 'opacity');
    expect(op.summary).toBe(true);
    expect(Object.keys(op.params)).toEqual(['opacity']);
    expect(op.params['opacity']).toEqual(fx(byId(fc, second), 'opacity').params['opacity']);
    expect(fx(byId(bc, second), 'gaussian_blur')).toEqual(fx(byId(fc, second), 'gaussian_blur'));
    expect(() => exec(e, 'sequence.inspect', { effects: 'tiny' })).toThrow(/full or summary/);
  });

  it('200 클립에서 summary 는 기본의 60% 보다 작다(실측 51%)', () => {
    const e = make();
    build(e, 200);
    const full = e.execute('sequence.inspect', '{}').length;
    const brief = e.execute('sequence.inspect', JSON.stringify({ effects: 'summary' })).length;
    expect(brief).toBeLessThan(full * 0.6);
  });
}

(hasNativeBinding() ? describe : describe.skip)('sequence.inspect summary (napi)', () => check(() => new napi!.Engine()));
(hasWasm() ? describe : describe.skip)('sequence.inspect summary (wasm)', () => check(() => new wasm!.Engine()));
