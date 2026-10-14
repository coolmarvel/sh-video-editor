/**
 * features/transcript/store.ts: 전사 읽기(문장·화자·현재 단어), 검색, 문장 이동, 선택과 범위 합치기, 지우기(transcript.extract,
 * 뒤에서 앞으로, 한 단계), 구간 표시(transcript.select), 무음 자동 제거·군말 제거, 빈 전사·오류 경로. 가짜 엔진의 transcript.* 로 본다.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND as T } from '@editor/engine/time';
import { useEditor } from '@editor/store';
import { useStt } from '@editor/features/stt/store';
import { useTimeline } from '@editor/features/timeline/store';
import { hitParagraphs, selectedRanges, useTranscript, type Paragraph } from '@editor/features/transcript/store';
import { engineWithClips, type FakeWord } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

beforeEach(resetStores);

const tl = () => useTimeline.getState();
const tr = () => useTranscript.getState();

/** a.mp4(0..4초) 의 전사: 두 문장(1.5초 넘는 틈), 군말 "음" 하나 */
const WORDS: FakeWord[] = [
  { text: '안녕하세요', start: 0.2 * T, end: 0.8 * T, speaker: 0 },
  { text: '음', start: 0.9 * T, end: 1.1 * T, speaker: 0 },
  { text: '오늘은', start: 1.2 * T, end: 1.5 * T, speaker: 0 },
  // 1.5 -> 3.2: 1.7초 무음
  { text: '편집을', start: 3.2 * T, end: 3.5 * T, speaker: 0 },
  { text: '해봅니다', start: 3.5 * T, end: 3.9 * T, speaker: 0 },
];

async function ready(words: FakeWord[] = WORDS) {
  const made = engineWithClips();
  await connect({}, made.engine);
  await made.engine.bridge.execute('transcript.set', { item: made.items[0]!.item, transcript: { language: 'ko', words } });
  await tl().refresh();
  await tr().refresh();
  return made;
}

describe('selectedRanges / hitParagraphs', () => {
  const paras: Paragraph[] = [
    { from: 0, to: 2, speaker: null, start: 0, end: T, text: 'a' },
    { from: 3, to: 4, speaker: null, start: T, end: 2 * T, text: 'b' },
    { from: 5, to: 7, speaker: null, start: 3 * T, end: 4 * T, text: 'c' },
  ];
  it('이어진 문장은 한 범위로 합치고 뒤에서 앞 순서로 준다', () => {
    expect(selectedRanges(paras, [0, 1])).toEqual([{ from: 0, to: 4 }]);
    expect(selectedRanges(paras, [2, 0, 0])).toEqual([
      { from: 5, to: 7 },
      { from: 0, to: 2 },
    ]);
    expect(selectedRanges(paras, [9])).toEqual([]);
  });
  it('검색 결과와 겹치는 문장 색인', () => {
    expect(hitParagraphs(paras, [{ from: 4, to: 5, start: 0, end: 0 }])).toEqual([1, 2]);
    expect(hitParagraphs(paras, [])).toEqual([]);
  });
});

describe('refresh', () => {
  it('전사가 없으면 빈 목록(loaded), 있으면 문장·단어 수·화자', async () => {
    const made = engineWithClips();
    await connect({}, made.engine);
    await tl().refresh();
    await tr().refresh();
    expect(tr().loaded).toBe(true);
    expect(tr().paragraphs).toEqual([]);
    await made.engine.bridge.execute('transcript.set', { item: made.items[0]!.item, transcript: { language: 'ko', words: WORDS } });
    await tr().refresh();
    expect(tr().words).toBe(5);
    expect(tr().paragraphs.map((p) => p.text)).toEqual(['안녕하세요 음 오늘은', '편집을 해봅니다']);
    expect(tr().paragraphs[1]).toMatchObject({ from: 3, to: 4, speaker: 'Speaker 1', start: 3.2 * T });
    expect(tr().speakers).toEqual(['Speaker 1']);
  });

  it('편집본이 없으면 빈 전사로 본다', async () => {
    const made = engineWithClips();
    await connect({}, made.engine);
    made.engine.state.sequence = null;
    await tr().refresh();
    expect(tr().loaded).toBe(true);
    expect(tr().paragraphs).toEqual([]);
  });
});

describe('search / goTo / 선택', () => {
  it('검색은 엔진 transcript.search 로, 빈 검색어는 결과를 비운다', async () => {
    const { engine } = await ready();
    await tr().search('편집');
    expect(tr().hits).toEqual([{ from: 3, to: 3, start: 3.2 * T, end: 3.5 * T }]);
    expect(hitParagraphs(tr().paragraphs, tr().hits)).toEqual([1]);
    await tr().search('   ');
    expect(tr().hits).toEqual([]);
    engine.failNext('transcript.search', 'boom');
    await tr().search('x');
    expect(tr().notice).toMatchObject({ tone: 'danger' });
  });

  it('문장을 클릭하면 플레이헤드가 문장 시작으로 간다(프레임 스냅)', async () => {
    const { engine } = await ready();
    await tr().goTo(1);
    expect(engine.state.playhead).toBe(Math.floor((3.2 * T) / (T / 30)) * (T / 30));
    await tr().goTo(99);
  });

  it('선택 토글·Shift 범위·해제', async () => {
    await ready();
    tr().toggleSelect(1);
    expect(tr().selected).toEqual([1]);
    tr().toggleSelect(1);
    expect(tr().selected).toEqual([]);
    tr().toggleSelect(0);
    tr().toggleSelect(1, { range: true });
    expect(tr().selected).toEqual([0, 1]);
    tr().clearSelection();
    expect(tr().selected).toEqual([]);
  });
});

describe('removeSelected / markSelected', () => {
  it('선택한 문장의 시간 구간을 리플 삭제하고(한 단계) 다시 읽는다', async () => {
    const { engine } = await ready();
    const before = tl().sequence!.duration;
    tr().toggleSelect(1);
    await tr().removeSelected();
    expect(engine.callsOf('transcript.extract')).toEqual([{ from: 3, to: 4 }]);
    expect(engine.undoStack.map((u) => u.label)).toContain('문장 지우기');
    expect(tr().paragraphs.map((p) => p.text)).toEqual(['안녕하세요 음 오늘은']);
    expect(tr().selected).toEqual([]);
    expect(tl().sequence!.duration).toBeLessThan(before);
    expect(useEditor.getState().status).toMatch(/^문장 1개를 지웠습니다 \(0\.7초\)$/);
    expect(tr().notice).toMatchObject({ tone: 'success' });
  });

  it('선택이 없으면 안내, 엔진이 거부하면 오류 알림', async () => {
    const { engine } = await ready();
    await tr().removeSelected();
    expect(tr().notice).toMatchObject({ tone: 'info' });
    tr().toggleSelect(0);
    engine.failNext('transcript.extract', 'locked');
    await tr().removeSelected();
    expect(tr().notice).toMatchObject({ tone: 'danger', text: expect.stringContaining('locked') });
    expect(engine.callsOf('edit.cancelTransaction')).toHaveLength(1);
    expect(tr().busy).toBe(false);
  });

  it('구간 표시는 선택 범위를 인, 아웃 점으로 찍는다', async () => {
    const { engine } = await ready();
    await tr().markSelected();
    expect(tr().notice).toMatchObject({ tone: 'info' });
    tr().toggleSelect(0);
    tr().toggleSelect(1);
    await tr().markSelected();
    expect(engine.callsOf('transcript.select')).toEqual([{ from: 0, to: 4 }]);
    expect(tl().sequence!.in).toBeCloseTo(0.2 * T, -2);
    expect(tl().sequence!.out).toBeGreaterThan(3 * T);
    engine.failNext('transcript.select', 'nope');
    await tr().markSelected();
    expect(tr().notice).toMatchObject({ tone: 'danger' });
  });
});

describe('removePauses / removeFillers', () => {
  it('무음 기준 이상 틈을 자르고 결과를 알린다', async () => {
    const { engine } = await ready();
    await tr().removePauses(1);
    expect(engine.callsOf('transcript.removePauses')).toEqual([{ minSeconds: 1, keepSeconds: 0.15 }]);
    expect(useEditor.getState().status).toBe('무음 1곳을 잘랐습니다 (1.4초)');
    expect(tr().paragraphs).toHaveLength(1);
    await tr().removePauses(5);
    expect(useEditor.getState().status).toBe('5초 이상 무음이 없습니다');
    await tr().removePauses(Number.NaN);
    expect(engine.callsOf('transcript.removePauses').at(-1)).toEqual({ minSeconds: 1, keepSeconds: 0.15 });
  });

  it('군말은 자막 탭(useStt)의 목록으로 지운다', async () => {
    const { engine } = await ready();
    useStt.getState().setFillers('음, 어');
    await tr().removeFillers();
    expect(engine.callsOf('transcript.removeFillers')).toEqual([{ fillers: ['음', '어'] }]);
    expect(useEditor.getState().status).toBe('군말 1개를 지웠습니다 (0.2초)');
    expect(tr().words).toBe(4);
    await tr().removeFillers();
    expect(useEditor.getState().status).toBe('지울 군말이 없습니다');
    engine.failNext('transcript.removePauses', 'no transcript');
    await tr().removePauses(1);
    expect(tr().notice).toMatchObject({ tone: 'danger' });
    engine.failNext('transcript.removeFillers', 'no transcript');
    await tr().removeFillers();
    expect(tr().notice).toMatchObject({ tone: 'danger' });
    tr().setNotice(null);
    expect(tr().notice).toBeNull();
  });
});
