---
title: wasm 엔진 성능과 크기 (M4-4)
created: 2026-10-14
updated: 2026-10-15
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

- 데모 영상은 디코더가 없어 생성기 비용이 그대로였다(약 150ms). 2026-10-15 생성기 최적화 뒤 수치는 아래 "데모 생성기와 WSOLA (2026-10-15)".
- H.264 순차 재생의 25ms 는 디코드가 아니라 나머지(YUV 를 RGB 로, 축소, RGBA 포장, Worker 전송)가 대부분이다. 프레임 캐시에
  맞으면 12ms 안팎(위 Node 벤치의 min). 임의 탐색은 GOP 처음부터 다시 디코드하는 비용이 브라우저 디코더로 가면서 1/3 줄었다.
- 내보내기(H.264 인코드는 wasm 소프트웨어 `filmcraft-h264enc`)는 1.5배 빨라졌다. 데스크톱(napi, 네이티브)과의 비율은 아직 재지 않았다.

## 데모 생성기와 WSOLA (2026-10-15)

### 데모 장면 생성기

- 원인: `generators.rs` 의 `demo_pixel` 이 픽셀마다 fbm(값 노이즈 2~5 옥타브)·`powf`·`exp` 를 부르는데, 그중 상당수는 열(`u`)이나
  행(`v`)에만 달려 있었다(Aurora 의 산 능선·오로라 커튼, Dunes 의 모래 능선, CityNight 의 건물, Forest 의 나무 기둥). 프레임 캐시는 이미
  (프레임, 배율) 단위라 재생·스크럽처럼 새 프레임을 그릴 때 비용이 그대로 나온다.
- 고친 것: `demo_frame` 이 장면마다 열 단위 값(능선 높이, 커튼 위치, 건물 높이·창 열, 나무 기둥 여부)과 행 단위 값(하늘색, `powf`, 도로 불빛
  감쇠)을 한 번씩 계산하고, 가중치가 정확히 0 인 곳의 노이즈는 건너뛴다(구름은 0.1 < v < 0.55, 안개는 v > 0.55, 물결은 빛 길 감쇠가 0 이 아닐
  때만). 계산식과 순서가 같아 **출력은 비트 단위로 같다**: 예전 `demo_pixel` 을 테스트 전용 기준으로 남겨 6장면 x 크기·시각 4가지를 바이트 비교한다
  (`generators::tests::demo_frame_matches_the_per_pixel_reference`). 골든·내보내기 결과는 바뀌지 않는다.
- 측정 1(생성기만, 한 스레드, release, 960x540, 5프레임 평균): `cargo test -p filmcraft-media --release demo_frame_timing -- --ignored --nocapture`.

| 장면        | 예전 픽셀 단위 | 바꾼 뒤 |
| ----------- | -------------- | ------- |
| OceanSunset | 45.6ms         | 28.4ms  |
| Aurora      | 171.6ms        | 12.6ms  |
| CityNight   | 32.8ms         | 12.1ms  |
| Dunes       | 108.1ms        | 7.3ms   |
| Forest      | 55.6ms         | 23.0ms  |
| Plasma      | 23.0ms         | 11.1ms  |

- 측정 2(엔진 전체 renderFrame, 1920x1080 30fps 편집본에 장면 하나, scale 0.5, 캐시에 없는 프레임 20장의 중앙값, Node 24, WSL2 16코어, 다른
  Rust 빌드와 동시). 같은 시각에 main(0.1.7) 빌드와 번갈아 돌렸다. napi 는 세 번 번갈아 돌린 범위.

| 장면        | wasm 전 | wasm 후 | napi 전     | napi 후     |
| ----------- | ------- | ------- | ----------- | ----------- |
| OceanSunset | 94.0ms  | 73.9ms  | 18.1~22.3ms | 17.0~18.3ms |
| Aurora      | 236.6ms | 56.3ms  | 32.3~37.1ms | 15.9~18.5ms |
| CityNight   | 50.7ms  | 26.2ms  | 15.9~20.7ms | 14.4~16.2ms |
| Dunes       | 175.1ms | 39.0ms  | 25.7~28.7ms | 13.8~15.0ms |
| Plasma      | 48.4ms  | 36.5ms  | 14.8~18.2ms | 11.1~13.0ms |
| Forest      | 94.5ms  | 63.9ms  | 18.5~20.5ms | 15.9~18.3ms |

### 음정 유지(WSOLA) 미리보기

- 원인: `Stretcher::render` 는 블록마다 세그먼트 사슬을 사슬 처음(최대 32세그먼트, 0.64초)부터 다시 찾고 그만큼 소스를 다시 읽었다. 미리보기는
  4096프레임씩 묻기 때문에 출력 1초당 비용이 1초 블록의 3.6배였다.
- 고친 것: `render_keyed` 가 사슬마다 고른 입력 위치를 기억한다(전역 4096사슬, 먼저 들어온 것부터 버림). 키는 렌더러가 주는 소스 식별(미디어
  항목, 소스 in, 레이트, 채널 배치)에 사슬 입력의 짧은 표본 세 곳(32샘플)을 섞은 것이라, 새 프로젝트가 항목 번호를 다시 써도 다른 소리에
  옛 위치를 쓰지 않는다. 기억이 있으면 블록은 자기 세그먼트만 읽고 합친다. 유사도 계산은 범위 검사 없는 슬라이스 경로를 먼저 탄다(합의 순서는
  같다). 예전 구현을 그대로 옮긴 임시 비교 테스트에서 기억 있음·없음 모두 출력이 예전과 비트 단위로 같았다(속도 0.7·1.5·2, 블록 세 가지).
- 측정 1(Rust, 2채널 10초 출력, release): `cargo test -p filmcraft-audio-dsp --release stretch_block_timing -- --ignored --nocapture`.
  출력 1초당: 1.5배 4096프레임 블록 30.6ms 에서 4.1ms(기억), 1초 블록 8.5ms 에서 4.7ms. 0.75배 4096 블록 29.5ms 에서 4.7ms.
- 측정 2(엔진 renderAudio, 실제 AAC 파일 1.5배 음정 유지, 8초 출력, 출력 1초당): napi 4096 블록 처음 13.6ms 에서 4.5ms, 다시 10.6ms 에서
  1.9ms. wasm 4096 블록 처음 17.1ms 에서 6.7ms, 다시 11.9ms 에서 0.9ms.
- 실제 파일 소리는 예전과 최대 1.1e-4(최고 0.09) 다르다. 이것은 알고리즘이 아니라 AAC 디코드가 읽기 시작점에 따라 마지막 자릿수가 달라지는
  것이다: 예전 빌드도 앞서 다른 곳을 읽은 뒤 같은 구간을 그리면 최대 1.0e-4 다르다. 음정 유지가 꺼진 클립(보통 속도·가변 속도)의 소리는 같다.

### 함께 잰 것 (바꾸지 않음)

- `sequence.inspect`(클립 50개, JSON 106KB): napi 3.1ms, wasm 4.4ms. 클립마다 고유 효과 파라미터가 1KB 정도인데 화면이 읽으므로 그대로 둔다.
- renderFrame 고정 비용(빈 편집본, napi): scale 0.25 1.7ms, 0.5 3.8ms, 1.0 7.4ms. 선형광 f32 합성과 sRGB 변환인데 변환은 이미 4096칸 표와
  rayon 이라 줄일 곳이 뚜렷하지 않았다. H.264 1080p 두 겹 재생 scale 0.5 중앙값 17.7ms(디코드 2.7ms/프레임).

## 웹 메모리, 남은 데모 장면, 교환 형식 빼기 (2026-10-15 오후)

### WebCodecs 평면 재사용 (캐시 예산은 그대로)

- 원인: WebCodecs 경로(`bindings/wasm/src/webcodecs.rs`)가 프레임 평면을 매번 새로 할당하고, 디코드 캐시가 버린 평면은 재활용
  선반(`crates/frame/src/pool.rs`)으로 가는데 아무도 꺼내 쓰지 않아 선반 상한(192MB)까지 쌓였다(브라우저 perf.stats: `planePoolMB` 201,
  `planesReused` 0). 소프트웨어 디코드(Node)는 원래 선반에서 꺼내 써서 이 문제가 없다. wasm 선형 메모리는 한 번 늘면 줄지 않는다.
- 고친 것: WebCodecs 프레임이 평면을 선반에서 꺼내 쓴다(`filmcraft_frame::pool::take_u8`). 디코드 캐시·선반의 예산은 main 과 같다.
- 먼저 시도한 것(채택 안 함, V1): wasm 만 디코드 캐시를 트랙당 192MB·최소 16장·전체 320MB, 생성기 캐시 64MB, 선반 64MB 로 줄였다. 메모리는
  더 줄었지만(아래 표) 캐시가 붙드는 길이가 4초에서 2초로 줄어, 키프레임 간격 8초 영상을 2초 넘게 뒤로 문지르거나 3초 재생한 뒤 뒤로 문지르면
  키프레임부터 다시 디코드했다(키프레임 간격 2초 영상도 재생 뒤 뒤로 문지르기가 2~3배). "사용자가 하는 일은 하나도 느려지지 않는다" 규칙에
  어긋나 되돌렸다.
- 측정(같은 날, 부하 평균 4~14): 브라우저는 큰 파일 e2e 와 같은 파일(ffmpeg testsrc2 1080p30 130초 80Mbps ultrafast, 키프레임 간격 250장 = 8.3초,
  588MB)과 키프레임 간격 2초 파일(`-g 60` 20Mbps 60초)로, 30·50·10초 탐색 뒤 30초에서 0.5초씩 26초까지 뒤로 8단계, 40초에서 44초까지 앞으로
  8단계, 45초부터 3초 재생 뒤 47.5초에서 45초까지 뒤로 6단계, 각 단계는 0.5 배율 renderFrame(엔진 직접 호출)의 시간. 표는 8초 파일, main 과 V2
  각 10회의 중앙값(범위), V1 은 2회. Node(소프트웨어 디코드, Blob 범위 읽기)도 같은 시나리오로 main·V1·V2 를 2회씩.

| 브라우저, 8초 GOP          | 탐색 뒤 wasm 메모리 | 뒤로 8단계 합        | 앞으로 8단계 합     | 재생 뒤 뒤로 6단계 합 |
| -------------------------- | ------------------- | -------------------- | ------------------- | --------------------- |
| main                       | 707~718 MB          | 241.5ms (224~257)    | 984.5ms (910~1057)  | 205.5ms (191~240)     |
| V1 (예산 축소, 채택 안 함) | 320~322 MB          | 750~768ms (최대 549) | 990~998ms           | 995~1007ms (최대 804) |
| V2 (채택: 평면 재사용)     | 513~515 MB          | 231.5ms (219~267)    | 1011.5ms (869~1276) | 213ms (195~260)       |

| 2초 GOP         | 브라우저 메모리 | 브라우저 재생 뒤 뒤로 6단계 | Node 메모리 | Node 재생 뒤 뒤로 6단계 |
| --------------- | --------------- | --------------------------- | ----------- | ----------------------- |
| main            | 651 MB          | 154~170ms                   | 459 MB      | 174~184ms               |
| V1 (채택 안 함) | 261 MB          | 466~476ms                   | 264 MB      | 487~507ms               |
| V2 (채택)       | 456~458 MB      | 175~188ms                   | 459 MB      | 160~173ms               |

- 원래 큰 파일 e2e(탐색만, 2회): main 666~667MB, V2 473~474MB(-29%), 탐색 726~916 / 51~60 / 320~367ms(main 의 범위 안).
- V2 의 앞으로 문지르기 중앙값이 27ms 높지만 main 자신의 범위(147ms)보다 작고 두 범위가 겹친다(이상치 2회 1238·1276ms 를 빼면 985~1026ms).
  Node 는 소프트웨어 디코드라 V2 와 main 이 같은 코드 경로이며 전 시나리오가 같은 범위다.

### 남은 두 데모 장면 (OceanSunset, Forest)

- 남은 비용은 픽셀마다 x·y 가 함께 들어가는 fbm 의 격자 해시였다(옥타브마다 4개). 한 행의 픽셀은 노이즈 격자의 y 행이 같고 x 는 열을 따라 커지므로,
  행마다 필요한 격자 열의 해시만 표로 만들고 픽셀은 표를 찾는다(`generators.rs` 의 `FbmRow`). 연산과 순서가 같아 출력은 비트 단위로 같다(바이트 비교
  테스트에 960x540 크기를 더했다). 물결은 행마다 x 배율이 달라 표를 행마다 새로 만든다.
- 측정 1(생성기만, 한 스레드, 960x540, 위 표와 같은 명령): OceanSunset 28.4ms 에서 19.7~19.8ms, Forest 23.0ms 에서 16.6~17.2ms.
- 측정 2(wasm renderFrame, 1920x1080 30fps 편집본에 장면 하나, scale 0.5, 새 프레임 20장 중앙값, main 0.1.9 빌드와 번갈아 7회, 부하 평균 9~14).
  손대지 않은 네 장면은 전후가 잡음 범위 안에서 같다.

| 장면        | 전          | 후          |
| ----------- | ----------- | ----------- |
| OceanSunset | 61.1~70.1ms | 50.0~57.9ms |
| Forest      | 59.9~68.8ms | 38.5~46.4ms |
| Aurora      | 41.5~49.1ms | 41.7~51.1ms |
| Dunes       | 31.2~37.1ms | 32.3~40.4ms |
| CityNight   | 24.7~29.5ms | 22.2~30.8ms |
| Plasma      | 30.0~42.3ms | 30.4~38.8ms |

- 여섯 장면 모두 60ms 목표 안이다.

### 교환 형식(EDL, XML, FCPXML, OTIO, AAF, OMF, ALE)을 웹 빌드에서 빼기

- `filmcraft-engine` 에 `interchange` feature(기본 켬)를 두고 wasm 바인딩만 끈다(napi 는 `features = ["interchange"]`). 명령은 카탈로그에 그대로
  있어(데스크톱과 웹 모두 687개, 같은 목록) 웹에서 부르면 "not available in this build: use the desktop app" 오류를 낸다(`crates/engine/src/interchange_off.rs`).
  웹 UI 는 이 형식을 고를 수 없고(가져오기 선택기는 영상·소리·사진만) 내보내기 메뉴도 없다.
- 크기(`npm run build:engine:wasm`, gzip -9): 14,743,980 에서 13,994,329 바이트(-749KB, -5.1%), gzip 5,568,143 에서 5,281,271 바이트(-287KB).
- 다른 후보는 웹 UI 가 쓰는 기능을 지워서 하지 않았다: 이미지 형식(webp·gif 는 웹 사용자가 흔히 가져온다), symphonia(음악 가져오기), 코덱 feature
  (MPEG-2·AV1 등 가져오기).

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

## 큰 파일 범위 읽기와 브라우저 안 미디어 보관 (2026-10-15)

가져온 `File` 은 Worker 에서 `registerBlob` 으로 핸들만 등록하고, 엔진은 필요한 범위만 `FileReaderSync` 로 1 MiB 청크씩 읽는다
(청크 LRU 64 MiB, 4 MiB 이상 한 번 읽기는 캐시를 거치지 않음, `bindings/wasm/src/lib.rs`). 이 경로는 2026-10-14 부터 있었고 이번에 바꾸지
않았다. 이번에 더한 것은 **보관**이다: Worker 가 가져온 파일을 1.5초 뒤 OPFS `media/` 에 8 MiB 조각으로 복사하고(`apps/web/src/opfs.ts`
`copyIn`), 끝난 것만 `media/index.json` 에 적는다. 다음 시작 때 같은 엔진 경로(`/files/<이름>`)로 OPFS 파일을 다시 `registerBlob` 하므로
프로젝트·복구본이 재연결 없이 열린다(`features/project/web-media.ts`). 작은 파일(`putFile` 메모리 경로)은 엔진이 쓴 파일과 OPFS 에서
미리 읽어 두는 프로젝트에만 쓰며 그대로다.

측정: `SH_E2E_LARGE_MP4=<경로> npx playwright test -c apps/web/playwright.config.ts web-files -g '큰 파일' --project desktop-1440`
(Chromium headless, vite preview, WSL2). 파일은 ffmpeg `testsrc2` 1920x1080 30fps 130초 H.264 80 Mbps faststart(588 MB). 가져오기는 파일
선택부터 미디어 목록에 항목이 보일 때까지, 탐색은 30초·50초·10초 위치를 0.5 배율로 그린 시간(엔진 직접 호출), 메모리는 Worker 의 wasm
선형 메모리 크기. 각 2회.

| 조건                      | 가져오기   | 탐색 30초 / 50초 / 10초       | wasm 메모리(시작, 가져오기 뒤, 탐색 뒤) | Blob 에서 읽은 양 |
| ------------------------- | ---------- | ----------------------------- | --------------------------------------- | ----------------- |
| 보관 없음(이전 동작)      | 141~175 ms | 827~951 / 57~63 / 296~380 ms  | 13, 31, 667~668 MB                      | 38 MB (38회)      |
| 보관, 바로 복사           | 146~161 ms | 882~1373 / 64~98 / 298~494 ms | 13, 31~34, 665~667 MB                   | 38 MB (38회)      |
| 보관, 1.5초 뒤 복사(채택) | 154~166 ms | 927~1028 / 52~57 / 294~321 ms | 13, 31~34, 667~671 MB                   | 38 MB (38회)      |

- 588 MB 파일을 가져와 배치해도 wasm 메모리는 18 MB 만 늘고 Blob 에서 읽은 양은 38 MB 다(파일이 통째로 올라오지 않는다).
- 탐색 뒤의 667 MB 는 디코드한 1080p 프레임 캐시다(파일 크기와 무관하며 wasm 메모리는 줄지 않는다). 아래 "남은 것".
- 바로 복사하면 가져오자마자 그리는 첫 탐색이 최대 40% 느려져 복사 시작을 1.5초 미뤘다(첫 탐색이 기준과 비슷해졌다).
- Playwright 의 임시 브라우저 문맥은 OPFS 한도가 약 450~530 MB 라 588 MB 사본은 중간에 막힌다. 이때 사본을 지우고 보관 실패로
  끝나며(그 세션은 원본 File 로 계속 읽는다) 다시 열면 기존 "미디어 다시 연결" 이 뜬다. 막히기 전까지 복사 속도는 약 150 MB/s.
- 같은 시각의 프레임은 Blob 경로와 메모리 경로가 같다(`packages/engine/tests/web-blob.test.ts`: 연속 12장과 앞뒤 탐색 4장 화소 차 0).

## 번들 글꼴 두 번째 시작 (2026-10-15 실측, 바꾸지 않음)

todo 의 "글꼴 5.2MB 가 매 시작마다 fetch" 를 재 봤다. 빌드본(해시 이름 자산)을 응답마다 60ms 늦추고 ETag 를 주는 정적 서버(`Cache-Control: no-cache`)로
띄우고, 같은 프로필에서 첫 방문 한 번과 새로고침 세 번을 Playwright 로 쟀다(번갈아 2회). "준비됨" 은 탐색 시작부터 상태 줄에 "준비됨: 커맨드 N개" 가
뜰 때까지.

| 구성                                 | 첫 방문: 글꼴 요청·바이트 | 첫 방문 준비됨 | 새로고침: 글꼴 요청·바이트 | 새로고침 준비됨 |
| ------------------------------------ | ------------------------- | -------------- | -------------------------- | --------------- |
| 지금(Worker 가 `fetch`)              | 8개, 5.58MB               | 562~569ms      | 8개, 0바이트(304)          | 436~449ms       |
| 시험: Cache Storage 에 해시 이름으로 | 8개, 5.58MB               | 538~573ms      | 0개                        | 435~444ms       |

- 새로고침 때 받는 바이트는 원래 0 이다. 브라우저 HTTP 캐시가 ETag 로 304 를 받는다(vite preview 로도 같음: 새로고침 0바이트, 준비됨 219~228ms).
- Cache Storage 는 요청 8개를 없애지만 준비됨이 빨라지지 않았다. 글꼴은 wasm(14.7MB, 역시 304)과 나란히 받으므로 시작의 긴 길에 있지 않다.
  게다가 같은 5.6MB 를 한 벌 더 저장한다. 그래서 넣지 않았다(빨라지거나 가벼워지는 것만 넣는다).
- 배포할 때는 해시 이름 자산(`/assets/*-[hash].*`)에 `Cache-Control: public, max-age=31536000, immutable` 을 주면 304 왕복도 없어진다. 서버 설정의 일이다.

## 사용 방법

- 빌드: `npm run build:engine:wasm`. 측정: `node scripts/bench-wasm.mjs` (여러 빌드 비교는 `--pkg a --pkg b`).
- 검증: `npm run test:engine`(`wasm-web.test.ts` 가 훅을 흉내 내 Rust 쪽을 본다), 웹 e2e `webcodecs.spec.ts`(실제 VideoDecoder).
- 배포 서버: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp` 를 보내야 WebCodecs 경로가
  켜진다. 없어도 동작은 하고(소프트웨어) 느릴 뿐이다. wasm 과 글꼴은 `Content-Encoding` gzip/br 로 서빙한다(vite preview 는
  압축하지 않으며 표의 "전송" 열이 identity 인 이유다. gzip 크기는 아래 표).

## 남은 것

- 코덱 feature 분리(약 1MB): 웹 사용자가 MPEG-2·AV1 등을 가져올 수 있어 보류. 하려면 `filmcraft-codecs` 에 `av1`·`mpeg`·`ac3`·`apv`·`mxf` feature 를 두고
  `filmcraft-engine` 이 `default-features = false` 로 받게 해야 한다.
- 글꼴은 매 시작마다 5.2MB 를 받는다(브라우저 캐시가 흡수). 서비스 워커나 OPFS 캐시는 두지 않았다.
- 1080p 탐색 뒤 wasm 메모리는 약 474MB 다(디코드 캐시 384MB 한도 + 엔진). 캐시를 줄이면 메모리는 더 주지만 뒤로 문지르기가 느려져(위 V1) 하지 않았다.
  키프레임 간격이 짧은 영상만 따로 예산을 줄이는 것도 재생 뒤 뒤로 문지르기에서 같은 문제가 생긴다.

## 관련 코드

- `packages/engine/Cargo.toml` `[profile.wasm-release]`, `packages/engine/.cargo/config.toml` (simd128)
- `packages/engine/bindings/wasm/src/webcodecs.rs` (팩토리·`WebDecoder`·프레임 묶음 풀기), `src/lib.rs` (`setWebCodecsHooks`, `addFontData`, `hostFontFiles`)
- `apps/web/src/webcodecs.ts` (동기 다리), `apps/web/src/decoder.worker.ts` (VideoDecoder 소유), `apps/web/src/fonts.ts`, `apps/web/src/engine.worker.ts`
- `packages/engine/vendor/filmcraft/crates/text/src/fonts.rs` (`HOST_SUPPLIED_FONTS`), `crates/platform/src/hybrid.rs`, `crates/codecs/src/hw.rs`
- `scripts/bench-wasm.mjs`, `packages/engine/tests/wasm-bench.mjs`, `packages/engine/tests/wasm-web.test.ts`, `apps/web/e2e/webcodecs.spec.ts`
- 평면 재사용: `bindings/wasm/src/webcodecs.rs`, 선반 `crates/frame/src/pool.rs`. 교환 형식: `crates/engine/Cargo.toml`(`interchange`), `crates/engine/src/interchange_off.rs`
- 범위 읽기·보관: `bindings/wasm/src/lib.rs`(`registerBlob`, `BlobReader`), `apps/web/src/opfs.ts`(`copyIn`), `packages/editor/src/features/project/web-media.ts`,
  `packages/engine/tests/web-blob.test.ts`, `apps/web/e2e/web-files.spec.ts`("가져온 파일 보관")
