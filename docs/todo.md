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
- [ ] 오디오 재생(모니터, 범위 밖이었음)
- [ ] Windows HW 디코드: napi 바인딩에 `filmcraft-platform` 의존 + `register()` 호출, cargo-xwin 빌드에서 Media Foundation 링크 검증
- [ ] 웹 Worker 에 파일 등록 경로(`Engine.putFile`, Blob range reader) 연결, OPFS 복구 (`apps/web/src/engine.worker.ts`)

## P2 - 가까운 로드맵

- [ ] wasm 크기 23MB 줄이기: wasm-opt, 코덱 feature 분리, 지연 로드 (`packages/engine/bindings/wasm`)
- [ ] 메뉴·커맨드 라벨 한글화 (`packages/editor/src/shell/MenuBar.tsx`, 엔진 `commands.rs` 의 label)
- [ ] vendored xtask 의 `wasm` 서브커맨드가 ui-egui 를 가리킴. `WEB_CRATES` 를 engine 까지로 바꾸기 (`vendor/filmcraft/xtask/src/main.rs`, VENDOR.md)
- [ ] filmcraft-cli `mcp` 를 `.mcp.json` 에 등록해 에이전트가 헤드리스로 엔진을 검증하게
- [ ] 편집기 전용 부품(타임라인 클립, 스크러버, 트랙 헤더) 계약을 DESIGN.md 4절에 추가

## P3 - 품질

- [ ] 데스크톱 e2e "엔진 강제 종료 복구" 가 전체 실행 중 CPU 경합 시 120초 타임아웃(단독 통과). onCrashed 수신 대기에 타임아웃·재시도를 두고 원인 추적 (`apps/desktop/e2e/app.spec.ts`)
- [ ] 엔진 입력 검증 강화(it.fails 2건, `packages/engine/tests/napi.test.ts`): 비객체 params·문자열 time 거부, 없는 clip id 선택 거부. vendor `crates/engine` 수정이라 `engine(vendor):` 커밋
- [ ] 웹에서 Ctrl+N 은 Chrome 예약 키라 가로채지 못함. 메뉴 표기만 두거나 다른 키로
- [ ] 바인딩 단위 테스트(napi: Node 스크립트, wasm: wasm-bindgen-test)와 Playwright e2e 를 `npm run verify` 에 포함
- [ ] 이식 엔진 `cargo xtask ci` 를 CI 로 (지금은 로컬 수동)
- [ ] 데스크톱 렌더러 번들 651KB 원인 확인(난독화 전후 비교)

## P4 - 아이디어

- [ ] effectcraft 인코더(hevcenc·av1enc·vp9enc)로 HEVC/AV1/WebM 내보내기 (마일스톤 3)
- [ ] 템플릿 갤러리(인트로·세로 SNS·슬라이드쇼)
