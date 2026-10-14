/**
 * 자동 자막의 순수 규칙: 모델 카탈로그 모양, 언어 선택지, 자막 배치 옵션을 엔진 `transcript.createCaptions` 파라미터로,
 * 군말 목록, 크기 표기. 엔진을 부르지 않는다(store 가 부른다). 단위 테스트 대상.
 */

/** 엔진 `transcript.models` 의 한 항목 */
export interface SpeechModel {
  id: string;
  name: string;
  multilingual: boolean;
  description: string;
  license: string;
  source: string;
  /** 바이트 */
  size: number;
  installed: boolean;
}

export interface SpeechModelCatalog {
  /** 이 빌드가 음성 인식을 할 수 있는가(엔진 feature `whisper`) */
  available: boolean;
  default: string;
  dir: string | null;
  models: SpeechModel[];
}

/** 기본 모델: 한국어 품질과 크기의 균형(실측은 docs/guides/packaging.md "STT 모델"). */
export const DEFAULT_MODEL = 'whisper-base';

/** 모델 id 에 붙이는 한국어 안내(카탈로그 설명은 영어라 화면은 이 표를 쓴다). 없는 id 는 카탈로그 설명을 그대로 보인다 */
export const MODEL_HINTS: Record<string, string> = {
  'whisper-tiny': '가장 빠름(153MB). 또렷한 음성만 쓸 만함',
  'whisper-base': '추천(293MB). 속도와 정확도의 균형',
  'whisper-small': '가장 정확(967MB). base 보다 2~3배 느림',
};

export type SttLanguage = 'ko' | 'en' | 'ja' | 'zh' | 'auto';

export const LANGUAGES: Array<{ id: SttLanguage; label: string }> = [
  { id: 'ko', label: '한국어' },
  { id: 'en', label: '영어' },
  { id: 'ja', label: '일본어' },
  { id: 'zh', label: '중국어' },
  { id: 'auto', label: '자동 감지' },
];

/** 자막 배치 옵션(화면 값). 엔진 규칙(`CaptionRules`)으로 바꾸는 것은 `captionParams` */
export interface CaptionOptions {
  /** 한 줄 최대 글자 수 */
  maxChars: number;
  /** 자막 하나의 최소 표시 시간(초) */
  minSeconds: number;
}

export const CAPTION_LIMITS = { maxChars: { min: 8, max: 80 }, minSeconds: { min: 0.3, max: 5 } } as const;

/** 한국어는 글자가 넓어 한 줄 20자, 그 밖은 엔진 기본 42자의 절반쯤인 32자를 기본으로 둔다 */
export function defaultCaptionOptions(language: SttLanguage): CaptionOptions {
  return { maxChars: language === 'ko' || language === 'ja' || language === 'zh' ? 20 : 32, minSeconds: 1 };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * `transcript.createCaptions` 파라미터. 값은 한계 안으로 자르고 숫자가 아니면 기본값으로. 두 줄, 최대 표시 7초,
 * 트랙 이름은 "자동 자막".
 */
export function captionParams(opts: Partial<CaptionOptions>, language: SttLanguage = 'ko'): Record<string, unknown> {
  const d = defaultCaptionOptions(language);
  const maxChars = Number.isFinite(opts.maxChars)
    ? clamp(Math.round(opts.maxChars as number), CAPTION_LIMITS.maxChars.min, CAPTION_LIMITS.maxChars.max)
    : d.maxChars;
  const minSeconds = Number.isFinite(opts.minSeconds)
    ? clamp(opts.minSeconds as number, CAPTION_LIMITS.minSeconds.min, CAPTION_LIMITS.minSeconds.max)
    : d.minSeconds;
  return { maxChars, lines: 2, minSeconds, maxSeconds: 7, name: '자동 자막', format: 'Subtitle' };
}

/**
 * 군말 기본 목록. 엔진 기본(um, uh ...)은 영어뿐이라 한국어 감탄형 군말을 더한다. 낱말로 떨어진 "음", "어" 만 잡고
 * "그", "뭐" 처럼 뜻이 있는 말은 넣지 않는다. 사용자가 쉼표로 고칠 수 있다.
 */
export const DEFAULT_FILLERS = ['음', '어', '에', '흠', '으음', '어어', '음음', '그러니까', 'um', 'uh', 'umm', 'uhm', 'erm', 'er', 'hmm', 'mm'];

/** 쉼표·줄바꿈으로 나눈 군말 목록(빈 것·중복 제거) */
export function parseFillers(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const w = raw.trim();
    if (w && !out.includes(w)) out.push(w);
  }
  return out;
}

/** 바이트를 "293MB" 처럼(십진 단위: 모델 출처 페이지·문서와 같은 표기) */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0MB';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}GB`;
  return `${Math.round(n / 1e6)}MB`;
}

/** 모델 목록에서 고른 모델. 없으면 카탈로그 기본, 그것도 없으면 첫 모델 */
export function pickModel(catalog: SpeechModelCatalog | null, wanted: string): SpeechModel | null {
  if (!catalog) return null;
  return catalog.models.find((m) => m.id === wanted) ?? catalog.models.find((m) => m.id === catalog.default) ?? catalog.models[0] ?? null;
}

/** 엔진 Transcript JSON 에서 단어 수(없으면 0) */
export function transcriptWordCount(transcript: unknown): number {
  if (!transcript || typeof transcript !== 'object') return 0;
  const w = (transcript as { words?: unknown }).words;
  return Array.isArray(w) ? w.length : 0;
}

/** 여러 클립을 차례로 인식할 때의 전체 진행률: 끝난 클립 수 + 현재 클립의 비율 */
export function overallFraction(done: number, total: number, current: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (done + Math.min(1, Math.max(0, current))) / total));
}

/** 다운로드 오류를 사용자 문구로. 네트워크 계열은 연결 확인을 안내한다 */
export function describeDownloadError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('stopped')) return '내려받기를 취소했습니다.';
  if (/dns|resolve|lookup|address|connect|network|timed? ?out|unreachable|tls|certificate|io error|os error|io:/.test(m)) {
    return `모델을 내려받지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요. (${message})`;
  }
  if (m.includes('checksum')) return `내려받은 파일이 손상되었습니다. 다시 시도하세요. (${message})`;
  return `모델을 내려받지 못했습니다: ${message}`;
}
