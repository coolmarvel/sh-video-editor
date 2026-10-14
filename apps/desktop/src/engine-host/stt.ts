/**
 * 엔진 utility process 의 자동 자막 메서드(features/stt 의 bridge.stt). 바인딩의 `downloadSpeechModel`·`transcribeItem` 은
 * libuv 스레드에서 돌고 진행률을 콜백으로 주므로, 여기서 마지막 진행 값을 들고 있다가 렌더러의 `sttProgress` 폴링에 답한다.
 * 한 번에 작업 하나만 돈다(동시 요청은 거부). 취소는 AbortController 로 바인딩에 전달된다.
 */
import * as engine from '@sh-video-editor/engine-node';

export interface SttProgress {
  fraction: number;
  done: number;
  total: number;
  status: string;
}

interface Current {
  controller: AbortController;
  progress: SttProgress;
}

let current: Current | null = null;

function begin(): Current {
  if (current) throw new Error('자동 자막 작업이 이미 진행 중입니다');
  current = { controller: new AbortController(), progress: { fraction: 0, done: 0, total: 0, status: '' } };
  return current;
}

async function run<T>(job: (c: Current) => Promise<T>): Promise<T> {
  const c = begin();
  try {
    return await job(c);
  } finally {
    if (current === c) current = null;
  }
}

export function sttMethods(getSession: () => engine.Engine) {
  return {
    sttDownloadModel: (model: string): Promise<void> =>
      run(async (c) => {
        await engine.downloadSpeechModel(
          model,
          (p: engine.SttProgress) => {
            c.progress = p;
          },
          c.controller.signal,
        );
      }),
    sttTranscribeItem: (item: number, model: string, language: string): Promise<unknown> =>
      run(async (c) => {
        const json = await getSession().transcribeItem(
          item,
          model,
          language,
          (p: engine.SttProgress) => {
            c.progress = p;
          },
          c.controller.signal,
        );
        return JSON.parse(json) as unknown;
      }),
    sttProgress: (): SttProgress | null => (current ? { ...current.progress } : null),
    sttCancel: (): void => {
      current?.controller.abort();
    },
    sttReleaseModel: (): void => {
      engine.releaseSpeechModel();
    },
  };
}
