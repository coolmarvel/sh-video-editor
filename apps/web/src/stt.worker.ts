/// <reference lib="webworker" />
// 웹 자동 자막의 음성 Worker. 엔진 Worker 와 따로 돈다: 인식은 30초 소리에 십수 초 걸리는 동기 계산이라 엔진 Worker 에서
// 돌리면 그동안 미리보기·편집이 멈춘다. 이 Worker 는 음성 wasm(packages/engine/bindings/speech-wasm, Whisper 만 담은 1.3MB)을 쓴다.
//
// - models: 웹에서 쓸 수 있는 모델(tiny·base)과 설치 여부(OPFS models/<id>/ 의 파일 크기). 모양은 엔진 `transcript.models` 와 같다.
// - download: 모델 파일을 Hugging Face 고정 리비전에서 받아 OPFS 에 바로 쓰며 조각 단위 SHA-256 으로 검증한다(어긋나면 지운다).
// - transcribe: 엔진 Worker 가 꺼낸 모노 16 kHz 소리를 인식해 엔진 Transcript 객체를 돌려준다. 모델은 열어 두고 다시 쓴다.
// - release: 연 모델을 놓는다.
// 진행률은 { event: 'progress' } 메시지로 바로 보내고, 취소는 메인이 SharedArrayBuffer 의 칸을 1 로 바꾸는 것으로 받는다.
import init, { SpeechModel, Sha256Stream, WeightsBuffer, webModels } from '@speech/sh_video_speech_wasm.js';
import * as opfs from './opfs';
import { errorMessage } from '@editor/errors';

type Req = { id: number; method: string; args: unknown[] };
type Res = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
export type SttWorkerProgress = { event: 'progress'; fraction: number; done: number; total: number; status: string };

interface WebModelFile {
  name: string;
  url: string;
  sha256: string;
  size: number;
}
interface WebModel {
  id: string;
  name: string;
  multilingual: boolean;
  description: string;
  license: string;
  source: string;
  size: number;
  files: WebModelFile[];
}

const port = self as unknown as Worker;
const DEFAULT_MODEL = 'whisper-base';
let ready: Promise<unknown> | null = null;
let loaded: { id: string; model: SpeechModel } | null = null;

function boot(): Promise<unknown> {
  ready ??= init();
  return ready;
}

function catalogue(): WebModel[] {
  return JSON.parse(webModels()) as WebModel[];
}

function find(id: string): WebModel {
  const m = catalogue().find((x) => x.id === id);
  if (!m) throw new Error(`브라우저에서 쓸 수 없는 음성 모델입니다: ${id}`);
  return m;
}

const fileRel = (m: WebModel, f: WebModelFile) => `models/${m.id}/${f.name}`;

/** 크기가 맞는 파일은 이미 받은 것(내려받기는 검증을 통과한 파일만 남긴다) */
async function hasFile(m: WebModel, f: WebModelFile): Promise<boolean> {
  const file = await opfs.getFile(fileRel(m, f));
  return file !== null && file.size === f.size;
}

async function installed(m: WebModel): Promise<boolean> {
  for (const f of m.files) if (!(await hasFile(m, f))) return false;
  return true;
}

function progress(fraction: number, done: number, total: number, status: string) {
  const msg: SttWorkerProgress = { event: 'progress', fraction, done, total, status };
  port.postMessage(msg);
}

const stopped = (cancel: Int32Array) => Atomics.load(cancel, 0) !== 0;

async function models() {
  const list = [];
  for (const m of catalogue()) {
    const { files: _files, ...rest } = m;
    list.push({ ...rest, installed: await installed(m) });
  }
  // dir: null 은 "앱 데이터 폴더가 아니라 브라우저 저장소" 라는 뜻(동의 대화상자 문구)
  return { available: true, default: DEFAULT_MODEL, dir: null, models: list };
}

async function download(id: string, cancel: Int32Array): Promise<void> {
  const m = find(id);
  const todo: WebModelFile[] = [];
  for (const f of m.files) if (!(await hasFile(m, f))) todo.push(f);
  const total = todo.reduce((n, f) => n + f.size, 0);
  let done = 0;
  let last = 0;
  for (const f of todo) {
    if (stopped(cancel)) throw new Error('stopped');
    const res = await fetch(f.url);
    if (!res.ok || !res.body) throw new Error(`${f.name}: 내려받지 못했습니다(HTTP ${res.status})`);
    const hash = new Sha256Stream();
    try {
      const n = await opfs.writeStream(fileRel(m, f), res.body, (chunk) => {
        if (stopped(cancel)) return false;
        hash.update(chunk);
        done += chunk.length;
        // 조각(수십 KB)마다 보내지 않고 256 KB 마다
        if (done - last >= 1 << 18) {
          last = done;
          progress(total > 0 ? done / total : 1, done, total, f.name);
        }
        return true;
      });
      const sha = hash.finish();
      if (n !== f.size || sha !== f.sha256) {
        await opfs.remove(fileRel(m, f));
        throw new Error(`${f.name}: 받은 파일이 손상되었습니다(크기 ${n}/${f.size}, SHA-256 불일치). 다시 시도하세요`);
      }
    } finally {
      hash.free();
    }
    progress(total > 0 ? done / total : 1, done, total, f.name);
  }
}

async function bytesOf(rel: string): Promise<Uint8Array> {
  const file = await opfs.getFile(rel);
  if (!file) throw new Error(`음성 모델 파일이 없습니다: ${rel}`);
  return new Uint8Array(await file.arrayBuffer());
}

/** 가중치 파일을 8MB 조각으로 wasm 버퍼에 붓는다(파일 전체를 JS 힙에 한 벌 더 만들지 않게) */
async function weightsOf(rel: string): Promise<WeightsBuffer> {
  const file = await opfs.getFile(rel);
  if (!file) throw new Error(`음성 모델 파일이 없습니다: ${rel}`);
  const buf = new WeightsBuffer(file.size);
  for (let at = 0; at < file.size; at += opfs.COPY_CHUNK) {
    buf.push(new Uint8Array(await file.slice(at, at + opfs.COPY_CHUNK).arrayBuffer()));
  }
  return buf;
}

async function open(id: string): Promise<SpeechModel> {
  if (loaded?.id === id) return loaded.model;
  release(); // 다른 모델을 열기 전에 이전 가중치를 먼저 놓는다
  const m = find(id);
  if (!(await installed(m))) throw new Error(`음성 모델 ${id} 이(가) 설치되지 않았습니다`);
  const dir = `models/${m.id}`;
  const weights = await weightsOf(`${dir}/model.safetensors`);
  let model: SpeechModel;
  try {
    model = SpeechModel.fromBuffer(
      id,
      await bytesOf(`${dir}/config.json`),
      await bytesOf(`${dir}/generation_config.json`),
      await bytesOf(`${dir}/tokenizer.json`),
      weights,
    );
  } finally {
    weights.free();
  }
  loaded = { id, model };
  return model;
}

function release() {
  loaded?.model.free();
  loaded = null;
}

async function transcribe(id: string, audio: Float32Array, language: string, cancel: Int32Array): Promise<unknown> {
  progress(0, 0, 1, 'Loading model');
  const model = await open(id);
  if (stopped(cancel)) throw new Error('stopped');
  const json = model.transcribe(audio, language, (fraction: number, status: string) => {
    progress(fraction, fraction, 1, status);
    return !stopped(cancel);
  });
  return JSON.parse(json) as unknown;
}

async function handle(method: string, args: unknown[]): Promise<unknown> {
  await boot();
  switch (method) {
    case 'models':
      return models();
    case 'download':
      return download(args[0] as string, args[1] as Int32Array);
    case 'transcribe':
      return transcribe(args[0] as string, args[1] as Float32Array, args[2] as string, args[3] as Int32Array);
    case 'release':
      release();
      return undefined;
    default:
      throw new Error(`알 수 없는 메서드: ${method}`);
  }
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, method, args } = e.data;
  handle(method, args)
    .then((result) => port.postMessage({ id, ok: true, result } satisfies Res))
    .catch((err: unknown) => port.postMessage({ id, ok: false, error: errorMessage(err) } satisfies Res));
};
