/**
 * 미디어 패널 "스티커" 탭. 분류별 카드 격자(직접 그린 SVG 20종 + 움직이는 Lottie 스티커 10종). 클릭하면 플레이헤드에 5초 스티커
 * 클립을 넣고, 위치·크기는 인스펙터 "모션" 탭이나 미리보기 끌기로 바꾼다. 움직이는 스티커 카드는 정지 자세 미리보기에 재생
 * 표식이 붙는다. DESIGN.md 4.23
 */
import { useStickers } from './store';
import { STICKER_CATEGORIES, isAnimated, stickerDataUrl, stickersInCategory } from './catalog';
import { useTimeline } from '../timeline/store';
import './stickers.css';

export function StickerGallery() {
  const sequence = useTimeline((s) => s.sequence);
  const busy = useStickers((s) => s.busy);
  const addSticker = useStickers((s) => s.addSticker);
  const disabled = busy || !sequence;
  return (
    <div className="stk-gallery" aria-label="스티커 갤러리" data-testid="sticker-gallery">
      <p className="ve-inspector__hint stk-hint">
        {sequence
          ? '클릭하면 플레이헤드 위치에 5초 스티커를 넣습니다. 위치, 크기는 모션 탭에서. 움직이는 스티커는 클립 길이 동안 반복됩니다.'
          : '편집본을 만들면 스티커를 넣을 수 있습니다.'}
      </p>
      <div className="sh-scroll stk-body">
        {STICKER_CATEGORIES.map((cat) => (
          <section key={cat.id} className="stk-folder" aria-label={cat.label}>
            <h3 className="stk-folder__title">{cat.label}</h3>
            <ul className="stk-cards" aria-label={`${cat.label} 스티커`}>
              {stickersInCategory(cat.id).map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="stk-card"
                    data-sticker={s.id}
                    data-animated={isAnimated(s) ? 'true' : undefined}
                    disabled={disabled}
                    title={isAnimated(s) ? `${s.label} 넣기 (움직이는 스티커, 반복)` : `${s.label} 넣기`}
                    onClick={() => void addSticker(s.id)}
                  >
                    <span className="stk-card__frame">
                      <img className="stk-card__img" src={stickerDataUrl(s.svg)} alt="" draggable={false} />
                      {isAnimated(s) ? (
                        <span className="stk-card__anim" aria-hidden="true">
                          <svg viewBox="0 0 8 8" width="8" height="8" focusable="false">
                            <path d="M1 0l7 4-7 4z" fill="currentColor" />
                          </svg>
                        </span>
                      ) : null}
                    </span>
                    <span className="stk-card__label">{s.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
