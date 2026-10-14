# CLAUDE.md - sh-video-editor 작업 가이드

이 파일은 **세션이 바뀌어도 맥락을 즉시 복구**하기 위한 진입점이다. Claude Code는 세션 시작 시
이 파일을 자동으로 읽는다. (도구 중립 절대 규칙은 `AGENTS.md`.)

> [project-seed](https://github.com/coolmarvel/project-seed) 에서 2026-10-14 에 생성됨.

## 세션 시작 부팅 프로토콜 (매 세션 첫 작업 전에 반드시 수행)

새 세션에서 작업을 시작하면, **코드를 건드리기 전에** 순서대로:

1. `docs/session-log.md` 읽기 - 마지막으로 무엇을 했고 지금 어디쯤인지 (**진행 이력 SSOT**)
2. `docs/todo.md` 읽기 - 남은 일 (P1~P4)
3. 최근 `docs/plans/*.md` 1개 읽기 - 진행 중 기능의 설계 의도
4. 사용자 피드백 확인: 루트 `feedback/` 에 스크린샷·메모가 있으면 **미처리 피드백**으로 읽는다. 반영한 뒤
   `docs/feedback-archive/YYYY-MM-DD-<주제>/` 로 옮기고 session-log 에 한 줄 남긴다. (`feedback/` 는 gitignore)
5. `git status` 에 모르는 변경이 있으면 session-log 와 대조 - 다른 세션의 흔적일 수 있다. 출처 불명이면 사용자에게 확인.

## 변경 후 자동 규칙 (사용자가 매번 요청하지 않아도 수행)

1. 코드를 바꾸면 **같은 턴에** `docs/session-log.md`(최상단 블록 추가)·`docs/todo.md`
   (+릴리스급이면 `docs/changelog.md`)를 갱신한다. 문서 규칙은 `docs/writing-guide.md`.
2. 검증을 통과하기 전에는 커밋/산출물 전달을 하지 않는다:
   `npm run verify` = prettier check + cargo clippy(바인딩) + 엔진 빌드(napi·wasm) + typecheck + cargo test + 앱 빌드(web·desktop).
   화면을 바꿨으면 `npm run smoke -w apps/desktop`(xvfb) 과 `npm run dev:web` 을 Playwright 로 데스크톱(1440)·모바일(390)
   두 크기에서 확인한다. 이식 엔진(`packages/engine/vendor/filmcraft`)을 고쳤으면 그 안에서 `cargo xtask ci` 도 돌린다.
3. 버전을 판단해 올린다 (아래 "버전 정책"). 루트·apps·packages 의 `package.json` 과 `packages/engine/Cargo.toml` 의
   `workspace.package.version` 을 함께 올린다.
4. 산출물 전달: Windows 인스톨러(`release/SH-Video-Editor-Setup-<v>.exe`)를 바탕화면으로 복사. 웹은 `npm run dev:web`
   또는 `vite preview` 로 localhost 에서 확인시킨다. Windows 용 `.node` 제약은 `docs/guides/packaging.md`.

## 버전 정책 (semver `MAJOR.MINOR.PATCH`)

**MINOR 승격은 사용자만 선언한다.** 에이전트가 판단해서 올리지 않는다.

- **PATCH**: 기본값. 다듬는 중인 기능의 수정 하나 반영할 때마다 +1.
- **MINOR**: 사용자가 "이 기능은 더 수정할 게 없다, 넘어가자"라고 선언한 그 시점에만.
- **MAJOR**: 대규모 재설계/호환 깨짐. 사용자와 상의.

## 커밋 컨벤션

Conventional Commits - `<type>: <한국어 제목>` + 리스트형 본문. 메시지 끝에 `Co-Authored-By` 트레일러.
**검증 통과 후 에이전트가 커밋·푸시한다** (사용자 위임). 파일을 지정해 stage 하고(`git add -A` 금지), git identity 는
전역 설정(coolmarvel)을 그대로 쓴다. 이식 엔진을 고친 커밋은 `engine(vendor):` 접두.

type: `feat` `fix` `refactor` `chore` `docs` `style` `test` `perf` `ci` `build` `revert` `init` `remove` `rename` `hotfix`

## 협업 규칙

- **진행 이력의 SSOT 는 `docs/session-log.md`**: git history 가 아니다 (커밋이 성긴 단위라서).
- 세션이 끊겨도 이어서 작업할 수 있게 **모든 진행 사항을 `docs/` 에 파일로 기록**한다.
- 설계 논쟁이 생기면 `docs/brief.md`(왜/무엇 SSOT)로 돌아와 판정한다. 브리프 밖 기능은 스코프 확인 먼저.
- `.env` 는 직접 수정하지 않는다. `.env.example` 수정 또는 사용자에게 요청 (훅이 차단함).
- 문서·주석·커밋 메시지·UI 문구에 em-dash, 유니코드 화살표, 원문자, 이모지 같은 특수기호를 쓰지 않는다
  (`docs/writing-guide.md` 작성 원칙 8, DESIGN.md 10절).
- 규칙이 미확정이면 이 파일에 `<!-- TODO -->` 로 남기고, 확정되는 순간 채운다.

## 이 프로젝트가 뭔가

CapCut·VLLO·Clideo 처럼 쉬운 영상·오디오 편집기를 전문가급 순수 Rust 엔진 위에 얹어, Windows 데스크톱(Electron)과
웹 브라우저(WASM)에서 **같은 화면 코드**로 제공한다. 파일은 서버에 올리지 않는다. 엔진은 `craft-opensource` 의
filmcraft(Premiere 클린룸 재구현, MIT/Apache)를 저장소 안에 이식해 개선하고, effectcraft(효과·GPU·인코더)와
soundcraft(DSP)를 단계적으로 합친다. v1.0 기준: 1080p 클립 3개 + 자막 + 음악 + 전환 1개를 MP4 로, 데스크톱과
Chrome 에서 같은 결과. 상세는 `docs/brief.md`, 스택은 ADR-0002, 엔진 이식은 ADR-0003.

## 문서 인덱스 (docs/)

| 파일                     | 용도                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `docs/writing-guide.md`  | **문서 지배 규칙** (SSOT·frontmatter·코드 1:1 대조). 문서 쓰기 전 필독                                        |
| `docs/brief.md`          | 프로젝트 **왜/무엇 SSOT**: 킥오프 산출물                                                                      |
| `docs/session-log.md`    | 세션별 진행 이력. **"언제 무슨 일" SSOT** (최신이 위)                                                         |
| `docs/todo.md`           | 미해결·향후 작업만 (P1~P4). 완료분은 session-log 로                                                           |
| `docs/changelog.md`      | 릴리스 단위 사람용 요약                                                                                       |
| `docs/adr/*.md`          | 구조적 결정 기록 - 0001 하네스, 0002 스택, 0003 엔진 이식·라이선스                                            |
| `docs/plans/*.md`        | 앞으로 만들 것 - 0001 MVP 마일스톤 (역할 구분은 `plans/README.md`)                                            |
| `docs/guides/*.md`       | 현재 구현된 동작·코드 위치 - `usage.md` 사용법 SSOT(앱 도움말에 번들), `packaging.md` 인스톨러, `timeline.md` |
| `docs/feedback-archive/` | 처리 완료한 사용자 피드백 보관소                                                                              |

## 자주 쓰는 명령

```bash
npm install
npm run build:engine              # napi .node + wasm pkg. 엔진(Rust)을 고치면 다시
npm run dev:desktop               # Electron 개발 실행 (엔진은 utility process 의 .node, 렌더러와 MessagePort 직결)
npm run dev:web                   # http://localhost:5174 (엔진은 Worker 의 wasm)
npm run verify                    # 전체 검증 (변경 후 자동 규칙 2)
npm run check:engine              # cargo check (빠른 엔진 확인)
npm run smoke -w apps/desktop     # 빌드된 Electron 을 xvfb 로 띄워 엔진 응답 확인
npm run test:unit                 # 화면 단위 테스트(vitest, jsdom). 커버리지 임계는 test:unit:coverage
npm run test:engine               # 엔진 기능 테스트(빌드된 .node·wasm 을 Node 에서, ffmpeg 오라클)
npm run test:e2e:web              # 웹 e2e(Playwright chromium, 1440·390). 포트는 자동, 고정은 SH_E2E_PORT
npm run test:e2e:desktop          # 데스크톱 빌드 + xvfb e2e(app 뒤 recovery 프로젝트)
npm run test:report               # 층별 테스트 수·시간 표(session-log 용). 층·전제는 docs/guides/testing.md
npm run dist:win                  # Windows 인스톨러 (release/)
cd packages/engine/vendor/filmcraft && cargo xtask ci   # 이식 엔진 자체 CI
cd packages/engine/vendor/filmcraft && cargo run -p filmcraft-cli -- commands   # 헤드리스로 커맨드 목록
```

## 코드 지도 (수정 시 어디를 보나)

| 위치                                          | 역할                                                                                                                                                                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine/vendor/filmcraft/crates/`    | 이식한 엔진. `project`(문서 모델) · `edit`(편집 대수) · `render`/`gpu`(합성) · `codecs`+코덱 크레이트 · `export` · `engine`(`Session::execute`, 커맨드 레지스트리 `commands.rs`) · `captions`/`speech` · `platform`(HW 디코드 FFI) |
| `packages/engine/bindings/napi/src/lib.rs`    | Node-API 애드온. `Engine` 클래스(execute, renderFrame, undo...). 편집 로직 없음                                                                                                                                                    |
| `packages/engine/bindings/wasm/src/lib.rs`    | 같은 모양의 wasm 바인딩 + `MemServices`(브라우저 파일 등록)                                                                                                                                                                        |
| `packages/editor/src/engine/bridge.ts`        | 화면이 엔진을 부르는 유일한 인터페이스 `EngineBridge`                                                                                                                                                                              |
| `packages/editor/src/store.ts`                | zustand 상태(버전·커맨드·상태 줄)                                                                                                                                                                                                  |
| `packages/editor/src/shell/`                  | 메뉴바·미디어 패널·모니터·타임라인 (sh-classic 부품 클래스 사용) + `layout.css`                                                                                                                                                    |
| `apps/desktop/src/main/index.ts`              | Electron 메인: `.node` 로드, `engine:*` IPC 핸들러, 창                                                                                                                                                                             |
| `apps/desktop/src/preload/index.ts`           | `window.shEngine` 노출                                                                                                                                                                                                             |
| `apps/desktop/src/renderer/main.tsx`          | preload 를 `EngineBridge` 로 감싸 `App` 마운트                                                                                                                                                                                     |
| `apps/web/src/engine.worker.ts` / `bridge.ts` | Worker 안 wasm 엔진 + 메시지 브리지                                                                                                                                                                                                |
| `design-tokens/css/`                          | sh-classic dark 토큰·부품 CSS. 값은 여기서만, 화면 CSS 는 `--sh-*` 만 쓴다                                                                                                                                                         |

새 편집 기능 추가 = 1) 엔진 커맨드가 이미 있는지 `filmcraft-cli commands` 로 확인, 없으면 `crates/engine` 에 커맨드 추가 2) 바인딩이 새 API 를 노출해야 하면 napi·wasm **둘 다** 같은 모양으로 3) `bridge.ts` 에 메서드 추가, 데스크톱 preload·
웹 worker 에 각각 연결 4) 화면(`packages/editor`)에서 호출 5) `npm run verify` + 스모크.

어기면 재발하는 함정:

- wasm 에서 도는 코드는 `std::time::Instant`·`std::thread`·`std::env::temp_dir` 를 부르면 패닉한다(`web_time`, `filmcraft_engine::temp_dir`).
- napi 의 `i64` 는 JS `number` 로 오고, wasm-bindgen 의 `i64` 는 `BigInt` 로 온다. worker 가 변환한다.
- Windows 인스톨러에는 Windows 용 `.node`(`engine-node.win32-x64-msvc.node`) 가 필요하다. napi 는 windows-gnu 크로스를 지원하지 않는다. 경로는 `docs/guides/packaging.md`.
- Electron 44 에서 utility process 가 `parentPort.postMessage` 로 보내면 main 이벤트 루프가 멈춘다. 자식에서 main 으로는 MessagePortMain 만.
- 엔진 프리셋 이름에 en dash·곱셈 기호가 있다. 코드 리터럴로 적지 말고 id·크기로 고른다.

## 디자인 시스템 (sh-classic)

디자인 레퍼런스: **sh-classic dark** (`sh-design-system` 0.1.1, `sh-ds.json`). oh-my-design 은 쓰지 않는다.
디자인 계약은 루트 **`DESIGN.md`** (프로젝트 소유, 커밋 대상). 색·간격·부품 구조는 거기서만 정하고 코드에 임의 값을
넣지 않는다. 부품 모양은 `design-tokens/css/sh-classic.css`, 화면 배치는 `packages/editor/src/shell/layout.css`.
토큰 갱신: `npx -y github:coolmarvel/sh-design-system update`. 편집기 전용 부품(타임라인 클립, 스크러버)이 필요하면
DESIGN.md 4절에 계약을 먼저 쓰고 만든다.

## 하네스 (Harness Engineering)

지시문이 아니라 시스템으로 제약한다. 도입 근거: `docs/adr/0001-harness-engineering.md`.

| 축                                 | 내용                                                                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hooks (`scripts/hooks/`)           | `env-guard.sh`(.env 편집 차단) · `git-add-guard.sh`(`git add -A/.`·.env staging 차단) · `format.sh`(PostToolUse: ts/js/json/css/md 는 prettier, rs 는 rustfmt, vendor 제외)                                   |
| Settings (`.claude/settings.json`) | `disableRemoteControl: true` + `remoteControlAtStartup: false` + `autoUploadSessions: false` - Claude Code **Remote Control**(로컬 세션을 claude.ai/code 에 동기화) 차단. 세션 중 `/rc` 가 켜져 있으면 끊는다 |
| Commands (`.claude/commands/`)     | `/review-security` · `/deploy-check`                                                                                                                                                                          |
| MCP (`.mcp.json`)                  | `context7`(라이브러리 문서) · `playwright`(브라우저 QA). 엔진 자체 MCP(`filmcraft-cli mcp`)는 헤드리스 검증에 쓸 수 있다(todo P2)                                                                             |
| 엔진 lint                          | 바인딩 워크스페이스 clippy deny(unwrap/expect/panic/todo), `unsafe_code = forbid`(napi 글루만 deny). 이식 엔진은 `cargo xtask ci`                                                                             |
| Skills                             | 없음                                                                                                                                                                                                          |
