#!/usr/bin/env node
/**
 * 이식 엔진의 MCP 서버(`filmcraft-cli mcp`, stdio)를 .mcp.json 에서 띄우는 얇은 래퍼. 에이전트가 화면 없이 엔진 커맨드를
 * 실행·검증할 때 쓴다(CLAUDE.md 하네스 표). CLI 는 빌드 산출물이라 저장소에 없다:
 *   cd packages/engine/vendor/filmcraft && cargo build -p filmcraft-cli --release
 * (scripts/workflow-regression.mjs 가 처음 돌 때도 같은 빌드를 한다.) 빌드가 없으면 안내만 찍고 0 으로 끝내 서버가 비활성이
 * 된다(Claude Code 는 연결 실패로 표시하고 다른 MCP 서버는 그대로 쓴다). 경로는 FILMCRAFT_CLI 로 바꿀 수 있고,
 * FILMCRAFT_MCP_ARGS 로 인자를 더한다(예: "--demo" 는 내장 데모 프로젝트를 연 채로 시작).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI =
  process.env['FILMCRAFT_CLI'] ??
  join(ROOT, 'packages', 'engine', 'vendor', 'filmcraft', 'target', 'release', process.platform === 'win32' ? 'filmcraft-cli.exe' : 'filmcraft-cli');

if (!existsSync(CLI)) {
  console.error(`filmcraft MCP: CLI 가 없어 비활성 상태입니다 (${CLI}). 빌드: cd packages/engine/vendor/filmcraft && cargo build -p filmcraft-cli --release`);
  process.exit(0);
}

const extra = (process.env['FILMCRAFT_MCP_ARGS'] ?? '').split(/\s+/).filter(Boolean);
const child = spawn(CLI, ['mcp', ...extra], { stdio: 'inherit', env: process.env });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
