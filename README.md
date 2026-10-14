# SH Video Editor (sh-video-editor)

CapCut·VLLO·Clideo 처럼 쉬운 영상·오디오 편집기. 전문가급 순수 Rust 엔진(filmcraft 이식) 위에 React 화면을 얹어
**Windows 데스크톱(Electron)** 과 **웹 브라우저(WASM)** 에서 같은 편집기를 제공한다. 파일은 서버에 올리지 않는다.

## 기능

- **미디어**: 영상·사진·음악 가져오기(끌어다 놓기, 파일 대화상자), 폴더, 썸네일, 다중 선택, 우클릭 메뉴, 데모 영상 6종
- **타임라인**: 영상 3트랙 + 음성 3트랙, 자르기·이동·트림·삭제·리플·삽입·스냅, 줌, 트랙 잠금·숨김·음소거, Alt 드래그로 영상·소리 한쪽만, 우클릭 메뉴
- **미리보기**: 프레임 정확 재생, 배속 0.25x ~ 4x, J/K/L 셔틀, 스크러버, 소리 재생과 마스터 볼륨, 화면 크기에 맞춘 자동 렌더 배율
- **텍스트·자막**: 텍스트 클립(Pretendard 번들, 프리셋 4종, 9칸 위치, 외곽선·배경·그림자), 자막 트랙과 SRT 가져오기·내보내기
- **전환 12종**: 디졸브·페이드·밀기·슬라이드·휩·줌 블러·글리치·빛 번짐·와이프·크로스 줌, 끌어다 놓기와 길이 핸들
- **효과·색·필터**: 효과 9종(밝기와 대비, 흐림, 선명하게, 비네팅, 모자이크, 흑백, 색조, 노이즈, 그림자), 색 보정 5축, 필터 23종, 비교(원본 보기)
- **속도**: 0.1x ~ 10x, 역방향, 보간 3종, 프리즈 프레임
- **오디오**: 클립 볼륨·음소거, 페이드 인·아웃, 음성 구간 자동 낮춤(덕킹), 파형, 소리 분리·다시 연결, 소리로 싱크 맞추기, 음악 탭
- **화면 비율**: 16:9, 9:16, 1:1, 4:5 변환(채우기·맞추기)과 SNS 프리셋(YouTube, Shorts/Reels, Instagram)
- **내보내기**: H.264 MP4 프리셋 5종, 진행률·남은 시간·취소 (데스크톱)
- **프로젝트**: `.fcproj` 저장·열기, 자동 저장과 크래시 복구, 실행 취소·다시 실행, 엔진 프로세스 자동 재시작 (데스크톱)
- **웹**: 같은 화면을 브라우저에서. 파일은 브라우저 안에서만 읽는다(저장·내보내기는 준비 중)

## 시작하기

Windows 설치본 `release/SH-Video-Editor-Setup-<버전>.exe` 를 실행한다(`npm run dist:win` 으로 만든다). 웹은 `npm run dev:web` 뒤
`http://localhost:5174`.

첫 영상 네 단계:

1. **미디어 가져오기**: 미디어 패널의 **가져오기** 버튼이나 파일 끌어다 놓기. 파일이 없으면 **데모 영상** 버튼.
2. **타임라인에 넣기**: 항목을 타임라인으로 끌어다 놓거나 더블클릭. 편집본은 자동으로 만들어진다.
3. **자르고 다듬기**: 플레이헤드를 옮기고 **자르기**(Ctrl+K), 클립 양 끝을 끌어 길이 조절, Delete 로 삭제.
4. **내보내기**: **파일 > 내보내기...**(Ctrl+M)에서 프리셋과 저장 위치를 고르고 MP4 로 저장.

전체 사용법(화면 구성, 자막·전환·효과·속도·비율·음악·싱크 절차, 단축키, 막힐 때, 데스크톱·웹 차이)은
[`docs/guides/usage.md`](docs/guides/usage.md). 앱 안의 **도움말 > 사용 안내** 와 첫 화면 안내 카드의 **자세히** 가 같은 문서를 보인다.

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
npm run test:unit             # 화면 단위 테스트(vitest). test:engine, test:e2e:web, test:e2e:desktop 도 있다
npm run dist:win              # Windows NSIS 인스톨러 (docs/guides/packaging.md 의 네이티브 엔진 제약 참고)
```

## 문서

- `docs/guides/usage.md` 사용법 · `docs/guides/timeline.md` 타임라인 구현 · `docs/guides/packaging.md` 인스톨러
- `docs/brief.md` 왜/무엇 SSOT · `docs/adr/0002-stack.md` 스택 · `docs/adr/0003-engine-vendoring.md` 엔진 이식과 라이선스
- `docs/plans/0001-mvp.md` 마일스톤 · `docs/plans/0002-feature-roadmap.md` 로드맵 · `docs/session-log.md` 진행 이력 · `CLAUDE.md` 에이전트 작업 가이드

## 라이선스

© 2026 이성현 (SeongHyun Lee). All rights reserved. 전문은 `LICENSE`. 포함된 오픈소스(filmcraft 등, MIT OR Apache-2.0)의
고지는 `NOTICE`.
