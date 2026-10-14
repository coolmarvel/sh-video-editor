---
title: 데스크톱 인스톨러 패키징 (SH Video Editor)
created: 2026-10-14
updated: 2026-10-14
domain: packaging
---

# 데스크톱 인스톨러 패키징 (exe / dmg)

발사대 `guides/desktop-packaging.md`(Electron 실릴리스에서 검증된 규칙)를 이 프로젝트 값으로 구체화한 것이다.

## 이 프로젝트 값

| 항목                 | 값                                                                                                                   | 위치                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 제품명               | SH Video Editor                                                                                                      | `apps/desktop/package.json` `build.productName` |
| appId                | `seonghyunlee.shvideoeditor` (바꾸지 않는다, 바꾸면 업그레이드·제거가 깨진다)                                        | 같은 파일                                       |
| 저작권               | Copyright © 2026 이성현 (SeongHyun Lee)                                                                              | `build.copyright`                               |
| 라이선스 동의 페이지 | `apps/desktop/build/license.txt` (루트 `LICENSE` 복사본)                                                             | `build.nsis.license`                            |
| 오픈소스 고지        | 루트 `NOTICE` 를 `resources/NOTICE` 로 동봉                                                                          | `build.extraResources`                          |
| Windows 산출물       | `release/SH-Video-Editor-Setup-<v>.exe` (ASCII 파일명)                                                               | `build.nsis.artifactName`                       |
| 네이티브 엔진        | `*.node` 는 asar 밖으로(`asarUnpack`). Windows 패키지는 Windows 용 `.node` 만(`build.win.files`)                     | `build.asarUnpack`, `build.win.files`           |
| 아이콘               | 아직 없음(todo P2). 넣을 때 `build/icon.ico`·`build/icon.png` + `win.icon`/`nsis.installerIcon`                      |                                                 |
| Electron 버전        | `build.electronVersion` 에 고정(44.7.2). electron-builder 는 범위(`^44`)를 못 읽는다. electron 을 올리면 같이 올린다 | `build.electronVersion`                         |

## 명령

```bash
npm run build:engine:node        # 현재 OS 용 .node (WSL 에서는 Linux 용. 개발·스모크 전용)
npm run build:win -w @sh-video-editor/engine-node   # Windows PC 에서: engine-node.win32-x64-msvc.node
npm run dist:win                 # = apps/desktop: Windows .node 확인 + electron-vite build + 난독화 + electron-builder --win (NSIS)
npm run smoke -w apps/desktop    # xvfb 로 띄워 엔진 응답(utility process + 렌더러 직접 포트 + 크래시 재시작) 확인 (Linux)
```

## Windows 용 네이티브 엔진 (핵심 제약)

exe 안에 들어갈 `.node` 는 **Windows 용으로 빌드한 것**이어야 한다. WSL 에서 만든 Linux `.node` 를 넣으면
사용자 PC 에서 로드 실패한다. 2026-10-14 에 두 경로를 검증한 결과, **Windows PC 에서 msvc 로 빌드**하는 것만 된다.

### 결론: Windows 에서 빌드한다 (절차)

1. Windows PC 에 설치: Rust(`rustup`, 기본 툴체인 `stable-x86_64-pc-windows-msvc`), Visual Studio Build Tools
   ("C++ 를 사용한 데스크톱 개발" 워크로드, Windows 10/11 SDK 포함), Node 22 LTS.
2. 저장소를 받고(`git clone`, 또는 WSL 경로 `\\wsl$\...` 를 쓰지 말고 Windows 디스크로 복사) 루트에서 `npm ci`.
3. `npm run build:win -w @sh-video-editor/engine-node`
   (= `napi build --platform --release --target x86_64-pc-windows-msvc`). 산출물 `packages/engine/bindings/napi/engine-node.win32-x64-msvc.node`.
   첫 빌드는 엔진 전체(약 30만 줄, release + thin LTO)라 수십 분 걸린다.
4. 그 파일을 WSL 저장소의 `packages/engine/bindings/napi/` 에 복사한다(`*.node` 는 gitignore 라 커밋되지 않는다).
5. WSL 에서 `npm run dist:win`. `scripts/check-win-engine.cjs` 가 먼저 그 파일이 있는지 확인하고 없으면 이 절차를 안내하며
   멈춘다(`SH_ALLOW_MISSING_WIN_ENGINE=1` 은 패키징 배선 점검용. 그 산출물은 사용자 PC 에서 엔진 로드에 실패한다).

플랫폼별 `.node` 선택은 napi 가 생성한 `index.js` 가 한다(`process.platform`/`arch` 로 `engine-node.win32-x64-msvc.node` 를
고른다). 같은 디렉토리에 Linux 용 `.node` 가 함께 있어도 되지만, electron-builder 설정(`build.win.files`)이 Windows 패키지에서
`*.linux-*.node`·`*.darwin-*.node` 를 빼므로 exe 에는 Windows 용만 들어간다. `*.node` 는 `asarUnpack` 으로 asar 밖에 둔다.
엔진은 `out/main/engine-host.js`(utility process)가 `require` 하므로, 이 파일과 `node_modules/@sh-video-editor/engine-node` 가
패키지에 있어야 한다(`files: out/**/*` + 의존성 자동 포함).

### 검증 기록: WSL 크로스 빌드(x86_64-pc-windows-gnu)는 안 된다

- `rustup target add x86_64-pc-windows-gnu` 는 된다(sudo 불필요). mingw-w64 링커(`x86_64-w64-mingw32-gcc`)는 설치되어 있지 않고
  `sudo apt install gcc-mingw-w64-x86-64` 가 필요하다(이 검증에서는 설치하지 않았다).
- 막히는 지점은 링커 이전이다. `cargo check --target x86_64-pc-windows-gnu -p sh-video-engine-node` 가 `napi` v3.14.2 의
  빌드 스크립트에서 실패한다: `napi-build` 2.6.0 `src/windows.rs` 의 `setup_gnu()` 가 `libnode.dll` 을 찾아
  (`LIBNODE_PATH`/`LIBPATH`/`PATH`) `cargo:rustc-link-lib=node` 를 내고, 없으면 패닉한다.
  오류 원문: `thread 'main' panicked at napi-build-2.6.0/src/windows.rs:15:5: libnode.dll not found in any search path`.
- gnu 타깃에서는 애드온이 `libnode.dll` 을 import 하도록 링크된다. Electron 은 Node-API 심볼을 `electron.exe` 가 export 하고
  msvc 애드온은 지연 로드 훅으로 그걸 받으므로, `libnode.dll` 을 구해 링크해도 Electron 안에서는 그 DLL 이 없어 로드에 실패한다.
  `@napi-rs/cli` 3.10.8 도 windows-gnu 를 크로스 컴파일(`--cross-compile`) 대상에서 제외하고 같은 `libnode.dll` 요구를 안내한다.
- 참고로 filmcraft `platform` 크레이트(Media Foundation/D3D11, `windows` 0.62) 자체는 gnu 타깃에서 컴파일된다
  (`cargo check --target x86_64-pc-windows-gnu -p filmcraft-platform` 통과. 링크는 mingw 가 없어 미검증). 현재 napi 바인딩은
  `filmcraft-platform` 에 의존하지 않아(`register()` 를 부르는 곳은 filmcraft-cli 뿐) Windows HW 디코드는 아직 바인딩에 안 들어 있다.
  넣을 때도 빌드는 위 msvc 절차 그대로다(`windows` 크레이트는 msvc 에서 import lib 를 자체 제공).

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
