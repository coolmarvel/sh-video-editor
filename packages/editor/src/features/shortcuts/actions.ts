/**
 * 단축키 id 와 메뉴 항목이 공통으로 부르는 실행 표. 키맵(keymap.ts)의 id 와 메뉴 정의(menu-def.ts)의 action 은 모두
 * 여기를 거친다. 표에 없는 id 는 엔진 커맨드 id 로 보고 그대로 실행한다(편집 로직은 엔진에만 있다).
 * 실행 뒤에는 상태 줄을 바꿔 타임라인·미디어 패널이 다시 읽게 하고, 프로젝트·모니터도 직접 다시 읽는다.
 */
import { useEditor } from '../../store';
import { useExport } from '../export/store';
import { useMedia } from '../media/store';
import { DEMO_SCENES, type DemoScene } from '../media/types';
import { monitorController } from '../monitor/registry';
import { useProject } from '../project/store';
import { useTimeline } from '../timeline/store';
import { useShortcutsUi } from './store';

type Params = Record<string, unknown>;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 엔진 상태가 바뀐 뒤 모든 패널이 다시 읽게 한다. status 변경은 타임라인·미디어 패널의 구독을 깨운다 */
export async function refreshAll(status?: string): Promise<void> {
  if (status !== undefined) useEditor.setState({ status, error: null });
  const c = monitorController();
  await Promise.all([
    useTimeline.getState().refresh(),
    useMedia.getState().refresh(),
    useProject.getState().refresh(),
    c ? c.refreshSequence().then(() => c.syncPlayhead()) : Promise.resolve(),
  ]);
}

/** 엔진 커맨드 하나를 실행하고 한국어 상태 문구로 알린다. 실패하면 상태 줄에 오류를 올린다 */
export async function execCommand(id: string, params: Params | undefined, done: string): Promise<unknown> {
  const bridge = useEditor.getState().bridge;
  if (!bridge) return undefined;
  try {
    const r = await bridge.execute(id, params);
    await refreshAll(done);
    return r;
  } catch (e) {
    useEditor.setState({ error: `실행할 수 없습니다: ${message(e)}` });
    await refreshAll();
    return undefined;
  }
}

async function undo(): Promise<void> {
  await useTimeline.getState().undo();
  await refreshAll();
}

async function redo(): Promise<void> {
  await useTimeline.getState().redo();
  await refreshAll();
}

/** 미디어 가져오기. 데스크톱은 OS 파일 대화상자, 웹은 브라우저 파일 선택으로 등록한 뒤 file.import */
async function importMedia(): Promise<void> {
  const bridge = useEditor.getState().bridge;
  if (!bridge) return;
  if (bridge.pickFiles) {
    await useMedia.getState().pickAndImport();
    return;
  }
  if (!bridge.registerFiles) {
    useMedia.getState().setNotice({ tone: 'info', text: '이 환경에서는 파일 가져오기를 지원하지 않습니다.' });
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = 'video/*,audio/*,image/*';
  input.style.display = 'none';
  document.body.appendChild(input);
  await new Promise<void>((resolve) => {
    input.onchange = () => resolve();
    input.oncancel = () => resolve();
    input.click();
  });
  const files = Array.from(input.files ?? []);
  input.remove();
  if (files.length === 0) return;
  try {
    const paths = await bridge.registerFiles(files);
    await useMedia.getState().importPaths(paths);
  } catch (e) {
    useMedia.getState().setNotice({ tone: 'danger', text: `파일을 등록하지 못했습니다. ${message(e)}` });
  }
}

async function importAllDemo(): Promise<void> {
  for (const d of DEMO_SCENES) await useMedia.getState().importDemo(d.scene);
}

function monitor() {
  return monitorController();
}

/** 선택한 클립의 켜짐·연결 상태를 바꾼 뒤 보여 줄 문구 */
const TOGGLE_LABEL: Record<string, string> = {
  'clip.enable': '클립 켜짐 상태를 바꿨습니다',
  'clip.link': '클립 연결 상태를 바꿨습니다',
};

const TABLE: Record<string, (params?: Params) => void | Promise<void>> = {
  'edit.undo': undo,
  'edit.redo': redo,
  'file.new': () => useProject.getState().newProject(),
  'file.open': () => useProject.getState().openProject(),
  'file.save': () => void useProject.getState().save(),
  'file.saveAs': () => void useProject.getState().saveAs(),
  'file.export': () => useExport.getState().show(),
  'file.importMedia': importMedia,
  'file.importDemo': (p) => useMedia.getState().importDemo((p?.['scene'] as DemoScene | undefined) ?? 'OceanSunset'),
  'file.importDemoAll': importAllDemo,
  'file.newSequence': () => useTimeline.getState().newSequence(),
  'file.quit': () => window.close(),
  'edit.cut': () => void execCommand('edit.cut', undefined, '잘라냈습니다'),
  'edit.copy': () => void execCommand('edit.copy', undefined, '복사했습니다'),
  'edit.paste': () => void execCommand('edit.paste', undefined, '붙여넣었습니다'),
  'edit.selectAll': () => void execCommand('edit.selectAll', undefined, '모든 클립을 선택했습니다'),
  'edit.deselectAll': () => void execCommand('edit.deselectAll', undefined, '선택을 해제했습니다'),
  'clip.delete': () => useTimeline.getState().deleteSelection(),
  'clip.rippleDelete': () => {
    const clips = useTimeline.getState().sequence?.selection ?? [];
    if (clips.length === 0) {
      useEditor.setState({ status: '삭제할 클립을 먼저 선택하세요' });
      return;
    }
    return void execCommand('edit.rippleDelete', { clips }, `리플 삭제: 클립 ${clips.length}개`);
  },
  'clip.razor': () => useTimeline.getState().razorAtPlayhead(),
  'clip.razorAll': () => void execCommand('sequence.addEditAllTracks', undefined, '모든 트랙을 잘랐습니다'),
  'clip.speed': () => {
    if ((useTimeline.getState().sequence?.selection ?? []).length === 0) {
      useEditor.setState({ status: '속도를 바꿀 클립을 먼저 선택하세요' });
      return;
    }
    useShortcutsUi.getState().setSpeedOpen(true);
  },
  'clip.enable': () => void execCommand('clip.enable', undefined, TOGGLE_LABEL['clip.enable'] ?? ''),
  'clip.link': () => void execCommand('clip.link', undefined, TOGGLE_LABEL['clip.link'] ?? ''),
  'timeline.zoomIn': () => useTimeline.getState().setZoom(useTimeline.getState().pxPerSec * 1.25),
  'timeline.zoomOut': () => useTimeline.getState().setZoom(useTimeline.getState().pxPerSec / 1.25),
  'timeline.fit': () => useTimeline.getState().requestFit(),
  'timeline.snap': () => useTimeline.getState().toggleSnapping(),
  'timeline.ripple': () => useTimeline.getState().toggleRipple(),
  'timeline.insert': () => useTimeline.getState().toggleInsert(),
  'markers.in': () => void execCommand('markers.markIn', { target: 'program' }, '인 점을 표시했습니다'),
  'markers.out': () => void execCommand('markers.markOut', { target: 'program' }, '아웃 점을 표시했습니다'),
  'markers.clearInOut': () => void execCommand('markers.clearInOut', undefined, '인, 아웃 점을 지웠습니다'),
  'sequence.addTracks': () => void execCommand('sequence.addTracks', { video: 1, audio: 1 }, '트랙을 추가했습니다'),
  'play.toggle': () => monitor()?.toggle(),
  'play.stop': () => monitor()?.pause(),
  'play.shuttleBack': () => monitor()?.shuttle(-1),
  'play.shuttleForward': () => monitor()?.shuttle(1),
  'play.stepBack': () => monitor()?.step(-1),
  'play.stepForward': () => monitor()?.step(1),
  'play.stepBack5': () => monitor()?.step(-5),
  'play.stepForward5': () => monitor()?.step(5),
  'play.start': () => monitor()?.goToStart(),
  'play.end': () => monitor()?.goToEnd(),
  'play.rate': (p) => monitor()?.setRate(Number(p?.['rate'] ?? 1)),
  'help.about': () => useShortcutsUi.getState().setAboutOpen(true),
};

/** 동작 id 를 실행한다. 표에 없으면 엔진 커맨드로 본다 */
export async function runAction(id: string, params?: Params): Promise<void> {
  const fn = TABLE[id];
  if (fn) {
    await fn(params);
    return;
  }
  await execCommand(id, params, `${id} 실행`);
}

export function hasAction(id: string): boolean {
  return id in TABLE;
}
