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

// ── PAID BY THE SHARE YOU PLAYED (2026-09-18) ──────────────────────────────
//
// A solo season's commissioner tools include "Sim it" on your own game, and a
// season with every one of your games simmed still paid its full title money
// — minutes of clicking for a purse sized for a schedule of games. The user's
// decision: "Pay by share played — title/year money is multiplied by the share
// of your own games you actually played (simmed ones don't count)."
//
// Counted from the results the season itself keeps: every result, regular
// season and playoffs, where your team is home or away, and `simulated` marks
// one you did not play (simulate.js stamps it; a game you played comes back
// through resultFromPlayed without it). Friends leagues are NOT counted this
// way — their forfeits and commissioner sims are not the coach's own clicks,
// and they keep their own rules (league.js).

/** Your games in a list of results: `{ played, total }`, simulated ones not played. */
export function ownGamesPlayed(results, teamId) {
  let played = 0;
  let total = 0;
  for (const r of Array.isArray(results) ? results : []) {
    if (!r || (r.home !== teamId && r.away !== teamId)) continue;
    total += 1;
    if (!r.simulated) played += 1;
  }
  return { played, total };
}

/** The share of your games you played, 0–1. No games at all is a full share (nothing was simmed). */
export function playedShare(own) {
  const total = Number(own?.total) || 0;
  if (total <= 0) return 1;
  return Math.max(0, Math.min(1, (Number(own?.played) || 0) / total));
}

/** Why a purse the standings earned pays nothing: every one of your games was simmed. */
export const SIMMED_OUT = 'Every game of yours was simmed — title money is paid by the share you played';

/** The words a purse cut by the share carries, or '' when nothing was cut. */
export function shareNote(own) {
  return playedShare(own) < 1 ? ` · ${own.played} of ${own.total} games played` : '';
}

/**
 * WHAT A FINISHED SOLO SEASON PAYS — the title money times the fantasy factor
 * times the share you played. One judge for the server (claimSeasonReward),
 * the browser's direct route and the season screen's claim button, so all
 * three show and pay the same number. `{ coins, label, own, share, simmedOut }`:
 * `simmedOut` is a purse the standings earned and the share took to nothing.
 */
export function soloSeasonPurse(season) {
  const mine = (season?.teams ?? []).find(t => t.human);
  if (!mine) return { coins: 0, label: null, own: { played: 0, total: 0 }, share: 1, simmedOut: false };
  const flags = {
    champion: season.champion === mine.id,
    runnerUp: season.runnerUp === mine.id,
    madePlayoffs: (season.playoffSeeds ?? []).includes(mine.id),
  };
  const own = ownGamesPlayed(season.results, mine.id);
  const share = playedShare(own);
  const full = seasonEarnings(season.length, flags, dynastyCoinFactor(season.startMode));
  const paid = seasonEarnings(season.length, flags, dynastyCoinFactor(season.startMode) * share);
  return {
    coins: paid.coins,
    label: full.label ? `${full.label}${shareNote(own)}` : null,
    own,
    share,
    simmedOut: full.coins > 0 && paid.coins === 0,
  };
}

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

/**
 * THE SHARE A SOLO DYNASTY'S COACH PLAYED (2026-09-18, "pay by share played").
 * A year's history entry carries `own: { played, total }` — the human's games
 * that year, counted when the season closed (dynasty.js endSeason) from the
 * season's own results. Only a SOLO dynasty's entries carry it: a dynasty with
 * friends keeps its own rules (league.js pays it), so its entries have none,
 * and a year closed before the count existed has none either — those are paid
 * in full, because nothing says what was simmed in them.
 *
 * `year` null is the whole dynasty: every year that carries a count, summed —
 * what the ten-year bonus is paid by.
 */
export function dynastyOwnPlayed(dynasty, year = null, teamId = dynastyHuman(dynasty)) {
  if (teamId !== dynastyHuman(dynasty)) return null;
  const rows = (dynasty?.history ?? []).filter(h => h?.own && (year == null || h.year === year));
  if (!rows.length) return null;
  return rows.reduce((t, h) => ({
    played: t.played + (Number(h.own.played) || 0),
    total: t.total + (Number(h.own.total) || 0),
  }), { played: 0, total: 0 });
}

/** What one finished year of a dynasty pays a team, from its own history. */
export function dynastyYearEarnings(dynasty, year, teamId = dynastyHuman(dynasty)) {
  const h = (dynasty?.history ?? []).find(x => x.year === year);
  if (!h) return { coins: 0, label: null };
  const me = teamId;
  const flags = {
    champion: h.champion === me,
    runnerUp: h.runnerUp === me,
    madePlayoffs: (h.playoffSeeds ?? []).includes(me),
  };
  // The year money times the share of that year's own games the coach played.
  const own = dynastyOwnPlayed(dynasty, year, teamId);
  const r = seasonEarnings(dynasty.length, flags, dynastyCoinFactor(dynasty.startMode) * playedShare(own));
  return { ...r, label: r.label ? `${r.label}${shareNote(own)}` : null };
}

/** The ten-year bonus: nothing until the dynasty is over and all ten are in the book. */
export function dynastyCompletionEarnings(dynasty, teamId = dynastyHuman(dynasty)) {
  const years = new Set((dynasty?.history ?? []).map(h => h.year));
  if (dynasty?.phase !== 'done' || years.size < DYNASTY_YEARS) return { coins: 0, label: null };
  const base = DYNASTY_COMPLETION[dynasty.length] ?? DYNASTY_COMPLETION.regular;
  const titles = dynastyTitles(dynasty, teamId);
  // Paid by the share of the whole dynasty's own games played (2026-09-18).
  const own = dynastyOwnPlayed(dynasty, null, teamId);
  const coins = Math.floor((base + titles * DYNASTY_TITLE_BONUS) * dynastyCoinFactor(dynasty.startMode) * playedShare(own));
  const label = titles ? `Ten-year dynasty · ${titles} title${titles === 1 ? '' : 's'}` : 'Ten-year dynasty';
  return { coins, label: `${label}${shareNote(own)}` };
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
    if (!r.coins && r.label && playedShare(dynastyOwnPlayed(dynasty)) === 0) return { error: SIMMED_OUT };
    return r.coins ? { ...r, id: 'complete' } : { error: 'That dynasty is not finished' };
  }
  const year = Number(which);
  // An aging dynasty runs past ten (2026-09-11); a hundred is only a sanity bound.
  if (!Number.isInteger(year) || year < 1 || year > 100) return { error: 'No such year' };
  const r = dynastyYearEarnings(dynasty, year);
  if (!hist.some(h => h.year === year)) return { error: 'That year has not been played' };
  if (!r.coins && r.label && playedShare(dynastyOwnPlayed(dynasty, year)) === 0) return { error: SIMMED_OUT };
  return r.coins ? { coins: r.coins, label: `Year ${year} · ${r.label}`, id: String(year) } : { error: 'That year finished out of the money' };
}
