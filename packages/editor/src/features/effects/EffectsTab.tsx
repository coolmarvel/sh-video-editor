/**
 * 인스펙터 "효과" 탭. 기본(불투명도, 크기, 회전, 위치) 묶음 + 적용된 효과 목록(켜기, 끄기, 초기화, 삭제) + "효과 추가" 메뉴 +
 * "비교(원본 보기)" 토글. 값은 선택 클립의 `effects[]`(sequence.inspect)에서 읽고, 변경은 useEffects 가 엔진 커맨드로 보낸다.
 */
import { useEffect, useRef, useState } from 'react';
import type { InspectorContext } from '../inspector/registry';
import type { ClipInfo } from '../timeline/types';
import { BASIC_PARAMS, POSITION_PARAM, USER_EFFECTS, effectDef, effectLabel, isIntrinsic } from './catalog';
import { BoolParam, ChoiceParam, ColorParam, NumberParam, PointParam } from './ParamControl';
import { readNumber, readParam, readPoint, toEngineValue } from './params';
import { effectsOf, hasVideoEffects, useEffects } from './store';
import type { ClipEffectInfo, ParamDef } from './types';
import './effects.css';

export { hasVideoEffects };

export function firstVideoClip(ctx: InspectorContext): ClipInfo | null {
  return ctx.clips.find((c) => hasVideoEffects(c)) ?? null;
}

export function videoClipIds(ctx: InspectorContext): number[] {
  return ctx.clips.filter((c) => hasVideoEffects(c)).map((c) => c.clip);
}

export function CompareButton({ clips }: { clips: number[] }) {
  const compare = useEffects((s) => s.compare);
  const busy = useEffects((s) => s.busy);
  const toggleCompare = useEffects((s) => s.toggleCompare);
  return (
    <button
      type="button"
      className="sh-tool"
      aria-pressed={compare !== null}
      disabled={busy || clips.length === 0}
      title="효과를 잠시 꺼서 원본을 보여 줍니다"
      onClick={() => void toggleCompare(clips)}
    >
      비교(원본 보기)
    </button>
  );
}

export function EffectsTab(ctx: InspectorContext) {
  const clip = firstVideoClip(ctx);
  const clips = videoClipIds(ctx);
  const busy = useEffects((s) => s.busy);
  const compare = useEffects((s) => s.compare);
  const applyEffect = useEffects((s) => s.applyEffect);
  const setParam = useEffects((s) => s.setParam);
  const toggleEffect = useEffects((s) => s.toggleEffect);
  const removeEffect = useEffects((s) => s.removeEffect);
  const resetEffect = useEffects((s) => s.resetEffect);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [menuOpen]);

  if (!clip) return <p className="ve-inspector__hint">영상 클립을 선택하세요.</p>;
  const clipId = clip.clip;
  const effects = effectsOf(clip);
  const locked = busy || compare !== null;
  const motion = effects.find((e) => e.effect === 'motion');
  const opacity = effects.find((e) => e.effect === 'opacity');
  const position = readPoint(motion, 'position');

  return (
    <div className="fx-tab" data-clip={clipId}>
      <div className="sh-toolbar fx-toolbar" role="toolbar" aria-label="효과 도구">
        <div className="fx-menu-slot" ref={menuRef}>
          <button
            type="button"
            className="sh-tool"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={locked || clips.length === 0}
            onClick={() => setMenuOpen((v) => !v)}
          >
            효과 추가
          </button>
          {menuOpen && (
            <div className="sh-menu sh-menu--float fx-menu" role="menu" aria-label="효과 추가">
              {USER_EFFECTS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="sh-menu__item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void applyEffect(clips, d.id);
                  }}
                >
                  <span className="sh-menu__check" />
                  <span className="sh-menu__label">{d.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <CompareButton clips={clips} />
      </div>

      <fieldset className="sh-group fx-group">
        <legend>기본</legend>
        {BASIC_PARAMS.map(({ effect, def }) => {
          const target = effect === 'motion' ? motion : opacity;
          return (
            <NumberParam
              key={def.id}
              def={def}
              value={readNumber(target, def.id, def.id === 'rotation' ? 0 : 100)}
              disabled={locked || !target}
              onChange={(v, opts) => void setParam(clipId, effect, def.id, toEngineValue(def, v), opts)}
            />
          );
        })}
        <PointParam
          def={POSITION_PARAM}
          x={position?.x ?? ctx.sequence.settings.width / 2}
          y={position?.y ?? ctx.sequence.settings.height / 2}
          disabled={locked || !motion}
          onChange={(x, y) => void setParam(clipId, 'motion', 'position', [x, y], {})}
        />
      </fieldset>

      <ul className="fx-list" aria-label="적용된 효과">
        {effects.map((e, index) =>
          isIntrinsic(e.effect) ? null : (
            <li key={`${index}-${e.effect}`} className="fx-item" data-effect={e.effect} data-enabled={e.enabled}>
              <div className="fx-item__head">
                <label className="sh-check fx-item__name">
                  <input
                    type="checkbox"
                    checked={e.enabled}
                    disabled={locked}
                    aria-label={`${effectLabel(e.effect)} 켜기`}
                    onChange={() => void toggleEffect(clipId, index)}
                  />
                  <span>{effectLabel(e.effect)}</span>
                </label>
                <button
                  type="button"
                  className="sh-btn sh-btn--sm"
                  disabled={locked}
                  aria-label={`${effectLabel(e.effect)} 초기화`}
                  onClick={() => void resetEffect(clipId, index)}
                >
                  초기화
                </button>
                <button
                  type="button"
                  className="sh-btn sh-btn--sm sh-btn--danger"
                  disabled={locked}
                  aria-label={`${effectLabel(e.effect)} 삭제`}
                  onClick={() => void removeEffect(clipId, index)}
                >
                  삭제
                </button>
              </div>
              <EffectParams clip={clipId} index={index} effect={e} disabled={locked || !e.enabled} />
            </li>
          ),
        )}
      </ul>
      {effects.filter((e) => !isIntrinsic(e.effect)).length === 0 && <p className="ve-inspector__hint">추가한 효과가 없습니다. 효과 추가 메뉴에서 고르세요.</p>}
    </div>
  );
}

function EffectParams({ clip, index, effect, disabled }: { clip: number; index: number; effect: ClipEffectInfo; disabled: boolean }) {
  const setParam = useEffects((s) => s.setParam);
  const def = effectDef(effect.effect);
  if (!def || def.params.length === 0) return null;
  const change = (p: ParamDef, value: number | boolean | string, opts = {}) => void setParam(clip, index, p.id, toEngineValue(p, value), opts);
  return (
    <div className="fx-item__params">
      {def.params.map((p) => {
        const v = readParam(effect, p.id);
        switch (p.kind) {
          case 'bool':
            return <BoolParam key={p.id} def={p} value={v?.kind === 'bool' ? v.value : false} disabled={disabled} onChange={(b) => change(p, b)} />;
          case 'choice':
            return <ChoiceParam key={p.id} def={p} value={v?.kind === 'choice' ? v.value : 0} disabled={disabled} onChange={(n) => change(p, n)} />;
          case 'color':
            return <ColorParam key={p.id} def={p} rgba={v?.kind === 'color' ? v.rgba : [0, 0, 0, 1]} disabled={disabled} onChange={(hex) => change(p, hex)} />;
          default:
            return (
              <NumberParam key={p.id} def={p} value={readNumber(effect, p.id, p.min ?? 0)} disabled={disabled} onChange={(n, opts) => change(p, n, opts)} />
            );
        }
      })}
    </div>
  );
}
