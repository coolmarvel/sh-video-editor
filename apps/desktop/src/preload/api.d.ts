import type { ShEngineApi } from './index';

declare global {
  interface Window {
    shEngine: ShEngineApi;
  }
}
export {};
