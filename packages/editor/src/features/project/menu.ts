/**
 * 메뉴바가 엔진 커맨드를 바로 실행하기 전에 가로채는 항목. 파일 대화상자·확인·진행률이 필요한 커맨드만 여기서
 * features 의 핸들러로 보낸다. 나머지는 MenuBar 가 그대로 엔진에 넘긴다.
 */
import { useExport } from '../export/store';
import { useProject } from './store';

const HANDLERS: Record<string, () => void> = {
  'file.newProject': () => void useProject.getState().newProject(),
  'file.open': () => void useProject.getState().openProject(),
  'file.save': () => void useProject.getState().save(),
  'file.saveAs': () => void useProject.getState().saveAs(),
  'file.recover': () => void useProject.getState().openRecovery(),
  'file.exportMedia': () => void useExport.getState().show(),
  'export.queue.add': () => void useExport.getState().show(),
  'export.quick': () => void useExport.getState().show(),
};

/** 가로챘으면 true. 호출한 쪽은 그때 엔진 실행을 건너뛴다. */
export function interceptMenuCommand(id: string): boolean {
  const h = HANDLERS[id];
  if (!h) return false;
  h();
  return true;
}
