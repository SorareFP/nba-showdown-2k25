// HOW BIG A WNBA PLAYER IS — measured first, inferred only when it must be.
//
// ── THIS REPLACES A PROXY WITH THE REAL THING ───────────────────────────────
//
// Speed and Power split a card's budget on SIZE. The NBA sets bend the
// positional centre by real height and weight; the WNBA had nothing, so every
// player collapsed onto her position's centre and 40.9% of WNBA cards came out
// within a point of a perfectly even split against the NBA's 21.3% — which is a
// defensive bug, because a defender with no weaker axis has no hole to attack.
//
// The first fix inferred size from the box score (rebound and block rates
// against assist and three-point rates). It worked — 40.9% down to 24.9% — but
// it was a proxy, and it read Tamika Catchings as an average-sized forward and
// left her on 15/15, still defending 18/18. The user pointed out that height
// and weight are printed at the top of every Basketball-Reference player page.
// They are. 124 of the 135 carded players now have a listed size, fetched once
// (see fetchWnbaBiometrics.mjs).
//
// ── MEASURED WHERE IT EXISTS, INFERRED WHERE IT DOES NOT ────────────────────
//
// Eleven carded players have no listed size — mostly 1997-2000 rosters. They
// fall back to the box-score index rather than to the bare positional centre,
// because the proxy is worse than a measurement and much better than nothing.
// A card records which it got, so the two are never confused later.
//
// ── THE BASELINE IS THE WNBA'S OWN ──────────────────────────────────────────
//
// A size term is a DEVIATION from what a position normally is, so the baseline
// has to be the league being carded. WNBA forwards average 6-3 and 178lb, and
// against that Catchings' 6-1 and 165lb is height z -1.01 and weight z -0.92 —
// a genuinely small, light forward. Measured against NBA forwards she would be
// off the bottom of the scale, which would say nothing about how she played.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../cache.js';
import * as A from '../attributes.js';
import * as B from './bigness.js';

const BIO_FILE = path.join(REPO_ROOT, 'card-data', 'generated', 'wnba-biometrics.json');

/**
 * How far a listed size moves a speed share, per inch and per pound.
 *
 * The NBA's own coefficients, deliberately. Both leagues measure the same
 * thing — inches above your position's average — and the relationship between
 * that and playing like a guard is a basketball fact rather than a league one.
 * Re-fitting on 124 players would be fitting noise; the number that IS re-fit
 * is the overall strength, below.
 */
export const SIZE_MODEL = A.SIZE_SPEED_SHARE;

/**
 * Overall strength of the size term, as a multiplier on SIZE_MODEL.
 *
 * ONE. Not a fitted fudge — the NBA's own sensitivity, unchanged.
 *
 * `fitStrength` exists and was run, and it is worth saying what it found: with
 * both terms in place, cranking the size term buys almost nothing. Balanced
 * splits come out at 21.0% at strength 1 against the NBA's 21.3%, and pushing
 * to 4 moves it only to 19.9% — past the target, in exchange for exaggerating
 * physical differences beyond what the NBA does to its own players. Equal
 * treatment is the point of the whole exercise, so the multiplier stays at the
 * value that means "treated the same".
 */
export const SIZE_STRENGTH = 1;

const mean = xs => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);

/** `bbrefId -> { inches, weight }` for every player with a listed size. */
export function loadWnbaBiometrics(file = BIO_FILE) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8')).bios ?? {};
}

/**
 * What a WNBA position normally measures, from the carded players themselves.
 *
 * MIN_PER_POSITION exists because a baseline from three players is not a
 * baseline — a position that thin falls back to the overall average, which at
 * least does not invent a deviation.
 */
const MIN_PER_POSITION = 5;

export function wnbaPositionSize(rows, bios) {
  // KEYED BY THE FIVE NBA POSITIONS, not by the G/F/C the WNBA tables print.
  //
  // `speedShare` spreads a position label across PG/SG/SF/PF/C via
  // `positionWeights` and then looks each one up in `positionSize` — and it
  // bails to the bare positional centre the moment ANY weighted position is
  // missing from the table. Baselines keyed 'G', 'F', 'C' therefore matched
  // nothing and the size term did exactly nothing, silently: strength 0 and
  // strength 1 produced identical cards.
  //
  // So each player's size is accumulated into every NBA position her label
  // carries weight in, which is also the honest reading — a WNBA "F" is
  // evidence about small forwards specifically, because that is what the label
  // resolves to.
  const by = Object.fromEntries(A.POSITIONS.map(p => [p, { inches: [], weight: [], w: [] }]));
  const all = { inches: [], weight: [] };
  for (const row of rows ?? []) {
    const bio = bios[row.playerId ?? row.bbrefId];
    if (!bio || !Number.isFinite(bio.inches)) continue;
    const weights = A.positionWeights(row.pos);
    if (!weights) continue;
    for (const pos of A.POSITIONS) {
      if (!(weights[pos] > 0)) continue;
      by[pos].inches.push(bio.inches);
      by[pos].weight.push(bio.weight);
      by[pos].w.push(weights[pos]);
    }
    all.inches.push(bio.inches);
    all.weight.push(bio.weight);
  }
  const overall = all.inches.length
    ? { inches: mean(all.inches), weight: mean(all.weight) }
    : null;

  // EVERY position gets an entry, falling back to the league average, because a
  // single hole sends speedShare back to the centre for anyone whose label
  // touches it. The WNBA labels almost nobody a pure point guard or power
  // forward, so without this most players would lose their size term.
  const out = {};
  for (const pos of A.POSITIONS) {
    const v = by[pos];
    out[pos] = v.inches.length >= MIN_PER_POSITION
      ? { inches: mean(v.inches), weight: mean(v.weight) }
      : overall;
  }
  return { positionSize: out, overall, counts: Object.fromEntries(A.POSITIONS.map(p => [p, by[p].inches.length])) };
}

/**
 * The speed share for one player: position, plus size, plus style.
 *
 * ── BOTH SIGNALS, AND THE MEASUREMENT IS THE WEAKER ONE ────────────────────
 *
 * This was going to use measured height and weight INSTEAD of the box-score
 * index, on the reasonable ground that a measurement beats a proxy. Measuring
 * the two says otherwise. The spread of speed shares each produces:
 *
 *     position only                    0.0757
 *     position + box-score index       0.1300
 *     position + measured size         0.0813
 *     the NBA's own finished cards     0.1201   <- what we are matching
 *
 * The proxy lands on the target almost exactly; the measurement barely beats
 * position alone. Two reasons, both structural. The WNBA labels players G, F
 * and C where the NBA labels five positions, so the positional term carries
 * less; and within-position size deviations are smaller in inches, so the same
 * per-inch coefficient moves the share less.
 *
 * SO BOTH TERMS APPLY. They are not redundant — they measure different things.
 * Size is physical fact: Tamika Catchings is 6-1 and 165lb against a WNBA
 * forward average of 6-3 and 178lb, which the box score could not see and which
 * is why she printed as an average-sized forward and defended 18/18. Style is
 * what she did with it. A card wants both, and adding them is the honest way to
 * say so.
 *
 * `source` records whether the size half was measured or fell back, because a
 * card built on a listed size and one built on an inference are different
 * claims and a run should be able to count them.
 */
export function wnbaSpeedShareFor(row, ctx) {
  const { bios, positionSize, bignessBasis, shares, strength = SIZE_STRENGTH } = ctx;

  // The style term, relative to the positional centre it is already built on.
  const centre = A.speedShare(row?.pos, null, { shares });
  const styleShare = B.wnbaSpeedShare(row, bignessBasis, { shares });
  const style = styleShare - centre;

  const bio = bios?.[row.playerId ?? row.bbrefId];
  if (!bio || !Number.isFinite(bio.inches) || !positionSize) {
    return { share: styleShare, source: 'inferred' };
  }

  // The size term, the same way — so the two are deviations from one centre and
  // can simply be added rather than averaged or fought over.
  const sizeShare = A.speedShare(row.pos, { inches: bio.inches, weight: bio.weight }, {
    shares,
    positionSize,
    sizeModel: {
      inches: (SIZE_MODEL.inches ?? 0) * strength,
      weight: (SIZE_MODEL.weight ?? 0) * strength,
    },
  });
  const size = sizeShare - centre;

  const bounds = A.SPEED_SHARE_BOUNDS;
  return {
    share: Math.min(Math.max(centre + size + style, bounds.min), bounds.max),
    source: 'measured',
  };
}

/**
 * Everything the split needs, built once per run.
 *
 * ONE FUNCTION so the base set and the legend sets cannot end up measuring size
 * against different baselines — the failure that would look like two eras of
 * the same player disagreeing about how big she is.
 */
export function wnbaSizeContext(rows) {
  const bios = loadWnbaBiometrics();
  const { positionSize, counts } = wnbaPositionSize(rows, bios);
  return {
    bios,
    positionSize,
    counts,
    bignessBasis: B.leagueBasis(),
  };
}

/** The split itself, for a generator to call. */
/** The most Speed and the most Power any NBA card prints (2026-27 set: 18/20 in the base, 20/21 across the special sets). */
export const NBA_SPEED_MAX = 20;
export const NBA_POWER_MAX = 21;

/**
 * Clamp a split to the NBA maxima, moving the excess to the other stat so the
 * total survives. With the league factor (constants.js) a WNBA total tops out
 * near 26, so both caps can never bind at once. Sylvia Fowles 2017 is why this
 * exists: at Power 24 she printed above anything the NBA scale ever produces.
 */
export function capToNbaMaxima(split) {
  let { speed, power } = split;
  if (power > NBA_POWER_MAX) { speed += power - NBA_POWER_MAX; power = NBA_POWER_MAX; }
  if (speed > NBA_SPEED_MAX) { power += speed - NBA_SPEED_MAX; speed = NBA_SPEED_MAX; }
  return { ...split, speed: Math.min(speed, NBA_SPEED_MAX), power: Math.min(power, NBA_POWER_MAX) };
}

export function splitWnbaBySize(total, row, ctx) {
  const t = Math.max(Math.round(total ?? 0), 2);
  const { share, source } = wnbaSpeedShareFor(row, ctx);
  const speed = Math.min(Math.max(Math.round(t * share), 1), t - 1);
  return { speed, power: t - speed, sizeSource: source };
}

/**
 * The strength that makes the WNBA's balanced-split rate match a reference.
 *
 * Scans rather than solves, for the same reason `fitSpread` does: rounding to
 * whole Speed and Power makes the objective a step function.
 */
export function fitStrength(rows, totals, ctx, targetPct) {
  let best = { strength: 1, pct: 0, err: Infinity };
  for (let strength = 0; strength <= 4; strength += 0.05) {
    let balanced = 0;
    rows.forEach((row, i) => {
      const { speed, power } = splitWnbaBySize(totals[i], row, { ...ctx, strength });
      if (Math.abs(speed - power) <= 1) balanced += 1;
    });
    const pct = (100 * balanced) / rows.length;
    const err = Math.abs(pct - targetPct);
    if (err < best.err) best = { strength: Number(strength.toFixed(2)), pct, err };
  }
  return best;
}
