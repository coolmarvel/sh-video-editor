/**
 * App 이 한 번 부르는 훅. 엔진이 연결되면 EnginePoller 를 시작하고, 재생 상태가 바뀌면 간격을 바로 맞춘다.
 * 전역 단축키(features/shortcuts)처럼 React 밖의 코드가 지금 폴러에 "바로 한 번" 을 요청할 수 있게 registry 에 둔다.
 */
import { useEffect } from 'react';
import { useEditor } from '../../store';
import { useMonitor } from '../monitor/store';
import { EnginePoller } from './poller';

let current: EnginePoller | null = null;

/** 지금 돌고 있는 폴러. 없으면 null */
export function enginePoller(): EnginePoller | null {
  return current;
}

/** 커맨드를 막 실행한 쪽이 다음 주기를 기다리지 않고 바로 반영하고 싶을 때 */
export function pollEngineNow(): Promise<void> {
  return current ? current.tick() : Promise.resolve();
}

export function useEnginePolling(): void {
  const bridge = useEditor((s) => s.bridge);
  useEffect(() => {
    if (!bridge) return;
    const poller = new EnginePoller(bridge);
    current = poller;
    poller.start();
    // 재생을 시작·정지하면 간격이 달라진다. 그 즉시 한 번 읽어 새 간격으로 이어 간다
    const unsubscribe = useMonitor.subscribe((s, prev) => {
      if (s.playing !== prev.playing) void poller.tick();
    });
    return () => {
      unsubscribe();
      poller.stop();
      if (current === poller) current = null;
    };
  }, [bridge]);
}
