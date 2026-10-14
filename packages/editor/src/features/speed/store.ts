/**
 * 속도·리버스·프리즈 상태. 폼 값(속도 퍼센트, 역방향, 리플, 보간, 음정 유지)을 갖고, 적용은 엔진 커맨드로만 한다:
 * `clip.speedDuration`(속도·역방향·리플·보간·음정 유지), `clip.insertFrameHoldSegment`(플레이헤드 자리에 정지 구간 삽입).
 * 인스펙터 "속도" 탭과 클립 메뉴의 "속도, 길이" 대화상자가 같은 store 를 쓴다.
 */
import { create } from 'zustand';
import { useEditor } from '../../store';
import { execCommand } from '../shortcuts/actions';
import { useTimeline } from '../timeline/store';
import { findClip, type ClipInfo } from '../timeline/types';
import { clampSpeed, formatSpeed, type Interpolation } from './model';

/** "이 프레임 고정" 이 끼워 넣는 정지 구간 길이(초) */
export const FREEZE_SECONDS = 2;

interface SpeedState {
  /** 퍼센트(100 = 원래 속도) */
  speed: number;
  reverse: boolean;
  /** 길이가 바뀌면 뒤 클립을 밀거나 당긴다 */
  ripple: boolean;
  interpolation: Interpolation;
  /** 속도를 바꿔도 소리 음정을 유지(엔진 WSOLA). 역방향에는 적용되지 않는다 */
  maintainPitch: boolean;
  setSpeed(percent: number): void;
  setReverse(on: boolean): void;
  setRipple(on: boolean): void;
  setInterpolation(mode: Interpolation): void;
  setMaintainPitch(on: boolean): void;
  /** 선택한 클립의 현재 값으로 폼을 맞춘다. 클립이 없으면 기본값. 리플은 타임라인 토글을 따른다 */
  syncFrom(clip: ClipInfo | null): void;
  /** 폼 값을 클립들에 적용한다. 성공하면 true */
  apply(clips: number[]): Promise<boolean>;
  /** 플레이헤드가 올라간 선택 클립(영상 우선)에 FREEZE_SECONDS 초 정지 구간을 끼워 넣는다. 성공하면 true */
  freeze(clips: ClipInfo[], playhead: number): Promise<boolean>;
}

export const useSpeed = create<SpeedState>((set, get) => ({
  speed: 100,
  reverse: false,
  ripple: false,
  interpolation: 'frameSampling',
  maintainPitch: false,
  setSpeed: (percent) => set({ speed: clampSpeed(percent) }),
  setReverse: (reverse) => set({ reverse }),
  setRipple: (ripple) => set({ ripple }),
  setInterpolation: (interpolation) => set({ interpolation }),
  setMaintainPitch: (maintainPitch) => set({ maintainPitch }),

  syncFrom(clip) {
    set({
      speed: clip ? clampSpeed(clip.speed * 100) : 100,
      reverse: clip?.reverse ?? false,
      maintainPitch: clip?.maintainPitch ?? false,
      ripple: useTimeline.getState().ripple,
    });
  },

  async apply(clips) {
    if (clips.length === 0) {
      useEditor.setState({ status: '속도를 바꿀 클립을 먼저 선택하세요' });
      return false;
    }
    const { speed, reverse, ripple, interpolation, maintainPitch } = get();
    const r = await execCommand(
      'clip.speedDuration',
      { clips, speed, reverse, ripple, interpolation, maintainPitch },
      `속도 ${formatSpeed(speed)}${reverse ? ', 역방향' : ''}${maintainPitch && !reverse ? ', 음정 유지' : ''}: 클립 ${clips.length}개`,
    );
    return r !== undefined;
  },

  async freeze(clips, playhead) {
    const seq = useTimeline.getState().sequence;
    const under = clips.filter((c) => c.start <= playhead && playhead < c.end);
    const target = under.find((c) => (seq ? findClip(seq, c.clip)?.kind === 'video' : true)) ?? under[0];
    if (!target) {
      useEditor.setState({ status: '플레이헤드를 선택한 클립 위에 놓은 뒤 고정하세요' });
      return false;
    }
    const r = await execCommand(
      'clip.insertFrameHoldSegment',
      { clip: target.clip, time: playhead, seconds: FREEZE_SECONDS },
      `이 프레임을 ${FREEZE_SECONDS}초 동안 고정했습니다`,
    );
    return r !== undefined;
  },
}));
