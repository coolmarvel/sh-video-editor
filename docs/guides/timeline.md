---
title: 타임라인 (트랙·클립·razor·이동·트림·끌어다 놓기)
created: 2026-10-14
updated: 2026-10-14
domain: editor
---

# 타임라인

마일스톤 1 의 타임라인. 코드는 `packages/editor/src/features/timeline/`, 셸 `shell/Timeline.tsx` 는 이 기능을
렌더만 한다. 모양 계약은 `DESIGN.md` 4.15.

## 파일

| 파일           | 역할                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| `store.ts`     | zustand 상태. 편집은 전부 `EngineBridge.execute` 로 커맨드를 보내고 끝나면 `sequence.inspect` 재조회 |
| `Timeline.tsx` | 툴바·눈금자·트랙·플레이헤드, 포인터 제스처(스크럽·이동·트림), 단축키, 미디어 drop                    |
| `Track.tsx`    | 트랙 머리(잠금·음소거·숨김 토글), 레인, 클립 블록(트림 핸들)                                         |
| `Ruler.tsx`    | 보이는 구간의 눈금과 타임코드 라벨, 플레이헤드 머리                                                  |
| `geometry.ts`  | tick 과 px 변환, 프레임 스냅, 눈금 간격, 스냅 보정 (순수 함수)                                       |
| `dnd.ts`       | 미디어 패널과의 DnD 계약 `application/x-sh-media-item`                                               |
| `types.ts`     | `sequence.inspect` 결과 타입                                                                         |

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
- 이 기능이 보낸 커맨드 뒤(성공·실패 모두).
- 루트 `useEditor.status` 가 바뀔 때(메뉴 등 다른 곳에서 커맨드를 실행한 뒤) 60ms 뒤 재조회.
- 플레이헤드는 200ms 마다 `bridge.playhead()` 를 읽는다(모니터 재생을 따라가기 위해). 제스처 중에는 읽지 않는다.
  엔진 이벤트(`drainEvents`) 통합은 아직 없다.

## 확인 방법

`npm run build -w apps/web` 후 `npm run preview -w apps/web -- --port 4182`, Playwright 로 1440·390 스크린샷과
데모 프로젝트(파일 > Demo Project) 에서 razor·이동·트림·삭제·실행 취소·DnD 를 돌려 본다.
