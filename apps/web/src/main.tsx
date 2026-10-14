import { createRoot } from 'react-dom/client';
import { App } from '@editor';
import { createWorkerBridge } from './bridge';
import { webAutosave } from '@editor/features/project/web-session';
import '@tokens/css/tokens.css';
import '@tokens/css/sh-classic.css';

const bridge = createWorkerBridge();
// QA 용: Playwright 와 콘솔이 화면을 거치지 않고 엔진을 부른다(window.shBridge)
(window as unknown as { shBridge: typeof bridge }).shBridge = bridge;
// QA 용: 웹 자동 저장 한 주기를 바로 돌린다(e2e 가 30초를 기다리지 않게)
(window as unknown as { shWebAutosaveTick: () => Promise<boolean> }).shWebAutosaveTick = async () => {
  const a = webAutosave();
  if (!a) return false;
  await a.tick();
  return a.snapshots > 0;
};

const el = document.getElementById('root');
if (el) createRoot(el).render(<App bridge={bridge} host="web" />);
