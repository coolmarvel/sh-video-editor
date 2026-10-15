/**
 * 효과 탭에 끼우는 세 절(DESIGN.md 4.24): "배경 지우기(크로마키)" 카드(켜기, 스포이트, 키 색, 허용치, 부드러움, 끄기),
 * "작은 화면(PIP)" (모서리 네 개 + 크기 25/33%), "흔들림 줄이기" (적용, 부드러움, 해제, 2D 근사 안내).
 * 값은 선택 클립의 inspect 효과 목록에서 읽고 변경은 useMotionFx 가 엔진 커맨드로 보낸다.
 */
import { ColorParam, NumberParam } from '../effects/ParamControl';
import { effectsOf, hasVideoEffects, lastIndexOf, useEffects } from '../effects/store';
import { readNumber, readParam, readPoint } from '../effects/params';
import type { InspectorContext } from '../inspector/registry';
import { useTimeline } from '../timeline/store';
import { findClip, type ClipInfo } from '../timeline/types';
import { useJobs } from '../jobs/store';
import { CHROMA_PARAMS, KEY_COLOR_PARAM, STABILIZER_PARAMS, ULTRA_KEY, WARP_STABILIZER, analysisNote } from './chroma';
import { PIP_CORNERS, PIP_SIZES, pipCornerOf } from './pip';
import { sourceSize, useMotionFx } from './store';
import './motion-fx.css';

function videoClip(ctx: InspectorContext): ClipInfo | null {
  return ctx.clips.find((c) => hasVideoEffects(c)) ?? null;
}

function videoClipIds(ctx: InspectorContext): number[] {
  return ctx.clips.filter((c) => hasVideoEffects(c)).map((c) => c.clip);
}

export function ChromaKeySection(ctx: InspectorContext) {
  const clip = videoClip(ctx);
  const busy = useMotionFx((s) => s.busy);
  const picking = useMotionFx((s) => s.picking);
  const fxBusy = useEffects((s) => s.busy);
  const compare = useEffects((s) => s.compare);
  if (!clip) return null;
  const act = useMotionFx.getState();
  const ids = videoClipIds(ctx);
  const index = lastIndexOf(clip, ULTRA_KEY);
  const fx = index >= 0 ? effectsOf(clip)[index] : undefined;
  const locked = busy || fxBusy || compare !== null;
  const color = readParam(fx, 'key_color');
  return (
    <fieldset className="sh-group mfx-group" data-testid="chroma-key-section" data-active={!!fx}>
      <legend>배경 지우기(크로마키)</legend>
      <div className="mfx-row">
        {fx ? (
          <>
            <button
              type="button"
              className="sh-btn sh-btn--sm"
              aria-pressed={picking}
              disabled={locked}
              title="미리보기에서 지울 색을 클릭합니다"
              onClick={() => (picking ? act.cancelPick() : act.startPick())}
            >
              {picking ? '스포이트 취소' : '스포이트'}
            </button>
            <button type="button" className="sh-btn sh-btn--sm" disabled={locked} onClick={() => void act.removeChromaKey(ids)}>
              끄기
            </button>
          </>
        ) : (
          <>
            <button type="button" className="sh-btn sh-btn--sm" disabled={locked} onClick={() => void act.enableChromaKey(ids)}>
              배경 지우기 켜기
            </button>
            <button
              type="button"
              className="sh-btn sh-btn--sm"
              aria-pressed={picking}
              disabled={locked}
              title="미리보기에서 지울 색을 클릭하면 켜지면서 그 색이 키 색이 됩니다"
              onClick={() => (picking ? act.cancelPick() : act.startPick())}
            >
              {picking ? '스포이트 취소' : '스포이트로 켜기'}
            </button>
          </>
        )}
      </div>
      {fx ? (
        <div className="mfx-params">
          <ColorParam
            def={KEY_COLOR_PARAM}
            rgba={color?.kind === 'color' ? color.rgba : [0, 0.8, 0.2, 1]}
            disabled={locked || !fx.enabled}
            onChange={(hex) => void act.setKeyParam(clip.clip, 'key_color', hex)}
          />
          {CHROMA_PARAMS.map((def) => (
            <NumberParam
              key={def.id}
              def={def}
              value={readNumber(fx, def.id, def.min ?? 0)}
              disabled={locked || !fx.enabled}
              onChange={(v, opts) => void act.setKeyParam(clip.clip, def.id, v, opts)}
            />
          ))}
        </div>
      ) : (
        <p className="mfx-hint">녹색·파란 배경 앞에서 찍은 클립의 배경을 투명하게 만듭니다. 위 트랙(V2)에 두면 아래 영상 위에 겹쳐집니다.</p>
      )}
    </fieldset>
  );
}

export function PipSection(ctx: InspectorContext) {
  const clip = videoClip(ctx);
  const busy = useMotionFx((s) => s.busy);
  const size = useMotionFx((s) => s.pipSize);
  const fxBusy = useEffects((s) => s.busy);
  if (!clip) return null;
  const act = useMotionFx.getState();
  const seq = ctx.sequence;
  const motion = effectsOf(clip).find((e) => e.effect === 'motion');
  const pos = readPoint(motion, 'position');
  const current = pos
    ? pipCornerOf(readNumber(motion, 'scale', 100), [pos.x, pos.y], PIP_SIZES, [seq.settings.width, seq.settings.height], sourceSize(clip, seq))
    : null;
  const onFirstTrack = seq.video[0]?.items.some((c) => c.clip === clip.clip) ?? false;
  return (
    <fieldset className="sh-group mfx-group" data-testid="pip-section">
      <legend>작은 화면(PIP)</legend>
      <div className="mfx-row">
        <div className="sh-segment" role="radiogroup" aria-label="작은 화면 크기">
          {PIP_SIZES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={size === s} disabled={busy} onClick={() => act.setPipSize(s)}>
              {s}%
            </button>
          ))}
        </div>
        <div className="mfx-corners" role="group" aria-label="작은 화면 위치">
          {PIP_CORNERS.map((c) => (
            <button
              key={c.id}
              type="button"
              className="sh-btn sh-btn--sm"
              data-corner={c.id}
              aria-pressed={current?.corner === c.id && current.size === size}
              disabled={busy || fxBusy}
              onClick={() => void act.applyPip(clip.clip, c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mfx-hint">
        {onFirstTrack && seq.video.length > 1
          ? '이 클립은 V1 에 있습니다. 작은 화면은 위 트랙(V2)의 클립에 쓰고, 미디어 패널에서 V2 레인으로 끌어다 놓으면 겹쳐집니다.'
          : '선택 클립을 화면 모서리에 작게 놓습니다. 위치가 애니메이션 중이면 플레이헤드에 키프레임이 됩니다.'}
      </p>
    </fieldset>
  );
}

export function StabilizeSection(ctx: InspectorContext) {
  const clip = videoClip(ctx);
  const busy = useMotionFx((s) => s.busy);
  const analysis = useMotionFx((s) => s.analysis);
  const lastMs = useMotionFx((s) => s.lastAnalysisMs);
  const jobs = useJobs((s) => s.jobs);
  const fxBusy = useEffects((s) => s.busy);
  const compare = useEffects((s) => s.compare);
  if (!clip) return null;
  const act = useMotionFx.getState();
  const ids = videoClipIds(ctx);
  const index = lastIndexOf(clip, WARP_STABILIZER);
  const fx = index >= 0 ? effectsOf(clip)[index] : undefined;
  const analyzing = analysis !== null;
  const locked = busy || fxBusy || compare !== null || analyzing;
  // 분석 잡들의 진행률(가장 느린 것). 이벤트가 아직 안 왔으면 0
  const progress = analysis ? jobs.filter((j) => analysis.jobs.includes(j.id)).reduce((m, j) => Math.min(m, j.progress), 1) : 0;
  const pct = analysis && analysis.jobs.length > 0 ? Math.round((progress === 1 && jobs.length === 0 ? 1 : progress) * 100) : 0;
  return (
    <fieldset className="sh-group mfx-group" data-testid="stabilize-section" data-active={!!fx} aria-busy={analyzing}>
      <legend>흔들림 줄이기</legend>
      <div className="mfx-row">
        {fx ? (
          <button type="button" className="sh-btn sh-btn--sm" disabled={locked} onClick={() => void act.removeStabilizer(ids)}>
            해제
          </button>
        ) : (
          <button type="button" className="sh-btn sh-btn--sm" disabled={locked} onClick={() => void act.stabilize(ids)}>
            흔들림 줄이기
          </button>
        )}
        {analyzing ? (
          <span className="mfx-progress" role="status" data-testid="stabilize-progress">
            <span className="sh-progress" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </span>
            분석 중... {pct}%
          </span>
        ) : lastMs !== null && fx ? (
          <span className="mfx-hint sh-tnum">{analysisNote(lastMs)}</span>
        ) : null}
      </div>
      {fx ? (
        <div className="mfx-params">
          {STABILIZER_PARAMS.map((def) => (
            <NumberParam
              key={def.id}
              def={def}
              value={readNumber(fx, def.id, 50)}
              disabled={locked || !fx.enabled}
              onChange={(v, opts) => void act.setStabilizerParam(clip.clip, def.id, v, opts)}
            />
          ))}
        </div>
      ) : null}
      <p className="mfx-hint">카메라 움직임을 위치·크기·회전(2D 근사)으로 매끄럽게 합니다. 가장자리가 조금 잘리고, 심한 흔들림은 다 잡지 못합니다.</p>
    </fieldset>
  );
}

/** 선택 중인 영상 클립 하나(오버레이가 스포이트 대상을 정할 때) */
export function pickTargetClip(): ClipInfo | null {
  const seq = useTimeline.getState().sequence;
  if (!seq) return null;
  for (const id of seq.selection) {
    const c = findClip(seq, id)?.clip;
    if (c && hasVideoEffects(c)) return c;
  }
  return null;
}
