/** 메모리 TemplateStore. 호스트 저장소(bridge.templates)가 없는 곳(테스트, 지원하지 않는 호스트)에서 같은 인터페이스로 돈다. 세션이 끝나면 사라진다. */
import type { StoredTemplate, TemplateStore } from '../../engine/bridge';

export class MemoryTemplateStore implements TemplateStore {
  readonly rows = new Map<string, StoredTemplate>();
  /** 진단: 호출 횟수 */
  readonly hits = { list: 0, put: 0, remove: 0 };

  async list(): Promise<StoredTemplate[]> {
    this.hits.list += 1;
    return [...this.rows.values()].map((r) => ({ template: structuredClone(r.template), thumb: r.thumb }));
  }

  async put(id: string, template: unknown, thumb: Uint8Array | null): Promise<void> {
    this.hits.put += 1;
    this.rows.set(id, { template: structuredClone(template), thumb });
  }

  async remove(id: string): Promise<void> {
    this.hits.remove += 1;
    this.rows.delete(id);
  }
}
