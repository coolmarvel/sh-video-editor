import { createRoot } from 'react-dom/client';
import { App } from '@editor';
import { createWorkerBridge } from './bridge';
import '@tokens/css/tokens.css';
import '@tokens/css/sh-classic.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<App bridge={createWorkerBridge()} host="web" />);
