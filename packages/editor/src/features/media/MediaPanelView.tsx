import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useEditor } from '../../store';
import { formatTimecode } from '../../engine/time';
import { MediaTree } from './MediaTree';
import { useMedia } from './store';
import { DEMO_SCENES, findItem, isClipLike, typeLabelKo } from './types';
import './media.css';

/** 미디어 패널 본체. 목록은 엔진 project.inspect 가 SSOT 이고, 모든 변경은 커맨드로 보낸 뒤 다시 읽는다. */
export function MediaPanelView() {
  const bridge = useEditor((s) => s.bridge);
  const root = useMedia((s) => s.root);
  const selectedId = useMedia((s) => s.selectedId);
  const busy = useMedia((s) => s.busy);
  const notice = useMedia((s) => s.notice);
  const dragOver = useMedia((s) => s.dragOver);
  const refresh = useMedia((s) => s.refresh);
  const select = useMedia((s) => s.select);
  const importPaths = useMedia((s) => s.importPaths);
  const pickAndImport = useMedia((s) => s.pickAndImport);
  const importDemo = useMedia((s) => s.importDemo);
  const newSequenceFromSelection = useMedia((s) => s.newSequenceFromSelection);
  const setNotice = useMedia((s) => s.setNotice);
  const setDragOver = useMedia((s) => s.setDragOver);
  const [demoOpen, setDemoOpen] = useState(false);
  const demoRef = useRef<HTMLDivElement>(null);

  const canPick = Boolean(bridge?.pickFiles);
  const canDropPaths = Boolean(bridge?.pathForFile);
  const selected = findItem(root, selectedId);
  const canMakeSequence = Boolean(selected && isClipLike(selected)) && !busy;

  // 엔진이 연결되면 목록을 읽고, 메뉴바 등 다른 곳에서 커맨드가 실행되어 상태 줄이 바뀔 때마다 다시 읽는다
  useEffect(() => {
    if (!bridge) return;
    void refresh();
    return useEditor.subscribe((s, prev) => {
      if (s.status !== prev.status) void refresh();
    });
  }, [bridge, refresh]);

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
    if (!bridge?.pathForFile) {
      setNotice({ tone: 'info', text: '웹 파일 등록은 준비 중입니다. 데모 영상으로 먼저 사용해 보세요.' });
      return;
    }
    const paths: string[] = [];
    for (const f of files) {
      const p = bridge.pathForFile(f);
      if (p) paths.push(p);
    }
    if (paths.length === 0) {
      setNotice({ tone: 'danger', text: '떨어뜨린 파일의 경로를 읽지 못했습니다. 가져오기 버튼으로 선택하세요.' });
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
          disabled={!canMakeSequence}
          title="선택한 항목으로 시퀀스를 만듭니다"
          onClick={() => void newSequenceFromSelection()}
        >
          시퀀스 만들기
        </button>
      </div>

      {notice && (
        <div
          className={`sh-alert ve-media-notice${notice.tone === 'danger' ? ' sh-alert--danger' : notice.tone === 'success' ? ' sh-alert--success' : ''}`}
          role="status"
        >
          <span title={notice.text}>{notice.text}</span>
          <button type="button" className="sh-btn sh-btn--sm" onClick={() => setNotice(null)}>
            닫기
          </button>
        </div>
      )}

      <div
        className="ve-media-body"
        data-drop={dragOver ? 'over' : undefined}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {isEmpty ? (
          <div className="ve-media-empty">
            <p>영상, 사진, 음악 파일을 여기로 끌어다 놓으세요.</p>
            {canPick ? (
              <p>가져오기 버튼으로 파일을 고를 수도 있습니다.</p>
            ) : (
              <p>데모 영상 메뉴에서 생성 영상을 넣어 바로 시험할 수 있습니다.</p>
            )}
          </div>
        ) : (
          root && (
            <MediaTree
              root={root}
              selectedId={selectedId}
              onSelect={(id) => void select(id)}
              onOpen={(item) => {
                if (isClipLike(item)) void select(item.id).then(() => newSequenceFromSelection());
              }}
            />
          )
        )}
      </div>

      {selected && (
        <div className="ve-media-details" aria-label="선택 항목">
          <span className="ve-media-name" title={selected.name}>
            {selected.name}
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
