/**
 * 상태 줄의 잡 진행 칸(DESIGN.md 4.25). 진행 중인 잡이 있을 때만 보인다: 4.13 진행 막대(폭 96) + "흔들림 분석 42%" + 작은 취소 버튼.
 * 잡이 둘 이상이면 "작업 N개 42%"(가장 느린 것) 와 목록 버튼이 보이고, 누르면 잡마다 막대·취소가 있는 팝오버가 위로 열린다.
 */
import { useEditor } from '../../store';
import { jobLabel, useJobs, visibleJobs, type JobView } from './store';
import './jobs.css';

function percent(j: JobView): string {
  return `${Math.round(j.progress * 100)}%`;
}

function Bar({ job }: { job: JobView }) {
  return (
    <span
      className="sh-progress ve-jobs-bar"
      role="progressbar"
      aria-label={jobLabel(job)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(job.progress * 100)}
    >
      <span style={{ width: percent(job) }} />
    </span>
  );
}

export function JobsPane() {
  // 선택자가 새 배열을 만들면 매 렌더가 갱신을 부르므로 원본 배열을 고르고 여기서 거른다
  const all = useJobs((s) => s.jobs);
  const jobs = visibleJobs({ jobs: all });
  const listOpen = useJobs((s) => s.listOpen);
  const bridge = useEditor((s) => s.bridge);
  if (jobs.length === 0 || !bridge) return null;
  const { cancel, setListOpen } = useJobs.getState();
  const slowest = jobs.reduce((a, b) => (b.progress < a.progress ? b : a), jobs[0] as JobView);
  const single = jobs.length === 1;
  return (
    <span className="sh-pane ve-jobs" data-testid="jobs-pane" data-count={jobs.length}>
      <Bar job={slowest} />
      <span className="ve-jobs-text sh-tnum" data-testid="jobs-text">
        {single ? `${jobLabel(slowest)} ${percent(slowest)}` : `작업 ${jobs.length}개 ${percent(slowest)}`}
      </span>
      {single ? (
        <button type="button" className="sh-btn sh-btn--sm" data-testid="jobs-cancel" onClick={() => void cancel(bridge, slowest.id)}>
          취소
        </button>
      ) : (
        <button
          type="button"
          className="sh-btn sh-btn--sm"
          data-testid="jobs-list-toggle"
          aria-expanded={listOpen}
          aria-controls="ve-jobs-list"
          onClick={() => setListOpen(!listOpen)}
        >
          목록
        </button>
      )}
      {!single && listOpen ? (
        <ul id="ve-jobs-list" className="ve-jobs-list sh-menu" role="list" data-testid="jobs-list">
          {jobs.map((j) => (
            <li key={j.id} className="ve-jobs-item">
              <span className="ve-jobs-text">{jobLabel(j)}</span>
              <Bar job={j} />
              <span className="sh-tnum">{percent(j)}</span>
              <button type="button" className="sh-btn sh-btn--sm" aria-label={`${jobLabel(j)} 취소`} onClick={() => void cancel(bridge, j.id)}>
                취소
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}
