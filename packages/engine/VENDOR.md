# 이식한 엔진 출처 (ADR-0003)

| 저장소      | 상류                                     | 버전                       | 복사일     | 로컬 스냅샷                                        | 이식 범위                                                                                                                                     |
| ----------- | ---------------------------------------- | -------------------------- | ---------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| filmcraft   | https://github.com/storytold/filmcraft   | 0.2.1 (ROADMAP 2026-10-05) | 2026-10-14 | `~/craft-opensource/filmcraft` (2026-10-08 복사본) | `crates/*`(ui-egui 제외), `apps/filmcraft-cli`, `xtask`, `assets`, `docs`(images·brand 제외)                                                  |
| effectcraft | https://github.com/storytold/effectcraft | 0.4.0                      | 미이식     | `~/craft-opensource/effectcraft`                   | 계획: effects, keyframe, gpu, lottie, hevcenc, av1enc, vp9enc, opusenc                                                                        |
| soundcraft  | https://github.com/storytold/soundcraft  | 0.1.0                      | 2026-10-14 | `~/craft-opensource/soundcraft`                    | `crates/dsp/src/offline.rs` 의 `time_stretch`(WSOLA)만 `filmcraft/crates/audio-dsp/src/timestretch.rs` 로. 나머지(dsp 플러그인, mix)는 미이식 |

## 이식 시 한 일 (filmcraft)

- `Cargo.toml` 워크스페이스 멤버를 `crates/*`, `apps/filmcraft-cli`, `xtask` 로 줄이고 egui/eframe/rfd 의존 줄을 뺐다.
- `crates/ui-egui`, `apps/filmcraft`, `apps/filmcraft-web`(egui 웹 러너), `docs/images`, `docs/brand`(ArtCraft 상표), `plan/` 은 복사하지 않았다.
- `xtask` 의 `web`·`bench` 서브커맨드는 ui-egui 가 없어 동작하지 않는다. `ci`(fmt, clippy, test, assets, layers, wasm) 중 `wasm` 은
  `WEB_CRATES` 가 ui-egui 를 가리키므로 손봐야 한다(todo P2).
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

## 상류 갱신

자동 동기화하지 않는다. 상류에서 가져올 수정은 사람이 diff 를 보고 골라 넣고, 이 표의 버전·복사일을 갱신한다.
