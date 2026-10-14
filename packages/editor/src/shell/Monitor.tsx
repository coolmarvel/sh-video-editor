import { MonitorPanel } from '../features/monitor';

/** 프로그램 모니터 패널 껍데기. 내용(캔버스·재생·스크러버)은 features/monitor 가 담당한다. */
export function Monitor() {
  return (
    <section className="sh-panel ve-monitor" aria-label="미리보기">
      <div className="sh-panel__title">미리보기</div>
      <MonitorPanel />
    </section>
  );
}
