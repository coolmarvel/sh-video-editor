---
title: 재생 파이프라인 (읽어 두기, 프리롤, 재생 화질, 프레임 전달)
created: 2026-10-16
updated: 2026-10-16
domain: editor
---

# 재생 파이프라인 (읽어 두기, 프리롤, 재생 화질, 프레임 전달)

사용자 보고: "처음 재생할 때 엄청 끊기고, 다시 재생하면 원래대로 돌아온다." 원인은 세 가지였다.

1. 화면(`features/monitor/controller.ts`)이 재생을 누르면 시계를 바로 출발시키고 프레임을 하나씩 그때그때 요청했다. 엔진에는 재생 위치보다 앞을
   미리 디코드하는 곳이 없었다(상류 filmcraft 의 미리 읽기는 이식하지 않은 egui 플레이어에 있었다). 그래서 첫 재생은 디코더 열기·탐색·첫 GOP
   디코드를 재생 시간 안에서 치렀고, 특히 **자르기 지점마다 새 디코더**(Windows Media Foundation 은 1080p H.264 첫 프레임 400~650ms)가 열렸다.
   다시 재생하면 디코더가 열려 있고 프레임이 캐시에 있어 매끄러웠다.
2. 재생 배율 자동 조절이 한 프레임만 느려도(프레임 간격의 4배) 바로 한 단계 내리고, 정지할 때까지 되돌리지 않았다. 첫 프레임의 디코더 열기 하나로
   첫 재생 내내 흐리게 보였다.
3. 데스크톱은 프레임(960x540 RGBA 2MB)이 엔진 프로세스에서 preload 를 거쳐 페이지로 넘어오며 contextBridge 에서 한 번 더 옮겨져 MB 당 수 ms 가 들었다.

## 1. 다른 제품은 어떻게 하나

- **프리롤**: 시계를 출발시키기 전에 출력단에 첫 버퍼가 도착할 때까지 기다린다. GStreamer 는 PAUSED 상태에서 싱크가 첫 버퍼를 받아야 상태 전환을
  끝내며, 그래서 PLAYING 으로 갈 때 지연이 없고 A/V 동기와 버퍼 손실을 막는다([preroll](https://gstreamer.freedesktop.org/documentation/additional/design/preroll.html),
  [sink elements](https://gstreamer.freedesktop.org/documentation/additional/design/element-sink.html)). AVPlayer 의 `preroll(atRate:)` 는 렌더 파이프라인을
  미리 채우고([포럼에 인용된 헤더](https://developer.apple.com/forums/thread/8393)), `automaticallyWaitsToMinimizeStalling` 은 끊길 것 같으면 재생 시작을
  미룬다([문서](https://developer.apple.com/documentation/avfoundation/avplayer/automaticallywaitstominimizestalling.md)).
- **앞서 디코드하는 큐**: ffplay·mpv 처럼 디코드 스레드가 재생 위치보다 몇 프레임 앞을 큐에 채우고 표시 쪽은 큐에서 꺼낸다. 늦으면 표시 쪽이 프레임을
  건너뛴다.
- **재생 화질은 사용자 선택**: DaVinci Resolve 는 재생 해상도를 1/2·1/4 로 낮출 수 있고 무거운 코덱(H.264·H.265)은 스마트 렌더 캐시로 미리 만든다
  ([Elements.tv](https://elements.tv/blog/davinci-resolve-5-ways-to-achieve-better-playback-performance/), [TourBox](https://tourboxtech.com/en/news/davinci-resolve-render-cache.html)).
  Premiere Pro 도 재생 해상도 설정과 건너뛴 프레임 표시가 있다([Motion Array](https://motionarray.com/premiere-pro/premiere-pro-playback-lag)).

이 프로젝트는 같은 구조를 따른다: 엔진의 읽어 두기 큐(2절), 화면의 프리롤과 정지 중 준비(3절), 재생 화질 선택(4절). 렌더 캐시(미리 렌더해 파일로
두기)는 하지 않았다(todo).

## 2. 엔진 읽어 두기 (`crates/engine/src/playback.rs`)

- `Session::playback_start(t, rate, scale)`: 활성 시퀀스의 한 스냅샷(`Arc<Project>` 와 revision)으로 `t` 부터 `rate` 방향·보폭(2 = 한 프레임 건너,
  음수 = 뒤로) 프레임을 계획한다. 네이티브는 스레드 하나(`filmcraft-readahead`)가 그려 RGBA8 로 준비 큐에 넣는다. 큐 상한은 8장(30fps 약 0.27초)과
  96MB. wasm 은 스레드가 없어 호스트가 `playback_pump(budget)` 를 부를 때 나아간다(지금 화면은 웹에서 읽어 두기를 쓰지 않는다, 5절).
- `Session::render_program_rgba8(scale, t)`(바인딩의 `renderFrame`): 계획과 같은 스냅샷·배율이고 `t` 가 준비돼 있으면 그대로 돌려준다. `t` 보다 앞선
  프레임은 버린다(화면이 늦어 건너뛴 것). 없으면 그 자리에서 그리고, 큐가 `t` 를 지나쳤거나 못 미치면 `t` 다음부터 다시 계획한다. 지금 스레드가
  그리는 중인 프레임이 `t` 면 기다려 받는다(같은 프레임을 두 번 디코드하지 않는다). 편집으로 revision 이 바뀌면 옛 프레임을 버리고 새 스냅샷으로
  다시 계획한다.
- 큐가 차 있으면 3초 안에 시작하는 다음 클립의 첫 프레임을 한 장 그려 버린다: 그 클립의 디코더가 열리고 첫 GOP 가 디코드되어, 재생이 자르기 지점을
  지날 때 디코더 열기를 치르지 않는다(`warmed`).
- `Session::playback_prepare(t, scale)`: 정지 중 준비. `t` 부터 3장(wasm 1장). 화면이 이미 그린 플레이헤드 프레임도 백그라운드에서 한 번 더
  그린다: 그래야 재생의 첫 프레임을 화면 쪽 스레드가 그리지 않고 큐에서 받는다(그 프레임만 화면 스레드가 다시 그리면 디코더·CPU 를 준비 스레드와
  다투어 첫 프레임이 7ms 쯤 늦었다). 재생은 그 큐를 그대로 이어 쓴다.
- `playback_status()`: `{active, playing, ready, target, bytes, hits, misses, rendered, warmed, threaded}`. 프리롤은 `ready >= target`(1장). 카운터는 세션
  누적.

검증: `crates/engine/src/playback_tests.rs` 8건(그때그때 그린 것과 바이트 일치, 건너뜀·탐색, 편집 뒤 새 그림, 역방향·2배속, 준비, 다음 클립 열기,
상한, 보인 프레임 다음부터 준비), `packages/engine/tests/playback.test.ts`(napi 4, wasm 1).

## 3. 화면: 프리롤과 준비 (`features/monitor/controller.ts`)

- 재생을 누르면 `bridge.playback.start` 뒤 `status` 를 4ms 마다 보며 첫 프레임이 준비될 때까지 시계를 출발시키지 않는다. 1초가 지나면 그냥 출발한다.
  300ms 를 넘으면 조작 줄에 "준비 중"(DESIGN.md 4.29)을 보이고, 재생 버튼은 정지 모양(누르면 취소)이다. 소리는 `useMonitor.playing` 을 따라 시작하므로
  프리롤이 끝난 순간 영상과 같이 출발한다.
- 정지, 탐색, 프레임 이동, 편집, 표시 배율 변경 뒤 250ms 에 `bridge.playback.prepare(플레이헤드)` (연달아 바뀌면 마지막만).
- 재생 중 탐색·배속·화질이 바뀌면 그 자리에서 `start` 를 다시 건다.
- 읽어 두기 스레드가 없는 호스트(`status.threaded === false`, 웹 wasm)와 `bridge.playback` 이 없는 호스트(테스트 가짜 엔진)는 예전처럼 바로 출발하고
  프레임을 그때그때 그린다.

## 4. 재생 화질 (`features/monitor/quality.ts`)

조작 줄의 **재생 화질** 콤보: 자동, 전체, 1/2, 1/4(브라우저 저장소에 남는다). 재생 배율 = 표시 크기에 맞춘 배율과 고른 상한 중 작은 쪽. 정지 중에는
언제나 표시 크기에 맞춘 배율. 자동은 재생 시작 6프레임(디코더 열기·첫 GOP·프리롤)을 판단에서 빼고, 최근 3표본 평균이 프레임 간격의 1.2배를 넘거나
한 프레임이 4배를 넘으면 한 단계 내리며, 낮춘 배율에서 30표본 평균이 0.5배보다 짧으면 한 단계 올린다(시작 배율까지). 건너뛴 프레임 수는 상태 줄에
그대로 보인다.

## 5. 데스크톱 프레임 전달

- main 이 렌더러마다 엔진 포트를 하나 더 만든다(`engine:frame-port`). preload 는 그것을 들고 있다가 페이지가 요청하면(`sh-engine-frame-port-request`)
  `window.postMessage` 로 페이지(main world)에 넘긴다(포트가 페이지 스크립트보다 먼저 올 수 있다). 페이지의 `renderer/frame-port.ts` 가 그 포트로
  `renderFrame` 을 부르고, 포트가 없으면 예전 경로(contextBridge 의 `shEngine`)로 그린다. `SH_FRAME_PORT=0` 이면 끈다(실측·문제 확인용).
- 렌더러는 받은 바이트를 복사하지 않고 `Uint8ClampedArray` 로 감싼다.
- 엔진 프로세스에서 napi Buffer 를 보통 `Uint8Array` 로 복사해 보내 보았지만 빨라지지 않아 넣지 않았다.

## 6. 실측

방법: `scripts/bench-playback.cjs`(화면의 재생 루프 흉내: 정지 중 플레이헤드 프레임을 그린 뒤 1초 쉬고, 재생하면 벽시계로 tick 을 정해 renderFrame 을
한 번에 하나, 늦으면 건너뜀). "예전" 은 main(v0.1.10) 빌드로 읽어 두기 없이, "지금" 은 이 작업의 빌드로 읽어 두기·프리롤·정지 중 준비를 켜고 같은
엔진·같은 파일을 번갈아 돌렸다. 1080p 30fps 편집본, 배율 0.5. Windows 는 WSL 에서 Windows Node 로 Windows `.node` 를 불렀다(Media Foundation
하드웨어 디코드, `perf.stats` 의 소프트웨어 프레임 0). 다른 빌드가 함께 돌아 부하 평균 1~9 였고, 아래는 번갈아 돌린 2~3회의 범위다.
"건너뜀" 은 늦어서 보이지 못한 프레임, "늦음" 은 33ms 를 넘긴 renderFrame, "첫 프레임" 은 재생을 누른 때부터 첫 프레임까지.

| 환경·자료                                   | 재생      | 예전: 건너뜀 / 늦음 / 가장 느린 프레임 / 첫 프레임 | 지금: 건너뜀 / 늦음 / 가장 느린 프레임 / 첫 프레임 |
| ------------------------------------------- | --------- | -------------------------------------------------- | -------------------------------------------------- |
| Windows, 2초 클립 3개 이어 붙임(자르기 2곳) | 첫 재생   | 12~18 / 12~13 / 150~182ms / 6ms                    | 0 / 0 / 9ms / 0.1~0.2ms                            |
|                                             | 다시 재생 | 2~3 / 6~7 / 43~47ms / 15~26ms                      | 0 / 0 / 11~12ms / 0.2~10ms                         |
| Windows, H.264 10초(키프레임 간격 8.3초)    | 첫 재생   | 9~21 / 18~39 / 120~178ms / 5ms                     | 0 / 0 / 10~13ms / 0.1ms                            |
|                                             | 다시 재생 | 12~19 / 24~43 / 180~189ms / 13~16ms                | 0 / 0 / 10~11ms / 0.1~0.5ms                        |
| Windows, HEVC 5초                           | 첫 재생   | 2~3 / 6~8 / 45~46ms / 6ms                          | 0 / 0 / 2~5ms / 0.1ms                              |
|                                             | 다시 재생 | 1~2 / 4~5 / 695~721ms(멈춤 한 번)                  | 16~17 / 3 / 488~495ms(멈춤 한 번)                  |
| Linux(소프트웨어 디코드), 2초 클립 3개      | 첫 재생   | 4~17 / 12~22 / 72~430ms / 5~9ms                    | 0 / 0 / 0.2~0.8ms / 0.1~0.2ms                      |
|                                             | 다시 재생 | 0 / 0 / 9~16ms / 6~7ms                             | 0~8 / 0~12 / 0.3~97ms / 0.1~0.2ms                  |

- 첫 재생의 끊김(자르기 지점마다 디코더 열기)이 없어졌고, 다시 재생도 같거나 낫다. HEVC 다시 재생의 멈춤 한 번은 예전에도 있었고(Media Foundation
  HEVC 디코더가 처음으로 되돌아갈 때) 지금은 짧아졌지만 남았다(7절). Linux 다시 재생의 0~8 건너뜀은 다른 빌드가 몰린 한 번(부하 평균 8 이상)이다.
- 읽어 두기 메모리: 준비 큐 상한 8장, 960x540 RGBA 는 장당 2MB 라 최대 약 16MB(1080p 배율 1 이면 장당 8.3MB, 96MB 상한에서 8장 약 66MB). 디코드
  캐시 예산은 바꾸지 않았다.

웹(wasm, 읽어 두기 없음, 재생 화질 자동): `scripts/bench-web-play.cjs` 로 데모 편집본을 3초씩 두 번 재생해 상태 줄의 건너뜀을 읽었다(1440 폭,
예전 main 과 번갈아 3회씩). 첫 재생 예전 3~10, 지금 5~8(합계 19 대 20, 같음). 다시 재생 예전 5~15, 지금 4~5(합계 33 대 13). 자동 화질이 재생 시작
6프레임을 빼고 판단해도 첫 재생이 나빠지지 않았고, 다시 재생은 배율을 다시 올릴 수 있어 덜 건너뛴다.

데스크톱 프레임 전달(`apps/desktop/scripts/bench-transport.cjs`, xvfb 의 Electron, 데모 편집본을 읽어 두기로 미리 그려 엔진 쪽 렌더를 거의 0 으로
만든 뒤 renderFrame 왕복 중앙값, 같은 빌드에서 `SH_FRAME_PORT=0` 과 번갈아 3회): 960x540(2MB) 예전 경로 14.3~22.7ms, 프레임 전용 포트 12.5~14.5ms.
전달 비용은 크기에 비례해 0.5MB 3ms, 2MB 11~15ms, 8MB 53~64ms(MB 당 약 5~8ms)이고 빈 왕복(playhead)은 0.2ms. 렌더러가 받은 바이트를 다시 복사하지 않게
한 것은 2MB memcpy(약 0.5ms)라 실측 범위 안이다. 엔진 프로세스에서 napi Buffer 를 보통 Uint8Array 로 복사해 보내 보았지만 빨라지지 않아 넣지 않았다.

유휴 메시지(R2, `docs/guides/performance-audit.md`): 정지 중 폴링마다 `drainEvents` 와 `playhead` 두 번이던 것이 `drainEvents` 하나(바인딩이 끝에
`{type: 'playhead', tick}` 를 붙인다, 단위 테스트가 playhead() 를 부르지 않음을 본다). 감사가 잰 유휴 10초 92통(drainEvents 41, playhead 41,
pollPersistence 10)에서 playhead 41통이 빠지는 계산이다(다시 재지 않았다). 편집마다 모니터가 따로 읽던 `sequence.inspect`(R4)는 타임라인 store 가 같은
revision 을 이미 읽었으면 그 결과를 쓴다: 순서상 따로 나가던 경우 편집당 2번에서 1번(단위 테스트가 센다).

## 7. 남은 것

- 프레임 전달이 아직 2MB 에 12~15ms(엔진 프로세스와 렌더러 사이 직렬화, MB 당 5~8ms). 읽어 두기로 엔진 쪽은 0 에 가까우므로 이제 재생 한 프레임의
  가장 큰 비용이다. 픽셀을 YUV 4:2:0 으로 보내면 2.7배 작아지지만 렌더러에서 RGBA 로 바꿔야 한다(WebGL 이면 싸다). 측정 뒤 결정.
- Windows HEVC 를 처음으로 되돌려 다시 재생하면 한 번 0.5~0.7초 멈춘다(예전부터, Media Foundation HEVC 디코더의 되감기로 보임).
- 웹(wasm)은 스레드가 없어 읽어 두기를 재생 중에 쓰지 않는다. 웹 1080p 렌더는 프레임당 40~60ms 라 늘 늦고 자동 화질이 낮춘다. WebCodecs 디코더
  Worker 가 앞서 디코드하게 하는 것이 다음 후보.
- 렌더 캐시(효과가 무거운 구간을 미리 렌더해 두기, Resolve 의 스마트 캐시)는 없다.
