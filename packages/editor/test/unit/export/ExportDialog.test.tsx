/** features/export/ExportDialog: 형식 콤보에 WebM 이 보이고, 고르면 파일 이름·경로의 확장자가 .webm 으로 바뀐다. */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ExportDialog } from '@editor/features/export/ExportDialog';
import { useExport } from '@editor/features/export/store';
import { engineWithClips } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

beforeEach(resetStores);

const ex = () => useExport.getState();

async function opened(desktop = true) {
  const { engine } = engineWithClips(desktop ? { desktop: true } : { web: true });
  engine.state.name = '내 프로젝트';
  await connect({}, engine);
  await act(async () => {
    await ex().show();
  });
  return engine;
}

describe('ExportDialog 형식 콤보', () => {
  it('H.264(mp4)와 WebM(webm)이 보이고 WebM 을 고르면 저장 경로가 .webm 으로 바뀐다', async () => {
    const engine = await opened();
    engine.pickSaveResult = '/tmp/out';
    await act(async () => {
      await ex().browse();
    });
    render(<ExportDialog />);
    const select = screen.getByLabelText('형식') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toEqual(['H.264 (mp4)', 'WebM (VP9 + Opus) (webm)']);
    expect(select.value).toBe('h264');
    expect((screen.getByLabelText('저장 위치') as HTMLInputElement).value).toBe('/tmp/out.mp4');

    await act(async () => {
      fireEvent.change(select, { target: { value: 'webm' } });
    });
    expect(select.value).toBe('webm');
    expect(ex().formatId).toBe('webm');
    expect((screen.getByLabelText('저장 위치') as HTMLInputElement).value).toBe('/tmp/out.webm');
    // 대화상자 안의 SNS 프리셋 카드(features/ratio)도 export.resolve 를 부르므로 마지막 호출이 아니라 포함 여부를 본다
    expect(engine.callsOf('export.resolve')).toContainEqual({ preset: 'WebM 1080p (Web)', format: 'webm' });
    // 프리셋 콤보는 WebM 프리셋 네 가지(원본 크기 없음) 뒤에 SNS 카드(features/ratio)가 그대로 남는다
    const presets = screen.getByLabelText('프리셋') as HTMLSelectElement;
    expect(Array.from(presets.options).map((o) => o.value)).toEqual(['1080p', '720p', '9x16', '1x1', 'sns-youtube', 'sns-shorts', 'sns-instagram', 'sns-4k']);
  });

  it('웹에서는 파일 이름이 <프로젝트 이름>.webm 으로 바뀐다', async () => {
    await opened(false);
    render(<ExportDialog />);
    const select = screen.getByLabelText('형식') as HTMLSelectElement;
    expect((screen.getByLabelText('파일 이름') as HTMLInputElement).value).toBe('내 프로젝트.mp4');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'webm' } });
    });
    expect((screen.getByLabelText('파일 이름') as HTMLInputElement).value).toBe('내 프로젝트.webm');
    expect(ex().path).toBe('/exports/내 프로젝트.webm');
  });
});
