import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [react()],
  // 도움말 > 정보 대화상자가 보여 줄 제품 버전
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: {
      '@editor': resolve(__dirname, '../../packages/editor/src'),
      '@tokens': resolve(__dirname, '../../design-tokens'),
      // Rust 엔진 wasm-pack 산출물 (npm run build:engine:wasm). SH_ENGINE_PKG 로 다른 pkg 를 꽂을 수 있다(scripts/bench-wasm.mjs 비교용)
      '@engine': process.env['SH_ENGINE_PKG'] ?? resolve(__dirname, '../../packages/engine/bindings/wasm/pkg'),
      // 자동 자막용 음성 wasm(npm run build:engine:speech). 음성 Worker 만 import 한다
      '@speech': resolve(__dirname, '../../packages/engine/bindings/speech-wasm/pkg'),
    },
  },
  // 엔진 워커는 ESM import 를 쓴다(wasm-bindgen 글루)
  worker: { format: 'es' },
  server: {
    port: 5174,
    // SharedArrayBuffer·고해상도 타이머용 cross-origin isolation. 배포 서버도 같은 헤더를 보내야 한다
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
  },
  preview: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
});
