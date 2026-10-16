/**
 * 같은 읽기 커맨드가 동시에 여러 번 나가면 하나만 엔진에 보내고 결과를 나눠 준다(docs/guides/performance-audit.md).
 *
 * 커맨드 하나 뒤에 여러 store 가 한꺼번에 다시 읽는다: 타임라인과 모니터가 각각 `sequence.inspect`, 미디어와 프로젝트 store 가
 * 각각 `project.inspect`. 엔진(Worker·utility process)은 요청을 받은 순서대로 처리하므로, 같은 읽기가 아직 끝나지 않았고 그 뒤로
 * 상태를 바꿀 수 있는 호출이 하나도 나가지 않았다면 두 번째 요청의 답은 첫 번째와 같다. 그때만 첫 요청의 promise 에 붙는다.
 * 상태를 바꿀 수 있는 호출(읽기 목록 밖의 execute, undo, redo, setPlayhead, 파일 등록 등)이 나가면 epoch 가 올라 그 전의 읽기에는
 * 더 이상 붙지 않는다. 뒤에 붙은 쪽은 결과의 복사본을 받는다(한쪽이 결과 객체를 고쳐도 다른 쪽에 번지지 않게).
 */
import type { EngineBridge } from './bridge';

/** 프로젝트를 바꾸지 않는 읽기 커맨드. 여기 없는 커맨드는 늘 그대로 보낸다 */
export const READ_COMMANDS: ReadonlySet<string> = new Set([
  'sequence.inspect',
  'project.inspect',
  'project.items',
  'media.status',
  'captions.list',
  'fonts.list',
  'effects.list',
  'effects.keyframes',
  'export.formats',
  'export.presets.list',
  'history.list',
  'transcript.inspect',
]);

/** 상태를 바꾸지 않는 bridge 메서드(epoch 를 올리지 않는다) */
const PURE_METHODS: ReadonlySet<string> = new Set([
  'version',
  'commands',
  'playhead',
  'renderFrame',
  'renderAudio',
  'audioPeaks',
  'renderItemThumbnail',
  'isDirty',
  'isEnabled',
]);

export interface CoalesceStats {
  /** 엔진에 보낸 읽기 */
  sent: number;
  /** 진행 중인 같은 읽기에 붙은 수(엔진에 보내지 않음) */
  joined: number;
}

const clone: <T>(v: T) => T = typeof structuredClone === 'function' ? (v) => structuredClone(v) : (v) => JSON.parse(JSON.stringify(v)) as typeof v;

/** bridge 를 감싼다(Proxy: 객체 리터럴·클래스 인스턴스 모두). 함수가 아닌 속성(cache, stt, templates 등)은 그대로 보인다 */
export function coalesceReads(bridge: EngineBridge, stats: CoalesceStats = { sent: 0, joined: 0 }): EngineBridge {
  let epoch = 0;
  const inflight = new Map<string, { epoch: number; promise: Promise<unknown> }>();
  /** 원래 함수 -> 감싼 함수(테스트가 메서드를 바꿔 끼우면 새 함수라 새로 감싼다) */
  const wrapped = new WeakMap<object, unknown>();

  const execute = (id: string, params?: Record<string, unknown>): Promise<unknown> => {
    if (!READ_COMMANDS.has(id)) {
      epoch += 1;
      return bridge.execute(id, params);
    }
    const key = `${id}\u0000${params === undefined ? '' : JSON.stringify(params)}`;
    const running = inflight.get(key);
    if (running && running.epoch === epoch) {
      stats.joined += 1;
      return running.promise.then(clone);
    }
    stats.sent += 1;
    const promise = bridge.execute(id, params);
    const entry = { epoch, promise };
    inflight.set(key, entry);
    const done = () => {
      if (inflight.get(key) === entry) inflight.delete(key);
    };
    promise.then(done, done);
    return promise;
  };

  return new Proxy(bridge, {
    get(target, prop, receiver) {
      if (prop === 'execute') return execute;
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== 'function') return value;
      let fn = wrapped.get(value as object);
      if (!fn) {
        const bound = (value as (...a: unknown[]) => unknown).bind(target);
        fn =
          typeof prop === 'string' && PURE_METHODS.has(prop)
            ? bound
            : (...args: unknown[]) => {
                epoch += 1;
                return bound(...args);
              };
        wrapped.set(value as object, fn);
      }
      return fn;
    },
  });
}
