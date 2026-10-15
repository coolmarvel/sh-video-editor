/**
 * 엔진 토스트 이벤트의 영어 문구를 화면 글(한국어)로 옮긴다. 엔진(vendor)이 내는 문구는 `crates/engine/src` 의
 * `Session::toast`·`error_toast`·`Event::Toast` 이고, 여기 표가 아는 것만 바꾼다. 모르는 문구는 그대로 둔다(정보를 잃지 않게).
 * `key` 가 있는 것은 화면도 같은 일을 자기 알림으로 알리는 사건이라, 짧은 시간 안에 같은 key 의 알림이 있으면 하나만 남긴다
 * (features/project/store.ts 의 notify).
 */

/** 엔진의 기본 프로젝트 이름. 화면에서는 "제목 없음" */
export const ENGINE_UNTITLED = 'Untitled';
export const UNTITLED_KO = '제목 없음';

/** 화면에 보일 프로젝트 이름. 엔진의 "Untitled" 는 "제목 없음" */
export function displayProjectName(name: string): string {
  return name === ENGINE_UNTITLED ? UNTITLED_KO : name;
}

export interface EngineMessage {
  text: string;
  /** 같은 사건을 화면도 알리면 중복을 접는 열쇠 */
  key: string | null;
}

type Rule = [RegExp, (m: RegExpMatchArray) => string, string | null];

const RULES: Rule[] = [
  [/^Recovered unsaved changes to (.+) from (.+)$/, (m) => `'${displayProjectName(m[1] ?? '')}' 의 저장하지 않은 변경을 되살렸습니다 (${m[2]}).`, 'recover'],
  [/^Scene Edit Detection found no cut points$/, () => '장면이 바뀌는 곳을 찾지 못했습니다.', 'sceneDetect'],
  [/^Scene Edit Detection: (\d+) cut point\(s\)$/, (m) => `장면 ${m[1]}곳에서 잘랐습니다.`, 'sceneDetect'],
  [/^Scene Edit Detection: (.+)$/, (m) => `장면을 찾지 못했습니다: ${m[1]}`, 'sceneDetect'],
  [/^Export queue finished \((\d+) failed\)$/, (m) => `내보내기를 마쳤습니다(실패 ${m[1]}개).`, 'export'],
  [/^Export queue finished$/, () => '내보내기를 마쳤습니다.', 'export'],
  [/^Nothing to render: previews are up to date$/, () => '다시 그릴 미리보기가 없습니다. 이미 최신입니다.', null],
  [/^Nothing to render: audio previews are up to date$/, () => '다시 만들 소리 미리보기가 없습니다. 이미 최신입니다.', null],
  [/^Deleted (\d+) render files?$/, (m) => `렌더 파일 ${m[1]}개를 지웠습니다.`, null],
  [/^Installed graphics template "(.+)"$/, (m) => `그래픽 템플릿 "${m[1]}" 을 설치했습니다.`, null],
  [/^(\d+) media file\(s\) are missing; .+$/, (m) => `미디어 파일 ${m[1]}개를 찾을 수 없습니다.`, 'open'],
  [/^Exported frame to (.+)$/, (m) => `프레임을 저장했습니다: ${m[1]}`, null],
  [/^Audio during scrubbing on$/, () => '스크럽할 때 소리를 켰습니다.', null],
  [/^Audio during scrubbing off$/, () => '스크럽할 때 소리를 껐습니다.', null],
  [
    /^Upgraded project from schema v(\d+) to v(\d+);.*$/,
    (m) => `프로젝트를 새 형식(v${m[1]} 에서 v${m[2]})으로 바꿨습니다. 저장하면 원본은 백업으로 남습니다.`,
    'open',
  ],
  [
    /^(.+): the file is truncated: (\d+) of (\d+) (\w+) samples are past its end and cannot be decoded$/,
    (m) => `${m[1]}: 파일이 잘렸습니다. ${m[4]} 샘플 ${m[3]}개 중 ${m[2]}개가 파일 끝 너머에 있어 재생할 수 없습니다.`,
    null,
  ],
  [/^Saved$/, () => '저장했습니다.', 'save'],
];

/** 엔진 토스트 문구를 화면 글로. 모르는 문구는 그대로(key 없음) */
export function translateEngineMessage(message: string): EngineMessage {
  for (const [re, make, key] of RULES) {
    const m = message.match(re);
    if (m) return { text: make(m), key };
  }
  return { text: message, key: null };
}
