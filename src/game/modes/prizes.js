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
  // The Civ lengths (schedule.js), scaled with the games a team plays.
  online: { champion: 200, runnerUp: 100, playoffs: 50 },
  quick: { champion: 400, runnerUp: 200, playoffs: 100 },
  standard: { champion: 700, runnerUp: 350, playoffs: 150 },
  epic: { champion: 950, runnerUp: 475, playoffs: 200 },
  marathon: { champion: 1400, runnerUp: 700, playoffs: 300 },
  // The ids before the Civ names — seasons saved under them are still paid.
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
// A FANTASY DRAFT PAYS HALF. The 2026-09-07 rule halved a fantasy-draft
// dynasty's coins; on 2026-09-11 it was briefly turned into a 1.5× buff, and
// the user corrected it the same day: "I think I said fantasy draft should buff
// coin output -- I meant nerf." A fantasy draft hands you any card in the set
// without owning it; bringing your own team is the path the collection earns.
// One number, here. It multiplies the title money and the completion bonus,
// never a game's own coins.

export const DYNASTY_YEARS = 10;
export const FANTASY_DYNASTY_FACTOR = 0.5;

/** The coin multiplier for a dynasty's start: any fantasy draft pays FANTASY_DYNASTY_FACTOR. */
export function dynastyCoinFactor(startMode) {
  return String(startMode ?? '').startsWith('fantasy') ? FANTASY_DYNASTY_FACTOR : 1;
}

/** Finishing all ten seasons, by season length, plus a bonus for every title. */
export const DYNASTY_COMPLETION = {
  online: 600, quick: 1000, standard: 1500, epic: 2000, marathon: 2800,
  short: 600, regular: 1000, long: 1500,
};
export const DYNASTY_TITLE_BONUS = 150;

const dynastyHuman = dynasty => dynasty?.humanId ?? 'you';

/** A dynasty's titles so far — its human's, or one coach's in a dynasty with friends. */
export function dynastyTitles(dynasty, teamId = dynastyHuman(dynasty)) {
  return (dynasty?.history ?? []).filter(h => h.champion === teamId).length;
}

/** What one finished year of a dynasty pays a team, from its own history. */
export function dynastyYearEarnings(dynasty, year, teamId = dynastyHuman(dynasty)) {
  const h = (dynasty?.history ?? []).find(x => x.year === year);
  if (!h) return { coins: 0, label: null };
  const me = teamId;
  return seasonEarnings(dynasty.length, {
    champion: h.champion === me,
    runnerUp: h.runnerUp === me,
    madePlayoffs: (h.playoffSeeds ?? []).includes(me),
  }, dynastyCoinFactor(dynasty.startMode));
}

/** The ten-year bonus: nothing until the dynasty is over and all ten are in the book. */
export function dynastyCompletionEarnings(dynasty, teamId = dynastyHuman(dynasty)) {
  const years = new Set((dynasty?.history ?? []).map(h => h.year));
  if (dynasty?.phase !== 'done' || years.size < DYNASTY_YEARS) return { coins: 0, label: null };
  const base = DYNASTY_COMPLETION[dynasty.length] ?? DYNASTY_COMPLETION.regular;
  const titles = dynastyTitles(dynasty, teamId);
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
  // An aging dynasty runs past ten (2026-09-11); a hundred is only a sanity bound.
  if (!Number.isInteger(year) || year < 1 || year > 100) return { error: 'No such year' };
  const r = dynastyYearEarnings(dynasty, year);
  if (!hist.some(h => h.year === year)) return { error: 'That year has not been played' };
  return r.coins ? { coins: r.coins, label: `Year ${year} · ${r.label}`, id: String(year) } : { error: 'That year finished out of the money' };
}
