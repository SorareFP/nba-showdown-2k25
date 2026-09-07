// The JavaScript half of motion.css — for movement that CSS cannot express on
// its own, which in this app means anything that has to count.
import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether this player has asked for less movement.
 *
 * motion.css already collapses every transition and @keyframes for them, but a
 * tumbling die is not a CSS animation — it is a setInterval swapping numbers,
 * and CSS cannot reach it. Anything driven from JS has to ask.
 *
 * Defaults to false where matchMedia does not exist (server, older test
 * environments) so the animation is the fallback, not the exception.
 */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    try { return globalThis.matchMedia?.(QUERY).matches ?? false; }
    catch { return false; }
  });

  useEffect(() => {
    const mq = globalThis.matchMedia?.(QUERY);
    if (!mq) return undefined;
    const onChange = e => setReduced(e.matches);
    // Safari below 14 has no addEventListener on a MediaQueryList.
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  return reduced;
}
