/**
 * 메뉴바 정의. 엔진 카탈로그를 그대로 뿌리지 않고 이 제품이 쓰는 항목만 한국어로 둔다.
 * 각 항목의 action 은 actions.ts 의 id(또는 엔진 커맨드 id), 단축키 표기는 keymap.ts 에서 읽는다(원천 하나).
 * enabledBy 는 활성 여부를 물을 엔진 커맨드 id(bridge.isEnabled). 없으면 엔진이 연결되어 있는 한 항상 활성.
 */
import type { HostKind } from '../../App';
import { DEMO_SCENES } from '../media/types';
import { PLAYBACK_RATES, useMonitor } from '../monitor/store';
import { useTimeline } from '../timeline/store';

export interface MenuItemDef {
  kind: 'item';
  label: string;
  action: string;
  params?: Record<string, unknown>;
  /** 활성 여부를 물을 엔진 커맨드 id */
  enabledBy?: string;
  /** 체크 표시(토글 항목). 메뉴를 열 때 평가한다 */
  checked?: () => boolean;
  /** 특정 호스트에서만 보인다 */
  hosts?: HostKind[];
}
export interface MenuSubDef {
  kind: 'sub';
  label: string;
  items: MenuEntry[];
}
export interface MenuSepDef {
  kind: 'sep';
}
export type MenuEntry = MenuItemDef | MenuSubDef | MenuSepDef;

export interface MenuDef {
  id: string;
  label: string;
  items: MenuEntry[];
}

const sep: MenuSepDef = { kind: 'sep' };
const item = (label: string, action: string, extra: Partial<MenuItemDef> = {}): MenuItemDef => ({
  kind: 'item',
  label,
  action,
  ...extra,
});

export const MENUS: MenuDef[] = [
  {
    id: 'file',
    label: '파일',
    items: [
      item('새 프로젝트', 'file.new'),
      item('열기...', 'file.open'),
      item('저장', 'file.save'),
      item('다른 이름으로 저장...', 'file.saveAs'),
      sep,
      item('미디어 가져오기...', 'file.importMedia'),
      {
        kind: 'sub',
        label: '데모 영상 넣기',
        items: [...DEMO_SCENES.map((d) => item(d.label, 'file.importDemo', { params: { scene: d.scene } })), sep, item('전부 넣기', 'file.importDemoAll')],
      },
      item('새 시퀀스', 'file.newSequence'),
      sep,
      item('내보내기...', 'file.export'),
      sep,
      item('종료', 'file.quit', { hosts: ['desktop'] }),
    ],
  },
  {
    id: 'edit',
    label: '편집',
    items: [
      item('실행 취소', 'edit.undo', { enabledBy: 'edit.undo' }),
      item('다시 실행', 'edit.redo', { enabledBy: 'edit.redo' }),
      sep,
      item('잘라내기', 'edit.cut', { enabledBy: 'edit.cut' }),
      item('복사', 'edit.copy', { enabledBy: 'edit.copy' }),
      item('붙여넣기', 'edit.paste', { enabledBy: 'edit.paste' }),
      sep,
      item('삭제', 'clip.delete', { enabledBy: 'edit.clear' }),
      item('리플 삭제', 'clip.rippleDelete', { enabledBy: 'edit.rippleDelete' }),
      sep,
      item('전체 선택', 'edit.selectAll', { enabledBy: 'edit.selectAll' }),
      item('선택 해제', 'edit.deselectAll', { enabledBy: 'edit.deselectAll' }),
    ],
  },
  {
    id: 'clip',
    label: '클립',
    items: [
      item('플레이헤드에서 자르기', 'clip.razor', { enabledBy: 'sequence.inspect' }),
      item('속도, 길이...', 'clip.speed', { enabledBy: 'clip.speedDuration' }),
      item('텍스트 추가', 'text.add', { enabledBy: 'graphics.newText' }),
      sep,
      item('켜기, 끄기', 'clip.enable', { enabledBy: 'clip.enable' }),
      item('영상, 소리 연결, 연결 해제', 'clip.link', { enabledBy: 'clip.link' }),
    ],
  },
  {
    id: 'sequence',
    label: '시퀀스',
    items: [
      item('모든 트랙 자르기', 'clip.razorAll', { enabledBy: 'sequence.addEditAllTracks' }),
      item('트랙 추가', 'sequence.addTracks', { enabledBy: 'sequence.addTracks' }),
      sep,
      item('인 점 표시', 'markers.in', { enabledBy: 'markers.markIn' }),
      item('아웃 점 표시', 'markers.out', { enabledBy: 'markers.markOut' }),
      item('인, 아웃 점 지우기', 'markers.clearInOut', { enabledBy: 'markers.clearInOut' }),
      sep,
      item('스냅', 'timeline.snap', { checked: () => useTimeline.getState().snapping }),
      item('리플(삭제, 트림 때 뒤 클립 당김)', 'timeline.ripple', { checked: () => useTimeline.getState().ripple }),
      item('삽입(놓기, 이동 때 밀어냄)', 'timeline.insert', { checked: () => useTimeline.getState().insert }),
    ],
  },
  {
    id: 'view',
    label: '보기',
    items: [
      item('타임라인 확대', 'timeline.zoomIn'),
      item('타임라인 축소', 'timeline.zoomOut'),
      item('시퀀스 전체 보기', 'timeline.fit'),
      sep,
      item('재생, 정지', 'play.toggle'),
      item('뒤로 재생', 'play.shuttleBack'),
      item('정지', 'play.stop'),
      item('앞으로 재생', 'play.shuttleForward'),
      {
        kind: 'sub',
        label: '재생 배율',
        items: PLAYBACK_RATES.map((r) =>
          item(`${r}x`, 'play.rate', {
            params: { rate: r },
            checked: () => Math.abs(useMonitor.getState().rate) === r,
          }),
        ),
      },
    ],
  },
  {
    id: 'help',
    label: '도움말',
    items: [item('SH Video Editor 정보', 'help.about')],
  },
];

/** 호스트에 맞는 항목만 남긴다(구분선이 겹치거나 끝에 남으면 정리) */
export function menuItemsFor(menu: MenuDef, host: HostKind): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const e of menu.items) {
    if (e.kind === 'item' && e.hosts && !e.hosts.includes(host)) continue;
    if (e.kind === 'sep' && (out.length === 0 || out[out.length - 1]?.kind === 'sep')) continue;
    out.push(e);
  }
  while (out[out.length - 1]?.kind === 'sep') out.pop();
  return out;
}
