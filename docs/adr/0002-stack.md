---
title: ADR-0002 스택·저장·디자인 선택
created: 2026-10-14
status: accepted
---

# ADR-0002: 스택·저장·디자인 선택

## 상태

Accepted (2026-10-14, 킥오프 위저드에서 사용자가 선택)

## 맥락

CapCut 류의 쉬운 영상 편집기를 데스크톱(Windows 먼저)과 웹 양쪽에서 같은 화면으로 제공해야 한다.
편집 엔진은 `craft-opensource` 의 filmcraft(순수 Rust, 자체 코덱)를 토대로 저장소 안에서 개선한다(ADR-0003).
성능(미리보기 지연, 내보내기 속도)이 중요하고, 혼자 개발하므로 화면 코드는 한 벌이어야 한다.

## 결정

| 항목          | 선택                                                                                                                                     | 위저드에서 제시했던 다른 후보                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 유형          | 창이 있는 데스크톱 앱 + 같은 편집기의 웹 버전                                                                                            | CLI, 트레이 상주                                                       |
| 화면          | Electron + React 18 + TypeScript. 빌드 electron-vite, 패키징 electron-builder(NSIS exe)                                                  | Tauri 2 + React, Rust 단일(egui 개편)                                  |
| 웹            | Vite + React. 같은 `packages/editor` 를 번들, 엔진은 WASM(wasm-bindgen) + WebCodecs 하드웨어 디코드                                      | 별도 저장소(pdf-editor-live 방식)                                      |
| 엔진          | filmcraft 전체 + effectcraft 이펙트·GPU·인코더 + soundcraft DSP 를 `packages/engine` 에 Rust 소스로 복사해 개선                          | git rev 고정 의존, filmcraft-cli 사이드카                              |
| 엔진 연결     | 데스크톱: napi-rs 네이티브 애드온(`.node`), 프레임은 ArrayBuffer 로 전달. 웹: wasm-bindgen                                               | 사이드카 프로세스 + 공유 메모리                                        |
| 저장          | 프로젝트는 JSON 파일(filmcraft `.fcproj` 봉투·마이그레이션 체인 계승). 데스크톱 캐시(미디어 목록·썸네일·프록시·최근)는 SQLite, 웹은 OPFS | 파일만, SQLite 전부                                                    |
| 디자인        | sh-classic (sh-design-system, css + dark 테마). oh-my-design 미사용                                                                      | oh-my-design 레퍼런스(Linear/Figma/Fluent/Toss), Fluent UI 킷, 최소 UI |
| 대상 OS       | Windows 먼저(Media Foundation/D3D11 HW 디코드), macOS 는 다음                                                                            | Windows+macOS 동시, Windows 만                                         |
| 저장소 구조   | npm workspaces 모노레포: `apps/desktop`, `apps/web`, `packages/editor`, `packages/engine`                                                | 데스크톱·웹 저장소 분리                                                |
| 패키지 매니저 | npm                                                                                                                                      | pnpm                                                                   |

## 근거

- **Electron + React**: 사용자가 CapCut 식 UI 를 웹 기술로 자유롭게 만들고 싶어 했고, 웹 버전과 화면 코드를
  공유하려면 렌더러가 브라우저 기술이어야 한다. electron-builder 는 WSL 에서 Windows exe 크로스 빌드가
  검증돼 있다(`docs/guides/packaging.md`). Tauri 는 Windows 빌드를 Windows 에서 해야 하고, egui 는
  소비자용 UI 에 맞지 않아 제외했다.
- **napi-rs**: 프레임을 프로세스 안에서 바로 넘기므로 사이드카(JSON 직렬화 + 공유 메모리 관리)보다 미리보기
  지연이 작고 코드가 단순하다. 엔진 크래시 격리는 Electron utility process 에 엔진을 올려 해결한다.
- **엔진 소스 복사**: 사용자 결정. "링크보다 소스로 두고 개선"이 목적이며, Craft 앱들 자체가
  "저장소끼리 코드를 의존성으로 공유하지 않고 복사한다"는 원칙으로 만들어졌다(ADR-0003).
- **JSON 프로젝트 + SQLite 캐시**: 프로젝트 파일은 사람이 읽고 백업·공유하기 쉬워야 하며 filmcraft 의
  원자적 저장·자동 저장 링·크래시 저널을 그대로 쓴다. 미디어 라이브러리는 항목이 수천 개가 되면 파일 스캔이
  느려 SQLite 가 맞다. 웹은 파일시스템이 없어 OPFS.
- **sh-classic**: 사용자 소유 디자인 시스템이고 dark 테마가 있어 편집기 작업화면에 쓸 수 있다.
  외부 브랜드 레퍼런스를 쓰지 않아 상표·에셋 리스크가 없다.
- **Windows 먼저**: 사용자의 전달 채널이 Windows 바탕화면 인스톨러다. filmcraft 의 HW 디코드는 macOS 가
  중심이라 Windows(Media Foundation) 경로를 우리가 먼저 검증해야 한다.

## 결과

- 좋음: 화면 코드 한 벌로 데스크톱·웹 동시 제공. 엔진이 저장소 안에 있어 효과·코덱을 직접 고친다.
- 부담: Rust 빌드 시간(엔진 약 30만 줄). 네이티브 애드온은 Electron 의 Node ABI 에 맞춰 빌드해야 하고,
  WASM 은 단일 스레드·메모리 4GiB 한계 안에서 동작해야 한다.
- 검증 명령·전달 방식은 `CLAUDE.md` "변경 후 자동 규칙"에 둔다.
