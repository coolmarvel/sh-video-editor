/**
 * 인스펙터 "색" 탭. lumetri 효과의 노출, 대비, 채도, 온도, 틴트 슬라이더와 초기화, 비교. 클립에 lumetri 가 없으면 기본값을 보이고
 * 첫 변경에 useEffects.setColor 가 효과를 붙인다. 여러 lumetri 가 있으면 마지막 것을 편집한다(필터 갤러리가 붙인 것과 같다).
 */
import type { InspectorContext } from '../inspector/registry';
import { COLOR_PARAMS, LUMETRI_EFFECT } from './catalog';
import { CompareButton, firstVideoClip, videoClipIds } from './EffectsTab';
import { NumberParam } from './ParamControl';
import { readNumber, toEngineValue } from './params';
import { effectsOf, lastIndexOf, useEffects } from './store';
import './effects.css';

const DEFAULTS: Record<string, number> = { exposure: 0, contrast: 0, saturation: 100, temperature: 0, tint: 0 };

export function ColorTab(ctx: InspectorContext) {
  const clip = firstVideoClip(ctx);
  const clips = videoClipIds(ctx);
  const busy = useEffects((s) => s.busy);
  const compare = useEffects((s) => s.compare);
  const setColor = useEffects((s) => s.setColor);
  const resetColor = useEffects((s) => s.resetColor);
  if (!clip) return <p className="ve-inspector__hint">영상 클립을 선택하세요.</p>;
  const index = lastIndexOf(clip, LUMETRI_EFFECT);
  const lumetri = index >= 0 ? effectsOf(clip)[index] : undefined;
  const locked = busy || compare !== null;
  return (
    <div className="fx-tab" data-clip={clip.clip}>
      <div className="sh-toolbar fx-toolbar" role="toolbar" aria-label="색 도구">
        <CompareButton clips={clips} />
        <button type="button" className="sh-tool" disabled={locked || !lumetri} onClick={() => void resetColor(clips)}>
          초기화
        </button>
      </div>
      <fieldset className="sh-group fx-group">
        <legend>기본 보정</legend>
        {COLOR_PARAMS.map((def) => (
          <NumberParam
            key={def.id}
            def={def}
            value={readNumber(lumetri, def.id, DEFAULTS[def.id] ?? 0)}
            disabled={locked}
            onChange={(v, opts) => void setColor(clip.clip, def.id, Number(toEngineValue(def, v)), opts)}
          />
        ))}
      </fieldset>
      {!lumetri && <p className="ve-inspector__hint">슬라이더를 움직이면 색 보정 효과가 붙습니다.</p>}
    </div>
  );
}
