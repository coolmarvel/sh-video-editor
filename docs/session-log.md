---
title: 세션 로그
created: 2026-10-14
updated: 2026-10-15
domain: development
---

# 세션 로그 (최신이 위)

이 파일이 **"언제 무슨 일이 있었나"의 SSOT**다. 세션마다 최상단에 블록 추가.
(커밋은 검증 통과 후 에이전트가, 성긴 단위. git history 를 이력 SSOT 로 삼지 않는다.)

블록 형식: `## YYYY-MM-DD - 제목` 아래에 **요청/피드백, 수정, 검증, 다음** 순서로 간결하게.

## 2026-10-15 - CI 웹 e2e 실패 수정 (ffmpeg, 보고서 폴더)

- **상황**: 0.1.8·0.1.9 푸시의 GitHub Actions 가 web job 에서 실패했다(다른 job 은 통과). 로컬 검증은 통과했기에 놓쳤다: 푸시 뒤 CI 결과를
  확인하지 않고 끝냈다. 사용자가 "중간에 멈춘 건가?" 로 물어 확인하며 발견.
- **원인**: web-files e2e "가져온 파일 보관" 이 시험 영상을 ffmpeg 로 만드는데 CI web job 에 ffmpeg 가 없었다(`spawnSync ffmpeg ENOENT`,
  1440·390 각 1건). 덤으로 Playwright HTML 보고서 폴더가 결과 폴더 안(`e2e/.results/report`)이라 "folder clashes" 경고.
- **수정**: ci.yml web job 에 ffmpeg 설치 단계, 웹·데스크톱 보고서 폴더를 `e2e/.report` 로(.gitignore, CI 아티팩트 경로에 추가).
- **검증**: `CI=1` 로 웹 web-files e2e 5 통과(skip 1 큰 파일), 데스크톱 e2e 7 통과, 경고 없음. 푸시 뒤 GitHub Actions 결과 확인.

## 2026-10-15 - UI 다듬기: 선명한 굵은 글씨(sh-design-system 0.1.2), 일시·줄바꿈, 토스트, 제목 줄 (사용자 피드백 3장, v0.1.9)

- **요청/피드백**: `docs/feedback-archive/2026-10-15-ui-typography/`(한글 화면 비교, 복구 대화상자, 복구 뒤 토스트·자막 탭). 굵은 글씨 번짐,
  `(yyyy-mm-dd hh:mm:ss)` 가 줄바꿈으로 갈림, 토스트 닫기 크기·낱말 중간 줄바꿈, 혼자 붕 뜬 흰 제목 줄. 디자인 시스템 원천을 고칠지는 먼저
  확인받기로 했고, 사용자가 "원천도 바꾸기" 를 골랐다.
- **수정**:
  - sh-design-system 0.1.2(c781d3c, 그 저장소에서 검증·푸시): `font.family.ui` 를 돋움 우선에서 맑은 고딕 우선으로(돋움 제거, 굵은 글꼴이 없어
    Windows 가 굵게 흉내 내 번짐), `ui-skia` 는 같은 값으로 유지, pacsplus 테마는 굴림 유지, ADR-0004. 편집기는 토큰 갱신으로 받음(바뀐 것은
    글꼴 두 줄뿐).
  - ui-polish(커밋 2d41610·fef932f·08b7d17): 편집기 크롬 뿌리(.ve-root)에만 font-synthesis: none. 일시는 datetime.ts formatDateTime 하나로
    yyyy-mm-dd hh:mm:ss(웹 복구는 시:분, 최근 목록은 오늘이면 시각만이던 것), 괄호 일시는 StampText 로 줄바꿈하지 않는 덩어리. 토스트
    word-break break-all 을 keep-all 로, 닫기는 16px X 아이콘. 엔진 영어 토스트 17종 번역표(engine-messages.ts)와 key 중복 접기(복구 뒤 영어·
    한국어 두 개와 영어 상태 줄), Untitled 는 어디서나 제목 없음. 데스크톱 창은 titleBarOverlay(투명 면) + shell/TitleBar(아이콘 + 창 가운데
    제목, 메뉴바와 선 없이 한 덩어리, DESIGN.md 4.26). 자막 탭은 접힌 도구 줄이 sh-classic 고정 높이에 눌려 "음성 정리" 와 겹치던 것, 라벨 칸
    48 에서 64 + nowrap. 템플릿 색 매트 이름 "색 배경", 시작 알림 조사. 인스펙터 탭 7개 x 2폭 겹침·접힘 검사 0.
  - 병합 뒤: 미디어 패널 탭 여섯 개 중 "템플릿" 이 1440 창에서 둘째 줄로 떨어지던 것(원래 있던 접기 규칙)을 탭 좌우 여백 16 에서 8 로 줄여
    1440·1280·390 모두 한 줄(DESIGN.md 4.4 에 규칙). 전사 탭 e2e 충돌은 두 쪽 기대를 합침. 피드백 3장은 보관소로.
- **병합 뒤 검증(v0.1.9, main)**: prettier, clippy, 엔진 빌드(napi·wasm·speech-wasm), typecheck, cargo test(바인딩), 단위 770, 엔진 기능 210, 워크플로 회귀 11.0초, 앱 빌드,
  웹 e2e 159 통과(skip 5, 실패 0, 9.3분, 1440·390), 데스크톱 스모크(687 커맨드)·e2e 7(제목 줄 검사 포함), 미디어 탭 한 줄은 1440·1280·390 에서 탭
  위치로 확인. Windows 엔진 0.1.9 크로스 빌드, 인스톨러 0.1.9(122.7MB)를 바탕화면 `seonghyun` 폴더에(0.1.8 제거). Windows 글꼴·창 버튼은 실기 확인 필요.
- **다음**: Windows 실기에서 글꼴·제목 줄 확인(todo P1). 다른 앱(SH Compositor 등)도 `npx -y github:coolmarvel/sh-design-system update` 로
  같은 글꼴을 받을 수 있다.

## 2026-10-15 - 리팩토링·성능, P1 네 건(키프레임 조회, 전환 JSON, 웹 미디어 보관, whisper 창), 웹 자동 자막 (v0.1.8)

- **요청**: 리팩토링으로 ms 를 줄이고 중복·안 쓰는 코드·주석을 정리한 뒤 다음 todo 구현. 기능은 하나도 깨지지 않고 더 빨라져야 한다.
- **방법**: 워크트리 3개(refactor-cleanup TS 전용, engine-perf Rust, web-files) 뒤에 whisper-fix. Rust 빌드는 둘까지만 동시에. 모든 변경은 바꾸기
  전후 같은 테스트와 수치로 확인하고, 빨라지지 않는 변경은 되돌린다. 병합 순서 cleanup, web-files, engine-perf, whisper. 병합 충돌은 로드맵
  M4-4 한 줄(두 메모 합침). worktree 끼리 git stash 가 공유되어 cleanup 이 web-files 의 stash 를 잠깐 꺼낸 일이 있어 stash 금지.
- **수정**:
  - refactor-cleanup(TS 만, 커밋 7c03c6c·d604a26·8c638aa·3c42046·637ce6d·c253056·42ae4f1): knip(테스트·e2e 를 진입점에 넣은 임시 설정)으로
    안 쓰는 barrel 4개 삭제, 기능 index.ts 재수출을 쓰는 것만 남김(탭 등록 부수효과 유지), 다른 곳이 안 쓰는 export 약 160개 해제, 죽은 선언 4개
    삭제. jscpd 0.67% 중 실제 중복만: errors.ts errorMessage(19벌 + 인라인 12곳), shell/Dialog.tsx(대화상자 13개, DOM 그대로), framesToTimecode,
    apps/web/src/idb.ts. runRecipe 가 카탈로그 확인 대신 withTransaction 으로(템플릿 만들기가 실행 취소 한 단계, 실패하면 묶음 취소). SttSection
    셀렉터가 편집본이 없을 때 매번 새 [] 를 돌려 무한 갱신하던 것 수정(테스트가 고치기 전 실패). 데스크톱 렌더러가 1.41MB 였던 원인은 난독화가
    아니라 electron-vite 가 압축을 안 해서: minify + 이름 mangled 로 1,420KB(gzip 383) 에서 925KB(gzip 289), xvfb 5회 중앙값 "준비됨"
    193~194ms 에서 180~190ms. P1 키프레임: 목록을 inspect 마다 effects.keyframes {clip, effect} 로 엔진에서 읽고(키프레임 있는 효과만, wasm 0.27ms)
    추정 코드(스냅샷·대조·stale·noteParamSet) 364줄 삭제, 다시 연 프로젝트에서도 마커 유지(웹 e2e 신규), 로드맵 M3-1 (e) 완료. 워크트리 검증:
    단위 720(커버리지 93.45/83.85/93.49/96.82), 엔진 196, 웹 e2e 전체 153(skip 1), 키프레임 묶음 e2e 42 전후 같음, 데스크톱 스모크·e2e 7.
  - web-files(todo P1, 엔진 변경 없음, 커밋 f657ebf): Blob 범위 읽기(registerBlob, 1 MiB 청크, FileReaderSync)는 10-14 부터 있어 todo 문구가
    낡았었다. 남은 공백인 새로고침 뒤 미디어 재연결을 메움: Worker 가 가져온 File 을 1.5초 뒤 OPFS media/ 에 8 MiB 조각으로 복사하고 끝난 것만
    media/index.json 에 적는다(features/project/web-media.ts, apps/web/src/opfs.ts). 다음 시작 때 같은 엔진 경로(/files/<이름>)로 다시 registerBlob
    해서 프로젝트·복구본이 "미디어 다시 연결" 없이 열린다. 재등록은 시작을 막지 않고 파일 관련 호출 때 시작(처음엔 시작을 기다리게 해 e2e 가 15%
    느려졌던 것을 고침). 공간이 모자라면 사본을 지우고 기존 재연결로, 참조 없고 하루 지난 보관본은 정리. 열기 대화상자에 보관 수·크기·사이트
    사용량. 실측 588MB 1080p: 가져오기 154~166ms, wasm 메모리 +18MB, Blob 읽기 38MB, 탐색 첫 장 927~1028ms(보관 없음 827~951ms, 바로 복사하면
    최대 1373ms 라 1.5초 지연). 테스트: web-media 단위 15, 엔진 web-blob 6(Blob 과 메모리 경로 프레임 같음), e2e "가져온 파일 보관". 워크트리 검증:
    단위 735, 엔진 202, 워크플로 회귀, 웹 e2e 155(skip 3, 기준선 149 + 신규).
  - 테스트 가짜 엔진의 도달하지 않는 중복 `clip.rename` 분기 삭제(esbuild 경고).
  - engine-perf(`engine(vendor):` 2 + `feat:`, 커밋 f2e546c·cac6c5a·d3d0334, todo P1 전환 + P2 두 건): 데모 생성기를 열(u)·행(v) 단위 계산과
    가중치 0 노이즈 건너뛰기로 바꿔 출력 비트 일치(예전 demo_pixel 을 테스트 기준으로 6장면 바이트 비교). renderFrame scale 0.5 wasm Aurora
    236.6ms 에서 56.3ms, Dunes 175.1 에서 39.0, 6장면 모두 단축, napi 도 전 장면 같거나 빠름(번갈아 3회). WSOLA `render_keyed` 가 사슬 위치를
    기억(소스 키 + 입력 표본 지문), 예전 구현과 비트 일치, 미리보기 4096 블록 출력 1초당 napi 13.6ms 에서 4.5ms, wasm 17.1 에서 6.7(다시
    그리면 1.9·0.9). 전환: inspect params 평문 값(setTransition 왕복), 클립보다 긴 전환은 클립 안으로 줄이고(clamped) 소스 핸들 부족은
    repeatFrames·warning 으로 알림(렌더가 끝 프레임을 반복해 검게 비지 않으므로 핸들로는 줄이지 않음, todo 문구와 다른 판단), 저장된 전환은
    그대로. 화면 fitNote 상태 줄 문구, 안 쓰던 plainParams 삭제, usage 3.2 낡은 문장 정정. 측정만 하고 둔 것: sequence.inspect 50클립 napi 3.1ms·
    wasm 4.4ms, 빈 renderFrame 3.8ms. 워크트리 검증: cargo test(engine 412, render 154, audio-dsp 125, media 20), 단위 720, 엔진 기능 198, 워크플로
    회귀, 웹 e2e transitions·keyframes 22, 데스크톱 스모크, vendor xtask ci 1976. wasm 14.71 에서 14.74MB.
  - whisper-fix(`engine(vendor):` + `feat:`, 커밋 eb2fbd0·f450569, todo P1 STT 두 건): "whisper-small 이 둘째 30초 창을 건너뛴다" 의 원인은
    no-speech 판정이 아니었다. 첫 창이 `<0.00> 첫 문장 <13.40>` 뒤 바로 끝나면 상류 규칙(타임스탬프 하나로 끝나면 창 전체 30초를 넘김)이
    13.4~30초의 둘째 문장을 디코드하지 않고 버렸고, 남은 1.5초 꼬리만 no-speech 로 건너뛰었다. `plan_advance`: 그 뒤 창에 3초 이상 남고 그중
    1초 이상이 말소리면 그 타임스탬프부터(0.5초 기준은 끝 1초 꼬리를 다시 디코드해 낱말 반복·"감사합니다." 환각이 생겨 3초로). 실측 두 문장
    12개 small WER 32.6% 에서 30.1%(p9 77% 에서 50%, +3.7초), 나머지 전사는 small·base·영어 모두 바이트 단위로 같음. 웹 자동 자막: 음성 전용
    wasm(bindings/speech-wasm 1.3MB) + 음성 Worker, 모델 tiny·base 는 OPFS models/ 에 조각 SHA-256 검증으로, 소리는 엔진 Worker itemAudio16k
    (napi 와 같은 transcript::host_item_audio, napi 의 사본 제거), 가중치는 8MB 씩 스트리밍. Chromium 30초 한국어 base 17.1~17.6초·RSS 최대
    1,660MiB(첫 구현 18.1초·1,937MiB), tiny 6.4초, 네이티브와 같은 글. 워크트리 검증: 단위 738, 엔진 210(stt-web 6 신규), 웹 e2e stt·web-files·
    editor·text 42, 데스크톱 스모크·e2e 7, vendor xtask ci 1976(hevc conformance draft_mode 1건 부하 중 실패 뒤 재실행 통과).
- **병합 뒤 검증(v0.1.8, main)**: prettier, clippy, 엔진 빌드(napi·wasm·speech-wasm), typecheck, cargo test(바인딩), 단위 738, 엔진 기능 210, 워크플로 회귀 10.5초(어제 16.3초), 앱 빌드,
  웹 e2e 155 통과(skip 5, 9.9분; 어제 11.3분) + 실패 2건은 웹 자동 자막이 생겨 전사 탭 안내가 바뀐 것을 옛 기대값이 잡은 것이라 기대값을 고쳐
  audio-cleanup 10 통과, 데스크톱 스모크(687 커맨드)·e2e 7, vendor `cargo xtask ci` 1976(wasm 45 크레이트). Windows 엔진 0.1.8 크로스 빌드,
  인스톨러 0.1.8(122.7MB)을 바탕화면 `seonghyun` 폴더에(0.1.7 제거).
- **다음**: P1 은 Windows HW 디코드 실기 확인만 남음(사용자 PC 필요). P2 의 데모 장면 두 개 60ms 초과, wasm 프레임 캐시 예산, 전환 핸들 자동 다듬기.

## 2026-10-15 - 끊긴 세션 복구: AV1 내보내기, 움직이는 스티커(Lottie), 내 템플릿, 잡 진행률 (워크트리 4개 병합, v0.1.7)

- **상황**: 어제 01:19 커밋 뒤 워크트리 4개(av1-export, jobs-progress, lottie-stickers, user-templates)에서 병렬 작업 중 01:46 에 세션이 끊겼다
  (네 워크트리가 napi·wasm 빌드와 playwright 를 동시에 돌려 7GB RAM 을 넘긴 것으로 보임. session-log 에 기록이 없어 git worktree 와 파일
  시각으로 복원). 이번에는 두 개씩(av1 + templates, lottie + jobs) `CARGO_BUILD_JOBS=6` 으로 마무리하고 main 에 templates, av1, lottie, jobs
  순서로 병합했다.
- **요청**: 끊긴 작업 파악·완료와 문서 갱신. 인스톨러는 앞으로 바탕화면 `seonghyun` 폴더에 이전 버전을 지우고 넣기(CLAUDE.md 4번 규칙).
- **수정**:
  - user-templates(엔진 변경 없음, M3-6 (a)(c)): 템플릿 탭 "지금 편집본을 템플릿으로 저장"(이름·설명 대화상자)이 sequence.inspect·effects.keyframes 로
    편집본 구조(설정, 트랙·클립 길이·위치, 텍스트 내용·모양, 효과·키프레임, 전환)를 미디어와 떼어 템플릿 JSON(`features/templates/format.ts`,
    timeline.md "템플릿 JSON")으로 적는다. 미디어 클립은 슬롯(같은 항목은 슬롯 하나), 썸네일은 플레이헤드 renderFrame PNG. "내 템플릿" 카드는
    만들기(고른 미디어를 슬롯 순서대로, clip.fillFrame, 모자라면 비워 두고 알림)·메뉴(이름·설명 바꾸기, .json 내보내기, 삭제 확인), 가져오기는
    검증 뒤 저장(파일 이름이 될 수 없는 id 는 새 id). 저장소 `EngineBridge.templates`: 데스크톱 `userData/templates/<id>.json + .png`
    (id 는 글자·숫자·-·_ 만), 웹 IndexedDB, 없으면 메모리. 내장 4종과 같은 applyRecipe 경로. CI web-mobile job 을 web 에 합쳐 390 도 PR 을
    막는다(todo P3). 워크트리 검증: 단위 701(커버리지 93.5/83.6/93.4/96.7), 웹 e2e user-templates·keyframes 14(1440·390), 데스크톱 스모크·e2e 7
    (templates.spec 신규). 커밋 efd222d.
  - av1-export(`engine(vendor):` + `feat:`): effectcraft `av1enc` 를 `crates/av1enc` 로 이식(의존성 0, unsafe 없음, 테스트 왕복 8·libdav1d 오라클 2 그대로).
    export 에 `Format::Av1`(mp4 `av01` + `av1C`, AAC)·`Av1Encoder`·프리셋 `AV1 1080p`(10 Mbps)·`AV1 720p`(5 Mbps), WebM 은 `videoCodec: vp9 또는 av1`(V_AV1).
    형식 콤보 4개("AV1 (mp4)"), `OVERRIDE_KBPS.av1`. 엔진 기능 테스트 `export-av1.test.ts` 5건(ffprobe av1 Main + aac, libdav1d 디코드 오류 0).
    실측 1080p 18초: AV1 314.1초(1.7 fps, 5.8 MB) 대 H.264 30.1초(12.7 MB), HEVC 236.7초, VP9 128.6초. 레이트 컨트롤이 단순 영상에서 목표 10 Mbps 에
    2.58 Mbps 로 못 미침(양자화 하한, 한계로 기록). wasm 14.2 에서 14.6MB. engine-commands.md 의 `"vp9" | "av1"` 파이프가 표 행을 깨던 것 수정.
    워크트리 검증: cargo test(av1enc·export·engine 프리셋 전수), clippy·fmt, lint, 엔진 빌드, typecheck, 단위 687, 엔진 175, 워크플로 회귀, 데스크톱 e2e 6,
    웹 e2e 내보내기 2. 커밋 6fb0df1·22062ac.
  - lottie-stickers(M3-4 (a)(c), 커밋 483e00d·485ee8e): effectcraft `lottie` 는 가져오기 쪽(값·키프레임 이즈·도형·레이어 읽기, base64·ZIP)만
    `crates/lottie` 로 이식하고 평가·래스터(평탄화·스트로크·대시·트림·리피터·마스크·매트·프리컴프·타임 리맵, filmcraft-text 스캔라인 채우기 +
    짝홀 규칙)는 새로 썼다. `graphics.newLottie` 대신 미디어 풀 오프너로 `.json`/`.lottie` 를 알파 있는 반복 영상 미디어(`LOOP_SECONDS` 60초)로 열고,
    `graphics.newFromFile` 에 `duration` 을 더해 화면이 5초만 놓는다. 어제 끊긴 크레이트는 자기 테스트가 깨져 있었다: 별 꼭지 1e12 가 32TB 할당,
    마스크 경로가 늘 비던 것(`{a,k}` 포장 없이 읽음), 평탄화 분할 부족, 트림이 위쪽 스타일(bodymovin 은 `st` 뒤에 `tm`)에 안 먹던 것을 고침.
    화면: 스티커 탭 "움직이는 스티커" 10종(직접 적은 bodymovin JSON 512x512 30fps 4KB 미만 + 미리보기 SVG, 사이드카 40개), 카드 재생 표식,
    JSON 바이트를 `.json` 호스트 파일로 올려 `graphics.newFromFile {path, time, duration}`. 워크트리 검증: lottie 28, engine 409, clippy, lint,
    typecheck, 단위 687, 엔진 기능 184(lottie.test 14: napi 에셋별 렌더 골든·반복·거부, wasm putFile), 워크플로 회귀, 웹 e2e keyframes 12(1440·390).
    실측 1080p 스티커 한 장 renderFrame napi 32~36ms, wasm 139ms. 문서: usage 3.18, engine-commands, VENDOR, NOTICE, 로드맵 M3-4.
  - jobs-progress(`engine(vendor):` + `feat:`, todo P2 두 건): 흔들림 분석을 렌더 밖 엔진 잡 `effects.analyzeStabilizer {clip, smoothness?, wait}`
    (kind stabilizer, 없으면 효과를 붙이는 한 단계 "Warp Stabilizer", 결과는 렌더 캐시로)로 빼고, 장면 찾기 `clip.sceneEditDetection` 을 같은
    `SteppedTask` 모양으로(네이티브 스레드, 웹은 `pump_jobs` 가 프레임 2장씩) 바꿔 `wait: false` 가 wasm 에서도 된다. `Job.kind` 와
    `jobProgress {id, kind, label, progress, done, cancelled, error}` 이벤트(permille 바뀔 때만), `jobs.cancel` 은 웹 단계 작업을 바로 끝냄.
    새 프로젝트·열기 때 분석 캐시를 비움(키가 item·clip id 라 새 프로젝트가 옛 경로를 재사용하던 상류 결함, 엔진 테스트가 잡음). 화면
    `features/jobs`(store: track·applyEvents·waitFor·cancel, 웹 펌프 루프 16ms/60ms; `JobsPane`: 상태 줄 진행 막대 + "흔들림 분석 42%" + 취소,
    둘 이상이면 "작업 N개" + 목록 팝오버, DESIGN.md 4.25), 흔들림 줄이기 절 "분석 중... N%", 취소하면 효과 해제, 장면 찾기는 늘어난 클립 수로
    셈. `installEnginePoller` 로 단위 테스트가 폴러를 세움. 한글 라벨 2개. 실측 16초 데모: napi 10.7초(OceanSunset), wasm 49초(어제와 같은
    시간이지만 화면이 응답하고 취소됨), 장면 찾기 4초 조각 2.4초. 워크트리 검증: cargo test engine 412·render 154, clippy·fmt, lint, 엔진 빌드,
    typecheck, 단위 699(커버리지 94.1/84.9/93.2/97.0), 엔진 기능 177(jobs.test.ts napi 4 + wasm 3), 워크플로 회귀, 웹 e2e motion-fx·audio-cleanup
    20(1440·390, 취소 테스트 신규), 데스크톱 스모크(687 커맨드)·e2e 6. 커밋 ac1cbae·57c31b3.
  - 병합 충돌: NOTICE·VENDOR.md(av1enc 와 lottie 둘 다 이식으로), vendor Cargo.toml(크레이트 두 줄), usage.md(탭 목록, 3.17 템플릿·3.18 스티커·
    3.19 작업 칸으로 번호 정리), engine-commands.md(export 행은 AV1 쪽, sceneEditDetection·jobs 행 추가).
- **병합 뒤 검증(v0.1.7, main)**: prettier, clippy, 엔진 빌드(napi·wasm 14.7MB), typecheck, cargo test(바인딩), 단위 719, 엔진 기능 196(napi + wasm), 워크플로 회귀 16.3초, 앱 빌드(web·desktop),
  웹 e2e 151 통과(skip 1, 11.3분, 1440·390), 데스크톱 스모크(687 커맨드)·e2e 7(templates.spec 포함), vendor `cargo xtask ci`(테스트 1972, wasm 45 크레이트).
  Windows 엔진 0.1.7 크로스 빌드(cargo-xwin, 39.5MB), 인스톨러 0.1.7(122.7MB)을 바탕화면 `seonghyun` 폴더에(0.1.6 제거).
- **다음**: todo P2 의 AV1 레이트 컨트롤 하한, 스티커 `at_size` 확대, 흔들림 캐시 무효화; P3 의 DESIGN.md 절 번호 중복, 390 작업 칸 눈 확인;
  Windows 실기(HW 디코드, AV1 재생 확장).

## 2026-10-14 - 크래시 리포트, 워크플로 회귀, 한글 라벨, 이벤트·썸네일 정리 (M4, feat/ops-quality 병합, v0.1.6)

- **수정**:
  - M4-6: 엔진 utility process 가 비정상 종료하면 `<userData>/crash-reports/<일시>.json`(종료 코드·시그널, 앱·엔진 버전, OS, 마지막 커맨드
    20개 + 편집 커맨드 20개 링 버퍼, 메모리). 토스트 "문제 보고 파일을 남겼습니다" + 폴더 열기, 도움말 > 문제 보고 폴더 열기. 서버 전송 없음.
  - M4-1: `scripts/workflow-regression.mjs`(filmcraft-cli run: 데모 3클립, 자르기, 자막, 음악, 전환, 720p 내보내기 뒤 ffprobe 검사, 약 20초)를
    `npm test`(verify) 에 포함, CI engine job 에도. `.mcp.json` 에 `filmcraft`(CLI 없으면 비활성 안내).
  - M4-9: `features/i18n/labels.ko.ts` 커맨드 253 + 히스토리 161 + 효과 이름 15. 메뉴 경로가 있는 커맨드의 누락 0 을 엔진 테스트가 강제.
    실행 취소·다시 실행 상태 줄이 한글.
  - M4-8: `RevisionGate` 로 커맨드 뒤 직접 읽기와 폴러 이벤트 읽기가 겹치지 않게(sequence.inspect 9 에서 6, project.inspect 7 에서 4).
    vendor `sequence.inspect` 에 `revision`. M4-7: Graphic 내부 항목 숨김, 텍스트·도형 클립은 썸네일 대신 아이콘.
  - 병합 뒤 복구 회귀: 데스크톱 이벤트에 revision 이 없어 useEngineEvents.revision 이 -1 인 채로 재시작 때 0 이 되면 need=0 이 되고
    크래시 전 revision 을 가진 store 가 읽기를 건너뛰어 옛 편집본이 남았다. 재시작 revision 을 -1("모름")로 바꿔 반드시 다시 읽게 함.
- **병합 뒤 검증(v0.1.6, main)**: prettier, typecheck, clippy, 단위 685(커버리지 임계 유지), 엔진 기능 170(napi + wasm), 워크플로 회귀 13초,
  웹 e2e 143 통과(skip 1, 9.8분. 클립 메뉴 항목 2개 추가로 기대값 갱신), 데스크톱 e2e 6 + 스모크(686 커맨드), vendor `cargo xtask ci`
  (frame pool 테스트의 전역 reused 카운터 기대를 하한으로). Windows 엔진 0.1.6 크로스 빌드, 인스톨러 0.1.6 바탕화면(0.1.5 제거).
  GitHub Actions 첫 성공(run 38590188018): lint-unit, engine, typecheck, web, web-mobile, desktop 전부 통과. 앞선 실패는 설치 스크립트의
  구버전 wasm-pack 이 `--profile` 을 몰라서였고 0.15.0 을 고정해 해결.

## 2026-10-14 - 오디오 정리·전사 편집, 속도 램프·크로마키·PIP·흔들림, HEVC (feat/audio-cleanup, motion-fx, hevc-export 병합, v0.1.6)

- **요청**: 로드맵 M3 잔여(M3-2, M3-3, M3-5 HEVC, M3-7, M3-8, M3-9)와 M4 운영 품질을 워크트리 4개로 병렬.
- **수정**:
  - audio-cleanup(엔진 변경 없음): 오디오 탭 "음성 깨끗하게"(essentialSound.setType dialogue + set 으로 denoise·dereverb·enhance 조합, 강도
    3단, 원래대로)·"소리 크기 맞추기"(essentialSound.autoMatch -14/-16/-23 + normalizeMixTrack -1 dB, 측정 LUFS·게인 표시), 인스펙터
    "전사" 탭(transcript.inspect/search/extract/removePauses/removeFillers, 문장 클릭 이동), 클립 메뉴 "장면마다 자르기"(clip.sceneEditDetection).
    실측 16초: 정리 렌더 89ms 에서 574ms, autoMatch 643ms, 장면 2.0s.
  - motion-fx: 상류가 time_remap speed 키프레임을 렌더에서 무시하던 것을 vendor `project`(`remapped_source_time_at`, 곡선 적분)와
    `render`(frame_time·base_layer·interpolation_blend)에 고쳐 속도 램프가 실제로 작동. 속도 탭 "속도 곡선"(프리셋 3종 + SVG 곡선 편집기,
    배지 "램프", 클립 길이 불변·소리는 원래 속도), 효과 탭 "배경 지우기"(ultra_key, 모니터 스포이트는 효과를 잠깐 끄고 renderFrame 픽셀 읽기)·
    "작은 화면"(motion scale·position 모서리 4곳)·"흔들림 줄이기"(warp_stabilizer, 첫 렌더에서 분석: napi 5초 클립 691ms, wasm 16초 40~50초).
  - hevc-export: effectcraft `hevcenc` 이식(`crates/hevcenc`, 의존성 0), export 에 `HevcEncoder`·hvcC, `hevc` 형식 available, 프리셋
    "HEVC 1080p (Half Size)"·"HEVC 2160p 4K". 형식 콤보 3개(H.264, HEVC, WebM). 실측 1080p 18초: HEVC 236.7초(2.3 fps, 11.1MB) 대
    H.264 26.3초(12.7MB) 대 WebM 128.6초(14.5MB).
  - 병합 충돌: 클립 메뉴(장면마다 자르기 + 흔들림 줄이기 둘 다), usage.md 절 번호(오디오 3.10~3.13, 모션 3.14~3.16), engine-commands·
    데스크톱/웹 표의 내보내기 행, motion-fx 엔진 테스트의 inspect 타입.
- **검증**: 아래 "병합 뒤 검증(v0.1.6)" 줄(ops-quality 병합 뒤 한 번에).
- **다음**: ops-quality 병합(크래시 리포트, 워크플로 회귀, 한글화), 흔들림·장면 분석을 엔진 잡으로, AV1, Lottie, 사용자 템플릿.

## 2026-10-14 - wasm 크기·속도, WebCodecs 디코더 (M4-4, feat/wasm-perf 병합, v0.1.5)

- **요청**: 로드맵 M4-4. 측정으로 정당화된 변경만.
- **수정**:
  - 크기 21.2MB 에서 14.2MB(gzip 9.1 에서 5.3): `[profile.wasm-release]`(opt-level s, 코덱·렌더·텍스트 등 핫 크레이트 16개는 3,
    codegen-units 1), 글꼴을 wasm 데이터 세그먼트에서 빼서 웹이 `?url` 자산으로 받아 `addFontData` 로 주입(wasm32 는 Inter Regular 만 내장).
    `.cargo/config.toml` wasm32 `+simd128`. 전부 s 는 12.4MB 지만 25~40% 느려 채택 안 함. 코덱 feature 분리는 측정상 1MB 라 보류.
  - WebCodecs: 디코더 전용 Worker(`decoder.worker.ts`)가 VideoDecoder 를 갖고, 엔진 Worker 는 SharedArrayBuffer + Atomics.wait 로 동기
    대기(`webcodecs.ts`, COOP/COEP 로 crossOriginIsolated). wasm 바인딩 `setWebCodecsHooks` 가 `register_video_decoder` 팩토리를 설치,
    `HybridDecoder` 가 오류·시간 초과·미지원 포맷에서 소프트웨어로 폴백(오류 없음). H.264 1080p 임의 탐색 77ms 에서 51ms, 순차 28 에서 25,
    내보내기 720p 3초 15.3초 에서 10.4초. 버전 문자열 끝 `hw: WebCodecs`.
  - `scripts/bench-wasm.mjs`(Playwright 측정 표), `packages/engine/tests/wasm-web.test.ts` 7건, `apps/web/e2e/webcodecs.spec.ts`,
    `docs/guides/wasm-performance.md`.
- **검증**: 위 "병합 뒤 검증(v0.1.5)" 줄.
- **다음**: 12MB 목표 잔여(interchange·image·symphonia 분리), 데모 생성기 fbm 비용(150ms) 때문에 데모 renderFrame 은 60ms 목표 미달,
  글꼴 5.2MB 매 시작 fetch(브라우저 캐시 의존).
- **병합 뒤 검증(v0.1.5, main)**: prettier, typecheck, clippy, 단위 614, 엔진 기능 159(napi + wasm, WebM·타임스트레치·WebCodecs 흉내 포함),
  웹 e2e 123 통과(skip 1, 7.1분), 데스크톱 e2e 6 + 스모크(686 커맨드), vendor `cargo xtask ci`(apv oracle·export APV probe 는 ffmpeg 6.1 에서
  skip, frame pool 테스트는 전역 선반을 쓰는 세 테스트를 뮤텍스로 직렬화해 flaky 제거, matroska oracle 은 트랙 마지막 패킷의 길이를 ffprobe 가 코덱 공칭값으로 주는 ffmpeg 6.1 차이를 허용, 믹서 perf 테스트의 실시간 배수 하한 4.0 을 2.0 으로: WSL2 단독 4.8x 라 16스레드 스위트와 겹치면 깨짐). Windows 엔진 0.1.5 크로스 빌드, 인스톨러
  0.1.5 바탕화면(0.1.4 제거). 내보내기 대화상자 형식이 2개가 되어 단위·데스크톱 e2e 기대값 1 을 2 로.

## 2026-10-14 - WebM 내보내기, 음정 유지 타임스트레치 (feat/webm-export, feat/timestretch 병합)

- **요청**: 로드맵 M3-5(WebM), M3-8 일부(soundcraft WSOLA). wasm-perf 와 병렬.
- **수정**:
  - effectcraft `vp9enc`·`opusenc` 를 `vendor/filmcraft/crates/` 로 이식(의존성 0, 이름만 filmcraft-*). export 에 `Format::WebM`,
    VP9·Opus 인코더 팩토리, 상류 matroska `MkvWriter` 위에 `webm_out.rs`, 프리셋 "WebM 1080p (Web)"·"WebM 720p". 내보내기 대화상자
    형식 콤보(mp4/webm), 프리셋 재생성·확장자 전환, 웹 다운로드 MIME. 실측 1080p 18초: VP9 128.6초(4.2 fps, 14.5MB) 대 H.264 27초.
  - soundcraft `time_stretch`(WSOLA)를 `audio-dsp/src/timestretch.rs` 로. `TrackItem.maintain_pitch`(켜졌을 때만 JSON), render 의
    정방향 클립 소리에 `Stretcher::render`(블록 불변), `clip.speedDuration {maintainPitch}`·`clip.setMaintainPitch` 커맨드, 속도 폼
    "음정 유지" 체크박스와 안내(0.5x~2x 밖, 역방향 제외). 실측 2x 16초: 리샘플 66ms, WSOLA 147ms.
  - vendor 테스트 3곳을 ffmpeg 6.1·Linux 호스트에서도 돌게(apv oracle skip, export APV probe skip, shortcuts.set platform).
    `cargo xtask ci` 가 apv oracle 에서 멈추던 것이 이 때문.
  - usage.md 의 웹 저장·내보내기 "준비 중" 문장을 실제 동작(브라우저에 저장, 내려받기)으로 고침. VENDOR.md·engine-commands.md 병합.
- **검증**: wasm-perf 블록의 "병합 뒤 검증(v0.1.5)" 줄.
- **다음**: wasm-perf 병합, 버전 0.1.5 인스톨러, hevcenc, VP9 속도.

## 2026-10-14 - CI 워크플로, e2e 안정화, 커버리지 임계 (M4 품질, feat/ci-quality 병합)

- **요청**: 로드맵 M4 의 품질 축. 다음 물결(webm-export, timestretch, wasm-perf)과 병렬로 진행.
- **수정**:
  - `.github/workflows/ci.yml`: lint-unit(prettier + 커버리지 임계 90/82/88/93) / engine(clippy, napi·wasm 빌드, cargo test,
    엔진 기능 테스트, artifact) / typecheck / web(desktop-1440) / web-mobile(390, 실패 허용) / desktop(xvfb 스모크·e2e) /
    vendor-ci(매일 03:00 KST `cargo xtask ci`) / windows-installer(dispatch, cargo-xwin + LLVM). GitHub 에서 첫 실행은 아직.
  - 데스크톱 e2e 복구 테스트를 `recovery.spec.ts` 로 분리해 `app` 뒤 단독 실행. onCrashed 등록을 기다린 뒤 kill, 20초 상한 +
    재kill 3회, 단계 로그.
  - 웹 e2e: `SH_E2E_PORT` 없으면 빈 포트 자동 선택, retries CI 1/로컬 0, 390 폭 전환 2건은 드래그 대신 카드 Enter(`TransitionGallery`
    키보드 경로 신규)로 skip 0건. `scripts/test-report.mjs`(`npm run test:report`) 층별 표.
  - vendor xtask `wasm` 검사를 ui-egui 대신 L0~L4(filmcraft-engine)로(`engine(vendor):`). `docs/guides/testing.md` 신규.
- **검증**(병합 뒤 main): prettier, typecheck, 단위 604(커버리지 93.4/84.7/91.4/96.3), 데스크톱 e2e app 5 + recovery 1(복구 1.2초),
  웹 e2e transitions·usability·keyframes 38(두 뷰포트, skip 0). 병합 뒤 고친 것: 복구 테스트가 빨라져 크래시 전 토스트가 남아 둘이
  되던 것은 `.last()`, 내보내기 프리셋 수는 엔진 응답 뒤라 `expect.poll`(부하 35 에서 0개로 실패). vendor `cargo xtask ci` 는 위 v0.1.5 블록의 "병합 뒤 검증" 줄.
- **다음**: GitHub Actions 첫 실행 확인(wasm-pack 설치, wine 패키지명, rust-cache 시간), keyframes.spec 모바일 flaky 1건 관찰.

## 2026-10-14 - 사용법 문서, 자동 자막, 캐시·웹 저장, 키프레임·스티커·템플릿, 엔진 커맨드 보강 (v0.1.4)

- **요청**: "기능은 있는데 사용법이 없다", 로드맵·todo 를 마일스톤 단위로 계속.
- **방법**: 워크트리 5개(usage-guide, stt-captions, cache-web, keyframes-templates, engine-commands) 병렬. 병합 순서 usage, stt, keyframes,
  cache, engine-commands. 충돌은 bridge.ts·preload·renderer·fake-bridge 의 줄 추가(STT 호스트 + 캐시 인터페이스 + 키프레임 가짜 파라미터).
- **수정**:
  - 사용법: docs/guides/usage.md(383줄, 단축키 표는 keymap.ts 에서 생성해 테스트로 대조), README 기능·시작하기, 앱 도움말 > 사용 안내가
    같은 문서를 ?raw 로 번들(자체 마크다운 렌더러). 화면에 남은 "시퀀스" 문구 6곳 정리.
  - M2-2 자동 자막: napi 에 whisper·download feature(stt), 바인딩 downloadSpeechModel·transcribeItem(libuv 스레드, 진행률·취소),
    자막 탭 "자동 자막"(모델 동의 대화상자, 첫 사용 때 내려받기, 줄당 글자·최소 시간, 군말·무음 정리). whisper-base 기본(293MB,
    한국어 CER 32%, 재생 시간의 1/4). Windows 크로스 빌드 candle 포함 성공. 웹은 데스크톱 전용 안내.
  - M2-8 캐시: 데스크톱 node:sqlite(cache.sqlite, 썸네일·피크·최근 프로젝트, ADR-0004), 웹 IndexedDB. 웹 저장(OPFS + 내 컴퓨터로 받기)·
    열기·자동 저장 30초·복구·미디어 재연결·내보내기 다운로드. 파일 메뉴 최근 프로젝트, 첫 화면 최근 목록.
  - M3: 모션 탭(위치·크기·회전·불투명도 키프레임, 보간, 마커, 모니터 변형 상자, 등장·퇴장 프리셋 6종), 스티커 20종(자체 SVG,
    PNG 래스터로 배치), 템플릿 4종(레시피). Lottie 는 이식 전.
  - 엔진(vendor, crates/engine/src/sh_commands.rs): sequence.removeTransition·setTransitionLength, effects.move·bypass·keyframes,
    edit.beginTransaction/endTransaction/cancelTransaction/transaction, lumetri.applyPreset replace, clip.enable/link linked,
    timeline.trim linked, easeInOut, 입력 검증(비객체·시각 정수·없는 clip id), 잘린 mp4 경고, 리버스 디코드 시각, inspect 효과 값 JSON.
    화면 transitions/ratio/text/onboarding 이 새 커맨드·withTransaction 사용. 커맨드 685개.
  - 한 열 배치(900px 이하) 미리보기 행 max-content(이동 툴바 잘림 수정), 미디어 패널 높이 32vh 고정(auto 행에서 flex:1 인
    미디어 목록이 0 높이가 되어 모바일 e2e 3건이 항목을 못 누르던 문제), 엔진 재시작 뒤 화면 복구(onEngineRestart).
  - 웹 e2e 를 새 엔진 모양에 맞춤: 효과 값은 JSON(`[100, 540]`), 화면 비율은 트랜잭션이라 실행 취소 한 번.
- **검증**: typecheck, prettier, clippy, 단위 604, 엔진 기능 143(expected fail 0), 웹 e2e 119 통과(데스크톱 1440 + 모바일 390, skip 3:
  모바일 전환 드래그 2 + 데스크톱 전용 1), 데스크톱 e2e 4 + 스모크, Windows 엔진 재빌드(sh-video-engine 0.1.4). 인스톨러 0.1.4 바탕화면.
- **다음**: M3 잔여(WebM 인코더 이식, 타임스트레치, 음성 정리 고도화, Lottie), M4(wasm 성능·WebCodecs, 실매체 코퍼스 확대, CI), 사용자
  템플릿 저장, 전환 params JSON 화.

## 2026-10-14 - 마일스톤 2 병합 + 두 번째 피드백 반영 (v0.1.3)

- **요청**: 로드맵·todo 를 마일스톤 단위로 전부 구현하고 마일스톤마다 검증. 두 번째 Windows 설치본 피드백(사용법 모름, "시퀀스" 용어,
  알림 토스트, 미디어 우클릭·Delete, 영상·소리 따로 조절, 파형과 싱크 맞추기). 사용법 문서는 sh-compositor 처럼.
- **방법**: feat/inspector-shell(속성 패널 탭 레지스트리)을 먼저 만들고 그 위에 워크트리 8개(텍스트·글꼴, 전환, 효과·필터, 속도·비율,
  오디오, 엔진 이벤트·썸네일, 실매체 호환·HW 디코드, 사용성). 병합 순서 전환, 속도·비율, 효과, 실매체, 이벤트, 텍스트, 오디오, 사용성.
  충돌은 공유 파일의 "같은 자리 줄 추가"가 대부분이고, 미디어 패널 탭 레지스트리가 둘(효과 panel-tabs, 오디오 tabs)이라 panel-tabs 로 통일.
- **수정**(기능별 상세는 각 features/ 디렉토리 주석과 DESIGN.md 4.15~4.21):
  - M2-1 텍스트·제목 클립(9칸 위치, 모니터 드래그, 프리셋 3종), 자막 탭(SRT 왕복), Pretendard Regular·Bold 번들(OFL, vendor crates/text).
  - M2-3 전환 12종 갤러리·드롭·길이 핸들·인스펙터. M2-4 효과 10종·색 보정·필터 23종(Lumetri 18 + 자체 5)·비교 보기.
  - M2-5 속도(0.1~10x, 역방향, 프리즈)·배지. M2-7 화면 비율 16:9/9:16/1:1/4:5 변환 + SNS 프리셋 카드.
  - M2-6 오디오: renderAudio·audioPeaks 바인딩(napi·wasm 공유 audio.rs), AudioBufferSource 재생기(A/V 드리프트 1프레임 이내),
    클립 볼륨·페이드·덕킹, 영상에 붙은 소리 포함 파형, 음악 탭.
  - 엔진 이벤트 통합(drainEvents JSON, 폴링 하나로 패널 갱신), 썸네일 커맨드 project.thumbnail(vendor engine +35줄)과 미디어·클립 썸네일.
  - 실매체 코퍼스 13종(ffmpeg 생성: 갤럭시·iPhone HEVC·60fps·VFR·회전·4K·모노·조각 mp4·mp3·m4a·png·jpg) 왕복 테스트 전부 통과,
    Windows·macOS HW 디코더 등록(platform 크레이트, cargo-xwin 링크 통과, 실기 확인 대기), wasm 실측 H.264 1080p 순차 31ms.
  - 사용성: 화면 용어 "시퀀스" 제거(타임라인·편집본), 빈 타임라인에 놓으면 편집본 자동 생성, 첫 화면 안내 카드·도움말 > 사용 안내,
    토스트 통일(6초, 오류는 수동), 미디어·클립 우클릭 메뉴, Delete 영역별 삭제, 다중 선택, 소리 분리·다시 연결, Alt 드래그 한쪽만,
    소리로 싱크 맞추기(clip.synchronize audio).
- **검증**: 병합본 typecheck, prettier, clippy, 단위 499, 엔진 기능 130(+2 expected fail), 웹 e2e·데스크톱 e2e·스모크 결과는 아래 줄.
- **엔진에서 발견한 구멍(다음 라운드 vendor 커맨드 보강 대상)**: 전환 삭제·길이 변경 커맨드 없음, 트림으로 틈이 생겨도 전환 유지,
  효과 순서 변경 없음, lumetri 프리셋이 누적 추가, 리버스 첫 프레임 off-by-one, 트랜잭션(묶음 undo) 없음, 페이드 제거 없음,
  clip.enable/link 가 연결 상대 미포함, inspect 효과 값이 Debug 문자열, 잘린 mp4 가 조용히 검정 프레임.
- **다음**: 사용법 문서(docs/guides/usage.md, README, 앱 안 도움말), M2 잔여(STT, SQLite·OPFS 캐시, 웹 저장·내보내기 UI), M3, M4.

## 2026-10-14 - 첫 Windows 피드백 반영 + 테스트 3층 + 로드맵 (v0.1.2)

- **피드백**(`docs/feedback-archive/2026-10-14-first-windows-run/`): 설치본이 Windows 에서 엔진까지 기동 확인. 요청: 아이콘, 메뉴 하나로,
  영역 크기 조절, Ctrl+Z 등 단축키 점검, 배속 재생, "FilmCraft Demo" 제거. 추가 요청: 다음 단계 진행, 단위·기능·e2e 테스트, 엔진 개선·경쟁 제품
  기능 적극 반영. printWidth 는 160 으로 결정(사용자).
- **방법**: feat/* 워크트리 5개(아이콘, 스플리터, 단축키·메뉴·배속, 테스트, 로드맵 문서)에 에이전트 병렬. 충돌은 App.tsx 와 설정 3개뿐.
- **수정**:
  - 아이콘(apps/desktop/build/icon.svg, `npm run icons` 로 ico/png/favicon 생성, sharp 로 ICO 직접 조립). exe·인스톨러·창·웹 favicon 적용.
  - 스플리터(features/layout): 미디어 200px~60%, 타임라인 120px~70%, 키보드·더블클릭 기본값, localStorage 복원. DESIGN.md 4.16.
  - 단축키 관리자(features/shortcuts/keymap.ts 한 곳) + 큐레이션 한국어 메뉴(menu-def.ts, Ctrl 표기, 라벨 색·Demo Project 제외) +
    배속 재생(0.25~4x, J/K/L 셔틀, 역재생) + Electron 기본 메뉴 제거(Menu.setApplicationMenu(null)) + "제목 없음" 표시.
  - 테스트: 단위 240(vitest, 가짜 EngineBridge, 커버리지 순수 모듈 98%), 엔진 기능 36(실제 .node 와 wasm, 내보내기·저장·복구·적대 입력),
    e2e 웹 18(1440·390), e2e 데스크톱 4(Electron+xvfb, 엔진 강제 종료 복구). `npm run test` = rust+unit+engine, `test:all` 에 e2e.
  - 테스트가 드러낸 결함 수정: formatTimecode 경계 오차, rulerStep 24·25fps 눈금, pause 뒤 배율 표시, Scrubber aria.
    엔진 입력 검증 느슨함 2건은 it.fails 로 남김(todo P3).
  - docs/plans/0002-feature-roadmap.md: 참조 제품 8종 조사, 엔진 갭, 마일스톤 2~4 상세, 결정 필요 목록.
  - prettier printWidth 160, Windows 엔진 cargo-xwin 경로를 build:win:xwin 으로 정리.
- **검증**: unit 240 통과, engine 36 통과(+2 expected fail), e2e 웹 18 통과(메뉴 한글화에 맞게 1건 갱신), e2e 데스크톱 4 통과(강제 종료 복구
  테스트는 CPU 경합 중 1회 120초 타임아웃, 단독·재실행 통과: todo P3 안정화). `npm run verify`, 스모크, Playwright 1440·390 확인.
  Linux·Windows 엔진 재빌드(0.1.2), 인스톨러 SH-Video-Editor-Setup-0.1.2.exe 바탕화면 교체.
- **다음**: 마일스톤 2 병렬 착수(텍스트·자막, 전환, 효과·필터, 속도, 오디오 재생·배경음악, 비율·SNS 프리셋) + 엔진 개선(실매체 호환, HW 디코드,
  이벤트 통합·썸네일). 결정 필요: 한글 글꼴(Pretendard 로 진행), 음악 출처(CC0), Whisper 모델 배포 방식.

## 2026-10-14 - 마일스톤 1 병렬 구현 병합 (v0.1.1)

- **요청**: 여러 에이전트로 병렬 작업, GitHub 는 private 으로 푸시, 끝나면 병합·검증·바탕화면 인스톨러.
- **방법**: feat/* 워크트리 6개(미디어 패널, 타임라인, 모니터 재생, 내보내기·저장·복구, 데스크톱 인프라, 웹 파일)에
  에이전트 한 명씩. 파일 경계(features/<이름>/ 아래, 공유 파일은 줄 추가만)를 지켜 충돌은 bridge.ts·App.tsx·main/index.ts 의
  "같은 자리 줄 추가" 뿐이었고 양쪽을 모두 살려 해결.
- **수정**(브랜치별 요약, 상세는 각 features 디렉토리 주석):
  - 미디어 패널(features/media): project.inspect + project.items 트리, 가져오기(데스크톱 파일 대화상자 pickFiles, 드롭은 webUtils
    경로), 데모 영상 6종, 선택 항목으로 시퀀스 만들기(project.select 선행 필요). 썸네일 커맨드는 엔진에 없음.
  - 타임라인(features/timeline): 눈금자·트랙·클립 블록·플레이헤드, 자르기(timeline.razor)·이동(timeline.move)·트림(timeline.trim)·
    삭제·리플·스냅·줌·미디어 드롭(timeline.place). DESIGN.md 4.15 타임라인 계약, docs/guides/timeline.md 추가.
  - 모니터(features/monitor): rAF 재생 루프, 프레임 요청 1건 제한, 적응형 배율(0.25/0.5/1), 스크러버, 타임코드, 단축키.
    실측 1080p scale 0.5 renderFrame: 네이티브 24ms, wasm 194ms(약 8배). 오디오 재생은 미구현.
  - 내보내기·프로젝트(features/export, features/project): 프리셋 5종(h264 mp4), 진행률·ETA·취소, 저장·열기·다른 이름·새 프로젝트,
    dirty 가드, 자동 저장과 크래시 복구(바인딩에 startAutosave·pollPersistence·shutdown 추가). 실측: 1080p 30fps 16초 내보내기
    47.6초 40MB(ffprobe h264+aac 16.0초).
  - 웹 파일(apps/web, bindings/wasm): Blob 범위 읽기(FileReaderSync, 1MiB 청크 LRU 64MiB), registerFiles/onFileWritten/
    takeWrittenFile/opfs 선택 메서드, opfs:/ 접두 경로 스테이징. 25.6MB 파일 가져오기에 9.9% 만 읽음. WebCodecs 등록 지점은
    vendor codecs 의 register_video_decoder 로 남아 있음.
  - 데스크톱 인프라(apps/desktop): 엔진을 utility process(engine-host)로 격리, 렌더러와 MessagePortMain 직결, 크래시 자동 재시작과
    onCrashed 알림. 렌더러 기준 renderFrame 왕복 8.4~9.7ms(격리 전 8.8~13.7ms). Electron 44 의 parentPort.postMessage 가 main 루프를
    멈추는 현상을 확인해 포트만 쓴다. Windows .node: napi 가 windows-gnu 를 거부(libnode.dll 요구)해 WSL gnu 크로스는 폐기.
    병합 시 자동 저장·종료(startAutosave·pollPersistence·shutdown)를 엔진 호스트 메서드로 옮기고 데이터 디렉토리는 env 로 전달.
- **검증**: 각 브랜치에서 typecheck·prettier·web/desktop 빌드·Playwright(1440·390) 통과. 병합 후 main 에서 clippy, wasm 재빌드,
  typecheck 통과. 병합본 `npm run verify` 통과, 스모크 "smoke: ok (commands 675, restart after exit code 0)", Playwright 1440·390 에서
  데모 프로젝트가 모니터·타임라인에 그려지고 넘침 없음. Windows 엔진은 WSL 에서 cargo-xwin + LLVM 23.1.3 으로 msvc 애드온 크로스 빌드
  성공(2분 52초, PE32+ DLL 31MB). `npm run dist:win` 으로 SH-Video-Editor-Setup-0.1.1.exe(119MB, 패키지 안에 win32-x64-msvc .node 와
  NOTICE 포함)를 만들어 바탕화면에 복사. 사용자 Windows PC 실행 확인은 대기.
- **다음**: 마일스톤 2(자막·음악·전환). 알려진 구멍: 오디오 재생 없음, 웹 저장/내보내기 다운로드 UI 미연결(bridge 는 준비됨),
  미디어 썸네일 없음, 엔진 이벤트(drainEvents) 통합 전이라 패널 간 갱신은 폴링.

## 2026-10-14 - 킥오프 완료: sh-video-editor v0.1.0 (마일스톤 0)

- **요청**: craft-opensource 의 filmcraft·effectcraft·soundcraft 를 토대로 엔진을 저장소 안에 소스로 두고 개선해, CapCut·VLLO·Clideo
  같은 영상 편집기를 Electron+React 로. 링크(의존성)가 아니라 소스. 성능 중요. WASM 웹 버전도(pdf-editor-live 처럼).
- **결정**(위저드, ADR-0002·0003): npm workspaces 모노레포(apps/desktop, apps/web, packages/editor, packages/engine). 엔진은 filmcraft
  0.2.1 을 통째로 이식(ui-egui·egui 앱·ArtCraft 상표 제외), effectcraft·soundcraft 는 단계 이식. 데스크톱은 napi-rs 애드온, 웹은
  wasm-bindgen Worker. 저장은 JSON 프로젝트 + SQLite 캐시(웹 OPFS). 디자인 sh-classic dark. Windows 먼저. 제품명 SH Video Editor.
  성공 기준: 1080p 클립 3개 + 자막 + 음악 + 전환 1개를 MP4 로, 데스크톱과 Chrome 에서 같은 결과.
- **수정**: 템플릿 인스턴스화, brief(confirmed)·ADR-0002·ADR-0003·plans/0001, packages/engine(vendor/filmcraft 이식, 바인딩 2종,
  AGENTS.md·VENDOR.md), packages/editor(EngineBridge·store·셸 4부품·layout.css), apps/desktop(main·preload·renderer·난독화·스모크·
  electron-builder 설정), apps/web(Worker 브리지), NOTICE, docs/guides/packaging.md, 훅 3종, CLAUDE.md·AGENTS.md 자기완성.
  Rust 툴체인 1.94 에서 1.99 로 갱신(filmcraft rust-version 1.95), wasm32 타깃 추가.
- **검증**: `cargo check`(filmcraft-engine·cli 53초), napi 릴리스 빌드 3분 19초(.node 31MB), wasm-pack 빌드(.wasm 23MB, 미최적화),
  typecheck 3 워크스페이스, vite 빌드, electron-vite 빌드 + 난독화, xvfb 스모크 "smoke: ok (commands 675)". Node 에서 .node 직접
  호출: `file.newSequence` 후 `renderFrame` 이 480x270 프레임 반환, undo 동작. 웹을 Playwright 로 1440·390 두 크기에서 확인:
  엔진 준비됨(커맨드 675개), 가로 넘침 없음(body 기본 여백과 메뉴바 고정 높이가 원인이던 잘림·넘침 수정).
  `npm run verify` 전체 통과(아래 커밋 시점).
- **다음**: 마일스톤 1(미디어 가져오기, 타임라인, 미리보기 재생, MP4 내보내기, 저장·복구). Windows 용 .node 빌드 경로 검증이
  인스톨러 전달의 선결 과제(todo P1). GitHub 저장소 생성 여부는 사용자 결정.
