import { createRoot } from 'react-dom/client';
import { App } from '@editor';
import { createWorkerBridge } from './bridge';
import '@tokens/css/tokens.css';
import '@tokens/css/sh-classic.css';

const bridge = createWorkerBridge();
// QA 용: Playwright 와 콘솔이 화면을 거치지 않고 엔진을 부른다(window.shBridge)
(window as unknown as { shBridge: typeof bridge }).shBridge = bridge;

const el = document.getElementById('root');
if (el) createRoot(el).render(<App bridge={bridge} host="web" />);
