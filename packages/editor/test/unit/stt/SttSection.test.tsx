/**
 * features/stt/SttSection.tsx: 편집본이 없을 때도 그려진다. 선택 셀렉터가 매번 새 배열을 돌려주면 zustand 5 에서
 * "getSnapshot should be cached" 경고와 무한 갱신이 난다(JobsPane 에서 겪은 것과 같은 모양).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SttSection } from '@editor/features/stt/SttSection';
import { useTimeline } from '@editor/features/timeline/store';
import { resetStores } from '../../stores';

beforeEach(resetStores);
afterEach(() => vi.restoreAllMocks());

describe('SttSection', () => {
  it('편집본이 없어도 셀렉터가 같은 값을 돌려줘 경고 없이 그려진다', () => {
    useTimeline.setState({ sequence: null });
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<SttSection />);
    const loops = err.mock.calls.filter((c) => /getSnapshot|Maximum update depth/.test(String(c[0])));
    expect(loops).toEqual([]);
  });
});
