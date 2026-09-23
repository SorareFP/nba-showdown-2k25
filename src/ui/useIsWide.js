// THE WIDE-MONITOR BREAKPOINT, for the one place where CSS alone cannot do it.
//
// Same shape as useIsPhone: the markup differs, not just the styling. On a
// big monitor the game log and the analytics leave the column above the
// court and dock in a rail beside it, open and tall, so a whole game reads
// without scrolling (the user, 2026-09-23, on a 3840 x 2160 screen: "Can we
// leverage this for ... the actual playing of the games?"). Rendering both
// placements and hiding one would mount the log twice.
//
// False where matchMedia does not exist, so tests and the server render get
// the ordinary layout every existing test was written against. The width is
// App.module.css's wide step, where the app column grows past 2,000 pixels.
import { useEffect, useState } from 'react';

export const WIDE_MIN_WIDTH = 2200;
export const WIDE_QUERY = `(min-width: ${WIDE_MIN_WIDTH}px)`;

export function isWideNow() {
  try { return globalThis.matchMedia?.(WIDE_QUERY).matches ?? false; }
  catch { return false; }
}

export function useIsWide() {
  const [wide, setWide] = useState(isWideNow);

  useEffect(() => {
    const mq = globalThis.matchMedia?.(WIDE_QUERY);
    if (!mq) return undefined;
    const onChange = e => setWide(e.matches);
    setWide(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  return wide;
}
