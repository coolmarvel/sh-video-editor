/**
 * 재생 읽어 두기(napi + wasm, docs/guides/playback.md): playbackStart 뒤 renderFrame 이 읽어 둔 프레임을 돌려주고 그 픽셀은
 * 그때그때 그린 것과 바이트까지 같다. 건너뛴 프레임은 버리고, 탐색·편집 뒤에도 맞는 그림을 준다. 정지 중 playbackPrepare 는 다음
 * 재생의 첫 프레임들을 준비한다. napi 는 엔진 스레드가, wasm 은 호스트의 playbackPump 가 진행시킨다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  T,
  allClips,
  exec,
  hasNativeBinding,
  hasWasm,
  loadNapi,
  loadWasm,
  sleep,
  type NapiEngine,
  type SequenceInfo,
  type WasmEngine,
  type WasmModule,
} from './helpers';

interface Status {
  active: boolean;
  playing: boolean;
  ready: number;
  target: number;
  bytes: number;
  hits: number;
  misses: number;
  rendered: number;
  warmed: number;
  threaded: boolean;
}

const FPS = 30;
const FT = T / FPS;

/** 320x180 30fps 편집본에 데모 장면 둘을 1초씩 이어 놓는다 */
function twoClips(engine: { execute(id: string, p?: string | null): string }): void {
  exec(engine, 'file.newProject', { name: 'pb' });
  exec(engine, 'file.newSequence', { name: 'seq', width: 320, height: 180, fps: FPS });
  const a = exec<{ items: number[] }>(engine, 'file.importDemoFootage', { scene: 'Plasma' });
  const b = exec<{ items: number[] }>(engine, 'file.importDemoFootage', { scene: 'Aurora' });
  exec(engine, 'timeline.place', { item: a.items[0], track: 'V1', time: 0, duration: T, insert: true });
  exec(engine, 'timeline.place', { item: b.items[0], track: 'V1', time: T, duration: T, insert: true });
}

const napiOk = hasNativeBinding();
const d = napiOk ? describe : describe.skip;

d('napi 읽어 두기', () => {
  let engine: NapiEngine;
  const status = (): Status => JSON.parse(engine.playbackStatus()) as Status;
  async function waitReady(n: number): Promise<void> {
    const t0 = Date.now();
    while (status().ready < n) {
      if (Date.now() - t0 > 30_000) throw new Error(`never filled: ${engine.playbackStatus()}`);
      await sleep(2);
    }
  }
  beforeAll(() => {
    engine = new (loadNapi().Engine)();
    twoClips(engine);
  });
  afterAll(() => engine.shutdown());

  it('읽어 둔 프레임은 그때그때 그린 것과 같다', async () => {
    const want = Array.from({ length: 10 }, (_, i) => Buffer.from(engine.renderFrame(i * FT, 1)!.rgba));
    expect(status().threaded).toBe(true);
    engine.playbackStart(0, 1, 1);
    await waitReady(5);
    for (let i = 0; i < 10; i++) expect(Buffer.compare(Buffer.from(engine.renderFrame(i * FT, 1)!.rgba), want[i]!)).toBe(0);
    expect(status().hits).toBeGreaterThanOrEqual(5);
    engine.playbackStop();
    expect(status().active).toBe(false);
  });

  it('건너뛴 프레임은 버리고, 편집 뒤에는 새 그림을 준다', async () => {
    engine.playbackStart(0, 1, 1);
    await waitReady(5);
    const before = status().hits;
    const f3 = Buffer.from(engine.renderFrame(3 * FT, 1)!.rgba);
    expect(status().hits).toBe(before + 1);
    const clip = (allClips(exec<SequenceInfo>(engine, 'sequence.inspect'))[0] as unknown as { clip: number }).clip;
    exec(engine, 'effects.apply', { clips: [clip], effect: 'black_white' });
    const after = Buffer.from(engine.renderFrame(4 * FT, 1)!.rgba);
    engine.playbackStop();
    const fresh = Buffer.from(engine.renderFrame(4 * FT, 1)!.rgba);
    expect(Buffer.compare(after, fresh)).toBe(0);
    expect(f3.length).toBe(fresh.length);
    exec(engine, 'edit.undo');
  });

  it('정지 중 준비: 보이는 프레임 다음부터 준비하고 재생은 그것을 쓴다', async () => {
    engine.renderFrame(0, 0.5);
    engine.playbackPrepare(0, 0.5);
    await waitReady(1);
    const st = status();
    expect(st.playing).toBe(false);
    expect(st.ready).toBeLessThanOrEqual(3);
    const hits = st.hits;
    engine.playbackStart(0, 1, 0.5);
    expect(engine.renderFrame(0, 0.5)).not.toBeNull();
    expect(engine.renderFrame(FT, 0.5)).not.toBeNull();
    expect(status().hits).toBe(hits + 1);
    engine.playbackStop();
  });

  it('다음 클립의 디코더를 미리 연다(warmed)', async () => {
    engine.playbackStart(0, 1, 0.5);
    const t0 = Date.now();
    while (status().warmed === 0 && Date.now() - t0 < 30_000) await sleep(5);
    expect(status().warmed).toBeGreaterThan(0);
    engine.playbackStop();
  });
});

const w = hasWasm() ? describe : describe.skip;
w('wasm 읽어 두기(스레드 없음, playbackPump)', () => {
  let mod: WasmModule;
  let engine: WasmEngine;
  const status = (): Status => JSON.parse(engine.playbackStatus()) as Status;
  const frame = (tick: number, scale: number) => engine.renderFrame(BigInt(tick), scale).slice(8);
  beforeAll(async () => {
    mod = await loadWasm();
    engine = new mod.Engine();
    twoClips(engine);
  });
  afterAll(() => engine.free());

  it('pump 로 읽어 두고, 그 프레임은 그때그때 그린 것과 같다', () => {
    expect(status().threaded).toBe(false);
    const want = Array.from({ length: 4 }, (_, i) => frame(i * FT, 0.5));
    engine.playbackStart(0n, 1, 0.5);
    expect(status().ready).toBe(0);
    while (status().ready < status().target || status().ready < 3) if (!engine.playbackPump(50)) break;
    expect(status().ready).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 4; i++) expect(Buffer.compare(Buffer.from(frame(i * FT, 0.5)), Buffer.from(want[i]!))).toBe(0);
    expect(status().hits).toBeGreaterThanOrEqual(3);
    engine.playbackStop();
    expect(engine.playbackPump(10)).toBe(false);
  });
});
