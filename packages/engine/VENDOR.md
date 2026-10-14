# 이식한 엔진 출처 (ADR-0003)

| 저장소      | 상류                                     | 버전                       | 복사일     | 로컬 스냅샷                                        | 이식 범위                                                                                                                                             |
| ----------- | ---------------------------------------- | -------------------------- | ---------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| filmcraft   | https://github.com/storytold/filmcraft   | 0.2.1 (ROADMAP 2026-10-05) | 2026-10-14 | `~/craft-opensource/filmcraft` (2026-10-08 복사본) | `crates/*`(ui-egui 제외), `apps/filmcraft-cli`, `xtask`, `assets`, `docs`(images·brand 제외)                                                          |
| effectcraft | https://github.com/storytold/effectcraft | 0.4.0                      | 2026-10-14 | `~/craft-opensource/effectcraft`                   | `crates/vp9enc`, `crates/opusenc` (filmcraft 워크스페이스 안 `crates/vp9enc`·`crates/opusenc`). 계획: effects, keyframe, gpu, lottie, hevcenc, av1enc |
| soundcraft  | https://github.com/storytold/soundcraft  | 0.1.0                      | 2026-10-14 | `~/craft-opensource/soundcraft`                    | `crates/dsp/src/offline.rs` 의 `time_stretch`(WSOLA)만 `filmcraft/crates/audio-dsp/src/timestretch.rs` 로. 나머지(dsp 플러그인, mix)는 미이식         |

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

## 상류 갱신

자동 동기화하지 않는다. 상류에서 가져올 수정은 사람이 diff 를 보고 골라 넣고, 이 표의 버전·복사일을 갱신한다.
