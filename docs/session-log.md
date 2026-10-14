---
title: 세션 로그
created: 2026-10-14
updated: 2026-10-14
domain: development
---

# 세션 로그 (최신이 위)

이 파일이 **"언제 무슨 일이 있었나"의 SSOT**다. 세션마다 최상단에 블록 추가.
(커밋은 검증 통과 후 에이전트가, 성긴 단위. git history 를 이력 SSOT 로 삼지 않는다.)

블록 형식: `## YYYY-MM-DD - 제목` 아래에 **요청/피드백, 수정, 검증, 다음** 순서로 간결하게.

## 2026-10-14 - 첫 Windows 피드백 반영 + 테스트 3층 + 로드맵 (v0.1.2)

- **피드백**(`docs/feedback-archive/2026-10-14-first-windows-run/`): 설치본이 Windows 에서 엔진까지 기동 확인. 요청: 아이콘, 메뉴 하나로,
  영역 크기 조절, Ctrl+Z 등 단축키 점검, 배속 재생, "FilmCraft Demo" 제거. 추가 요청: 다음 단계 진행, 단위·기능·e2e 테스트, 엔진 개선·경쟁 제품
  기능 적극 반영. printWidth 는 160 으로 결정(사용자).
- **방법**: feat/* 워크트리 5개(아이콘, 스플리터, 단축키·메뉴·배속, 테스트, 로드맵 문서)에 에이전트 병렬. 충돌은 App.tsx 와 설정 3개뿐.
- **수정**:
  - 아이콘(apps/desktop/build/icon.svg, `npm run icons` 로 ico/png/favicon 생성, sharp 로 ICO 직접 조립). exe·인스톨러·창·웹 favicon 적용.
  - 스플리터(features/layout): 미디어 200px~60%, 타임라인 120px~70%, 키보드·더블클릭 기본값, localStorage 복원. DESIGN.md 4.16.
  - 단축키 관리자(features/shortcuts/keymap.ts 한 곳) + 큐레이션 한국어 메뉴(menu-def.ts, Ctrl 표기, 라벨 색·Demo Project 제외) +
    배속 재생(0.25~4x, J/K/L 셔틀, 역재생) + Electron 기본 메뉴 제거(Menu.setApplicationMenu(null)) + "제목 없음" 표시.
  - 테스트: 단위 240(vitest, 가짜 EngineBridge, 커버리지 순수 모듈 98%), 엔진 기능 36(실제 .node 와 wasm, 내보내기·저장·복구·적대 입력),
    e2e 웹 18(1440·390), e2e 데스크톱 4(Electron+xvfb, 엔진 강제 종료 복구). `npm run test` = rust+unit+engine, `test:all` 에 e2e.
  - 테스트가 드러낸 결함 수정: formatTimecode 경계 오차, rulerStep 24·25fps 눈금, pause 뒤 배율 표시, Scrubber aria.
    엔진 입력 검증 느슨함 2건은 it.fails 로 남김(todo P3).
  - docs/plans/0002-feature-roadmap.md: 참조 제품 8종 조사, 엔진 갭, 마일스톤 2~4 상세, 결정 필요 목록.
  - prettier printWidth 160, Windows 엔진 cargo-xwin 경로를 build:win:xwin 으로 정리.
- **검증**: unit 240 통과, engine 36 통과(+2 expected fail), e2e 웹 18 통과(메뉴 한글화에 맞게 1건 갱신), e2e 데스크톱 4 통과(강제 종료 복구
  테스트는 CPU 경합 중 1회 120초 타임아웃, 단독·재실행 통과: todo P3 안정화). `npm run verify`, 스모크, Playwright 1440·390 확인.
  Linux·Windows 엔진 재빌드(0.1.2), 인스톨러 SH-Video-Editor-Setup-0.1.2.exe 바탕화면 교체.
- **다음**: 마일스톤 2 병렬 착수(텍스트·자막, 전환, 효과·필터, 속도, 오디오 재생·배경음악, 비율·SNS 프리셋) + 엔진 개선(실매체 호환, HW 디코드,
  이벤트 통합·썸네일). 결정 필요: 한글 글꼴(Pretendard 로 진행), 음악 출처(CC0), Whisper 모델 배포 방식.

## 2026-10-14 - 마일스톤 1 병렬 구현 병합 (v0.1.1)

- **요청**: 여러 에이전트로 병렬 작업, GitHub 는 private 으로 푸시, 끝나면 병합·검증·바탕화면 인스톨러.
- **방법**: feat/* 워크트리 6개(미디어 패널, 타임라인, 모니터 재생, 내보내기·저장·복구, 데스크톱 인프라, 웹 파일)에
  에이전트 한 명씩. 파일 경계(features/<이름>/ 아래, 공유 파일은 줄 추가만)를 지켜 충돌은 bridge.ts·App.tsx·main/index.ts 의
  "같은 자리 줄 추가" 뿐이었고 양쪽을 모두 살려 해결.
- **수정**(브랜치별 요약, 상세는 각 features 디렉토리 주석):
  - 미디어 패널(features/media): project.inspect + project.items 트리, 가져오기(데스크톱 파일 대화상자 pickFiles, 드롭은 webUtils
    경로), 데모 영상 6종, 선택 항목으로 시퀀스 만들기(project.select 선행 필요). 썸네일 커맨드는 엔진에 없음.
  - 타임라인(features/timeline): 눈금자·트랙·클립 블록·플레이헤드, 자르기(timeline.razor)·이동(timeline.move)·트림(timeline.trim)·
    삭제·리플·스냅·줌·미디어 드롭(timeline.place). DESIGN.md 4.15 타임라인 계약, docs/guides/timeline.md 추가.
  - 모니터(features/monitor): rAF 재생 루프, 프레임 요청 1건 제한, 적응형 배율(0.25/0.5/1), 스크러버, 타임코드, 단축키.
    실측 1080p scale 0.5 renderFrame: 네이티브 24ms, wasm 194ms(약 8배). 오디오 재생은 미구현.
  - 내보내기·프로젝트(features/export, features/project): 프리셋 5종(h264 mp4), 진행률·ETA·취소, 저장·열기·다른 이름·새 프로젝트,
    dirty 가드, 자동 저장과 크래시 복구(바인딩에 startAutosave·pollPersistence·shutdown 추가). 실측: 1080p 30fps 16초 내보내기
    47.6초 40MB(ffprobe h264+aac 16.0초).
  - 웹 파일(apps/web, bindings/wasm): Blob 범위 읽기(FileReaderSync, 1MiB 청크 LRU 64MiB), registerFiles/onFileWritten/
    takeWrittenFile/opfs 선택 메서드, opfs:/ 접두 경로 스테이징. 25.6MB 파일 가져오기에 9.9% 만 읽음. WebCodecs 등록 지점은
    vendor codecs 의 register_video_decoder 로 남아 있음.
  - 데스크톱 인프라(apps/desktop): 엔진을 utility process(engine-host)로 격리, 렌더러와 MessagePortMain 직결, 크래시 자동 재시작과
    onCrashed 알림. 렌더러 기준 renderFrame 왕복 8.4~9.7ms(격리 전 8.8~13.7ms). Electron 44 의 parentPort.postMessage 가 main 루프를
    멈추는 현상을 확인해 포트만 쓴다. Windows .node: napi 가 windows-gnu 를 거부(libnode.dll 요구)해 WSL gnu 크로스는 폐기.
    병합 시 자동 저장·종료(startAutosave·pollPersistence·shutdown)를 엔진 호스트 메서드로 옮기고 데이터 디렉토리는 env 로 전달.
- **검증**: 각 브랜치에서 typecheck·prettier·web/desktop 빌드·Playwright(1440·390) 통과. 병합 후 main 에서 clippy, wasm 재빌드,
  typecheck 통과. 병합본 `npm run verify` 통과, 스모크 "smoke: ok (commands 675, restart after exit code 0)", Playwright 1440·390 에서
  데모 프로젝트가 모니터·타임라인에 그려지고 넘침 없음. Windows 엔진은 WSL 에서 cargo-xwin + LLVM 23.1.3 으로 msvc 애드온 크로스 빌드
  성공(2분 52초, PE32+ DLL 31MB). `npm run dist:win` 으로 SH-Video-Editor-Setup-0.1.1.exe(119MB, 패키지 안에 win32-x64-msvc .node 와
  NOTICE 포함)를 만들어 바탕화면에 복사. 사용자 Windows PC 실행 확인은 대기.
- **다음**: 마일스톤 2(자막·음악·전환). 알려진 구멍: 오디오 재생 없음, 웹 저장/내보내기 다운로드 UI 미연결(bridge 는 준비됨),
  미디어 썸네일 없음, 엔진 이벤트(drainEvents) 통합 전이라 패널 간 갱신은 폴링.

## 2026-10-14 - 킥오프 완료: sh-video-editor v0.1.0 (마일스톤 0)

- **요청**: craft-opensource 의 filmcraft·effectcraft·soundcraft 를 토대로 엔진을 저장소 안에 소스로 두고 개선해, CapCut·VLLO·Clideo
  같은 영상 편집기를 Electron+React 로. 링크(의존성)가 아니라 소스. 성능 중요. WASM 웹 버전도(pdf-editor-live 처럼).
- **결정**(위저드, ADR-0002·0003): npm workspaces 모노레포(apps/desktop, apps/web, packages/editor, packages/engine). 엔진은 filmcraft
  0.2.1 을 통째로 이식(ui-egui·egui 앱·ArtCraft 상표 제외), effectcraft·soundcraft 는 단계 이식. 데스크톱은 napi-rs 애드온, 웹은
  wasm-bindgen Worker. 저장은 JSON 프로젝트 + SQLite 캐시(웹 OPFS). 디자인 sh-classic dark. Windows 먼저. 제품명 SH Video Editor.
  성공 기준: 1080p 클립 3개 + 자막 + 음악 + 전환 1개를 MP4 로, 데스크톱과 Chrome 에서 같은 결과.
- **수정**: 템플릿 인스턴스화, brief(confirmed)·ADR-0002·ADR-0003·plans/0001, packages/engine(vendor/filmcraft 이식, 바인딩 2종,
  AGENTS.md·VENDOR.md), packages/editor(EngineBridge·store·셸 4부품·layout.css), apps/desktop(main·preload·renderer·난독화·스모크·
  electron-builder 설정), apps/web(Worker 브리지), NOTICE, docs/guides/packaging.md, 훅 3종, CLAUDE.md·AGENTS.md 자기완성.
  Rust 툴체인 1.94 에서 1.99 로 갱신(filmcraft rust-version 1.95), wasm32 타깃 추가.
- **검증**: `cargo check`(filmcraft-engine·cli 53초), napi 릴리스 빌드 3분 19초(.node 31MB), wasm-pack 빌드(.wasm 23MB, 미최적화),
  typecheck 3 워크스페이스, vite 빌드, electron-vite 빌드 + 난독화, xvfb 스모크 "smoke: ok (commands 675)". Node 에서 .node 직접
  호출: `file.newSequence` 후 `renderFrame` 이 480x270 프레임 반환, undo 동작. 웹을 Playwright 로 1440·390 두 크기에서 확인:
  엔진 준비됨(커맨드 675개), 가로 넘침 없음(body 기본 여백과 메뉴바 고정 높이가 원인이던 잘림·넘침 수정).
  `npm run verify` 전체 통과(아래 커밋 시점).
- **다음**: 마일스톤 1(미디어 가져오기, 타임라인, 미리보기 재생, MP4 내보내기, 저장·복구). Windows 용 .node 빌드 경로 검증이
  인스톨러 전달의 선결 과제(todo P1). GitHub 저장소 생성 여부는 사용자 결정.
