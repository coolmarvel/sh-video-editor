---
title: ADR-0004 호스트 캐시와 웹 파일 저장
created: 2026-10-14
status: accepted
---

# ADR-0004: 호스트 캐시와 웹 파일 저장

## 상태

Accepted (2026-10-14)

## 맥락

ADR-0002 는 "프로젝트는 JSON 파일, 데스크톱 캐시는 SQLite, 웹은 OPFS" 로 정했다. M2-8 에서 이를 구현하며 두 가지를
정해야 했다.

1. 데스크톱 SQLite 를 무엇으로 여는가. 후보는 `better-sqlite3`(네이티브 애드온) 와 Node 내장 `node:sqlite`.
2. 웹에서 "캐시" 와 "프로젝트 파일" 을 어디에 두는가. 엔진(wasm)은 파일시스템이 없고 자동 저장 저널(`startAutosave`)도
   없다. 새로고침하면 사용자가 고른 `File` 핸들이 사라진다.

캐시에 두는 것은 파생 데이터(썸네일 PNG, 파형 피크, 최근 프로젝트)뿐이다. 편집 상태는 두지 않는다.

## 결정

- **데스크톱: Node 내장 `node:sqlite`(`DatabaseSync`) 를 Electron main 프로세스에서 연다.** 파일은 `userData/cache.sqlite`.
  Electron 44.7.2 의 Node 는 24.21.0 이라 플래그 없이 쓸 수 있다(스모크로 확인). 렌더러는 preload 의 `cache:*` IPC 로 부른다.
  코드: `apps/desktop/src/main/cache-db.ts`.
- **화면 계약은 `EngineBridge.cache?: CacheStore`** (`packages/editor/src/engine/bridge.ts`): `getThumb/putThumb`
  (키 = 미디어 파일 경로 + tick + 폭), `getPeaks/putPeaks`(경로 + 초당 칸), `recentProjects/touchProject/forgetProject`.
  키가 항목 id 가 아니라 **파일 경로** 인 이유: 프로젝트를 다시 열면 항목 id 가 바뀌지만 같은 파일은 같은 썸네일이다.
  데스크톱은 파일 수정 시각(mtime)을 main 에서 stat 해 키에 섞어 파일이 바뀌면 캐시가 자연히 빗나간다. 생성 미디어(데모 영상,
  컬러 매트)는 경로가 없어 호스트 캐시를 거치지 않고 메모리 LRU 만 쓴다.
- 화면의 썸네일 로더(`features/media/thumbs.ts`)와 파형 피크(`features/audio/peaks.ts`)는 메모리 LRU 앞단에 이 캐시를
  끼운다. 캐시가 없는 호스트(테스트 가짜 엔진)는 지금처럼 메모리만. 캐시 실패는 조용히 엔진 경로로 넘어간다.
- **웹 캐시는 IndexedDB**(`apps/web/src/cache.ts`, 같은 `CacheStore` 모양). OPFS 가 아닌 이유: 캐시는 작은 레코드를 키로
  찾는 일이라 키-값 저장소가 맞고, 메인 스레드에서 Worker 왕복 없이 접근할 수 있다. OPFS 는 프로젝트 파일(바이트 덩어리)에 쓴다.
- **웹 프로젝트 파일은 OPFS `projects/<이름>.fcproj`.** 저장 = `file.saveAs { path: 'opfs:/projects/<이름>.fcproj' }` +
  `opfs.flush()`. "내 컴퓨터로 받기" 는 같은 바이트를 Blob 다운로드. 열기 = OPFS 목록 대화상자 또는 브라우저 File
  (`registerFiles` 뒤 `file.open`, 그리고 OPFS 로 복사해 이후 저장이 OPFS 로 가게). 코드: `features/project/web-files.ts`,
  `web-store.ts`, `WebFilesDialog.tsx`.
- **웹 자동 저장은 화면이 한다.** 30초마다 수정됨이고 revision 이 바뀌었으면 `file.saveCopy` 로
  `opfs:/recovery/<세션>/<이름>.fcproj` + `meta.json` 을 남긴다. 시작할 때 다른 세션의 스냅샷을 기존 RecoveryDialog 에
  복구 후보로 제안한다. 복구하면 스냅샷을 열고, 저장 때 원래 이름(`projects/<이름>`)으로 가게 한 뒤 스냅샷을 지운다
  (엔진 저널의 "저장하면 원본에 씁니다" 와 같은 뜻). 저장하면 이 세션의 스냅샷도 지운다.
- **웹 미디어 재연결**: 새로고침 뒤 연 프로젝트에 찾을 수 없는 미디어가 있으면 "미디어 다시 연결" 대화상자가 열리고, 사용자가
  다시 고른 파일을 이름으로 맞춰 `media.relink { item, path, force: true }` 한다.
- **웹 내보내기**: 엔진 가상 경로 `/exports/<프로젝트 이름>.mp4` 에 쓰게 하고, `onFileWritten` 으로 받은 바이트를 Blob
  다운로드한다(`features/export/web-download.ts`). 진행률·취소는 기존 큐 루프 그대로.
- **최근 프로젝트** 는 캐시의 `recent` 를 파일 메뉴 "최근 프로젝트" 하위 메뉴와 첫 화면 안내 카드가 함께 보인다
  (`features/project/recent.ts`). 상한 10개, 최근에 연 것이 먼저. 열 수 없으면 목록에서 뺀다.

## 근거

- `node:sqlite` 를 고른 이유: 네이티브 애드온을 하나 더 넣으면 electron-builder 의 rebuild 와 Windows 크로스 패키징
  (`docs/guides/packaging.md` 의 `.node` 제약)이 늘어난다. 내장 모듈은 패키징 변경이 없고 electron-vite 가 `node:` 빌트인을
  그대로 외부로 둔다. API 가 동기(`DatabaseSync`)라 main 의 IPC 핸들러에서 바로 쓴다. 단점: Node 24 API 라 Electron 을 크게
  내리면 못 쓴다(그럴 계획 없음).
- 캐시를 main 에 두는 이유: 엔진 utility process 는 죽고 다시 뜰 수 있어 거기 두면 연결을 다시 맺어야 한다. 렌더러에
  두면(IndexedDB) 데스크톱도 가능하지만 ADR-0002 의 "SQLite" 결정과 사용자 데이터 디렉토리 파일 하나로 백업·삭제가 쉬운 점을
  택했다.
- 웹 복구를 화면 타이머로 하는 이유: wasm 에는 스레드·파일 잠금이 없어 엔진 저널을 못 켠다(바인딩 주석). `file.saveCopy` 는
  프로젝트 경로·dirty 를 건드리지 않아 스냅샷에 맞다.
- 대안 "브라우저 File 을 열면 그 File 에 직접 저장" 은 File System Access API(`showSaveFilePicker`)가 Chrome 만 지원하고
  권한 프롬프트가 잦아 미뤘다. 지금은 OPFS 에 두고 받기를 명시적으로 한다.

## 결과

- 좋음: 썸네일·파형이 두 번째 열기부터 즉시 뜬다. 웹에서 저장·열기·내보내기·복구가 돈다. 네이티브 의존성 추가 없음.
- 부담: 웹 OPFS 는 사이트 저장소라 브라우저 데이터 삭제로 사라진다(안내 문구로 알리고 "내 컴퓨터로 받기" 를 둔다). 웹 캐시
  키에는 mtime 이 없어 같은 이름·같은 크기의 다른 파일은 썸네일이 섞일 수 있다(`registerFiles` 가 이름·크기가 같을 때만 같은
  경로를 주므로 드물다).
- 후속: `M4-7 썸네일·파형 커맨드` 가 들어오면 같은 키로 연결. 캐시 크기 상한(썸네일 2만 행, 피크 2천 행)은 쓰기 100번마다
  오래 쓰지 않은 것부터 정리한다.
