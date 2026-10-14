/**
 * 웹 내보내기 결과 수신. wasm 엔진은 파일시스템이 없어 내보내기 결과를 메모리에 만든 뒤 write_file 로 넘기므로,
 * 화면이 `onFileWritten` 으로 바이트를 받아 Blob 다운로드로 떨어뜨린다(파일명 = 프로젝트 이름.mp4). 구독자가 있는 동안
 * 바이트는 콜백으로만 오고, 혹시 못 받았으면 `takeWrittenFile` 로 한 번 더 꺼내 본다.
 */
import type { EngineBridge } from '../../engine/bridge';
import { downloadBytes } from '../project/web-files';

/** 웹 내보내기 흐름을 쓰는 호스트인지(저장 대화상자가 없고 쓰기 알림이 있다) */
export function isWebExport(bridge: EngineBridge | null | undefined): boolean {
  return Boolean(bridge && !bridge.pickSavePath && bridge.onFileWritten);
}

/** 엔진 쪽 출력 경로(가상 파일 공간) */
export function webExportPath(fileName: string): string {
  return `/exports/${fileName.replace(/[/\\]/g, '_')}`;
}

export interface WrittenCapture {
  /** 엔진이 그 경로에 쓴 바이트. 구독을 풀기 전에 안 왔으면 takeWrittenFile 로 시도하고, 그래도 없으면 null */
  take(): Promise<Uint8Array | null>;
  dispose(): void;
}

/** 내보내기를 시작하기 전에 구독해 둔다 */
export function captureWrittenFile(bridge: EngineBridge, path: string): WrittenCapture {
  let bytes: Uint8Array | null = null;
  let waiting: ((b: Uint8Array | null) => void) | null = null;
  const unsubscribe =
    bridge.onFileWritten?.((p, b) => {
      if (p !== path) return;
      bytes = b;
      waiting?.(b);
      waiting = null;
    }) ?? (() => undefined);
  let disposed = false;
  return {
    async take() {
      if (bytes) return bytes;
      // 완료 알림과 쓰기 알림의 순서가 어긋날 수 있어 잠깐 기다린다
      const late = await new Promise<Uint8Array | null>((resolve) => {
        waiting = resolve;
        setTimeout(() => {
          if (waiting === resolve) {
            waiting = null;
            resolve(null);
          }
        }, 500);
      });
      if (late) return late;
      if (disposed) return null;
      return bridge.takeWrittenFile ? bridge.takeWrittenFile(path) : null;
    },
    dispose() {
      disposed = true;
      unsubscribe();
    },
  };
}

/** 테스트용: 다운로드를 바꿔 끼운다 */
export const exportDownload = { fn: downloadBytes };

export function downloadExport(fileName: string, bytes: Uint8Array): void {
  const lower = fileName.toLowerCase();
  const mime = lower.endsWith('.mp4') ? 'video/mp4' : lower.endsWith('.webm') ? 'video/webm' : 'application/octet-stream';
  exportDownload.fn(fileName, bytes, mime);
}
