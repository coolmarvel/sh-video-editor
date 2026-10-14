/** features/transitions 화면 부품: 갤러리(드래그 데이터·더블클릭), 레인의 전환 블록(위치·선택·길이 핸들), 인스펙터 탭. */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useTimeline } from '@editor/features/timeline/store';
import { TRANSITION_MIME } from '@editor/features/timeline/dnd';
import { trackRows } from '@editor/features/timeline/types';
import { TransitionBlocks } from '@editor/features/transitions/TransitionBlocks';
import { TransitionGallery } from '@editor/features/transitions/TransitionGallery';
import { TransitionInspector } from '@editor/features/transitions/TransitionInspector';
import { useInspectorRegistry, visibleTabs } from '@editor/features/inspector/registry';
import { useTransitions } from '@editor/features/transitions/store';
import { FT30, T, engineWithClips } from '../../fake-bridge';
import { connect, flush, resetStores } from '../../stores';

beforeEach(resetStores);

const tl = () => useTimeline.getState();
const ts = () => useTransitions.getState();

async function ready() {
  const made = engineWithClips();
  await connect({}, made.engine);
  await tl().refresh();
  return made;
}

function dataTransfer(): DataTransfer {
  const data = new Map<string, string>();
  return {
    setData: (k: string, v: string) => data.set(k, v),
    getData: (k: string) => data.get(k) ?? '',
    get types() {
      return [...data.keys()];
    },
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
  } as unknown as DataTransfer;
}

describe('TransitionGallery', () => {
  it('12개 항목, 시퀀스가 없으면 비활성', () => {
    render(<TransitionGallery />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(12);
    expect(items.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getByText('타임라인에 클립을 넣으면 전환을 넣을 수 있습니다.')).toBeTruthy();
  });

  it('dragstart 에 TRANSITION_MIME 으로 전환 id 를 넣고, 더블클릭은 선택 클립에 적용한다', async () => {
    const { engine, clips } = await ready();
    render(<TransitionGallery />);
    const dissolve = screen.getByRole('listitem', { name: /디졸브/ });
    expect((dissolve as HTMLButtonElement).disabled).toBe(false);
    const dt = dataTransfer();
    fireEvent.dragStart(dissolve, { dataTransfer: dt });
    expect(dt.getData(TRANSITION_MIME)).toBe('cross_dissolve');
    expect(dt.effectAllowed).toBe('copy');

    await tl().selectClip(clips[2]!.clip);
    fireEvent.doubleClick(screen.getByRole('listitem', { name: /검정으로 페이드/ }));
    await flush();
    expect(engine.callsOf('sequence.applyVideoTransition').map((p) => p?.['effect'])).toEqual(['dip_to_black', 'dip_to_black']);
  });

  it('더블클릭 위치 토글은 aria-pressed 로 보인다', async () => {
    await ready();
    render(<TransitionGallery />);
    const both = screen.getByRole('button', { name: '양쪽' });
    expect(both.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '앞' }));
    expect(ts().applyEdges).toBe('in');
    expect(screen.getByRole('button', { name: '앞' }).getAttribute('aria-pressed')).toBe('true');
    expect(both.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('TransitionBlocks', () => {
  it('전환을 시작·길이에 맞춘 px 로 그리고, 누르면 선택된다', async () => {
    const { clips } = await ready();
    const id = (await ts().applyAtPoint({ cut: 4 * T, from: clips[0]!.clip, to: clips[2]!.clip }, 'push', 30))!;
    await tl().selectClip(clips[0]!.clip);
    expect(ts().selected).toBeNull();
    const row = trackRows(tl().sequence!).find((r) => r.kind === 'video' && r.track.items.length > 0)!;
    const { container, rerender } = render(<TransitionBlocks row={row} pxPerSec={10} />);
    const block = container.querySelector<HTMLElement>('.tl-transition')!;
    expect(block.style.left).toBe('35px');
    expect(block.style.width).toBe('10px');
    expect(block.getAttribute('aria-label')).toBe('전환 밀기');
    expect(block.getAttribute('aria-pressed')).toBe('false');
    fireEvent.pointerDown(block, { button: 0, pointerId: 1 });
    await flush();
    expect(ts().selected).toBe(id);
    expect(tl().sequence!.selection).toEqual([]);
    rerender(<TransitionBlocks row={trackRows(tl().sequence!).find((r) => r.kind === 'video' && r.track.items.length > 0)!} pxPerSec={10} />);
    expect(container.querySelector('.tl-transition')!.className).toContain('is-selected');
  });

  it('transitions 필드가 없는 트랙도 그린다(빈 상태), 드롭 고스트는 대상 트랙에만', async () => {
    await ready();
    const rows = trackRows(tl().sequence!);
    const video = rows.find((r) => r.kind === 'video' && r.track.items.length > 0)!;
    const { container, rerender } = render(<TransitionBlocks row={{ ...video, track: { ...video.track, transitions: undefined } }} pxPerSec={10} />);
    expect(container.querySelectorAll('.tl-transition')).toHaveLength(0);
    ts().setDropTarget({ trackId: video.track.id, point: { cut: 4 * T, from: 1, to: 2 }, frames: 30 });
    rerender(<TransitionBlocks row={video} pxPerSec={10} />);
    const ghost = container.querySelector<HTMLElement>('.tl-transition.is-ghost')!;
    expect(ghost.style.left).toBe('35px');
    expect(ghost.style.width).toBe('10px');
    rerender(<TransitionBlocks row={rows.find((r) => r.kind === 'audio')!} pxPerSec={10} />);
    expect(container.querySelectorAll('.tl-transition')).toHaveLength(0);
  });

  it('오른쪽 핸들을 끌면 양쪽으로 자라고(가운데 정렬) 놓으면 프레임 단위로 엔진에 보낸다', async () => {
    const { engine, clips } = await ready();
    const id = (await ts().applyAtPoint({ cut: 4 * T, from: clips[0]!.clip, to: clips[2]!.clip }, 'cross_dissolve', 30))!;
    const row = trackRows(tl().sequence!).find((r) => r.kind === 'video' && r.track.items.length > 0)!;
    // 10 px/s: 1 프레임 = 1/3 px. 15px 끌면 45 프레임, 양쪽이라 +90 프레임
    const { container } = render(<TransitionBlocks row={row} pxPerSec={10} />);
    const out = container.querySelector<HTMLElement>('.tl-transition__handle--out')!;
    fireEvent.pointerDown(out, { button: 0, pointerId: 2, clientX: 100 });
    fireEvent.pointerMove(out, { pointerId: 2, clientX: 115 });
    const block = container.querySelector<HTMLElement>('.tl-transition')!;
    expect(block.className).toContain('is-ghost');
    expect(block.style.width).toBe('40px');
    expect(block.style.left).toBe('20px');
    engine.calls.length = 0;
    fireEvent.pointerUp(out, { pointerId: 2, clientX: 115 });
    await flush();
    const call = engine.callsOf('sequence.setTransitionLength')[0]!;
    expect(call).toEqual({ transition: id, frames: 120 });
    expect(ts().selected).toBe(id);
    expect(tl().sequence!.video[0]!.transitions![0]!.duration).toBe(120 * FT30);
  });

  it('한쪽 편집점(페이드 인)은 컷 반대쪽 핸들만 움직이고 길이는 1프레임 아래로 내려가지 않는다', async () => {
    const { engine, clips } = await ready();
    await ts().applyAtPoint({ cut: 0, from: null, to: clips[0]!.clip }, 'dip_to_black', 30);
    const row = trackRows(tl().sequence!).find((r) => r.kind === 'video' && r.track.items.length > 0)!;
    const { container } = render(<TransitionBlocks row={row} pxPerSec={10} />);
    const inHandle = container.querySelector<HTMLElement>('.tl-transition__handle--in')!;
    expect(inHandle.style.visibility).toBe('hidden');
    engine.calls.length = 0;
    fireEvent.pointerDown(inHandle, { button: 0, pointerId: 3, clientX: 0 });
    fireEvent.pointerMove(inHandle, { pointerId: 3, clientX: 50 });
    expect(container.querySelector<HTMLElement>('.tl-transition')!.className).not.toContain('is-ghost');
    const out = container.querySelector<HTMLElement>('.tl-transition__handle--out')!;
    fireEvent.pointerDown(out, { button: 0, pointerId: 4, clientX: 100 });
    fireEvent.pointerMove(out, { pointerId: 4, clientX: -100 });
    expect(container.querySelector<HTMLElement>('.tl-transition')!.style.left).toBe('0px');
    fireEvent.pointerUp(out, { pointerId: 4, clientX: -100 });
    await flush();
    expect(engine.callsOf('sequence.setTransitionLength')[0]!['frames']).toBe(1);
  });
});

describe('TransitionInspector', () => {
  it('탭은 전환이 선택됐을 때만 보인다', async () => {
    const { clips } = await ready();
    const tab = useInspectorRegistry.getState().tabs.find((t) => t.id === 'transition')!;
    expect(tab.label).toBe('전환');
    const ctx = { sequence: tl().sequence!, clips: [], clip: null, playhead: 0 };
    expect(visibleTabs([tab], ctx)).toHaveLength(0);
    await ts().applyAtPoint({ cut: 4 * T, from: clips[0]!.clip, to: clips[2]!.clip }, 'push', 30);
    expect(visibleTabs([tab], { ...ctx, sequence: tl().sequence! })).toHaveLength(1);
  });

  it('종류·길이·정렬·반전을 보이고 바꾼다', async () => {
    const { engine, clips } = await ready();
    const id = (await ts().applyAtPoint({ cut: 4 * T, from: clips[0]!.clip, to: clips[2]!.clip }, 'push', 30))!;
    const ctx = () => ({ sequence: tl().sequence!, clips: [], clip: null, playhead: 0 });
    const { rerender } = render(<TransitionInspector {...ctx()} />);
    const select = screen.getByRole('combobox', { name: '전환 종류' }) as HTMLSelectElement;
    expect(select.value).toBe('push');
    expect(select.options).toHaveLength(12);
    const frames = screen.getByRole('spinbutton', { name: '전환 길이(프레임)' }) as HTMLInputElement;
    expect(frames.value).toBe('30');
    expect(screen.getByText('1.00초')).toBeTruthy();
    expect(screen.getByRole('button', { name: '가운데' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button', { name: '삭제' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '앞' }));
    await flush();
    expect(engine.callsOf('sequence.setTransitionLength').at(-1)).toEqual({ transition: id, frames: 30, align: 'start' });
    rerender(<TransitionInspector {...ctx()} />);
    expect(screen.getByRole('button', { name: '앞' }).getAttribute('aria-pressed')).toBe('true');
    engine.calls.length = 0;

    fireEvent.change(frames, { target: { value: '12' } });
    fireEvent.keyDown(frames, { key: 'Enter' });
    await flush();
    expect(engine.callsOf('sequence.setTransitionLength').at(-1)).toEqual({ transition: id, frames: 12 });
    rerender(<TransitionInspector {...ctx()} />);
    expect((screen.getByRole('spinbutton', { name: '전환 길이(프레임)' }) as HTMLInputElement).value).toBe('12');
    expect(screen.getByText('0.40초')).toBeTruthy();

    // 잘못된 값은 되돌린다
    const f2 = screen.getByRole('spinbutton', { name: '전환 길이(프레임)' }) as HTMLInputElement;
    fireEvent.change(f2, { target: { value: '-3' } });
    fireEvent.blur(f2);
    expect(f2.value).toBe('12');

    fireEvent.change(screen.getByRole('combobox', { name: '전환 종류' }), { target: { value: 'whip' } });
    await flush();
    expect(engine.callsOf('sequence.applyVideoTransition').at(-1)!['effect']).toBe('whip');
    rerender(<TransitionInspector {...ctx()} />);
    const reverse = screen.getByRole('checkbox') as HTMLInputElement;
    expect(reverse.checked).toBe(false);
    fireEvent.click(reverse);
    await flush();
    expect(engine.callsOf('sequence.setTransition').at(-1)!['reverse']).toBe(true);
    expect(ts().selected).not.toBe(id);
  });

  it('갤러리 밖 전환 id 는 그대로 보인다, 선택이 없으면 안내', async () => {
    const { clips } = await ready();
    await ts().applyAtPoint({ cut: 4 * T, from: clips[0]!.clip, to: clips[2]!.clip }, 'vr_light_leaks', 30);
    render(<TransitionInspector sequence={tl().sequence!} clips={[]} clip={null} playhead={0} />);
    const select = screen.getByRole('combobox', { name: '전환 종류' }) as HTMLSelectElement;
    expect(select.value).toBe('vr_light_leaks');
    expect(select.options).toHaveLength(13);
    act(() => useTransitions.setState({ selected: null }));
    expect(screen.getByText('타임라인에서 전환 블록을 선택하세요.')).toBeTruthy();
  });
});
