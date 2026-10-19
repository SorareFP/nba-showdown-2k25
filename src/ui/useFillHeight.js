// FILL TO THE WINDOW'S BOTTOM. The user (2026-10-19, of the team editor's card
// list): "Need the collection team builder to take up the height of the page".
// A fixed max-height (520px) left most of a tall window empty under the list.
//
// Sets --fill-h on the element: the room from its top (with the page scrolled
// to the top) to the window's bottom, less `gap`, never under `min`. The
// stylesheet reads it as the max-height, so a phone rule that drops the inner
// scroller (max-height: none) still wins. Re-measured on every render (the
// roster chips above can wrap to a new row) and on resize.
import { useEffect, useLayoutEffect } from 'react';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function useFillHeight(ref, { min = 360, gap = 24 } = {}) {
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.setProperty('--fill-h', `${Math.max(min, Math.round(window.innerHeight - top - gap))}px`);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  });
}
