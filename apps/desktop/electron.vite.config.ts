/**
 * Electron 셸 빌드. 렌더러는 apps/web 과 같은 별칭으로 packages/editor 를 번들한다.
 * bytecodePlugin 은 쓰지 않는다(V8 바이트코드는 컴파일 플랫폼 종속, docs/guides/packaging.md). 소스 보호는 scripts/obfuscate.cjs.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const editor = resolve(__dirname, '../../packages/editor/src');
const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };
const tokens = resolve(__dirname, '../../design-tokens');

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // index: Electron 메인. engine-host: 엔진 utility process (main 이 utilityProcess.fork 로 띄운다)
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'engine-host': resolve(__dirname, 'src/engine-host/index.ts'),
        },
      },
    },
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    resolve: { alias: { '@editor': editor, '@tokens': tokens } },
    // 도움말 > 정보 대화상자가 보여 줄 제품 버전
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [react()],
  },
});
