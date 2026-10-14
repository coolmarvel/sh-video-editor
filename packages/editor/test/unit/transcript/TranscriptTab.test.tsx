/**
 * features/transcript/TranscriptTab.tsx 와 features/audio/AudioInspector.tsx 의 새 묶음(음성 깨끗하게, 소리 크기 맞추기)을
 * 가짜 엔진으로 그려 본다: 빈 상태(웹 안내 / 데스크톱 "자막 탭으로"), 문장 목록·검색·선택·지우기, 음성 깨끗하게 버튼과 상태,
 * 소리 크기 맞추기 결과 문구.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { EngineBridge, SttHost } from '@editor/engine/bridge';
import { TICKS_PER_SECOND as T } from '@editor/engine/time';
import { useEditor } from '@editor/store';
import { AudioInspector } from '@editor/features/audio/AudioInspector';
import type { InspectorContext } from '@editor/features/inspector/registry';
import { useInspectorRegistry } from '@editor/features/inspector/registry';
import { useTimeline } from '@editor/features/timeline/store';
import { findClip } from '@editor/features/timeline/types';
import { TranscriptTab, clock } from '@editor/features/transcript/TranscriptTab';
import { useTranscript } from '@editor/features/transcript/store';
import { engineWithClips, type FakeWord } from '../../fake-bridge';
import { connect, flush, resetStores } from '../../stores';

beforeEach(resetStores);

const tl = () => useTimeline.getState();

const WORDS: FakeWord[] = [
  { text: '안녕하세요', start: 0.2 * T, end: 0.8 * T },
  { text: '오늘은', start: 1.0 * T, end: 1.4 * T },
  { text: '편집을', start: 3.2 * T, end: 3.6 * T },
];

function ctx(): InspectorContext {
  const seq = tl().sequence!;
  const clips = seq.selection.map((id) => findClip(seq, id)?.clip).filter((c): c is NonNullable<typeof c> => c != null);
  return { sequence: seq, clips, clip: clips[0] ?? null, playhead: tl().playhead };
}

describe('TranscriptTab', () => {
  it('clock 은 mm:ss.s', () => {
    expect(clock(0)).toBe('00:00.0');
    expect(clock(65.25 * T)).toBe('01:05.3');
    expect(clock(-5)).toBe('00:00.0');
  });

  it('웹(호스트 없음)에서 전사가 없으면 데스크톱 전용 안내만', async () => {
    const { engine } = engineWithClips();
    await connect({}, engine);
    await tl().refresh();
    render(<TranscriptTab {...ctx()} />);
    await vi.waitFor(() => expect(screen.getByTestId('transcript-empty')).toBeInTheDocument());
    expect(screen.getByTestId('transcript-empty')).toHaveTextContent('데스크톱 앱에서만');
    expect(screen.queryByRole('button', { name: '자막 탭으로' })).toBeNull();
  });

  it('데스크톱(bridge.stt)에서 전사가 없으면 자막 탭으로 안내하고 버튼이 자막 탭을 연다', async () => {
    const { engine } = engineWithClips({ desktop: true });
    const host: SttHost = {
      downloadModel: async () => undefined,
      transcribeItem: async () => ({ words: [] }),
      progress: async () => null,
      cancel: async () => undefined,
      releaseModel: async () => undefined,
    };
    const bridge: EngineBridge = { ...engine.bridge, stt: host };
    await useEditor.getState().init(bridge);
    await tl().refresh();
    render(<TranscriptTab {...ctx()} />);
    const button = await screen.findByRole('button', { name: '자막 탭으로' });
    fireEvent.click(button);
    expect(useInspectorRegistry.getState().active).toBe('captions');
  });

  it('전사가 있으면 문장 목록, 검색 강조, 체크 선택, 지우기', async () => {
    const { engine, items } = engineWithClips();
    await connect({}, engine);
    await engine.bridge.execute('transcript.set', { item: items[0]!.item, transcript: { language: 'ko', words: WORDS } });
    await tl().refresh();
    render(<TranscriptTab {...ctx()} />);
    const list = await screen.findByRole('list', { name: '전사 문장' });
    expect(within(list).getAllByTestId('transcript-row')).toHaveLength(2);
    expect(list).toHaveTextContent('안녕하세요 오늘은');
    expect(list).toHaveTextContent('00:03.2');
    // 검색
    fireEvent.change(screen.getByRole('searchbox', { name: '전사 검색' }), { target: { value: '편집' } });
    await vi.waitFor(() => expect(document.querySelectorAll('.tr-row--hit')).toHaveLength(1));
    expect(screen.getByText('1곳')).toBeInTheDocument();
    // 문장 클릭 = 플레이헤드
    fireEvent.click(within(list).getAllByTestId('transcript-row')[1]!.querySelector('.tr-row__body')!);
    await vi.waitFor(() => expect(engine.state.playhead).toBe(Math.floor((3.2 * T) / (T / 30)) * (T / 30)));
    // 선택 뒤 지우기
    expect(screen.getByRole('button', { name: '지우기' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '문장 선택: 편집을' }));
    expect(useTranscript.getState().selected).toEqual([1]);
    fireEvent.click(screen.getByRole('button', { name: '지우기 (1)' }));
    await vi.waitFor(() => expect(engine.callsOf('transcript.extract')).toEqual([{ from: 2, to: 2 }]));
    await vi.waitFor(() => expect(within(list).getAllByTestId('transcript-row')).toHaveLength(1));
    expect(screen.getByRole('status')).toHaveTextContent('문장 1개를 지웠습니다');
    // 자동 정리 버튼
    fireEvent.click(screen.getByRole('button', { name: '군말 제거' }));
    await vi.waitFor(() => expect(engine.callsOf('transcript.removeFillers')).toHaveLength(1));
    await vi.waitFor(() => expect(useTranscript.getState().busy).toBe(false));
    fireEvent.change(screen.getByRole('spinbutton', { name: '무음 최소 길이(초)' }), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '무음 자동 제거' }));
    await vi.waitFor(() => expect(engine.callsOf('transcript.removePauses')).toEqual([{ minSeconds: 2, keepSeconds: 0.15 }]));
  });
});

describe('AudioInspector 음성 깨끗하게 / 소리 크기 맞추기', () => {
  async function setup(opts: Parameters<typeof engineWithClips>[0] = {}) {
    const made = engineWithClips(opts);
    await connect(opts, made.engine);
    await tl().refresh();
    await tl().selectClip(made.clips[1]!.clip);
    return made;
  }

  it('버튼으로 효과를 걸고 상태가 적용됨으로 바뀌며 원래대로로 돌아간다', async () => {
    const { engine, clips } = await setup();
    const { rerender } = render(<AudioInspector {...ctx()} />);
    await vi.waitFor(() => expect(screen.getByTestId('audio-clean-state')).toHaveTextContent('적용 안 됨'));
    expect(screen.getByRole('button', { name: '원래대로' })).toBeDisabled();
    fireEvent.change(screen.getByRole('slider', { name: '음성 깨끗하게 강도' }), { target: { value: '0' } });
    expect(screen.getByTestId('audio-clean-strength')).toHaveTextContent('약');
    fireEvent.click(screen.getByRole('button', { name: '음성 깨끗하게' }));
    await vi.waitFor(() => expect(useEditor.getState().status).toMatch(/^음성 깨끗하게\(약\)를 클립 1개에 적용했습니다 \([\d.]+초\)$/));
    rerender(<AudioInspector {...ctx()} />);
    await vi.waitFor(() => expect(screen.getByTestId('audio-clean-state')).toHaveTextContent('적용됨(약)'));
    expect(engine.callsOf('essentialSound.set')).toEqual([
      { clips: [clips[1]!.clip], values: expect.objectContaining({ 'repair.noise.amount': 3 }), begin: true },
    ]);
    fireEvent.click(screen.getByRole('button', { name: '원래대로' }));
    await vi.waitFor(() => expect(useEditor.getState().status).toBe('음성 깨끗하게를 껐습니다 (클립 1개)'));
    rerender(<AudioInspector {...ctx()} />);
    await vi.waitFor(() => expect(screen.getByTestId('audio-clean-state')).toHaveTextContent('적용 안 됨'));
  });

  it('대상을 모든 소리 클립으로 바꾸면 편집본의 소리 클립 전부에 건다. 실패는 오류 줄로', async () => {
    const { engine } = await setup();
    render(<AudioInspector {...ctx()} />);
    fireEvent.click(screen.getByRole('radio', { name: '모든 소리 클립' }));
    fireEvent.click(screen.getByRole('button', { name: '음성 깨끗하게' }));
    await vi.waitFor(() => expect(useEditor.getState().status).toMatch(/클립 2개에 적용했습니다/));
    engine.failNext('essentialSound.set', 'nope');
    fireEvent.click(screen.getByRole('button', { name: '음성 깨끗하게' }));
    await vi.waitFor(() => expect(useEditor.getState().error).toContain('nope'));
  });

  it('소리 크기 맞추기: 목표 라디오와 결과 문구', async () => {
    const { engine, items } = await setup();
    items[0]!.lufs = -20;
    items[1]!.lufs = -22;
    render(<AudioInspector {...ctx()} />);
    fireEvent.click(screen.getByRole('radio', { name: /-16 LUFS/ }));
    fireEvent.click(screen.getByRole('button', { name: '소리 크기 맞추기' }));
    await vi.waitFor(() => expect(screen.getByTestId('audio-loudness-result')).toHaveTextContent('측정 -21.0 LUFS, 게인 +5.0 dB (클립 2개), 정점 -6.0 dB'));
    expect(useEditor.getState().status).toBe('소리 크기를 -16 LUFS 로 맞췄습니다: 측정 -21.0 LUFS, 게인 +5.0 dB (클립 2개), 정점 -6.0 dB');
    expect(engine.callsOf('essentialSound.autoMatch')[0]).toMatchObject({ target: -16 });
    engine.failNext('essentialSound.autoMatch', 'silent');
    fireEvent.click(screen.getByRole('button', { name: '소리 크기 맞추기' }));
    await vi.waitFor(() => expect(useEditor.getState().error).toContain('silent'));
    await flush();
  });
});
