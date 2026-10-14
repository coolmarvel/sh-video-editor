import { beforeEach, describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND as T } from '../../../src/engine/time';
import { toCaptionTracks, useCaptions } from '../../../src/features/text/captions-store';
import { useTimeline } from '../../../src/features/timeline/store';
import { engineWithClips, type FakeEngine } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

let engine: FakeEngine;

async function setup(opts: { desktop?: boolean; web?: boolean } = {}) {
  resetStores();
  engine = engineWithClips(opts).engine;
  await connect(opts, engine);
  await useTimeline.getState().refresh();
}

describe('자막 store', () => {
  beforeEach(() => setup());

  it('트랙이 없으면 자막 추가가 트랙부터 만든다', async () => {
    await useTimeline.getState().setPlayhead(1 * T);
    const id = await useCaptions.getState().addCaption('첫 자막');
    expect(id).not.toBeNull();
    const s = useCaptions.getState();
    expect(s.tracks).toHaveLength(1);
    expect(s.track).toBe(s.tracks[0]?.id);
    expect(s.tracks[0]?.captions).toEqual([expect.objectContaining({ id, start: 1 * T, end: 4 * T, text: '첫 자막' })]);
    expect(engine.callsOf('captions.add')[0]).toMatchObject({ text: '첫 자막', time: 1 * T, durationSeconds: 3 });
  });

  it('내용·시간을 고치고 지운다. 끝이 시작보다 빠르면 보내지 않는다', async () => {
    const id = (await useCaptions.getState().addCaption()) as number;
    await useCaptions.getState().setText(id, '바뀐 자막');
    await useCaptions.getState().setTimes(id, 2, 1);
    expect(useCaptions.getState().notice?.tone).toBe('danger');
    expect(engine.callsOf('captions.setTimes')).toHaveLength(0);
    await useCaptions.getState().setTimes(id, 2, 3.5);
    const cue = useCaptions.getState().tracks[0]?.captions[0];
    expect(cue).toMatchObject({ text: '바뀐 자막', start: 2 * T, end: 3.5 * T });
    await useCaptions.getState().deleteCaptions([id]);
    expect(useCaptions.getState().tracks[0]?.captions).toEqual([]);
    await useCaptions.getState().deleteTrack();
    expect(useCaptions.getState().tracks).toEqual([]);
  });

  it('스타일은 현재 트랙에 captions.setStyle 로 간다', async () => {
    await useCaptions.getState().addCaption();
    await useCaptions.getState().setStyle({ font: 'Pretendard', size: 64 });
    const track = useCaptions.getState().tracks[0];
    expect(engine.callsOf('captions.setStyle').at(-1)).toEqual({ track: track?.id, font: 'Pretendard', size: 64 });
    expect(track?.style).toMatchObject({ font: 'Pretendard', size: 64 });
  });

  it('captions.list 결과를 화면 모양으로 바꾼다(색은 #rrggbb 로 자른다)', () => {
    const tracks = toCaptionTracks({
      tracks: [
        {
          id: 5,
          label: 'C1',
          name: '자막',
          captions: [{ id: 6, start: 0, end: T, text: 'a', in: '00:00:00:00', out: '00:00:01:00' }],
          style: { color: '#ffffffff', backgroundColor: '#000000bf' },
        },
      ],
    });
    expect(tracks[0]?.style.color).toBe('#ffffff');
    expect(tracks[0]?.style.backgroundColor).toBe('#000000');
    expect(tracks[0]?.style.font).toBe('Pretendard');
    expect(toCaptionTracks(null)).toEqual([]);
  });

  it('데스크톱: 파일 대화상자 경로로 captions.import, 저장 경로로 captions.export', async () => {
    await setup({ desktop: true });
    engine.pickOpenResult = '/tmp/fake/intro.srt';
    engine.files.set('/tmp/fake/intro.srt', '1\n00:00:00,500 --> 00:00:02,000\n안녕하세요\n\n2\n00:00:03,000 --> 00:00:05,000\nHello\n');
    await useCaptions.getState().importSrt();
    const s = useCaptions.getState();
    expect(s.tracks[0]?.name).toBe('intro');
    expect(s.tracks[0]?.captions.map((c) => c.text)).toEqual(['안녕하세요', 'Hello']);
    expect(s.notice).toEqual({ tone: 'success', text: '자막 2개를 가져왔습니다' });
    engine.pickSaveResult = '/tmp/fake/out';
    await useCaptions.getState().exportSrt();
    expect(engine.callsOf('captions.export').at(-1)).toMatchObject({ path: '/tmp/fake/out.srt', format: 'srt' });
    expect(engine.files.get('/tmp/fake/out.srt')).toContain('00:00:00,500 --> 00:00:02,000\n안녕하세요');
    expect(useCaptions.getState().notice?.text).toContain('자막 2개를 내보냈습니다');
  });

  it('웹: File 을 등록해 가져오고, 내보낸 바이트는 takeWrittenFile 로 꺼낸다', async () => {
    await setup({ web: true });
    const file = new File(['1\n00:00:01,000 --> 00:00:02,000\n웹 자막\n'], 'web.srt', { type: 'text/plain' });
    await useCaptions.getState().importSrt(file);
    expect(engine.callsOf('captions.import')[0]).toEqual({ path: '/files/web.srt', name: 'web' });
    expect(useCaptions.getState().tracks[0]?.captions[0]?.text).toBe('웹 자막');
    // 잘못된 파일은 엔진에 보내지 않는다
    await useCaptions.getState().importSrt(new File(['nothing'], 'bad.srt'));
    expect(engine.callsOf('captions.import')).toHaveLength(1);
    expect(useCaptions.getState().notice?.tone).toBe('danger');
    const clicks: string[] = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    };
    const origUrl = URL.createObjectURL;
    URL.createObjectURL = () => 'blob:fake';
    URL.revokeObjectURL = () => undefined;
    try {
      await useCaptions.getState().exportSrt();
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
      URL.createObjectURL = origUrl;
    }
    expect(engine.callsOf('captions.export').at(-1)).toMatchObject({ path: '/exports/web.srt' });
    expect(clicks).toEqual(['web.srt']);
    expect(engine.written.has('/exports/web.srt')).toBe(false);
  });

  it('시퀀스가 없으면 가져오지 않는다', async () => {
    engine.state.sequence = null;
    await useTimeline.getState().refresh();
    await useCaptions.getState().importSrt();
    expect(useCaptions.getState().notice?.text).toBe('먼저 시퀀스를 만드세요.');
  });
});
