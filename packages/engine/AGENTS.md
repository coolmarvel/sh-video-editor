# packages/engine 규칙 (filmcraft AGENTS.md 계승, ADR-0003)

이 디렉토리의 Rust 코드에는 루트 `AGENTS.md` 에 더해 아래가 적용된다. `vendor/filmcraft/AGENTS.md` 전문이 원본이다.

1. **Never crash.** 비테스트 코드에서 `unwrap/expect/panic/todo/unimplemented/unreachable` 금지(워크스페이스 clippy deny).
   입력에서 온 숫자는 전부 적대적으로 다룬다(`get()`, `checked_*`, 할당 상한, 0 나눗셈 금지). 워커는 `catch_unwind`.
2. **`unsafe` 금지**(`unsafe_code = "forbid"`). 예외는 `vendor/filmcraft/crates/platform` 과, napi-derive 가 생성하는 FFI 글루 때문에 `deny` 로 둔 `bindings/napi`(우리 코드에는 unsafe 없음) 둘.
3. **클린룸.** GPL/LGPL 코드(ffmpeg, x264, x265 ...) 복사·링크 금지. 코덱은 공개 스펙으로만. ffmpeg 는 테스트 오라클로만.
   의존성은 permissive 라이선스만.
4. **엔진 우선.** 모든 편집 동작은 커맨드(`Session::execute(id, params)`)로 들어간다. 바인딩(napi/wasm)은 얇은 층이고
   편집 로직을 갖지 않는다. 새 기능은 엔진 커맨드로 먼저 만들고 화면은 그것을 부른다.
5. **계층.** L0(코덱·기초) 에서 L4(engine) 까지는 wasm32 로 빌드돼야 한다. OS 의존 코드는 `platform` 또는 바인딩에만.
6. **CPU 레퍼런스 + GPU 패리티.** GPU 경로를 추가하면 CPU 결과와의 패리티 테스트를 함께 둔다.
7. **에셋.** Adobe·CapCut 등 타사 아이콘·폰트·템플릿·스크린샷 금지. 모든 에셋은 `.attribution` 사이드카 + `ATTRIBUTION.md`.
8. **vendor 는 상류 diff 를 보존한다.** `vendor/filmcraft` 수정은 필요한 최소로 하고 커밋 메시지에 `engine(vendor):` 를 붙인다.
   포맷 훅은 vendor 를 건드리지 않는다.
