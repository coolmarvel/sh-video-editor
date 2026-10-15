# 스티커 에셋 출처 (features/stickers/assets)

모든 파일은 이 프로젝트를 위해 직접 그린 원작(original work)이며 저작자는 이성현(SeongHyun Lee)이다. 라이선스는 프로젝트
라이선스(루트 `LICENSE`, UNLICENSED)를 따른다. 타사(Adobe, CapCut, VLLO, LottieFiles 등) 아이콘·그림·애니메이션을 복사하지 않았고,
글자(text 요소)와 글꼴을 쓰지 않았다. 파일마다 같은 내용의 `.attribution` 사이드카가 있다(`packages/engine/AGENTS.md` 7).

- 정지 스티커(`*.svg`, 20종): 128 뷰박스 SVG. 화면이 PNG 로 래스터해 넣는다.
- 움직이는 스티커(`*.json` + 같은 이름의 `*.svg`, 10종, 2026-10-15): bodymovin v5 Lottie JSON(512x512, 30fps, 도형 레이어만, 한 줄로
  압축해 4KB 미만)을 손으로 적었다. 같은 이름의 SVG 는 갤러리 카드의 정지 자세 미리보기다. 엔진 `filmcraft-lottie` 가 그린다.

| 파일                      | 이름          | 설명                               | 분류      |
| ------------------------- | ------------- | ---------------------------------- | --------- |
| `speech-bubble.svg`       | 말풍선        | 네모 말풍선                        | bubble    |
| `speech-bubble-round.svg` | 둥근 말풍선   | 타원 말풍선                        | bubble    |
| `thought-bubble.svg`      | 생각 풍선     | 구름 모양 생각 풍선                | bubble    |
| `arrow-right.svg`         | 오른쪽 화살표 | 굵은 오른쪽 화살표                 | arrow     |
| `arrow-down.svg`          | 아래 화살표   | 굵은 아래 화살표                   | arrow     |
| `arrow-curved.svg`        | 굽은 화살표   | 위로 돌아 오른쪽을 가리키는 화살표 | arrow     |
| `star.svg`                | 별            | 노란 별                            | shape     |
| `star-burst.svg`          | 폭발 별       | 강조용 뾰족 별                     | shape     |
| `heart.svg`               | 하트          | 빨간 하트                          | shape     |
| `check-circle.svg`        | 체크          | 초록 동그라미 체크                 | badge     |
| `cross-circle.svg`        | 엑스          | 빨간 동그라미 엑스                 | badge     |
| `badge-1.svg`             | 숫자 배지 1   | 파란 동그라미에 획으로 그린 1      | badge     |
| `badge-2.svg`             | 숫자 배지 2   | 파란 동그라미에 획으로 그린 2      | badge     |
| `badge-3.svg`             | 숫자 배지 3   | 파란 동그라미에 획으로 그린 3      | badge     |
| `highlight-circle.svg`    | 강조 원       | 손으로 그린 듯한 빨간 원           | highlight |
| `underline.svg`           | 밑줄          | 노란 형광펜 밑줄                   | highlight |
| `exclamation.svg`         | 느낌표        | 노란 삼각형 느낌표                 | badge     |
| `sparkle.svg`             | 반짝임        | 네 갈래 반짝임                     | shape     |
| `pin.svg`                 | 위치 핀       | 빨간 지도 핀                       | shape     |
| `smile.svg`               | 웃는 얼굴     | 노란 웃는 얼굴                     | shape     |

| 파일                                               | 이름            | 설명                                          | 분류     |
| -------------------------------------------------- | --------------- | --------------------------------------------- | -------- |
| `heart-beat.json` + `heart-beat.svg`               | 뛰는 하트       | 커지고 작아지는 빨간 하트(두 번 뛰기)         | animated |
| `star-spin.json` + `star-spin.svg`                 | 돌아가는 별     | 제자리에서 한 바퀴 도는 노란 별               | animated |
| `arrow-bounce.json` + `arrow-bounce.svg`           | 뛰는 화살표     | 아래를 가리키며 튀는 파란 화살표              | animated |
| `exclamation-blink.json` + `exclamation-blink.svg` | 깜빡이는 느낌표 | 노란 삼각형 표지의 느낌표가 깜빡임            | animated |
| `loading-dots.json` + `loading-dots.svg`           | 점 세 개        | 차례로 커지는 하늘색 점 세 개                 | animated |
| `check-draw.json` + `check-draw.svg`               | 그려지는 체크   | 초록 원이 그려지고 체크가 이어 그려짐         | animated |
| `confetti.json` + `confetti.svg`                   | 꽃가루          | 세 가지 색 조각이 돌며 떨어짐                 | animated |
| `bubble-wobble.json` + `bubble-wobble.svg`         | 흔들리는 말풍선 | 꼬리를 축으로 좌우로 기우는 흰 말풍선         | animated |
| `sparkle-twinkle.json` + `sparkle-twinkle.svg`     | 반짝이는 반짝임 | 큰 노란 반짝임과 작은 흰 반짝임이 번갈아 커짐 | animated |
| `pin-drop.json` + `pin-drop.svg`                   | 떨어지는 핀     | 위에서 떨어져 튀는 빨간 지도 핀, 아래 그림자  | animated |
