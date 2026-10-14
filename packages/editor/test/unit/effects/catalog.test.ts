/** features/effects/catalog.ts: 사용자용 효과 10종과 프리셋 카탈로그의 불변식. */
import { describe, expect, it } from 'vitest';
import {
  BASIC_PARAMS,
  COLOR_PARAMS,
  FILTER_PRESETS,
  PRESET_FOLDERS,
  USER_EFFECTS,
  effectDef,
  effectLabel,
  filterPreset,
  isIntrinsic,
  presetsInFolder,
} from '@editor/features/effects/catalog';

describe('USER_EFFECTS', () => {
  it('로드맵의 9종(+기본 motion, opacity)이고 id 는 겹치지 않는다', () => {
    expect(USER_EFFECTS.map((e) => e.id)).toEqual([
      'brightness_contrast',
      'gaussian_blur',
      'sharpen',
      'vignette',
      'mosaic',
      'black_white',
      'tint',
      'noise',
      'drop_shadow',
    ]);
    expect(new Set(USER_EFFECTS.map((e) => e.id)).size).toBe(USER_EFFECTS.length);
    for (const e of USER_EFFECTS) {
      expect(e.label).not.toMatch(/[a-z_]/);
      expect(new Set(e.params.map((p) => p.id)).size).toBe(e.params.length);
      for (const p of e.params) {
        if (p.kind === 'float' || p.kind === 'angle') {
          expect(p.min).toBeDefined();
          expect(p.max).toBeDefined();
          expect(p.max!).toBeGreaterThan(p.min!);
        }
        if (p.kind === 'choice') expect(p.options!.length).toBeGreaterThan(1);
      }
    }
  });
  it('기본 묶음과 색 보정 파라미터', () => {
    expect(BASIC_PARAMS.map((b) => `${b.effect}.${b.def.id}`)).toEqual(['opacity.opacity', 'motion.scale', 'motion.rotation']);
    expect(COLOR_PARAMS.map((p) => p.id)).toEqual(['exposure', 'contrast', 'saturation', 'temperature', 'tint']);
    expect(COLOR_PARAMS[0]!.step).toBe(0.1);
  });
  it('고정 효과와 이름', () => {
    expect(isIntrinsic('motion')).toBe(true);
    expect(isIntrinsic('opacity')).toBe(true);
    expect(isIntrinsic('time_remap')).toBe(true);
    expect(isIntrinsic('gaussian_blur')).toBe(false);
    expect(effectDef('gaussian_blur')?.label).toBe('흐림');
    expect(effectDef('nope')).toBeUndefined();
    expect(effectLabel('black_white')).toBe('흑백');
    expect(effectLabel('lumetri')).toContain('색 보정');
    expect(effectLabel('unknown_fx')).toBe('unknown_fx');
  });
});

describe('FILTER_PRESETS', () => {
  it('Lumetri 프리셋 18종 + 자체 프리셋, 폴더마다 하나 이상', () => {
    const lumetri = FILTER_PRESETS.filter((p) => p.lumetri);
    expect(lumetri).toHaveLength(18);
    expect(FILTER_PRESETS.filter((p) => p.steps)).not.toHaveLength(0);
    expect(new Set(FILTER_PRESETS.map((p) => p.id)).size).toBe(FILTER_PRESETS.length);
    for (const f of PRESET_FOLDERS) expect(presetsInFolder(f.id).length).toBeGreaterThan(0);
    for (const p of FILTER_PRESETS) {
      expect(Boolean(p.lumetri) !== Boolean(p.steps)).toBe(true);
      expect(p.css.length).toBeGreaterThan(0);
      for (const s of p.steps ?? []) {
        const def = effectDef(s.effect);
        expect(def, `${p.id}: ${s.effect} 는 사용자용 효과`).toBeDefined();
        for (const k of Object.keys(s.params ?? {}))
          expect(
            def!.params.map((q) => q.id),
            `${p.id}.${s.effect}.${k}`,
          ).toContain(k);
      }
    }
    expect(filterPreset('mono')?.lumetri).toBe('Neutral Mono');
    expect(filterPreset('nope')).toBeUndefined();
  });
});
