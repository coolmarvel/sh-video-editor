/** features/project 의 ConfirmDialog·RecoveryDialog 와 features/export 의 ExportDialog: 열림 조건, 버튼, Escape. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from '@editor/features/project/ConfirmDialog';
import { RecoveryDialog } from '@editor/features/project/RecoveryDialog';
import { ExportDialog } from '@editor/features/export/ExportDialog';
import { useProject } from '@editor/features/project/store';
import { useExport } from '@editor/features/export/store';
import { engineWithClips, type FakeRecovery } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

beforeEach(resetStores);

const cand = (id: string, over: Partial<FakeRecovery> = {}): FakeRecovery => ({
  id,
  projectName: `p${id}`,
  projectPath: null,
  savedAt: `2026-10-14 0${id}:00:00`,
  savedUnix: 1,
  revision: 1,
  cleanExit: false,
  ...over,
});

describe('ConfirmDialog', () => {
  it('confirm 이 없으면 그리지 않고, 있으면 세 버튼과 Escape', () => {
    const { container, rerender } = render(<ConfirmDialog />);
    expect(container.innerHTML).toBe('');
    const onSave = vi.fn(async () => undefined);
    const onDiscard = vi.fn(async () => undefined);
    act(() => useProject.setState({ confirm: { title: '새 프로젝트', message: '저장할까요?', onSave, onDiscard } }));
    rerender(<ConfirmDialog />);
    const dialog = screen.getByRole('alertdialog', { name: '새 프로젝트' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('저장할까요?')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '저장' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '저장하지 않음' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(useProject.getState().confirm).toBeNull();
  });

  it('취소 버튼은 confirm 을 지운다', () => {
    act(() =>
      useProject.setState({
        confirm: { title: 't', message: 'm', onSave: async () => undefined, onDiscard: async () => undefined },
      }),
    );
    render(<ConfirmDialog />);
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(useProject.getState().confirm).toBeNull();
  });
});

describe('RecoveryDialog', () => {
  it('후보가 없거나 닫혀 있으면 그리지 않는다', () => {
    const { container } = render(<RecoveryDialog />);
    expect(container.innerHTML).toBe('');
    act(() => useProject.setState({ recoveryOpen: true, candidates: [] }));
    expect(container.innerHTML).toBe('');
  });

  it('후보 하나: 문구와 복구·나중에·버리기', async () => {
    const engine = await connect({ desktop: true, recovery: [cand('1', { projectPath: '/p/a.fcproj' })] });
    await useProject.getState().openRecovery();
    render(<RecoveryDialog />);
    const dialog = screen.getByRole('dialog', { name: '저장하지 않은 변경 복구' });
    expect(dialog).toHaveTextContent("이전 세션이 예기치 않게 종료되어 'p1' 의 저장하지 않은 변경이 남아 있습니다 (2026-10-14 01:00:00). 되살릴까요?");
    expect(screen.getByText('원본 파일: /p/a.fcproj')).toBeInTheDocument();
    expect(screen.queryByLabelText('후보')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '복구' }));
    fireEvent.click(screen.getByRole('button', { name: '나중에' }));
    expect(useProject.getState().recoveryOpen).toBe(false);
    await useProject.getState().openRecovery();
    fireEvent.click(screen.getByRole('button', { name: '복구' }));
    await vi.waitFor(() => expect(engine.callsOf('file.recover')).toEqual([{ id: '1' }]));
  });

  it('정상 종료 후보는 문구가 다르고, 여러 후보는 select 로 고른다', async () => {
    const engine = await connect({ desktop: true, recovery: [cand('1', { cleanExit: true }), cand('2')] });
    await useProject.getState().openRecovery();
    render(<RecoveryDialog />);
    expect(screen.getByRole('dialog')).toHaveTextContent("이전 세션이 닫힐 때 'p1' 의");
    const pick = screen.getByLabelText('후보') as HTMLSelectElement;
    expect(pick.options).toHaveLength(2);
    fireEvent.change(pick, { target: { value: '2' } });
    expect(screen.getByRole('dialog')).toHaveTextContent("예기치 않게 종료되어 'p2' 의");
    fireEvent.click(screen.getByRole('button', { name: '버리기' }));
    await vi.waitFor(() => expect(engine.callsOf('file.discardRecovery')).toEqual([{ id: '2' }]));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(useProject.getState().recoveryOpen).toBe(false);
  });
});

describe('ExportDialog', () => {
  it('닫혀 있으면 그리지 않는다', () => {
    const { container } = render(<ExportDialog />);
    expect(container.innerHTML).toBe('');
  });

  it('데스크톱: 프리셋·형식·경로·결과 요약, 찾아보기 뒤 내보내기 활성', async () => {
    const { engine } = engineWithClips({ desktop: true });
    await connect({}, engine);
    render(<ExportDialog />);
    await act(() => useExport.getState().show());
    expect(screen.getByRole('dialog', { name: '내보내기' })).toBeInTheDocument();
    const preset = screen.getByLabelText('프리셋') as HTMLSelectElement;
    expect([...preset.options].map((o) => o.textContent)).toEqual([
      '1080p 가로 (1920 x 1080)',
      '720p 가로 (1280 x 720)',
      '세로 9:16 (1080 x 1920)',
      '정사각 1:1 (1080 x 1080)',
      '시퀀스 원본 크기',
    ]);
    expect((screen.getByLabelText('형식') as HTMLSelectElement).options).toHaveLength(1);
    expect(screen.getByText('1920 x 1080, 30 fps, 8.0초 (240 프레임), 약 20 Mbps')).toBeInTheDocument();
    const start = screen.getByRole('button', { name: '내보내기' });
    expect(start).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '찾아보기' }));
    await vi.waitFor(() => expect(screen.getByLabelText('저장 위치')).toHaveValue('/tmp/fake/out.mp4'));
    expect(start).toBeEnabled();
    fireEvent.change(preset, { target: { value: '720p' } });
    await vi.waitFor(() => expect(screen.getByText(/1280 x 720/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(useExport.getState().open).toBe(false);
  });

  it('웹: 안내 문구와 비활성 찾아보기', async () => {
    const { engine } = engineWithClips();
    await connect({}, engine);
    render(<ExportDialog />);
    await act(() => useExport.getState().show());
    expect(screen.getByText('웹 내보내기는 준비 중입니다. 데스크톱 앱에서 내보내 주세요.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '찾아보기' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '내보내기' })).toBeDisabled();
    expect(screen.getByLabelText('저장 위치')).toHaveAttribute('placeholder', '데스크톱 앱에서만 고를 수 있습니다');
  });

  it('시퀀스가 없으면 문제를 알리고, Escape 로 닫는다', async () => {
    await connect({ desktop: true });
    render(<ExportDialog />);
    await act(() => useExport.getState().show());
    expect(screen.getByRole('alert')).toHaveTextContent('내보낼 시퀀스가 없습니다');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(useExport.getState().open).toBe(false);
  });

  it('진행 중에는 진행률과 취소만 보이고 Escape 가 막힌다', async () => {
    const { engine } = engineWithClips({ desktop: true });
    await connect({}, engine);
    render(<ExportDialog />);
    await act(() => useExport.getState().show());
    act(() =>
      useExport.setState({
        job: {
          id: 1,
          job: 1,
          path: '/x.mp4',
          preset: '',
          format: 'h264',
          status: 'encoding',
          statusText: '',
          progress: 0.42,
          etaSeconds: 7,
          error: null,
          sequenceName: 's',
        },
      }),
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByText('남은 시간 약 7초')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '내보내기' })).toBeNull();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(useExport.getState().open).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    await vi.waitFor(() => expect(engine.callsOf('export.queue.cancel')).toEqual([{ id: 1 }]));
    act(() => useExport.setState({ job: { ...useExport.getState().job!, status: 'ready' } }));
    expect(screen.getByText('시작 중')).toBeInTheDocument();
    act(() => useExport.setState({ job: null, outcome: { kind: 'success', text: '끝' } }));
    expect(screen.getByRole('status')).toHaveTextContent('끝');
  });

  it('Enter 는 버튼 밖에서 내보내기를 시작한다', async () => {
    const { engine } = engineWithClips({ desktop: true });
    await connect({}, engine);
    render(<ExportDialog />);
    await act(() => useExport.getState().show());
    await act(() => useExport.getState().browse());
    fireEvent.keyDown(screen.getByLabelText('프리셋'), { key: 'Enter' });
    await vi.waitFor(() => expect(engine.callsOf('export.queue.add')).toHaveLength(1));
  });
});
