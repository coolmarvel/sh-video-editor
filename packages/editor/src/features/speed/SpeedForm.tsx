/**
 * 속도 폼(슬라이더 + 배속 입력 + 빠른 선택 + 보간 + 역방향 + 음정 유지 + 리플 + 적용 후 길이). 값은 useSpeed 에 있고,
 * 인스펙터 "속도" 탭과 "속도, 길이" 대화상자가 함께 쓴다. 적용 버튼은 쓰는 쪽이 둔다.
 */
import { useEffect, useState, type Ref } from 'react';
import { formatTimecode } from '../../engine/time';
import type { ClipInfo, SequenceInfo } from '../timeline/types';
import {
  INTERPOLATIONS,
  SLIDER_STEPS,
  SPEED_MAX,
  SPEED_MIN,
  SPEED_PRESETS,
  formatSpeed,
  parseSpeedInput,
  pitchNote,
  predictDuration,
  sliderToSpeed,
  speedToSlider,
  type Interpolation,
} from './model';
import { useSpeed } from './store';
import './speed.css';

interface SpeedFormProps {
  /** 길이 예측의 기준 클립(첫 선택 클립). 없으면 예측 줄을 숨긴다 */
  clip: ClipInfo | null;
  sequence: SequenceInfo | null;
  /** 선택한 클립 수(안내 문구) */
  count: number;
  /** 배속 입력칸 ref(대화상자가 포커스를 준다) */
  inputRef?: Ref<HTMLInputElement>;
  /** 배속 입력칸에서 Enter */
  onSubmit?(): void;
}

export function SpeedForm({ clip, sequence, count, inputRef, onSubmit }: SpeedFormProps) {
  const speed = useSpeed((s) => s.speed);
  const reverse = useSpeed((s) => s.reverse);
  const ripple = useSpeed((s) => s.ripple);
  const interpolation = useSpeed((s) => s.interpolation);
  const maintainPitch = useSpeed((s) => s.maintainPitch);
  const { setSpeed, setReverse, setRipple, setInterpolation, setMaintainPitch } = useSpeed.getState();
  const note = pitchNote(speed, maintainPitch, reverse);
  // 입력 중인 글자는 따로 둔다(소수점 입력 중간 상태를 지키려고). store 값이 바뀌면 다시 맞춘다
  const [text, setText] = useState(() => String(speed / 100));
  useEffect(() => {
    setText((t) => (parseSpeedInput(t) === speed ? t : String(speed / 100)));
  }, [speed]);
  const valid = parseSpeedInput(text) !== null;

  const fps = sequence ? sequence.settings.frame_rate.num / sequence.settings.frame_rate.den : 30;
  const frameTicks = sequence ? Math.round((254_016_000_000 * sequence.settings.frame_rate.den) / sequence.settings.frame_rate.num) : 1;
  const predicted = clip ? predictDuration(clip, speed, frameTicks) : null;

  return (
    <div className="ve-speed">
      <div className="ve-speed__row">
        <input
          className="ve-speed__range"
          type="range"
          aria-label="속도"
          min={0}
          max={SLIDER_STEPS}
          step={1}
          value={speedToSlider(speed)}
          onChange={(e) => setSpeed(sliderToSpeed(Number(e.target.value)))}
        />
        <input
          ref={inputRef}
          id="ve-speed-value"
          className="sh-input sh-tnum ve-speed__value"
          type="number"
          aria-label="배속"
          min={SPEED_MIN / 100}
          max={SPEED_MAX / 100}
          step={0.1}
          value={text}
          aria-invalid={!valid}
          onChange={(e) => {
            setText(e.target.value);
            const p = parseSpeedInput(e.target.value);
            if (p !== null) setSpeed(p);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid && onSubmit) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        <span className="ve-speed__unit">x</span>
      </div>
      <div className="sh-segment" role="radiogroup" aria-label="빠른 배속">
        {SPEED_PRESETS.map((p) => (
          <button key={p} type="button" role="radio" aria-checked={speed === p} onClick={() => setSpeed(p)}>
            {formatSpeed(p)}
          </button>
        ))}
      </div>
      <div className="sh-form">
        <label htmlFor="ve-speed-interp">보간</label>
        <select id="ve-speed-interp" className="sh-select" value={interpolation} onChange={(e) => setInterpolation(e.target.value as Interpolation)}>
          {INTERPOLATIONS.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </select>
      </div>
      <label className="sh-check">
        <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />
        <span>역방향 재생</span>
      </label>
      <label className="sh-check" title="속도를 바꿔도 소리의 음높이를 그대로 둡니다(0.5x~2x 에서 가장 깨끗합니다)">
        <input type="checkbox" checked={maintainPitch} onChange={(e) => setMaintainPitch(e.target.checked)} data-maintain-pitch="" />
        <span>음정 유지(소리 음높이 그대로)</span>
      </label>
      {note ? (
        <p className="ve-speed__note" role="note" data-speed-pitch-note="">
          {note}
        </p>
      ) : null}
      <label className="sh-check">
        <input type="checkbox" checked={ripple} onChange={(e) => setRipple(e.target.checked)} />
        <span>리플(길이가 바뀌면 뒤 클립을 밀거나 당김)</span>
      </label>
      {clip && predicted !== null ? (
        <p className="ve-speed__result sh-tnum" data-speed-result="">
          적용 후 길이 {formatTimecode(predicted, fps)} (지금 {formatTimecode(clip.duration, fps)}
          {count > 1 ? `, 선택 ${count}개 중 첫 클립 기준` : ''})
        </p>
      ) : (
        <p className="ve-speed__result">클립을 선택하면 적용 후 길이를 보여 줍니다.</p>
      )}
    </div>
  );
}
