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

/**
 * THE ROOMY STEP, App.module.css's first wide step: past 1600px the app
 * column grows from 1200 to 1520, and the court's five matchup rows grow with
 * it — at 1920 x 1080 the rows alone stood 2,690px tall. The zig-zag floor
 * switches on HERE, not at WIDE_MIN_WIDTH (2026-09-24): a 4K monitor under
 * Windows display scaling is 1920 (200%) or 2194 (175%) CSS pixels wide, so
 * the 2200 step never reached the screen the zig-zag was drawn for.
 */
export const ROOMY_MIN_WIDTH = 1600;
export const ROOMY_QUERY = `(min-width: ${ROOMY_MIN_WIDTH}px)`;

const matchesNow = query => {
  try { return globalThis.matchMedia?.(query).matches ?? false; }
  catch { return false; }
};

export function isWideNow() {
  return matchesNow(WIDE_QUERY);
}

function useMediaQuery(query) {
  const [on, setOn] = useState(() => matchesNow(query));

  useEffect(() => {
    const mq = globalThis.matchMedia?.(query);
    if (!mq) return undefined;
    const onChange = e => setOn(e.matches);
    setOn(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, [query]);

  return on;
}

/** Past 2200px: the docked game-log rail and the zoomed board (PlayTab). */
export function useIsWide() {
  return useMediaQuery(WIDE_QUERY);
}

/** Past 1600px: the zig-zag floor (CourtBoard). */
export function useIsRoomy() {
  return useMediaQuery(ROOMY_QUERY);
}
