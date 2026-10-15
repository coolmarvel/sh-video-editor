/**
 * features/jobs/store.ts: 잡 추적(track)·진행률 이벤트 반영(applyEvents)·끝 기다리기(waitFor)·취소(cancel), 웹 펌프 루프
 * (pumpJobs 를 돌려 가짜 엔진의 jobProgress 이벤트를 폴러로 받는다), 상태 줄에 보이는 종류와 한국어 이름.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { EnginePoller } from '@editor/features/events/poller';
import { installEnginePoller } from '@editor/features/events/useEnginePolling';
import { HIDDEN_KINDS, KIND_LABELS, PUMP_INTERVAL_MS, jobLabel, useJobs, visibleJobs, type JobView } from '@editor/features/jobs/store';
import type { JobProgressEvent } from '@editor/engine/bridge';
import { engineWithClips, type FakeClip, type FakeEngine } from '../../fake-bridge';
import { connect, flush, resetStores } from '../../stores';

let engine: FakeEngine;
let a: FakeClip;
let poller: EnginePoller;

beforeEach(async () => {
  resetStores();
  const made = engineWithClips({ jobStep: 0.5 });
  engine = made.engine;
  a = made.clips[0]!;
  await connect({}, engine);
  // 실제 앱에서는 useEnginePolling 훅이 세운다. 여기서는 tick 을 펌프 루프가 부르게만 둔다(주기 폴링은 돌리지 않는다)
  poller = new EnginePoller(engine.bridge);
  installEnginePoller(poller);
});

const jobs = () => useJobs.getState();
const ev = (over: Partial<JobProgressEvent> & { id: number }): JobProgressEvent => ({
  type: 'jobProgress',
  kind: 'stabilizer',
  progress: 0,
  done: false,
  ...over,
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('이름과 보이는 잡', () => {
  it('종류를 한국어로, 모르는 종류는 엔진 라벨 또는 종류 id 로', () => {
    expect(jobLabel({ kind: 'stabilizer', label: 'Analyzing a.mp4' })).toBe('흔들림 분석');
    expect(jobLabel({ kind: 'sceneDetect', label: '' })).toBe('장면 찾기');
    expect(jobLabel({ kind: 'weird', label: 'Weird Job' })).toBe('Weird Job');
    expect(jobLabel({ kind: 'weird', label: '' })).toBe('weird');
    for (const k of Object.keys(KIND_LABELS)) expect(KIND_LABELS[k]).not.toMatch(/[A-Za-z]/);
  });

  it('내보내기는 상태 줄에 보이지 않고, 끝난 잡도 보이지 않는다', () => {
    const view = (id: number, kind: string, done = false): JobView => ({
      id,
      kind,
      label: '',
      progress: 0.5,
      done,
      cancelled: false,
      error: null,
      startedAt: 0,
    });
    expect(HIDDEN_KINDS.has('export')).toBe(true);
    expect(visibleJobs({ jobs: [view(1, 'export'), view(2, 'stabilizer'), view(3, 'sceneDetect', true)] }).map((j) => j.id)).toEqual([2]);
  });
});

describe('applyEvents', () => {
  it('새 id 는 추가, 같은 id 는 갱신, 진행률은 0..1 로 잘리고 끝난 잡은 finished 로 옮긴다', () => {
    jobs().applyEvents([ev({ id: 2, progress: -0.2 }), ev({ id: 1, kind: 'sceneDetect', label: 'Scene', progress: 1.7 })]);
    expect(jobs().jobs.map((j) => [j.id, j.progress])).toEqual([
      [1, 1],
      [2, 0],
    ]);
    expect(jobs().jobs[0]!.label).toBe('Scene');
    jobs().applyEvents([ev({ id: 1, kind: 'sceneDetect', progress: 1, done: true })]);
    expect(jobs().jobs.map((j) => j.id)).toEqual([2]);
    expect(jobs().finished.map((j) => [j.id, j.done, j.label])).toEqual([[1, true, 'Scene']]);
    // 빈 묶음은 아무것도 바꾸지 않는다
    const before = jobs();
    jobs().applyEvents([]);
    expect(jobs()).toBe(before);
  });

  it('취소·오류를 그대로 담고 finished 는 최근 20개만 둔다', () => {
    jobs().applyEvents([ev({ id: 5, progress: 0.3, done: true, cancelled: true, error: 'stopped' })]);
    expect(jobs().finished[0]).toMatchObject({ id: 5, cancelled: true, error: 'stopped', done: true });
    jobs().applyEvents(Array.from({ length: 25 }, (_, i) => ev({ id: 100 + i, progress: 1, done: true })));
    expect(jobs().finished).toHaveLength(20);
    expect(jobs().finished[0]!.id).toBe(105);
  });

  it('잡이 하나로 줄면 여러 잡 팝오버가 닫힌다', () => {
    jobs().applyEvents([ev({ id: 1 }), ev({ id: 2 })]);
    jobs().setListOpen(true);
    jobs().applyEvents([ev({ id: 1, progress: 0.5 })]);
    expect(jobs().listOpen).toBe(true);
    jobs().applyEvents([ev({ id: 2, progress: 1, done: true })]);
    expect(jobs().listOpen).toBe(false);
  });
});

describe('track + 펌프 루프', () => {
  it('걸자마자 목록에 보이고(진행률 0), 펌프가 돌아 끝나면 finished 로 가며 루프가 멈춘다', async () => {
    const r = engine.execute('effects.analyzeStabilizer', { clip: a.clip }) as { job: number; cached: boolean };
    expect(r.cached).toBe(false);
    jobs().track(engine.bridge, { id: r.job, kind: 'stabilizer' });
    jobs().track(engine.bridge, { id: r.job, kind: 'stabilizer' });
    expect(jobs().jobs).toHaveLength(1);
    expect(jobs().jobs[0]).toMatchObject({ id: r.job, progress: 0, done: false });
    expect(jobs().pumping).toBe(true);
    const [done] = await jobs().waitFor([r.job]);
    expect(done).toMatchObject({ id: r.job, done: true, progress: 1, cancelled: false, error: null });
    expect(jobs().jobs).toEqual([]);
    expect(engine.jobs.find((j) => j.id === r.job)).toMatchObject({ finished: true, kind: 'stabilizer' });
    await wait(PUMP_INTERVAL_MS * 2);
    expect(jobs().pumping).toBe(false);
    // 이미 끝난 잡은 바로 돌려준다
    expect(await jobs().waitFor([r.job])).toHaveLength(1);
    expect(await jobs().waitFor([])).toEqual([]);
  });

  it('cancel 은 jobs.cancel 을 보내고 바로 반영한다: cancelled 와 error "stopped"', async () => {
    const slow = engineWithClips({ jobStep: 0.01 });
    engine = slow.engine;
    await connect({}, engine);
    installEnginePoller(new EnginePoller(engine.bridge));
    const r = engine.execute('effects.analyzeStabilizer', { clip: slow.clips[0]!.clip }) as { job: number };
    jobs().track(engine.bridge, { id: r.job, kind: 'stabilizer' });
    await wait(PUMP_INTERVAL_MS * 2);
    expect(jobs().jobs[0]!.progress).toBeGreaterThan(0);
    expect(jobs().jobs[0]!.progress).toBeLessThan(1);
    await jobs().cancel(engine.bridge, r.job);
    expect(engine.callsOf('jobs.cancel')).toEqual([{ job: r.job }]);
    const [j] = await jobs().waitFor([r.job]);
    expect(j).toMatchObject({ cancelled: true, done: true, error: 'stopped' });
    expect(jobs().jobs).toEqual([]);
    await flush();
  });

  it('펌프가 실패해도 루프는 다음 주기에 다시 돈다', async () => {
    const r = engine.execute('effects.analyzeStabilizer', { clip: a.clip }) as { job: number };
    let failures = 0;
    const original = engine.bridge.pumpJobs;
    engine.bridge.pumpJobs = async (ms) => {
      if (failures++ === 0) throw new Error('잠깐');
      return original(ms);
    };
    jobs().track(engine.bridge, { id: r.job, kind: 'stabilizer' });
    const [done] = await jobs().waitFor([r.job]);
    expect(done!.done).toBe(true);
    expect(failures).toBeGreaterThan(1);
  });
});
