#!/usr/bin/env node
/**
 * 워크플로 회귀 테스트(M4-1). 이식 엔진의 헤드리스 CLI(filmcraft-cli `run script.jsonl`)로 사용자의 기본 흐름을 처음부터 끝까지
 * 돌리고 결과 MP4 를 ffprobe 로 검사한다. 화면·바인딩을 거치지 않으므로 엔진 자체의 회귀(전환이 트림을 안 따라감 등)를 잡는다.
 *
 *   가져오기(데모 3클립) -> 타임라인에 놓기(3초씩) -> 자르기 -> 전환(크로스 디졸브) -> 자막(자막 트랙 + 자막 하나) ->
 *   음악(A2 에 소리 클립, 종류 music) -> 저장 -> 다시 열기 -> 내보내기(H.264 1280x720, 9초)
 *
 * 두 단계로 돈다. 1단계가 만든 항목·클립 id 를 결과 JSONL 에서 읽어 2단계 스크립트를 만든다(id 를 미리 알 수 없다). 1단계는
 * 프로젝트를 .fcproj 로 저장하고 2단계는 그것을 열어 이어 가므로 저장·열기 왕복도 함께 검사한다.
 *
 *   node scripts/workflow-regression.mjs            # 필요하면 filmcraft-cli 를 빌드한다(release, 한 번 3~4분)
 *   node scripts/workflow-regression.mjs --no-build # 빌드된 CLI 가 없으면 실패
 *   node scripts/workflow-regression.mjs --keep     # 임시 디렉토리(스크립트·프로젝트·MP4)를 남기고 경로를 찍는다
 *   node scripts/workflow-regression.mjs --json out.json
 *
 * CLI 경로: FILMCRAFT_CLI 환경 변수, 없으면 packages/engine/vendor/filmcraft/target/release/filmcraft-cli.
 * ffprobe 가 없으면 스트림 검사는 건너뛰고 파일 크기·프레임 수만 본다(CI 의 engine job 에는 ffmpeg 가 있다).
 * 종료 코드: 0 통과, 1 실패. 단계별 시간을 찍는다(npm run verify 포함 기준 60초, docs/guides/testing.md).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'packages', 'engine', 'vendor', 'filmcraft');
const CLI = process.env['FILMCRAFT_CLI'] ?? join(VENDOR, 'target', 'release', process.platform === 'win32' ? 'filmcraft-cli.exe' : 'filmcraft-cli');

/** 엔진 시간 단위(초당 tick) */
const T = 254_016_000_000;
const CLIP_SECONDS = 3;
const SCENES = ['OceanSunset', 'Aurora', 'CityNight'];
const EXPECTED_SECONDS = CLIP_SECONDS * SCENES.length;
const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;

function parseArgs(argv) {
  const out = { build: true, keep: false, json: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--no-build') out.build = false;
    else if (a === '--keep') out.keep = true;
    else if (a === '--json') out.json = argv[++i] ?? null;
    else if (a.startsWith('--json=')) out.json = a.slice(7);
    else if (a === '-h' || a === '--help') {
      console.log('사용: node scripts/workflow-regression.mjs [--no-build] [--keep] [--json out.json]');
      process.exit(0);
    }
  }
  return out;
}

class Failure extends Error {}

const timings = [];
/** 단계 하나를 재서 기록한다 */
async function step(name, fn) {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    const seconds = (performance.now() - t0) / 1000;
    timings.push({ name, seconds });
    console.log(`[workflow] ${name}: ${seconds.toFixed(1)}s`);
  }
}

function ensureCli(build) {
  if (existsSync(CLI)) return;
  if (!build) throw new Failure(`filmcraft-cli 가 없습니다: ${CLI} (cargo build -p filmcraft-cli --release, 또는 --no-build 를 빼세요)`);
  console.log(`[workflow] filmcraft-cli 빌드: ${CLI}`);
  const r = spawnSync('cargo', ['build', '-p', 'filmcraft-cli', '--release'], { cwd: VENDOR, stdio: 'inherit', env: process.env });
  if (r.status !== 0 || !existsSync(CLI)) throw new Failure('filmcraft-cli 빌드 실패');
}

/** JSONL 스크립트를 돌리고 줄마다의 결과({line, id, ok, result|error})를 돌려준다. 실패한 줄이 있으면 Failure */
function runScript(name, dir, lines, extraArgs = []) {
  const path = join(dir, `${name}.jsonl`);
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  const r = spawnSync(CLI, ['run', path, '--compact', '--keep-going', ...extraArgs], {
    cwd: dir,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const rows = r.stdout
    .split('\n')
    .filter((l) => l.trim().startsWith('{'))
    .map((l) => JSON.parse(l));
  const failed = rows.filter((x) => !x.ok);
  if (failed.length > 0 || r.status !== 0) {
    const detail = failed.map((f) => `  ${f.line}: ${f.id}: ${f.error}`).join('\n');
    throw new Failure(`${name}: 커맨드 실패 (exit ${r.status})\n${detail}\n${r.stderr}`);
  }
  return rows;
}

const result = (rows, id, nth = 0) => rows.filter((x) => x.id === id)[nth]?.result;

function ffprobe(path) {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,sample_rate,channels', '-of', 'json', path],
      { encoding: 'utf8' },
    );
    return JSON.parse(out);
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') return null;
    throw new Failure(`ffprobe 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function check(cond, message) {
  if (!cond) throw new Failure(message);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const started = performance.now();
  const dir = mkdtempSync(join(tmpdir(), 'sh-workflow-'));
  const project = join(dir, 'workflow.fcproj');
  const mp4 = join(dir, 'workflow.mp4');
  const summary = { ok: false, cli: CLI, dir, timings, export: null, probe: null };
  try {
    await step('CLI 준비', () => ensureCli(args.build));

    // 1단계: 프로젝트 만들기 -> 가져오기 -> 놓기 -> 자르기 -> 자막 -> 음악 클립. 끝에 저장
    const phase1 = await step('1단계 편집(가져오기, 놓기, 자르기, 자막, 음악)', () => {
      const lines = [
        { id: 'file.newProject', params: { name: '워크플로 회귀' } },
        { id: 'file.newSequence', params: { name: '편집본', width: WIDTH, height: HEIGHT, fps: FPS } },
        ...SCENES.map((scene) => ({ id: 'file.importDemoFootage', params: { scene } })),
        { id: 'project.inspect' },
      ];
      const rows = runScript('phase1-import', dir, lines, ['--save-as', project]);
      const items = SCENES.map((_, i) => result(rows, 'file.importDemoFootage', i)?.items?.[0]);
      check(
        items.every((x) => typeof x === 'number'),
        `데모 항목 id 를 읽지 못했습니다: ${JSON.stringify(items)}`,
      );
      const inspect = result(rows, 'project.inspect');
      check(inspect?.root?.children?.length === SCENES.length + 1, '프로젝트에 편집본 1개와 데모 3개가 있어야 합니다');

      const edit = [
        ...items.map((item, i) => ({
          id: 'timeline.place',
          params: { item, track: 'V1', seconds: i * CLIP_SECONDS, insert: true, duration: CLIP_SECONDS * T },
        })),
        // 둘째 클립 가운데를 자른다(모든 트랙). 영상·소리 클립 하나씩 둘로
        { id: 'timeline.razor', params: { seconds: CLIP_SECONDS * 1.5 } },
        { id: 'captions.newTrack', params: { format: 'Subtitle', name: '자막' } },
        { id: 'captions.add', params: { track: 'C1', text: '워크플로 회귀 자막', seconds: 0.5, durationSeconds: 2 } },
        // 음악: 첫 데모의 소리를 A2 에 전체 길이로 한 번 더
        { id: 'timeline.place', params: { item: items[0], track: 'A2', seconds: 0, insert: false, duration: EXPECTED_SECONDS * T } },
        { id: 'sequence.inspect' },
      ];
      const rows2 = runScript('phase1-edit', dir, edit, ['--project', project, '--save']);
      const razor = result(rows2, 'timeline.razor');
      check(razor?.cuts === 2, `자르기는 영상·소리 2곳이어야 합니다: ${JSON.stringify(razor)}`);
      const placed = rows2.filter((x) => x.id === 'timeline.place').map((x) => x.result.clips);
      const seq = result(rows2, 'sequence.inspect');
      check(seq?.duration === EXPECTED_SECONDS * T, `편집본 길이 ${EXPECTED_SECONDS}초여야 합니다: ${seq?.duration}`);
      const v1 = seq.video[0].items;
      check(v1.length === SCENES.length + 1, `V1 에 클립 ${SCENES.length + 1}개(자른 뒤): ${v1.length}`);
      const music = placed[SCENES.length]?.[0];
      check(typeof music === 'number', '음악 클립 id 를 읽지 못했습니다');
      check(seq.audio.length >= 2 && seq.audio[1].items.some((c) => c.clip === music), '음악 클립이 A2 에 있어야 합니다');
      // 전환을 걸 클립: 자른 뒤 V1 의 둘째 클립(시작 3초)
      const second = v1.find((c) => c.start === CLIP_SECONDS * T);
      check(second, 'V1 3초 위치의 클립을 찾지 못했습니다');
      return { items, music, transitionClip: second.clip, captions: seq };
    });

    // 2단계: 저장본을 열어 전환·음악 종류를 넣고 검사한 뒤 내보내기
    const exported = await step('2단계 전환, 음악 종류, 내보내기(H.264 720p)', () => {
      const lines = [
        { id: 'sequence.applyVideoTransition', params: { clip: phase1.transitionClip, effect: 'cross_dissolve', frames: 15, edge: 'in' } },
        { id: 'essentialSound.setType', params: { clips: [phase1.music], type: 'music' } },
        { id: 'sequence.inspect' },
        { id: 'captions.list' },
        { id: 'file.exportMedia', params: { path: mp4, format: 'h264', width: WIDTH, height: HEIGHT, wait: true } },
      ];
      const rows = runScript('phase2-export', dir, lines, ['--project', project]);
      const tr = result(rows, 'sequence.applyVideoTransition');
      check(typeof tr?.transition === 'number', `전환 id: ${JSON.stringify(tr)}`);
      const seq = result(rows, 'sequence.inspect');
      const transitions = seq.video[0].transitions;
      check(transitions.length === 1 && transitions[0].effect === 'cross_dissolve', `전환이 하나여야 합니다: ${JSON.stringify(transitions)}`);
      check(transitions[0].to === phase1.transitionClip, '전환이 둘째 클립의 들어오는 쪽에 있어야 합니다');
      check(seq.duration === EXPECTED_SECONDS * T, '다시 연 편집본의 길이가 같아야 합니다(저장·열기 왕복)');
      const caps = result(rows, 'captions.list');
      const captionCount = JSON.stringify(caps).split('워크플로 회귀 자막').length - 1;
      check(captionCount >= 1, `자막이 저장·열기 뒤에도 남아야 합니다: ${JSON.stringify(caps).slice(0, 200)}`);
      const ex = result(rows, 'file.exportMedia');
      check(existsSync(mp4) && statSync(mp4).size > 10_000, `MP4 가 만들어져야 합니다: ${JSON.stringify(ex)}`);
      return ex;
    });
    summary.export = exported;

    await step('ffprobe 검사', () => {
      const probe = ffprobe(mp4);
      summary.probe = probe;
      if (!probe) {
        console.log('[workflow] ffprobe 가 없어 스트림 검사를 건너뜁니다(파일 크기만 확인)');
        return;
      }
      const duration = Number(probe.format?.duration);
      check(Math.abs(duration - EXPECTED_SECONDS) <= 0.2, `길이 ${EXPECTED_SECONDS}초여야 합니다: ${duration}`);
      const video = probe.streams.filter((s) => s.codec_type === 'video');
      const audio = probe.streams.filter((s) => s.codec_type === 'audio');
      check(video.length === 1 && video[0].codec_name === 'h264', `영상 스트림 h264 하나: ${JSON.stringify(video)}`);
      check(video[0].width === WIDTH && video[0].height === HEIGHT, `${WIDTH}x${HEIGHT}: ${video[0].width}x${video[0].height}`);
      check(audio.length === 1 && audio[0].codec_name === 'aac', `소리 스트림 aac 하나: ${JSON.stringify(audio)}`);
      check(Number(audio[0].sample_rate) === 48000, `48kHz: ${audio[0].sample_rate}`);
    });

    summary.ok = true;
    const total = (performance.now() - started) / 1000;
    console.log(`[workflow] 통과: ${EXPECTED_SECONDS}초 ${WIDTH}x${HEIGHT} H.264/AAC, ${(statSync(mp4).size / 1024).toFixed(0)}KB, 총 ${total.toFixed(1)}s`);
    if (total > 60) console.log('[workflow] 60초를 넘었습니다. docs/guides/testing.md 의 기준대로 verify 에서 빼고 CI job 으로만 돌리는 것을 검토하세요');
  } catch (e) {
    summary.ok = false;
    summary.error = e instanceof Error ? e.message : String(e);
    console.error(`[workflow] 실패: ${summary.error}`);
    if (!(e instanceof Failure) && e instanceof Error && e.stack) console.error(e.stack);
    process.exitCode = 1;
  } finally {
    summary.totalSeconds = (performance.now() - started) / 1000;
    if (args.json) writeFileSync(args.json, `${JSON.stringify(summary, null, 2)}\n`);
    if (args.keep || !summary.ok) console.log(`[workflow] 산출물: ${dir}`);
    else rmSync(dir, { recursive: true, force: true });
  }
}

void main();
