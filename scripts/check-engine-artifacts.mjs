#!/usr/bin/env node
// 엔진 빌드 산출물(napi .node·타입, wasm pkg, 음성 wasm pkg)이 있는지 보고, 없으면 무엇을 하면 되는지 알려 준다.
// 새 git worktree 는 이 파일들(gitignore)이 비어 있어 typecheck·웹 빌드·엔진 테스트가 알 수 없는 오류로 실패한다.
//   node scripts/check-engine-artifacts.mjs            전부(엔진 테스트·웹 빌드 전)
//   node scripts/check-engine-artifacts.mjs --types    타입 파일만(typecheck 앞에서 쓴다)
// 다른 워크트리(보통 main)에 산출물이 있으면 복사 명령도 찍는다. 종료 코드: 모두 있으면 0, 하나라도 없으면 1.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const typesOnly = process.argv.includes('--types');
const nodeFile = `engine-node.${process.platform}-${process.arch}${process.platform === 'linux' ? '-gnu' : process.platform === 'win32' ? '-msvc' : ''}.node`;

/** [경로, 타입 파일인지, 다시 만드는 명령] */
const ARTIFACTS = [
  ['packages/engine/bindings/napi/index.d.ts', true, 'npm run build:engine:node'],
  ['packages/engine/bindings/napi/index.js', false, 'npm run build:engine:node'],
  [`packages/engine/bindings/napi/${nodeFile}`, false, 'npm run build:engine:node'],
  ['packages/engine/bindings/wasm/pkg/sh_video_engine_wasm.d.ts', true, 'npm run build:engine:wasm'],
  ['packages/engine/bindings/wasm/pkg/sh_video_engine_wasm_bg.wasm', false, 'npm run build:engine:wasm'],
  ['packages/engine/bindings/speech-wasm/pkg/sh_video_speech_wasm.d.ts', true, 'npm run build:engine:speech'],
  ['packages/engine/bindings/speech-wasm/pkg/sh_video_speech_wasm_bg.wasm', false, 'npm run build:engine:speech'],
];

const wanted = ARTIFACTS.filter(([, types]) => !typesOnly || types);
const missing = wanted.filter(([p]) => !existsSync(join(root, p)));
if (missing.length === 0) process.exit(0);

/** 산출물이 다 있는 다른 워크트리(복사 원본 후보) */
function donorWorktree() {
  try {
    const out = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' });
    const trees = out
      .split('\n')
      .filter((l) => l.startsWith('worktree '))
      .map((l) => l.slice('worktree '.length));
    return trees.find((t) => t !== root && missing.every(([p]) => existsSync(join(t, p)))) ?? null;
  } catch {
    return null;
  }
}

console.error(`엔진 산출물이 없습니다 (${missing.length}개). 새 워크트리면 빌드하거나 다른 워크트리에서 복사하세요.`);
for (const [p] of missing) console.error(`  없음: ${p}`);
const builds = [...new Set(missing.map(([, , cmd]) => cmd))];
console.error(`빌드(Rust 컴파일, 몇 분): ${builds.join(' && ')}`);
const donor = donorWorktree();
if (donor) {
  const dirs = [...new Set(missing.map(([p]) => (p.includes('/pkg/') ? p.slice(0, p.indexOf('/pkg/') + 4) : dirname(p))))];
  console.error(`복사(빠름, 같은 커밋의 엔진일 때만): 원본 ${relative(root, donor) || donor}`);
  for (const d of dirs) {
    if (d.endsWith('/pkg')) console.error(`  mkdir -p ${dirname(d)} && cp -r "${join(donor, d)}" ${dirname(d)}/`);
    else console.error(`  cp "${join(donor, d)}"/index.js "${join(donor, d)}"/index.d.ts "${join(donor, d)}"/*.node ${d}/`);
  }
}
process.exit(1);
