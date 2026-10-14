/** 미디어 패널. 마일스톤 1 에서 가져오기·썸네일이 들어간다. */
export function MediaPanel() {
  return (
    <section className="sh-panel ve-media" aria-label="미디어">
      <div className="sh-panel__title">미디어</div>
      <div className="ve-panel-body">
        <p className="ve-hint">영상·사진·음악 파일을 여기로 끌어다 놓으세요.</p>
      </div>
    </section>
  );
}
