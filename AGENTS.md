# AGENTS.md - sh-video-editor

이 파일은 **모든 AI 코딩 에이전트**(Claude Code, Codex, Cursor, Copilot 등)를 위한 진입점이다.
도구에 상관없이 아래 규칙을 따른다. Claude Code 전용 상세(부팅 프로토콜·하네스)는 `CLAUDE.md`.

## 이 프로젝트가 무엇인가

CapCut 식 영상·오디오 편집기. 순수 Rust 엔진(filmcraft 이식, `packages/engine`)을 Electron+React 데스크톱(`apps/desktop`,
napi 애드온)과 웹(`apps/web`, WASM Worker)이 같은 화면(`packages/editor`)으로 쓴다. 디자인은 sh-classic dark.
저장은 프로젝트 JSON + SQLite 캐시(데스크톱)/OPFS(웹). 상세: `docs/brief.md`, ADR-0002, ADR-0003.

## 절대 규칙 (위반 금지)

1. **작업 전에 읽는다**: `docs/session-log.md`(진행 이력 SSOT), `docs/todo.md`, 최근 `docs/plans/*` 1개 순서로.
2. **코드를 바꾸면 같은 턴에 문서를 갱신한다**: session-log 최상단 블록 + todo. 규칙은 `docs/writing-guide.md`.
3. **검증 없이 전달하지 않는다**: `npm run verify` 통과가 커밋 메시지 작성의 전제.
4. **`.env` 를 직접 수정하지 않는다.** `.env.example` 수정 또는 사용자에게 요청.
5. **`git add -A` / `git add .` 금지.** 파일을 지정해서 stage 한다. 검증 통과 후 에이전트가 커밋·푸시한다(사용자 위임).
6. **스택·구조 변경은 ADR 로**: 구조적 결정은 `docs/adr/NNNN-*.md` 에 근거와 함께 기록한다.
7. **버전의 MINOR 승격은 사용자 선언이 있을 때만.**
8. **브리프가 판정 기준**: 설계 논쟁·스코프 논쟁은 `docs/brief.md` 로 돌아와 판정한다.
9. **엔진 우선**: 편집 로직은 엔진 커맨드로만. 바인딩·화면에 편집 로직을 두지 않는다. 엔진 규칙은 `packages/engine/AGENTS.md`.
10. **특수기호 금지**: 문서·주석·커밋·UI 문구에 em-dash, 유니코드 화살표, 원문자, 이모지를 쓰지 않는다.

## 커밋 컨벤션

Conventional Commits - `<type>: <한국어 제목>` + 리스트형 본문 + `Co-Authored-By` 트레일러.
type: feat, fix, refactor, chore, docs, style, test, perf, ci, build, revert, init, remove, rename, hotfix.

## 더 읽을 것

- `CLAUDE.md` - 부팅 프로토콜, 변경 후 자동 규칙, 코드 지도, 하네스 상세
- `docs/brief.md` - 왜/무엇 SSOT · `docs/writing-guide.md` - 문서 규칙
