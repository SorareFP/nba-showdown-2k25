// THE LIVE SERIES TABLE'S WINDOWS (2026-10-28; the user: "'latest changes,'
// 7-21 day windows, since start of season"). One rule for where a window
// opens, read by the table (liveMoves.js) and by the nightly job, which keeps
// the charts the widest day window can reach (scripts/cardgen/liveHistory.js).
// Kept apart from liveMoves.js so the job can read it without the card sets.

export const LIVE_WINDOWS = [
  { key: 'latest', label: 'Latest night' },
  { key: '7', label: '7 days', days: 7 },
  { key: '21', label: '21 days', days: 21 },
  { key: 'season', label: 'Season' },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const dayOf = date => Date.parse(`${date}T00:00:00Z`);

/**
 * The night (an index into `nights`, the dates the job ran, oldest first) a
 * window compares against: the night before the latest; for a day window the
 * last night at least that many days before the latest, so a skipped night
 * never shortens it; the first night for the season, and for a window longer
 * than the history so far.
 */
export function anchorIndex(nights, key) {
  const n = nights?.length ?? 0;
  if (n === 0 || key === 'season') return 0;
  if (key === 'latest') return Math.max(0, n - 2);
  const days = LIVE_WINDOWS.find(w => w.key === key)?.days;
  if (!days) return 0;
  const cutoff = dayOf(nights[n - 1]) - days * DAY_MS;
  for (let i = n - 1; i >= 0; i -= 1) if (dayOf(nights[i]) <= cutoff) return i;
  return 0;
}
