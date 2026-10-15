/**
 * 키프레임 모션(features/keyframes). 모듈을 읽는 것만으로 인스펙터 탭 "모션" 과 모니터 변형 상자 오버레이를 등록한다.
 * App.tsx 가 한 번 import 한다. 타임라인 클립 마커는 timeline/Track.tsx 가 ClipKeyframeMarkers 를 직접 그린다.
 */
import { hasVideoEffects } from '../effects/store';
import { registerInspectorTab } from '../inspector/registry';
import { registerMonitorOverlay } from '../monitor/registry';
import { MonitorTransformOverlay } from './MonitorTransformOverlay';
import { MotionTab } from './MotionTab';

registerInspectorTab({ id: 'motion', label: '모션', order: 15, when: (ctx) => ctx.clips.some((c) => hasVideoEffects(c)), component: MotionTab });
registerMonitorOverlay(MonitorTransformOverlay);

export * from './model';
