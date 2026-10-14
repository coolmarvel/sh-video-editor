---
title: ADR-0003 편집 엔진 이식(filmcraft·effectcraft·soundcraft)과 라이선스
created: 2026-10-14
status: accepted
---

# ADR-0003: 편집 엔진 이식과 라이선스

## 상태

Accepted (2026-10-14)

## 맥락

`/home/seonghyunlee/craft-opensource/` 에 storytold(ArtCraft) 의 Craft 앱 12종 로컬 스냅샷(2026-10-08 복사)이 있다.
그중 영상·오디오 편집에 쓸 수 있는 것:

| 저장소      | 버전  | 크기(crates)                  | 가져올 것                                                                                                                                               | 빠진 것(ROADMAP 자평)                                                     |
| ----------- | ----- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| filmcraft   | 0.2.1 | 19MB, 43 크레이트, 약 30만 줄 | 문서 모델·편집 대수·CPU/GPU 합성·코덱(H.264/HEVC/AV1/VP9/ProRes/AAC/Opus 디코드, H.264/AAC 인코드)·MP4/MKV/MXF 먹스·내보내기·자막·Whisper STT·자동 저장 | HEVC/AV1 소프트웨어 인코더, 실제 카메라 파일 검증, Windows 는 "빌드만 됨" |
| effectcraft | 0.4.0 | 15MB                          | 효과 4.9만 줄, 키프레임 이징, GPU 1.9만 줄, Lottie, **hevcenc·av1enc·vp9enc·opusenc**                                                                   | 자체 time/geom/color 가 filmcraft 와 다르다                               |
| soundcraft  | 0.1.0 | 3.3MB                         | dsp(7천 줄)·mix·playback                                                                                                                                | 시간 단위가 샘플 인덱스(filmcraft 는 Tick)                                |

세 저장소는 공유 라이브러리 없이 각자 설계됐다. 라이선스는 모두 `MIT OR Apache-2.0`, 단 `docs/brand/` 의
ArtCraft 이름·로고는 상표라 포크에서 제거해야 한다.

## 결정

1. **filmcraft 를 기반 엔진으로 통째로 이식한다.** `packages/engine/vendor/filmcraft/` 에 `crates/*`,
   `apps/filmcraft-cli`, `apps/filmcraft-web`(참고용), `xtask`, `assets`, `ATTRIBUTION.md`, `NOTICE`, 라이선스 파일을
   복사한다. `ui-egui` 와 `apps/filmcraft`(egui 데스크톱)는 복사하지 않는다. 화면은 React 가 맡는다.
   `docs/brand/` 와 README 의 ArtCraft 로고·링크는 제거한다.
2. **effectcraft·soundcraft 는 필요한 크레이트만 단계적으로 이식한다.** 1차 대상은 effectcraft 의
   `effects`·`keyframe`·`gpu`·`lottie`·`hevcenc`·`av1enc`·`vp9enc`·`opusenc` 와 soundcraft 의 `dsp`·`mix`.
   시간·기하·색 타입이 다르므로 filmcraft 타입으로 어댑터를 두고 옮긴다. 이식하기 전까지는 원본 스냅샷을
   참조만 한다(복사하지 않는다).
3. **크레이트 이름은 당장 바꾸지 않는다.** `filmcraft-*` 이름을 유지하고, 우리 코드는 `packages/engine/bindings/`
   (napi, wasm)와 `packages/engine/crates/sh-*`(우리가 새로 쓰는 층)에 둔다. 통합이 안정된 뒤 한 번에 개명한다.
4. **엔진 규칙을 계승한다.** filmcraft `AGENTS.md` 의 never-crash(unwrap/expect/panic 금지, 입력 숫자는 적대적),
   클린룸(GPL 코드·ffmpeg 링크 금지, 코덱은 공개 스펙만), 계층 강제(`cargo xtask layers`), L0~L4 wasm32 빌드 필수,
   CPU 레퍼런스 + GPU 패리티를 그대로 적용한다. 이 규칙은 `packages/engine/AGENTS.md` 로 둔다.
5. **라이선스 고지.** 루트 `NOTICE` 에 filmcraft·effectcraft·soundcraft 의 저작권 표시와 MIT/Apache-2.0 전문 위치를
   적고, `packages/engine/vendor/<이름>/` 에 원본 `LICENSE-MIT`·`LICENSE-APACHE`·`NOTICE`·`ATTRIBUTION.md` 를 유지한다.
   우리 저장소 전체 라이선스는 `LICENSE`(UNLICENSED, 제작자 이성현)이며, 이식한 코드에만 MIT/Apache 가 적용된다.
   배포물(인스톨러·웹)에도 NOTICE 를 동봉한다.
6. **출처 기록.** 이식한 각 저장소의 버전·복사일·출처 URL 을 `packages/engine/vendor/<이름>/VENDOR.md` 에 적는다.
   상류(upstream) 갱신을 끌어오는 일은 사람이 diff 를 보고 결정하며 자동 동기화하지 않는다.

## 근거

- 사용자가 "링크보다 소스로 두고 개선"을 원했고, Craft 앱들 자체가 복사 원칙으로 만들어졌다.
  git rev 의존은 우리 수정이 상류에 막혀 포크 관리가 필요해지므로 차이가 없다.
- filmcraft 는 편집기의 뼈대(문서 모델·편집·렌더·내보내기·코덱)가 한 벌로 맞물려 있어 통째로 가져와야 바로 돈다.
  effectcraft·soundcraft 는 타입 체계가 달라 통째로 넣으면 같은 역할의 크레이트가 두 벌씩 생긴다.
- 크레이트 개명을 미루는 이유: 43개 크레이트의 import 를 지금 바꾸면 상류와 diff 가 불가능해지고 초기 통합
  버그를 가린다.

## 결과

- 저장소에 Rust 소스 약 20MB 가 들어간다. 빌드 캐시(`target/`)는 gitignore.
- 엔진 수정은 모두 우리 책임이 된다. 상류의 버그 수정은 수동으로 가져온다.
- ArtCraft 상표 제거를 CI(`cargo xtask assets`)가 아니라 체크리스트로 지킨다. `docs/brand/` 가 없으면 끝.
