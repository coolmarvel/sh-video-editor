import { useEffect, useRef } from 'react';
import { formatBytes } from './rules';
import { useStt } from './store';
import { Dialog } from '../../shell/Dialog';

/**
 * 자동 자막 대화상자 하나로 두 상태를 그린다.
 *  - consent: 모델 내려받기 동의(크기·출처·라이선스·오프라인 보관 안내, 동의/취소).
 *  - downloading / transcribing / cleaning / creating: 진행률과 취소.
 * 모양은 ConfirmDialog(sh-dialog) 와 같다.
 */
export function SttDialog() {
  const phase = useStt((s) => s.phase);
  const model = useStt((s) => s.pendingModel);
  const progress = useStt((s) => s.progress);
  const clipIndex = useStt((s) => s.clipIndex);
  const clipCount = useStt((s) => s.clipCount);
  const cancelled = useStt((s) => s.cancelled);
  const agree = useStt((s) => s.agree);
  const decline = useStt((s) => s.decline);
  const cancel = useStt((s) => s.cancel);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (phase === 'consent') primaryRef.current?.focus();
  }, [phase]);

  if (phase === 'idle') return null;

  if (phase === 'consent' && model) {
    return (
      <Dialog titleId="stt-consent-title" title="음성 모델 내려받기" onClose={() => decline()} className="stt-dialog" testId="stt-consent">
        <div className="sh-dialog__body stt-dialog__body">
          <p className="ve-dialog-text">
            자동 자막을 처음 쓰려면 음성 인식 모델 <strong>{model.name}</strong> 을 한 번 내려받아야 합니다.
          </p>
          <dl className="stt-facts">
            <dt>크기</dt>
            <dd>{formatBytes(model.size)}</dd>
            <dt>출처</dt>
            <dd>{model.source}</dd>
            <dt>라이선스</dt>
            <dd>{model.license}</dd>
            <dt>보관</dt>
            <dd>이 컴퓨터의 앱 데이터 폴더에 저장되어 이후에는 인터넷 없이 씁니다. 영상·소리는 컴퓨터 밖으로 나가지 않습니다.</dd>
          </dl>
        </div>
        <div className="sh-dialog__buttons">
          <button type="button" className="sh-btn sh-btn--dialog" onClick={decline}>
            취소
          </button>
          <button ref={primaryRef} type="button" className="sh-btn sh-btn--dialog sh-btn--primary" onClick={agree}>
            동의하고 내려받기
          </button>
        </div>
      </Dialog>
    );
  }

  const title =
    phase === 'downloading' ? '음성 모델 내려받는 중' : phase === 'transcribing' ? '말소리 인식 중' : phase === 'cleaning' ? '음성 정리 중' : '자막 만드는 중';
  const fraction = progress?.fraction ?? 0;
  const percent = Math.round(fraction * 100);
  const detail =
    phase === 'downloading'
      ? `${formatBytes(progress?.done ?? 0)} / ${formatBytes(progress?.total ?? model?.size ?? 0)}${progress?.status ? ` (${progress.status})` : ''}`
      : phase === 'transcribing'
        ? `클립 ${clipIndex} / ${clipCount}${progress?.status ? ` (${progress.status})` : ''}`
        : '엔진이 타임라인을 고치는 중입니다';
  const determinate = phase === 'downloading' || phase === 'transcribing';

  return (
    <Dialog titleId="stt-progress-title" title={title} onClose={() => {}} className="stt-dialog" testId="stt-progress">
      <div className="sh-dialog__body stt-dialog__body">
        <div
          className="sh-progress stt-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={determinate ? percent : undefined}
          aria-label={title}
        >
          <span style={{ width: `${determinate ? percent : 100}%` }} />
        </div>
        <p className="ve-dialog-text sh-tnum" data-testid="stt-progress-detail">
          {determinate ? `${percent}% ` : ''}
          {detail}
        </p>
        {phase === 'transcribing' ? <p className="tx-hint">긴 영상은 재생 시간의 절반쯤 걸립니다. 그동안 다른 편집은 계속할 수 있습니다.</p> : null}
      </div>
      <div className="sh-dialog__buttons">
        <button type="button" className="sh-btn sh-btn--dialog" disabled={cancelled || !determinate} onClick={() => void cancel()}>
          {cancelled ? '멈추는 중' : '취소'}
        </button>
      </div>
    </Dialog>
  );
}
