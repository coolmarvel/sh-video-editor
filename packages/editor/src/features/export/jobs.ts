/**
 * 내보내기 작업 루프. 내보내기는 엔진 안에서 스레드(데스크톱) 또는 단계 작업(웹)으로 돌고,
 * 호스트가 `pumpJobs` 를 주기적으로 불러야 진행되고 정산된다(엔진 Session::pump_jobs, export_tools::pump_queue).
 */
import type { EngineBridge } from '../../engine/bridge';

export interface QueueItem {
  id: number;
  job: number | null;
  path: string;
  preset: string;
  format: string;
  /** ready | encoding | done | failed | cancelled */
  status: string;
  statusText: string;
  /** 0..1 */
  progress: number;
  etaSeconds: number | null;
  error: string | null;
  sequenceName: string;
}

export interface QueueList {
  running: boolean;
  items: QueueItem[];
}

export interface JobReport {
  id: number;
  finished: boolean;
  result: { bytes?: number; frames?: number; seconds?: number; path?: string; error?: string } | null;
}

export function isQueueBusy(q: QueueList): boolean {
  return q.running || q.items.some((i) => i.status === 'encoding');
}

/** 큐가 쉴 때까지 pumpJobs 와 export.queue.list 를 반복한다. 반환한 함수로 멈춘다. */
export function runQueueLoop(bridge: EngineBridge, onTick: (q: QueueList) => void, onError: (message: string) => void, intervalMs = 60): () => void {
  let stopped = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    if (stopped) return;
    try {
      await bridge.pumpJobs(16);
      const q = (await bridge.execute('export.queue.list')) as QueueList;
      if (stopped) return;
      failures = 0;
      onTick(q);
      if (!isQueueBusy(q)) return;
    } catch (e) {
      failures += 1;
      if (failures >= 10) {
        onError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    timer = setTimeout(() => void tick(), intervalMs);
  };
  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/** 끝난 작업의 결과(바이트 수, 걸린 시간)를 jobs.list 에서 찾는다. */
export async function findJobReport(bridge: EngineBridge, jobId: number): Promise<JobReport | null> {
  const jobs = (await bridge.execute('jobs.list')) as JobReport[];
  return jobs.find((j) => j.id === jobId) ?? null;
}
