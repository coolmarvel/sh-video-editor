/**
 * 텍스트·제목 클립과 자막(features/text). 모듈을 읽는 것만으로 인스펙터 탭("텍스트", "자막"), 인스펙터 도구 줄
 * (텍스트 추가·제목 프리셋), 모니터 오버레이(끌어서 위치)를 등록한다. App.tsx 가 한 번 import 한다.
 */
import { registerInspectorTab, registerInspectorTool } from '../inspector/registry';
import { registerMonitorOverlay } from '../monitor/registry';
import { CaptionsTab } from './CaptionsTab';
import { MonitorTextOverlay } from './MonitorTextOverlay';
import { TextTab } from './TextTab';
import { isTextClip } from './params';
import { TITLE_PRESETS } from './presets';
import { useText } from './store';
import './text.css';

registerInspectorTab({
  id: 'text',
  label: '텍스트',
  order: 10,
  when: (ctx) => ctx.clip !== null && isTextClip(ctx.clip),
  component: TextTab,
});

registerInspectorTab({
  id: 'captions',
  label: '자막',
  order: 90,
  when: () => true,
  component: CaptionsTab,
});

for (const [i, preset] of TITLE_PRESETS.entries()) {
  registerInspectorTool({
    id: `text.${preset.id}`,
    label: preset.label,
    title: preset.id === 'plain' ? '플레이헤드 위치에 5초 텍스트 클립 (T)' : `플레이헤드 위치에 ${preset.label} 프리셋`,
    order: 10 + i,
    onClick: () => void useText.getState().addText(preset.id),
  });
}

registerMonitorOverlay(MonitorTextOverlay);
