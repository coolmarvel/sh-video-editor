/**
 * docs/guides/usage.md 와 코드의 대조. 문서의 단축키 표는 keymap.ts 에서 생성한 것과 같아야 하고, 문서가 말하는 메뉴 항목·
 * 단축키 이름·버튼 문구는 menu-def/keymap 에 실제로 있어야 한다. 특수기호(em-dash, 화살표, 원문자, 이모지)는 쓰지 않는다.
 */
import { describe, expect, it } from 'vitest';
import { USAGE_MARKDOWN, usageDoc } from '@editor/features/onboarding/usage-doc';
import { KEYMAP } from '@editor/features/shortcuts/keymap';
import { MENUS, type MenuEntry } from '@editor/features/shortcuts/menu-def';
import { parseMarkdownTable, shortcutTableMarkdown } from '@editor/features/shortcuts/shortcut-table';
import { GUIDE_STEPS } from '@editor/features/onboarding/OnboardingCard';
import { DEMO_SCENES } from '@editor/features/media/types';
import { TRANSITIONS } from '@editor/features/transitions/catalog';
import { USER_EFFECTS, PRESET_FOLDERS } from '@editor/features/effects/catalog';
import { TITLE_PRESETS } from '@editor/features/text/presets';
import { RATIOS, FIT_MODES } from '@editor/features/ratio/model';
import { INTERPOLATIONS } from '@editor/features/speed/model';

/** "## 4. 단축키" 절의 첫 표(연속된 | 줄) */
function shortcutSection(): string {
  const start = USAGE_MARKDOWN.indexOf('\n## 4. 단축키');
  expect(start).toBeGreaterThan(0);
  const rest = USAGE_MARKDOWN.slice(start);
  const lines = rest.split('\n');
  const first = lines.findIndex((l) => l.trim().startsWith('|'));
  expect(first).toBeGreaterThan(0);
  const out: string[] = [];
  for (let i = first; i < lines.length && lines[i]!.trim().startsWith('|'); i += 1) out.push(lines[i]!);
  return out.join('\n');
}

function menuLabels(entries: MenuEntry[], out: string[] = []): string[] {
  for (const e of entries) {
    if (e.kind === 'item') out.push(e.label);
    else if (e.kind === 'sub') {
      out.push(e.label);
      menuLabels(e.items, out);
    }
  }
  return out;
}

describe('usage.md 번들', () => {
  it('문서가 번들되어 frontmatter 없이 제목으로 시작한다', () => {
    expect(USAGE_MARKDOWN.startsWith('# SH Video Editor 사용법')).toBe(true);
    const { blocks, toc } = usageDoc();
    expect(blocks.length).toBeGreaterThan(50);
    expect(toc.map((t) => t.text)).toEqual(expect.arrayContaining(['1. 5분 안에 첫 영상', '2. 화면 구성', '3. 작업별 절차', '4. 단축키', '5. 막힐 때']));
  });

  it('특수기호(em-dash, en-dash, 유니코드 화살표, 원문자, 이모지)를 쓰지 않는다', () => {
    expect(USAGE_MARKDOWN).not.toMatch(/[–—←-⇿①-⓿\u{1F300}-\u{1FAFF}]/u);
  });
});

describe('단축키 표', () => {
  it('문서의 단축키 표는 keymap.ts 에서 생성한 표와 같다', () => {
    const fromDoc = parseMarkdownTable(shortcutSection());
    const fromCode = parseMarkdownTable(shortcutTableMarkdown());
    expect(fromDoc).toEqual(fromCode);
    expect(fromDoc.length).toBe(KEYMAP.length + 1);
  });

  it('생성한 표의 키 이름은 ASCII 뿐이다', () => {
    for (const d of KEYMAP) for (const k of d.keys) expect(k).toMatch(/^[\x20-\x7e]+$/);
  });
});

describe('문서가 말하는 화면 문구가 코드에 있다', () => {
  it('메뉴바의 모든 항목 이름이 문서에 있다', () => {
    const labels = MENUS.flatMap((m) => [m.label, ...menuLabels(m.items)]);
    const missing = labels.filter((l) => !USAGE_MARKDOWN.includes(l));
    expect(missing).toEqual([]);
  });

  it('모든 단축키 설명(keymap label)이 문서에 있다', () => {
    const missing = KEYMAP.map((d) => d.label).filter((l) => !USAGE_MARKDOWN.includes(l));
    expect(missing).toEqual([]);
  });

  it('안내 카드 단계·데모 영상·전환·효과·필터 폴더·제목 프리셋·비율·보간 이름이 문서에 있다', () => {
    const names = [
      ...GUIDE_STEPS.map((s) => s.title),
      ...DEMO_SCENES.map((d) => d.label),
      ...TRANSITIONS.map((t) => t.label),
      ...USER_EFFECTS.map((e) => e.label),
      ...PRESET_FOLDERS.map((f) => f.label),
      ...TITLE_PRESETS.map((p) => p.label),
      ...RATIOS.map((r) => r.label),
      ...FIT_MODES.map((m) => m.label),
      ...INTERPOLATIONS.map((i) => i.label),
    ];
    const missing = names.filter((n) => !USAGE_MARKDOWN.includes(n));
    expect(missing).toEqual([]);
  });

  it('문서에 적은 버튼·탭 문구가 실제 라벨과 같다(대표 항목)', () => {
    // 문서 쪽 표기 -> 코드 쪽 라벨. 바꾸면 문서와 코드를 함께 고친다
    const buttons = [
      '파일 가져오기',
      '데모 영상 넣기',
      '자세히',
      '타임라인에 넣기',
      '자르기',
      '리플',
      '삽입',
      '스냅',
      '맞춤',
      '비교(원본 보기)',
      '필터 해제',
      '이 프레임 고정',
      '음성 구간 자동 낮춤(덕킹)',
      'SRT 가져오기',
      'SRT 내보내기',
      '소리로 싱크 맞추기',
      '자막 추가',
      '찾아보기',
    ];
    for (const b of buttons) expect(USAGE_MARKDOWN, b).toContain(`${b}**`);
    const tabs = ['텍스트', '효과', '색', '속도', '오디오', '전환', '자막', '미디어', '필터', '음악'];
    for (const t of tabs) expect(USAGE_MARKDOWN).toContain(t);
  });
});
