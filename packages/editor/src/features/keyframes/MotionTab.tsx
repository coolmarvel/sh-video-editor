/**
 * 인스펙터 "모션" 탭. 위치 X/Y, 크기, 회전, 불투명도 슬라이더(features/effects 의 NumberParam 재사용) + 줄마다 키프레임 토글,
 * 플레이헤드 위 키프레임의 보간·삭제, 이전/다음 키프레임 이동, 등장·퇴장 프리셋. 값은 inspect 의 정적 값 위에 화면 목록
 * (store.tracks)으로 보간한 값이다. 편집은 전부 useKeyframes 가 엔진 커맨드로 보낸다.
 */
import { NumberParam } from '../effects/ParamControl';
import { hasVideoEffects } from '../effects/store';
import type { ParamDef } from '../effects/types';
import type { InspectorContext } from '../inspector/registry';
import type { ClipInfo } from '../timeline/types';
import { ChevronIcon, DiamondIcon } from './icons';
import { INTERPOLATIONS, MOTION_ROWS, type Interpolation, type KeyframeValue, type MotionRow, mediaTimeAt, paramKey, rowRange } from './model';
import { MOTION_PRESETS } from './presets';
import { keyframeCount, keyframeUnderPlayhead, useKeyframes, valueNow } from './store';
import './keyframes.css';

function motionClip(ctx: InspectorContext): ClipInfo | null {
  return ctx.clips.find((c) => hasVideoEffects(c)) ?? null;
}

function numberOf(v: KeyframeValue, axis: 0 | 1 | undefined): number {
  if (typeof v === 'number') return v;
  return v[axis ?? 0];
}

export function MotionTab(ctx: InspectorContext) {
  const clip = motionClip(ctx);
  const tracks = useKeyframes((s) => s.tracks);
  const busy = useKeyframes((s) => s.busy);
  const act = useKeyframes.getState();
  if (!clip) return <p className="ve-inspector__hint">영상, 텍스트, 스티커 클립을 선택하세요.</p>;
  const clipId = clip.clip;
  const { width, height } = ctx.sequence.settings;
  const under = clip.start <= ctx.playhead && ctx.playhead < clip.end;
  const mt = mediaTimeAt(clip, ctx.playhead);
  const hasAny = MOTION_ROWS.some((r) => keyframeCount(clip, r.effect, r.param) > 0);

  const rows = MOTION_ROWS.map((row) => {
    const key = paramKey(clipId, row.effect, row.param);
    const count = keyframeCount(clip, row.effect, row.param);
    const fallback: KeyframeValue = row.param === 'position' ? [width / 2, height / 2] : row.fallback;
    const value = numberOf(valueNow(tracks, clip, row.effect, row.param, fallback), row.axis);
    const current = keyframeUnderPlayhead(tracks, clip, row.effect, row.param);
    const range = rowRange(row, width, height);
    const def: ParamDef = {
      id: row.id,
      label: row.label,
      kind: row.param === 'rotation' ? 'angle' : 'float',
      min: range.min,
      max: range.max,
      step: row.step,
      unit: row.unit,
    };
    return { row, key, count, value, current, def };
  });

  const setRow = (row: MotionRow, v: number, opts: { merge?: boolean; begin?: boolean }) => {
    if (row.param === 'position') {
      const fallback: KeyframeValue = [width / 2, height / 2];
      const now = valueNow(useKeyframes.getState().tracks, clip, 'motion', 'position', fallback);
      const pos: [number, number] = typeof now === 'number' ? [width / 2, height / 2] : [now[0], now[1]];
      pos[row.axis ?? 0] = v;
      void act.setValue(clipId, 'motion', 'position', pos, opts);
      return;
    }
    void act.setValue(clipId, row.effect, row.param, v, opts);
  };

  return (
    <div className="kf-tab" data-clip={clipId} data-testid="motion-tab">
      <div className="sh-toolbar kf-toolbar" role="toolbar" aria-label="키프레임 도구">
        <button
          type="button"
          className="sh-tool kf-nav"
          disabled={busy || !hasAny}
          title="이전 키프레임으로"
          aria-label="이전 키프레임"
          onClick={() => void act.goToNeighbour(clipId, -1)}
        >
          <ChevronIcon direction={-1} />
        </button>
        <button
          type="button"
          className="sh-tool kf-nav"
          disabled={busy || !hasAny}
          title="다음 키프레임으로"
          aria-label="다음 키프레임"
          onClick={() => void act.goToNeighbour(clipId, 1)}
        >
          <ChevronIcon direction={1} />
        </button>
        <span className="kf-toolbar__hint">
          {under ? '마름모를 누르면 플레이헤드 위치에 키프레임을 넣거나 뺍니다.' : '플레이헤드를 이 클립 위로 옮기세요.'}
        </span>
      </div>

      <fieldset className="sh-group kf-group">
        <legend>모션</legend>
        {rows.map(({ row, count, value, current, def }) => (
          <div key={row.id} className="kf-row" data-row={row.id} data-animated={count > 0} data-keyframe={current !== undefined}>
            <NumberParam def={def} value={Math.round(value * 100) / 100} disabled={busy} onChange={(v, opts) => setRow(row, v, opts)} />
            <button
              type="button"
              className="sh-tool kf-toggle"
              aria-label={`${row.label} 키프레임`}
              aria-pressed={current !== undefined}
              data-animated={count > 0}
              disabled={busy || !under}
              title={current ? '플레이헤드의 키프레임 지우기' : count > 0 ? '플레이헤드에 키프레임 추가' : '애니메이션 시작(여기에 첫 키프레임)'}
              onClick={() => void act.toggleAt(clipId, row.effect, row.param)}
            >
              <DiamondIcon filled={current !== undefined} />
            </button>
            {count > 0 ? (
              <div className="kf-row__detail">
                <span className="kf-row__count sh-tnum">키프레임 {count}개</span>
                {current ? (
                  <select
                    className="sh-select kf-interp"
                    aria-label={`${row.label} 보간`}
                    value={INTERPOLATIONS.some((i) => i.id === current.interp) ? current.interp : 'linear'}
                    disabled={busy}
                    onChange={(e) => void act.setInterpolation(clipId, row.effect, row.param, mt, e.target.value as Interpolation)}
                  >
                    {INTERPOLATIONS.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.label}
                      </option>
                    ))}
                  </select>
                ) : null}
                <button
                  type="button"
                  className="sh-btn sh-btn--sm"
                  disabled={busy}
                  aria-label={`${row.label} 키프레임 모두 지우기`}
                  onClick={() => void act.clearAnimation(clipId, row.effect, row.param)}
                >
                  모두 지우기
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </fieldset>

      <fieldset className="sh-group kf-group">
        <legend>등장, 퇴장 애니메이션</legend>
        {(['in', 'out'] as const).map((kind) => (
          <div key={kind} className="kf-presets" role="group" aria-label={kind === 'in' ? '등장' : '퇴장'}>
            <span className="kf-presets__label">{kind === 'in' ? '등장' : '퇴장'}</span>
            {MOTION_PRESETS.filter((p) => p.kind === kind).map((p) => (
              <button
                key={p.id}
                type="button"
                className="sh-btn sh-btn--sm"
                disabled={busy}
                title={`키프레임 두 개로 ${p.label}`}
                onClick={() => void act.applyPreset(clipId, p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        ))}
        <p className="kf-hint">
          1초 동안(클립이 짧으면 길이의 절반) 키프레임 두 개를 넣습니다. 미리보기에서 클립을 끌면 위치가 바뀌고, 위치가 애니메이션 중이면 키프레임이 됩니다.
        </p>
      </fieldset>
    </div>
  );
}
