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
