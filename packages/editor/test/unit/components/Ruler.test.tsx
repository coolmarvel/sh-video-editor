/** features/timeline/Ruler.tsx: 보이는 구간의 눈금과 라벨, 플레이헤드 머리. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { Ruler } from '@editor/features/timeline/Ruler';
import { TICKS_PER_SECOND as T } from '@editor/engine/time';

const FR30 = { num: 30, den: 1 };

describe('Ruler', () => {
  it('60px/s 에서 2초마다 라벨, 0.5초마다 작은 눈금', () => {
    const { container } = render(<Ruler pxPerSec={60} frameRate={FR30} from={0} to={10 * T} playhead={T} onPointerDown={vi.fn()} />);
    const ticks = container.querySelectorAll<HTMLElement>('.tl-tick');
    expect(ticks).toHaveLength(21);
    const majors = container.querySelectorAll<HTMLElement>('.tl-tick--major');
    expect([...majors].map((m) => m.textContent)).toEqual(['00:00:00:00', '00:00:02:00', '00:00:04:00', '00:00:06:00', '00:00:08:00', '00:00:10:00']);
    expect(majors[1]!.style.left).toBe('120px');
    expect(container.querySelector<HTMLElement>('.tl-ruler__head')!.style.left).toBe('60px');
  });

  it('보이는 구간만 그린다(from 을 작은 눈금으로 내림)', () => {
    const { container } = render(<Ruler pxPerSec={60} frameRate={FR30} from={3.2 * T} to={5 * T} playhead={0} onPointerDown={vi.fn()} />);
    const lefts = [...container.querySelectorAll<HTMLElement>('.tl-tick')].map((t) => t.style.left);
    expect(lefts).toEqual(['180px', '210px', '240px', '270px', '300px']);
    expect([...container.querySelectorAll('.tl-tick--major')].map((m) => m.textContent)).toEqual(['00:00:04:00']);
  });

  it('음수 from 은 0 부터', () => {
    const { container } = render(<Ruler pxPerSec={60} frameRate={FR30} from={-5 * T} to={T} playhead={0} onPointerDown={vi.fn()} />);
    expect(container.querySelectorAll<HTMLElement>('.tl-tick')[0]!.style.left).toBe('0px');
  });

  it('포인터 다운을 넘긴다', () => {
    const onPointerDown = vi.fn();
    const { container } = render(<Ruler pxPerSec={60} frameRate={FR30} from={0} to={T} playhead={0} onPointerDown={onPointerDown} />);
    fireEvent.pointerDown(container.querySelector('.tl-ruler')!, { button: 0, pointerId: 1 });
    expect(onPointerDown).toHaveBeenCalledTimes(1);
  });

  it('23.976 에서 라벨은 프레임 경계 타임코드', () => {
    const fr = { num: 24000, den: 1001 };
    const { container } = render(<Ruler pxPerSec={60} frameRate={fr} from={0} to={4.2 * T} playhead={0} onPointerDown={vi.fn()} />);
    expect([...container.querySelectorAll('.tl-tick--major')].map((m) => m.textContent)).toEqual(['00:00:00:00', '00:00:02:00', '00:00:04:00']);
  });
});
