// WHAT A COMPETITION IS WORTH — tournament pools, season titles, the dynasty
// income factor. Every number here is a decision, in one place; the design
// note (docs/plans/2026-09-07-game-modes-design.md) marks which are the
// user's and which are mine to be re-tuned.
//
// A game inside any mode still pays exactly what a sandbox game pays
// (src/game/coinRewards.js, through claimGameReward). Nothing here doubles
// that: these are the extras a competition adds on top.

/** Tournament entry fees offered, in coins. Zero is a free bracket. */
export const ENTRY_FEES = [0, 50, 100, 250, 500];

/** Tournament sizes offered. */
export const TOURNAMENT_SIZES = [4, 8, 16];

/** Share of the pool the champion takes outright; the rest is split per match win. */
export const CHAMPION_SHARE = 0.5;

/** The pool: every fee, paid out in full. */
export function prizePool(fee, size) {
  return Math.max(0, Math.floor(fee)) * size;
}

/**
 * The payout schedule for a bracket of `size` at `fee`:
 *   perWin    — coins for every match won, any round
 *   champion  — the outright half, plus rounding remainders
 * A bracket of N has N-1 matches, so N-1 wins are paid.
 */
export function tournamentPayouts(size, fee) {
  const pool = prizePool(fee, size);
  const matches = size - 1;
  const winsPot = Math.floor(pool * (1 - CHAMPION_SHARE));
  const perWin = matches > 0 ? Math.floor(winsPot / matches) : 0;
  const champion = pool - perWin * matches;
  return { pool, perWin, champion, matches };
}

/** What one entrant is owed, given their match wins and whether they won it all. */
export function tournamentEarnings(size, fee, { wins = 0, champion = false } = {}) {
  const p = tournamentPayouts(size, fee);
  return p.perWin * wins + (champion ? p.champion : 0);
}

/**
 * Season title money, by length. Regular-season wins are paid by the games
 * themselves; this is what the season adds once, at the end.
 */
export const SEASON_REWARDS = {
  short: { champion: 200, runnerUp: 100, playoffs: 50 },
  regular: { champion: 400, runnerUp: 200, playoffs: 100 },
  long: { champion: 700, runnerUp: 350, playoffs: 150 },
};

/** The one line a finished season pays a human team. */
export function seasonEarnings(lengthId, { champion = false, runnerUp = false, madePlayoffs = false } = {}, factor = 1) {
  const r = SEASON_REWARDS[lengthId] ?? SEASON_REWARDS.regular;
  let coins = 0;
  let label = null;
  if (champion) { coins = r.champion; label = 'Season Champion'; }
  else if (runnerUp) { coins = r.runnerUp; label = 'Runner-up'; }
  else if (madePlayoffs) { coins = r.playoffs; label = 'Made the Playoffs'; }
  return { coins: Math.floor(coins * factor), label };
}

// ── DYNASTY ─────────────────────────────────────────────────────────────────
//
// A dynasty is ten seasons (docs/plans/2026-09-11-dynasty-design.md). Each one
// pays the Season title money above, claimed once per year, and finishing all
// ten pays a bonus on top.
//
// THE FANTASY BUFF REVERSED THE 2026-09-07 NERF. That day's rule halved a
// fantasy-draft dynasty's coins; the user, 2026-09-11: "if you do a fantasy
// draft, that should be buffed quite a bit." 1.5 is my reading of "decently
// substantial" — one number, here. It multiplies the title money and the
// completion bonus, never a game's own coins.

export const DYNASTY_YEARS = 10;
export const FANTASY_DYNASTY_FACTOR = 1.5;

/** The coin multiplier for a dynasty's start: any fantasy draft is buffed. */
export function dynastyCoinFactor(startMode) {
  return String(startMode ?? '').startsWith('fantasy') ? FANTASY_DYNASTY_FACTOR : 1;
}

/** Finishing all ten seasons, by season length, plus a bonus for every title. */
export const DYNASTY_COMPLETION = { short: 600, regular: 1000, long: 1500 };
export const DYNASTY_TITLE_BONUS = 150;

const dynastyHuman = dynasty => dynasty?.humanId ?? 'you';

/** A dynasty's titles so far. */
export function dynastyTitles(dynasty) {
  const me = dynastyHuman(dynasty);
  return (dynasty?.history ?? []).filter(h => h.champion === me).length;
}

/** What one finished year of a dynasty pays, from its own history. */
export function dynastyYearEarnings(dynasty, year) {
  const h = (dynasty?.history ?? []).find(x => x.year === year);
  if (!h) return { coins: 0, label: null };
  const me = dynastyHuman(dynasty);
  return seasonEarnings(dynasty.length, {
    champion: h.champion === me,
    runnerUp: h.runnerUp === me,
    madePlayoffs: (h.playoffSeeds ?? []).includes(me),
  }, dynastyCoinFactor(dynasty.startMode));
}

/** The ten-year bonus: nothing until the dynasty is over and all ten are in the book. */
export function dynastyCompletionEarnings(dynasty) {
  const years = new Set((dynasty?.history ?? []).map(h => h.year));
  if (dynasty?.phase !== 'done' || years.size < DYNASTY_YEARS) return { coins: 0, label: null };
  const base = DYNASTY_COMPLETION[dynasty.length] ?? DYNASTY_COMPLETION.regular;
  const titles = dynastyTitles(dynasty);
  const coins = Math.floor((base + titles * DYNASTY_TITLE_BONUS) * dynastyCoinFactor(dynasty.startMode));
  return { coins, label: titles ? `Ten-year dynasty · ${titles} title${titles === 1 ? '' : 's'}` : 'Ten-year dynasty' };
}

/**
 * What a claim on a stored dynasty pays — `which` is a year (1–10) or
 * 'complete'. One judge for the server and the browser's direct route:
 * `{ coins, label, id }` to pay, or `{ error }`. The history has to be one
 * entry a year from year one, in order, or it was not written by this mode.
 */
export function dynastyClaim(dynasty, which) {
  const hist = dynasty?.history ?? [];
  if (hist.some((h, i) => h.year !== i + 1)) return { error: 'That dynasty\'s history does not add up' };
  if (which === 'complete') {
    const r = dynastyCompletionEarnings(dynasty);
    return r.coins ? { ...r, id: 'complete' } : { error: 'That dynasty is not finished' };
  }
  const year = Number(which);
  if (!Number.isInteger(year) || year < 1 || year > DYNASTY_YEARS) return { error: 'No such year' };
  const r = dynastyYearEarnings(dynasty, year);
  if (!hist.some(h => h.year === year)) return { error: 'That year has not been played' };
  return r.coins ? { coins: r.coins, label: `Year ${year} · ${r.label}`, id: String(year) } : { error: 'That year finished out of the money' };
}
