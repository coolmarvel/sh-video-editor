---
title: 기능 로드맵 - 경쟁 제품 조사·엔진 갭·마일스톤 2~4
created: 2026-10-14
updated: 2026-10-15
domain: development
---

# 0002 기능 로드맵 - 경쟁 제품 조사·엔진 갭·마일스톤 2~4

사용자 요청: "엔진이 filmcraft 오픈소스를 가져온 것이니 개선할 부분, 다른 제품군이 쓰는 기능, 추가하면 좋을 기능을
적극 반영하고 화면으로도 구현해 달라." 이 문서는 그 답으로 (1) 참조 제품 8종의 기능 표, (2) 엔진 갭 분석,
(3) 마일스톤 2~4 제안, (4) 결정 필요 항목을 담는다. 상태 표기는 `README.md` 규약, 마일스톤 0·1 은 `0001-mvp.md`.

조사 기준: 2026-10-14 WebSearch(출처는 각 절 아래). 엔진 보유 여부는 `engine-node` 의 `commandCatalog()`(커맨드 675개)와
`effects.list`(비디오 효과 130, 오디오 효과 58, 비디오 전환 112, 오디오 전환 3)를 실행해 확인한 것이다.
브리프 범위 밖(클라우드·협업·AI 생성·음성 합성)은 표에 남기되 로드맵에는 넣지 않는다.

## 1. 참조 제품 기능 조사

표기: `O` 있음, `$` 유료 등급에서만, `-` 없음 또는 확인 못 함. 가치는 브리프의 일반 사용자(병원 홍보·교육·개인 영상) 기준.
"엔진" 열은 우리 엔진이 지금 가진 커맨드·효과 id. 화면 연결 여부는 3절에서 다룬다.

| 기능                            | CapCut  | VLLO | Clideo | Clipchamp | Resolve 무료       | iMovie       | Canva        | Descript        | 가치 | 엔진 보유                                                                                                           |
| ------------------------------- | ------- | ---- | ------ | --------- | ------------------ | ------------ | ------------ | --------------- | ---- | ------------------------------------------------------------------------------------------------------------------- |
| 자동 자막(STT)                  | O       | O    | -      | O         | O                  | -            | O            | O(핵심)         | 상   | `transcript.generate`, `transcript.createCaptions`, `sequence.transcribe` (whisper feature 가 기본 빌드에서 꺼짐)   |
| 자막 편집·스타일·SRT            | O       | O    | O      | O(SRT)    | O                  | -            | O            | O               | 상   | `captions.*` 22개(`setStyle`, `import`, `export`), `graphics.upgradeCaption`                                        |
| 텍스트 템플릿(제목·하단 자막)   | O       | O    | -      | O         | O                  | O(11)        | O            | O               | 상   | `graphics.template.*` 내장 8종(.fcgt), `graphics.newText`, 글꼴 번들 Inter·JetBrains Mono·Noto Serif(한글 없음)     |
| 스티커·오버레이·PIP             | O       | O    | -      | O         | O                  | O            | O            | -               | 중   | `graphics.newFromFile`(이미지·영상 오버레이), `graphics.newShape`, Lottie 는 없음(effectcraft `lottie`)             |
| 전환                            | O       | O    | -      | O         | O                  | O            | O            | O               | 상   | `sequence.applyVideoTransition`, 비디오 전환 112(`cross_dissolve`, `dip_to_black`, `push`, `whip`, `glitch` ...)    |
| 효과·필터                       | O       | O    | O      | O         | O                  | O(13)        | O            | O               | 상   | `effects.apply` 비디오 130(`brightness_contrast`, `gaussian_blur`, `vignette`, `mosaic` ...), `presets.apply` 내장  |
| 색 보정 프리셋·LUT              | O       | O    | -      | O         | O                  | -            | O            | -               | 중   | `lumetri.applyPreset`(Cinematic·Film·Mono·Technical), `lut.import`, `lumetri.setInputLut`                           |
| 키프레임·모션                   | O       | O    | -      | -         | O                  | -            | O(애니)      | -               | 중   | `effects.addKeyframe`, `effects.setInterpolation`(linear·bezier·hold·easeIn·easeOut), `motion`·`transform` 효과     |
| 속도·램프·리버스                | O(곡선) | O    | O      | O         | O                  | O            | -            | -               | 상   | `clip.speedDuration`(speed·reverse·opticalFlow), `timeline.rateStretch`, `time_remap` 효과(속도 램프 키프레임)      |
| 프리즈 프레임                   | O       | O    | -      | -         | O                  | -            | -            | -               | 중   | `clip.frameHold`, `clip.insertFrameHoldSegment`, `file.exportFrame`                                                 |
| 크로마키(그린스크린)            | O       | $    | -      | O         | O                  | O            | -            | O               | 중   | `ultra_key`, `color_key`, `luma_key`(GPU)                                                                           |
| 배경 제거(AI, 키 없이)          | O       | -    | -      | -         | $(Magic Mask)      | -            | $            | -               | 중   | 없음. 로컬 분할 모델 필요(lightcraft `segment` 참고). 범위 밖(AI 생성)은 아니지만 모델 라이선스 확인 필요           |
| 오디오 덕킹                     | -       | -    | -      | -         | O                  | O(자동)      | -            | -               | 상   | `essentialSound.generateDucking`, `essentialSound.setType`(dialogue·music)                                          |
| 노이즈 제거·음성 강화           | O       | -    | -      | -         | $(Voice Isolation) | O            | -            | O(Studio Sound) | 상   | `denoise`, `dereverb`, `speech_enhance`, `dehummer`, `declicker`, `essentialSound.applyPreset`                      |
| 비트 감지·음악 맞춤             | O       | -    | -      | -         | -                  | O(길이 맞춤) | O(Beat Sync) | -               | 중   | `clip.remix`(길이에 맞춰 음악 재구성), `audio-dsp/remix.rs` 비트·섹션 분석                                          |
| 음악·효과음 라이브러리          | O       | O    | -      | O         | -                  | O(130+)      | O            | O               | 중   | 없음(데모 영상만). CC0 음원 조달 필요(5절)                                                                          |
| 비율 변환·자동 리프레임         | O       | O    | O      | O         | O                  | -            | O            | O               | 상   | `sequence.settings`(width·height), `clip.fillFrame`, `clip.scaleToFrameSize`, `auto_reframe` 효과(근사)             |
| 프로젝트 템플릿                 | O       | O    | -      | O         | -                  | O(테마 8)    | O            | O               | 중   | `file.saveAsTemplate`, `file.newProjectFromTemplate`, `file.templates`, `clip.automateToSequence`(슬라이드쇼)       |
| SNS 내보내기 프리셋             | O       | O    | O      | O(1080p)  | O                  | O            | O            | O               | 상   | `export.presets.list` 30종(YouTube·Vimeo·세로 1080x1920·4K), `export.quick`, `export.queue.*`                       |
| GIF·오디오만 내보내기           | O       | O    | O      | O(GIF)    | O                  | -            | O            | O               | 하   | `export.formats` gif·wav·aiff·png 시퀀스                                                                            |
| HEVC·WebM 내보내기              | O       | O    | -      | -         | O(HW)              | O            | -            | -               | 중   | `hevc` 포맷은 정의만(HW 인코더 없는 환경에서 `available:false`). effectcraft `hevcenc`·`vp9enc`·`av1enc`·`opusenc`  |
| 텍스트 기반 편집(전사로 자르기) | O       | -    | -      | -         | O(전사)            | -            | -            | O(핵심)         | 중   | `transcript.select`, `transcript.lift`, `transcript.extract`, `transcript.removePauses`, `transcript.removeFillers` |
| 장면 자동 분할                  | -       | -    | -      | -         | O                  | -            | -            | O               | 하   | `clip.sceneEditDetection`                                                                                           |
| 손떨림 보정                     | O       | -    | -      | -         | O                  | O            | -            | -               | 중   | `warp_stabilizer`(2D 근사)                                                                                          |
| 음성 녹음(보이스오버)           | O       | O    | -      | O         | O                  | O            | -            | O               | 중   | `audio.voiceover.*` 커맨드는 있으나 장치 입력은 ui-egui 에 있었음. 바인딩에 마이크 경로 없음                        |
| TTS·AI 보이스                   | O       | -    | -      | O         | -                  | -            | -            | O(Overdub)      | -    | 범위 밖(브리프: 음성 합성 제외)                                                                                     |
| 클라우드·협업·공유 링크         | O       | -    | O      | O         | -                  | -            | O            | O               | -    | 범위 밖                                                                                                             |
| 워터마크 없음·오프라인          | $       | $    | $      | O         | O                  | O            | O            | $               | 상   | 우리 차별점(브리프 "문제" 절)                                                                                       |

관찰:

- 쉬운 편집기 8종이 공통으로 가진 것은 자동 자막, 텍스트 템플릿, 전환·필터, 속도·리버스, SNS 프리셋이다.
  우리 엔진은 이 전부를 커맨드로 이미 가지고 있고, 빠진 것은 **화면**과 **에셋(한글 글꼴·음악·템플릿)** 이다.
- 엔진에만 있고 쉬운 편집기엔 드문 것: 덕킹 자동 생성, 노이즈·리버브 제거, 텍스트 기반 편집, 장면 분할, 리믹스.
  이는 Descript·Resolve 급 차별점이 되므로 화면에 "한 버튼" 으로 노출할 가치가 있다.
- 엔진에 없는 것: 한글 글꼴, 음악 라이브러리, Lottie 스티커, HEVC/WebM 소프트웨어 인코더, AI 배경 제거, 마이크 입력.

출처:

- CapCut PC: https://www.capcut.com/resource/pc-professional-video-editor , https://apps.microsoft.com/detail/xp9kn75rrb9nhs
- VLLO: https://apps.apple.com/ca/app/vllo-video-editor-vlog-edits/id952050883 , https://www.apkmirror.com/?p=5177165
- Clideo: https://www.trustradius.com/products/clideo/details , https://www.techradar.com/reviews/clideo-review
- Clipchamp: https://support.microsoft.com/en-us/Clipchamp/feature-comparison-between-clipchamp-for-work-and-personal-versions ,
  https://www.webnots.com/10-free-clipchamp-features-to-replace-your-paid-video-editing-app-on-windows/
- DaVinci Resolve 20: https://www.storyblocks.com/resources/tutorials/davinci-resolve-free-vs-studio , https://www.provideocoalition.com/davinci-resolve-20-released/ ,
  https://nofilmschool.com/davinci-resolve-20
- iMovie: https://images.apple.com/az/imovie , https://www.macworld.com/article/232886/imovies-latest-update-brings-green-screen-effects-80-new-soundtracks-and-more.html
- Canva: https://www.canva.com/features/beat-sync/ , https://www.canva.com/video-editor/ai/ , https://canva.com/newsroom/news/canva-video
- Descript: https://skillscouter.com/descript-review/ , https://sendshort.ai/guides/descript-review/

## 2. 엔진 갭 분석

### 2.1 filmcraft 자평 대 우리 성공 기준

성공 기준(브리프): 1080p 클립 3개 + 자막 + 배경음악 + 전환 1개를 MP4 로, Windows 데스크톱과 Chrome 에서 같은 화질·길이.

| filmcraft ROADMAP 자평(2026-10-05)                                                        | 우리에게 미치는 영향                                                                      | 대응                      |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------- |
| 정확성 60~70%: 첫 기여자가 핵심 경로에서 버그 4개(전환이 리플 트림을 안 따라감 등)        | 전환 + 트림 조합이 성공 기준 안에 있다                                                    | M4-1 워크플로 회귀 테스트 |
| 코덱 75%: 적합성 스트림은 비트 정확, 실제 폰·카메라 파일(VFR, 손상, 특이 컨테이너) 미검증 | 사용자의 입력은 전부 폰·카메라 mp4 다. 가장 먼저 터질 자리                                | M4-2 실매체 코퍼스        |
| 내보내기 70%: H.264 만, CPU 만, HEVC/AV1 소프트웨어 인코더 없음                           | v1.0 은 H.264/AAC 면 충분. HEVC 는 M3                                                     | M3-5 effectcraft 인코더   |
| 성능 35~40%: HW 디코드는 macOS·Windows 뿐, GPU 는 합성 + 효과 31개, 내보내기는 CPU        | 실측: 1080p 내보내기 16초 영상에 47.6초(실시간의 1/3). wasm renderFrame 은 네이티브의 8배 | M4-3·M4-4                 |
| 플랫폼: Windows·Linux 는 "빌드만 됨", 웹 셸은 미완(파일·WebCodecs·오디오)                 | 우리 타깃이 정확히 Windows 와 Chrome 이다                                                 | M4-5 Windows 런타임 검증  |
| AI 25~35%: STT 는 whisper feature 가 기본 빌드에서 꺼짐, 모델 다운로드는 ureq(네이티브)   | 자동 자막은 핵심 시나리오 2. 웹에서는 모델 fetch·추론 경로가 따로 필요                    | M2-2                      |
| 안정성: never-crash 통과했으나 실사용 기록 없음                                           | utility process 격리는 돼 있음(마일스톤 1). 크래시 수집 창구 없음                         | M4-6                      |

### 2.2 반드시 고쳐야 할 것 (우선순위)

1. **실제 폰·카메라 mp4 호환성**: iPhone(HEVC·VFR·회전 메타데이터), Galaxy(H.264 High, 60fps, 48kHz AAC), 화면 녹화(VFR), 액션캠.
   `filmcraft-cli probe` + import -> razor -> export 왕복을 ffprobe 오라클로 비교. 회전 메타데이터(`tkhd` matrix)와 VFR 을 특히.
   2026-10-14: `packages/engine/tests/media-compat.test.ts` 가 ffmpeg 로 흉내낸 코퍼스(`tests/corpus/gen.sh`, 13개: H.264 High
   1080p30/60, HEVC Main, VFR, 회전 90/180, 모노, 4K, 조각난 MP4, mp3/m4a, PNG/JPEG)를 import -> 패널 열 -> 시퀀스 ->
   renderFrame(ffmpeg 프레임과 비교) -> razor -> 내보내기 -> ffprobe 로 왕복해 전부 통과. 실제 폰 파일(사용자 제공)은 M4-2 로 남는다.
2. **Windows HW 디코드 연결**: 2026-10-14 napi 바인딩이 Windows·macOS 타깃에서 `filmcraft-platform` 에 의존하고 `Engine::new` 에서
   `register()` 를 부른다. cargo-xwin 크로스 빌드에서 Media Foundation/D3D11 링크 통과(`d3d11.dll`·`dxgi.dll` import, `mfplat.dll` 은
   실행 시 로드), `engineVersion()` 끝에 `hw: Media Foundation`. 실제 Windows PC 에서 하드웨어가 쓰이는지(`perf.stats` 의
   `decode.hardware`)는 미확인: `docs/guides/packaging.md` "실기 검증" 표. 안 되면 1080p 3클립 미리보기가 CPU 디코드.
3. **오디오 재생 경로**: 바인딩에 오디오 렌더 API 가 없다(`bindings/napi/src/lib.rs` 는 `render_frame` 만). 덕킹·페이드를 만들어도 들을 수 없다.
4. **wasm 성능**: renderFrame 194ms(scale 0.5). wasm SIMD(`-C target-feature=+simd128`), 스레드 없는 환경의 디코더 파이프라인, WebCodecs 디코더 등록(`codecs::register_video_decoder`), wasm-opt.
5. **엔진 이벤트 통합**(`drainEvents`)과 **썸네일 커맨드**: 지금 패널이 각자 폴링. 썸네일은 엔진에 커맨드가 없어 `renderFrame` 을 축소해 쓰는 중.

### 2.3 effectcraft·soundcraft 에서 가져올 것

줄 수는 `/home/seonghyunlee/craft-opensource` 스냅샷 실측. 타입 어댑터(Tick·geom·color) 비용은 ADR-0003 결정 2.

| 우선 | 크레이트                       | 줄수   | 가져오는 이유                                                                                       | 어댑터 난이도                    |
| ---- | ------------------------------ | ------ | --------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1    | effectcraft `hevcenc`          | 4,097  | HEVC 내보내기(iPhone 호환·용량 절반). 의존성 0, IDR+P 만이라 파일 큼                                | 낮음(프레임 입출력만)            |
| 1    | effectcraft `opusenc`+`vp9enc` | 8,416  | WebM(VP9/Opus) 내보내기. 웹 공유·가벼운 미리보기용                                                  | 낮음                             |
| 2    | effectcraft `keyframe`         | 2,716  | AE 식 Ease(speed·influence), 실측 검증된 이징. 우리 `effects.setInterpolation` 은 7종 고정          | 중간(project 키프레임 타입 대체) |
| 2    | effectcraft `lottie`           | 3,405  | 스티커·애니메이션 텍스트를 Lottie(JSON)로 조달하면 에셋 제작이 쉬워진다                             | 중간(렌더 레이어 추가)           |
| 3    | soundcraft `dsp`               | 7,132  | WSOLA 타임스트레치(속도 바꿔도 음정 유지), 리버브·EQ 는 filmcraft 에 이미 있음                      | 중간(샘플 인덱스 -> Tick)        |
| 3    | effectcraft `effects` 선별     | 49,745 | 전부 가져오지 않는다. `keying.rs`(Keylight), `textfx.rs`(텍스트 애니메이터), `warp_stab.rs` 만 후보 | 높음(PropGroup 모델)             |
| 4    | effectcraft `gpu`              | 18,985 | filmcraft `gpu` 와 역할 겹침. Auto 백엔드 실측 선택 로직만 참고                                     | 참고만                           |
| 4    | effectcraft `av1enc`           | 9,309  | AV1 은 v1.0 수요 낮음. VP9 다음. 2026-10-15 이식 완료(`crates/av1enc`, M3-5)                        | 낮음                             |
| -    | soundcraft `mix`               | 2,083  | filmcraft 믹서(`mixer.*` 20개)가 이미 있다. 실시간=바운스 구조만 참고                               | 가져오지 않음                    |

## 3. 로드맵

각 항목: (a) 엔진, (b) 화면(`packages/editor/src/features/<이름>/`), (c) 검증, (d) 크기 S(반나절)·M(1~2일)·L(3일 이상).
엔진 커맨드가 이미 있으면 id 를, 새로 만들면 "신규" 를 적는다. 바인딩 변경은 napi·wasm 둘 다.

### 마일스톤 2 - 자막·음악·전환 (성공 기준 완성)

- [x] **M2-1 텍스트·제목 클립** (2026-10-14 feat/text-captions: Pretendard Regular·Bold 번들, features/text 텍스트 탭·자막 탭·모니터 끌기, SRT 가져오기·내보내기)
  - (a) `graphics.newText`, `graphics.set`, `graphics.setCharStyle`, `fonts.list`. 한글 글꼴 번들(Pretendard 또는 Noto Sans KR, OFL)을 `crates/text` 의 `include_bytes!` 목록에 추가하고 `.attribution` 사이드카
  - (b) features/text: 모니터 위 드래그로 위치, 인스펙터(글꼴·크기·색·외곽선·배경), 타임라인 그래픽 클립
  - (c) 한글·영문 혼합 문장을 1080p 로 내보내 ffmpeg 로 프레임 추출, 글리프 누락(네모) 없음
  - (d) M
- [~] **M2-2 자동 자막(STT)** (2026-10-14 feat/stt-captions: 데스크톱 (a)(b) 구현. 모델은 첫 사용 때 동의 뒤 내려받아 `<userData>/engine/models` 에 보관(인스톨러 미동봉). 웹은 candle 이 wasm32 에서 컴파일되지만 모델 적재·fetch 경로가 없어 안내 문구만(M4). 실측·배포는 `guides/packaging.md` "STT 음성 모델")
  - (a) napi 바인딩 feature `stt`(기본 on) 로 `whisper`·`speech-download` 를 켬. 진행률·취소를 위해 바인딩 `downloadSpeechModel`·`Engine.transcribeItem`(libuv 스레드, 세션을 막지 않음) 신규, 결과는 `transcript.set` -> `transcript.createCaptions`. `transcript.generate` 도 그대로 동작(동기, 진행률 없음). 웹 `putModel` 은 미착수
  - (b) features/stt: 자막 탭의 "자동 자막" 절(모델·언어·줄당 글자·최소 시간, 선택 클립/편집본 전체), 동의 대화상자(크기·출처·라이선스·보관), 진행률·취소, "음성 정리"(군말 제거·무음 자르기: 생성 시 옵션 + 인식 뒤 버튼). 자막 목록·스타일·SRT 는 M2-1 의 자막 탭 그대로
  - (c) 한국어 30초 낭독 샘플(zeroth-korean): whisper-base 8.5초(모델 적재 포함), 단어 39개, 자막 6개(12줄), 한 줄 20자 규칙으로 자막 생성(엔진 테스트 `tests/stt.test.ts` 가 모델이 있을 때 검증). 단어 시간 오차 0.5초 이내는 수동 확인 미실시. CER 은 98초 세트에서 base 32.5%, small 24.6%
  - (d) L
- [x] **M2-3 전환** (2026-10-14, feat/transitions. 남은 것: 엔진에 전환 삭제·정렬 변경 커맨드가 없어 인스펙터의 삭제·정렬은 읽기 전용, 일반 트림으로 틈이 생긴 전환을 엔진이 정리하지 않음, 썸네일은 SVG 로 대체)
  - (a) `sequence.applyVideoTransition`(effect·frames·edge), `sequence.setTransition`, `effects.setDefaultTransition`. 사용자용 전환 12종 선별: cross_dissolve, dip_to_black, dip_to_white, push, slide, whip, zoom_blur, glitch, light_leak, clock_wipe, linear_wipe, cross_zoom
  - (b) features/transitions: 미디어 패널의 전환 탭(썸네일은 두 색 SVG, `renderFrame` 미니 시퀀스는 프로젝트를 더럽혀 보류), 클립 경계로 드롭, 더블클릭, 길이 핸들, 인스펙터 전환 탭
  - (c) 전환 뒤 리플 트림 시 전환이 따라오는지(filmcraft #7 회귀), 내보내기 길이 불변: `packages/engine/tests/transitions.test.ts`
  - (d) M
- [~] **M2-4 기본 효과·필터** (2026-10-14 feat/effects-filters: (a)(b) 구현, (c) 엔진 테스트의 scopes·renderFrame 대조까지. GPU 패리티 golden 은 미착수)
  - (a) `effects.apply`, `effects.setParam`, `effects.remove`, `presets.apply`(Fade In·Out), `lumetri.applyPreset`. 사용자용 효과 10종: brightness_contrast, lumetri(노출·대비·채도·온도만 노출), gaussian_blur, sharpen, vignette, mosaic, black_white, tint, noise, drop_shadow
  - (b) features/effects: 클립 인스펙터 탭, 슬라이더, 필터 프리셋 갤러리(Lumetri 프리셋 14종을 썸네일로)
  - (c) 효과 적용 전후 `scopes.read` 히스토그램 차이, GPU·CPU 패리티(엔진 golden)
  - (d) M
- [x] **M2-5 속도·리버스·프리즈** (2026-10-14 feat/speed-ratio, features/speed)
  - (a) `clip.speedDuration`(speed·reverse·ripple·interpolation), `clip.frameHold`, `clip.insertFrameHoldSegment`
  - (b) features/speed: 속도 슬라이더(0.1x~10x)·리버스 토글·"이 프레임 고정" 버튼. 속도 램프 곡선은 M3
  - (c) 2배속 후 내보내기 길이가 절반, 리버스 첫 프레임이 원본 마지막 프레임
  - (d) S
- [x] **M2-6 오디오 재생·배경음악·덕킹** (2026-10-14 feat/audio: 바인딩 renderAudio·audioPeaks, features/audio 재생기·인스펙터 탭·파형·음악 탭. 외부 CC0 음원 조달은 미정)
  - (a) 바인딩 신규 `renderAudio(tick, frames)`(믹스 결과 f32 PCM). 데스크톱은 렌더러 AudioWorklet 이 MessagePort 로 받음, 웹은 Worker -> AudioWorklet. `clip.audioGain`, `essentialSound.setType`(dialogue·music), `essentialSound.generateDucking`, `sequence.applyAudioTransition`(constant_power)
  - (b) features/audio: 볼륨 슬라이더·페이드 인/아웃 핸들·"음성 구간 자동 낮춤" 버튼, 파형(`clip.generateAudioWaveform`), 음악 라이브러리 패널(5절 조달)
  - (c) 재생 중 A/V 드리프트 1초에 1프레임 이하, 덕킹 적용 후 음성 구간 음악 -12dB(`loudness_radar` 또는 ffmpeg ebur128)
  - (d) L
- [x] **M2-7 비율·SNS 프리셋** (2026-10-14 feat/speed-ratio, features/ratio)
  - (a) `sequence.settings`(1920x1080, 1080x1920, 1080x1080), `clip.fillFrame`, `clip.scaleToFrameSize`, `export.presets.list`(YouTube·세로·4K), `export.quick`
  - (b) features/export 확장: 비율 선택이 시퀀스를 바꾸고 클립을 fillFrame, 프리셋 카드(YouTube·Shorts/Reels·Instagram 정사각)
  - (c) 세로 1080x1920 내보내기 ffprobe 해상도·sar 확인, Chrome 과 데스크톱 결과 md5 비교(오디오 제외 프레임 해시)
  - (d) S
- [ ] **M2-8 SQLite 캐시**(0001 에서 이월): 썸네일·파형·최근 프로젝트. 웹은 OPFS. (d) M

### 마일스톤 3 - 효과·템플릿·이식

- [~] **M3-1 키프레임·모션** (2026-10-14 화면 구현, feat/keyframes-templates)
  - (a) `effects.addKeyframe`, `effects.setKeyframe`, `effects.moveKeyframe`, `effects.setInterpolation`. effectcraft `keyframe` 이식은 easing 곡선이 부족하다고 판단될 때
  - (b) [x] features/keyframes: 인스펙터 "모션" 탭(위치 X/Y·크기·회전·불투명도 + 마름모 토글·보간 5종·이전/다음·등장/퇴장 프리셋 6종), 타임라인 클립 마커, 모니터 변형 상자 끌기
  - (c) [x] `packages/engine/tests/keyframes.test.ts`: 중간 프레임 위치가 선형 보간값과 4px(0.25 배율 1px) 이내, 홀드·이즈아웃, 불투명도 밝기 증가
  - (e) [ ] 엔진 갭: `sequence.inspect` 가 키프레임 **개수**만 주고 시각·값 목록을 주는 커맨드가 없다. 화면이 보낸 커맨드로 목록을 쌓고 개수로 대조하며(실행 취소·다시 실행은 스냅샷), 프로젝트를 다시 열면 마커가 비는다. `effects.keyframes {clip, effect, param}` 조회 커맨드가 필요하다
  - (d) M
- [x] **M3-2 속도 램프** (2026-10-14 feat/motion-fx: 상류가 time_remap speed 키프레임을 렌더에서 무시해 vendor 에 적분 추가, 곡선 프리셋 3종 + 편집기): `time_remap` 효과의 speed 파라미터에 키프레임(M3-1 재사용), 곡선 프리셋(몽타주·히어로·총알). (d) S
- [x] **M3-3 크로마키·PIP·오버레이** (2026-10-14 feat/motion-fx: ultra_key + 스포이트, PIP 모서리 프리셋, V2 끌어다 놓기 확인)
  - (a) `ultra_key`(key_color·tolerance·pedestal), `graphics.newFromFile`, `motion` 효과의 position·scale, `opacity` 의 blend
  - (b) features/overlay: "배경 색 지우기" 스포이드, PIP 위치 프리셋(모서리 4개), 불투명도·블렌드
  - (c) 그린스크린 샘플 클립에서 배경 알파 0, 피사체 알파 255(픽셀 샘플링)
  - (d) M
- [x] **M3-4 스티커·Lottie** (2026-10-14 정적 스티커, 2026-10-15 Lottie 이식 + 움직이는 스티커 10종, feat/lottie-stickers)
  - (a) [x] effectcraft `lottie` 는 가져오기 쪽(값·키프레임·도형·레이어 읽기)만 이식하고 평가·래스터를 새로 쓴 `crates/lottie`(`LottieSource`). `graphics.newLottie` 커맨드 대신 **미디어 풀 오프너**로 `.json`/`.lottie` 를 반복되는 벡터 영상 미디어(알파, 60초)로 연다: 가져오기 경로 하나로 데스크톱 파일·웹 Blob·사용자 Lottie 파일을 다 받고, 화면은 기존 `graphics.newFromFile {path, time, duration}`(duration 은 이번에 추가) 그대로 쓴다. 에셋은 직접 만든 bodymovin JSON 10종(`features/stickers/assets/*.json` + 미리보기 SVG, `ATTRIBUTION.md`), 외부 Lottie 는 라이선스 선별 비용 때문에 쓰지 않았다
  - (b) [x] 스티커 패널(분류 5개, 자체 제작 SVG 20종, `features/stickers/assets` + `.attribution` + `ATTRIBUTION.md`). 화면이 PNG 로 래스터해 웹은 `registerFiles`, 데스크톱은 `writeTempFile` 로 넘기고 엔진 `graphics.newFromFile {path, time}`(두 번째부터는 `timeline.place {duration}`). 엔진은 SVG 를 읽지 못한다(media: unrecognised format). 위치·크기는 모션 탭·변형 상자. 검색은 없음
  - (c) [x] Lottie 샘플 10개 렌더 골든: `packages/engine/tests/lottie.test.ts`(napi: 에셋마다 가져오기·5초 클립·1.5초 프레임의 정해진 자리 색·0.2초 대 0.5초 차이·한 바퀴 뒤 반복 일치, Lottie 아닌 .json 거부, 1080p 렌더 시간; wasm: putFile 경로 한 번), `cargo test -p filmcraft-lottie` 28개(이즈·도형·스타일 규칙·트림·리피터·마스크·매트·프리컴프·dotLottie·적대적 입력)
  - (d) L
- [x] **M3-5 HEVC·WebM 내보내기** (2026-10-14 feat/webm-export + feat/hevc-export: WebM(VP9 + Opus)·HEVC(hevcenc) 소프트웨어 인코더, 프리셋 각 2종. 둘 다 단일 스레드라 1080p 는 H.264 의 5~9배 느림. 2026-10-15 feat/av1-export: AV1(av1enc) 형식 "AV1 (mp4)"·프리셋 2종, WebM 의 `videoCodec: av1`. 1080p 는 H.264 의 10배 느림, 파일은 46%)
  - (a) effectcraft `hevcenc`·`vp9enc`·`opusenc` 이식, `export::VideoEncoder`·`AudioEncoder` 구현, `export.formats` 에 hevc `available:true`, webm 포맷 신규(matroska 먹서는 디먹스만 있어 먹서 신규)
  - (b) 내보내기 프리셋에 "HEVC(용량 절반)"·"WebM(웹용)" 추가
  - (c) 인코드 -> 우리 디코더 -> 디코드 왕복 PSNR 35dB 이상, ffprobe 로 재생 가능, Windows Movies & TV·Chrome 재생
  - (d) L
- [x] **M3-6 템플릿** (2026-10-14 레시피 4종, feat/keyframes-templates; 2026-10-15 사용자 템플릿 저장·적용·가져오기, feat/user-templates)
  - (a) [x] 사용자 템플릿(2026-10-15, feat/user-templates): 엔진 `file.saveAsTemplate`·`file.newProjectFromTemplate` 대신 화면이 `sequence.inspect`·`effects.keyframes` 로 편집본 구조를 미디어와 떼어 템플릿 JSON(`format.ts`, `docs/guides/timeline.md` "템플릿 JSON")으로 적고(미디어 클립은 슬롯), 적용은 같은 레시피 경로(`apply.ts`, `applyRecipe`)로 새 편집본을 만든다. 저장소는 호스트(`EngineBridge.templates`: 데스크톱 `userData/templates/<id>.json + .png`, 웹 IndexedDB, 없으면 메모리). 카드 메뉴로 이름·설명 바꾸기, JSON 내보내기·가져오기(검증, 같은 id 는 새 id, 파일 이름이 될 수 없는 id 는 새 id), 삭제. 썸네일은 저장 때 플레이헤드 renderFrame. `clip.automateToSequence` 는 쓰지 않았다(활성 편집본 끝에 끼우며 기존 클립을 건드려 레시피에 맞지 않음), `graphics.template.apply` 내장 8종은 쓰지 않음(영문 Lower Third 류). 한계: 색 매트 색은 읽을 수 없어 기본색, 비활성 클립·sourceIn 은 저장하지 않음
  - (b) [x] features/templates: 미디어 패널 "템플릿" 탭, 자체 레시피 4종(인트로 제목 5초, 세로 Shorts 틀 9:16, 사진 슬라이드쇼 3초+디졸브, 엔딩 카드). 레시피 = 엔진 커맨드 순서(`recipe.ts`: newSequence, newColorMatte, timeline.place, clip.fillFrame, graphics.newText/set/alignFrame.*, opacity 키프레임, applyVideoTransition). 묶음 실행 취소는 `edit.beginTransaction/endTransaction` 이 카탈로그에 생기면 `runRecipe` 가 자동으로 감싼다(지금은 단계별 항목). 플레이스홀더 교체 플로우는 없음(제목 클립을 선택하고 텍스트 탭을 연다)
  - (c) [x] 사진 5장 드롭 -> 템플릿 적용 -> 내보내기까지 클릭 5회 이내(가져오기 1, 선택, 템플릿 탭 1, 만들기 1, 내보내기 1. 내 템플릿도 같은 경로: 슬롯 수만큼 고르고 만들기 1). 검증은 웹 e2e `user-templates.spec.ts`(1440·390), 데스크톱 e2e `templates.spec.ts`, 단위 `test/unit/templates/user-templates.test.ts`
  - (d) M
- [x] **M3-7 텍스트 기반 편집·정리 도구** (2026-10-14 feat/audio-cleanup: 전사 탭, 문장 지우기, 무음·군말 제거, 장면마다 자르기): `transcript.select`·`transcript.lift`·`transcript.removePauses`·`transcript.removeFillers`, `clip.sceneEditDetection`. 전사 패널에서 문장 선택 후 "지우기", "무음 자동 제거" 버튼. (d) M
- [x] **M3-8 오디오 정리** (2026-10-14 feat/timestretch + feat/audio-cleanup: 음정 유지, 음성 깨끗하게(denoise·dereverb·enhance), 소리 크기 맞추기 -14/-16/-23 LUFS): `denoise`·`dereverb`·`speech_enhance` 를 "음성 깨끗하게" 한 버튼으로(`essentialSound.applyPreset`), `sequence.normalizeMixTrack`(-14 LUFS 유튜브). soundcraft `dsp` WSOLA 는 속도 변경 시 음정 유지가 필요할 때. (d) S
- [x] **M3-9 손떨림 보정** (2026-10-14 feat/motion-fx: 흔들림 줄이기 버튼. 분석이 렌더 안 동기라 진행률 없음, wasm 16초 클립 40~50초): `warp_stabilizer`(2D 근사) 를 "흔들림 줄이기" 버튼으로. 분석 시간이 길어 `jobs.*` 진행률 필요. (d) S
- [ ] **M3-10 macOS dmg**(0001 이월). (d) M

### 마일스톤 4 - 품질·성능·호환성

- [ ] **M4-1 워크플로 회귀 테스트**: filmcraft-cli `run script.jsonl` 로 "가져오기 -> 자르기 -> 전환 -> 자막 -> 음악 -> 내보내기" 를 `npm run verify` 에 포함. 결과 mp4 를 ffprobe 로 길이·스트림 검사. `.mcp.json` 에 `filmcraft-cli mcp` 등록(todo P2). (d) M
- [ ] **M4-2 실매체 코퍼스**: iPhone(HEVC, VFR, 회전), Galaxy(H.264 60fps), Windows 화면 녹화, 액션캠, 손상 파일 각 1개 이상을 `packages/engine/fixtures/`(gitignore, 사용자 제공)에 두고 M4-1 스크립트로 왕복. 실패하면 vendor 수정(`engine(vendor):`). (d) L
- [ ] **M4-3 Windows HW 디코드·인코드**: cargo-xwin 빌드에서 `platform` Media Foundation 링크 확인, NVENC H.264 내보내기 옵션 노출, 1080p 3클립 미리보기 CPU 사용률 측정. (d) M
- [~] **M4-4 wasm 성능** (2026-10-14 feat/wasm-perf: 14.2MB, SIMD128, WebCodecs. 12MB 와 데모 renderFrame 60ms 는 미달): SIMD128·wasm-opt·코덱 feature 분리로 23MB 축소(todo P2), WebCodecs 디코더를 `codecs::register_video_decoder` 에 등록, renderFrame 1080p scale 0.5 를 194ms 에서 60ms 이하로. 데스크톱 대비 내보내기 시간 비율 기록. (d) L
- [ ] **M4-5 Windows 런타임 검증**: 사용자 Windows PC 에서 인스톨러 실행·3클립 시험(0001 마일스톤 1 미완 항목), 재생·내보내기·자동 저장 복구 체크리스트를 `docs/guides/packaging.md` 에. (d) S
- [ ] **M4-6 크래시 리포트**: utility process 종료 코드와 마지막 커맨드 20개(`history.list`)를 로컬 파일로 남기고 사용자가 첨부할 수 있게. 서버 전송 없음. (d) S
- [ ] **M4-7 썸네일·파형 커맨드**: `media.thumbnail`(item, time, size) 신규, `clip.generateAudioWaveform` 결과를 바인딩으로 노출. SQLite 캐시(M2-8)와 연결. (d) M
- [ ] **M4-8 이벤트 통합**: `drainEvents` 를 store 가 폴링해 revision 하나로 갱신(todo P1). (d) S
- [ ] **M4-9 한글화**: 커맨드 라벨·메뉴 한글(todo P2), 자막 기본 글꼴 한글. (d) S

### 상위 10개 제안 (가치 x 크기 x 보유)

| #   | 제안                            | 가치 | 크기 | 엔진 보유                    | 항목      |
| --- | ------------------------------- | ---- | ---- | ---------------------------- | --------- |
| 1   | 자동 자막(STT) + 자막 스타일    | 상   | L    | 있음(feature 켜기·모델 배포) | M2-2      |
| 2   | 오디오 재생 + 배경음악 + 덕킹   | 상   | L    | 커맨드 있음, 바인딩 신규     | M2-6      |
| 3   | 한글 글꼴 번들 + 텍스트 클립    | 상   | M    | 커맨드 있음, 글꼴 없음       | M2-1      |
| 4   | 전환 12종 패널                  | 상   | M    | 있음(112종)                  | M2-3      |
| 5   | 필터·효과 10종 + Lumetri 프리셋 | 상   | M    | 있음                         | M2-4      |
| 6   | 비율 변환 + SNS 프리셋          | 상   | S    | 있음                         | M2-7      |
| 7   | 실매체 코퍼스 왕복 테스트       | 상   | L    | 테스트 자산 없음             | M4-2      |
| 8   | 속도·리버스·프리즈 프레임       | 상   | S    | 있음                         | M2-5      |
| 9   | 음성 깨끗하게 + 무음·군말 제거  | 중   | S+M  | 있음(차별점)                 | M3-8·M3-7 |
| 10  | HEVC·WebM 내보내기(effectcraft) | 중   | L    | 없음(이식)                   | M3-5      |

## 4. 결정 필요

- [?] **한글 글꼴**: Pretendard(OFL, 한글·라틴 모두 좋음, 약 2MB/weight) 또는 Noto Sans KR(OFL, 구글 유지). 번들 weight 수(Regular·Bold 2종이면 wasm 크기 부담 작음). 데스크톱은 시스템 글꼴(`fonts.list system:true`) 도 쓴다.
- [?] **음악·효과음 라이브러리 출처**: 후보 (1) Free Music Archive CC0/CC-BY 선별, (2) Kevin MacLeod(incompetech, CC-BY 4.0: 크레딧 표기 필요), (3) freesound.org CC0 효과음, (4) 자체 제작(soundcraft 악기로 생성). 인스톨러 동봉 용량 상한(예: 50MB)과 웹은 지연 로드. 각 파일에 `.attribution` 사이드카.
- [?] **LUT·필터 에셋**: 엔진 Lumetri 프리셋 14종은 파라미터라 라이선스 문제 없음. 외부 .cube LUT 를 넣을지(CC0 LUT 팩 검증 필요), 아니면 프리셋만으로 갈지.
- [?] **스티커 에셋**: Lottie 이식 전제. 출처 후보 LottieFiles 는 라이선스가 파일마다 달라 선별 비용이 크다. 대안: Tabler Icons(MIT)·Phosphor(MIT) 를 SVG 로, 애니메이션은 자체 제작 소수.
- [x] **Whisper 모델 배포** (2026-10-14 사용자 결정): 인스톨러에 동봉하지 않고 첫 사용 때 동의 뒤 Hugging Face 에서 내려받아 `<userData>/engine/models` 에 보관한다. 한 번 받으면 오프라인 동작. 기본 whisper-base, 품질이 필요하면 small 선택. 웹(fetch + OPFS, 크기 상한)은 M4 에서.
- [?] **AI 배경 제거**: 범위 밖(AI 생성)은 아니지만 모델(MobileSAM 류)의 라이선스·크기·wasm 추론 성능 미확인. M3 이후로 미루고 크로마키로 대체할지.
- [?] **HEVC 특허**: 소프트웨어 HEVC 인코더 배포 시 특허 풀(Access Advance·Via LA) 문제는 UNLICENSED 개인 저작물이라도 확인 필요. VP9/AV1 은 로열티 없음.
- [?] **effectcraft `keyframe` 이식 시점**: filmcraft 키프레임(7종 보간)으로 M3-1 을 먼저 만들고, 부족할 때만 이식.

에셋 조달 원칙(`packages/engine/AGENTS.md` 7): 타사(Adobe·CapCut·VLLO) 아이콘·폰트·템플릿·스크린샷 금지. 글꼴은 OFL, 음원은 CC0 우선(CC-BY 는 앱 정보 화면에 크레딧 자동 표기), 아이콘은 MIT, 템플릿·전환 썸네일은 우리 엔진으로 렌더해 만든다. 모든 에셋은 `.attribution` + `ATTRIBUTION.md`, 배포물의 NOTICE 에 포함.

## 관련 문서

- `docs/brief.md` 핵심 시나리오·성공 기준, `docs/plans/0001-mvp.md` 마일스톤 0·1, `docs/adr/0003-engine-vendoring.md` 이식 결정
- `packages/engine/vendor/filmcraft/ROADMAP.md` "Honest assessment", `docs/architecture.md` 크레이트 표
- `/home/seonghyunlee/craft-opensource/ANALYSIS.md` 3.3 EffectCraft, 3.5 SoundCraft, 5.4
