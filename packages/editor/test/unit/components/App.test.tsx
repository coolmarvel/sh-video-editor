/** App.tsx: 셸 전체를 가짜 엔진으로 띄워 상태 줄·패널이 연결되는지(통합에 가까운 단위 테스트). */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '@editor/App';
import { FakeEngine } from '../../fake-bridge';
import { resetStores } from '../../stores';

beforeEach(resetStores);

describe('App', () => {
  it('엔진에 연결되면 상태 줄에 준비됨과 버전, 호스트 이름을 보인다', async () => {
    const engine = new FakeEngine({ desktop: true });
    render(<App bridge={engine.bridge} host="desktop" />);
    await vi.waitFor(() => expect(screen.getByText(/^준비됨: 커맨드 \d+개$/)).toBeInTheDocument());
    expect(screen.getByText('데스크톱')).toBeInTheDocument();
    expect(screen.getByText(/sh-video-engine/)).toBeInTheDocument();
    expect(screen.getByRole('menubar')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '미디어' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '미리보기' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '타임라인' })).toBeInTheDocument();
    expect(document.title).toBe('제목 없음 - SH Video Editor');
  });

  it('웹 호스트는 가져오기 버튼이 없고 데모 영상 안내가 있다', async () => {
    const engine = new FakeEngine();
    render(<App bridge={engine.bridge} host="web" />);
    await vi.waitFor(() => expect(screen.getByText('웹')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '가져오기' })).toBeNull();
    expect(screen.getByText('데모 영상 메뉴에서 생성 영상을 넣어 바로 시험할 수 있습니다.')).toBeInTheDocument();
  });

  it('데모 영상을 넣고 타임라인에 넣으면 편집본이 생기고 타임라인과 모니터가 채워진다', async () => {
    const engine = new FakeEngine({ desktop: true });
    render(<App bridge={engine.bridge} host="desktop" />);
    await vi.waitFor(() => expect(screen.getByText(/^준비됨/)).toBeInTheDocument());
    expect(screen.getByText('타임라인이 비어 있습니다. 미디어를 타임라인에 넣으면 여기에 보입니다.')).toBeInTheDocument();
    // 편집본이 없으면 타임라인 자리에 안내 카드가 있다
    expect(screen.getByLabelText('사용 안내')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '데모 영상' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '오로라' }));
    await vi.waitFor(() => expect(screen.getByText(/데모 영상을 넣었습니다/)).toBeInTheDocument());
    expect(engine.callsOf('file.importDemoFootage')).toEqual([{ scene: 'Aurora' }]);
    fireEvent.click(screen.getByRole('button', { name: '타임라인에 넣기' }));
    // 편집본 이름은 프로젝트 이름(제목 없음)을 따른다
    await vi.waitFor(() => expect(screen.getByText('타임라인 - 제목 없음')).toBeInTheDocument());
    expect(engine.callsOf('file.newSequence')).toEqual([{ name: '제목 없음', fromItem: engine.state.items[0]!.item }]);
    const timeline = screen.getByRole('region', { name: '타임라인' });
    await vi.waitFor(() => expect(timeline.querySelectorAll('.tl-clip')).toHaveLength(2));
    await vi.waitFor(() => expect(screen.getByTestId('mon-total')).toHaveTextContent('00:00:16:00'));
    // 프로젝트 상태는 1초 주기로 읽는다
    await vi.waitFor(() => expect(screen.getByText('수정됨')).toBeInTheDocument(), { timeout: 3000 });
    expect(document.title).toBe('제목 없음 (수정됨) - SH Video Editor');
  });

  it('엔진 오류는 상태 줄에 오류로', async () => {
    const engine = new FakeEngine();
    engine.bridge.version = async () => {
      throw new Error('연결 안 됨');
    };
    render(<App bridge={engine.bridge} host="web" />);
    await vi.waitFor(() => expect(screen.getByText('오류: 연결 안 됨')).toBeInTheDocument());
    expect(screen.getByText('엔진 없음')).toBeInTheDocument();
  });

  it('타임라인 키보드: 새 편집본 뒤 Ctrl+K 자르기 안내, S 로 스냅 토글', async () => {
    const engine = new FakeEngine();
    render(<App bridge={engine.bridge} host="web" />);
    await vi.waitFor(() => expect(screen.getByText(/^준비됨/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '파일' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /새 편집본/ }));
    await vi.waitFor(() => expect(screen.getByText('타임라인 - 제목 없음')).toBeInTheDocument());
    const timeline = screen.getByRole('region', { name: '타임라인' });
    fireEvent.keyDown(timeline, { key: 'k', ctrlKey: true });
    await vi.waitFor(() => expect(screen.getByText('플레이헤드 아래에 클립이 없습니다')).toBeInTheDocument());
    const snap = within(timeline).getByRole('button', { name: '스냅' });
    expect(snap).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(timeline, { key: 's' });
    await vi.waitFor(() => expect(snap).toHaveAttribute('aria-pressed', 'false'));
    expect(engine.callsOf('sequence.snap')).toEqual([{ on: false }]);
  });
});
