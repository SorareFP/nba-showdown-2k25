// END-OF-SEASON AWARDS, decided on the regular season.
//
// The user, 2026-09-10: "Would also be fun to have end-of-season awards like
// MVP, Defensive Player of the Year, etc. Could have it calculated by VORP
// and whatever defensive metrics." Then, on the proposal: "DPOY should be
// like points per minute played or something like that, with a threshold to
// qualify."
//
// Read from `season.regStats`, the snapshot startPlayoffs takes of the
// season's totals when the regular season ends — playoff games fold into
// `season.stats` too, and an award is a regular-season honour. A season that
// reached the playoffs before the snapshot existed falls back to `stats` and
// says so (`basis: 'all'`).
//
// Client-only: it reads card data (for the Rookie set) and the engine's
// spend costs, so it is deliberately NOT imported by seasonCore, which the
// server bundle copies.
import { standings } from './seasonCore.js';
import { getCardByKey } from '../cardSets.js';
import { SPEND_COSTS } from '../engine.js';

/** Sets whose cards are a player's rookie season. */
export const ROOKIE_SETS = ['rookie', 'wnba-rookie'];

/**
 * WHAT A REBOUND AND AN ASSIST ARE WORTH, in points: what spending them buys.
 * Five assists buy a 3PT check and five rebounds a paint check; at a typical
 * contested conversion of about 30% that is 0.9 and 0.6 points per spend.
 */
export const CHECK_RATE = 0.3;
export const AST_VALUE = (3 * CHECK_RATE) / SPEND_COSTS.assistThree;
export const REB_VALUE = (2 * CHECK_RATE) / SPEND_COSTS.reboundPaint;

/** Every award asks for at least this share of his team's regular-season games. */
export const MIN_GAMES_SHARE = 0.5;
/** DPOY's minutes threshold: this many a game, over the games that measured defence. */
export const DPOY_MIN_MPG = 16;
/** Replacement level: this percentile of the league's value per minute. */
export const REPLACEMENT_PERCENTILE = 0.2;

/** Points plus what his rebounds and assists buy. */
export function valueOf(row) {
  return (row.pts || 0) + AST_VALUE * (row.ast || 0) + REB_VALUE * (row.reb || 0);
}

/**
 * The league's replacement rate: value per minute at the 20th percentile of
 * everyone who played. A player at that rate adds nothing over a card off the
 * bottom of the pool; VORP counts what he adds above it, over his minutes.
 */
export function replacementRate(rows) {
  const rates = rows.filter(r => (r.min || 0) > 0).map(r => valueOf(r) / r.min).sort((a, b) => a - b);
  if (!rates.length) return 0;
  return rates[Math.floor(REPLACEMENT_PERCENTILE * (rates.length - 1))];
}

/** Value over replacement: (his value per minute − replacement) × his minutes. */
export function vorpOf(row, replacement) {
  if (!(row.min > 0)) return 0;
  return (valueOf(row) / row.min - replacement) * row.min;
}

const best = (rows, score, tiebreak) =>
  rows.reduce((top, r) => {
    if (!top) return r;
    const d = score(r) - score(top);
    if (d > 1e-9) return r;
    if (d < -1e-9) return top;
    return tiebreak(r) > tiebreak(top) ? r : top;
  }, null);

/**
 * The season's awards. Each is `{ id, label, team, key, ...numbers }` or null
 * when nobody qualifies.
 */
export function seasonAwards(season) {
  const rows = Array.isArray(season?.regStats) ? season.regStats : (season?.stats ?? []);
  const basis = Array.isArray(season?.regStats) ? 'regular' : 'all';
  if (!rows.length) return { basis, replacement: 0, awards: [] };

  const teamGames = new Map(standings(season).map(t => [t.id, (t.w || 0) + (t.l || 0)]));
  const enough = r => (r.g || 0) >= Math.max(1, Math.ceil((teamGames.get(r.team) || 0) * MIN_GAMES_SHARE));
  const replacement = replacementRate(rows);
  const rated = rows.map(r => ({
    ...r,
    ppg: r.g ? r.pts / r.g : 0,
    vorp: vorpOf(r, replacement),
    // Defence: points allowed per minute, over the games that measured it.
    alwpm: r.mmin > 0 ? (r.alw || 0) / r.mmin : null,
    mpm: r.mg ? (r.mpts || 0) - (r.alw || 0) : null,
  }));
  const eligible = rated.filter(enough);

  const mvp = best(eligible, r => r.vorp, r => r.pts);
  const scoring = best(eligible, r => r.ppg, r => r.pts);
  const dpoyPool = eligible.filter(r => r.mg > 0 && r.alwpm != null && r.mmin / r.mg >= DPOY_MIN_MPG
    && r.mg >= Math.ceil((teamGames.get(r.team) || 0) * MIN_GAMES_SHARE));
  const dpoy = best(dpoyPool, r => -r.alwpm, r => r.mmin);
  // Off the bench: started fewer than half of the games that recorded starts.
  const sixth = best(eligible.filter(r => r.mg > 0 && (r.gs || 0) < r.mg / 2), r => r.vorp, r => r.pts);
  const roy = best(eligible.filter(r => ROOKIE_SETS.includes(getCardByKey(r.key)?.set)), r => r.vorp, r => r.pts);

  const pack = (id, label, r) => (r ? { id, label, ...r } : null);
  return {
    basis,
    replacement,
    awards: [
      pack('mvp', 'Most Valuable Player', mvp),
      pack('dpoy', 'Defensive Player of the Year', dpoy),
      pack('sixth', 'Sixth Man of the Year', sixth),
      pack('roy', 'Rookie of the Year', roy),
      pack('scoring', 'Scoring Title', scoring),
    ],
  };
}
