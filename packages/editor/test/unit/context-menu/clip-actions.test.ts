/** features/context-menu/clip-actions.ts, clip-menu.ts: 연결 토글·복제·싱크·메뉴 항목. */
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '@editor/store';
import {
  detectScenes,
  duplicateClip,
  linkGroups,
  selectedClips,
  synchronizeByAudio,
  toggleEnabled,
  toggleLink,
} from '@editor/features/context-menu/clip-actions';
import { clipMenu, laneMenu } from '@editor/features/context-menu/clip-menu';
import { useContextMenu } from '@editor/features/context-menu/store';
import { useProject } from '@editor/features/project/store';
import { useTimeline } from '@editor/features/timeline/store';
import { FakeEngine, T, engineWithClips } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

beforeEach(resetStores);

const tl = () => useTimeline.getState();
const lastToast = () => useProject.getState().notices.at(-1);
const labels = (entries: ReturnType<typeof clipMenu>) => entries.map((e) => (e.kind === 'item' ? e.label : '-'));

async function ready(): Promise<ReturnType<typeof engineWithClips>> {
  const made = engineWithClips();
  await connect({}, made.engine);
  await tl().refresh();
  return made;
}

describe('linkGroups / selectedClips', () => {
  it('연결 묶음 수를 세고, 선택이 없으면 빈 배열', async () => {
    const { clips } = await ready();
    expect(selectedClips()).toEqual([]);
    await tl().selectClip(clips[0]!.clip);
    const sel = selectedClips();
    expect(sel.map((c) => c.clip).sort()).toEqual([clips[0]!.clip, clips[1]!.clip].sort());
    expect(linkGroups(sel)).toBe(1);
    await tl().selectClip(clips[2]!.clip, { add: true });
    expect(linkGroups(selectedClips())).toBe(2);
  });
});

describe('toggleLink', () => {
  it('영상 클립 하나만 주어도 연결 상대(소리)까지 함께 푼다(엔진 clip.link 의 linked 기본값)', async () => {
    const { engine } = await ready();
    const video = tl().sequence!.video[0]!.items[0]!;
    await toggleLink([video]);
    expect(engine.callsOf('clip.link')).toEqual([{ clips: [video.clip] }]);
    expect(tl().sequence!.video[0]!.items[0]!.link).toBeNull();
    expect(tl().sequence!.audio[0]!.items[0]!.link).toBeNull();
  });

  it('연결된 클립은 분리(소리 분리)하고 다시 연결할 수 있으며 토스트로 알린다', async () => {
    const { engine, clips } = await ready();
    await tl().selectClip(clips[0]!.clip);
    await toggleLink(selectedClips());
    expect(engine.callsOf('clip.link')).toEqual([{ clips: expect.arrayContaining([clips[0]!.clip, clips[1]!.clip]) }]);
    expect(tl().sequence!.video[0]!.items[0]!.link).toBeNull();
    expect(lastToast()).toMatchObject({ kind: 'success', text: '소리를 분리했습니다. 영상과 소리를 따로 움직일 수 있습니다.' });
    // 분리된 뒤에는 각자 선택된다. 둘을 함께 골라 다시 연결
    await tl().selectClip(clips[0]!.clip);
    await tl().selectClip(clips[1]!.clip, { add: true });
    await toggleLink(selectedClips());
    expect(tl().sequence!.video[0]!.items[0]!.link).not.toBeNull();
    expect(tl().sequence!.video[0]!.items[0]!.link).toBe(tl().sequence!.audio[0]!.items[0]!.link);
    expect(lastToast()).toMatchObject({ kind: 'success', text: '영상과 소리를 다시 연결했습니다.' });
    await toggleLink([]);
    expect(engine.callsOf('clip.link')).toHaveLength(2);
  });
});

describe('duplicateClip / toggleEnabled', () => {
  it('복제는 같은 소스 구간으로 바로 뒤에 놓는다(삽입)', async () => {
    const { engine, clips } = await ready();
    const first = tl().sequence!.video[0]!.items[0]!;
    await duplicateClip(first);
    expect(engine.callsOf('timeline.place')).toEqual([
      { item: first.item, track: tl().sequence!.video[0]!.id, time: 4 * T, sourceIn: 0, duration: 4 * T, insert: true },
    ]);
    expect(tl().sequence!.video[0]!.items.map((c) => [c.name, c.start / T])).toEqual([
      ['a.mp4', 0],
      ['a.mp4', 4],
      ['b.mp4', 8],
    ]);
    expect(useEditor.getState().status).toBe('복제: a.mp4');
    void clips;
  });

  it('켜기·끄기는 clip.enable 로 보낸다', async () => {
    const { engine, clips } = await ready();
    await tl().selectClip(clips[0]!.clip);
    await toggleEnabled(selectedClips());
    expect(engine.callsOf('clip.enable')).toHaveLength(1);
    expect(tl().sequence!.video[0]!.items[0]!.enabled).toBe(false);
    expect(useEditor.getState().status).toBe('클립 2개를 껐습니다');
    await toggleEnabled(selectedClips());
    expect(tl().sequence!.video[0]!.items[0]!.enabled).toBe(true);
    expect(useEditor.getState().status).toBe('클립 2개를 켰습니다');
  });
});

describe('synchronizeByAudio', () => {
  async function shifted(): Promise<{ engine: FakeEngine; video: number; voice: number }> {
    const engine = new FakeEngineWithVoice();
    await connect({}, engine);
    await tl().refresh();
    return { engine, video: engine.videoClip, voice: engine.voiceClip };
  }
  class FakeEngineWithVoice extends FakeEngine {
    videoClip = 0;
    voiceClip = 0;
    constructor() {
      super();
      const a = this.addItem({ name: 'cam.mp4', duration: 8 * T });
      this.newSequence();
      const placed = this.place(a, 0);
      this.videoClip = placed[0]!.clip;
      // 같은 소스를 소리만 A2 에 1초 늦게(싱크가 어긋난 녹음을 흉내)
      const a2 = this.sequence.audio[1]!;
      const voice = { clip: 900, item: a.item, name: 'cam.mp4', start: T, end: 9 * T, sourceIn: 0, link: null, enabled: true };
      a2.items.push(voice);
      this.voiceClip = voice.clip;
      this.sequence.selection = [];
    }
  }

  it('묶음이 둘 미만이면 안내만', async () => {
    const { video } = await shifted();
    await tl().selectClip(video);
    await synchronizeByAudio(selectedClips());
    expect(lastToast()).toMatchObject({ kind: 'warning' });
  });

  it('영상 클립을 기준으로 소리 클립을 옮기고 이동 프레임을 토스트로 알린다', async () => {
    const { engine, video, voice } = await shifted();
    await tl().selectClip(video);
    await tl().selectClip(voice, { add: true });
    await synchronizeByAudio(selectedClips());
    const call = engine.callsOf('clip.synchronize')[0]!;
    expect(call).toMatchObject({ method: 'audio', reference: video });
    expect(call['clips']).toEqual(expect.arrayContaining([video, voice]));
    expect(tl().sequence!.audio[1]!.items[0]!.start).toBe(0);
    expect(useEditor.getState().status).toBe('싱크 맞춤: 클립 1개 이동 (-30프레임)');
    expect(lastToast()).toMatchObject({ kind: 'success', text: '"cam.mp4" 기준으로 클립 1개를 옮겨 싱크를 맞췄습니다 (-30프레임).' });
    // 다시 하면 이미 맞음
    await synchronizeByAudio(selectedClips());
    expect(lastToast()).toMatchObject({ text: '이미 싱크가 맞아 옮긴 클립이 없습니다.' });
  });

  it('엔진이 거부하면 한국어로 감싼 오류 토스트', async () => {
    const { engine, video, voice } = await shifted();
    await tl().selectClip(video);
    await tl().selectClip(voice, { add: true });
    engine.failNext('clip.synchronize', 'cam.mp4 and cam.mp4 have no common audio');
    await synchronizeByAudio(selectedClips());
    expect(lastToast()).toMatchObject({
      kind: 'danger',
      text: '싱크를 맞추지 못했습니다. 두 클립에 같은 소리가 들어 있어야 합니다. cam.mp4 and cam.mp4 have no common audio',
    });
  });
});

describe('clipMenu / laneMenu', () => {
  it('클립 메뉴 항목과 활성 조건', async () => {
    const { engine, clips } = await ready();
    const video = tl().sequence!.video[0]!.items[0]!;
    const entries = clipMenu(video);
    expect(labels(entries)).toEqual([
      '자르기',
      '삭제',
      '리플 삭제',
      '복제',
      '-',
      '속도, 길이...',
      '장면마다 자르기',
      '-',
      '소리 분리(연결 해제)',
      '소리로 싱크 맞추기',
      '-',
      '끄기',
      '이름 바꾸기...',
    ]);
    const byLabel = (l: string) => entries.find((e) => e.kind === 'item' && e.label === l) as Extract<(typeof entries)[number], { kind: 'item' }>;
    // 플레이헤드가 클립 밖이면 자르기 비활성, 묶음이 하나면 싱크 비활성
    expect(byLabel('자르기').disabled).toBe(true);
    expect(byLabel('소리로 싱크 맞추기').disabled).toBe(true);
    expect(byLabel('삭제').danger).toBe(true);
    expect(byLabel('삭제').key).toBe('Delete');
    await tl().setPlayhead(2 * T);
    await tl().selectClip(clips[0]!.clip);
    await tl().selectClip(clips[2]!.clip, { add: true });
    const multi = clipMenu(video);
    expect(labels(multi)).toContain('삭제 (4개)');
    const b = (l: string) => multi.find((e) => e.kind === 'item' && e.label === l) as Extract<(typeof multi)[number], { kind: 'item' }>;
    expect(b('자르기').disabled).toBe(false);
    expect(b('소리로 싱크 맞추기').disabled).toBe(false);
    expect(b('이름 바꾸기...').disabled).toBe(true);
    // 소리 클립은 음소거 문구, 영상이 없는(소리만 있는) 클립은 장면 찾기 비활성
    const audio = tl().sequence!.audio[0]!.items[0]!;
    expect(labels(clipMenu(audio))).toContain('음소거');
    const music = engine.addItem({ name: 'm.mp3', type: 'Audio' });
    engine.place(music, 8 * T);
    await tl().refresh();
    const onlyAudio = tl().sequence!.audio[0]!.items.find((c) => c.item === music.item)!;
    const sceneItem = clipMenu(onlyAudio).find((e) => e.kind === 'item' && e.label === '장면마다 자르기') as Extract<
      (typeof entries)[number],
      { kind: 'item' }
    >;
    expect(sceneItem.disabled).toBe(true);
  });

  it('레인 메뉴와 이름 바꾸기 입력', async () => {
    await ready();
    expect(labels(laneMenu())).toEqual(['모든 트랙 자르기', '전체 선택', '붙여넣기', '-', '트랙 추가', '타임라인 전체 보기']);
    const video = tl().sequence!.video[0]!.items[0]!;
    const rename = clipMenu(video).find((e) => e.kind === 'item' && e.label === '이름 바꾸기...') as Extract<
      ReturnType<typeof clipMenu>[number],
      { kind: 'item' }
    >;
    const p = rename.run();
    await Promise.resolve();
    expect(useContextMenu.getState().prompt?.value).toBe('a.mp4');
    useContextMenu.getState().answerPrompt('첫 장면');
    await p;
    expect(tl().sequence!.video[0]!.items[0]!.name).toBe('첫 장면');
    expect(useEditor.getState().status).toBe('클립 이름을 바꿨습니다: 첫 장면');
  });
});

describe('detectScenes (장면마다 자르기)', () => {
  it('영상 클립의 장면 전환마다 자르고(연결된 소리 포함) 토스트와 상태 줄로 수를 알린다', async () => {
    const { engine, items, clips } = await ready();
    // a.mp4 는 1초와 3초에서 장면이 바뀐다
    items[0]!.sceneCuts = [1 * T, 3 * T];
    const video = tl().sequence!.video[0]!.items[0]!;
    const r = await detectScenes([video]);
    expect(r).toEqual({ clips: 1, cuts: 2 });
    expect(engine.callsOf('clip.sceneEditDetection')).toEqual([{ clips: [clips[0]!.clip], applyCuts: true, wait: true }]);
    expect(tl().sequence!.video[0]!.items.map((c) => c.start / T)).toEqual([0, 1, 3, 4]);
    expect(tl().sequence!.audio[0]!.items.map((c) => c.start / T)).toEqual([0, 1, 3, 4]);
    expect(useEditor.getState().status).toBe('장면 2곳에서 잘랐습니다 (클립 1개)');
    expect(lastToast()).toMatchObject({ kind: 'success' });
    expect(tl().busy).toBe(false);
    // 실행 취소 한 단계
    await tl().undo();
    expect(tl().sequence!.video[0]!.items).toHaveLength(2);
  });

  it('장면 전환이 없으면 안내 토스트, 소리 클립만 고르면 경고', async () => {
    const { engine } = await ready();
    const video = tl().sequence!.video[0]!.items[0]!;
    expect(await detectScenes([video])).toEqual({ clips: 1, cuts: 0 });
    expect(lastToast()).toMatchObject({ kind: 'info' });
    expect(useEditor.getState().status).toBe('장면이 바뀌는 곳을 찾지 못했습니다');
    const audio = tl().sequence!.audio[0]!.items[0]!;
    expect(await detectScenes([audio])).toBeNull();
    expect(lastToast()).toMatchObject({ kind: 'warning' });
    engine.failNext('clip.sceneEditDetection', 'decoder busy');
    expect(await detectScenes([video])).toBeNull();
    expect(lastToast()).toMatchObject({ kind: 'danger', text: expect.stringContaining('decoder busy') });
  });
});
