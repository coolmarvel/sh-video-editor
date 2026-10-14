/** 인스펙터 "속도" 탭. 선택 클립의 속도·역방향·음정 유지·리플·보간을 폼으로 바꾸고 적용, 플레이헤드에서 프레임 고정. */
import { useEffect } from 'react';
import type { InspectorContext } from '../inspector/registry';
import { SpeedForm } from './SpeedForm';
import { FREEZE_SECONDS, useSpeed } from './store';

export function SpeedTab({ sequence, clips, clip, playhead }: InspectorContext) {
  const syncFrom = useSpeed((s) => s.syncFrom);
  const apply = useSpeed((s) => s.apply);
  const freeze = useSpeed((s) => s.freeze);
  const clipId = clip?.clip ?? null;
  const clipSpeed = clip?.speed ?? 1;
  const clipReverse = clip?.reverse ?? false;
  const clipPitch = clip?.maintainPitch ?? false;
  // 선택이 바뀌거나 엔진이 값을 바꾸면 폼을 그 클립 값으로 맞춘다
  useEffect(() => {
    syncFrom(clip);
    // clip 객체는 inspect 마다 새로 오므로 값으로 비교한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId, clipSpeed, clipReverse, clipPitch, syncFrom]);

  const ids = clips.map((c) => c.clip);
  const onApply = () => void apply(ids);
  const underPlayhead = clips.some((c) => c.start <= playhead && playhead < c.end);

  return (
    <div className="ve-speed" data-speed-tab="">
      <SpeedForm clip={clip} sequence={sequence} count={clips.length} onSubmit={onApply} />
      <div className="ve-speed__actions">
        <button type="button" className="sh-btn sh-btn--primary" disabled={ids.length === 0} onClick={onApply}>
          적용
        </button>
        <button
          type="button"
          className="sh-btn"
          disabled={!underPlayhead}
          title={underPlayhead ? `플레이헤드 자리에 ${FREEZE_SECONDS}초 정지 화면을 끼워 넣습니다` : '플레이헤드를 선택한 클립 위에 놓으세요'}
          onClick={() => void freeze(clips, playhead)}
        >
          이 프레임 고정
        </button>
      </div>
    </div>
  );
}
