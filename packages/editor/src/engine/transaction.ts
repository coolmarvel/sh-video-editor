/**
 * 묶음 실행 취소. 엔진 `edit.beginTransaction {label}` 과 `edit.endTransaction` 사이의 편집은 실행 취소 한 단계가 된다.
 * body 가 던지면 `edit.cancelTransaction` 으로 처음 상태로 되돌리고 다시 던진다. 중첩되면 바깥 것이 하나의 단계다(엔진 규칙).
 * 편집 의미는 넣지 않는다.
 */
import type { EngineBridge } from './bridge';

export async function withTransaction<T>(bridge: EngineBridge, label: string, body: () => Promise<T>): Promise<T> {
  await bridge.execute('edit.beginTransaction', { label });
  try {
    const r = await body();
    await bridge.execute('edit.endTransaction');
    return r;
  } catch (e) {
    await bridge.execute('edit.cancelTransaction').catch(() => undefined);
    throw e;
  }
}
