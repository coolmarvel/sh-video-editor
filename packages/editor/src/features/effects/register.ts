/** 인스펙터 탭("효과", "색")과 미디어 패널 탭("필터") 등록. App 이 features/effects 를 import 하면 한 번 실행된다. */
import { registerInspectorTab } from '../inspector/registry';
import { registerMediaPanelTab } from '../media/panel-tabs';
import { ColorTab } from './ColorTab';
import { EffectsTab, hasVideoEffects } from './EffectsTab';
import { FilterGallery } from './FilterGallery';

registerInspectorTab({ id: 'effects', label: '효과', order: 20, when: (ctx) => ctx.clips.some((c) => hasVideoEffects(c)), component: EffectsTab });
registerInspectorTab({ id: 'color', label: '색', order: 30, when: (ctx) => ctx.clips.some((c) => hasVideoEffects(c)), component: ColorTab });
registerMediaPanelTab({ id: 'filters', label: '필터', order: 20, component: FilterGallery });
