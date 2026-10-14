---
title: 데스크톱 인스톨러 패키징 (SH Video Editor)
created: 2026-10-14
updated: 2026-10-14
domain: packaging
---

# 데스크톱 인스톨러 패키징 (exe / dmg)

발사대 `guides/desktop-packaging.md`(Electron 실릴리스에서 검증된 규칙)를 이 프로젝트 값으로 구체화한 것이다.

## 이 프로젝트 값

| 항목                 | 값                                                                                              | 위치                                            |
| -------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 제품명               | SH Video Editor                                                                                 | `apps/desktop/package.json` `build.productName` |
| appId                | `seonghyunlee.shvideoeditor` (바꾸지 않는다, 바꾸면 업그레이드·제거가 깨진다)                   | 같은 파일                                       |
| 저작권               | Copyright © 2026 이성현 (SeongHyun Lee)                                                         | `build.copyright`                               |
| 라이선스 동의 페이지 | `apps/desktop/build/license.txt` (루트 `LICENSE` 복사본)                                        | `build.nsis.license`                            |
| 오픈소스 고지        | 루트 `NOTICE` 를 `resources/NOTICE` 로 동봉                                                     | `build.extraResources`                          |
| Windows 산출물       | `release/SH-Video-Editor-Setup-<v>.exe` (ASCII 파일명)                                          | `build.nsis.artifactName`                       |
| 네이티브 엔진        | `*.node` 는 asar 밖으로(`asarUnpack`)                                                           | `build.asarUnpack`                              |
| 아이콘               | 아직 없음(todo P2). 넣을 때 `build/icon.ico`·`build/icon.png` + `win.icon`/`nsis.installerIcon` |                                                 |

## 명령

```bash
npm run build:engine:node        # 현재 OS 용 .node (WSL 에서는 Linux 용. 개발·스모크 전용)
npm run dist:win                 # = apps/desktop: electron-vite build + 난독화 + electron-builder --win (NSIS)
npm run smoke -w apps/desktop    # xvfb 로 띄워 엔진 응답 확인 (Linux)
```

## Windows 용 네이티브 엔진 (핵심 제약)

exe 안에 들어갈 `.node` 는 **Windows 용으로 빌드한 것**이어야 한다. WSL 에서 만든 Linux `.node` 를 넣으면
사용자 PC 에서 로드 실패한다. 선택지:

1. **Windows 에서 빌드** (권장, 확실): Windows 에 Rust(msvc)·Node 를 두고 `npm run build:win -w @sh-video-editor/engine-node`
   로 `engine-node.win32-x64-msvc.node` 를 만든 뒤 `npm run dist:win`.
2. **WSL 크로스 빌드**: `rustup target add x86_64-pc-windows-gnu` + mingw-w64, `napi build --target x86_64-pc-windows-gnu`.
   filmcraft `platform` 크레이트의 Media Foundation FFI 가 gnu 툴체인에서 링크되는지 검증이 필요하다(todo P1).

둘 중 하나가 검증되면 이 절을 갱신한다. 검증 전에는 "WSL 에서 exe 굽기"가 아직 안 된다고 보면 된다.

## 배포 소스 보호

`apps/desktop/scripts/obfuscate.cjs` 가 `out/` 의 JS 를 난독화한다(`controlFlowFlattening`·`deadCodeInjection`·
`selfDefending`·`debugProtection` OFF, `identifierNamesGenerator: hexadecimal`, `stringArray` 0.6).
`bytecodePlugin` 은 쓰지 않는다(WSL 빌드 exe 가 Windows 에서 `cachedDataRejected` 크래시). 엔진은 네이티브 바이너리라
별도 보호가 필요 없다.

## 공통 규칙 (발사대 가이드 요약)

- 릴리스 전 `npm run verify` 통과가 먼저다.
- `release/` 는 gitignore. 설치 파일을 git 에 커밋하지 않는다. 공개 배포는 GitHub Release 자산으로, 파일명은 ASCII.
- macOS dmg 는 맥에서만 굽는다(`dist:mac:arm64` / `dist:mac:x64`, 내부 번들 이름 ASCII). 이 프로젝트는 macOS 를
  마일스톤 3 으로 미뤘다.
- 코드 서명(Authenticode)은 인증서가 있을 때만. 없으면 SmartScreen "알 수 없는 게시자" 경고가 뜬다(설치는 됨).
