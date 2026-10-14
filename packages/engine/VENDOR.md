# 이식한 엔진 출처 (ADR-0003)

| 저장소      | 상류                                     | 버전                       | 복사일     | 로컬 스냅샷                                        | 이식 범위                                                                                    |
| ----------- | ---------------------------------------- | -------------------------- | ---------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| filmcraft   | https://github.com/storytold/filmcraft   | 0.2.1 (ROADMAP 2026-10-05) | 2026-10-14 | `~/craft-opensource/filmcraft` (2026-10-08 복사본) | `crates/*`(ui-egui 제외), `apps/filmcraft-cli`, `xtask`, `assets`, `docs`(images·brand 제외) |
| effectcraft | https://github.com/storytold/effectcraft | 0.4.0                      | 미이식     | `~/craft-opensource/effectcraft`                   | 계획: effects, keyframe, gpu, lottie, hevcenc, av1enc, vp9enc, opusenc                       |
| soundcraft  | https://github.com/storytold/soundcraft  | 0.1.0                      | 미이식     | `~/craft-opensource/soundcraft`                    | 계획: dsp, mix                                                                               |

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

## 상류 갱신

자동 동기화하지 않는다. 상류에서 가져올 수정은 사람이 diff 를 보고 골라 넣고, 이 표의 버전·복사일을 갱신한다.
