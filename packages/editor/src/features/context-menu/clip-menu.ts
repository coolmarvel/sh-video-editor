/**
 * 타임라인 클립·빈 레인의 우클릭 메뉴 항목. 메뉴바 클립 메뉴와 같은 동작 id(shortcuts/actions)를 쓰는 항목은 단축키를 적는다.
 */
import { runAction } from '../shortcuts/actions';
import { shortcutLabel } from '../shortcuts/keymap';
import { useTimeline } from '../timeline/store';
import { findClip, type ClipInfo } from '../timeline/types';
import { detectScenes, duplicateClip, linkGroups, renameClip, selectedClips, synchronizeByAudio, toggleEnabled, toggleLink } from './clip-actions';
import { item, sep, type ContextMenuEntry } from './store';

export function clipMenu(clip: ClipInfo): ContextMenuEntry[] {
  const state = useTimeline.getState();
  const seq = state.sequence;
  if (!seq) return [];
  const kind = findClip(seq, clip.clip)?.kind ?? 'video';
  const selection = selectedClips();
  const clips = selection.some((c) => c.clip === clip.clip) ? selection : [clip];
  const n = clips.length;
  const under = clip.start < state.playhead && state.playhead < clip.end;
  const linked = clip.link !== null;
  const busy = state.busy;
  const groups = linkGroups(clips);
  const hasVideo = clips.some((c) => findClip(seq, c.clip)?.kind === 'video');
  return [
    item('자르기', () => state.razorAtPlayhead(), { disabled: busy || !under, key: shortcutLabel('clip.razor') }),
    item(n > 1 ? `삭제 (${n}개)` : '삭제', () => state.deleteSelection(), { disabled: busy, danger: true, key: shortcutLabel('clip.delete') }),
    item('리플 삭제', () => runAction('clip.rippleDelete'), { disabled: busy, key: shortcutLabel('clip.rippleDelete') }),
    item('복제', () => duplicateClip(clip), { disabled: busy }),
    sep,
    item('속도, 길이...', () => runAction('clip.speed'), { disabled: busy, key: shortcutLabel('clip.speed') }),
    item('장면마다 자르기', () => detectScenes(clips), { disabled: busy || !hasVideo }),
    item('흔들림 줄이기', () => runAction('effects.stabilize'), { disabled: busy || kind !== 'video' }),
    sep,
    item(linked ? '소리 분리(연결 해제)' : '다시 연결', () => toggleLink(clips), {
      disabled: busy || (!linked && groups < 2),
      key: shortcutLabel('clip.link'),
    }),
    item('소리로 싱크 맞추기', () => synchronizeByAudio(clips), { disabled: busy || groups < 2 }),
    sep,
    item(kind === 'audio' ? (clip.enabled ? '음소거' : '음소거 해제') : clip.enabled ? '끄기' : '켜기', () => toggleEnabled(clips), {
      disabled: busy,
      key: shortcutLabel('clip.enable'),
    }),
    item('이름 바꾸기...', () => renameClip(clip), { disabled: busy || n > 1 }),
  ];
}

/** 빈 레인 자리의 메뉴 */
export function laneMenu(): ContextMenuEntry[] {
  const state = useTimeline.getState();
  const busy = state.busy || !state.sequence;
  return [
    item('모든 트랙 자르기', () => runAction('clip.razorAll'), { disabled: busy, key: shortcutLabel('clip.razorAll') }),
    item('전체 선택', () => runAction('edit.selectAll'), { disabled: busy, key: shortcutLabel('edit.selectAll') }),
    item('붙여넣기', () => runAction('edit.paste'), { disabled: busy, key: shortcutLabel('edit.paste') }),
    sep,
    item('트랙 추가', () => runAction('sequence.addTracks'), { disabled: busy }),
    item('타임라인 전체 보기', () => state.requestFit(), { disabled: busy, key: shortcutLabel('timeline.fit') }),
  ];
}
