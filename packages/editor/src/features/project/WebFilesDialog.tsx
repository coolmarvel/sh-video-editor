/**
 * 웹 파일 대화상자(sh-dialog). 저장: 이름 입력 + "브라우저에 저장" / "내 컴퓨터로 받기". 열기: 브라우저 안 목록(표) +
 * "내 컴퓨터에서 고르기". 미디어 다시 연결: 찾을 수 없는 파일 목록 + "파일 다시 고르기". 상태는 web-store.ts.
 */
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useWebFiles } from './web-store';
import { Dialog } from '../../shell/Dialog';

export function WebFilesDialog() {
  const mode = useWebFiles((s) => s.mode);
  const name = useWebFiles((s) => s.name);
  const projects = useWebFiles((s) => s.projects);
  const selected = useWebFiles((s) => s.selected);
  const missing = useWebFiles((s) => s.missing);
  const busy = useWebFiles((s) => s.busy);
  const error = useWebFiles((s) => s.error);
  const { close, setName, select, confirmSave, openSelected, openFile, deleteProject, relinkFiles } = useWebFiles.getState();
  const nameRef = useRef<HTMLInputElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === 'save') nameRef.current?.focus();
    else if (mode) primaryRef.current?.focus();
  }, [mode]);

  if (!mode) return null;

  const title = mode === 'save' ? '브라우저에 저장' : mode === 'open' ? '프로젝트 열기' : '미디어 다시 연결';
  const canSave = name.trim() !== '' && !busy;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
      if (mode === 'save' && canSave) {
        e.preventDefault();
        void confirmSave(false);
      } else if (mode === 'open' && selected && !busy) {
        e.preventDefault();
        void openSelected();
      }
    }
  };
  const pickFiles = () => fileRef.current?.click();
  const onFiles = () => {
    const files = Array.from(fileRef.current?.files ?? []);
    if (fileRef.current) fileRef.current.value = '';
    if (files.length === 0) return;
    if (mode === 'open') void openFile(files[0]!);
    else if (mode === 'relink') void relinkFiles(files);
  };

  return (
    <Dialog
      titleId="ve-webfiles-title"
      title={title}
      onClose={() => {
        if (!busy) close();
      }}
      onKeyDown={onKeyDown}
    >
      <div className="sh-dialog__body">
        {error && (
          <div className="sh-alert sh-alert--danger" role="alert">
            {error}
          </div>
        )}
        {mode === 'save' && (
          <>
            <p className="ve-dialog-text">
              프로젝트는 이 브라우저 안(사이트 저장소)에 남고 서버에는 올라가지 않습니다. 파일로도 받아 두려면 "내 컴퓨터로 받기"를 누르세요.
            </p>
            <div className="sh-form">
              <label htmlFor="ve-webfiles-name">이름</label>
              <input ref={nameRef} id="ve-webfiles-name" className="sh-input" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
            </div>
          </>
        )}
        {mode === 'open' && (
          <>
            <p className="ve-dialog-text">이 브라우저에 저장한 프로젝트입니다. 내 컴퓨터의 .fcproj 파일을 열면 브라우저 안에 복사해 둡니다.</p>
            {projects.length === 0 ? (
              <p className="ve-hint">저장한 프로젝트가 없습니다.</p>
            ) : (
              <div className="ve-webfiles-list">
                <table className="sh-table ve-webfiles-table" aria-label="브라우저 안 프로젝트">
                  <thead>
                    <tr>
                      <th>이름</th>
                      <th aria-label="동작" />
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((p) => (
                      <tr key={p.path} aria-selected={selected === p.path} onClick={() => select(p.path)} onDoubleClick={() => void openSelected()}>
                        <td>{p.name}</td>
                        <td className="ve-webfiles-table__act">
                          <button type="button" className="sh-btn sh-btn--sm" disabled={busy} onClick={() => void deleteProject(p.path)}>
                            지우기
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {mode === 'relink' && (
          <>
            <p className="ve-dialog-text">
              브라우저는 새로고침하면 파일을 다시 읽을 수 없습니다. 아래 파일을 다시 골라 주세요(같은 이름의 파일을 찾아 잇습니다).
            </p>
            <ul className="ve-webfiles-missing">
              {missing.map((m) => (
                <li key={m.item}>{m.fileName}</li>
              ))}
            </ul>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple={mode === 'relink'}
          accept={mode === 'open' ? '.fcproj,application/json' : undefined}
          onChange={onFiles}
        />
      </div>
      <div className="sh-dialog__buttons">
        <button type="button" className="sh-btn sh-btn--dialog" disabled={busy} onClick={close}>
          {mode === 'relink' ? '나중에' : '취소'}
        </button>
        {mode === 'save' && (
          <>
            <button type="button" className="sh-btn sh-btn--dialog" disabled={!canSave} onClick={() => void confirmSave(true)}>
              내 컴퓨터로 받기
            </button>
            <button
              ref={primaryRef}
              type="button"
              className="sh-btn sh-btn--dialog sh-btn--primary"
              disabled={!canSave}
              onClick={() => void confirmSave(false)}
            >
              브라우저에 저장
            </button>
          </>
        )}
        {mode === 'open' && (
          <>
            <button type="button" className="sh-btn sh-btn--dialog" disabled={busy} onClick={pickFiles}>
              내 컴퓨터에서 고르기...
            </button>
            <button
              ref={primaryRef}
              type="button"
              className="sh-btn sh-btn--dialog sh-btn--primary"
              disabled={!selected || busy}
              onClick={() => void openSelected()}
            >
              열기
            </button>
          </>
        )}
        {mode === 'relink' && (
          <button ref={primaryRef} type="button" className="sh-btn sh-btn--dialog sh-btn--primary" disabled={busy} onClick={pickFiles}>
            파일 다시 고르기...
          </button>
        )}
      </div>
    </Dialog>
  );
}
