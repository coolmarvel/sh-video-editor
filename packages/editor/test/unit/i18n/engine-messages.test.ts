/** features/i18n/engine-messages.ts: 엔진 영어 토스트 번역표, 프로젝트 이름 표기. */
import { describe, expect, it } from 'vitest';
import { displayProjectName, translateEngineMessage } from '@editor/features/i18n/engine-messages';

describe('translateEngineMessage', () => {
  it.each([
    ['Recovered unsaved changes to Untitled from 2026-10-15 14:44:06', "'제목 없음' 의 저장하지 않은 변경을 되살렸습니다 (2026-10-15 14:44:06).", 'recover'],
    ['Recovered unsaved changes to 여행 from 2026-10-15 14:44:06', "'여행' 의 저장하지 않은 변경을 되살렸습니다 (2026-10-15 14:44:06).", 'recover'],
    ['Scene Edit Detection found no cut points', '장면이 바뀌는 곳을 찾지 못했습니다.', 'sceneDetect'],
    ['Scene Edit Detection: 3 cut point(s)', '장면 3곳에서 잘랐습니다.', 'sceneDetect'],
    ['Scene Edit Detection: decode failed', '장면을 찾지 못했습니다: decode failed', 'sceneDetect'],
    ['Export queue finished', '내보내기를 마쳤습니다.', 'export'],
    ['Export queue finished (2 failed)', '내보내기를 마쳤습니다(실패 2개).', 'export'],
    ['Nothing to render: previews are up to date', '다시 그릴 미리보기가 없습니다. 이미 최신입니다.', null],
    ['Nothing to render: audio previews are up to date', '다시 만들 소리 미리보기가 없습니다. 이미 최신입니다.', null],
    ['Deleted 1 render file', '렌더 파일 1개를 지웠습니다.', null],
    ['Deleted 4 render files', '렌더 파일 4개를 지웠습니다.', null],
    ['Installed graphics template "Lower Third"', '그래픽 템플릿 "Lower Third" 을 설치했습니다.', null],
    ['2 media file(s) are missing; File ▸ Link Media… reconnects them', '미디어 파일 2개를 찾을 수 없습니다.', 'open'],
    ['Exported frame to /tmp/a.png', '프레임을 저장했습니다: /tmp/a.png', null],
    ['Audio during scrubbing on', '스크럽할 때 소리를 켰습니다.', null],
    ['Audio during scrubbing off', '스크럽할 때 소리를 껐습니다.', null],
    [
      'Upgraded project from schema v3 to v4; the original is kept as a backup when you save',
      '프로젝트를 새 형식(v3 에서 v4)으로 바꿨습니다. 저장하면 원본은 백업으로 남습니다.',
      'open',
    ],
    [
      'clip.mp4: the file is truncated: 10 of 300 video samples are past its end and cannot be decoded',
      'clip.mp4: 파일이 잘렸습니다. video 샘플 300개 중 10개가 파일 끝 너머에 있어 재생할 수 없습니다.',
      null,
    ],
    ['Saved', '저장했습니다.', 'save'],
  ])('%s', (en, ko, key) => {
    expect(translateEngineMessage(en)).toEqual({ text: ko, key });
  });

  it('모르는 문구는 그대로(정보를 잃지 않는다)', () => {
    expect(translateEngineMessage('disk full')).toEqual({ text: 'disk full', key: null });
  });
});

describe('displayProjectName', () => {
  it('엔진의 Untitled 만 제목 없음으로', () => {
    expect(displayProjectName('Untitled')).toBe('제목 없음');
    expect(displayProjectName('Untitled 2')).toBe('Untitled 2');
    expect(displayProjectName('여행')).toBe('여행');
  });
});
