// HAS THIS BROWSER PLAYED A GAME YET? A local flag, set the first time any
// game deals (or the tutorial completes) and read by App for the banner that
// points a newcomer at the tutorial. The user (2026-09-08): "For players who
// have not played a game yet, I think we should have a banner directing them
// to the tutorial." Local on purpose: the banner is about this screen's
// first minutes, and a returning player on a new device losing it once is a
// smaller wrong than a newcomer never seeing it.
const KEY = 'showdown.playedGame';
export const PLAYED_EVENT = 'showdown-played';

export function hasPlayedBefore() {
  try { return globalThis.localStorage?.getItem(KEY) === '1'; } catch { return false; }
}

export function markPlayed() {
  try {
    if (globalThis.localStorage?.getItem(KEY) === '1') return;
    globalThis.localStorage?.setItem(KEY, '1');
  } catch { /* no storage: the banner simply stays */ }
  try { globalThis.dispatchEvent?.(new Event(PLAYED_EVENT)); } catch { /* not a browser */ }
}
