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

- [ ] Windows HW 디코드 실기 확인: 앱 정보의 엔진 버전에 `hw: Media Foundation` 이 뜨고 재생 뒤 `perf.stats` 의 decode.hardware.frames > 0 인지 (`docs/guides/packaging.md` 실기 검증 표)
- [ ] 전환 params 도 JSON 모양으로(지금은 serde 태그), 전환 길이를 소스 핸들로 제한 (`vendor/.../sh_commands.rs`)
- [ ] 키프레임 store 를 effects.keyframes 조회로 바꾸고 stale 추정 로직 제거 (`features/keyframes/store.ts`)
- [ ] whisper-small 이 짧은 파일의 둘째 30초 창을 건너뜀 (vendor `speech/whisper` nospeech 임계) / 웹 STT(putModel·OPFS)
- [ ] 미디어 패널에서 텍스트 클립의 내부 Graphic 항목 숨기기 (`features/media/types.ts`)
- [ ] 웹 Worker 에 파일 등록 경로(`Engine.putFile`, Blob range reader) 연결, OPFS 복구 (`apps/web/src/engine.worker.ts`)

## P2 - 가까운 로드맵

- [ ] VP9 인코더가 단일 스레드라 1080p 는 4 fps. 타일 병렬 또는 720p 안내 (`vendor/filmcraft/crates/vp9enc`)
- [ ] SNS 프리셋 카드가 H.264 비트레이트로 WebM 을 고르면 VP9 가 16~45 Mbps 로 인코딩. WebM 용 비트레이트 표 (`features/ratio/SnsPresets.tsx`, `features/export/presets.ts`)
- [ ] 미리보기의 4096 프레임 블록에서 WSOLA 가 1초 블록의 3.5배 비용. `SYNC_SEGMENTS` 조정 또는 renderAudio 요청 크기 (`crates/audio-dsp/src/timestretch.rs`)
- [ ] 상류 기본 단축키가 Windows 의미에서 충돌(Ctrl+T trim.toggleType/graphics.newText, Ctrl+9, Ctrl+Shift+M). 화면 키맵은 별도라 사용자 영향 없음 (`vendor/.../shortcut_presets.rs`)
- [ ] wasm 14.2MB 에서 12MB 로: interchange(AAF/OMF/FCPXML/OTIO 0.7MB)·image(tiff/gif/webp 0.5MB)·symphonia(0.4MB)·코덱 feature(1MB) 분리 (`docs/guides/wasm-performance.md`)
- [ ] 웹 글꼴 5.2MB 가 매 시작마다 fetch(브라우저 캐시 의존). Service Worker 또는 OPFS 캐시 (`apps/web/src/fonts.ts`)
- [ ] 데모 영상 생성기(`media/src/generators.rs` 픽셀별 fbm)가 wasm renderFrame 의 150ms 를 차지. 프레임 캐시 또는 저해상도 생성
- [ ] 메뉴·커맨드 라벨 한글화 (`packages/editor/src/shell/MenuBar.tsx`, 엔진 `commands.rs` 의 label)
- [ ] filmcraft-cli `mcp` 를 `.mcp.json` 에 등록해 에이전트가 헤드리스로 엔진을 검증하게
- [ ] 편집기 전용 부품(타임라인 클립, 스크러버, 트랙 헤더) 계약을 DESIGN.md 4절에 추가

## P3 - 품질

- [ ] 웹 e2e `keyframes.spec.ts` 모바일에서 부하(load 13) 때 상태 줄 기대가 1회 어긋남(재실행 통과). flaky 후보로 관찰
- [ ] GitHub Actions 첫 실행 확인: wasm-pack 설치, electron-builder 의 wine 패키지명, rust-cache 가 vendor 를 매번 재빌드하는지 (`.github/workflows/ci.yml`)
- [ ] 웹에서 Ctrl+N 은 Chrome 예약 키라 가로채지 못함. 메뉴 표기만 두거나 다른 키로
- [ ] 바인딩 단위 테스트(napi: Node 스크립트, wasm: wasm-bindgen-test)와 Playwright e2e 를 `npm run verify` 에 포함
- [ ] 데스크톱 렌더러 번들 651KB 원인 확인(난독화 전후 비교)

## P4 - 아이디어

- [ ] effectcraft hevcenc·av1enc 이식으로 HEVC/AV1 내보내기 (WebM 은 끝남, `docs/guides/webm-export.md`)
- [ ] 템플릿 갤러리(인트로·세로 SNS·슬라이드쇼)
