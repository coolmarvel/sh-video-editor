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

- [ ] Windows HW 디코드 실기 확인: 앱 정보의 엔진 버전에 `hw: Media Foundation` 이 뜨고 재생 뒤 `perf.stats` 의 decode.hardware.frames > 0 인지 (`docs/guides/packaging.md` 실기 검증 표)

## P2 - 가까운 로드맵

- [ ] 데스크톱 drainEvents 의 projectChanged 에 revision 이 없어(useEngineEvents.revision 이 -1 로 남음) RevisionGate 중복 제거가 데스크톱에서는 작동하지 않음. 웹(wasm)만 효과. engine-host 또는 napi 이벤트 JSON 에 revision 을 싣기 (`apps/desktop/src/engine-host`, `packages/engine/bindings/napi`)
- [ ] 크래시 보고에 `history.list` 스냅샷(engine-host 가 주기적으로 main 에 보내야 함)과 패키지본 productName (`apps/desktop/src/main/crash-report.ts`)
- [ ] 스모크(`SH_SMOKE`)가 실제 userData 에 crash-reports 파일을 남김. 스모크 때는 crashDir 비우기 (`apps/desktop/src/main/engine-supervisor.ts`)
- [ ] VP9·HEVC·AV1 인코더가 단일 스레드라 1080p 는 4 fps·2.3 fps·1.7 fps. 타일 병렬 또는 720p 안내 (`vendor/filmcraft/crates/vp9enc`, `crates/hevcenc`, `crates/av1enc`)
- [ ] AV1 레이트 컨트롤이 단순 영상에서 양자화 하한에 머물러 목표 10 Mbps 에 2.6 Mbps 로 못 미침(프리셋 비트레이트가 파일 크기를 거의 못 바꿈). q 하한 완화 또는 품질 모드 (`crates/av1enc/src/decide.rs`, `docs/guides/webm-export.md` 3.5)
- [ ] 움직이는 스티커가 512px 문서 크기로 래스터되어 그보다 훨씬 키우면 가장자리가 부드러워짐. 항목 크기를 모션 scale 에 맞춰 `at_size` 로 다시 열기 (`vendor/.../media_pool.rs`, `features/stickers/store.ts`)
- [ ] 흔들림 분석 캐시가 프로세스 전역이고 새 프로젝트·열기 때만 비움. 클립 삭제·미디어 교체 때도 무효화 (`vendor/.../render/src/vfx/temporal.rs`, `crates/engine/src/stabilize.rs`)
- [ ] 엔진 toast 이벤트 영문 문구("Scene Edit Detection found no cut points" 등)를 번역표로 (`features/events/poller.ts`)
- [ ] SNS 프리셋 카드가 H.264 비트레이트로 WebM 을 고르면 VP9 가 16~45 Mbps 로 인코딩. WebM 용 비트레이트 표 (`features/ratio/SnsPresets.tsx`, `features/export/presets.ts`)
- [ ] 상류 기본 단축키가 Windows 의미에서 충돌(Ctrl+T trim.toggleType/graphics.newText, Ctrl+9, Ctrl+Shift+M). 화면 키맵은 별도라 사용자 영향 없음 (`vendor/.../shortcut_presets.rs`)
- [ ] wasm 14.2MB 에서 12MB 로: interchange(AAF/OMF/FCPXML/OTIO 0.7MB)·image(tiff/gif/webp 0.5MB)·symphonia(0.4MB)·코덱 feature(1MB) 분리 (`docs/guides/wasm-performance.md`)
- [ ] 웹 글꼴 5.2MB 가 매 시작마다 fetch(브라우저 캐시 의존). Service Worker 또는 OPFS 캐시 (`apps/web/src/fonts.ts`)
- [ ] 편집기 전용 부품(타임라인 클립, 스크러버, 트랙 헤더) 계약을 DESIGN.md 4절에 추가
- [ ] 데모 장면 OceanSunset 74ms·Forest 64ms 가 wasm renderFrame 60ms 목표 초과(x·y 둘 다에 걸린 fbm 이 남은 비용) (`crates/media/src/generators.rs`)
- [ ] wasm 프레임 캐시가 1080p 탐색 몇 번에 선형 메모리를 약 670MB 로 키우고 줄지 않음. 캐시 예산 (`crates/media/src/cache.rs` 호출부)
- [ ] 자르지 않은 클립 사이 전환은 끝 프레임이 멈춰 보임(repeatFrames 로 알림만). "핸들 자동으로 다듬기" 제안 (`features/transitions/store.ts`)

## P3 - 품질

- [ ] vendor hevc conformance `draft_mode_changes_only_flagged_non_reference_pictures` 가 부하 중 1회 실패(단독 5회·스위트 5회 통과). flaky 관찰 (`crates/hevc`)
- [ ] 웹 자동 자막이 한 스레드. wasm-bindgen-rayon 은 빌드 플래그·헤더가 더 필요 (`packages/engine/bindings/speech-wasm`)
- [ ] 웹 큰 파일 e2e 는 임시 컨텍스트 OPFS 한도(약 500MB) 때문에 복사 성공 실측 불가. 영속 컨텍스트로 (`apps/web/e2e/web-files.spec.ts`)
- [ ] windows-installer dispatch job(wine 패키지명)은 아직 미실행 (`.github/workflows/ci.yml`)
- [ ] DESIGN.md 절 번호 중복(4.24 가 둘, 4.17 재사용). 번호를 다시 매기고 usage.md·코드 주석의 참조도 함께 (`DESIGN.md`)
- [ ] 390 폭에서 잡 진행 칸이 켜진 상태 줄은 e2e 로만 확인했고 눈으로 안 봄. 스크린샷 확인 (`features/jobs/jobs.css`, `shell/layout.css`)
- [ ] 웹 e2e `keyframes.spec.ts` 모바일에서 부하(load 13) 때 상태 줄 기대가 1회 어긋남(재실행 통과). flaky 후보로 관찰
- [ ] 웹에서 Ctrl+N 은 Chrome 예약 키라 가로채지 못함. 메뉴 표기만 두거나 다른 키로
- [ ] 바인딩 단위 테스트(napi: Node 스크립트, wasm: wasm-bindgen-test)와 Playwright e2e 를 `npm run verify` 에 포함

## P4 - 아이디어

- [ ] 템플릿 갤러리(인트로·세로 SNS·슬라이드쇼)
- [ ] 웹 자동 자막·OPFS 보관을 Safari·Firefox 에서 확인 (Chromium 만 검증)
