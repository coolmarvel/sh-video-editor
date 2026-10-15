---
title: TODO
created: 2026-10-14
updated: 2026-10-15
domain: development
---

# TODO (미해결·향후 작업만, 완료분은 session-log 로)

우선순위: **P1** 다음 릴리스에서 다뤄야 함 · **P2** 가까운 로드맵 · **P3** 품질 · **P4** 아이디어.
항목에는 대상 파일 경로와 (있다면) 과거 사고 근거를 함께 적는다.

## P1 - 다음 릴리스에서 다뤄야 함

(없음)

## P2 - 가까운 로드맵

- [ ] HEVC 내보내기 바이트가 wasm 과 napi 에서 다름(0.1.9 부터, 같은 플랫폼 안에서는 작업자 수와 무관하게 같음). lambda·레이트 컨트롤의 `powf`·`log` 부동소수 의심 (`crates/hevcenc`)
- [ ] 움직이는 스티커가 512px 문서 크기로 래스터되어 그보다 훨씬 키우면 가장자리가 부드러워짐. 항목 크기를 모션 scale 에 맞춰 `at_size` 로 다시 열기 (`vendor/.../media_pool.rs`, `features/stickers/store.ts`)
- [ ] 흔들림 분석 캐시가 프로세스 전역이고 새 프로젝트·열기 때만 비움. 클립 삭제·미디어 교체 때도 무효화 (`vendor/.../render/src/vfx/temporal.rs`, `crates/engine/src/stabilize.rs`)
- [ ] 상류 기본 단축키가 Windows 의미에서 충돌(Ctrl+T trim.toggleType/graphics.newText, Ctrl+9, Ctrl+Shift+M). 화면 키맵은 별도라 사용자 영향 없음 (`vendor/.../shortcut_presets.rs`)
- [ ] wasm 14.2MB 에서 12MB 로: interchange(AAF/OMF/FCPXML/OTIO 0.7MB)·image(tiff/gif/webp 0.5MB)·symphonia(0.4MB)·코덱 feature(1MB) 분리 (`docs/guides/wasm-performance.md`)
- [ ] 데모 장면 OceanSunset 74ms·Forest 64ms 가 wasm renderFrame 60ms 목표 초과(x·y 둘 다에 걸린 fbm 이 남은 비용) (`crates/media/src/generators.rs`)
- [ ] wasm 프레임 캐시가 1080p 탐색 몇 번에 선형 메모리를 약 670MB 로 키우고 줄지 않음. 캐시 예산 (`crates/media/src/cache.rs` 호출부)

## P3 - 품질

- [ ] AV1 슈퍼블록 band 할당이 매번 약 380KB. 작업자마다 band 버퍼 재사용 (`crates/av1enc`)
- [ ] 새 워크트리는 `speech-wasm/pkg` 가 없어 typecheck·웹 빌드 전에 `npm run build:engine:speech` 또는 main 에서 복사가 필요. 워크트리 안내에 적기 (`docs/guides/testing.md`)
- [ ] 웹 e2e `web-files.spec` 390 의 최근 프로젝트 메뉴 테스트가 부하(load 10~15) 중 1회 실패(단독 5회 통과). flaky 관찰
- [ ] Windows 스냅 레이아웃(최대화 버튼 hover)이 투명 titleBarOverlay 에서도 뜨는지 눈으로 확인 (`apps/desktop/src/main/index.ts`)
- [ ] vendor hevc conformance `draft_mode_changes_only_flagged_non_reference_pictures` 가 부하 중 1회 실패(단독 5회·스위트 5회 통과). flaky 관찰 (`crates/hevc`)
- [ ] 웹 자동 자막이 한 스레드. wasm-bindgen-rayon 은 빌드 플래그·헤더가 더 필요 (`packages/engine/bindings/speech-wasm`)
- [ ] 웹 큰 파일 e2e 는 임시 컨텍스트 OPFS 한도(약 500MB) 때문에 복사 성공 실측 불가. 영속 컨텍스트로 (`apps/web/e2e/web-files.spec.ts`)
- [ ] windows-installer dispatch job(wine 패키지명)은 아직 미실행 (`.github/workflows/ci.yml`)
- [ ] 웹 e2e `keyframes.spec.ts` 모바일에서 부하(load 13) 때 상태 줄 기대가 1회 어긋남(재실행 통과). flaky 후보로 관찰
- [ ] 바인딩 단위 테스트(napi: Node 스크립트, wasm: wasm-bindgen-test)와 Playwright e2e 를 `npm run verify` 에 포함

## P4 - 아이디어

- [ ] 템플릿 갤러리(인트로·세로 SNS·슬라이드쇼)
- [ ] 웹 자동 자막·OPFS 보관을 Safari·Firefox 에서 확인 (Chromium 만 검증)
