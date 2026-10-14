---
title: 데스크톱 인스톨러 패키징 (SH Video Editor)
created: 2026-10-14
updated: 2026-10-14
domain: packaging
---

# 데스크톱 인스톨러 패키징 (exe / dmg)

발사대 `guides/desktop-packaging.md`(Electron 실릴리스에서 검증된 규칙)를 이 프로젝트 값으로 구체화한 것이다.

## 이 프로젝트 값

| 항목                 | 값                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 위치                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| 제품명               | SH Video Editor                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `apps/desktop/package.json` `build.productName`           |
| appId                | `seonghyunlee.shvideoeditor` (바꾸지 않는다, 바꾸면 업그레이드·제거가 깨진다)                                                                                                                                                                                                                                                                                                                                                                                      | 같은 파일                                                 |
| 저작권               | Copyright © 2026 이성현 (SeongHyun Lee)                                                                                                                                                                                                                                                                                                                                                                                                                            | `build.copyright`                                         |
| 라이선스 동의 페이지 | `apps/desktop/build/license.txt` (루트 `LICENSE` 복사본)                                                                                                                                                                                                                                                                                                                                                                                                           | `build.nsis.license`                                      |
| 오픈소스 고지        | 루트 `NOTICE` 를 `resources/NOTICE` 로 동봉                                                                                                                                                                                                                                                                                                                                                                                                                        | `build.extraResources`                                    |
| Windows 산출물       | `release/SH-Video-Editor-Setup-<v>.exe` (ASCII 파일명)                                                                                                                                                                                                                                                                                                                                                                                                             | `build.nsis.artifactName`                                 |
| 네이티브 엔진        | `*.node` 는 asar 밖으로(`asarUnpack`). Windows 패키지는 Windows 용 `.node` 만(`build.win.files`)                                                                                                                                                                                                                                                                                                                                                                   | `build.asarUnpack`, `build.win.files`                     |
| 아이콘               | 원본 `apps/desktop/build/icon.svg` 하나. `npm run icons`(`scripts/gen-icons.mjs`, sharp)가 `build/icon.ico`(16·24·32·48·64·128 BMP + 256 PNG)·`build/icon.png`(512)·`build/icons/<크기>.png`·웹 `apps/web/public/{favicon.ico,icon.svg,icon-192.png,icon-512.png}` 를 만든다. 산출물은 커밋. exe·인스톨러·제거기 아이콘은 `win.icon`·`nsis.installerIcon/uninstallerIcon/installerHeaderIcon`, 창 좌측 상단은 exe 리소스(Windows)·`BrowserWindow.icon`(개발·Linux) | `build.win.icon`, `build.nsis.*Icon`, `src/main/index.ts` |
| Electron 버전        | `build.electronVersion` 에 고정(44.7.2). electron-builder 는 범위(`^44`)를 못 읽는다. electron 을 올리면 같이 올린다                                                                                                                                                                                                                                                                                                                                               | `build.electronVersion`                                   |

## 명령

```bash
npm run build:engine:node        # 현재 OS 용 .node (WSL 에서는 Linux 용. 개발·스모크 전용)
npm run build:win -w @sh-video-editor/engine-node   # Windows PC 에서: engine-node.win32-x64-msvc.node
npm run dist:win                 # = apps/desktop: Windows .node 확인 + electron-vite build + 난독화 + electron-builder --win (NSIS)
npm run smoke -w apps/desktop    # xvfb 로 띄워 엔진 응답(utility process + 렌더러 직접 포트 + 크래시 재시작) 확인 (Linux)
npm run icons                    # 루트: icon.svg 에서 ico/png 산출물 재생성 (멱등, 아이콘을 고치면 다시)
```

## Windows 용 네이티브 엔진 (핵심 제약)

exe 안에 들어갈 `.node` 는 **Windows 용으로 빌드한 것**이어야 한다. WSL 에서 만든 Linux `.node` 를 넣으면
사용자 PC 에서 로드 실패한다. 2026-10-14 검증 결과 되는 경로는 두 가지다. windows-gnu 크로스는 안 된다(아래 기록).

### 경로 1 (기본): WSL 에서 cargo-xwin 으로 msvc 타깃 크로스 빌드

LLVM 의 `clang-cl`·`lld-link` 와 cargo-xwin(Windows SDK·CRT 를 Microsoft 에서 받아 캐시) 으로 WSL 에서 바로 msvc 애드온을 만든다.
sudo 없이 되고, 2026-10-14 에 이 경로로 `engine-node.win32-x64-msvc.node`(31MB, PE32+ DLL) 를 2분 52초에 만들었다.

준비(한 번):

```bash
rustup target add x86_64-pc-windows-msvc
cargo install cargo-xwin                 # ~/.cargo/bin/cargo-xwin
# LLVM 공식 바이너리를 ~/.local/llvm 에 푼다 (clang-cl, lld-link, llvm-lib 가 bin/ 에 있어야 한다). 2026-10-14 는 LLVM 23.1.3
#   gh release download llvmorg-23.1.3 --repo llvm/llvm-project --pattern 'LLVM-23.1.3-Linux-X64.tar.xz' && tar -xJf ... --strip-components=1
```

빌드:

```bash
export PATH=$HOME/.local/llvm/bin:$PATH
npm run build:win:xwin -w @sh-video-editor/engine-node   # = napi build --release --target x86_64-pc-windows-msvc -x
npm run dist:win                                          # check:win-engine 통과 후 NSIS exe
```

첫 실행 때 cargo-xwin 이 Windows SDK/CRT 를 내려받는다(수백 MB, `~/.cache/cargo-xwin`). 메모리 7GB 환경에서는
`CARGO_BUILD_JOBS=6` 정도로 돌린다. 실제 Windows PC 에서 로드·동작 검증은 이 파일 아래 "실기 검증" 에 기록한다.

### 경로 2: Windows PC 에서 msvc 로 빌드 (경로 1 이 막힐 때)

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
- 반면 msvc 타깃은 cargo-xwin 이 `clang-cl` 로 C 코드(napi 의 delay-load 훅)를, `lld-link` 로 링크를 맡아 통과한다(경로 1).
- 참고로 filmcraft `platform` 크레이트(Media Foundation/D3D11, `windows` 0.62) 자체는 gnu 타깃에서 컴파일된다
  (`cargo check --target x86_64-pc-windows-gnu -p filmcraft-platform` 통과. 링크는 mingw 가 없어 미검증).

### Windows 하드웨어 디코드 (Media Foundation) 가 애드온에 들어 있다

napi 바인딩은 Windows·macOS 타깃에서만 `filmcraft-platform` 에 의존하고(`bindings/napi/Cargo.toml` 의
`[target.'cfg(any(target_os = "windows", target_os = "macos"))'.dependencies]`), `Engine::new`·`engineVersion()`·
`hardwareDecoder()` 가 프로세스에서 한 번 `filmcraft_platform::register()` 를 불러 OS 디코더 팩토리를 엔진 코덱 앞에
둔다. Linux 는 의존하지 않아 Linux `.node` 는 전과 같다. 등록은 팩토리 포인터를 두는 것뿐이라 장치를 만들지 않으며,
하드웨어가 못 받는 스트림(필드 코딩 H.264, 4:2:2, 8192 초과, DXVA 가 없는 GPU, HEVC/VP9/AV1 확장이 없는 Windows)은
자체 디코더로 간다(`HybridDecoder`, 중간 실패도 소프트웨어로 이어 감). 설정 Playback 의 Hardware decoding 이 Off 면
전부 자체 디코더.

2026-10-14 cargo-xwin 크로스 빌드 결과(경로 1, LLVM 23.1.3, `CARGO_BUILD_JOBS=3`, 다른 빌드와 동시):

- 링크 통과, 5분 35초, `engine-node.win32-x64-msvc.node` 31,489,536 바이트(PE32+ DLL). `windows` 크레이트의 import lib
  (`windows_x86_64_msvc`) 를 lld-link 가 그대로 받았고 오류·경고 없음.
- 애드온이 import 하는 DLL: `d3d11.dll`(`D3D11CreateDevice`), `dxgi.dll`, `combase.dll`, `ole32.dll`, `oleaut32.dll`,
  `kernel32.dll`, `ntdll.dll`, `bcryptprimitives.dll`, `VCRUNTIME140.dll` + UCRT api-set(`api-ms-win-crt-*`).
  `mfplat.dll` 은 import 가 아니라 실행 시 `LoadLibrary` 로 연다(Windows "N" 에디션에서도 로드되고 소프트웨어 디코드).
  NVENC(`nvEncodeAPI64.dll`)도 실행 시 로드.
- 확인 명령: `~/.local/llvm/bin/llvm-readobj --coff-imports engine-node.win32-x64-msvc.node`.
- `engineVersion()` 은 `sh-video-engine <v> (base filmcraft 0.2.1; hw: Media Foundation)` 처럼 끝에 등록된 백엔드를 적는다
  (Linux 는 `hw: none`). `hardwareDecoder()` 는 그 이름 또는 null. 실제로 하드웨어가 쓰였는지는 엔진 커맨드
  `perf.stats` 의 `decode.hardware`(frames, software frames, sessions, declined, fallbacks)로 본다.
- Windows 실기 동작은 미확인(아래 표). `VCRUNTIME140.dll` 은 Electron 자체도 쓰는 Visual C++ 2015-2022 런타임이라 새 요구는 아니다.

### 실기 검증

| 날짜       | 빌드 경로                                                          | Electron | 결과                                                                                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-14 | 경로 1 (cargo-xwin, LLVM 23.1.3)                                   | 44.7.2   | 빌드·패키징 성공. 사용자 Windows PC 에서 실행 확인 대기                                                                                                                                                                                                                                      |
| 2026-10-14 | 경로 1 + `filmcraft-platform`(Media Foundation 디코드, NVENC) 링크 | 44.7.2   | 크로스 빌드 성공(31.5MB). 실기 대기: 앱에서 `engineVersion()` 이 `hw: Media Foundation` 인지, 1080p H.264 클립 재생 뒤 `perf.stats` 의 `decode.hardware.frames` 가 0 보다 큰지, HEVC(iPhone) 파일이 열리는지(HEVC Video Extensions 없으면 자체 디코더), N 에디션·GPU 없는 VM 에서도 켜지는지 |

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
