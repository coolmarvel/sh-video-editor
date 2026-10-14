# 이식한 엔진 출처 (ADR-0003)

| 저장소      | 상류                                     | 버전                       | 복사일     | 로컬 스냅샷                                        | 이식 범위                                                                                    |
| ----------- | ---------------------------------------- | -------------------------- | ---------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| filmcraft   | https://github.com/storytold/filmcraft   | 0.2.1 (ROADMAP 2026-10-05) | 2026-10-14 | `~/craft-opensource/filmcraft` (2026-10-08 복사본) | `crates/*`(ui-egui 제외), `apps/filmcraft-cli`, `xtask`, `assets`, `docs`(images·brand 제외) |
| effectcraft | https://github.com/storytold/effectcraft | 0.4.0                      | 미이식     | `~/craft-opensource/effectcraft`                   | 계획: effects, keyframe, gpu, lottie, hevcenc, av1enc, vp9enc, opusenc                       |
| soundcraft  | https://github.com/storytold/soundcraft  | 0.1.0                      | 미이식     | `~/craft-opensource/soundcraft`                    | 계획: dsp, mix                                                                               |

## 이식 시 한 일 (filmcraft)

- `Cargo.toml` 워크스페이스 멤버를 `crates/*`, `apps/filmcraft-cli`, `xtask` 로 줄이고 egui/eframe/rfd 의존 줄을 뺐다.
- `crates/ui-egui`, `apps/filmcraft`, `apps/filmcraft-web`(egui 웹 러너), `docs/images`, `docs/brand`(ArtCraft 상표), `plan/` 은 복사하지 않았다.
- `xtask` 의 `web`·`bench` 서브커맨드는 ui-egui 가 없어 동작하지 않는다. `ci`(fmt, clippy, test, assets, layers, wasm) 중 `wasm` 은
  `WEB_CRATES` 가 ui-egui 를 가리키므로 손봐야 한다(todo P2).

## 상류 갱신

자동 동기화하지 않는다. 상류에서 가져올 수정은 사람이 diff 를 보고 골라 넣고, 이 표의 버전·복사일을 갱신한다.
