/**
 * 한글 사전(packages/editor/src/features/i18n/labels.ko.ts)의 완성도를 실제 엔진 카탈로그로 강제한다(M4-9):
 * 메뉴 경로가 있는 커맨드 중 번역 없는 id 는 0개여야 하고, 실제 실행 취소 라벨이 한글로 바뀌어야 한다.
 * 새 커맨드가 메뉴에 추가되면 이 테스트가 실패하므로 사전에 항목을 더한다.
 */
import { describe, expect, it } from 'vitest';
import { COMMAND_LABELS_KO, historyLabelKo, untranslatedMenuCommands } from '../../editor/src/features/i18n/labels.ko';
import { T, exec, hasNativeBinding, loadNapi } from './helpers';

interface Spec {
  id: string;
  label: string;
  menu: string[];
}

describe.skipIf(!hasNativeBinding())('한글 사전과 엔진 카탈로그', () => {
  it('메뉴에 노출되는 커맨드는 전부 번역이 있고, 사전에 모르는 id 는 없다', () => {
    const cat = JSON.parse(loadNapi().commandCatalog()) as Spec[];
    const missing = untranslatedMenuCommands(cat);
    expect(missing, `번역 없는 메뉴 커맨드: ${missing.join(', ')}`).toEqual([]);
    const ids = new Set(cat.map((c) => c.id));
    const stale = Object.keys(COMMAND_LABELS_KO).filter((id) => !ids.has(id));
    expect(stale, `카탈로그에 없는 사전 항목: ${stale.join(', ')}`).toEqual([]);
    expect(cat.filter((c) => c.menu.length > 0).length).toBeGreaterThanOrEqual(250);
  });

  it('실제 실행 취소 라벨이 한글로 바뀐다(자르기, 삭제, 전환)', () => {
    const mod = loadNapi();
    const engine = new mod.Engine();
    const cat = JSON.parse(mod.commandCatalog()) as Spec[];
    exec(engine, 'file.newSequence', { name: 'seq', width: 320, height: 180, fps: 30 });
    const demo = exec<{ items: number[] }>(engine, 'file.importDemoFootage', { scene: 'Aurora' });
    const placed = exec<{ clips: number[] }>(engine, 'timeline.place', { item: demo.items[0], track: 'V1', time: 0, insert: true });
    exec(engine, 'timeline.razor', { time: 4 * T });
    const labels: string[] = [];
    const undo = () => {
      const l = engine.undo();
      if (l !== null) labels.push(l);
      return l;
    };
    expect(historyLabelKo(undo() ?? '', cat)).toBe('자르기');
    exec(engine, 'sequence.applyVideoTransition', { clip: placed.clips[0], effect: 'cross_dissolve', frames: 30, edge: 'in' });
    expect(historyLabelKo(undo() ?? '', cat)).toBe('크로스 디졸브 적용');
    exec(engine, 'edit.selectAll');
    exec(engine, 'edit.clear');
    expect(historyLabelKo(undo() ?? '', cat)).toBe('삭제');
    // 원문은 영문이었다
    expect(labels.every((l) => !/[가-힣]/.test(l))).toBe(true);
  });
});
