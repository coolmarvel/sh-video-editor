/**
 * 엔진 기능 테스트(효과·필터, M2-4). 데모 프로젝트의 클립에 효과를 붙였을 때 renderFrame 결과가 실제로 달라지는지,
 * 화면 카탈로그(features/effects/catalog.ts)의 효과·파라미터 id 가 엔진 `effects.list` 에 있는지, Lumetri 프리셋 적용·제거 왕복,
 * merge 드래그의 실행 취소 묶음, scopes.read 수치 변화를 본다. 엔진 결과만 보고 화면은 부르지 않는다.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { COLOR_PARAMS, FILTER_PRESETS, USER_EFFECTS } from '../../editor/src/features/effects/catalog';
import { exec, hasNativeBinding, loadNapi, type NapiEngine, type SequenceInfo } from './helpers';

interface ClipWithEffects {
  clip: number;
  start: number;
  effects: { effect: string; enabled: boolean; params: Record<string, { keyframes: number; kind: string; value: unknown }> }[];
}

interface Rgb {
  r: number;
  g: number;
  b: number;
  luma: number;
  grayish: number;
}

function stats(rgba: Buffer, width: number, height: number): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let grayish = 0;
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const R = rgba[i * 4] ?? 0;
    const G = rgba[i * 4 + 1] ?? 0;
    const B = rgba[i * 4 + 2] ?? 0;
    r += R;
    g += G;
    b += B;
    if (Math.abs(R - G) <= 2 && Math.abs(G - B) <= 2) grayish++;
  }
  return { r: r / n, g: g / n, b: b / n, luma: (0.2126 * r + 0.7152 * g + 0.0722 * b) / n, grayish: grayish / n };
}

describe.skipIf(!hasNativeBinding())('효과·필터(napi)', () => {
  let engine: NapiEngine;
  let clip: ClipWithEffects;
  let tick: number;

  const firstClip = (): ClipWithEffects => {
    const seq = exec<SequenceInfo & { video: { items: ClipWithEffects[] }[] }>(engine, 'sequence.inspect');
    return seq.video[0]!.items[0]!;
  };
  const render = () => {
    const f = engine.renderFrame(tick, 0.25);
    expect(f).not.toBeNull();
    return stats(f!.rgba, f!.width, f!.height);
  };

  beforeAll(() => {
    engine = new (loadNapi().Engine)();
    exec(engine, 'file.openDemoProject');
    clip = firstClip();
    // 클립 가운데 프레임(첫 프레임은 페이드로 어두울 수 있다)
    tick = clip.start + Math.floor((firstClip().effects.length > 0 ? 2 : 0) * 254_016_000_000);
    engine.setPlayhead(tick);
  });

  it('클립은 고정 효과(motion, opacity, time_remap)로 시작한다', () => {
    expect(clip.effects.map((e) => e.effect)).toEqual(['motion', 'opacity', 'time_remap']);
    expect(clip.effects[0]!.params['scale']).toEqual({ kind: 'float', value: 100, keyframes: 0, animated: false });
  });

  it('화면 카탈로그의 효과·파라미터 id 와 범위는 엔진 effects.list 안에 있다', () => {
    const list = exec<{ id: string; paramInfo: { id: string; min?: number; max?: number; type: string; options?: string[] }[] }[]>(engine, 'effects.list', {
      kind: 'Video',
      detail: true,
    });
    const byId = new Map(list.map((e) => [e.id, e]));
    for (const def of [...USER_EFFECTS, { id: 'lumetri', params: COLOR_PARAMS }]) {
      const e = byId.get(def.id);
      expect(e, `효과 ${def.id}`).toBeDefined();
      for (const p of def.params) {
        const info = e!.paramInfo.find((q) => q.id === p.id);
        expect(info, `${def.id}.${p.id}`).toBeDefined();
        if (p.min !== undefined && info!.min !== undefined) expect(p.min, `${def.id}.${p.id} min`).toBeGreaterThanOrEqual(info!.min);
        if (p.max !== undefined && info!.max !== undefined) expect(p.max, `${def.id}.${p.id} max`).toBeLessThanOrEqual(info!.max);
        if (p.kind === 'choice') expect(p.options!.length).toBe(info!.options!.length);
      }
    }
    const presets = exec<{ presets: { name: string }[] }>(engine, 'lumetri.presets');
    const names = new Set(presets.presets.map((p) => p.name));
    for (const p of FILTER_PRESETS) if (p.lumetri) expect(names.has(p.lumetri), `Lumetri 프리셋 ${p.lumetri}`).toBe(true);
    expect(presets.presets.length).toBe(FILTER_PRESETS.filter((p) => p.lumetri).length);
  });

  it('black_white 를 붙이면 프레임이 R=G=B 가 되고, 떼면 색이 돌아온다', () => {
    const before = render();
    expect(before.grayish).toBeLessThan(0.5);
    exec(engine, 'effects.apply', { clips: [clip.clip], effect: 'black_white' });
    expect(firstClip().effects.map((e) => e.effect)).toEqual(['black_white', 'motion', 'opacity', 'time_remap']);
    const after = render();
    expect(after.grayish).toBeGreaterThan(0.98);
    // 끄면 다시 컬러, 켜면 흑백
    exec(engine, 'effects.toggleEnabled', { clip: clip.clip, index: 0 });
    expect(firstClip().effects[0]!.enabled).toBe(false);
    expect(render().grayish).toBeLessThan(0.5);
    exec(engine, 'effects.toggleEnabled', { clip: clip.clip, index: 0 });
    expect(render().grayish).toBeGreaterThan(0.98);
    exec(engine, 'effects.remove', { clip: clip.clip, index: 0 });
    expect(firstClip().effects.map((e) => e.effect)).toEqual(['motion', 'opacity', 'time_remap']);
    expect(render().grayish).toBeLessThan(0.5);
  });

  it('brightness 를 올리면 평균 밝기가 오르고 scopes.read 의 Y 평균도 오른다', () => {
    const before = render();
    const scopeBefore = exec<{ stats: { y: { mean: number } } }>(engine, 'scopes.read', { scopes: ['histogram'], bins: false, time: tick });
    exec(engine, 'effects.apply', { clips: [clip.clip], effect: 'brightness_contrast' });
    exec(engine, 'effects.setParam', { clip: clip.clip, effect: 0, param: 'brightness', value: 60 });
    expect(firstClip().effects[0]!.params['brightness']!.value).toBe(60);
    const after = render();
    expect(after.luma).toBeGreaterThan(before.luma + 10);
    const scopeAfter = exec<{ stats: { y: { mean: number } } }>(engine, 'scopes.read', { scopes: ['histogram'], bins: false, time: tick });
    expect(scopeAfter.stats.y.mean).toBeGreaterThan(scopeBefore.stats.y.mean + 3);
    exec(engine, 'effects.remove', { clip: clip.clip, index: 0 });
    expect(Math.abs(render().luma - before.luma)).toBeLessThan(1);
  });

  it('merge/begin 으로 보낸 드래그는 실행 취소 한 단계, 다른 묶음은 따로', () => {
    exec(engine, 'effects.apply', { clips: [clip.clip], effect: 'brightness_contrast' });
    const value = () => firstClip().effects[0]!.params['brightness']!.value;
    exec(engine, 'effects.setParam', { clip: clip.clip, effect: 0, param: 'brightness', value: 10, merge: true, begin: true });
    exec(engine, 'effects.setParam', { clip: clip.clip, effect: 0, param: 'brightness', value: 20, merge: true });
    exec(engine, 'effects.setParam', { clip: clip.clip, effect: 0, param: 'brightness', value: 30, merge: true });
    exec(engine, 'effects.setParam', { clip: clip.clip, effect: 0, param: 'brightness', value: 40, merge: true, begin: true });
    exec(engine, 'effects.setParam', { clip: clip.clip, effect: 0, param: 'brightness', value: 50, merge: true });
    expect(value()).toBe(50);
    expect(engine.undo()).toBe('Change Effect Parameter');
    expect(value()).toBe(30);
    expect(engine.undo()).toBe('Change Effect Parameter');
    expect(value()).toBe(0);
    expect(engine.undo()).toBe('Apply Brightness & Contrast');
    expect(firstClip().effects.map((e) => e.effect)).toEqual(['motion', 'opacity', 'time_remap']);
  });

  it('Lumetri 프리셋 적용과 제거 왕복: Neutral Mono 는 흑백, 떼면 원래대로', () => {
    const before = render();
    const r = exec<{ clips: number; preset: string }>(engine, 'lumetri.applyPreset', { name: 'Neutral Mono', clips: [clip.clip] });
    expect(r).toEqual({ clips: 1, preset: 'Neutral Mono' });
    const effects = firstClip().effects;
    expect(effects[0]!.effect).toBe('lumetri');
    expect(effects[0]!.params['saturation']).toBeDefined();
    expect(render().grayish).toBeGreaterThan(0.98);
    // 프리셋을 또 적용하면 앞 것을 교체한다(replace 기본 true). replace:false 면 상류처럼 쌓인다
    exec(engine, 'lumetri.applyPreset', { name: 'Sepia Tone', clips: [clip.clip] });
    expect(firstClip().effects.filter((e) => e.effect === 'lumetri')).toHaveLength(1);
    expect(render().grayish).toBeLessThan(0.5);
    exec(engine, 'lumetri.applyPreset', { name: 'Neutral Mono', clips: [clip.clip], replace: false });
    expect(firstClip().effects.filter((e) => e.effect === 'lumetri')).toHaveLength(2);
    exec(engine, 'effects.remove', { clip: clip.clip, index: 1 });
    exec(engine, 'effects.remove', { clip: clip.clip, index: 0 });
    expect(firstClip().effects.map((e) => e.effect)).toEqual(['motion', 'opacity', 'time_remap']);
    const after = render();
    expect(Math.abs(after.luma - before.luma)).toBeLessThan(1);
    expect(after.grayish).toBeLessThan(0.5);
  });

  it('색 탭 파라미터: 채도 0 은 흑백, 노출 +2 는 밝아진다', () => {
    const before = render();
    exec(engine, 'effects.apply', { clips: [clip.clip], effect: 'lumetri' });
    exec(engine, 'effects.setParam', { clip: clip.clip, effect: 'lumetri', param: 'saturation', value: 0 });
    expect(render().grayish).toBeGreaterThan(0.98);
    exec(engine, 'effects.setParam', { clip: clip.clip, effect: 'lumetri', param: 'saturation', value: 100 });
    exec(engine, 'effects.setParam', { clip: clip.clip, effect: 'lumetri', param: 'exposure', value: 2 });
    expect(render().luma).toBeGreaterThan(before.luma + 10);
    exec(engine, 'effects.remove', { clip: clip.clip, index: 0 });
  });

  it('Fade Out 프리셋은 opacity 에 키프레임을 만들고 마지막 1초 안의 프레임이 어두워진다', () => {
    // 데모 영상은 처음 0.9초가 검정이라 Fade In 대신 끝에서 0.3초 앞을 본다
    const seq = exec<SequenceInfo>(engine, 'sequence.inspect');
    const t = seq.video[0]!.items[0]!.end - Math.round(254_016_000_000 * 0.3);
    const before = engine.renderFrame(t, 0.25)!;
    const lumaBefore = stats(before.rgba, before.width, before.height).luma;
    expect(lumaBefore).toBeGreaterThan(5);
    exec(engine, 'presets.apply', { preset: 'Fade Out', clips: [clip.clip] });
    const op = firstClip().effects.find((e) => e.effect === 'opacity')!;
    expect(op.params['opacity']!.keyframes).toBeGreaterThanOrEqual(2);
    const after = engine.renderFrame(t, 0.25)!;
    expect(stats(after.rgba, after.width, after.height).luma).toBeLessThan(lumaBefore * 0.6);
    expect(engine.undo()).toBe('Apply Preset Fade Out');
  });

  it('비교(원본 보기)와 같은 toggle 왕복은 revision 이 같으면 undo 로 흔적 없이 되돌아간다', () => {
    exec(engine, 'effects.apply', { clips: [clip.clip], effect: 'black_white' });
    const revBefore = exec<{ revision: number }>(engine, 'project.inspect').revision;
    exec(engine, 'effects.toggleEnabled', { clip: clip.clip, index: 0 });
    expect(render().grayish).toBeLessThan(0.5);
    expect(engine.undo()).toBe('Toggle Effect');
    expect(render().grayish).toBeGreaterThan(0.98);
    expect(firstClip().effects[0]!.enabled).toBe(true);
    // undo 뒤 revision 은 그대로가 아니라 올라간다(모니터 폴링이 변화를 알아챈다)
    expect(exec<{ revision: number }>(engine, 'project.inspect').revision).not.toBe(revBefore);
    exec(engine, 'effects.remove', { clip: clip.clip, index: 0 });
  });
});
