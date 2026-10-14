/**
 * 웹 세션 하나의 자동 저장·복구 상태(모듈 싱글턴). 프로젝트 store 가 startAutosave 에서 시작하고, 복구·저장 때 부른다.
 * 순수 로직은 web-files.ts, 대화상자는 web-store.ts / WebFilesDialog.tsx.
 */
import type { EngineBridge, OpfsStore } from '../../engine/bridge';
import type { RecoveryCandidate } from './store';
import {
  WEB_RECOVERY_PREFIX,
  WebAutosave,
  discardWebRecovery,
  isWebFiles,
  listRecoveryCandidates,
  readRecoveryMeta,
  recoveryEnginePath,
  type WebAutosaveOptions,
} from './web-files';

let autosave: WebAutosave | null = null;
/** 복구한 뒤 아직 저장하지 않은 상태: 저장 때 이 이름(projects/<이름>)으로 가고, 저장되면 스냅샷을 지운다 */
let pending: { name: string; recoveryId: string } | null = null;

export function webAutosave(): WebAutosave | null {
  return autosave;
}

/** 웹 자동 저장을 시작한다(이미 돌고 있으면 그대로). 테스트는 opts 로 주기·타이머를 바꾼다 */
export function startWebSession(bridge: EngineBridge & { opfs: OpfsStore }, opts?: WebAutosaveOptions): WebAutosave {
  if (autosave) return autosave;
  autosave = new WebAutosave(bridge, opts);
  autosave.start();
  return autosave;
}

/** 테스트·재연결용 */
export function stopWebSession(): void {
  autosave?.stop();
  autosave = null;
  pending = null;
}

/** 다른 세션이 남긴 복구 후보 */
export async function webRecoveryCandidates(bridge: EngineBridge): Promise<RecoveryCandidate[]> {
  if (!isWebFiles(bridge)) return [];
  return listRecoveryCandidates(bridge.opfs, autosave?.session ?? '');
}

/** 스냅샷을 연다. 저장은 원래 이름으로 가도록 적어 둔다(스냅샷은 저장될 때 지운다) */
export async function recoverWeb(bridge: EngineBridge, id: string): Promise<{ name: string; savedAt: string }> {
  if (!isWebFiles(bridge)) throw new Error('이 환경에서는 복구를 지원하지 않습니다');
  const session = id.slice(WEB_RECOVERY_PREFIX.length);
  const meta = await readRecoveryMeta(bridge.opfs, session);
  if (!meta) throw new Error('복구 스냅샷을 읽을 수 없습니다');
  await bridge.execute('file.open', { path: recoveryEnginePath(meta) });
  pending = { name: meta.projectName, recoveryId: id };
  const d = new Date(meta.savedUnix);
  const two = (n: number) => String(n).padStart(2, '0');
  return { name: meta.projectName, savedAt: `${two(d.getHours())}:${two(d.getMinutes())}` };
}

export async function discardWeb(bridge: EngineBridge, id: string): Promise<void> {
  if (!isWebFiles(bridge)) return;
  await discardWebRecovery(bridge.opfs, id);
  if (pending?.recoveryId === id) pending = null;
}

/** 복구 뒤 저장 때 써야 할 이름. 없으면 null */
export function webSaveRedirect(): string | null {
  return pending?.name ?? null;
}

/** 저장이 끝났을 때: 복구 스냅샷과 이 세션의 자동 저장 스냅샷을 지운다 */
export async function afterWebSave(bridge: EngineBridge): Promise<void> {
  if (!isWebFiles(bridge)) return;
  if (pending) {
    await discardWebRecovery(bridge.opfs, pending.recoveryId).catch(() => undefined);
    pending = null;
  }
  await autosave?.clear();
}
