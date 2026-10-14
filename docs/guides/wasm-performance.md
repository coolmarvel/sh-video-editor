---
title: wasm 엔진 성능과 크기 (M4-4)
created: 2026-10-14
updated: 2026-10-14
domain: web
---

# wasm 엔진 성능과 크기 (M4-4)

## 개요

웹(apps/web)은 Rust 엔진을 Worker 안의 wasm 으로 돌린다. 로드맵 0002 의 2.2 4항과 M4-4 가 문제로 둔 것은 둘이다.
(1) wasm 이 21MB 라 첫 로드가 길고, (2) 1080p 미리보기 `renderFrame(scale 0.5)` 가 네이티브의 여러 배 느리다.
이 문서는 측정 방법, 전후 수치, 켜 둔 빌드 플래그, 브라우저 디코더(WebCodecs) 설계와 제약, 폴백을 적는다.
수치는 모두 `scripts/bench-wasm.mjs` 와 `packages/engine/tests/wasm-bench.mjs` 로 잰 것이고, 다시 잴 때도 같은 스크립트를 쓴다.

결과 요약(측정 조건과 표는 아래):

- 크기: 21.2MB 에서 14.2MB(gzip 5.3MB) 로. 번들 글꼴을 wasm 밖으로 빼고(5.2MB), 크기 위주 opt-level 과 wasm-opt 를 쓴다.
- 속도: H.264 1080p 는 브라우저의 `VideoDecoder`(WebCodecs)가 디코드하고 엔진은 합성만 한다. wasm SIMD128 을 켰다.
- 데모 영상(엔진이 수식으로 그리는 합성 영상)은 디코더가 없어 WebCodecs 의 영향을 받지 않는다. 로드맵의 "194ms" 는 이 데모를 잰
  값이라 생성기 자체의 비용이며, 실제 mp4 의 미리보기 시간과는 다르다.

## 측정 방법

두 벤치가 있다. 결과가 같은 조건에서 나오도록 다른 빌드가 돌지 않을 때 잰다(이 기계는 다른 에이전트의 cargo 빌드가 겹치면
load average 가 20 을 넘고 수치가 1.5~2배 흔들린다).

| 스크립트                                    | 환경                                | 재는 것                                                                                                                                                                   |
| ------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/bench-wasm.mjs`               | 실제 Chromium(Playwright)           | wasm 크기·전송 크기, 엔진 준비 시간, 데모 1080p `renderFrame(0.5)` 20회 평균·중앙값, H.264 1080p30 corpus 의 임의 탐색·순차 재생, 720p 내보내기 시간(데모 2초, H.264 3초) |
| `node packages/engine/tests/wasm-bench.mjs` | Node(브라우저 없음, WebCodecs 없음) | 같은 renderFrame 을 wasm 소프트웨어 경로만으로. 빌드 플래그끼리 비교할 때 빠르다                                                                                          |

`bench-wasm.mjs` 는 `--pkg <dir>` 를 여러 번 받아 pkg 마다 `vite build`(환경 변수 `SH_ENGINE_PKG`, `apps/web/vite.config.ts`)
와 `vite preview` 를 띄우고 한 표로 비교한다. 포트는 `--port`(기본 4320, 다른 작업과 겹치지 않게 4300번대). 페이지 안에서는
QA 훅 `window.shBridge` 로 Worker 의 엔진을 부르므로 시간에 Worker 왕복이 들어간다(사용자가 보는 값). H.264 는
`packages/engine/tests/corpus/out/galaxy_h264_high_1080p30_aac48k.mp4`(`corpus/gen.sh` 로 ffmpeg 가 만든다)를 base64 로 페이지에
넘겨 `File` 로 등록한다. 없으면 그 항목은 건너뛴다.

## 전후 수치

### 빌드 플래그 (크기, 같은 소스)

wasm-pack 산출물 `sh_video_engine_wasm_bg.wasm` 의 바이트. 글꼴 열은 번들 글꼴을 wasm 밖으로 뺐는지.

| 빌드                         | opt-level        | LTO  | SIMD | 글꼴 | wasm-opt | 크기                    | gzip -9 |
| ---------------------------- | ---------------- | ---- | ---- | ---- | -------- | ----------------------- | ------- |
| 기준(이전 `--release`)       | 3                | thin | off  | 안   | -O       | 21.21MB                 | 9.09MB  |
| E1                           | 3                | fat  | off  | 안   | -O       | 21.21MB                 | 9.09MB  |
| E4                           | 3                | thin | on   | 밖   | 없음     | 21.10MB                 |         |
| E4 + wasm-opt -O / -Os / -Oz | 3                | thin | on   | 밖   | 각각     | 15.85 / 15.85 / 15.77MB | 5.79MB  |
| E2                           | s                | thin | on   | 밖   | -O       | 12.42MB                 |         |
| **E5 (채택)**                | s, 핫 크레이트 3 | thin | on   | 밖   | -O       | 14.21MB                 | 5.33MB  |

- wasm-opt 는 -O 로 25% 를 줄이지만 -Os 는 -O 와 바이트까지 같고 -Oz 는 0.5% 차이라 wasm-pack 기본(-O)을 그대로 쓴다.
- fat LTO 는 thin(codegen-units 1)과 바이트까지 같았다.
- E5 의 단면: 코드 12.5MB + 데이터 1.7MB. 기준은 코드 14.2MB + 데이터 7.0MB(글꼴 5.6MB).

### 빌드 플래그 (속도, Node 벤치 `wasm-bench.mjs`, WebCodecs 없음)

같은 실행에서 연달아 잰 값(load average 20 안팎이라 절대값은 참고만, 상대 비교용). ms 는 renderFrame(scale 0.5) 평균.

| 빌드                   | 데모 1080p | H.264 임의 탐색 | H.264 순차 |
| ---------------------- | ---------- | --------------- | ---------- |
| E1 (3, SIMD off)       | 193        | 72              | 32         |
| E4 (3, SIMD on)        | 169        | 82              | 40         |
| E5 (s + 핫 3, SIMD on) | 165        | 54              | 29         |
| E2 (s, SIMD on)        | 226        | 103             | 43         |

opt-level "s" 를 전부에 주면 25~40% 느려지고, 디코더·렌더·DSP 크레이트만 3 으로 되돌리면(E5) 전부 3 인 빌드와 같은 속도에
1.6MB 작다. SIMD 단독 효과는 이 소음 안에서 가려진다(아래 "SIMD").

### 브라우저 (`scripts/bench-wasm.mjs`, Playwright Chromium 1440x900, vite preview)

기준은 작업 시작 때(이전 `--release` 빌드, 글꼴 포함, WebCodecs 없음), 최종은 같은 스크립트로 load average 3 에서 잰 값. ms 는
평균 / 중앙값. "전송" 이 identity 인 것은 vite preview 가 압축하지 않기 때문이고 gzip 크기는 위 표.

| 빌드 | wasm    | 준비 | 데모 1080p 0.5 | H.264 1080p 임의 탐색 | H.264 순차  | 내보내기 데모 2초 720p | 내보내기 H.264 3초 720p | 디코더                            |
| ---- | ------- | ---- | -------------- | --------------------- | ----------- | ---------------------- | ----------------------- | --------------------------------- |
| 기준 | 21.21MB | 0.3s | 199.9 / 194.5  | 77.4 / 65.4           | 27.8 / 26.6 | 29.7s                  | 15.3s                   | 소프트웨어(softwareFrames 90)     |
| 최종 | 14.21MB | 0.3s | 190.4 / 178.1  | 51.4 / 41.2           | 24.8 / 25.2 | 20.6s                  | 10.4s                   | WebCodecs(frames 90, fallbacks 0) |

- 데모 영상은 디코더가 없어 생성기 비용(약 150ms)이 그대로다. 목표 60ms 는 데모에서는 못 미쳤다(아래 "남은 것").
- H.264 순차 재생의 25ms 는 디코드가 아니라 나머지(YUV 를 RGB 로, 축소, RGBA 포장, Worker 전송)가 대부분이다. 프레임 캐시에
  맞으면 12ms 안팎(위 Node 벤치의 min). 임의 탐색은 GOP 처음부터 다시 디코드하는 비용이 브라우저 디코더로 가면서 1/3 줄었다.
- 내보내기(H.264 인코드는 wasm 소프트웨어 `filmcraft-h264enc`)는 1.5배 빨라졌다. 데스크톱(napi, 네이티브)과의 비율은 아직 재지 않았다.

## 켜 둔 플래그와 각각의 효과

| 항목                                      | 위치                                                                                                                            | 효과(측정)                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 전용 cargo 프로파일 `wasm-release`        | `packages/engine/Cargo.toml`                                                                                                    | napi 의 `release` 를 건드리지 않고 wasm 만 바꾼다. `wasm-pack build --profile wasm-release`                                                                                                                                                                                                                                                        |
| `opt-level = "s"` + 핫 크레이트만 `3`     | 같은 파일 `[profile.wasm-release.package.*]`                                                                                    | 전부 "s" 는 12.4MB 지만 25~40% 느리고, 전부 3 은 15.9MB. 핫 크레이트(h264·hevc·vp9·av1·h264enc·aac·opus·codecs·media·frame·color·geom·render·export·audio-dsp·text)만 3 으로 두면 14.2MB 에 전부 3 과 같은 속도                                                                                                                                    |
| `codegen-units = 1`, `panic = "abort"`    | 같은 파일                                                                                                                       | wasm32-unknown-unknown 은 원래 `panic=abort` 라 abort 는 명시일 뿐 크기 변화 없음. cgu 1 은 상류 release 와 같다                                                                                                                                                                                                                                   |
| `lto = "fat"` (시험)                      | 시험만                                                                                                                          | thin(cgu 1) 과 바이트 단위로 같았다(21,210,908 vs 21,211,063). 메모리를 더 쓰므로 thin 을 그대로 둔다                                                                                                                                                                                                                                              |
| wasm SIMD128 `-C target-feature=+simd128` | `packages/engine/.cargo/config.toml` (`[target.wasm32-unknown-unknown]`)                                                        | 켰다. 코드가 `wide` 나 `core::arch::wasm32` 를 직접 쓰지는 않고 LLVM 자동 벡터화에 맡긴다(디코더 IDCT·보간, `frame` 의 색변환·축소, `render` 블렌드). 같은 조건에서 잰 Node 벤치는 E1(off) 193/72/32ms 대 E4(on) 169/82/40ms 로 측정 소음 안에 있어 "확실히 빨라졌다" 고 적지 않는다. 크기는 0.1MB 줄었다. 모든 대상 브라우저가 지원하므로 켜 둔다 |
| wasm-opt                                  | wasm-pack 기본(`--profile` 빌드도 -O 로 돌린다)                                                                                 | -O 가 21.1MB 에서 15.9MB(25%). -Os 는 -O 와 같고 -Oz 는 0.5% 더 작아 기본값을 그대로 둔다                                                                                                                                                                                                                                                          |
| 번들 글꼴을 wasm 밖으로                   | `vendor/.../crates/text/src/fonts.rs`(wasm32 는 Inter Regular 만 `include_bytes!`), `apps/web/src/fonts.ts`, `engine.worker.ts` | 데이터 세그먼트 7.0MB 중 5.2MB 감소. 글꼴 8개(Inter 4종, JetBrains Mono, Noto Serif, Pretendard 2종)는 vite 정적 자산으로 wasm 과 나란히 받아 `addFontData` 로 넣고, 다 넣은 뒤에야 엔진이 "준비됨" 이 되므로 글꼴 목록은 데스크톱과 같다                                                                                                          |
| 코덱 크레이트 feature 분리                | 하지 않음                                                                                                                       | 이름 섹션으로 잰 코드 크기: av1 0.51MB, vp9 0.34, mxf 0.13, mpeg2v 0.06, dnx 0.06, prores 0.05, ac3·apv·mpegts 각 0.05 미만(wasm-opt 전). 합쳐도 1MB 안팎인데 codecs·export·engine·hw_frame 에 cfg 가 40곳 넘게 들어가 상류 diff 가 커진다. 보류(아래 "남은 것")                                                                                   |

wasm-pack 은 `--profile <custom>` 일 때 `[package.metadata.wasm-pack.profile.<custom>]` 을 모르는 키로 무시하고(경고), `release`
의 wasm-opt 설정도 쓰지 않는다(시험: release 에 잘못된 플래그를 넣어도 통과). 기본 `-O` 는 돌리므로 플래그를 바꾸려면 `--no-opt` 뒤에 binaryen 을 직접 불러야 하는데, -Os/-Oz 가 이득이 없어 그러지 않았다.

크기 분석은 `cargo build --profile wasm-release --target wasm32-unknown-unknown` 산출물(이름 섹션이 남아 있다)의 함수 본문을
크레이트별로 더해서 했다. 큰 순서: filmcraft_engine 2.5MB, core 1.7(제네릭 포함), serde 1.8, rayon 1.3(클로저 본문이 묻어
들어옴), project 0.7, interchange 0.7(AAF·OMF·FCPXML·OTIO), av1 0.5, render 0.5, image 계열(zune_jpeg·tiff·webp·png) 1.0,
symphonia 0.4, 글꼴 셰이핑(harfrust·read_fonts·skrifa) 0.8.

## 브라우저 디코더 (WebCodecs)

### 설계

엔진의 디코더 trait(`filmcraft_codecs::VideoDecoder`)은 `decode(sample) -> frames` 가 바로 돌아와야 하고, 엔진은 Worker 안에서
동기로 돈다(`renderFrame` 은 wasm 호출 하나). WebCodecs `VideoDecoder` 는 비동기이고 출력 콜백이 그 Worker 의 이벤트 루프에서
돌아야 하므로, 엔진이 도는 동안에는 절대 돌 수 없다. 그래서 Worker 를 하나 더 둔다.

```
엔진 Worker (engine.worker.ts)                 디코더 Worker (decoder.worker.ts)
  wasm: WebDecoder::decode(sample)
    -> hooks.decode()  (webcodecs.ts)
         ctrl[STATE] = PENDING
         postMessage({op:'decode', sample, pts, key})  ----->  VideoDecoder.decode(chunk)
         Atomics.wait(ctrl, STATE, PENDING, 4000ms)             decodeQueueSize 가 0 이 될 때까지 기다림
                                                                 나온 VideoFrame 들을 공유 버퍼에 copyTo (I420/NV12, 타이트 평면)
         <--- Atomics.notify  ----------------------------       ctrl[STATE] = DONE, ctrl[LEN] = 바이트 수
         data.slice(0, len) 를 wasm 에 돌려줌
    <- 프레임 묶음을 VideoFrame(Yuv8 C420) 로 풀어 엔진 캐시에
```

- 요청은 `postMessage` 로 보낸다. 보낸 직후 `Atomics.wait` 로 막혀도 메시지는 상대 Worker 큐에 쌓이므로 괜찮다. 답은
  `SharedArrayBuffer`(제어 4개 int32 + 프레임 버퍼 16MB, 모자라면 `GROW` 로 키운다)에 쓰고 `Atomics.notify` 로 깨운다.
  `Atomics.wait` 는 Worker 에서만 허용된다(메인 스레드 불가). `SharedArrayBuffer` 는 cross-origin isolation 이 있어야 생기며
  `apps/web/vite.config.ts` 가 dev·preview 에 COOP/COEP 헤더를 보낸다. 배포 서버도 같은 헤더를 보내야 한다.
- 샘플은 mp4 의 길이 접두(avcC/hvcC) 형식 그대로 넘긴다. `VideoDecoderConfig.description` 에 avcC/hvcC 를 주면 WebCodecs 가
  그 형식을 받는다. codec 문자열은 `avc1.PPCCLL` / `hev1.P.C.LTT.CC`(RFC 6381, `webcodecs.rs::codec_string`).
- 재정렬 지연: `decode` 한 번에 그 샘플의 프레임이 아직 안 나올 수 있다. 엔진의 GOP 루프(`codecs/src/gop.rs`)는 원하는 pts 가
  캐시에 들어올 때까지 다음 샘플을 계속 넣고(최대 64개) 끝에서 `flush` 하므로 결과는 같다. `optimizeForLatency: true` 로 지연을 줄인다.
- 색·화소비는 소프트웨어 디코더가 보고하는 값(`NalStreamInfo.color/par`)을 그대로 쓴다. 두 디코더 모두 규격 적합이라 같은 YUV 를
  내므로 그림이 같다(e2e 가 평균 차이 1 미만을 확인).
- 통계: `perf.stats` 의 `decode.hardware` 에 `backend: "WebCodecs"`, `frames`, `sessions`, `declined`, `fallbacks`. `engineVersion()`
  끝에 `hw: WebCodecs`.

### 폴백 (오류 없음)

| 상황                                                                  | 동작                                                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `VideoDecoder` 가 없거나 `crossOriginIsolated` 가 아니거나 SAB 없음   | `createWebCodecsHooks()` 가 null. 훅을 설치하지 않고 소프트웨어 디코더만 쓴다                                                  |
| 스트림이 8-bit 4:2:0 progressive 가 아니거나 `isConfigSupported` 거짓 | 팩토리가 `None`(거절 카운트 +1). 다음 팩토리(소프트웨어)가 맡는다                                                              |
| 설정 Playback > Hardware decoding 이 `off`                            | 팩토리가 `None`. e2e 는 이걸로 소프트웨어 그림을 얻어 비교한다                                                                 |
| 디코더가 중간에 오류, 픽셀 포맷이 I420/NV12 가 아님, 응답 시간 초과   | `Err` 를 돌려주고 `HybridDecoder`(`crates/platform/src/hybrid.rs`)가 마지막 키 프레임부터 소프트웨어로 다시 디코드해 이어 간다 |
| 응답 시간 초과(open 8초, decode 4초, flush 8초)                       | 다리를 끊고(이후 호출 즉시 실패) 디코더 Worker 를 terminate. 새 스트림은 open 실패로 거절되어 소프트웨어                       |

### 제약

- 헤드리스 Playwright Chromium 에는 GPU 가 없어 `hardwareAcceleration: 'no-preference'` 로 Chrome 의 소프트웨어 디코더(ffmpeg,
  멀티스레드)가 돈다. 실제 Chrome 은 하드웨어를 쓴다. 어느 쪽이든 wasm 단일 스레드 H.264 보다 빠르다.
- HEVC 는 브라우저와 OS 에 따라 `isConfigSupported` 가 거짓이다(Windows Chrome 은 HEVC 확장이 있어야). 거짓이면 소프트웨어.
- 10-bit, 4:2:2, 인터레이스는 WebCodecs 경로를 타지 않는다(출력 포맷을 I420/NV12 8-bit 로만 받기 때문).
- `flush()` 뒤 WebCodecs 는 키 프레임을 요구한다. 엔진 GOP 루프는 flush 뒤 다음 요청에서 탐색(reset)하므로 보통 맞지만, 델타
  샘플이 바로 오면 그 스트림은 폴백 1회 뒤 소프트웨어로 간다(`fallbacks` 로 보인다).
- 공유 버퍼 복사가 한 번 더 있다(VideoFrame -> SAB -> wasm 메모리). 1080p I420 3.1MB, 프레임당 1ms 미만.

## 사용 방법

- 빌드: `npm run build:engine:wasm`. 측정: `node scripts/bench-wasm.mjs` (여러 빌드 비교는 `--pkg a --pkg b`).
- 검증: `npm run test:engine`(`wasm-web.test.ts` 가 훅을 흉내 내 Rust 쪽을 본다), 웹 e2e `webcodecs.spec.ts`(실제 VideoDecoder).
- 배포 서버: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp` 를 보내야 WebCodecs 경로가
  켜진다. 없어도 동작은 하고(소프트웨어) 느릴 뿐이다. wasm 과 글꼴은 `Content-Encoding` gzip/br 로 서빙한다(vite preview 는
  압축하지 않으며 표의 "전송" 열이 identity 인 이유다. gzip 크기는 아래 표).

## 남은 것

- 코덱 feature 분리(약 1MB): 위 표의 이유로 보류. 하려면 `filmcraft-codecs` 에 `av1`·`mpeg`·`ac3`·`apv`·`mxf` feature 를 두고
  `filmcraft-engine` 이 `default-features = false` 로 받게 해야 한다.
- 데모 생성기(`crates/media/src/generators.rs`)는 픽셀마다 fbm 노이즈를 계산해 960x540 에 150ms 안팎이다. 미리보기 60ms 목표는
  실제 mp4(WebCodecs)에서는 넘겼고 데모 영상에서는 생성기 최적화가 필요하다.
- 글꼴은 매 시작마다 5.2MB 를 받는다(브라우저 캐시가 흡수). 서비스 워커나 OPFS 캐시는 두지 않았다.

## 관련 코드

- `packages/engine/Cargo.toml` `[profile.wasm-release]`, `packages/engine/.cargo/config.toml` (simd128)
- `packages/engine/bindings/wasm/src/webcodecs.rs` (팩토리·`WebDecoder`·프레임 묶음 풀기), `src/lib.rs` (`setWebCodecsHooks`, `addFontData`, `hostFontFiles`)
- `apps/web/src/webcodecs.ts` (동기 다리), `apps/web/src/decoder.worker.ts` (VideoDecoder 소유), `apps/web/src/fonts.ts`, `apps/web/src/engine.worker.ts`
- `packages/engine/vendor/filmcraft/crates/text/src/fonts.rs` (`HOST_SUPPLIED_FONTS`), `crates/platform/src/hybrid.rs`, `crates/codecs/src/hw.rs`
- `scripts/bench-wasm.mjs`, `packages/engine/tests/wasm-bench.mjs`, `packages/engine/tests/wasm-web.test.ts`, `apps/web/e2e/webcodecs.spec.ts`
