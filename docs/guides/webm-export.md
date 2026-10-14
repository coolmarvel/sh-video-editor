---
title: WebM(VP9/Opus)·HEVC 내보내기
created: 2026-10-14
updated: 2026-10-14
domain: engine
---

# WebM(VP9/Opus)·HEVC 내보내기

이 문서는 effectcraft 에서 이식한 소프트웨어 인코더 두 갈래, WebM(VP9 + Opus)과 HEVC(MP4 안 H.265)를 다룬다(로드맵 M3-5). WebM 은 1절, HEVC 는 2절.

## 1. WebM(VP9/Opus)

### 1.1 개요

내보내기 형식 콤보에서 **WebM (VP9 + Opus)** 을 고르면 MP4(H.264/AAC) 대신 WebM 파일을 만든다. 브라우저(Chrome, Firefox, Edge)가
플러그인 없이 재생하고 같은 화질에 H.264 보다 파일이 작다. 인코더는 effectcraft 에서 이식한 순수 Rust `filmcraft-vp9enc`(VP9 프로파일 0,
8비트 4:2:0)와 `filmcraft-opusenc`(Opus 48 kHz, 20 ms 패킷), 먹서는 상류 filmcraft 의 `filmcraft-matroska` `MkvWriter` 다. 외부 라이브러리를
링크하지 않으므로 데스크톱(napi)과 웹(wasm)에서 같은 코드가 돈다. 로드맵 M3-5 의 WebM 절반(HEVC 는 2절).

### 1.2 동작 방식

- 엔진 `export.formats` 에 `{id: "webm", label: "WebM (VP9 + Opus)", extension: "webm", available: true, video: true, audio: true}` 가 생겼다.
  `export.queue.add`·`export.quick`·`export.resolve` 에 `format: "webm"` 을 주면 된다(`vp9`, `mkv` 도 같은 형식으로 읽는다). 경로에 확장자가
  없으면 `.webm` 을 붙인다.
- 내장 프리셋 두 개(`export.presets.list {format: "webm"}`): `WebM 1080p (Web)`(1920x1080, VBR 1 pass 8 Mbps 목표·12 Mbps 최대, Opus 128 kbps)과
  `WebM 720p`(1280x720, 4 Mbps 목표·6 Mbps 최대). H.264 프리셋에 `format: "webm"` 만 덮어써도 되며 그때는 그 프리셋의 비트레이트를 쓴다.
- 설정 규칙(`crates/export/src/settings.rs`): WebM 이면 오디오 코덱은 항상 `AudioCodec::Opus`, 샘플레이트는 48 kHz 로 고정(Opus 규격), 채널은
  모노 또는 스테레오(5.1 은 스테레오로). `bitrateMode: "vbr2Pass"` 는 거부한다(2-pass 는 H.264 만). `quality`(기본 90)는 첫 프레임의 양자화
  초기값이고 그 뒤는 목표 비트레이트의 프레임별 레이트 컨트롤이 정한다. 키프레임 간격은 `keyframeDistance`(기본 2초).
- 파이프라인(`crates/export/src/job.rs`): 다른 영상 형식과 같은 스텝 내보내기(`Exporter`). 프레임은 RGBA8 로 렌더되어 `rgba_to_yuv420_8`
  (BT.709 리미티드, rayon 병렬)로 바뀐 뒤 `Vp9Encoder` 가 한 프레임에 한 패킷(B 프레임 없음)을 낸다. 오디오는 `AudioOut` 믹스가 `OpusAudioEncoder`
  로 들어가 960 샘플 단위 패킷이 되고 남는 꼬리는 마지막에 프리스킵(120 샘플) 이상의 무음으로 채운다.
- 컨테이너(`crates/export/src/webm_out.rs`, `WebmMux`): DocType `webm`, TimestampScale 1 ms, 트랙 1 = `V_VP9`(DefaultDuration = 프레임 길이),
  트랙 2 = `A_OPUS`(CodecPrivate = OpusHead, CodecDelay = 프리스킵 2.5 ms, SeekPreRoll 80 ms). 16 프레임 묶음(`INTERLEAVE`)마다 비디오 패킷과
  그 끝까지의 오디오 패킷을 시각순으로 정렬해 SimpleBlock 으로 쓰고, 클러스터는 1초가 지난 뒤 첫 키프레임에서 새로 연다. Cues(키프레임 위치)와
  SeekHead·Segment 크기·Duration 은 끝에 되돌아가 채운다(`Out` 이 Seek 를 구현하므로 웹의 메모리 출력도 같다).
- 바인딩·화면: 새 API 없음. `packages/editor/src/features/export/presets.ts` 의 `usableFormats` 가 mp4·webm 을 통과시키고,
  `buildUiPresets(presets, format)` 이 형식별 화면 프리셋(WebM 은 1080p·720p·9:16·1:1, 원본 크기 없음)을 만든다. `store.ts` 의 `setFormat` 은
  프리셋을 다시 만들고 파일 이름·저장 경로의 확장자를 `.webm`/`.mp4` 로 바꾼다(`withExtension`). 웹 다운로드 MIME 은 `video/webm`.

### 1.3 사용 방법

1. **파일 > 내보내기...**(Ctrl+M) 에서 **형식** 콤보를 **WebM (VP9 + Opus) (webm)** 으로 바꾼다. 프리셋 콤보가 WebM 프리셋으로 바뀌고 저장
   위치의 확장자가 `.webm` 이 된다.
2. **찾아보기** 는 WebM 필터로 열린다. 웹은 완료되면 `<프로젝트 이름>.webm` 을 내려받는다.
3. Chrome·Firefox·Edge 에서 바로 열린다. Windows 의 "영화 및 TV" 는 VP9 확장이 있을 때만 재생한다(기본 설치에는 없을 수 있다).

### 1.4 실측 (2026-10-14)

WSL2 Linux(코어 수 제한 없음, 다른 Rust 빌드 둘과 동시), 데모 OceanSunset 을 1920x1080 30 fps 편집본에 놓은 18초(540 프레임). 엔진 `jobs.list` 의
`result.seconds` 와 파일 크기. 재현: `WEBM_BENCH=1 npm run test:engine -- export-webm` 또는 `packages/engine/tests/export-webm.test.ts` 의 실측 케이스.

| 프리셋                                    | 걸린 시간 | 속도     | 파일 크기           | 비고                                                       |
| ----------------------------------------- | --------- | -------- | ------------------- | ---------------------------------------------------------- |
| WebM 1080p (Web): VP9 8 Mbps 목표         | 128.6초   | 4.2 fps  | 14.5 MB (6.77 Mbps) | Opus 128 kbps. ffprobe matroska,webm, ffmpeg 디코드 오류 0 |
| High Quality 1080p HD: H.264 20 Mbps 목표 | 27.0초    | 20.0 fps | 12.7 MB (5.91 Mbps) | AAC 320 kbps. 데모 장면이 단순해 VBR 이 5.6 Mbps 만 썼다   |

WebM 은 H.264 보다 약 4.8배 느리고, 이 장면에서는 파일도 14% 크다(VP9 레이트 컨트롤이 목표 8 Mbps 에 맞춰 6.6 Mbps 를 쓴 반면 H.264 는 목표보다
훨씬 낮게 끝났다). 비트레이트를 같은 값으로 주면 크기는 비슷하고 속도 차이만 남는다. 실시간(30 fps)에는 못 미치므로 긴 편집본은 720p 프리셋이 낫다.

### 1.5 제한

- VP9 인코더는 단일 스레드이고 참조 프레임 하나(LAST), 16x16/8x8 블록, 4x4 변환만 쓴다. 1080p 에서 H.264 인코더(멀티 슬라이스)보다 느리다(위 표).
  속도가 필요하면 720p 프리셋을 쓴다. 화질은 같은 비트레이트의 libvpx 보다 낮다(간단한 레이트 컨트롤, 적응 없는 확률 갱신).
- Opus 는 20 ms 고정 프레임, 인밴드 FEC·DTX 없음. 오디오 트랙 끝이 영상보다 최대 20 ms 길 수 있다(패킷 패딩, Matroska DiscardPadding 미기록).
- 알파(투명) 트랙, HDR(PQ/HLG) 신호, 2-pass, 하드웨어 인코딩은 없다. WebM 은 항상 SDR 8비트.
- MP4 안의 VP9/Opus(`vp09`/`Opus` 샘플 엔트리)는 쓰지 않는다. `VideoEncoder::sample_entry` 는 자리만 채운다.

### 1.6 테스트

- `packages/engine/tests/export-webm.test.ts`: `export.formats`·프리셋 목록·`export.resolve`(48 kHz, 2채널, 8 Mbps), 2초 320x180 내보내기를 ffprobe 로
  `matroska,webm`·`vp9`·`opus`·길이·패킷 수 확인, `ffmpeg -v error -i out.webm -f null -` 디코드 오류 0, 무음 내보내기(트랙 1개)와 확장자 붙이기.
  `WEBM_BENCH=1` 이면 1080p 18초 실측도 돈다.
- vendor: `cargo test -p filmcraft-vp9enc -p filmcraft-opusenc`(이식한 왕복 테스트: 우리 디코더·ffmpeg 오라클), `cargo test -p filmcraft-export webm`
  (`webm_export_roundtrip`: 우리 디먹서·디코더로 읽기, Cues, 패킷 수), `cargo test -p filmcraft-engine every_builtin_preset`(WebM 프리셋 두 개를
  ffprobe 로 확인).
- 화면: `packages/editor/test/unit/export/{presets,store,ExportDialog}.test.ts(x)`: 형식 콤보에 WebM, 고르면 확장자 `.webm`, WebM 프리셋 네 가지.

## 2. HEVC(H.265) 소프트웨어 내보내기

### 2.1 개요

형식 콤보에서 **HEVC (mp4)** 를 고르면 MP4 컨테이너에 H.264 대신 H.265(HEVC Main, 8비트 4:2:0)를 담는다. 오디오는 H.264 와 같은 AAC 다.
인코더는 effectcraft 에서 이식한 순수 Rust `filmcraft-hevcenc`(`packages/engine/vendor/filmcraft/crates/hevcenc`, 출처는 `packages/engine/VENDOR.md`)로,
64x64 CTU 의 RDO 코딩 유닛 결정, 35개 인트라 모드, 머지/AMVP 쿼터펠 움직임 보상, DCT/DST, CABAC, 디블로킹 필터를 갖춘 IDR + P 픽처 인코더다.
외부 라이브러리를 링크하지 않으므로 데스크톱(napi)과 웹(wasm)에서 같은 코드가 돈다. 같은 화질에서 파일이 H.264 의 절반 정도이고 iPhone·최신 TV 가
바로 재생한다. macOS 의 VideoToolbox 하드웨어 HEVC 인코더(`crates/platform`)가 등록되어 있으면 그쪽이 먼저 받고, 거절한 설정만 이 인코더가 맡는다.

### 2.2 동작 방식

- 엔진 `export.formats` 의 `{id: "hevc", label: "H.265 (HEVC)", extension: "mp4", available: true, video: true, audio: true}`. 전에는 하드웨어 인코더가
  있을 때만 `available` 이었다(`Format::has_builtin_encoder` 가 HEVC 만 false). 이제 모든 형식이 내장 인코더를 가진다. `export.queue.add`·
  `export.quick`·`export.resolve` 에 `format: "hevc"`(`h265`, `hvc1`, `x265` 도 같다)를 주면 되고 확장자는 `.mp4`(`multiplexer: "mov"` 면 `.mov`).
- 내장 프리셋 두 개(`export.presets.list {format: "hevc"}`): `HEVC 1080p (Half Size)`(1920x1080, VBR 1 pass 12 Mbps 목표·16 Mbps 최대, AAC 320 kbps)와
  `HEVC 2160p 4K`(3840x2160, 36 Mbps 목표·48 Mbps 최대). 비트레이트는 같은 크기의 H.264 프리셋(20·60 Mbps)의 60% 다. H.264 프리셋에 `format: "hevc"`
  만 덮어써도 된다.
- 설정 규칙(`crates/export/src/settings.rs`): H.264 와 같은 계열(`Format::is_h26x`)이라 MP4 면 AAC, 샘플레이트·채널은 H.264 와 같다.
  `bitrateMode: "vbr2Pass"` 는 거부한다(2-pass 는 H.264 만). CBR 과 VBR 1 pass 는 둘 다 인코더의 프레임 단위 레이트 컨트롤(목표 비트레이트, I 픽처는
  P 의 약 4배 비트)로 가고 최대 비트레이트는 쓰지 않는다. 키프레임 간격은 `keyframeDistance`(기본 2초). `quality` 는 쓰지 않는다.
- 인코더 연결(`crates/export/src/lib.rs` 의 `HevcEncoder`·`hevc_factory`): 프레임은 RGBA8 로 렌더되어 H.264 와 같은 `rgba_to_yuv420_8`(BT.709 리미티드,
  rayon 병렬)로 바뀐 뒤 인코더의 u16 평면으로 넓혀 들어간다. 한 프레임에 한 패킷, 재정렬 없음(pts = dts, 편집 목록 없음). 샘플 엔트리는 `hvc1` 이고
  `hvcC`(ISO/IEC 14496-15 8.3.3.1, VPS/SPS/PPS 배열, 4바이트 길이)는 `Encoder::hvcc()` 를 `filmcraft_isobmff::HevcConfig::parse` 해 넣는다.
  HDR 편집본도 HEVC 는 8비트 SDR 로 내보낸다(`job.rs` 의 `hdr_out` 이 HEVC 를 빼므로 BT.709 로 톤매핑된다).
- 컨테이너·오디오·진행률·취소는 H.264 경로(`Exporter`, `Mp4Writer`, AAC)를 그대로 쓴다. 바인딩에 새 API 는 없다.
- 화면: `packages/editor/src/features/export/presets.ts` 의 `usableFormats` 가 `available` 인 mp4 형식을 모두 통과시키므로 HEVC 가 저절로 보인다.
  콤보 이름은 `formatLabel` 이 "H.265 (HEVC)" 를 "HEVC" 로 줄여 "HEVC (mp4)". `buildUiPresets(presets, "hevc")` 는 1080p·720p·9:16·1:1(원본 크기 없음),
  크기를 덮어쓸 때 비트레이트는 `OVERRIDE_KBPS.hevc`(720p 6 Mbps, 세로·정사각 7 Mbps). 확장자는 `.mp4` 그대로라 파일 이름은 바뀌지 않는다.

### 2.3 사용 방법

1. **파일 > 내보내기...**(Ctrl+M) 에서 **형식** 콤보를 **HEVC (mp4)** 로 바꾼다. 프리셋 콤보가 HEVC 프리셋으로 바뀌고 저장 위치는 `.mp4` 그대로다.
2. 나머지는 H.264 와 같다. 결과 줄의 비트레이트가 H.264 프리셋보다 낮게(1080p 12 Mbps) 보이는 것이 정상이다.
3. Windows 의 "영화 및 TV"·"미디어 플레이어" 는 HEVC 비디오 확장이 있을 때 재생한다(Windows 11 은 보통 포함, 없으면 스토어에서 설치). Chrome·Edge 는
   하드웨어 HEVC 디코더가 있는 PC 에서 재생한다. iPhone·macOS·Android 10+ 는 바로 재생한다.

### 2.4 실측 (2026-10-14)

WSL2 Linux(16 코어, 다른 작업 없음), 데모 OceanSunset 을 1920x1080 30 fps 편집본에 놓은 18초(540 프레임). 걸린 시간은 큐에 넣고 끝날 때까지의
벽시계, 파일 크기는 결과 mp4. 재현: `HEVC_BENCH=1 npm run test:engine -- export-hevc --silent=false`(`packages/engine/tests/export-hevc.test.ts` 의
실측 케이스). WebM 행은 1.4절의 같은 날 실측.

| 프리셋                                    | 걸린 시간 | 속도     | 파일 크기           | 비고                                                  |
| ----------------------------------------- | --------- | -------- | ------------------- | ----------------------------------------------------- |
| HEVC 1080p (Half Size): HEVC 12 Mbps 목표 | 236.7초   | 2.3 fps  | 11.1 MB (5.17 Mbps) | AAC 320 kbps. ffprobe hevc Main, ffmpeg 디코드 오류 0 |
| High Quality 1080p HD: H.264 20 Mbps 목표 | 26.3초    | 20.6 fps | 12.7 MB (5.91 Mbps) | AAC 320 kbps. 같은 머신, 바로 이어서                  |
| WebM 1080p (Web): VP9 8 Mbps 목표 (1.4절) | 128.6초   | 4.2 fps  | 14.5 MB (6.77 Mbps) | Opus 128 kbps. 다른 Rust 빌드 둘과 동시에 잰 값       |

HEVC 는 H.264 보다 9배 느리고(단일 스레드 인코더, 실시간의 1/13) 파일은 13% 작다. 데모 장면이 단순해 두 인코더 모두 목표보다 훨씬 낮은 비트레이트로
끝났으므로(HEVC 5.2 Mbps, H.264 5.9 Mbps) "용량 절반" 은 복잡한 실사 장면에서 레이트 컨트롤이 목표에 붙었을 때 기대하는 값이지 이 장면의 실측은
아니다. 긴 편집본은 1080p 가 18초당 4분꼴이므로 720p 프리셋이 낫다.

### 2.5 제한

- 인코더는 단일 스레드다(프레임 안 병렬화 없음, 슬라이스·타일·WPP 없음). 렌더와 색변환은 병렬이지만 인코드가 병목이라 1080p 에서 H.264 인코더
  (멀티 슬라이스)보다 훨씬 느리다(위 표). 긴 편집본은 720p 프리셋이 낫고, 4K 프리셋은 시간이 많이 걸린다.
- 8비트 Main 프로파일만 쓴다. 인코더는 Main 10 도 만들 수 있지만 export 파이프라인이 8비트 RGBA 를 넘기므로 10비트·HDR(PQ/HLG) HEVC 는 없다.
  HDR 편집본은 SDR 로 톤매핑되어 나간다.
- B 픽처·다중 참조·SAO·RDOQ·적응 양자화가 없어 같은 비트레이트에서 x265 보다 화질이 낮다(원본 README 실측: x265 medium 대비 약 12% 큰 파일에 0.2 dB 낮은
  PSNR). 그래도 같은 화질에서 H.264 인코더보다 파일은 작다.
- 레이트 컨트롤은 프레임 단위 목표 비트레이트뿐이라 `maxBitrateKbps`(VBR 최대)와 `quality` 는 무시된다. 2-pass 는 없다.
- 홀수 크기는 인코더가 거부한다(4:2:0 크롭 단위). 프리셋은 모두 짝수이고 화면 프리셋의 크기 덮어쓰기도 짝수다.

### 2.6 테스트

- `packages/engine/tests/export-hevc.test.ts`: `export.formats` 의 hevc `available`·프리셋 목록·`export.resolve`(48 kHz, 2채널, 12 Mbps, 2-pass 거부),
  2초 320x180 내보내기를 ffprobe 로 `hevc`·`Main`·`aac`·길이·패킷 수 확인, `ffmpeg -v error -i out.mp4 -f null -` 디코드 오류 0, 무음 내보내기(트랙 1개)와
  확장자 붙이기. `HEVC_BENCH=1` 이면 1080p 18초 실측(HEVC 와 H.264)도 돈다.
- vendor: `cargo test -p filmcraft-hevcenc`(이식한 왕복 테스트 12개: 우리 `filmcraft-hevc` 디코더와 비트 일치, ffmpeg 오라클 비트 일치, ffprobe 스트림
  정보, hvcC 배치), `cargo test -p filmcraft-export hevc`(`hevc_export_roundtrip`: 우리 디먹서·디코더로 읽기, `hvc1` + `hvcC` 배열 32/33/34, ffprobe
  `hevc,Main,24`), `cargo test -p filmcraft-export h265`(모든 형식이 내장 인코더로 available, 작은 내보내기 성공),
  `cargo test -p filmcraft-engine every_builtin_preset`(HEVC 프리셋 두 개를 ffprobe 로 확인).
- 화면: `packages/editor/test/unit/export/{presets,store,ExportDialog}.test.ts(x)`: 형식 콤보에 HEVC(라벨 "HEVC (mp4)"), 고르면 확장자 `.mp4` 유지와
  HEVC 프리셋 네 가지, `usableFormats`·`formatLabel`.
