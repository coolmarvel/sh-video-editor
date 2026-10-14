---
title: WebM(VP9/Opus) 내보내기
created: 2026-10-14
updated: 2026-10-14
domain: engine
---

# WebM(VP9/Opus) 내보내기

## 개요

내보내기 형식 콤보에서 **WebM (VP9 + Opus)** 을 고르면 MP4(H.264/AAC) 대신 WebM 파일을 만든다. 브라우저(Chrome, Firefox, Edge)가
플러그인 없이 재생하고 같은 화질에 H.264 보다 파일이 작다. 인코더는 effectcraft 에서 이식한 순수 Rust `filmcraft-vp9enc`(VP9 프로파일 0,
8비트 4:2:0)와 `filmcraft-opusenc`(Opus 48 kHz, 20 ms 패킷), 먹서는 상류 filmcraft 의 `filmcraft-matroska` `MkvWriter` 다. 외부 라이브러리를
링크하지 않으므로 데스크톱(napi)과 웹(wasm)에서 같은 코드가 돈다. 로드맵 M3-5 의 WebM 절반(HEVC 는 별도).

## 동작 방식

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

## 사용 방법

1. **파일 > 내보내기...**(Ctrl+M) 에서 **형식** 콤보를 **WebM (VP9 + Opus) (webm)** 으로 바꾼다. 프리셋 콤보가 WebM 프리셋으로 바뀌고 저장
   위치의 확장자가 `.webm` 이 된다.
2. **찾아보기** 는 WebM 필터로 열린다. 웹은 완료되면 `<프로젝트 이름>.webm` 을 내려받는다.
3. Chrome·Firefox·Edge 에서 바로 열린다. Windows 의 "영화 및 TV" 는 VP9 확장이 있을 때만 재생한다(기본 설치에는 없을 수 있다).

## 실측 (2026-10-14)

WSL2 Linux(코어 수 제한 없음, 다른 Rust 빌드 둘과 동시), 데모 OceanSunset 을 1920x1080 30 fps 편집본에 놓은 18초(540 프레임). 엔진 `jobs.list` 의
`result.seconds` 와 파일 크기. 재현: `WEBM_BENCH=1 npm run test:engine -- export-webm` 또는 `packages/engine/tests/export-webm.test.ts` 의 실측 케이스.

| 프리셋                                    | 걸린 시간 | 속도     | 파일 크기           | 비고                                                       |
| ----------------------------------------- | --------- | -------- | ------------------- | ---------------------------------------------------------- |
| WebM 1080p (Web): VP9 8 Mbps 목표         | 128.6초   | 4.2 fps  | 14.5 MB (6.77 Mbps) | Opus 128 kbps. ffprobe matroska,webm, ffmpeg 디코드 오류 0 |
| High Quality 1080p HD: H.264 20 Mbps 목표 | 27.0초    | 20.0 fps | 12.7 MB (5.91 Mbps) | AAC 320 kbps. 데모 장면이 단순해 VBR 이 5.6 Mbps 만 썼다   |

WebM 은 H.264 보다 약 4.8배 느리고, 이 장면에서는 파일도 14% 크다(VP9 레이트 컨트롤이 목표 8 Mbps 에 맞춰 6.6 Mbps 를 쓴 반면 H.264 는 목표보다
훨씬 낮게 끝났다). 비트레이트를 같은 값으로 주면 크기는 비슷하고 속도 차이만 남는다. 실시간(30 fps)에는 못 미치므로 긴 편집본은 720p 프리셋이 낫다.

## 제한

- VP9 인코더는 단일 스레드이고 참조 프레임 하나(LAST), 16x16/8x8 블록, 4x4 변환만 쓴다. 1080p 에서 H.264 인코더(멀티 슬라이스)보다 느리다(위 표).
  속도가 필요하면 720p 프리셋을 쓴다. 화질은 같은 비트레이트의 libvpx 보다 낮다(간단한 레이트 컨트롤, 적응 없는 확률 갱신).
- Opus 는 20 ms 고정 프레임, 인밴드 FEC·DTX 없음. 오디오 트랙 끝이 영상보다 최대 20 ms 길 수 있다(패킷 패딩, Matroska DiscardPadding 미기록).
- 알파(투명) 트랙, HDR(PQ/HLG) 신호, 2-pass, 하드웨어 인코딩은 없다. WebM 은 항상 SDR 8비트.
- MP4 안의 VP9/Opus(`vp09`/`Opus` 샘플 엔트리)는 쓰지 않는다. `VideoEncoder::sample_entry` 는 자리만 채운다.

## 테스트

- `packages/engine/tests/export-webm.test.ts`: `export.formats`·프리셋 목록·`export.resolve`(48 kHz, 2채널, 8 Mbps), 2초 320x180 내보내기를 ffprobe 로
  `matroska,webm`·`vp9`·`opus`·길이·패킷 수 확인, `ffmpeg -v error -i out.webm -f null -` 디코드 오류 0, 무음 내보내기(트랙 1개)와 확장자 붙이기.
  `WEBM_BENCH=1` 이면 1080p 18초 실측도 돈다.
- vendor: `cargo test -p filmcraft-vp9enc -p filmcraft-opusenc`(이식한 왕복 테스트: 우리 디코더·ffmpeg 오라클), `cargo test -p filmcraft-export webm`
  (`webm_export_roundtrip`: 우리 디먹서·디코더로 읽기, Cues, 패킷 수), `cargo test -p filmcraft-engine every_builtin_preset`(WebM 프리셋 두 개를
  ffprobe 로 확인).
- 화면: `packages/editor/test/unit/export/{presets,store,ExportDialog}.test.ts(x)`: 형식 콤보에 WebM, 고르면 확장자 `.webm`, WebM 프리셋 네 가지.
