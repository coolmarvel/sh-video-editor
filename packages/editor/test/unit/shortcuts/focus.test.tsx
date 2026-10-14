/** features/shortcuts: 포커스 영역(keymap.focusArea). Delete 는 마지막으로 누른 패널(미디어/타임라인)의 선택을 지운다. */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { useShortcuts } from '@editor/features/shortcuts/useShortcuts';
import { focusArea } from '@editor/features/shortcuts/keymap';
import { runAction } from '@editor/features/shortcuts/actions';
import { useContextMenu } from '@editor/features/context-menu/store';
import { useMedia } from '@editor/features/media/store';
import { useTimeline } from '@editor/features/timeline/store';
import { useEditor } from '@editor/store';
import { engineWithClips } from '../../fake-bridge';
import { connect, flush, resetStores } from '../../stores';

beforeEach(resetStores);

function Host() {
  useShortcuts();
  return (
    <div>
      <section data-area="media">
        <span data-testid="m">m</span>
      </section>
      <section data-area="timeline">
        <span data-testid="t">t</span>
      </section>
      <span data-testid="none">x</span>
    </div>
  );
}

describe('focusArea', () => {
  it('pointerdown 이 있었던 data-area 를 기억한다(없는 곳은 그대로)', () => {
    const { getByTestId } = render(<Host />);
    expect(focusArea.current).toBe('timeline');
    fireEvent.pointerDown(getByTestId('m'));
    expect(focusArea.current).toBe('media');
    fireEvent.pointerDown(getByTestId('none'));
    expect(focusArea.current).toBe('media');
    fireEvent.pointerDown(getByTestId('t'));
    expect(focusArea.current).toBe('timeline');
  });

  it('Delete: 미디어 패널이면 미디어 항목을, 아니면 타임라인 클립을 지운다', async () => {
    const { engine, items, clips } = engineWithClips();
    await connect({}, engine);
    await useMedia.getState().refresh();
    await useTimeline.getState().refresh();
    const { getByTestId } = render(<Host />);
    // 타임라인: 선택 없음 안내, 선택 뒤 삭제
    fireEvent.keyDown(window, { key: 'Delete' });
    await flush();
    expect(useEditor.getState().status).toBe('삭제할 클립을 먼저 선택하세요');
    await useTimeline.getState().selectClip(clips[0]!.clip);
    fireEvent.keyDown(window, { key: 'Delete' });
    await flush();
    expect(engine.callsOf('edit.clear')).toHaveLength(1);
    // 미디어: 선택 없음 안내, 선택 뒤 확인 대화상자 거쳐 project.delete
    fireEvent.pointerDown(getByTestId('m'));
    fireEvent.keyDown(window, { key: 'Backspace' });
    await flush();
    expect(useEditor.getState().status).toBe('삭제할 미디어 항목을 먼저 선택하세요');
    await useMedia.getState().select(items[1]!.item);
    fireEvent.keyDown(window, { key: 'Delete' });
    await flush();
    expect(useContextMenu.getState().confirm).not.toBeNull();
    useContextMenu.getState().answerConfirm(true);
    await flush();
    expect(engine.callsOf('project.delete')).toEqual([{ items: [items[1]!.item] }]);
    expect(engine.state.items.map((i) => i.name)).toEqual(['a.mp4', '시퀀스 1']);
    // 대화상자가 열려 있으면 단축키를 받지 않는다(runAction 직접 호출로 대조)
    await runAction('clip.delete');
    expect(useEditor.getState().status).toBe('삭제할 미디어 항목을 먼저 선택하세요');
  });
});
