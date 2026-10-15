/** features/jobs/JobsPane.tsx: 상태 줄 잡 칸(DESIGN.md 4.25). 잡이 없으면 없고, 하나면 막대 + 이름 % + 취소, 둘 이상이면 목록 팝오버. */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { JobsPane } from '@editor/features/jobs/JobsPane';
import { useJobs, type JobView } from '@editor/features/jobs/store';
import { engineWithClips, type FakeEngine } from '../../fake-bridge';
import { connect, flush, resetStores } from '../../stores';

let engine: FakeEngine;
let clips: number[];

beforeEach(async () => {
  resetStores();
  // 펌프가 끝내지 않게(jobStep 0): 잡은 취소할 때까지 진행 중이다
  const made = engineWithClips({ jobStep: 0 });
  engine = made.engine;
  // engineWithClips 는 [a 영상, a 소리, b 영상, b 소리]
  clips = [made.clips[0]!.clip, made.clips[2]!.clip];
  await connect({}, engine);
});

const view = (id: number, kind: string, progress: number, over: Partial<JobView> = {}): JobView => ({
  id,
  kind,
  label: '',
  progress,
  done: false,
  cancelled: false,
  error: null,
  startedAt: 0,
  ...over,
});

/** 가짜 엔진에 실제 잡을 만들어 store 에 걸고 진행률을 정한다(취소가 jobs.cancel 로 통하게) */
function realJob(clip: number, progress: number): number {
  const r = engine.execute('effects.analyzeStabilizer', { clip }) as { job: number };
  act(() => {
    useJobs.getState().track(engine.bridge, { id: r.job, kind: 'stabilizer' });
    useJobs.getState().applyEvents([{ type: 'jobProgress', id: r.job, kind: 'stabilizer', progress, done: false }]);
  });
  return r.job;
}

describe('JobsPane', () => {
  it('잡이 없으면 아무것도 그리지 않고, 내보내기 잡만 있어도 그리지 않는다', () => {
    const { container, rerender } = render(<JobsPane />);
    expect(container.innerHTML).toBe('');
    act(() => useJobs.setState({ jobs: [view(1, 'export', 0.4)] }));
    rerender(<JobsPane />);
    expect(container.innerHTML).toBe('');
  });

  it('하나면 진행 막대(aria-valuenow) + "흔들림 분석 42%" + 취소 버튼이 jobs.cancel 을 보낸다', async () => {
    const job = realJob(clips[0]!, 0.42);
    render(<JobsPane />);
    const pane = screen.getByTestId('jobs-pane');
    expect(pane).toHaveAttribute('data-count', '1');
    const bar = screen.getByRole('progressbar', { name: '흔들림 분석' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByTestId('jobs-text')).toHaveTextContent('흔들림 분석 42%');
    expect(screen.queryByTestId('jobs-list-toggle')).toBeNull();
    fireEvent.click(screen.getByTestId('jobs-cancel'));
    await flush();
    expect(engine.callsOf('jobs.cancel')).toEqual([{ job }]);
    expect(engine.jobs.find((j) => j.id === job)).toMatchObject({ cancelled: true, finished: true });
    // 취소가 반영되면 칸이 사라진다
    await act(async () => {
      useJobs.getState().applyEvents([{ type: 'jobProgress', id: job, kind: 'stabilizer', progress: 0.42, done: true, cancelled: true, error: 'stopped' }]);
    });
    expect(screen.queryByTestId('jobs-pane')).toBeNull();
  });

  it('둘 이상이면 가장 느린 잡의 막대와 "작업 N개 %", 목록 버튼이 잡마다 막대·취소가 있는 팝오버를 연다', async () => {
    const slow = realJob(clips[0]!, 0.2);
    realJob(clips[1]!, 0.8);
    act(() => useJobs.getState().applyEvents([{ type: 'jobProgress', id: 99, kind: 'sceneDetect', label: 'Scene', progress: 0.5, done: false }]));
    render(<JobsPane />);
    expect(screen.getByTestId('jobs-pane')).toHaveAttribute('data-count', '3');
    expect(screen.getByTestId('jobs-text')).toHaveTextContent('작업 3개 20%');
    expect(screen.queryByTestId('jobs-cancel')).toBeNull();
    const toggle = screen.getByTestId('jobs-list-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('jobs-list')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByTestId('jobs-list');
    expect(list.querySelectorAll('li')).toHaveLength(3);
    expect(screen.getAllByRole('progressbar')).toHaveLength(4);
    expect(screen.getByRole('button', { name: '장면 찾기 취소' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '흔들림 분석 취소' })[0]!);
    await flush();
    expect(engine.callsOf('jobs.cancel')).toEqual([{ job: slow }]);
    fireEvent.click(toggle);
    expect(screen.queryByTestId('jobs-list')).toBeNull();
  });
});
