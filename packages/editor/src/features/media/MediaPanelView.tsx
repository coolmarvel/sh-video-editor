import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useEditor } from '../../store';
import { useEngineEvents } from '../events/store';
import { formatTimecode } from '../../engine/time';
import { mediaBinMenu, mediaEmptyMenu, mediaItemMenu, openAt } from '../context-menu';
import { openEdition } from '../onboarding/edition';
import { useProject } from '../project/store';
import { MediaTree } from './MediaTree';
import { useMedia } from './store';
import { DEMO_SCENES, findItem, isClipLike, isEdition, typeLabelKo } from './types';
import './media.css';

/**
 * 미디어 패널 본체. 목록은 엔진 project.inspect 가 SSOT 이고, 모든 변경은 커맨드로 보낸 뒤 다시 읽는다.
 * 알림은 프로젝트 기능의 토스트로 나간다(패널 안 인라인 알림 없음). 우클릭 메뉴는 features/context-menu.
 */
export function MediaPanelView() {
  const bridge = useEditor((s) => s.bridge);
  const root = useMedia((s) => s.root);
  const revision = useMedia((s) => s.revision);
  const selectedId = useMedia((s) => s.selectedId);
  const selectedIds = useMedia((s) => s.selectedIds);
  const busy = useMedia((s) => s.busy);
  const dragOver = useMedia((s) => s.dragOver);
  const refresh = useMedia((s) => s.refresh);
  const select = useMedia((s) => s.select);
  const importPaths = useMedia((s) => s.importPaths);
  const pickAndImport = useMedia((s) => s.pickAndImport);
  const importDemo = useMedia((s) => s.importDemo);
  const addToTimeline = useMedia((s) => s.addToTimeline);
  const setDragOver = useMedia((s) => s.setDragOver);
  const [demoOpen, setDemoOpen] = useState(false);
  const demoRef = useRef<HTMLDivElement>(null);

  const canPick = Boolean(bridge?.pickFiles);
  const canDropPaths = Boolean(bridge?.pathForFile);
  const selected = findItem(root, selectedId);
  const canAdd = selectedIds.some((id) => {
    const it = findItem(root, id);
    return it !== null && isClipLike(it);
  });

  // 엔진이 연결되면 목록을 읽고, 엔진 이벤트(프로젝트 변경, Reveal in Project)를 구독해 다시 읽는다(features/events)
  useEffect(() => {
    if (!bridge) return;
    void refresh();
    return useEngineEvents.subscribe((s, prev) => {
      if (s.projectChanged !== prev.projectChanged) void refresh();
      if (s.revealChanged !== prev.revealChanged && s.revealed !== null) void select(s.revealed);
    });
  }, [bridge, refresh, select]);

  // 창 어디에 떨어뜨려도 페이지가 그 파일로 이동하지 않게 막는다
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
    };
  }, []);

  useEffect(() => {
    if (!demoOpen) return;
    const close = (e: MouseEvent) => {
      if (!demoRef.current?.contains(e.target as Node)) setDemoOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDemoOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [demoOpen]);

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = canDropPaths ? 'copy' : 'none';
    setDragOver(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOver(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const notify = useProject.getState().notify;
    if (!bridge?.pathForFile) {
      notify('info', '웹에서는 파일 > 미디어 가져오기로 파일을 고르세요. 데모 영상으로 먼저 사용해 볼 수도 있습니다.');
      return;
    }
    const paths: string[] = [];
    for (const f of files) {
      const p = bridge.pathForFile(f);
      if (p) paths.push(p);
    }
    if (paths.length === 0) {
      notify('danger', '떨어뜨린 파일의 경로를 읽지 못했습니다. 가져오기 버튼으로 선택하세요.');
      return;
    }
    void importPaths(paths);
  };

  const isEmpty = !root || root.children.length === 0;

  return (
    <>
      <div className="sh-toolbar ve-media-toolbar" role="toolbar" aria-label="미디어 도구">
        {canPick && (
          <button type="button" className="sh-tool" disabled={busy} onClick={() => void pickAndImport()}>
            가져오기
          </button>
        )}
        <div className="ve-media-menu-slot" ref={demoRef}>
          <button
            type="button"
            className="sh-tool"
            aria-haspopup="menu"
            aria-expanded={demoOpen}
            disabled={busy || !bridge}
            onClick={() => setDemoOpen((v) => !v)}
          >
            데모 영상
          </button>
          {demoOpen && (
            <div className="sh-menu sh-menu--float ve-media-menu" role="menu" aria-label="데모 영상 넣기">
              {DEMO_SCENES.map((d) => (
                <button
                  key={d.scene}
                  type="button"
                  className="sh-menu__item"
                  role="menuitem"
                  onClick={() => {
                    setDemoOpen(false);
                    void importDemo(d.scene);
                  }}
                >
                  <span className="sh-menu__check" />
                  <span className="sh-menu__label">{d.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="sh-separator" />
        <button
          type="button"
          className="sh-tool"
          disabled={!canAdd || busy}
          title="선택한 항목을 타임라인 끝에 넣습니다. 편집본이 없으면 그 항목의 설정으로 만듭니다"
          onClick={() => void addToTimeline()}
        >
          타임라인에 넣기
        </button>
      </div>

      <div
        className="ve-media-body"
        data-drop={dragOver ? 'over' : undefined}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onContextMenu={(e) => {
          // 트리 항목이 먼저 받는다. 여기까지 온 것은 빈 자리
          if (e.defaultPrevented || !bridge) return;
          openAt(e, '미디어 메뉴', mediaEmptyMenu());
        }}
      >
        {isEmpty ? (
          <div className="ve-media-empty">
            <p>영상, 사진, 음악 파일을 여기로 끌어다 놓으세요.</p>
            {canPick ? <p>가져오기 버튼으로 파일을 고를 수도 있습니다.</p> : <p>데모 영상 메뉴에서 생성 영상을 넣어 바로 시험할 수 있습니다.</p>}
          </div>
        ) : (
          root && (
            <MediaTree
              root={root}
              revision={revision}
              selectedIds={selectedIds}
              onSelect={(id, opts) => void select(id, opts)}
              onOpen={(item) => {
                if (isEdition(item)) void openEdition(item.id);
                else if (isClipLike(item)) void addToTimeline([item.id]);
              }}
              onItemContextMenu={(e, item) => openAt(e, `${item.name} 메뉴`, mediaItemMenu(item))}
              onBinContextMenu={(e, bin, isRoot) => openAt(e, `${isRoot ? '프로젝트' : bin.name} 메뉴`, mediaBinMenu(bin, isRoot))}
            />
          )
        )}
      </div>

      {selected && (
        <div className="ve-media-details" aria-label="선택 항목">
          <span className="ve-media-name" title={selected.name}>
            {selected.name}
            {selectedIds.length > 1 ? ` 외 ${selectedIds.length - 1}개` : ''}
          </span>
          <span className="sh-chip">{typeLabelKo(selected.type)}</span>
          <span className="sh-tnum">{formatTimecode(selected.duration, selected.fps ?? 30)}</span>
          {selected.fps && <span className="sh-tnum">{selected.fps} fps</span>}
          {selected.videoInfo && <span>{selected.videoInfo}</span>}
          {selected.audioInfo && <span>{selected.audioInfo}</span>}
        </div>
      )}
    </>
  );
}
