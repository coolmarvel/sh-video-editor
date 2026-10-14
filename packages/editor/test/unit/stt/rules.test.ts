import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILLERS,
  captionParams,
  defaultCaptionOptions,
  describeDownloadError,
  formatBytes,
  overallFraction,
  parseFillers,
  pickModel,
  transcriptWordCount,
  type SpeechModelCatalog,
} from '../../../src/features/stt/rules';

const catalog: SpeechModelCatalog = {
  available: true,
  default: 'whisper-base',
  dir: '/data/models',
  models: [
    {
      id: 'whisper-tiny',
      name: 'tiny',
      multilingual: true,
      description: '',
      license: 'MIT',
      source: 'https://huggingface.co/openai/whisper-tiny',
      size: 153_000_000,
      installed: false,
    },
    {
      id: 'whisper-base',
      name: 'base',
      multilingual: true,
      description: '',
      license: 'MIT',
      source: 'https://huggingface.co/openai/whisper-base',
      size: 292_000_000,
      installed: true,
    },
  ],
};

describe('자동 자막 규칙', () => {
  it('문장 분할 옵션은 createCaptions 파라미터로 가고 한계 안으로 잘린다', () => {
    expect(captionParams({ maxChars: 20, minSeconds: 1 }, 'ko')).toEqual({
      maxChars: 20,
      lines: 2,
      minSeconds: 1,
      maxSeconds: 7,
      name: '자동 자막',
      format: 'Subtitle',
    });
    expect(captionParams({ maxChars: 500, minSeconds: 0 }, 'ko')).toMatchObject({ maxChars: 80, minSeconds: 0.3 });
    expect(captionParams({ maxChars: 2, minSeconds: 99 }, 'en')).toMatchObject({ maxChars: 8, minSeconds: 5 });
    expect(captionParams({ maxChars: 25.6 }, 'en')).toMatchObject({ maxChars: 26 });
    // 숫자가 아니면 언어 기본값
    expect(captionParams({ maxChars: Number.NaN, minSeconds: Number.NaN }, 'ko')).toMatchObject({ maxChars: 20, minSeconds: 1 });
    expect(captionParams({}, 'en')).toMatchObject({ maxChars: 32, minSeconds: 1 });
  });

  it('언어별 기본 글자 수: 한국어·일본어·중국어 20, 그 밖 32', () => {
    expect(defaultCaptionOptions('ko').maxChars).toBe(20);
    expect(defaultCaptionOptions('ja').maxChars).toBe(20);
    expect(defaultCaptionOptions('en').maxChars).toBe(32);
    expect(defaultCaptionOptions('auto').maxChars).toBe(32);
  });

  it('군말 목록은 쉼표·줄바꿈으로 나누고 빈 것·중복을 뺀다', () => {
    expect(parseFillers('음, 어,, 음\n그러니까 , um')).toEqual(['음', '어', '그러니까', 'um']);
    expect(parseFillers('')).toEqual([]);
    expect(DEFAULT_FILLERS).toContain('음');
    expect(DEFAULT_FILLERS).toContain('um');
    // 뜻이 있는 낱말은 기본 군말이 아니다
    expect(DEFAULT_FILLERS).not.toContain('그');
    expect(DEFAULT_FILLERS).not.toContain('뭐');
  });

  it('크기 표기와 모델 선택', () => {
    expect(formatBytes(292_890_192)).toBe('293MB');
    expect(formatBytes(966_995_080)).toBe('967MB');
    expect(formatBytes(1_200_000_000)).toBe('1.20GB');
    expect(formatBytes(0)).toBe('0MB');
    expect(pickModel(catalog, 'whisper-tiny')?.id).toBe('whisper-tiny');
    expect(pickModel(catalog, 'whisper-large')?.id).toBe('whisper-base');
    expect(pickModel(null, 'whisper-base')).toBeNull();
    expect(pickModel({ ...catalog, default: 'nope' }, 'nope')?.id).toBe('whisper-tiny');
  });

  it('전체 진행률과 단어 수', () => {
    expect(overallFraction(0, 3, 0.5)).toBeCloseTo(1 / 6);
    expect(overallFraction(2, 3, 1)).toBe(1);
    expect(overallFraction(0, 0, 0.5)).toBe(0);
    expect(overallFraction(1, 2, 7)).toBe(1);
    expect(transcriptWordCount({ words: [{ text: 'a' }, { text: 'b' }] })).toBe(2);
    expect(transcriptWordCount({})).toBe(0);
    expect(transcriptWordCount(null)).toBe(0);
  });

  it('다운로드 오류는 네트워크 안내로 바꾼다', () => {
    expect(describeDownloadError('download: https://huggingface.co/x: io: failed to lookup address information')).toMatch(/인터넷 연결을 확인/);
    expect(describeDownloadError('download: connection timed out')).toMatch(/인터넷 연결을 확인/);
    expect(describeDownloadError('download: model.safetensors: checksum mismatch')).toMatch(/손상/);
    expect(describeDownloadError('stopped')).toBe('내려받기를 취소했습니다.');
    expect(describeDownloadError('weird')).toBe('모델을 내려받지 못했습니다: weird');
  });
});
