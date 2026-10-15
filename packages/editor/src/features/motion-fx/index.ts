/**
 * 속도 램프, 크로마키·작은 화면, 흔들림 줄이기(features/motion-fx). 모듈을 읽는 것만으로 속도 탭의 "속도 곡선" 절, 효과 탭의
 * 세 절, 모니터 스포이트 오버레이를 등록한다. App.tsx 가 한 번 import 한다.
 */
import { registerEffectsSection } from '../effects/sections';
import { registerMonitorOverlay } from '../monitor/registry';
import { registerSpeedSection } from '../speed/sections';
import { ChromaKeyPickOverlay } from './ChromaKeyPickOverlay';
import { ChromaKeySection, PipSection, StabilizeSection } from './EffectsExtras';
import { SpeedCurveSection } from './SpeedCurveSection';

registerSpeedSection({ id: 'speed-curve', order: 10, component: SpeedCurveSection });
registerEffectsSection({ id: 'chroma-key', order: 10, component: ChromaKeySection });
registerEffectsSection({ id: 'pip', order: 20, component: PipSection });
registerEffectsSection({ id: 'stabilize', order: 30, component: StabilizeSection });
registerMonitorOverlay(ChromaKeyPickOverlay);

export * from './ramp';
export * from './pip';
export * from './chroma';
