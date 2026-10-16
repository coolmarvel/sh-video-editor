---
title: 타임라인 (트랙·클립·razor·이동·트림·끌어다 놓기)
created: 2026-10-14
updated: 2026-10-16
domain: editor
---

# 타임라인

마일스톤 1 의 타임라인. 코드는 `packages/editor/src/features/timeline/`, 셸 `shell/Timeline.tsx` 는 이 기능을
렌더만 한다. 모양 계약은 `DESIGN.md` 4.15.

## 파일

| 파일           | 역할                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store.ts`     | zustand 상태. 편집은 전부 `EngineBridge.execute` 로 커맨드를 보내고 끝나면 `sequence.inspect` 재조회                                              |
| `Timeline.tsx` | 툴바·눈금자·트랙·플레이헤드, 포인터 제스처(스크럽·이동·트림), 단축키, 미디어 drop                                                                 |
| `Track.tsx`    | 트랙 머리(잠금·음소거·숨김 토글), 레인, 클립 블록(트림 핸들). 클립이 48개를 넘는 레인은 보이는 구간(앞뒤 한 화면)만 그린다, 레인·클립 블록은 memo |
| `Ruler.tsx`    | 보이는 구간의 눈금과 타임코드 라벨, 플레이헤드 머리                                                                                               |
| `geometry.ts`  | tick 과 px 변환, 프레임 스냅, 눈금 간격, 스냅 보정 (순수 함수)                                                                                    |
| `dnd.ts`       | 미디어 패널과의 DnD 계약 `application/x-sh-media-item`                                                                                            |
| `types.ts`     | `sequence.inspect` 결과 타입                                                                                                                      |

## 엔진 커맨드 대응

| 화면 동작                        | 커맨드                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| 클립 클릭(Shift 추가, Ctrl 토글) | `timeline.select {clips:[id], add, toggle}`                                                  |
| 빈 레인 클릭                     | `edit.deselectAll` + `setPlayhead`                                                           |
| 자르기 (Ctrl+K, 툴바)            | 선택 있음: `timeline.razor {time, clip}` 선택마다. 없음: `timeline.razor {time}` (모든 트랙) |
| 삭제 (Delete)                    | `edit.clear {clips}` / 리플 켜짐: `edit.rippleDelete {clips}`                                |
| 클립 드래그                      | `timeline.move {moves:[{clip, track, time}], insert}` (삽입 토글)                            |
| 가장자리 드래그                  | `timeline.trim {clip, edge:"in"                                                              | "out", mode:"regular" | "ripple", deltaFrames}` |
| 미디어 drop                      | `timeline.place {item, track, time, insert}` (음성 트랙에 놓으면 소리만)                     |
| 잠금·음소거·숨김                 | `timeline.setTrack {track, locked                                                            | muted                 | enabled}`               |
| 스냅 토글                        | 화면 스냅 + `sequence.snap {on}`                                                             |
| 실행 취소·다시 실행              | `bridge.undo()` / `bridge.redo()`                                                            |
| 새 시퀀스 (빈 상태 버튼)         | `file.newSequence {name, width:1920, height:1080, fps:30}`                                   |

알아 둘 엔진 동작:

- `timeline.place` 는 놓은 클립을 선택 상태로 만든다. 영상 트랙에 놓으면 연결된 소리가 A1 부터 들어간다.
- `timeline.razor {time}` 에 트랙을 주지 않으면 그 시간에 걸친 모든 트랙의 클립을 자른다. `clip` 을 주면 연결 클립도 같이.
- `timeline.move` 는 연결된 클립을 함께 옮기고 `{moved, overwritten}` 를 돌려준다. `insert:true` 면 모든 트랙이 밀린다.
- `edit.rippleDelete` 는 sync-lock 된 다른 트랙에 클립이 걸리면 실패한다. 메시지를 상태 줄에 그대로 보여 준다.
- `sequence.inspect` 는 시퀀스가 없으면 "no active sequence" 로 실패한다. 그때 빈 상태를 그린다.
- 시간 단위는 tick (1초 = 254,016,000,000). 1프레임 = `TICKS_PER_SECOND * den / num`, 정수.

## 갱신 시점

- 마운트, 엔진 연결 후.
- 이 기능이 보낸 커맨드 뒤(성공·실패 모두). 실행 취소·다시 실행은 타임라인 store 가 다시 읽고, 단축키 동작은 나머지 패널만 갱신한다
  (`refreshAll(status, { timeline: false })`).
- 엔진 이벤트: features/events 의 폴링 하나(정지 250ms, 재생 100ms, 숨김 1초)가 `drainEvents` 의 projectChanged·sequenceChanged 를 올리면
  `refresh(revision)` 한다. 이미 그 revision 을 읽었으면 건너뛴다(`RevisionGate`).
- 몰린 요청: 읽는 중에 들어온 need 없는 refresh 는 뒤의 읽기 하나에 붙는다(실행 취소를 연달아 눌러도 "지금 읽기 + 마지막 한 번").
- 플레이헤드는 폴링이 `bridge.playhead()` 로 읽어 playheadChanged 로 올린다. 제스처 중에는 화면 값을 지킨다.
- 같은 순간 여러 패널이 보낸 같은 읽기(`sequence.inspect`, `project.inspect` 등)는 `engine/coalesce.ts` 가 하나로 합친다.
  수치는 `docs/guides/performance-audit.md`.

## 확인 방법

`npm run build -w apps/web` 후 `npm run preview -w apps/web -- --port 4182`, Playwright 로 1440·390 스크린샷과
데모 프로젝트(파일 > Demo Project) 에서 razor·이동·트림·삭제·실행 취소·DnD 를 돌려 본다.

## 템플릿 JSON (features/templates)

사용자 템플릿(미디어 패널 템플릿 탭 "지금 편집본을 템플릿으로 저장")은 편집본의 구조를 미디어 파일과 떼어 적은 JSON 이다. 타입과 검증은
`packages/editor/src/features/templates/format.ts`(`TemplateFile`, `parseTemplateFile`), 쓰기는 `serialize.ts`(`sequence.inspect` + 키프레임이 있는
파라미터마다 `effects.keyframes`), 읽기(적용)는 `apply.ts`(엔진 커맨드 순서). 저장소는 `EngineBridge.templates`(데스크톱 `<userData>/templates/<id>.json` +
`<id>.png`, 웹 IndexedDB `sh-video-editor-templates`, 없으면 메모리). 시간은 전부 tick.

```json
{
  "format": "sh-video-editor-template",
  "version": 1,
  "id": "tpl-m2abc-1f3a9e",
  "name": "내 인트로",
  "description": "데모 영상 위 큰 제목",
  "createdAt": 1760486400000,
  "settings": { "width": 1920, "height": 1080, "fps": 30 },
  "duration": 4064256000000,
  "slots": [{ "kind": "video", "label": "c.mp4", "duration": 1016064000000 }],
  "video": [
    {
      "clips": [
        { "kind": "slot", "slot": 0, "start": 0, "duration": 1016064000000, "speed": 1, "reverse": false, "enabled": true, "effects": [], "keyframes": [] }
      ]
    },
    {
      "clips": [
        {
          "kind": "text",
          "start": 0,
          "duration": 1270080000000,
          "enabled": true,
          "text": "제목을 입력하세요",
          "font": "Pretendard",
          "fontStyle": "Bold",
          "size": 140,
          "props": { "align": "center", "fill_color": "#ffffff", "shadow": true, "shadow_color": "#000000", "position": [960, 475] },
          "effects": [],
          "keyframes": [
            {
              "effect": "opacity",
              "param": "opacity",
              "points": [
                { "time": 0, "value": 0, "interpolation": "linear" },
                { "time": 254016000000, "value": 100, "interpolation": "linear" }
              ]
            }
          ]
        }
      ]
    }
  ],
  "audio": [],
  "transitions": [{ "track": 0, "effect": "cross_dissolve", "frames": 30, "from": 0, "to": null, "reverse": false }]
}
```

| 필드                                   | 뜻                                                                                               | 쓸 때(serialize)                                                                                                                        | 읽을 때(apply)                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings`                             | 편집본 크기와 fps(소수 셋째 자리)                                                                | `sequence.inspect.settings`                                                                                                             | `file.newSequence {width, height, fps, video, audio}` (트랙 수는 템플릿 트랙 수, 최소 3)                                                                         |
| `slots[]`                              | 미디어 자리. `kind` video, image, audio. 같은 항목을 쓰던 클립은 슬롯 하나                       | 클립의 `item` 별로 번호. 영상에 붙은 소리 클립(같은 `link`)은 적지 않는다                                                               | 고른 항목을 영상·사진은 video·image 슬롯에, 음악은 audio 슬롯에 순서대로. 모자라면 그 클립은 건너뛰고 수를 알린다                                                |
| `video[i].clips[]`, `audio[i].clips[]` | 트랙별 클립(시작 순). `kind` slot, text, matte                                                   | 텍스트 = `graphic_text` 효과가 있는 클립(`features/text/params.ts readTextStyle`), 매트 = `Synthetic` 항목 "Color Matte", 나머지 = 슬롯 | slot: `timeline.place {item, track: "V1"                                                                                                                         | "A1", time, duration, insert: false}`(사진은 길이 그대로, 영상은 길이 x 속도 배수를 놓고`clip.speedDuration {clips, speed: 배수 x 100, reverse}`), 마지막에 슬롯 영상 전부 `clip.fillFrame`. text: `graphics.newText {text, size, font, fontStyle, seconds, time, track: i}`(그 트랙이 비어 있지 않으면 track 없이 다시) 뒤`graphics.set {clip, props}`. matte: `file.newColorMatte {color, seconds}`+`timeline.place` |
| `clips[].effects[]`                    | 사용자 효과(id + 정적 파라미터)와 고정 효과의 기본값과 다른 값(opacity.opacity, motion.rotation) | inspect `effects[]` 의 `{kind, value}` 를 숫자·불·"#rrggbb"·[x, y]·문자열로. 키프레임이 있는 파라미터는 뺀다                            | 사용자 효과는 `effects.apply {clips, effect}` 뒤 파라미터마다 `effects.setParam`, 고정 효과는 `effects.setParam` 만                                              |
| `clips[].keyframes[]`                  | 파라미터별 키프레임(`time` 은 클립 시작 기준 미디어 시각)                                        | `keyframes > 0` 인 파라미터마다 `effects.keyframes {clip, effect, param}`                                                               | `effects.addKeyframe {time: start + 첫 time}` 뒤 점마다 `effects.setParam {value, time}`, 선형이 아닌 점은 `effects.setInterpolation {mediaTime, interpolation}` |
| `transitions[]`                        | 영상 트랙의 전환. `from`·`to` 는 그 트랙 `clips` 의 색인(한쪽 null 이면 페이드 인·아웃)          | `tracks[].transitions[]` 의 `from`·`to` 클립 id 를 색인으로, 길이는 프레임 수로                                                         | `from` 이 있으면 `sequence.applyVideoTransition {clip: from, edge: "out", effect, frames, reverse}`, 없으면 `{clip: to, edge: "in"}`. 실패(핸들 없음)는 건너뛴다 |

적지 않는 것: 미디어 파일 경로와 소스 시작점(sourceIn), 클립 비활성, 색 매트의 색(읽을 수 없어 `#1b1f2a`), 트랙 잠금·음소거, 마커, 자막 트랙.
`parseTemplateFile` 은 모르는 필드를 버리고 비어 있어도 되는 필드(설명, 효과, 키프레임, `enabled`, 글꼴)는 기본값으로 채우며, 형식·버전·설정·슬롯 번호·전환 색인이
틀리면 이유를 담아 던진다(가져오기 토스트에 그대로 보인다).
