import { describe, expect, it } from 'vitest';
import { isTextClip, parseParamValue, readTextStyle, unescapeDebugString } from '../../../src/features/text/params';
import type { ClipInfo } from '../../../src/features/timeline/types';
import { FakeEngine } from '../../fake-bridge';

describe('엔진 효과 파라미터(Debug 문자열) 읽기', () => {
  it('Text, Float, Bool, Choice, Color, Vec2 를 구분한다', () => {
    expect(parseParamValue({ kind: 'text', value: '안녕하세요 Hello' })).toEqual({ kind: 'text', text: '안녕하세요 Hello' });
    expect(parseParamValue({ kind: 'float', value: 120 })).toEqual({ kind: 'float', value: 120 });
    expect(parseParamValue({ kind: 'choice', value: 2 })).toEqual({ kind: 'choice', index: 2 });
    expect(parseParamValue({ kind: 'color', value: [1, 0, 0, 1] })).toEqual({ kind: 'color', hex: '#ff0000', alpha: 1 });
    expect(parseParamValue({ kind: 'point', value: [960, 540] })).toEqual({ kind: 'vec2', x: 960, y: 540 });
    expect(parseParamValue({ value: 'Float(1.0)' })).toEqual({ kind: 'float', value: 1 });
    expect(parseParamValue('Text("안녕하세요 Hello")')).toEqual({ kind: 'text', text: '안녕하세요 Hello' });
    expect(parseParamValue('Text("줄1\\n줄2 \\"따옴표\\"")')).toEqual({ kind: 'text', text: '줄1\n줄2 "따옴표"' });
    expect(parseParamValue('Float(120.0)')).toEqual({ kind: 'float', value: 120 });
    expect(parseParamValue('Float(-0.5)')).toEqual({ kind: 'float', value: -0.5 });
    expect(parseParamValue('Bool(true)')).toEqual({ kind: 'bool', value: true });
    expect(parseParamValue('Choice(2)')).toEqual({ kind: 'choice', index: 2 });
    expect(parseParamValue('Color([0.5019608, 0.5019608, 0.5019608, 1.0])')).toEqual({ kind: 'color', hex: '#808080', alpha: 1 });
    expect(parseParamValue('Color([1.0, 0.0, 0.0, 1.0])')).toEqual({ kind: 'color', hex: '#ff0000', alpha: 1 });
    expect(parseParamValue('Vec2(Vec2 { x: 960.0, y: 540.5 })')).toEqual({ kind: 'vec2', x: 960, y: 540.5 });
    expect(parseParamValue('Something(1)')).toEqual({ kind: 'unknown', raw: 'Something(1)' });
    expect(parseParamValue(undefined).kind).toBe('unknown');
  });

  it('Rust Debug 이스케이프를 푼다', () => {
    expect(unescapeDebugString('a\\tb\\\\c\\u{d55c}')).toBe('a\tb\\c한');
  });

  it('텍스트 클립을 판별하고 스타일을 읽는다', () => {
    const engine = new FakeEngine();
    engine.newSequence();
    const r = engine.execute('graphics.newText', { text: '제목', size: 120, font: 'Pretendard', fontStyle: 'Bold' }) as { clip: number };
    engine.execute('graphics.set', { clip: r.clip, props: { fill_color: '#ffcc00', align: 'center', stroke: true, stroke_width: 6, position: [100, 200] } });
    const seq = engine.inspectSequence() as { video: Array<{ items: ClipInfo[] }> };
    const clip = seq.video.flatMap((t) => t.items).find((c) => c.clip === r.clip);
    if (!clip) throw new Error('clip');
    expect(isTextClip(clip)).toBe(true);
    const style = readTextStyle(clip);
    expect(style).toMatchObject({
      text: '제목',
      font: 'Pretendard',
      fontStyle: 'Bold',
      size: 120,
      align: 'center',
      fillColor: '#ffcc00',
      stroke: true,
      strokeWidth: 6,
      position: [100, 200],
      background: false,
      shadow: false,
    });
  });

  it('효과가 없는 일반 클립은 텍스트 클립이 아니다', () => {
    const clip = { clip: 1, effects: [{ effect: 'motion', enabled: true }] } as unknown as ClipInfo;
    expect(isTextClip(clip)).toBe(false);
    expect(readTextStyle(clip)).toBeNull();
    expect(isTextClip({ clip: 2 } as ClipInfo)).toBe(false);
  });
});
