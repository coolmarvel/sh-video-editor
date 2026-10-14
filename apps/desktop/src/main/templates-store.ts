/**
 * 데스크톱 사용자 템플릿 저장소: `<userData>/templates/<id>.json`(템플릿 JSON, 화면이 만들고 읽는다) + `<id>.png`(썸네일, 없을 수 있다).
 * 렌더러는 preload 의 `templates:*` IPC 로 부른다(packages/editor 의 TemplateStore 와 같은 모양). 내용은 해석하지 않는다.
 * id 는 파일 이름이 되므로 글자·숫자·`-`·`_` 만 받는다(경로 조작 방지). 실패는 던져서 화면이 토스트로 알리게 한다.
 */
import { ipcMain } from 'electron';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const TEMPLATES_DIR = 'templates';

export interface StoredTemplateRow {
  template: unknown;
  thumb: Uint8Array | null;
}

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

function checkId(id: unknown): string {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error(`템플릿 id 가 잘못되었습니다: ${String(id)}`);
  return id;
}

export class TemplatesDir {
  constructor(readonly dir: string) {}

  private jsonPath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private pngPath(id: string): string {
    return join(this.dir, `${id}.png`);
  }

  async list(): Promise<StoredTemplateRow[]> {
    await mkdir(this.dir, { recursive: true });
    const names = (await readdir(this.dir)).filter((n) => n.endsWith('.json'));
    const rows: StoredTemplateRow[] = [];
    for (const n of names) {
      const id = n.slice(0, -'.json'.length);
      if (!ID_RE.test(id)) continue;
      try {
        const template = JSON.parse(await readFile(this.jsonPath(id), 'utf8')) as unknown;
        let thumb: Uint8Array | null = null;
        try {
          thumb = new Uint8Array(await readFile(this.pngPath(id)));
        } catch {
          thumb = null;
        }
        rows.push({ template, thumb });
      } catch {
        // 깨진 파일은 목록에서 뺀다(지우지는 않는다)
      }
    }
    return rows;
  }

  /** JSON 은 임시 파일에 쓴 뒤 바꿔 넣는다(쓰다 끊겨도 옛 파일이 남는다) */
  async put(id: string, template: unknown, thumb: Uint8Array | null): Promise<void> {
    checkId(id);
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.jsonPath(id)}.tmp`;
    await writeFile(tmp, JSON.stringify(template, null, 2), 'utf8');
    await rename(tmp, this.jsonPath(id));
    if (thumb && thumb.length > 0) await writeFile(this.pngPath(id), Buffer.from(thumb));
    else await rm(this.pngPath(id), { force: true });
  }

  async remove(id: string): Promise<void> {
    checkId(id);
    await rm(this.jsonPath(id), { force: true });
    await rm(this.pngPath(id), { force: true });
  }
}

/** `templates:*` IPC 등록. 디렉토리는 처음 쓸 때 만든다 */
export function registerTemplatesIpc(dir: string): TemplatesDir {
  const store = new TemplatesDir(dir);
  ipcMain.handle('templates:list', () => store.list());
  ipcMain.handle('templates:put', (_e, id: string, template: unknown, thumb: Uint8Array | null) => store.put(id, template, thumb ?? null));
  ipcMain.handle('templates:remove', (_e, id: string) => store.remove(id));
  return store;
}
