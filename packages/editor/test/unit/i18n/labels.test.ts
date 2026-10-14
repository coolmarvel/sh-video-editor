/**
 * features/i18n/labels.ko.ts: 메뉴에 노출되는 엔진 커맨드의 한글 사전(M4-9). 실제 엔진 카탈로그 전수 검사는
 * packages/engine/tests/i18n.test.ts 가 하고, 여기서는 가짜 엔진 카탈로그와 변환 규칙·표기 규칙을 본다.
 */
import { describe, expect, it } from 'vitest';
import {
  COMMAND_LABELS_KO,
  EFFECT_NAMES_KO,
  HISTORY_LABELS_KO,
  HISTORY_PATTERNS_KO,
  commandLabelKo,
  historyLabelKo,
  needsTranslation,
  untranslatedMenuCommands,
} from '@editor/features/i18n';
import { FAKE_COMMANDS } from '../../fake-bridge';

/** 문서·UI 문구에 쓰지 않는 기호(CLAUDE.md 협업 규칙, DESIGN.md 10절): em-dash, 유니코드 화살표, 원문자, 말줄임표 한 글자, 이모지 */
const FORBIDDEN = /[—…←-⇿①-⓿☀-➿]|\p{Extended_Pictographic}/u;

describe('COMMAND_LABELS_KO', () => {
  it('가짜 엔진 카탈로그에서 메뉴 경로가 있는 커맨드는 전부 번역이 있다', () => {
    // 가짜 엔진에만 있는 id(실제 카탈로그에 없어 사전에 넣지 않는다. 엔진 테스트가 사전의 군더더기를 막는다)
    const fakeOnly = new Set(['view.zoomIn', 'help.about']);
    expect(untranslatedMenuCommands(FAKE_COMMANDS.filter((c) => !fakeOnly.has(c.id)))).toEqual([]);
    expect(needsTranslation({ menu: ['Edit'] })).toBe(true);
    expect(needsTranslation({ menu: [] })).toBe(false);
  });

  it('사전 값은 비어 있지 않은 한글이고 금지 기호가 없다', () => {
    const all = [...Object.values(COMMAND_LABELS_KO), ...Object.values(HISTORY_LABELS_KO), ...Object.values(EFFECT_NAMES_KO)];
    expect(all.length).toBeGreaterThan(250);
    for (const v of all) {
      expect(v.trim(), v).toBe(v);
      expect(v.length, v).toBeGreaterThan(0);
      expect(FORBIDDEN.test(v), `금지 기호: ${v}`).toBe(false);
    }
    for (const [, t] of HISTORY_PATTERNS_KO) expect(t).toContain('{}');
    // 메뉴 경로가 있는 커맨드 수(2026-10-14 엔진 카탈로그 253개)만큼 들어 있다
    expect(Object.keys(COMMAND_LABELS_KO).length).toBeGreaterThanOrEqual(253);
  });

  it('commandLabelKo: 사전 -> 엔진 라벨 -> id 순으로 고른다', () => {
    expect(commandLabelKo('edit.clear', 'Clear')).toBe('삭제');
    expect(commandLabelKo('x.unknown', 'Unknown')).toBe('Unknown');
    expect(commandLabelKo('x.unknown')).toBe('x.unknown');
  });
});

describe('historyLabelKo', () => {
  it('history 사전의 문구를 바꾼다', () => {
    expect(historyLabelKo('Clear')).toBe('삭제');
    expect(historyLabelKo('Razor')).toBe('자르기');
    expect(historyLabelKo('Speed/Duration')).toBe('속도, 길이');
    expect(historyLabelKo('Remove Effect')).toBe('효과 제거');
    expect(historyLabelKo('Change Effect Parameter')).toBe('효과 값 변경');
  });

  it('카탈로그에서 같은 라벨의 커맨드를 찾아 커맨드 사전으로 바꾼다(말줄임표는 뗀다)', () => {
    const commands = [
      { id: 'sequence.addTracks', label: 'Add Tracks…' },
      { id: 'markers.markIn', label: 'Mark In' },
    ];
    expect(historyLabelKo('Mark In', commands)).toBe('인 점 표시');
    expect(historyLabelKo('Add Tracks', commands)).toBe('트랙 추가');
  });

  it('이름이 붙는 꼴은 접두만 바꾸고 효과 이름은 화면 이름으로', () => {
    expect(historyLabelKo('Apply Brightness & Contrast')).toBe('밝기와 대비 적용');
    expect(historyLabelKo('Apply Teal Shadows, Warm Skin')).toBe('Teal Shadows, Warm Skin 적용');
    expect(historyLabelKo('Import clip.mp4')).toBe('가져오기: clip.mp4');
    expect(historyLabelKo('Import Captions ko.srt')).toBe('자막 가져오기: ko.srt');
    expect(historyLabelKo('Add Track Effect Reverb')).toBe('트랙 효과 추가: Reverb');
  });

  it('모르는 문구와 이미 한글인 문구는 그대로 둔다', () => {
    expect(historyLabelKo('Frobnicate')).toBe('Frobnicate');
    expect(historyLabelKo('화면 비율 세로 9:16')).toBe('화면 비율 세로 9:16');
    expect(historyLabelKo('')).toBe('');
  });
});
