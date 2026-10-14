/** store 테스트 공통: 모든 zustand store 를 초기 상태로 되돌리고 가짜 엔진을 연결한다. */
import { useEditor } from '../src/store';
import { useTimeline } from '../src/features/timeline/store';
import { useExport } from '../src/features/export/store';
import { useMedia } from '../src/features/media/store';
import { useMonitor } from '../src/features/monitor/store';
import { useProject } from '../src/features/project/store';
import { useEffects } from '../src/features/effects/store';
import { useMediaPanelTabs } from '../src/features/media/panel-tabs';
import { FakeEngine, type FakeBridgeOptions } from './fake-bridge';

export function resetStores(): void {
  useEditor.setState(useEditor.getInitialState(), true);
  useTimeline.setState(useTimeline.getInitialState(), true);
  useExport.setState(useExport.getInitialState(), true);
  useMedia.setState(useMedia.getInitialState(), true);
  useMonitor.setState(useMonitor.getInitialState(), true);
  useProject.setState(useProject.getInitialState(), true);
  useEffects.setState(useEffects.getInitialState(), true);
  useMediaPanelTabs.setState({ active: 'media' });
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
