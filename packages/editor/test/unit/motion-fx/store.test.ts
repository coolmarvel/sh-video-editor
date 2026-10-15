/**
 * features/motion-fx/store.ts: 램프 프리셋이 time_remap speed 키프레임을 트랜잭션 한 단계로 넣고 배지가 "램프" 가 되는지, 곡선 점
 * 편집, 크로마키 켜기·스포이트(renderFrame 픽셀 -> key_color)·파라미터·끄기, 작은 화면 프리셋, 흔들림 줄이기(적용·분석 시간·해제),
 * 섹션 레지스트리.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { registerEffectsSection, useEffectsSections } from '@editor/features/effects/sections';
import { effectsOf, lastIndexOf } from '@editor/features/effects/store';
import { paramKey } from '@editor/features/keyframes/model';
import { keyframeCount, useKeyframes } from '@editor/features/keyframes/store';
import { PICK_SCALE, useMotionFx } from '@editor/features/motion-fx/store';
import { pipPlacement } from '@editor/features/motion-fx/pip';
import { badgeLabel } from '@editor/features/speed/model';
import { registerSpeedSection, useSpeedSections } from '@editor/features/speed/sections';
import { useProject } from '@editor/features/project/store';
import { useTimeline } from '@editor/features/timeline/store';
import { findClip } from '@editor/features/timeline/types';
import { useEditor } from '@editor/store';
import { EnginePoller } from '@editor/features/events/poller';
import { installEnginePoller } from '@editor/features/events/useEnginePolling';
import { PUMP_INTERVAL_MS, useJobs } from '@editor/features/jobs/store';
import { T, engineWithClips, type FakeClip, type FakeEngine } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';
import '@editor/features/motion-fx';

let engine: FakeEngine;
let a: FakeClip;
let b: FakeClip;

beforeEach(async () => {
  resetStores();
  useMotionFx.setState(useMotionFx.getInitialState(), true);
  const made = engineWithClips();
  engine = made.engine;
  a = made.clips[0]!;
  b = made.clips[2]!;
  await connect({}, engine);
  // 흔들림 분석 잡의 진행률 이벤트는 폴러가 올린다(실제 앱은 useEnginePolling 훅)
  installEnginePoller(new EnginePoller(engine.bridge));
  await useTimeline.getState().refresh();
});

const fx = () => useMotionFx.getState();
const clipNow = () => findClip(useTimeline.getState().sequence!, a.clip)!.clip;
const rampKey = () => paramKey(a.clip, 'time_remap', 'speed');
const labelsOf = () => engine.undoStack.map((u) => u.label);

describe('속도 램프', () => {
  it('프리셋은 toggleAnimation 없이 addKeyframe + setParam {time} 을 트랜잭션 한 단계로 보내고 배지가 "램프" 가 된다', async () => {
    expect(await fx().applyRamp(a.clip, 'montage')).toBe(true);
    expect(keyframeCount(clipNow(), 'time_remap', 'speed')).toBe(3);
    expect(engine.callsOf('effects.toggleAnimation')).toEqual([]);
    expect(engine.callsOf('effects.addKeyframe')).toEqual([{ clip: a.clip, effect: 'time_remap', param: 'speed', time: 0 }]);
    const sets = engine.callsOf('effects.setParam');
    expect(sets.map((c) => [c!['time'], c!['value']])).toEqual([
      [0, 50],
      [2 * T, 100],
      [4 * T - T / 30, 300],
    ]);
    expect(engine.callsOf('edit.beginTransaction')).toEqual([{ label: '속도 곡선: 몽타주' }]);
    // 트랜잭션 한 단계
    expect(labelsOf()).toEqual(['속도 곡선: 몽타주']);
    expect(useEditor.getState().status).toContain('속도 곡선을 넣었습니다: 몽타주');
    expect(badgeLabel(clipNow())).toBe('램프');
    expect(useKeyframes.getState().tracks[rampKey()]!.map((k) => k.value)).toEqual([50, 100, 300]);
    // 다른 프리셋으로 바꾸면 먼저 지운다(toggleAnimation) 그리고 여전히 한 단계
    expect(await fx().applyRamp(a.clip, 'hero')).toBe(true);
    expect(engine.callsOf('effects.toggleAnimation')).toEqual([{ clip: a.clip, effect: 'time_remap', param: 'speed' }]);
    expect(keyframeCount(clipNow(), 'time_remap', 'speed')).toBe(4);
    expect(labelsOf()).toEqual(['속도 곡선: 몽타주', '속도 곡선: 히어로']);
    // 실행 취소 한 번이면 몽타주로 돌아가고 화면 목록도 엔진에서 다시 읽는다
    await useTimeline.getState().undo();
    await useKeyframes.getState().synced();
    expect(keyframeCount(clipNow(), 'time_remap', 'speed')).toBe(3);
    expect(useKeyframes.getState().tracks[rampKey()]!.map((k) => k.value)).toEqual([50, 100, 300]);
  });

  it('점 목록으로 바꾸기, 빈 목록이면 지우기, 모르는 프리셋·클립은 거부', async () => {
    expect(await fx().applyRamp(a.clip, 'nope' as never)).toBe(false);
    expect(await fx().applyRamp(999, 'montage')).toBe(false);
    await fx().applyRamp(a.clip, 'bullet');
    expect(
      await fx().setRampPoints(
        a.clip,
        [
          { time: 0, value: 200 },
          { time: 2 * T, value: 50 },
        ],
        '속도 곡선 점 이동: 2x',
      ),
    ).toBe(true);
    expect(keyframeCount(clipNow(), 'time_remap', 'speed')).toBe(2);
    expect(useKeyframes.getState().tracks[rampKey()]!.map((k) => [k.time / T, k.value])).toEqual([
      [0, 200],
      [2, 50],
    ]);
    expect(useEditor.getState().status).toBe('속도 곡선 점 이동: 2x');
    expect(await fx().setRampPoints(a.clip, [], '')).toBe(true);
    expect(keyframeCount(clipNow(), 'time_remap', 'speed')).toBe(0);
    expect(badgeLabel(clipNow())).toBeNull();
    expect(useEditor.getState().status).toBe('속도 곡선을 지웠습니다');
    // 이미 없으면 clearRamp 는 아무것도 보내지 않는다
    const n = engine.calls.length;
    await fx().clearRamp(a.clip);
    expect(engine.calls.length).toBe(n);
  });

  it('목록은 엔진 effects.keyframes 에서 읽은 시각·값·보간이다(화면 목록을 지워도 다음 inspect 에 되살아난다)', async () => {
    await fx().applyRamp(a.clip, 'montage');
    useKeyframes.setState({ tracks: {} });
    await useTimeline.getState().refresh();
    await useKeyframes.getState().synced();
    const track = useKeyframes.getState().tracks[rampKey()]!;
    expect(track.map((k) => [k.time / T, k.value, k.interp])).toEqual([
      [0, 50, 'linear'],
      [2, 100, 'linear'],
      [4 - 1 / 30, 300, 'linear'],
    ]);
    // 키프레임이 없는 파라미터는 목록에 없다
    expect(useKeyframes.getState().tracks[paramKey(a.clip, 'motion', 'scale')]).toBeUndefined();
  });
});

describe('배경 지우기(크로마키)', () => {
  it('켜기는 ultra_key 를 붙이고, 파라미터는 그 효과 index 로 setParam, 끄기는 remove', async () => {
    await fx().enableChromaKey([a.clip]);
    expect(engine.callsOf('effects.apply')).toEqual([{ clips: [a.clip], effect: 'ultra_key' }]);
    expect(lastIndexOf(clipNow(), 'ultra_key')).toBe(0);
    expect(useEditor.getState().status).toBe('효과를 추가했습니다: 배경 지우기(크로마키)');
    // 이미 있으면 다시 붙이지 않는다
    await fx().enableChromaKey([a.clip]);
    expect(engine.callsOf('effects.apply')).toHaveLength(1);
    await fx().setKeyParam(a.clip, 'tolerance', 70);
    expect(engine.callsOf('effects.setParam').at(-1)).toEqual({ clip: a.clip, effect: 0, param: 'tolerance', value: 70 });
    expect(effectsOf(clipNow())[0]!.params['tolerance']!.value).toBe(70);
    await fx().removeChromaKey([a.clip]);
    expect(lastIndexOf(clipNow(), 'ultra_key')).toBe(-1);
    // 없을 때의 setKeyParam/remove 는 아무것도 보내지 않는다
    const n = engine.calls.length;
    await fx().setKeyParam(a.clip, 'tolerance', 10);
    await fx().removeChromaKey([a.clip]);
    expect(engine.calls.length).toBe(n);
  });

  it('스포이트는 효과를 잠시 끄고 renderFrame 픽셀을 key_color 로 넣으며 트랜잭션 한 단계다', async () => {
    await useTimeline.getState().setPlayhead(T);
    fx().startPick();
    expect(fx().picking).toBe(true);
    expect(useEditor.getState().status).toContain('클릭하세요');
    fx().cancelPick();
    expect(fx().picking).toBe(false);
    fx().cancelPick();
    fx().startPick();
    // 효과가 없으면 붙이면서 색을 넣는다. 가짜 엔진의 프레임은 (tick 기준 빨강, 0, 0)
    expect(await fx().pickAt(a.clip, 0.5, 0.5)).toBe(true);
    expect(fx().picking).toBe(false);
    const frame = engine.renderFrame(T, PICK_SCALE)!;
    const hex = `#${frame.rgba[0]!.toString(16).padStart(2, '0')}0000`;
    expect(engine.callsOf('effects.setParam').at(-1)).toEqual({ clip: a.clip, effect: 0, param: 'key_color', value: hex });
    expect(engine.callsOf('effects.toggleEnabled')).toEqual([]);
    expect(labelsOf().at(-1)).toBe('키 색 고르기');
    expect(useEditor.getState().status).toBe(`키 색을 골랐습니다: ${hex}`);
    // 이미 켜져 있으면 끄고 읽고 다시 켠다(여전히 한 단계)
    const before = engine.undoStack.length;
    expect(await fx().pickAt(a.clip, 0.1, 0.1)).toBe(true);
    expect(engine.callsOf('effects.toggleEnabled')).toEqual([
      { clip: a.clip, index: 0 },
      { clip: a.clip, index: 0 },
    ]);
    expect(effectsOf(clipNow())[0]!.enabled).toBe(true);
    expect(engine.undoStack.length).toBe(before + 1);
    // 없는 클립이면 거부
    expect(await fx().pickAt(999, 0.5, 0.5)).toBe(false);
    // renderFrame 이 실패하면 트랜잭션을 되돌린다
    engine.failNext('effects.setParam', '깨짐');
    expect(await fx().pickAt(a.clip, 0.5, 0.5)).toBe(false);
    expect(useEditor.getState().error).toContain('키 색을 고를 수 없습니다');
    expect(engine.callsOf('edit.cancelTransaction')).toHaveLength(1);
  });
});

describe('작은 화면', () => {
  it('모서리 프리셋은 motion scale·position 을 트랜잭션 한 단계로 바꾼다', async () => {
    fx().setPipSize(33);
    expect(fx().pipSize).toBe(33);
    fx().setPipSize(99);
    expect(fx().pipSize).toBe(25);
    expect(await fx().applyPip(a.clip, 'top-right')).toBe(true);
    const seq = useTimeline.getState().sequence!;
    const place = pipPlacement('top-right', 25, [seq.settings.width, seq.settings.height], [seq.settings.width, seq.settings.height]);
    expect(engine.callsOf('effects.setParam')).toEqual([
      { clip: a.clip, effect: 'motion', param: 'scale', value: place.scale },
      { clip: a.clip, effect: 'motion', param: 'position', value: place.position },
    ]);
    expect(labelsOf()).toEqual(['작은 화면: 오른쪽 위 25%']);
    expect(useEditor.getState().status).toBe('작은 화면: 오른쪽 위 25%');
    const motion = effectsOf(clipNow()).find((e) => e.effect === 'motion')!;
    expect(motion.params['scale']!.value).toBe(place.scale);
    expect(motion.params['position']!.value).toEqual(place.position);
    expect(await fx().applyPip(999, 'top-left')).toBe(false);
    engine.failNext('effects.setParam', '안 됨');
    expect(await fx().applyPip(a.clip, 'bottom-left')).toBe(false);
    expect(useEditor.getState().error).toContain('작은 화면으로 바꿀 수 없습니다');
  });

  it('위치가 애니메이션 중이면 화면 키프레임 목록에도 들어간다', async () => {
    await useKeyframes.getState().toggleAt(a.clip, 'motion', 'position');
    await useTimeline.getState().setPlayhead(2 * T);
    await fx().applyPip(a.clip, 'bottom-right');
    const track = useKeyframes.getState().tracks[paramKey(a.clip, 'motion', 'position')]!;
    expect(track).toHaveLength(2);
    expect(keyframeCount(clipNow(), 'motion', 'position')).toBe(2);
  });
});

describe('흔들림 줄이기', () => {
  it('effects.analyzeStabilizer 잡을 걸고 진행률을 기다려 끝나면 상태 줄에 분석 시간과 2D 근사를 적는다', async () => {
    expect(await fx().stabilize([])).toBe(false);
    expect(useEditor.getState().status).toContain('먼저 선택하세요');
    const p = fx().stabilize([a.clip]);
    await new Promise((r) => setTimeout(r, 0));
    // 잡이 걸리면 분석 표시와 잡 목록에 보인다
    expect(fx().analysis).toMatchObject({ clip: a.clip });
    expect(useJobs.getState().jobs.map((j) => j.kind)).toEqual(['stabilizer']);
    expect(useEditor.getState().status).toContain('진행 막대');
    expect(await p).toBe(true);
    expect(engine.callsOf('effects.analyzeStabilizer')).toEqual([{ clip: a.clip }]);
    expect(engine.callsOf('effects.apply')).toEqual([]);
    expect(lastIndexOf(clipNow(), 'warp_stabilizer')).toBe(0);
    // 클립 하나는 엔진이 붙인 한 단계 그대로(트랜잭션 없음)
    expect(labelsOf()).toEqual(['Warp Stabilizer']);
    expect(engine.callsOf('edit.beginTransaction')).toEqual([]);
    expect(fx().lastAnalysisMs).not.toBeNull();
    expect(fx().analysis).toBeNull();
    expect(fx().busy).toBe(false);
    expect(useJobs.getState().jobs).toEqual([]);
    expect(useEditor.getState().status).toMatch(/흔들림 줄이기를 적용했습니다: 클립 1개 \(분석 \d+\.\d초, 2D 근사/);
    expect(useProject.getState().notices.at(-1)).toMatchObject({ kind: 'success' });
    // 다시 누르면 엔진이 cached 를 돌려줘 잡 없이 바로 끝난다
    await fx().stabilize([a.clip]);
    expect(engine.callsOf('effects.analyzeStabilizer')).toHaveLength(2);
    expect(engine.jobs.filter((j) => j.kind === 'stabilizer')).toHaveLength(1);
    await fx().setStabilizerParam(a.clip, 'smoothness', 80);
    expect(engine.callsOf('effects.setParam').at(-1)).toEqual({ clip: a.clip, effect: 0, param: 'smoothness', value: 80 });
    await fx().removeStabilizer([a.clip]);
    expect(lastIndexOf(clipNow(), 'warp_stabilizer')).toBe(-1);
    expect(useEditor.getState().status).toBe('흔들림 줄이기를 해제했습니다');
    const n = engine.calls.length;
    await fx().setStabilizerParam(a.clip, 'smoothness', 10);
    await fx().removeStabilizer([a.clip]);
    expect(engine.calls.length).toBe(n);
  });

  it('클립 둘 이상에 처음 붙일 때는 한 단계 "흔들림 줄이기" 로 묶고 잡 둘을 기다린다', async () => {
    expect(await fx().stabilize([a.clip, b.clip])).toBe(true);
    expect(engine.callsOf('effects.analyzeStabilizer')).toEqual([{ clip: a.clip }, { clip: b.clip }]);
    expect(engine.callsOf('edit.beginTransaction')).toEqual([{ label: '흔들림 줄이기' }]);
    expect(labelsOf()).toEqual(['흔들림 줄이기']);
    expect(useEditor.getState().status).toContain('클립 2개');
    expect(engine.jobs.filter((j) => j.kind === 'stabilizer' && j.finished)).toHaveLength(2);
  });

  it('취소하면 분석 없는 효과를 떼고 경고로 알린다', async () => {
    const slow = engineWithClips({ jobStep: 0.01 });
    engine = slow.engine;
    a = slow.clips[0]!;
    await connect({}, engine);
    installEnginePoller(new EnginePoller(engine.bridge));
    await useTimeline.getState().refresh();
    const p = fx().stabilize([a.clip]);
    await new Promise((r) => setTimeout(r, PUMP_INTERVAL_MS * 2));
    const job = useJobs.getState().jobs[0]!;
    expect(job.progress).toBeGreaterThan(0);
    expect(lastIndexOf(clipNow(), 'warp_stabilizer')).toBe(0);
    await useJobs.getState().cancel(engine.bridge, job.id);
    expect(await p).toBe(false);
    expect(lastIndexOf(clipNow(), 'warp_stabilizer')).toBe(-1);
    expect(useEditor.getState().status).toBe('흔들림 분석을 취소하고 효과를 뗐습니다');
    expect(useProject.getState().notices.at(-1)).toMatchObject({ kind: 'warning' });
    expect(fx().analysis).toBeNull();
    expect(fx().busy).toBe(false);
  });

  it('잡을 걸지 못하면 오류를 올리고 분석 표시를 거둔다', async () => {
    engine.failNext('effects.analyzeStabilizer', '거부');
    expect(await fx().stabilize([a.clip])).toBe(false);
    expect(useEditor.getState().error).toContain('흔들림을 줄일 수 없습니다');
    expect(fx().analysis).toBeNull();
    expect(fx().busy).toBe(false);
  });
});

describe('절 레지스트리', () => {
  it('모듈을 읽으면 속도 탭 절 하나와 효과 탭 절 셋이 순서대로 등록되고, 등록 해제 함수가 뺀다', () => {
    expect(useSpeedSections.getState().sections.map((s) => s.id)).toEqual(['speed-curve']);
    expect(useEffectsSections.getState().sections.map((s) => s.id)).toEqual(['chroma-key', 'pip', 'stabilize']);
    const Dummy = () => null;
    const offSpeed = registerSpeedSection({ id: 'zz', order: 1, component: Dummy });
    const offFx = registerEffectsSection({ id: 'zz', component: Dummy });
    expect(useSpeedSections.getState().sections.map((s) => s.id)).toEqual(['zz', 'speed-curve']);
    expect(useEffectsSections.getState().sections.map((s) => s.id)).toEqual(['chroma-key', 'pip', 'stabilize', 'zz']);
    offSpeed();
    offFx();
    expect(useSpeedSections.getState().sections.map((s) => s.id)).toEqual(['speed-curve']);
    expect(useEffectsSections.getState().sections.map((s) => s.id)).toEqual(['chroma-key', 'pip', 'stabilize']);
  });
});
