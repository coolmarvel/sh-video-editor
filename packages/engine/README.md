# packages/engine

sh-video-editor 의 편집 엔진(Rust). 구조:

```
Cargo.toml            이 워크스페이스(바인딩 + crates/sh-*). vendor 는 exclude
bindings/napi         Node-API 애드온 (@sh-video-editor/engine-node). Electron 이 require
bindings/wasm         wasm-bindgen 크레이트. wasm-pack 이 pkg/ 를 만들고 apps/web 이 import
crates/               우리가 새로 쓰는 엔진 층 (sh-*). 아직 없음
vendor/filmcraft      이식한 기반 엔진 (자기 워크스페이스 유지, ADR-0003, VENDOR.md)
```

명령(저장소 루트에서):

```bash
npm run check:engine        # cargo check (바인딩 + 의존 크레이트)
npm run build:engine:node   # napi .node 빌드 (현재 OS 용)
npm run build:engine:wasm   # wasm-pack build (pkg/)
npm run test                # cargo test (바인딩 워크스페이스)
cd packages/engine/vendor/filmcraft && cargo xtask ci   # 이식 엔진 자체 CI (fmt, clippy, test, assets, layers)
```
