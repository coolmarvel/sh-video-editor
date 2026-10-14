import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@editor': resolve(__dirname, '../../packages/editor/src'),
      '@tokens': resolve(__dirname, '../../design-tokens'),
      // Rust 엔진 wasm-pack 산출물 (npm run build:engine:wasm)
      '@engine': resolve(__dirname, '../../packages/engine/bindings/wasm/pkg'),
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
