/** 글 안의 괄호 일시 `(yyyy-mm-dd hh:mm:ss)` 를 줄바꿈하지 않는 한 덩어리로 그린다. 모자라면 덩어리째 다음 줄로 간다. */
import { splitStamps } from '../datetime';

export function StampText({ text }: { text: string }) {
  return (
    <>
      {splitStamps(text).map((p, i) =>
        p.stamp ? (
          <span key={i} className="ve-nowrap">
            {p.text}
          </span>
        ) : (
          p.text
        ),
      )}
    </>
  );
}
