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

/**
 * The user's rule: "playing with your own cards should be what drives currency
 * income" — a dynasty begun with a fantasy draft of the whole pool earns
 * half, per game and per title.
 */
export const FANTASY_DRAFT_FACTOR = 0.5;
export function dynastyCoinFactor(startMode) {
  return startMode === 'fantasy' ? FANTASY_DRAFT_FACTOR : 1;
}
