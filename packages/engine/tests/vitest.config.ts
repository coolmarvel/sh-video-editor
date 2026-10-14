/**
 * 엔진 바인딩 기능 테스트 설정. 실제 Rust 엔진(Linux .node 와 wasm pkg)을 Node 에서 돌린다.
 * 내보내기·자동 저장처럼 시간이 걸리는 시나리오가 있어 순차 실행하고 타임아웃을 넉넉히 둔다.
 * 실행: 루트에서 `npm run test:engine` (먼저 `npm run build:engine`).
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'engine',
    root: __dirname,
    environment: 'node',
    include: ['**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
