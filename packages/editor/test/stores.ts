/** store 테스트 공통: 모든 zustand store 를 초기 상태로 되돌리고 가짜 엔진을 연결한다. */
import { useEditor } from '../src/store';
import { useTimeline } from '../src/features/timeline/store';
import { useExport } from '../src/features/export/store';
import { useMedia } from '../src/features/media/store';
import { useMonitor } from '../src/features/monitor/store';
import { useProject } from '../src/features/project/store';
import { useTransitions } from '../src/features/transitions/store';
import { useSpeed } from '../src/features/speed/store';
import { useRatio } from '../src/features/ratio/store';
import { useSnsPresets } from '../src/features/ratio/sns';
import { useEffects } from '../src/features/effects/store';
import { useMediaPanelTabs } from '../src/features/media/panel-tabs';
import { useEngineEvents } from '../src/features/events/store';
import { resetThumbnailLoader } from '../src/features/media/thumbs';
import { useText } from '../src/features/text/store';
import { useCaptions } from '../src/features/text/captions-store';
import { useInspectorRegistry } from '../src/features/inspector/registry';
import { useContextMenu } from '../src/features/context-menu/store';
import { useOnboarding } from '../src/features/onboarding/store';
import { useKeyframes } from '../src/features/keyframes/store';
import { useStickers } from '../src/features/stickers/store';
import { useTemplates } from '../src/features/templates/store';
import { resetUserTemplateMemory, useUserTemplates } from '../src/features/templates/user-store';
import { useTranscript } from '../src/features/transcript/store';
import { useStt } from '../src/features/stt/store';
import { focusArea } from '../src/features/shortcuts/keymap';
import { useWebFiles } from '../src/features/project/web-store';
import { resetRecentMemory, useRecent } from '../src/features/project/recent';
import { stopWebSession } from '../src/features/project/web-session';
import { clearPeakCache } from '../src/features/audio/peaks';
import { FakeEngine, type FakeBridgeOptions } from './fake-bridge';

export function resetStores(): void {
  useEditor.setState(useEditor.getInitialState(), true);
  useTimeline.setState(useTimeline.getInitialState(), true);
  useExport.setState(useExport.getInitialState(), true);
  useMedia.setState(useMedia.getInitialState(), true);
  useMonitor.setState(useMonitor.getInitialState(), true);
  useProject.setState(useProject.getInitialState(), true);
  useTransitions.setState(useTransitions.getInitialState(), true);
  useSpeed.setState(useSpeed.getInitialState(), true);
  useRatio.setState(useRatio.getInitialState(), true);
  useSnsPresets.setState(useSnsPresets.getInitialState(), true);
  useEffects.setState(useEffects.getInitialState(), true);
  useMediaPanelTabs.setState({ active: 'media' });
  useEngineEvents.setState(useEngineEvents.getInitialState(), true);
  resetThumbnailLoader();
  useText.setState(useText.getInitialState(), true);
  useCaptions.setState(useCaptions.getInitialState(), true);
  useInspectorRegistry.setState({ active: null });
  useContextMenu.setState(useContextMenu.getInitialState(), true);
  useOnboarding.setState(useOnboarding.getInitialState(), true);
  useKeyframes.setState(useKeyframes.getInitialState(), true);
  useStickers.setState(useStickers.getInitialState(), true);
  useTemplates.setState(useTemplates.getInitialState(), true);
  useUserTemplates.setState(useUserTemplates.getInitialState(), true);
  resetUserTemplateMemory();
  useTranscript.setState(useTranscript.getInitialState(), true);
  useStt.setState(useStt.getInitialState(), true);
  focusArea.current = 'timeline';
  useWebFiles.setState(useWebFiles.getInitialState(), true);
  useRecent.setState(useRecent.getInitialState(), true);
  resetRecentMemory();
  stopWebSession();
  clearPeakCache();
}

/** 가짜 엔진을 만들어 useEditor 에 연결한다(init 까지 끝난 상태). */
export async function connect(opts: FakeBridgeOptions = {}, engine = new FakeEngine(opts)): Promise<FakeEngine> {
  await useEditor.getState().init(engine.bridge);
  return engine;
}

/** 마이크로태스크·즉시 타이머가 비워질 때까지 기다린다(실제 타이머용). */
export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}
