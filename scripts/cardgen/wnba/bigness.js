// A STAND-IN FOR THE HEIGHT AND WEIGHT THE WNBA DOES NOT PUBLISH.
//
// ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────
//
// Speed and Power split a card's budget along a STYLE axis: guards skew Speed,
// bigger players skew Power. The NBA sets get that from real biometrics —
// `SIZE_SPEED_SHARE` in attributes.js bends the positional centre by inches and
// weight, and on the finished set a card's speed share correlates -0.78 with
// height. Basketball-Reference publishes no height or weight for the WNBA in
// any table this repo reads, so both WNBA generators called `splitSpeedPower`
// with the positional centre and nothing else.
//
// The cost was not subtle once measured. With no per-player term, every player
// at a position collapses onto that position's centre, and the centre for a
// forward is close to even — so 40.9% of WNBA cards landed within one point of
// a perfectly balanced split against the NBA's 21.3%, and six WNBA Super Season
// legends printed the identical S15/P15.
//
// THAT IS A DEFENSIVE BUG, not a cosmetic one. An attacker beats a defender
// through their WEAKER stat (`speedAdv = max(0, rawSpeed - db)` in engine.js
// takes the better of the two axes), so a defender's real wall is
// `min(speed, power) + defBoost` — which is maximised exactly when speed equals
// power. A league of balanced cards is a league of defenders with no hole to
// attack, and five of the game's twelve hardest-to-score-on cards came from a
// WNBA pool a fifth the size of the NBA's.
//
// ── WHY NOT obpm/dbpm, WHICH WAS THE FIRST IDEA ─────────────────────────────
//
// Tilting the split by the offensive/defensive share of a player's rating would
// spread the distribution, and it was the first proposal. It is wrong twice
// over. `dbpmHat` ALREADY drives the card's defBoost through `defBoostFromEpm`,
// so feeding it in again double-counts defence — and it would push good
// defenders toward the balanced splits that make the wall worse, which is the
// bug. More basically, Speed/Power is not an offence/defence axis. It is a size
// axis, and it should be driven by something that measures size.
//
// ── WHAT THIS MEASURES INSTEAD ──────────────────────────────────────────────
//
// The box score knows roughly how big somebody is, because the things bigs do
// and the things guards do are different things. Two rate groups, each already
// on the season row and each already pace- and minutes-adjusted:
//
//   BIG    trbPct  blkPct        rebounding and shot-blocking
//   GUARD  astPct  fg3aRate      creating, and shooting from range
//
// Percentages rather than counts on purpose: a per-100 total rewards volume,
// and a bench centre is still a centre. The index is the standardised big
// group minus the standardised guard group, so it is centred on the league and
// signed the way size is — positive means big.
//
// ── AND WHY IT IS Z-SCORED AGAINST THE WNBA, NOT THE NBA ────────────────────
//
// This is the one place a cross-league comparison would be wrong. The NBA's
// size model works in inches, which mean the same thing in both leagues; a
// block rate does not, because it is relative to the shots and the players
// around it. So the index is standardised WITHIN the WNBA — it answers "how big
// is she for this league", which is exactly what the positional centre it is
// bending already assumes.
import * as A from '../attributes.js';
import { readSeason } from './fetchWnba.js';
import { archivedSeasons } from './fetchWnbaHistory.js';
import { joinWnbaSeason } from './pool.js';
import { WNBA_SEASON } from './constants.js';

/** The rate columns each group reads, and the sign they carry. */
export const BIG_RATES = ['trbPct', 'blkPct'];
export const GUARD_RATES = ['astPct', 'fg3aRate'];

/**
 * How far the index is allowed to move a speed share, in share units per SD.
 *
 * CALIBRATED, NOT CHOSEN — and the choice of WHAT to calibrate against is the
 * substantive decision here, because three reasonable targets disagree:
 *
 *   slope   balanced<=1   sd|s-p|   mean wall     matches
 *   -0.016      37.6%       2.71       8.92       the NBA's SPREAD
 *   -0.045      21.4%       3.30       8.15       the NBA's BALANCED RATE
 *   -0.060      16.0%       3.81       7.76       the NBA's MEAN WALL
 *                            (NBA: 21.3%, 2.71, 7.72)
 *
 * The BALANCED RATE wins because it is the direct cause of the bug: a defender
 * with no weaker axis has no hole to attack, and the count of such defenders is
 * what was out of line. Matching the mean wall instead would over-correct —
 * 16% balanced is FEWER hole-free defenders than the NBA has, fixing a WNBA
 * problem by making the WNBA worse than the reference.
 *
 * The residual gap in mean wall (8.15 against 7.72) is NOT a split problem and
 * is deliberately left alone: it comes from the WNBA pool's stricter cut
 * (MPG>=16 and G>=20 against the NBA's MPG>=12 and G>=40), which removes
 * marginal players and lifts every distribution. That is a pool-threshold
 * decision, and changing a threshold to fix a split would be the wrong lever.
 *
 * NEGATIVE for the same reason SIZE_SPEED_SHARE's terms are negative: bigger
 * means LESS speed share.
 */
export const BIGNESS_SPEED_SHARE = -0.045;

const mean = xs => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
const sd = xs => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};

const num = v => (Number.isFinite(v) ? v : null);

/**
 * The league's own mean and spread for every rate the index reads.
 *
 * Built from whatever rows are handed in — normally every rated season in the
 * archive, so the basis is the league across its whole history rather than one
 * season's quirks.
 */
export function bignessBasis(rows) {
  const basis = {};
  for (const key of [...BIG_RATES, ...GUARD_RATES]) {
    const xs = (rows ?? []).map(r => num(r?.[key])).filter(v => v !== null);
    basis[key] = { mean: mean(xs), sd: sd(xs), n: xs.length };
  }
  return basis;
}

/**
 * How big this player plays, in standard deviations. Positive means big.
 *
 * Returns null when a row carries none of the rates — an unmeasurable player
 * must fall back to the positional centre rather than be scored as league
 * average, because "average" is a claim and "unknown" is not.
 */
export function bigness(row, basis) {
  const z = key => {
    const v = num(row?.[key]);
    const b = basis?.[key];
    if (v === null || !b || !(b.sd > 0)) return null;
    return (v - b.mean) / b.sd;
  };
  const side = keys => {
    const vs = keys.map(z).filter(v => v !== null);
    return vs.length ? mean(vs) : null;
  };
  const big = side(BIG_RATES);
  const guard = side(GUARD_RATES);
  if (big === null && guard === null) return null;
  // A row with only one side still carries signal; treating the missing side as
  // league-average (0) is the honest reading of "no evidence either way".
  return (big ?? 0) - (guard ?? 0);
}

/**
 * The speed share for one WNBA player: the positional centre, bent by size.
 *
 * Deliberately the same SHAPE as `speedShare` in attributes.js — a positional
 * centre plus a linear per-player term, clamped to the same bounds — so the two
 * leagues differ in what measures size and in nothing else.
 */
export function wnbaSpeedShare(row, basis, { shares, slope = BIGNESS_SPEED_SHARE } = {}) {
  const centre = A.speedShare(row?.pos, null, { shares });
  const z = bigness(row, basis);
  if (z === null) return centre;
  const bounds = A.SPEED_SHARE_BOUNDS;
  return Math.min(Math.max(centre + slope * z, bounds.min), bounds.max);
}

/**
 * THE ONE BASIS BOTH WNBA GENERATORS SHARE.
 *
 * Built here rather than in either generator for a structural reason: the two
 * of them already form an import cycle (generateWnbaLegends reads
 * `vorpPerGame` out of generateWnbaCards), so neither could hand the other a
 * basis without making that cycle worse. Reading the cached season tables from
 * this module — which depends on neither — means the base set and the legend
 * sets standardise against exactly the same league, which is the whole point:
 * a basis measured on sixteen legends would call the least rebound-heavy of
 * them a guard.
 *
 * A season the cache does not hold is skipped rather than fatal. This is a
 * standardisation basis over ~4,900 player-seasons; one missing year moves it
 * by nothing, and refusing to build a card because 2003 is uncached would be
 * out of all proportion.
 */
export function leagueRows(seasons = [...archivedSeasons(), 2025, WNBA_SEASON]) {
  const rows = [];
  for (const season of seasons) {
    const tables = readSeason(season);
    if (!tables) continue;
    rows.push(...joinWnbaSeason({ season, ...tables }));
  }
  return rows;
}

export function leagueBasis(seasons = [...archivedSeasons(), 2025, WNBA_SEASON]) {
  const rows = leagueRows(seasons);
  return rows.length ? bignessBasis(rows) : null;
}

/** The split itself, for a generator to call in place of `splitSpeedPower`. */
export function splitWnba(total, row, basis, opts = {}) {
  const t = Math.max(Math.round(total ?? 0), 2);
  const share = wnbaSpeedShare(row, basis, opts);
  const speed = Math.min(Math.max(Math.round(t * share), 1), t - 1);
  return { speed, power: t - speed };
}

/**
 * The slope that makes the WNBA's spread of splits match a reference league's.
 *
 * Used to derive BIGNESS_SPEED_SHARE and to re-derive it if either set changes.
 * The statistic matched is the SD of |speed - power| over the pool, because the
 * bug was a distribution that was too narrow and that is the number that says
 * so. Scans a coarse grid rather than solving: the relationship is monotonic
 * but the rounding to whole Speed and Power makes it a step function, and a
 * solver on a step function finds an edge rather than a fit.
 */
export function fitSpread(rows, basis, totals, targetSd, { shares } = {}) {
  let best = { slope: 0, sd: 0, err: Infinity };
  for (let slope = 0; slope >= -0.3; slope -= 0.002) {
    const diffs = rows.map((row, i) => {
      const { speed, power } = splitWnba(totals[i], row, basis, { shares, slope });
      return Math.abs(speed - power);
    });
    const err = Math.abs(sd(diffs) - targetSd);
    if (err < best.err) best = { slope: Number(slope.toFixed(3)), sd: sd(diffs), err };
  }
  return best;
}
