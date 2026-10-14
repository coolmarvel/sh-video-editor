# 이식한 엔진 출처 (ADR-0003)

| 저장소      | 상류                                     | 버전                       | 복사일     | 로컬 스냅샷                                        | 이식 범위                                                                                                                                                     |
| ----------- | ---------------------------------------- | -------------------------- | ---------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| filmcraft   | https://github.com/storytold/filmcraft   | 0.2.1 (ROADMAP 2026-10-05) | 2026-10-14 | `~/craft-opensource/filmcraft` (2026-10-08 복사본) | `crates/*`(ui-egui 제외), `apps/filmcraft-cli`, `xtask`, `assets`, `docs`(images·brand 제외)                                                                  |
| effectcraft | https://github.com/storytold/effectcraft | 0.4.0                      | 2026-10-14 | `~/craft-opensource/effectcraft`                   | `crates/vp9enc`, `crates/opusenc`, `crates/hevcenc`, `crates/av1enc` (filmcraft 워크스페이스 안 같은 이름의 `crates/*`). 계획: effects, keyframe, gpu, lottie |
| soundcraft  | https://github.com/storytold/soundcraft  | 0.1.0                      | 2026-10-14 | `~/craft-opensource/soundcraft`                    | `crates/dsp/src/offline.rs` 의 `time_stretch`(WSOLA)만 `filmcraft/crates/audio-dsp/src/timestretch.rs` 로. 나머지(dsp 플러그인, mix)는 미이식                 |

## 이식 시 한 일 (filmcraft)

- `Cargo.toml` 워크스페이스 멤버를 `crates/*`, `apps/filmcraft-cli`, `xtask` 로 줄이고 egui/eframe/rfd 의존 줄을 뺐다.
- `crates/ui-egui`, `apps/filmcraft`, `apps/filmcraft-web`(egui 웹 러너), `docs/images`, `docs/brand`(ArtCraft 상표), `plan/` 은 복사하지 않았다.
- `xtask` 의 `web`·`bench` 서브커맨드는 ui-egui 가 없어 동작하지 않는다. `ci`(fmt, clippy, test, assets, layers, wasm) 의 `wasm` 은
  `WEB_CRATES` 를 비워 L0~L4(`filmcraft-engine` 까지)만 검사한다(2026-10-14, 상류는 ui-egui·filmcraft-web 포함). CI 에서는
  `.github/workflows/ci.yml` 의 `vendor-ci` job 이 nightly·수동으로 돌린다(`docs/guides/testing.md`).
- 커맨드 보강(2026-10-14, `docs/guides/engine-commands.md`): 우리 커맨드는 `crates/engine/src/sh_commands.rs`(+`sh_commands_tests.rs`)
  에 모아 `commands.rs` 의 `build()` 끝에서 등록한다. 상류 파일에 들어간 최소 수정: `crates/edit/src/lib.rs`(고아 전환 정리의 인접성,
  일반 트림 뒤 정리, `remove_transition`, `set_transition_span`), `crates/engine/src/lib.rs`(`History.transaction`, `validate_params`·
  `validate_clips` 호출, 트랜잭션 중 undo 금지), `crates/engine/src/commands.rs`(`with_partners`, `clip.enable`/`clip.link`/`timeline.trim` 의
  `linked`, inspect 파라미터 `{kind, value}`, 입력 검증, 모르는 데모 장면 거부, `file.import` 의 `warnings`), `crates/engine/src/color.rs`
  (`lumetri.applyPreset {replace}`), `crates/render/src/{lib,plan}.rs`(`frame_time`: 역방향 디코드 시각), `crates/media/src/lib.rs`
  (`MediaSource::warnings` 기본 구현), `crates/codecs/src/mp4.rs`(잘린 파일 경고). 상류를 다시 가져올 때 이 목록으로 diff 를 맞춘다.
- wasm 크기(2026-10-14, `docs/guides/wasm-performance.md`): `crates/text/src/fonts.rs` 의 번들 글꼴 `include_bytes!` 를 wasm32 에서는
  Inter Regular 만 남기고 `#[cfg(not(target_arch = "wasm32"))]` 로 뺐다(`HOST_SUPPLIED_FONTS` 목록 추가). 웹 호스트가 같은 파일을
  시작 시 `add_font_data` 로 넣는다. 네이티브는 그대로다.

## 이식 시 한 일 (soundcraft)

- `crates/dsp/src/offline.rs` 의 `time_stretch`(WSOLA, 40 ms Hann 세그먼트·20 ms hop·10 ms 탐색)를 filmcraft `crates/audio-dsp/src/timestretch.rs`
  로 옮겼다(2026-10-14). 원본은 샘플 인덱스의 통짜 버퍼 함수라, 같은 알고리즘을 클립 시작 기준 세그먼트 격자 위에서 블록 단위로
  돌리는 `Stretcher::render`(블록 경계와 무관하게 같은 샘플, 32 세그먼트마다 체인 재동기)를 더했다. Tick 은 호출자(`crates/render/src/audio.rs`)가
  `Tick::to_units_floor(rate)` 로 샘플로 바꿔 넘긴다. 상류 `sane_sr`(1 kHz 미만·비정상 레이트는 48 kHz) 규칙은 `sane_rate` 로 같이 옮겼다.
- 테스트: `crates/dsp/tests/offline_meters.rs` 의 `time_stretch_length_and_pitch` 와 `tests/fuzz.rs` 의 time_stretch 부분을 모듈 테스트로
  옮겼다(proptest 대신 고정 LCG, 스펙트럼 피크는 rustfft 대신 in-crate `fft::Fft`). `pitch_shift`·`resample`(windowed sinc)·플러그인은
  가져오지 않았다(filmcraft 에 `resample.rs` 가 따로 있다).
- 쓰는 곳: `TrackItem.maintain_pitch`(속도 변경 시 음정 유지)가 켜진 정방향 클립의 소리. 역방향은 상류 varispeed 리샘플 그대로.

## 이식 시 한 일 (effectcraft, 2026-10-14: vp9enc·opusenc)

- 원본 `effectcraft/crates/vp9enc`(VP9 인코더, src 2,735줄)·`crates/opusenc`(Opus 인코더, src 5,043줄)를 `vendor/filmcraft/crates/vp9enc`·
  `crates/opusenc` 로 복사했다. 둘 다 의존성 0, `unsafe` 없음, wasm32 빌드 확인. 크레이트 이름만 `effectcraft-*` 를 `filmcraft-*` 로
  바꿨고(`Cargo.toml` 의 name·description, 소스·테스트·README 의 경로 이름), 소스 로직은 그대로다. 라이선스는 `MIT OR Apache-2.0`
  (`Copyright (c) 2026 ArtCraft Team and the EffectCraft contributors`): MIT 전문은 각 크레이트 폴더의 `LICENSE-MIT`(effectcraft 원본,
  저작권 표시만 filmcraft 와 다르다), Apache-2.0 은 `vendor/filmcraft/LICENSE-APACHE` 와 같은 문구라 따로 두지 않았다. 각 크레이트
  README 머리에 출처 블록을 두었고 루트 `NOTICE` 2번 항목에 적었다.
- 테스트 이식: `vp9enc/tests/roundtrip.rs` 는 원본 `effectcraft/crates/export/tests/vp9_roundtrip.rs`(filmcraft-vp9 디코더·ffmpeg 오라클 왕복).
  우리 `filmcraft-vp9` 디코더는 프레임 스레드로 그림을 늦게 내놓으므로 `Decoder::new()` 를 `Decoder::with_threads(1)` 로 바꿨다.
  `opusenc/tests/{modes,ffmpeg}.rs` 는 원본 그대로(`filmcraft-opus` 디코더 왕복, ffmpeg opus·libopus 오라클).
- 워크스페이스: `Cargo.toml` 에 두 크레이트와 `profile.dev.package` opt-level 3, `xtask` LAYERS 에 L0 로 등록, `docs/architecture.md` 1절 표.
- 내보내기 연결(상류 filmcraft 파일 수정): `crates/export/src/lib.rs`(`Format::WebM`, `Vp9Encoder`·`OpusAudioEncoder` + 팩토리,
  `VideoEncoder`/`AudioEncoder` 의 `matroska_codec`), `settings.rs`(`AudioCodec::Opus`, WebM 은 48 kHz·2채널 고정, 요약·추정 크기),
  `presets.rs`(`WebM 1080p (Web)`, `WebM 720p`), `job.rs`(`WebmMux` 분기), 신규 `webm_out.rs`(matroska `MkvWriter` 로 WebM 쓰기).
  먹서는 상류 `crates/matroska/src/mux.rs` 를 그대로 쓴다(이미 EBML·Cluster·Cues·SeekHead 를 쓴다). 가이드: `docs/guides/webm-export.md`.

## 이식 시 한 일 (effectcraft, 2026-10-14: hevcenc)

- 원본 `effectcraft/crates/hevcenc`(HEVC 인코더, src 4,097줄: Main/Main 10 4:2:0, IDR + P 슬라이스, 64x64 CTU RDO, 35 인트라 모드,
  머지/AMVP 쿼터펠 움직임, DCT/DST, CABAC, 디블로킹, 비트레이트/고정 QP)를 `vendor/filmcraft/crates/hevcenc` 로 복사했다. 의존성 0,
  `unsafe` 없음, `std::time`·스레드 없음(wasm32 빌드 확인). vp9enc·opusenc 와 같은 방식: 크레이트 이름만 `effectcraft-hevcenc` 를
  `filmcraft-hevcenc` 로 바꿨고(`Cargo.toml` 의 name·description, 소스 doc 예제·테스트·README 의 경로 이름) 소스 로직은 그대로다.
  라이선스는 `MIT OR Apache-2.0`(MIT 전문 `crates/hevcenc/LICENSE-MIT`, Apache-2.0 은 `vendor/filmcraft/LICENSE-APACHE` 와 같은 문구).
  README 머리에 출처 블록, 루트 `NOTICE` 2번 항목에 추가.
- 테스트 이식: `hevcenc/tests/roundtrip.rs` 는 원본 그대로(우리 `filmcraft-hevc` 디코더 왕복은 비트 일치, ffmpeg 오라클은 Annex-B 디코드
  비트 일치, ffprobe 스트림 정보, 크기·QP 극단·POC 랩·비트레이트 모드·hvcC 배치). ffmpeg·ffprobe 는 원본의 `Command::new("ffmpeg")` 대신
  `filmcraft_testkit::ffmpeg_or_skip`/`ffprobe_or_skip` 로 찾는다(없으면 SKIPPED, `FILMCRAFT_REQUIRE_ORACLES=1` 이면 실패). dev-dependency 에
  `filmcraft-testkit` 추가. `filmcraft-hevc` 디코더는 프레임 스레드가 있어도 테스트가 마지막에 `flush()` 까지 모아 비교하므로 vp9 처럼
  스레드 수를 바꾸지 않았다.
- 워크스페이스: `Cargo.toml` 에 크레이트와 `profile.dev.package` opt-level 3, `xtask` LAYERS 에 L0, `docs/architecture.md` 1절 표.
- 내보내기 연결(상류 filmcraft 파일 수정): `crates/export/src/lib.rs`(`HevcEncoder` + `hevc_factory`: RGBA8 을 `rgba_to_yuv420_8` 로
  8비트 BT.709 리미티드 4:2:0 으로 바꾼 뒤 u16 평면으로 넓혀 넣고, `hvcC` 는 `Encoder::hvcc()` 를 `HevcConfig::parse` 해 `SampleEntry::hevc`
  (`hvc1`)로. `Format::has_builtin_encoder` 는 이제 모든 형식이 true), `settings.rs`(요약 문구에서 "hardware encoder" 제거),
  `presets.rs`(`HEVC 1080p (Half Size)` 12 Mbps, `HEVC 2160p 4K` 36 Mbps: H.264 프리셋의 60%), `settings_tests.rs`(가용성 테스트를 내장
  인코더 기준으로), `tests.rs`(`hevc_export_roundtrip`), `crates/platform/src/hardware_encode.rs`(주석만: HW 가 거절하면 내장 인코더로
  폴백). VideoToolbox HW 인코더 팩토리는 `register_encoder` 로 앞에 끼므로 macOS 에서는 여전히 HW 가 먼저 받는다.
  가이드: `docs/guides/webm-export.md` 의 HEVC 절.

## 이식 시 한 일 (effectcraft, 2026-10-15: av1enc)

- 원본 `effectcraft/crates/av1enc`(AV1 인코더, src 8,808줄 중 tables.rs 4,805줄: Main 프로파일 8/10비트 4:2:0, KEY + INTER 프레임(LAST 참조 하나),
  64x64 슈퍼블록을 8x8 까지 RDO 분할, 인트라 DC/V/H/Paeth/smooth, 정수+하프+쿼터펠 움직임 탐색과 규격 MV 예측 스택, DCT/ADST 4..32, 멀티심볼
  산술 코더와 CDF 적응, 디블로킹 필터(프레임 단위 레벨 탐색), 타일 1개, 비트레이트/고정 q)를 `vendor/filmcraft/crates/av1enc` 로 복사했다.
  의존성 0, `unsafe` 없음, `std::time`·스레드 없음(wasm32 빌드 확인). hevcenc 와 같은 방식: 크레이트 이름만 `effectcraft-av1enc` 를
  `filmcraft-av1enc` 로 바꿨고(`Cargo.toml` 의 name·description, 테스트·README 의 경로 이름) 소스 로직은 그대로다. 라이선스는
  `MIT OR Apache-2.0`(MIT 전문 `crates/av1enc/LICENSE-MIT`, Apache-2.0 은 `vendor/filmcraft/LICENSE-APACHE` 와 같은 문구). README 머리에 출처
  블록, 루트 `NOTICE` 2번 항목에 추가.
- 테스트 이식: `av1enc/tests/{common/mod.rs,roundtrip.rs,ffmpeg_oracle.rs,bench.rs}` 는 원본 그대로(우리 `filmcraft-av1` 디코더 왕복은 비트 일치
  8개, ffmpeg libdav1d 오라클 비트 일치 2개(1080p 포함), bench 4개는 `--ignored`). ffmpeg 는 원본의 `Command::new("ffmpeg")` 대신
  `filmcraft_testkit::ffmpeg_or_skip` 로 찾고 libdav1d 디코더가 없으면 SKIPPED(`FILMCRAFT_REQUIRE_ORACLES=1` 이면 실패). dev-dependency 에
  `filmcraft-testkit` 추가. 왕복 테스트는 원본처럼 `Decoder::with_threads(1)` 을 쓴다(패킷마다 그림 하나).
- 워크스페이스: `Cargo.toml` 에 크레이트와 `profile.dev.package` opt-level 3, `xtask` LAYERS 에 L0, `docs/architecture.md` 1절 표.
- 내보내기 연결(상류 filmcraft 파일 수정): `crates/export/src/lib.rs`(`Format::Av1`(id `av1`, 확장자 mp4, 라벨 "AV1"), `Format::is_mp4_video`
  (H.264·HEVC·AV1: MP4/MOV + AAC 계열. `is_h26x` 는 그대로 두고 MP4 판정 네 곳만 바꿨다), `Av1Encoder` + `av1_factory`: RGBA8 을 `rgba_to_yuv420_8`
  로 8비트 BT.709 리미티드 4:2:0 으로 바꾼 뒤 u16 평면으로 넓혀 넣고, 샘플 엔트리는 `av01` + `av1C`(`Encoder::av1c()` 를 `Av1Config::parse`),
  WebM 이면 `V_AV1` + CodecPrivate = av1C), `settings.rs`(`WebmVideoCodec {vp9, av1}` 과 `ExportSettings.video_codec`(JSON `videoCodec`, WebM 전용,
  기본 vp9), AV1 의 AAC·확장자·요약 "AV1 Main"·컨테이너 MP4), `presets.rs`(`AV1 1080p` 10 Mbps, `AV1 720p` 5 Mbps: H.264 의 50%), `job.rs`(`stepped`,
  MP4 브랜드), `tests.rs`(`av1_export_roundtrip`, `webm_av1_export_roundtrip`), `settings_tests.rs`(`Format::ALL` 16개, `av1_is_a_format_with_a_builtin_encoder`),
  `crates/engine/src/export_tools.rs`(플랫 파라미터 `videoCodec`), `crates/engine/src/export_tests.rs`(프리셋 전수 ffprobe 에 `av1` 분기).
  `vp9_factory` 는 `video_codec == vp9` 일 때만 받으므로 기존 WebM 경로는 그대로다. 가이드: `docs/guides/webm-export.md` 의 AV1 절.

## 상류 갱신

자동 동기화하지 않는다. 상류에서 가져올 수정은 사람이 diff 를 보고 골라 넣고, 이 표의 버전·복사일을 갱신한다.
