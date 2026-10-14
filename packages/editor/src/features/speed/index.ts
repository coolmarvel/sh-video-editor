/** features/speed: 인스펙터 "속도" 탭 등록 + 타임라인 배지. App 이 이 모듈을 한 번 import 하면 탭이 등록된다. */
import { registerInspectorTab } from '../inspector/registry';
import { SpeedTab } from './SpeedTab';

registerInspectorTab({ id: 'speed', label: '속도', order: 30, component: SpeedTab });

export { useSpeed, FREEZE_SECONDS } from './store';
export { SpeedForm } from './SpeedForm';
export { SpeedBadge } from './SpeedBadge';
export { SpeedTab } from './SpeedTab';
export * from './model';
