import { useEffect, useState, type RefObject } from 'react';
import { LAYOUT_LIMITS } from './store';

/** 화면에서 잰 현재 크기와 그에 따른 한계. 모두 px. */
export interface LayoutMetrics {
  /** 측정 전이거나 한 열 배치(모바일)라서 스플리터가 없는 상태 */
  ready: boolean;
  mediaWidth: number;
  mediaMin: number;
  mediaMax: number;
  timelineHeight: number;
  timelineMin: number;
  timelineMax: number;
}

const EMPTY: LayoutMetrics = {
  ready: false,
  mediaWidth: 0,
  mediaMin: LAYOUT_LIMITS.mediaMin,
  mediaMax: LAYOUT_LIMITS.mediaMin,
  timelineHeight: 0,
  timelineMin: LAYOUT_LIMITS.timelineMin,
  timelineMax: LAYOUT_LIMITS.timelineMin,
};

function same(a: LayoutMetrics, b: LayoutMetrics): boolean {
  return (
    a.ready === b.ready &&
    a.mediaWidth === b.mediaWidth &&
    a.mediaMin === b.mediaMin &&
    a.mediaMax === b.mediaMax &&
    a.timelineHeight === b.timelineHeight &&
    a.timelineMin === b.timelineMin &&
    a.timelineMax === b.timelineMax
  );
}

/**
 * 루트(.ve-root) 아래 패널들의 실제 크기를 ResizeObserver 로 따라간다.
 * 한계는 뷰포트 비율과 "이웃 패널에 남겨야 할 최소" 중 작은 쪽이다. 측정값이므로 메뉴바·상태 줄 높이를 따로 알 필요가 없다.
 */
export function useLayoutMetrics(rootRef: RefObject<HTMLElement | null>): LayoutMetrics {
  const [metrics, setMetrics] = useState<LayoutMetrics>(EMPTY);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const body = root.querySelector<HTMLElement>(':scope > .ve-body');
      const media = root.querySelector<HTMLElement>(':scope > .ve-body > .ve-media');
      const monitor = root.querySelector<HTMLElement>(':scope > .ve-body > .ve-monitor');
      const timeline = root.querySelector<HTMLElement>(':scope > .ve-timeline');
      const colSplitter = root.querySelector<HTMLElement>(':scope > .ve-body > .ve-splitter');
      if (!body || !media || !monitor || !timeline || !colSplitter || colSplitter.offsetParent === null) {
        setMetrics((m) => (same(m, EMPTY) ? m : EMPTY));
        return;
      }
      const vw = root.clientWidth;
      const vh = root.clientHeight;
      const mediaWidth = Math.round(media.getBoundingClientRect().width);
      const monitorWidth = Math.round(monitor.getBoundingClientRect().width);
      const bodyHeight = Math.round(body.getBoundingClientRect().height);
      const timelineHeight = Math.round(timeline.getBoundingClientRect().height);
      const mediaMin = LAYOUT_LIMITS.mediaMin;
      const mediaMax = Math.max(mediaMin, Math.min(Math.floor(vw * LAYOUT_LIMITS.mediaMaxRatio), mediaWidth + monitorWidth - LAYOUT_LIMITS.monitorMin));
      const timelineMin = LAYOUT_LIMITS.timelineMin;
      const timelineMax = Math.max(timelineMin, Math.min(Math.floor(vh * LAYOUT_LIMITS.timelineMaxRatio), bodyHeight + timelineHeight - LAYOUT_LIMITS.bodyMin));
      const next: LayoutMetrics = {
        ready: true,
        mediaWidth,
        mediaMin,
        mediaMax,
        timelineHeight,
        timelineMin,
        timelineMax,
      };
      setMetrics((m) => (same(m, next) ? m : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    for (const el of root.querySelectorAll<HTMLElement>(':scope > .ve-body, :scope > .ve-body > *, :scope > .ve-timeline')) {
      ro.observe(el);
    }
    // 데모 프로젝트를 열면 타임라인 내용이 바뀌어 자식이 교체될 수 있다. 루트 자식 변화도 다시 잰다
    const mo = new MutationObserver(measure);
    mo.observe(root, { childList: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [rootRef]);

  return metrics;
}
