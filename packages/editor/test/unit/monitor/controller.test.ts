/**
 * features/monitor/controller.ts: 플레이헤드 동기화, 탐색·프레임 이동, 재생 루프(가짜 rAF·시계), 배율 적응, 폴링.
 * 플레이헤드 SSOT 는 엔진이므로 모든 검증은 "엔진 값이 store 에 반영되는가" 로 한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonitorController } from '@editor/features/monitor/controller';
import { useMonitor } from '@editor/features/monitor/store';
import { FT30, FakeEngine, T, engineWithClips } from '../../fake-bridge';
import { resetStores } from '../../stores';

const mon = () => useMonitor.getState();

interface Ctx2D {
  putImageData: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  fillStyle: string;
}

function fakeCanvas(): { canvas: HTMLCanvasElement; ctx: Ctx2D } {
  const canvas = document.createElement('canvas');
  const ctx: Ctx2D = { putImageData: vi.fn(), fillRect: vi.fn(), fillStyle: '' };
  canvas.getContext = vi.fn(() => ctx as unknown as CanvasRenderingContext2D) as never;
  return { canvas, ctx };
}

let controllers: MonitorController[] = [];
function make(engine: FakeEngine): MonitorController {
  const c = new MonitorController(engine.bridge);
  controllers.push(c);
  return c;
}

beforeEach(() => {
  resetStores();
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'performance',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  });
});
afterEach(() => {
  for (const c of controllers) c.dispose();
  controllers = [];
});

describe('refreshSequence / syncPlayhead', () => {
  it('시퀀스가 없으면 비우고, 있으면 store 에 올린다', async () => {
    const { engine } = engineWithClips();
    const c = make(engine);
    engine.state.sequence = null;
    await c.refreshSequence();
    expect(mon().sequence).toBeNull();
    resetStores();
    const made = engineWithClips();
    const c2 = make(made.engine);
    await c2.refreshSequence();
    expect(mon().sequence).toMatchObject({ width: 1920, height: 1080, fps: 30, duration: 8 * T });
  });

  it('같은 시퀀스면 store 객체를 바꾸지 않고, 길이가 바뀌면 바꾼다', async () => {
    const { engine } = engineWithClips();
    const c = make(engine);
    await c.refreshSequence();
    const before = mon().sequence;
    await c.refreshSequence();
    expect(mon().sequence).toBe(before);
    engine.sequence.video[0]!.items[1]!.end = 10 * T;
    await c.refreshSequence();
    expect(mon().sequence?.duration).toBe(10 * T);
  });

  it('syncPlayhead 는 엔진 값을 읽고 캔버스가 있으면 그린다', async () => {
    const { engine } = engineWithClips();
    const c = make(engine);
    c.setViewport(960);
    await c.refreshSequence();
    const { canvas, ctx } = fakeCanvas();
    c.attachCanvas(canvas);
    await vi.advanceTimersByTimeAsync(0);
    engine.setPlayhead(FT30 * 12);
    await c.syncPlayhead();
    expect(mon().tick).toBe(FT30 * 12);
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.putImageData).toHaveBeenCalled();
    // 렌더한 프레임 크기(scale 0.5 기본)로 캔버스 크기가 맞춰진다
    expect(canvas.width).toBe(960);
    expect(canvas.height).toBe(540);
    expect(mon().stats.renderMs).toBeGreaterThanOrEqual(0);
  });

  it('같은 tick·배율·revision 이면 다시 그리지 않는다', async () => {
    const { engine } = engineWithClips();
    const c = make(engine);
    await c.refreshSequence();
    const { canvas, ctx } = fakeCanvas();
    c.attachCanvas(canvas);
    await vi.advanceTimersByTimeAsync(0);
    const n = ctx.putImageData.mock.calls.length;
    c.requestRender(0);
    c.requestRender(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.putImageData.mock.calls.length).toBe(n);
  });

  it('렌더 중 들어온 요청은 마지막 tick 하나만 이어서 그린다', async () => {
    const { engine } = engineWithClips();
    const c = make(engine);
    await c.refreshSequence();
    const { canvas } = fakeCanvas();
    const ticks: number[] = [];
    const original = engine.bridge.renderFrame;
    engine.bridge.renderFrame = async (tick, scale) => {
      ticks.push(tick);
      await new Promise((r) => setTimeout(r, 10));
      return original(tick, scale);
    };
    c.attachCanvas(canvas);
    c.requestRender(FT30);
    c.requestRender(FT30 * 2);
    c.requestRender(FT30 * 3);
    await vi.advanceTimersByTimeAsync(50);
    expect(ticks).toEqual([0, FT30 * 3]);
  });

  it('renderFrame 실패는 오류로 적고 캔버스를 검게 비운다', async () => {
    const { engine } = engineWithClips();
    const c = make(engine);
    await c.refreshSequence();
    const { canvas, ctx } = fakeCanvas();
    engine.bridge.renderFrame = async () => {
      throw new Error('gpu');
    };
    c.attachCanvas(canvas);
    await vi.advanceTimersByTimeAsync(0);
    expect(mon().error).toBe('gpu');
    expect(ctx.fillRect).toHaveBeenCalled();
  });
});

describe('seek / step / goTo', () => {
  it('seek 는 프레임으로 내림해 엔진에 쓰고 다시 읽는다', async () => {
    const { engine } = engineWithClips();
    const c = make(engine);
    await c.refreshSequence();
    await c.seek(FT30 * 2.9);
    expect(engine.state.playhead).toBe(FT30 * 2);
    expect(mon().tick).toBe(FT30 * 2);
    await c.seek(100 * T);
    expect(mon().tick).toBe(8 * T);
    await c.seek(-1);
    expect(mon().tick).toBe(0);
  });

  it('시퀀스가 없으면 seek/step 은 아무것도 하지 않는다', async () => {
    const { engine } = engineWithClips();
    const c = make(engine);
    await c.seek(FT30);
    await c.step(1);
    expect(engine.callsOf('playhead.step')).toEqual([]);
    expect(mon().tick).toBe(0);
  });

  it('seek 실패는 오류', async () => {
    const { engine } = engineWithClips();
    const c = make(engine);
    await c.refreshSequence();
    engine.bridge.setPlayhead = async () => {
      throw new Error('잠김');
    };
    await c.seek(FT30);
    expect(mon().error).toBe('잠김');
  });

  it('step 은 playhead.step 커맨드로, 끝을 넘으면 시퀀스 길이로 되돌린다', async () => {
    const { engine } = engineWithClips();
    const c = make(engine);
    await c.refreshSequence();
    await c.step(5);
    expect(engine.callsOf('playhead.step')).toEqual([{ frames: 5 }]);
    expect(mon().tick).toBe(FT30 * 5);
    await c.step(-10);
    expect(mon().tick).toBe(0);
    await c.seek(8 * T - FT30);
    await c.step(3);
    expect(mon().tick).toBe(8 * T);
    engine.failNext('playhead.step', 'x');
    await c.step(1);
    expect(mon().error).toBe('x');
  });

  it('goToStart / goToEnd', async () => {
    const { engine } = engineWithClips();
    const c = make(engine);
    await c.refreshSequence();
    await c.goToEnd();
    expect(engine.callsOf('playhead.end')).toHaveLength(1);
    expect(mon().tick).toBe(8 * T);
    await c.goToStart();
    expect(engine.callsOf('playhead.start')).toHaveLength(1);
    expect(mon().tick).toBe(0);
  });
});

describe('재생 루프', () => {
  it('벽시계로 tick 을 계산해 엔진에 쓰고, 끝에 닿으면 멈춘다', async () => {
    const engine = new FakeEngine();
    const item = engine.addItem({ name: 'short.mp4', duration: 2 * T });
    engine.newSequence();
    engine.place(item, 0);
    const c = make(engine);
    await c.refreshSequence();
    expect(mon().sequence?.duration).toBe(2 * T);
    const { canvas } = fakeCanvas();
    c.attachCanvas(canvas);
    c.play();
    expect(c.isPlaying()).toBe(true);
    expect(mon().playing).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(mon().playing).toBe(true);
    expect(mon().tick).toBeGreaterThan(0);
    expect(mon().tick % FT30).toBe(0);
    expect(engine.state.playhead).toBe(mon().tick);
    await vi.advanceTimersByTimeAsync(2500);
    expect(c.isPlaying()).toBe(false);
    expect(mon().playing).toBe(false);
    expect(mon().tick).toBe(2 * T);
    expect(engine.state.playhead).toBe(2 * T);
  });

  it('끝에서 재생하면 처음부터, 시퀀스가 없으면 재생하지 않는다', async () => {
    const { engine } = engineWithClips();
    const c = make(engine);
    c.play();
    expect(c.isPlaying()).toBe(false);
    await c.refreshSequence();
    await c.goToEnd();
    c.play();
    expect(mon().tick).toBe(0);
    c.pause();
    expect(mon().playing).toBe(false);
    c.pause();
  });

  it('toggle 과 pause 뒤에는 엔진 값을 다시 읽는다', async () => {
    const { engine } = engineWithClips();
    const c = make(engine);
    await c.refreshSequence();
    c.toggle();
    expect(c.isPlaying()).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    c.toggle();
    expect(c.isPlaying()).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(mon().tick).toBe(engine.state.playhead);
  });

  it('재생 중 pumpJobs 를 주기적으로 부른다', async () => {
    const { engine } = engineWithClips();
    const c = make(engine);
    await c.refreshSequence();
    const pump = vi.spyOn(engine.bridge, 'pumpJobs');
    c.play();
    await vi.advanceTimersByTimeAsync(1000);
    c.pause();
    expect(pump.mock.calls.length).toBeGreaterThanOrEqual(8);
    expect(pump).toHaveBeenCalledWith(2);
  });

  it('렌더가 프레임 간격보다 느리면 배율을 한 단계 내리고 건너뛴 프레임을 센다', async () => {
    const { engine } = engineWithClips();
    const c = make(engine);
    await c.refreshSequence();
    const { canvas } = fakeCanvas();
    c.attachCanvas(canvas);
    c.setViewport(960);
    await vi.advanceTimersByTimeAsync(0);
    expect(mon().stats.scale).toBe(0.5);
    const original = engine.bridge.renderFrame;
    engine.bridge.renderFrame = async (tick, scale) => {
      await new Promise((r) => setTimeout(r, 120)); // 30fps 간격(33ms)의 3.6배
      return original(tick, scale);
    };
    c.play();
    await vi.advanceTimersByTimeAsync(1500);
    expect(mon().stats.scale).toBe(0.25);
    expect(mon().stats.dropped).toBeGreaterThan(0);
    c.pause();
    await vi.advanceTimersByTimeAsync(800);
    // 정지하면 표시 배율(0.5)로 다시 그린다: 캔버스가 960x540 이 된다
    expect(canvas.width).toBe(960);
  });

  /**
   * pause() 는 표시 배율로 다시 그리지만 상태 줄 수치(publishStats)를 강제로 갱신하지 않는다. 같은 tick 을
   * 다시 그릴 일이 없으면 상태 줄의 "배율 1/4" 가 사용자가 스크럽할 때까지 남는다. pause 에서
   * publishStats(now, true) 를 부르면 된다.
   */
  it.fails('정지하면 상태 줄 배율도 표시 배율로 돌아와야 한다 (알려진 결함)', async () => {
    const { engine } = engineWithClips();
    const c = make(engine);
    await c.refreshSequence();
    const { canvas } = fakeCanvas();
    c.attachCanvas(canvas);
    c.setViewport(960);
    await vi.advanceTimersByTimeAsync(0);
    const original = engine.bridge.renderFrame;
    engine.bridge.renderFrame = async (tick, scale) => {
      await new Promise((r) => setTimeout(r, 120));
      return original(tick, scale);
    };
    c.play();
    await vi.advanceTimersByTimeAsync(1500);
    expect(mon().stats.scale).toBe(0.25);
    c.pause();
    await vi.advanceTimersByTimeAsync(800);
    expect(mon().stats.scale).toBe(0.5);
  });

  it('setViewport 는 배율을 고르고 바뀌면 다시 그린다', async () => {
    const { engine } = engineWithClips();
    const c = make(engine);
    c.setViewport(100);
    await c.refreshSequence();
    const { canvas, ctx } = fakeCanvas();
    c.attachCanvas(canvas);
    await vi.advanceTimersByTimeAsync(0);
    expect(mon().stats.scale).toBe(0.25);
    c.setViewport(1920);
    await vi.advanceTimersByTimeAsync(0);
    expect(mon().stats.scale).toBe(1);
    expect(canvas.width).toBe(1920);
    expect(ctx.putImageData).toHaveBeenCalledTimes(2);
  });
});

describe('poll', () => {
  it('start 는 revision 이 바뀔 때 시퀀스를 다시 읽고 오류를 지운다', async () => {
    const { engine } = engineWithClips();
    const c = make(engine);
    c.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(mon().sequence).not.toBeNull();
    useMonitor.setState({ error: '이전' });
    engine.sequence.video[0]!.items[1]!.end = 12 * T;
    engine.state.revision += 1;
    await vi.advanceTimersByTimeAsync(300);
    expect(mon().sequence?.duration).toBe(12 * T);
    expect(mon().error).toBeNull();
    const inspects = engine.callsOf('sequence.inspect').length;
    await vi.advanceTimersByTimeAsync(900);
    expect(engine.callsOf('sequence.inspect').length).toBe(inspects);
  });

  it('project.inspect 실패는 오류로, 재생 중에는 드물게 본다', async () => {
    const { engine } = engineWithClips();
    const c = make(engine);
    c.start();
    await vi.advanceTimersByTimeAsync(0);
    engine.failNext('project.inspect', '끊김');
    await vi.advanceTimersByTimeAsync(300);
    expect(mon().error).toBe('끊김');
    const before = engine.callsOf('project.inspect').length;
    c.play();
    await vi.advanceTimersByTimeAsync(1500);
    expect(engine.callsOf('project.inspect').length - before).toBeLessThanOrEqual(1);
    c.pause();
  });

  it('dispose 뒤에는 폴링도 렌더도 없다', async () => {
    const { engine } = engineWithClips();
    const c = make(engine);
    c.start();
    await vi.advanceTimersByTimeAsync(0);
    c.dispose();
    const n = engine.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(engine.calls.length).toBe(n);
    await c.syncPlayhead();
    expect(engine.calls.length).toBe(n);
  });
});
