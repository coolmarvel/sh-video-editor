/**
 * 타임라인 클립의 우클릭 메뉴·클립 메뉴가 부르는 동작. 전부 엔진 커맨드 한두 개로 끝나고 결과를 토스트·상태 줄로 알린다.
 * 선택·삭제·자르기·트림은 features/timeline/store 가 이미 가지고 있어 그쪽을 부른다.
 */
import { useEditor } from '../../store';
import { useJobs } from '../jobs/store';
import { useProject } from '../project/store';
import { execCommand, refreshAll } from '../shortcuts/actions';
import { useTimeline } from '../timeline/store';
import { findClip, type ClipInfo, type SequenceInfo } from '../timeline/types';
import { useContextMenu } from './store';
import { errorMessage } from '../../errors';

/** 선택한 클립 중 서로 다른 연결 묶음의 수(연결 없는 클립은 각각 하나) */
export function linkGroups(clips: ClipInfo[]): number {
  const links = new Set<string>();
  for (const c of clips) links.add(c.link === null ? `c${c.clip}` : `l${c.link}`);
  return links.size;
}

/** 연결된 상대 클립(같은 link id)까지 넓힌 목록. 엔진 clip.link / clip.enable 은 상대까지 함께 바꾸므로(`linked` 기본 true) 안내 문구의 수에만 쓴다 */
function withPartners(clips: ClipInfo[]): ClipInfo[] {
  const seq = useTimeline.getState().sequence;
  if (!seq) return clips;
  const links = new Set(clips.map((c) => c.link).filter((l): l is number => l !== null));
  const out = [...clips];
  for (const t of [...seq.video, ...seq.audio]) {
    for (const c of t.items) if (c.link !== null && links.has(c.link) && !out.some((o) => o.clip === c.clip)) out.push(c);
  }
  return out;
}

/** 선택한 클립들(ClipInfo). 없으면 빈 배열 */
export function selectedClips(): ClipInfo[] {
  const seq = useTimeline.getState().sequence;
  if (!seq) return [];
  return seq.selection.map((id) => findClip(seq, id)?.clip).filter((c): c is ClipInfo => c !== undefined);
}

/** 클립 하나를 바로 뒤에 복제한다(같은 소스 구간). 영상 클립이면 연결된 소리도 함께 놓인다 */
export async function duplicateClip(clip: ClipInfo): Promise<void> {
  const seq = useTimeline.getState().sequence;
  const found = seq ? findClip(seq, clip.clip) : null;
  if (!found) return;
  await execCommand(
    'timeline.place',
    { item: clip.item, track: found.track.id, time: clip.end, sourceIn: clip.sourceIn, duration: clip.end - clip.start, insert: true },
    `복제: ${clip.name}`,
  );
}

/** 영상·소리 연결을 끊거나(소리 분리) 다시 잇는다. 대상은 선택한 클립(연결 상대 포함) */
export async function toggleLink(selected: ClipInfo[]): Promise<void> {
  const clips = withPartners(selected);
  if (clips.length === 0) return;
  const allLinked = clips.every((c) => c.link !== null);
  const r = (await execCommand(
    'clip.link',
    { clips: selected.map((c) => c.clip) },
    allLinked ? '소리를 분리했습니다. 영상과 소리를 따로 움직일 수 있습니다' : '영상과 소리를 다시 연결했습니다',
  )) as { linked?: boolean } | undefined;
  if (r && typeof r.linked === 'boolean') {
    useProject.getState().notify('success', r.linked ? '영상과 소리를 다시 연결했습니다.' : '소리를 분리했습니다. 영상과 소리를 따로 움직일 수 있습니다.');
  }
}

/** 클립 켜기·끄기(소리 클립이면 음소거처럼 쓴다) */
export async function toggleEnabled(selected: ClipInfo[]): Promise<void> {
  const clips = withPartners(selected);
  if (clips.length === 0) return;
  const anyOn = clips.some((c) => c.enabled);
  await execCommand('clip.enable', { clips: selected.map((c) => c.clip) }, anyOn ? `클립 ${clips.length}개를 껐습니다` : `클립 ${clips.length}개를 켰습니다`);
}

export async function renameClip(clip: ClipInfo): Promise<void> {
  const name = await useContextMenu.getState().ask({ title: '클립 이름 바꾸기', label: '이름', value: clip.name, submitLabel: '바꾸기' });
  if (name === null || name === clip.name) return;
  await execCommand('clip.rename', { clip: clip.clip, name }, `클립 이름을 바꿨습니다: ${name}`);
}

/**
 * 소리로 싱크 맞추기: 선택한 클립(영상 + 따로 녹음한 소리)의 소리 파형을 비교해 같은 순간이 겹치도록 옮긴다.
 * 엔진 `clip.synchronize {method:"audio", clips, reference}`. 기준은 영상 클립(없으면 첫 클립).
 */
export async function synchronizeByAudio(clips: ClipInfo[]): Promise<void> {
  const bridge = useEditor.getState().bridge;
  const seq = useTimeline.getState().sequence;
  if (!bridge || !seq) return;
  if (linkGroups(clips) < 2) {
    useProject.getState().notify('warning', '싱크를 맞추려면 영상 클립과 따로 녹음한 소리 클립을 함께 선택하세요(Ctrl 클릭).');
    return;
  }
  const reference = clips.find((c) => findClip(seq, c.clip)?.kind === 'video') ?? clips[0]!;
  try {
    const r = (await bridge.execute('clip.synchronize', { method: 'audio', clips: clips.map((c) => c.clip), reference: reference.clip })) as {
      moved: number;
      reference: number;
      clips: Array<{ name: string; start: number; startFrame: number; audio: { confidence: number; reliable: boolean } | null }>;
    };
    const ft = (254_016_000_000 * seq.settings.frame_rate.den) / seq.settings.frame_rate.num;
    // 엔진 보고서는 연결 묶음(unit) 순서다: 우리가 보낸 clips 에서 처음 만나는 묶음 순. 묶음의 이전 시작과 비교해 이동 프레임을 센다
    const groups: ClipInfo[][] = [];
    const seen = new Map<string, number>();
    for (const c of clips) {
      const key = c.link === null ? `c${c.clip}` : `l${c.link}`;
      const at = seen.get(key);
      if (at === undefined) {
        seen.set(key, groups.length);
        groups.push([c]);
      } else groups[at]!.push(c);
    }
    const shaky = r.clips.some((c) => c.audio && !c.audio.reliable);
    const frames = r.clips
      .map((c, i) => (i === r.reference || !groups[i] ? null : Math.round((c.start - groups[i]![0]!.start) / ft)))
      .filter((f): f is number => f !== null && f !== 0);
    const detail = frames.length ? ` (${frames.map((f) => `${f > 0 ? '+' : ''}${f}프레임`).join(', ')})` : '';
    await refreshAll(r.moved > 0 ? `싱크 맞춤: 클립 ${r.moved}개 이동${detail}` : '이미 싱크가 맞습니다');
    useProject
      .getState()
      .notify(
        shaky ? 'warning' : 'success',
        r.moved > 0
          ? `"${reference.name}" 기준으로 클립 ${r.moved}개를 옮겨 싱크를 맞췄습니다${detail}.${shaky ? ' 공통 소리가 뚜렷하지 않아 결과를 확인하세요.' : ''}`
          : '이미 싱크가 맞아 옮긴 클립이 없습니다.',
      );
  } catch (e) {
    useProject.getState().notify('danger', `싱크를 맞추지 못했습니다. 두 클립에 같은 소리가 들어 있어야 합니다. ${errorMessage(e)}`);
    await refreshAll();
  }
}

interface SceneResult {
  /** 분석한 영상 클립 수 */
  clips: number;
  /** 잘린 곳 수(모든 클립 합) */
  cuts: number;
}

/**
 * 장면마다 자르기: 선택한 영상 클립의 프레임을 비교해 장면이 바뀌는 곳마다 자른다(연결된 소리도 함께).
 * 엔진 `clip.sceneEditDetection {clips, applyCuts: true, wait: true}`: 분석이 끝날 때까지 기다려 자르기 수를 돌려받는다
 * (wasm 은 항상 동기). 결과는 실행 취소 한 단계 "Scene Edit Detection".
 */
function countVideoClips(seq: SequenceInfo): number {
  return seq.video.reduce((n, t) => n + t.items.length, 0);
}

export async function detectScenes(selected: ClipInfo[]): Promise<SceneResult | null> {
  const bridge = useEditor.getState().bridge;
  const seq = useTimeline.getState().sequence;
  if (!bridge || !seq) return null;
  const videos = selected.filter((c) => findClip(seq, c.clip)?.kind === 'video');
  if (videos.length === 0) {
    useProject.getState().notify('warning', '장면을 찾으려면 영상 클립을 선택하세요.');
    return null;
  }
  useEditor.setState({ status: `장면을 찾는 중... (클립 ${videos.length}개, 상태 줄의 진행 막대로 취소할 수 있습니다)`, error: null });
  useTimeline.setState({ busy: true });
  try {
    // 잡으로 돌리고(진행률은 features/jobs) 끝나면 늘어난 영상 클립 수로 자른 곳을 센다
    const before = countVideoClips(seq);
    const r = (await bridge.execute('clip.sceneEditDetection', { clips: videos.map((c) => c.clip), applyCuts: true, wait: false })) as {
      job: number;
      frames: number;
    };
    useJobs.getState().track(bridge, { id: r.job, kind: 'sceneDetect' });
    const [job] = await useJobs.getState().waitFor([r.job]);
    if (job?.cancelled) {
      useEditor.setState({ status: '장면 찾기를 취소했습니다', error: null });
      useProject.getState().notify('warning', '장면 찾기를 취소했습니다.');
      await refreshAll();
      return null;
    }
    if (job?.error) throw new Error(job.error);
    // 데스크톱: 스레드가 끝낸 결과는 pollPersistence 가 프로젝트에 반영한다(자르기). 웹은 pumpJobs 가 이미 반영했다
    await bridge.pollPersistence?.();
    await useTimeline.getState().refresh();
    const after = useTimeline.getState().sequence;
    const cuts = Math.max(0, (after ? countVideoClips(after) : before) - before);
    const status = cuts > 0 ? `장면 ${cuts}곳에서 잘랐습니다 (클립 ${videos.length}개)` : '장면이 바뀌는 곳을 찾지 못했습니다';
    await refreshAll(status);
    useProject
      .getState()
      .notify(cuts > 0 ? 'success' : 'info', cuts > 0 ? `${status}.` : '장면이 바뀌는 곳을 찾지 못했습니다. 한 장면으로 이어진 영상이거나 변화가 작습니다.');
    return { clips: videos.length, cuts };
  } catch (e) {
    useProject.getState().notify('danger', `장면을 찾지 못했습니다. ${errorMessage(e)}`);
    await refreshAll();
    return null;
  } finally {
    useTimeline.setState({ busy: false });
  }
}
