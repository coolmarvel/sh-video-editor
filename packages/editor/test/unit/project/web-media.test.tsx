/**
 * 웹 미디어 보관(features/project/web-media): 복사 뒤 목록 기록, 다시 등록, 끊긴 복사·크기 틀린 항목 정리, 공간 부족, 같은 파일
 * 건너뛰기, 참조 없는 오래된 항목 정리, 사용량. 그리고 열기 대화상자의 저장 공간 줄.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HEADROOM, MEDIA_INDEX, MIN_AGE_MS, WebMediaStore, formatBytes, parseIndex, referencedIn, type MediaFs } from '@editor/features/project/web-media';
import { WebFilesDialog, storageText } from '@editor/features/project/WebFilesDialog';
import { useWebFiles } from '@editor/features/project/web-store';
import { useEditor } from '@editor/store';
import { FakeEngine } from '../../fake-bridge';

/** 메모리 OPFS. copyIn 은 실패를 흉내 낼 수 있다 */
class MemFs implements MediaFs {
  files = new Map<string, Uint8Array>();
  quota = 10_000_000;
  failCopy = false;
  copies = 0;
  async readText(rel: string) {
    const b = this.files.get(rel);
    return b ? new TextDecoder().decode(b) : null;
  }
  async writeText(rel: string, text: string) {
    this.files.set(rel, new TextEncoder().encode(text));
  }
  async listFiles(dir: string) {
    return [...this.files.keys()].filter((k) => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes('/')).map((k) => k.slice(dir.length + 1));
  }
  async getFile(rel: string) {
    const b = this.files.get(rel);
    return b ? new File([b as BlobPart], rel.split('/').pop() ?? 'f') : null;
  }
  async copyIn(rel: string, blob: Blob) {
    this.files.set(rel, new Uint8Array(0));
    if (this.failCopy) throw new Error('disk full');
    this.files.set(rel, new Uint8Array(await blob.arrayBuffer()));
    this.copies += 1;
  }
  async remove(rel: string) {
    this.files.delete(rel);
  }
  async estimate() {
    let usage = 0;
    for (const b of this.files.values()) usage += b.length;
    return { usage, quota: this.quota };
  }
}

const file = (name: string, size: number, lastModified = 1000) => new File([new Uint8Array(size).fill(7) as BlobPart], name, { lastModified });

function store(fs: MemFs, now = { t: 1_000_000 }) {
  let n = 0;
  return new WebMediaStore(fs, { now: () => now.t, newName: () => `m${++n}.mp4` });
}

describe('WebMediaStore', () => {
  it('복사가 끝난 파일만 목록에 적고, 다음 시작 때 같은 경로로 다시 등록한다', async () => {
    const fs = new MemFs();
    const a = store(fs);
    expect(await a.persist('/files/여행.mp4', file('여행.mp4', 300))).toBe('copied');
    expect(fs.files.get('media/m1.mp4')?.length).toBe(300);
    expect(parseIndex(await fs.readText(MEDIA_INDEX))).toEqual([
      { path: '/files/여행.mp4', file: 'm1.mp4', size: 300, lastModified: 1000, addedUnix: 1_000_000 },
    ]);

    const registered: Array<[string, number]> = [];
    const b = store(fs);
    expect(await b.restore((p, f) => registered.push([p, f.size]))).toEqual({ restored: 1, dropped: 0 });
    expect(registered).toEqual([['/files/여행.mp4', 300]]);
  });

  it('같은 경로·크기·수정 시각이면 다시 복사하지 않고, 크기가 바뀌면 옛 사본을 바꾼다', async () => {
    const fs = new MemFs();
    const s = store(fs);
    await s.persist('/files/a.mp4', file('a.mp4', 10));
    expect(await s.persist('/files/a.mp4', file('a.mp4', 10))).toBe('exists');
    expect(fs.copies).toBe(1);
    expect(await s.persist('/files/a.mp4', file('a.mp4', 20, 2000))).toBe('copied');
    expect(fs.files.has('media/m1.mp4')).toBe(false);
    expect(s.list()).toHaveLength(1);
    expect(s.list()[0]).toMatchObject({ file: 'm2.mp4', size: 20 });
  });

  it('남은 공간이 크기의 HEADROOM 배보다 작으면 복사하지 않는다', async () => {
    const fs = new MemFs();
    fs.quota = Math.floor(100 * HEADROOM) - 1;
    const s = store(fs);
    expect(await s.persist('/files/big.mp4', file('big.mp4', 100))).toBe('noSpace');
    expect(fs.copies).toBe(0);
    expect(s.list()).toEqual([]);
  });

  it('복사가 실패하면 반쯤 쓴 파일을 지우고 목록에 넣지 않는다', async () => {
    const fs = new MemFs();
    fs.failCopy = true;
    const s = store(fs);
    expect(await s.persist('/files/x.mp4', file('x.mp4', 10))).toBe('failed');
    expect(s.lastError).toContain('disk full');
    expect(fs.files.has('media/m1.mp4')).toBe(false);
    expect(s.pending).toBe(0);
  });

  it('delayMs 만큼 기다린 뒤 복사하고, idle 은 그 지연까지 기다린다', async () => {
    const fs = new MemFs();
    const s = new WebMediaStore(fs, { delayMs: 30, newName: () => 'd.mp4' });
    const t0 = Date.now();
    const p = s.persist('/files/d.mp4', file('d.mp4', 5));
    expect(s.pending).toBe(1);
    await s.idle();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
    expect(await p).toBe('copied');
    expect(s.pending).toBe(0);
  });

  it('목록 파일을 쓰지 못하면 사본을 지우고 실패로 끝난다', async () => {
    const fs = new MemFs();
    const s = store(fs);
    fs.writeText = async () => {
      throw new Error('quota');
    };
    expect(await s.persist('/files/q.mp4', file('q.mp4', 5))).toBe('failed');
    expect(s.lastError).toContain('quota');
    expect(fs.files.has('media/m1.mp4')).toBe(false);
    expect(s.list()).toEqual([]);
  });

  it('프로젝트 파일(.fcproj)은 보관하지 않는다', async () => {
    const fs = new MemFs();
    expect(await store(fs).persist('/files/p.fcproj', file('p.fcproj', 10))).toBe('skipped');
    expect(fs.files.size).toBe(0);
  });

  it('restore 는 크기가 틀린 항목과 목록에 없는 파일(끊긴 복사)을 지운다', async () => {
    const fs = new MemFs();
    const s = store(fs);
    await s.persist('/files/a.mp4', file('a.mp4', 10));
    await s.persist('/files/b.mp4', file('b.mp4', 10));
    fs.files.set('media/m2.mp4', new Uint8Array(3)); // 잘린 사본
    fs.files.set('media/orphan.mp4', new Uint8Array(5)); // 목록에 없는 파일
    const paths: string[] = [];
    expect(await store(fs).restore((p) => paths.push(p))).toEqual({ restored: 1, dropped: 2 });
    expect(paths).toEqual(['/files/a.mp4']);
    expect([...fs.files.keys()].sort()).toEqual(['media/index.json', 'media/m1.mp4']);
    expect(parseIndex(await fs.readText(MEDIA_INDEX)).map((e) => e.path)).toEqual(['/files/a.mp4']);
  });

  it('gc 는 참조가 없고 하루보다 오래된 항목만 지운다', async () => {
    const fs = new MemFs();
    const now = { t: 1_000_000 };
    const s = store(fs, now);
    await s.persist('/files/old-used.mp4', file('o1.mp4', 1));
    await s.persist('/files/old-free.mp4', file('o2.mp4', 1));
    now.t += MIN_AGE_MS + 1;
    await s.persist('/files/new-free.mp4', file('n.mp4', 1));
    const project = JSON.stringify({ media: [{ path: '/files/old-used.mp4' }] });
    expect(await s.gc([project])).toBe(1);
    expect(s.list().map((e) => e.path)).toEqual(['/files/old-used.mp4', '/files/new-free.mp4']);
    expect(fs.files.has('media/m2.mp4')).toBe(false);
  });

  it('usage 는 보관 수·바이트·사이트 사용량과 복사 중인 수를 준다', async () => {
    const fs = new MemFs();
    const s = store(fs);
    await s.persist('/files/a.mp4', file('a.mp4', 1500));
    const u = await s.usage();
    expect(u).toMatchObject({ files: 1, bytes: 1500, quota: 10_000_000, pending: 0 });
    expect(u.usage).toBeGreaterThanOrEqual(1500);
  });

  it('referencedIn 은 JSON 이스케이프한 경로로 찾는다', () => {
    const path = '/files/a "b".mp4';
    expect(referencedIn([JSON.stringify({ p: path })], path)).toBe(true);
    expect(referencedIn([JSON.stringify({ p: '/files/a.mp4' })], '/files/a')).toBe(false);
  });

  it('parseIndex 는 깨진 목록·이상한 항목을 버린다', () => {
    expect(parseIndex('not json')).toEqual([]);
    expect(parseIndex(JSON.stringify({ files: [{ path: '/files/a', file: '../x', size: 1 }, { path: 1 }] }))).toEqual([]);
  });

  it('formatBytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1.2 * 1024 ** 3)).toBe('1.2 GB');
    expect(formatBytes(250 * 1024 ** 2)).toBe('250 MB');
  });
});

describe('열기 대화상자의 저장 공간 줄', () => {
  it('storageText', () => {
    expect(storageText({ files: 2, bytes: 3 * 1024 ** 2, usage: null, quota: null, pending: 0 })).toBe('보관한 미디어 2개 (3.0 MB).');
    expect(storageText({ files: 1, bytes: 1024, usage: 2048, quota: 1024 ** 3, pending: 1 })).toBe(
      '보관한 미디어 1개 (1.0 KB), 복사 중 1개. 사이트 사용량 2.0 KB / 한도 1.0 GB.',
    );
  });

  it('호스트가 mediaUsage 를 주면 열기 대화상자에 보인다', async () => {
    const bridge = new FakeEngine({ web: true }).bridge;
    bridge.opfs!.mediaUsage = async () => ({ files: 3, bytes: 1024 ** 2, usage: 5 * 1024 ** 2, quota: 1024 ** 3, pending: 0 });
    useEditor.setState({ bridge });
    render(<WebFilesDialog />);
    await useWebFiles.getState().showOpen();
    expect((await screen.findByTestId('web-storage')).textContent).toBe('보관한 미디어 3개 (1.0 MB). 사이트 사용량 5.0 MB / 한도 1.0 GB.');
    useWebFiles.getState().close();
  });
});
