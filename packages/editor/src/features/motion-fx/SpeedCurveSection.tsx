/**
 * 속도 탭의 "속도 곡선" 절. 프리셋 세 개(몽타주, 히어로, 총알) + 곡선 편집기 + 곡선 지우기. 점 목록은 features/keyframes 의
 * 화면 목록(time_remap/speed)이고, 목록이 stale 이면 엔진 `effects.keyframes` 로 다시 읽는다. 편집은 useMotionFx 가 엔진 커맨드로.
 */
import { useEffect } from 'react';
import { hasVideoEffects } from '../effects/store';
import type { InspectorContext } from '../inspector/registry';
import { paramKey, sequenceTimeAt } from '../keyframes/model';
import { keyframeCount, useKeyframes } from '../keyframes/store';
import { frameTicks } from '../timeline/geometry';
import { CurveEditor, type CurvePointView } from './CurveEditor';
import { RAMP_MAX_POINTS, RAMP_PRESETS, lastKeyframeTime, rampSummary } from './ramp';
import { useMotionFx } from './store';
import './motion-fx.css';

export function SpeedCurveSection(ctx: InspectorContext) {
  const clip = ctx.clips.find((c) => hasVideoEffects(c)) ?? null;
  const clipId = clip?.clip ?? -1;
  const key = clip ? paramKey(clip.clip, 'time_remap', 'speed') : '';
  const track = useKeyframes((s) => (key ? s.tracks[key] : undefined));
  const isStale = useKeyframes((s) => (key ? s.stale[key] === true : false));
  const kfBusy = useKeyframes((s) => s.busy);
  const busy = useMotionFx((s) => s.busy);
  const count = clip ? keyframeCount(clip, 'time_remap', 'speed') : 0;
  const needLoad = !!clip && (isStale || (count > 0 && (track?.length ?? 0) !== count));

  useEffect(() => {
    if (needLoad) void useKeyframes.getState().load(clipId, 'time_remap', 'speed');
  }, [needLoad, clipId, count]);

  if (!clip) return null;
  const ft = frameTicks(ctx.sequence.settings.frame_rate);
  const last = lastKeyframeTime(clip, ft);
  const locked = busy || kfBusy;
  const act = useMotionFx.getState();
  const points: CurvePointView[] = (track ?? [])
    .map((k) => ({ mediaTime: k.time, time: sequenceTimeAt(clip, k.time) ?? clip.start, value: typeof k.value === 'number' ? k.value : 100 }))
    .sort((a, b) => a.time - b.time);
  const toPoints = (list: CurvePointView[]) => list.map((p) => ({ time: p.time, value: p.value }));

  return (
    <fieldset className="sh-group mfx-group" data-testid="speed-curve-section">
      <legend>속도 곡선</legend>
      <div className="mfx-presets" role="group" aria-label="속도 곡선 프리셋">
        {RAMP_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="sh-btn sh-btn--sm"
            disabled={locked}
            title={p.description}
            onClick={() => void act.applyRamp(clip.clip, p.id)}
          >
            {p.label}
          </button>
        ))}
        <button type="button" className="sh-btn sh-btn--sm" disabled={locked || count === 0} onClick={() => void act.clearRamp(clip.clip)}>
          곡선 지우기
        </button>
      </div>
      {count > 0 || points.length > 0 ? (
        <>
          <CurveEditor
            start={clip.start}
            last={last}
            frameTicks={ft}
            points={points}
            track={track ?? []}
            disabled={locked}
            onMove={(moved, all) => void act.setRampPoints(clip.clip, toPoints(all), `속도 곡선 점 이동: ${Number((moved.value / 100).toFixed(2))}x`)}
            onAdd={(time, value) => void act.setRampPoints(clip.clip, toPoints([...points, { mediaTime: -1, time, value }]), '속도 곡선 점 추가')}
            onDelete={(p) => void act.setRampPoints(clip.clip, toPoints(points.filter((x) => x.mediaTime !== p.mediaTime)), '속도 곡선 점 삭제')}
          />
          <p className="mfx-hint sh-tnum" data-testid="speed-curve-summary">
            점 {points.length}개, {rampSummary(points)}. 점을 끌어 옮기고, 빈 곳을 더블클릭하면 점을 더합니다(최대 {RAMP_MAX_POINTS}개). 점을 고르고 Delete 로
            지웁니다.{isStale ? ' 목록을 다시 읽는 중입니다.' : ''}
          </p>
        </>
      ) : (
        <p className="mfx-hint">프리셋을 누르면 클립 길이는 그대로 두고 구간마다 속도가 달라집니다. 소리는 원래 속도로 납니다.</p>
      )}
    </fieldset>
  );
}
