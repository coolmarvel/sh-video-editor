# SH Video Editor (sh-video-editor)

CapCut·VLLO·Clideo 처럼 쉬운 영상·오디오 편집기. 전문가급 순수 Rust 엔진(filmcraft 이식) 위에 React 화면을 얹어
**Windows 데스크톱(Electron)** 과 **웹 브라우저(WASM)** 에서 같은 편집기를 제공한다. 파일은 서버에 올리지 않는다.

## 구조

```
apps/desktop          Electron 셸. packages/editor 를 띄우고 @sh-video-editor/engine-node(napi) 로 엔진을 부른다
apps/web              Vite 웹 셸. 같은 packages/editor 를 띄우고 Worker 안의 WASM 엔진을 부른다
packages/editor       공유 React 화면. 엔진은 EngineBridge 인터페이스로만 만진다
packages/engine       Rust 엔진. bindings/{napi,wasm} + vendor/filmcraft (ADR-0003)
design-tokens/css     sh-classic dark 테마 토큰·부품 CSS (sh-design-system 에서 설치, DESIGN.md 가 계약)
docs/                 brief(왜/무엇), adr(결정), plans(앞으로), guides(현재 동작), session-log(이력), todo
```

## 개발

```bash
npm install
npm run build:engine          # napi .node + wasm pkg (처음 한 번, 엔진을 고쳤을 때)
npm run dev:desktop           # Electron 개발 실행
npm run dev:web               # http://localhost:5174
npm run verify                # lint(prettier+clippy) + 엔진 빌드 + typecheck + cargo test + 앱 빌드
npm run dist:win              # Windows NSIS 인스톨러 (docs/guides/packaging.md 의 네이티브 엔진 제약 참고)
```

## 문서

- `docs/brief.md` 왜/무엇 SSOT · `docs/adr/0002-stack.md` 스택 · `docs/adr/0003-engine-vendoring.md` 엔진 이식과 라이선스
- `docs/plans/0001-mvp.md` 마일스톤 · `docs/session-log.md` 진행 이력 · `CLAUDE.md` 에이전트 작업 가이드

## 라이선스

© 2026 이성현 (SeongHyun Lee). All rights reserved. 전문은 `LICENSE`. 포함된 오픈소스(filmcraft 등, MIT OR Apache-2.0)의
고지는 `NOTICE`.
