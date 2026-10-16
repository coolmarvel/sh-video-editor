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

- [ ] 웹 decode 캐시가 탐색 뒤 474MB 까지 남음. 예산을 줄이면 긴 GOP 뒤로 문지르기가 느려져(V1 표) 되돌렸다. 디코더 상태 스냅샷 같은 다른 방법이 필요 (`crates/codecs/src/gop.rs`)
- [ ] 상류 기본 단축키가 Windows 의미에서 충돌(Ctrl+T trim.toggleType/graphics.newText, Ctrl+9, Ctrl+Shift+M). 화면 키맵은 별도라 사용자 영향 없음 (`vendor/.../shortcut_presets.rs`)
- [ ] wasm 13.99MB 에서 12MB 로: 남은 후보(webp·gif 이미지, symphonia 음악 가져오기, MPEG-2·AV1 코덱)는 웹 기능을 빼야 해 결정 필요 (`docs/guides/wasm-performance.md`)

## P3 - 품질

- [ ] filmcraft-engine 크레이트 전체 병렬 실행 26회 중 1회 실패(출력 미저장, 테스트 특정 못 함, 그 뒤 21회 연속 통과). 다시 나오면 출력부터 저장 (`cargo test -p filmcraft-engine`)
- [ ] 웹(wasm)은 스레드가 없어 재생 읽어 두기가 없음. WebCodecs 디코더 Worker 에서 앞으로 디코드 (`apps/web/src/decoder.worker.ts`, docs/guides/playback.md)
- [ ] Windows HEVC 다시 재생의 첫 멈춤 한 번(700 에서 490ms 로 줄었지만 남음) (docs/guides/playback.md)
- [ ] 데스크톱 프레임 전송 2MB 약 13ms(MB 당 5~8ms). YUV 로 보내면 약 2.7배 작음 (performance-audit.md R3)
- [ ] 웹 자동 자막이 한 스레드. wasm-bindgen-rayon 은 빌드 플래그·헤더가 더 필요 (`packages/engine/bindings/speech-wasm`)
- [ ] 웹 큰 파일 e2e 는 임시 컨텍스트 OPFS 한도(약 500MB) 때문에 복사 성공 실측 불가. 영속 컨텍스트로 (`apps/web/e2e/web-files.spec.ts`)
- [ ] windows-installer dispatch job(wine 패키지명)은 아직 미실행 (`.github/workflows/ci.yml`)

## P4 - 아이디어

- [ ] 데모 생성기 부동소수 결과가 데스크톱(C 라이브러리)과 웹(Rust libm)에서 마지막 비트가 가끔 다름. 플랫폼 사이 바이트 비교에만 영향, libm 으로 바꾸면 데모 렌더가 느려짐 (`crates/media/src/generators.rs`)
- [ ] 템플릿 갤러리(인트로·세로 SNS·슬라이드쇼)
- [ ] 웹 자동 자막·OPFS 보관을 Safari·Firefox 에서 확인 (Chromium 만 검증)
