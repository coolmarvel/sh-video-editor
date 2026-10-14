/** 웹 내보내기: 엔진 가상 경로에 쓰고, 끝나면 onFileWritten 으로 받은 바이트를 다운로드한다. 진행률·취소는 그대로. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useExport } from '@editor/features/export/store';
import { captureWrittenFile, exportDownload, isWebExport, webExportPath } from '@editor/features/export/web-download';
import { engineWithClips, FakeEngine } from '../../fake-bridge';
import { connect, flush, resetStores } from '../../stores';

beforeEach(resetStores);

const ex = () => useExport.getState();

async function webReady(): Promise<FakeEngine> {
  const { engine } = engineWithClips({ web: true, exportStep: 0.5 });
  engine.state.name = '내 프로젝트';
  await connect({}, engine);
  return engine;
}

describe('웹 내보내기', () => {
  it('isWebExport 와 경로', () => {
    expect(isWebExport(new FakeEngine({ web: true }).bridge)).toBe(true);
    expect(isWebExport(new FakeEngine({ desktop: true }).bridge)).toBe(false);
    expect(webExportPath('a/b.mp4')).toBe('/exports/a_b.mp4');
  });

  it('show 는 경로를 /exports/<프로젝트 이름>.mp4 로 정하고, 끝나면 다운로드한다', async () => {
    vi.useFakeTimers();
    const engine = await webReady();
    const downloaded: Array<{ name: string; bytes: Uint8Array; mime?: string }> = [];
    exportDownload.fn = (name, bytes, mime) => downloaded.push({ name, bytes, mime });
    await ex().show();
    expect(ex().path).toBe('/exports/내 프로젝트.mp4');
    await ex().start();
    expect(ex().job?.status).toBe('encoding');
    for (let i = 0; i < 6 && ex().outcome === null; i++) {
      await vi.advanceTimersByTimeAsync(60);
      await vi.advanceTimersByTimeAsync(600);
    }
    expect(ex().outcome?.kind).toBe('success');
    expect(ex().outcome?.text).toContain('내 프로젝트.mp4');
    expect(ex().outcome?.text).toContain('다운로드');
    expect(downloaded).toHaveLength(1);
    expect(downloaded[0]?.name).toBe('내 프로젝트.mp4');
    expect(downloaded[0]?.mime).toBe('video/mp4');
    expect(downloaded[0]!.bytes.length).toBeGreaterThan(0);
    // 구독자가 받아 갔으므로 엔진에 남지 않는다
    expect(engine.written.size).toBe(0);
    expect(engine.writeListeners.size).toBe(0);
  });

  it('취소하면 다운로드하지 않는다', async () => {
    vi.useFakeTimers();
    const engine = await webReady();
    const downloaded: string[] = [];
    exportDownload.fn = (name) => downloaded.push(name);
    await ex().show();
    await ex().start();
    await ex().cancel();
    await vi.advanceTimersByTimeAsync(200);
    expect(ex().outcome?.kind).toBe('warning');
    expect(downloaded).toEqual([]);
    ex().hide();
    expect(engine.writeListeners.size).toBe(0);
  });

  it('captureWrittenFile: 늦게 온 바이트도 받고, 못 받으면 takeWrittenFile 로 꺼낸다', async () => {
    const engine = new FakeEngine({ web: true });
    const cap = captureWrittenFile(engine.bridge, '/exports/a.mp4');
    engine.writeFile('/exports/other.mp4', new Uint8Array([1]));
    const pending = cap.take();
    engine.writeFile('/exports/a.mp4', new Uint8Array([7, 8]));
    expect(Array.from((await pending)!)).toEqual([7, 8]);
    cap.dispose();
    const cap2 = captureWrittenFile(engine.bridge, '/exports/b.mp4');
    cap2.dispose();
    engine.writeFile('/exports/b.mp4', new Uint8Array([9]));
    expect(await cap2.take()).toBeNull();
    const cap3 = captureWrittenFile(engine.bridge, '/exports/c.mp4');
    engine.writeListeners.clear();
    engine.writeFile('/exports/c.mp4', new Uint8Array([3]));
    expect(Array.from((await cap3.take())!)).toEqual([3]);
    cap3.dispose();
  });
});
