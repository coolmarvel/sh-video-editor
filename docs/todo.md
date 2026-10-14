---
title: TODO
created: 2026-10-14
updated: 2026-10-14
domain: development
---

# TODO (미해결·향후 작업만, 완료분은 session-log 로)

우선순위: **P1** 다음 릴리스에서 다뤄야 함 · **P2** 가까운 로드맵 · **P3** 품질 · **P4** 아이디어.
항목에는 대상 파일 경로와 (있다면) 과거 사고 근거를 함께 적는다.

## P1 - 다음 릴리스에서 다뤄야 함

- [ ] 마일스톤 1 마무리: 웹에서 저장·열기·내보내기 다운로드 UI 연결(bridge 의 registerFiles/onFileWritten/opfs 는 준비됨, features/project·export 의 안내 문구 자리)
- [ ] 엔진 이벤트 통합: 바인딩 drainEvents 를 루트 store 가 폴링해 "revision 변경" 하나로 미디어·타임라인·모니터·프로젝트 패널을 갱신(지금은 각자 폴링)
- [ ] 단축키 충돌 정리: Space/화살표/Home/End(모니터 vs 타임라인), Ctrl+N(새 프로젝트 vs 엔진 file.newSequence)
- [ ] 오디오 재생(모니터, 범위 밖이었음)
- [ ] Windows 용 `.node` 빌드 경로 확정: Windows 에서 `napi build --target x86_64-pc-windows-msvc` 또는 WSL mingw 크로스 빌드.
      `vendor/filmcraft/crates/platform` 의 Media Foundation FFI 링크 검증 (`docs/guides/packaging.md`)
- [ ] 엔진을 Electron utility process 로 옮겨 크래시 격리 (`apps/desktop/src/main/index.ts`, ADR-0002)
- [ ] 웹 Worker 에 파일 등록 경로(`Engine.putFile`, Blob range reader) 연결, OPFS 복구 (`apps/web/src/engine.worker.ts`)

## P2 - 가까운 로드맵

- [ ] wasm 크기 23MB 줄이기: wasm-opt, 코덱 feature 분리, 지연 로드 (`packages/engine/bindings/wasm`)
- [ ] 메뉴·커맨드 라벨 한글화 (`packages/editor/src/shell/MenuBar.tsx`, 엔진 `commands.rs` 의 label)
- [ ] 앱 아이콘(`apps/desktop/build/icon.ico|png`) 제작, 스플래시 없음
- [ ] vendored xtask 의 `wasm` 서브커맨드가 ui-egui 를 가리킴. `WEB_CRATES` 를 engine 까지로 바꾸기 (`vendor/filmcraft/xtask/src/main.rs`, VENDOR.md)
- [ ] filmcraft-cli `mcp` 를 `.mcp.json` 에 등록해 에이전트가 헤드리스로 엔진을 검증하게
- [ ] 편집기 전용 부품(타임라인 클립, 스크러버, 트랙 헤더) 계약을 DESIGN.md 4절에 추가

## P3 - 품질

- [ ] 바인딩 단위 테스트(napi: Node 스크립트, wasm: wasm-bindgen-test)와 Playwright e2e 를 `npm run verify` 에 포함
- [ ] 이식 엔진 `cargo xtask ci` 를 CI 로 (지금은 로컬 수동)
- [ ] 데스크톱 렌더러 번들 651KB 원인 확인(난독화 전후 비교)

## P4 - 아이디어

- [ ] effectcraft 인코더(hevcenc·av1enc·vp9enc)로 HEVC/AV1/WebM 내보내기 (마일스톤 3)
- [ ] 템플릿 갤러리(인트로·세로 SNS·슬라이드쇼)
