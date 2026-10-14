/**
 * 자동 자막(M2-2, features/stt). 자막 탭(features/text/CaptionsTab)이 `SttSection` 을 그린다. 상태는 `useStt`,
 * 순수 규칙은 `rules.ts`. 인식·다운로드는 데스크톱 호스트(bridge.stt)가, 편집은 엔진 transcript.* 커맨드가 한다.
 */
export { SttSection } from './SttSection';
export { SttDialog } from './SttDialog';
export { useStt, targetItems, PROGRESS_POLL_MS } from './store';
export type { SttPhase, SttScope, SttState } from './store';
export * from './rules';
