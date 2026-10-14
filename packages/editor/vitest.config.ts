/**
 * 화면(packages/editor) 단위 테스트 설정. jsdom 위에서 순수 모듈·store·컴포넌트를 검증한다.
 * 엔진은 test/fake-bridge.ts 의 가짜 EngineBridge 로 대신한다(실제 엔진은 packages/engine/tests 가 맡는다).
 * 실행: 루트에서 `npm run test:unit` (커버리지: `npm run test:unit:coverage`).
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@editor': resolve(__dirname, 'src') } },
  test: {
    name: 'editor-unit',
    root: __dirname,
    environment: 'jsdom',
    include: ['test/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    css: false,
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reportsDirectory: resolve(__dirname, 'coverage'),
      reporter: ['text', 'json-summary'],
      // 순수 모듈·store 만 측정한다. 컴포넌트는 e2e 가 실제 브라우저에서 본다
      include: [
        'src/engine/time.ts',
        'src/store.ts',
        'src/features/timeline/geometry.ts',
        'src/features/timeline/types.ts',
        'src/features/timeline/dnd.ts',
        'src/features/timeline/store.ts',
        'src/features/export/presets.ts',
        'src/features/export/jobs.ts',
        'src/features/export/store.ts',
        'src/features/media/types.ts',
        'src/features/media/store.ts',
        'src/features/media/thumbs.ts',
        'src/features/events/classify.ts',
        'src/features/events/store.ts',
        'src/features/events/poller.ts',
        'src/features/monitor/store.ts',
        'src/features/monitor/controller.ts',
        'src/features/project/store.ts',
        'src/features/project/menu.ts',
        'src/features/effects/params.ts',
        'src/features/effects/catalog.ts',
        'src/features/effects/store.ts',
        'src/features/media/panel-tabs.ts',
        'src/features/audio/sync.ts',
        'src/features/audio/peaks.ts',
        'src/features/audio/ducking.ts',
        'src/features/audio/playback.ts',
        'src/features/audio/store.ts',
        'src/features/context-menu/store.ts',
        'src/features/context-menu/clip-actions.ts',
        'src/features/context-menu/clip-menu.ts',
        'src/features/context-menu/media-menu.ts',
        'src/features/onboarding/naming.ts',
        'src/features/onboarding/edition.ts',
        'src/features/keyframes/model.ts',
        'src/features/keyframes/presets.ts',
        'src/features/keyframes/store.ts',
        'src/features/stickers/catalog.ts',
        'src/features/stickers/store.ts',
        'src/features/templates/recipe.ts',
        'src/features/templates/catalog.ts',
        'src/features/templates/store.ts',
      ],
      thresholds: { statements: 85, branches: 80, functions: 85, lines: 85 },
    },
  },
});
