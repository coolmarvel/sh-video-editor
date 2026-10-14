/** features/project/menu.ts: 메뉴 가로채기 표. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { interceptMenuCommand } from '@editor/features/project/menu';
import { useExport } from '@editor/features/export/store';
import { useProject } from '@editor/features/project/store';
import { resetStores } from '../../stores';

beforeEach(resetStores);

describe('interceptMenuCommand', () => {
  it('파일·내보내기 커맨드는 features 핸들러로 보내고 true', () => {
    const p = useProject.getState();
    const e = useExport.getState();
    const spies = {
      'file.newProject': vi.spyOn(p, 'newProject').mockResolvedValue(),
      'file.open': vi.spyOn(p, 'openProject').mockResolvedValue(),
      'file.save': vi.spyOn(p, 'save').mockResolvedValue(true),
      'file.saveAs': vi.spyOn(p, 'saveAs').mockResolvedValue(true),
      'file.recover': vi.spyOn(p, 'openRecovery').mockResolvedValue(),
    };
    const show = vi.spyOn(e, 'show').mockResolvedValue();
    for (const [id, spy] of Object.entries(spies)) {
      expect(interceptMenuCommand(id)).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
    }
    for (const id of ['file.exportMedia', 'export.queue.add', 'export.quick']) {
      expect(interceptMenuCommand(id)).toBe(true);
    }
    expect(show).toHaveBeenCalledTimes(3);
  });

  it('나머지는 false 라 엔진으로 간다', () => {
    expect(interceptMenuCommand('edit.undo')).toBe(false);
    expect(interceptMenuCommand('file.newSequence')).toBe(false);
    expect(interceptMenuCommand('')).toBe(false);
  });

  /**
   * HANDLERS 가 일반 객체라 'toString', 'constructor' 같은 Object.prototype 키가 핸들러로 잡혀 true 를 돌려준다.
   * 지금 엔진 커맨드 id 에 그런 이름이 없어 실제로 부딪히지는 않지만, Object.hasOwn 이나 Map 으로 바꿔야 한다.
   */
  it.fails('프로토타입 키는 가로채지 않아야 한다 (알려진 결함)', () => {
    expect(interceptMenuCommand('toString')).toBe(false);
    expect(interceptMenuCommand('constructor')).toBe(false);
  });
});
