import { Timeline as TimelineFeature } from '../features/timeline';

/** 타임라인 셸. 실제 트랙·클립·razor 는 features/timeline 이 그린다. */
export function Timeline() {
  return <TimelineFeature />;
}
