// THE PHONE BREAKPOINT, for the few places where CSS alone cannot do it.
//
// Almost all of the phone layout is plain media queries in the module files,
// at the same width as PHONE_QUERY. This hook is for the handful of places
// where the MARKUP has to differ, not just the styling: a card tile swapped
// for a one-line row, the game log moved into a drawer, the hand folded into
// a strip. Rendering both and hiding one would double the DOM on the pages
// that are already the heaviest.
//
// Same shape as usePrefersReducedMotion (motion.js): false where matchMedia
// does not exist, so the server render and the test environment get the
// desktop layout, which is the one every existing test was written against.
import { useEffect, useState } from 'react';

export const PHONE_MAX_WIDTH = 768;
export const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;

export function isPhoneNow() {
  try { return globalThis.matchMedia?.(PHONE_QUERY).matches ?? false; }
  catch { return false; }
}

export function useIsPhone() {
  const [phone, setPhone] = useState(isPhoneNow);

  useEffect(() => {
    const mq = globalThis.matchMedia?.(PHONE_QUERY);
    if (!mq) return undefined;
    const onChange = e => setPhone(e.matches);
    setPhone(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  return phone;
}
