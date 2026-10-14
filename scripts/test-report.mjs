#!/usr/bin/env node
/**
 * 테스트 층별 수·시간 보고. 각 층을 실제로 돌리고(JSON 리포터) 통과·실패·건너뜀·flaky·예상 실패 수와 시간을 마크다운 표로
 * 찍는다(docs/session-log.md 에 그대로 붙일 수 있게). 하나라도 실패하면 종료 코드 1.
 *
 *   node scripts/test-report.mjs                      # unit, engine, web, desktop
 *   node scripts/test-report.mjs --layers unit,web    # 일부만
 *   node scripts/test-report.mjs --json out.json      # 원자료도 저장
 *
 * 층: unit(packages/editor vitest) · engine(packages/engine/tests vitest, 빌드된 .node·wasm 필요) · web(apps/web Playwright, 두 뷰포트)
 *     · desktop(apps/desktop Playwright, 빌드된 out/ 과 xvfb-run 필요) · rust(cargo test, 기본 제외: --layers 에 적어야 돈다)
 * 전제·포트·xvfb 는 docs/guides/testing.md.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_LAYERS = ['unit', 'engine', 'web', 'desktop'];

function parseArgs(argv) {
  const out = { layers: DEFAULT_LAYERS, json: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--layers') out.layers = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (a.startsWith('--layers=')) out.layers = a.slice(9).split(',').filter(Boolean);
    else if (a === '--json') out.json = argv[++i] ?? null;
    else if (a.startsWith('--json=')) out.json = a.slice(7);
    else if (a === '-h' || a === '--help') {
      console.log('사용: node scripts/test-report.mjs [--layers unit,engine,web,desktop,rust] [--json out.json]');
      process.exit(0);
    }
  }
  return out;
}

/** 명령을 돌리고 경과 시간(초)과 종료 코드를 돌려준다. 출력은 그대로 터미널로 */
function run(cmd, args, env = {}) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' });
  return { seconds: (Date.now() - t0) / 1000, code: r.status ?? 1, error: r.error?.message ?? null };
}

const empty = () => ({ passed: 0, failed: 0, skipped: 0, flaky: 0, expectedFail: 0 });

/** vitest JSON 리포터 결과 집계. 예상 실패(it.fails)는 JSON 에 구분이 없어 제목의 "알려진 실패" 표식으로 센다 */
function vitestLayer(name, config, extraArgs = []) {
  const dir = mkdtempSync(join(tmpdir(), 'sh-test-report-'));
  const file = join(dir, 'vitest.json');
  const args = ['vitest', 'run', '--config', config, '--reporter=default', '--reporter=json', `--outputFile=${file}`, ...extraArgs];
  const r = run('npx', args);
  const counts = empty();
  let files = 0;
  if (existsSync(file)) {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    files = j.numTotalTestSuites ? (j.testResults?.length ?? 0) : 0;
    for (const f of j.testResults ?? []) {
      for (const t of f.assertionResults ?? []) {
        const known = /알려진 실패/.test(t.fullName ?? t.title ?? '');
        if (t.status === 'passed') {
          counts.passed += 1;
          if (known) counts.expectedFail += 1;
        } else if (t.status === 'failed') counts.failed += 1;
        else counts.skipped += 1;
      }
    }
  }
  rmSync(dir, { recursive: true, force: true });
  return { name, command: `npx ${args.slice(0, 4).join(' ')}`, files, ...counts, seconds: r.seconds, code: r.code, error: r.error };
}

/** Playwright JSON 리포터 결과 집계(프로젝트별 수도 함께). expectedStatus 가 failed 인 테스트는 예상 실패 */
function playwrightLayer(name, config, prefix = [], projectArgs = []) {
  const dir = mkdtempSync(join(tmpdir(), 'sh-test-report-'));
  const file = join(dir, 'playwright.json');
  const args = [...prefix, 'npx', 'playwright', 'test', '-c', config, '--reporter=list,json', ...projectArgs];
  const r = run(args[0], args.slice(1), { PLAYWRIGHT_JSON_OUTPUT_NAME: file });
  const counts = empty();
  const projects = {};
  let files = 0;
  if (existsSync(file)) {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    const walk = (suite) => {
      if (suite.file && !suite.parent) files += 1;
      for (const spec of suite.specs ?? []) {
        for (const t of spec.tests ?? []) {
          const p = (projects[t.projectName] ??= empty());
          const bump = (k) => {
            counts[k] += 1;
            p[k] += 1;
          };
          if (t.expectedStatus === 'failed') bump('expectedFail');
          if (t.status === 'expected') bump('passed');
          else if (t.status === 'flaky') bump('flaky');
          else if (t.status === 'skipped') bump('skipped');
          else bump('failed');
        }
      }
      for (const s of suite.suites ?? []) walk(s);
    };
    files = (j.suites ?? []).length;
    for (const s of j.suites ?? []) walk(s);
  }
  rmSync(dir, { recursive: true, force: true });
  return { name, command: args.join(' '), files, ...counts, projects, seconds: r.seconds, code: r.code, error: r.error };
}

/** cargo test(바인딩 워크스페이스). "test result:" 줄을 세려고 출력을 잡는다 */
function rustLayer() {
  const args = ['test', '--manifest-path', 'packages/engine/Cargo.toml', '--workspace'];
  const t0 = Date.now();
  const r = spawnSync('cargo', args, { cwd: ROOT, encoding: 'utf8', env: process.env });
  process.stdout.write(r.stdout ?? '');
  process.stderr.write(r.stderr ?? '');
  const counts = empty();
  for (const m of (r.stdout ?? '').matchAll(/test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/g)) {
    counts.passed += Number(m[1]);
    counts.failed += Number(m[2]);
    counts.skipped += Number(m[3]);
  }
  return {
    name: 'rust',
    command: `cargo ${args.join(' ')}`,
    files: 0,
    ...counts,
    seconds: (Date.now() - t0) / 1000,
    code: r.status ?? 1,
    error: r.error?.message ?? null,
  };
}

function layer(name) {
  switch (name) {
    case 'unit':
      return vitestLayer('unit', 'packages/editor/vitest.config.ts');
    case 'engine':
      return vitestLayer('engine', 'packages/engine/tests/vitest.config.ts');
    case 'web':
      return playwrightLayer('web', 'apps/web/playwright.config.ts');
    case 'desktop': {
      if (!existsSync(join(ROOT, 'apps/desktop/out/main/index.js'))) {
        return {
          name: 'desktop',
          command: '(빌드된 앱 없음: npm run build -w apps/desktop)',
          files: 0,
          ...empty(),
          seconds: 0,
          code: 1,
          error: 'out/main/index.js 없음',
        };
      }
      const prefix = process.platform === 'linux' && !process.env.DISPLAY ? ['xvfb-run', '-a'] : [];
      return playwrightLayer('desktop', 'apps/desktop/playwright.config.ts', prefix);
    }
    case 'rust':
      return rustLayer();
    default:
      throw new Error(`모르는 층: ${name} (unit, engine, web, desktop, rust)`);
  }
}

function fmtSeconds(s) {
  return s >= 60 ? `${Math.floor(s / 60)}분 ${Math.round(s % 60)}초` : `${s.toFixed(1)}초`;
}

function table(results) {
  const rows = ['| 층 | 파일 | 통과 | 실패 | 건너뜀 | flaky | 예상 실패 | 시간 | 결과 |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |'];
  const total = { files: 0, ...empty(), seconds: 0 };
  for (const r of results) {
    const label = { unit: '단위(editor)', engine: '엔진 기능(napi·wasm)', web: '웹 e2e', desktop: '데스크톱 e2e', rust: 'Rust(cargo test)' }[r.name] ?? r.name;
    rows.push(
      `| ${label} | ${r.files} | ${r.passed} | ${r.failed} | ${r.skipped} | ${r.flaky} | ${r.expectedFail} | ${fmtSeconds(r.seconds)} | ${r.code === 0 ? '통과' : `실패(exit ${r.code}${r.error ? `, ${r.error}` : ''})`} |`,
    );
    for (const [p, c] of Object.entries(r.projects ?? {})) {
      rows.push(`| ${label} / ${p} | | ${c.passed} | ${c.failed} | ${c.skipped} | ${c.flaky} | ${c.expectedFail} | | |`);
    }
    for (const k of Object.keys(total)) total[k] += r[k] ?? 0;
  }
  rows.push(
    `| 합계 | ${total.files} | ${total.passed} | ${total.failed} | ${total.skipped} | ${total.flaky} | ${total.expectedFail} | ${fmtSeconds(total.seconds)} | |`,
  );
  return rows.join('\n');
}

const { layers, json } = parseArgs(process.argv.slice(2));
const results = [];
for (const name of layers) {
  console.log(`\n== ${name} ==`);
  results.push(layer(name));
}
const md = table(results);
console.log(`\n테스트 보고 (${new Date().toISOString().slice(0, 10)}, ${process.platform}, node ${process.version})\n\n${md}`);
if (json) writeFileSync(json, JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
