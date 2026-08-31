// The combined Speed+Power budget for the 2026-27 pool, from ACTUAL impact.
//
//   node scripts/cardgen/speedPower.js
//
// Writes card-data/generated/speed-power-totals-2026.json, which
// generateCards.js splits into Speed and Power by position.
//
// WHAT CHANGED, AND WHAT DELIBERATELY DID NOT.
//
// memory/new_season_speed_power_budget.md records the first pass: an EPM-led
// composite, where EPM came from dunksandthrees' PREDICTED leaderboard and the
// secondary refinement was nine Basketball-Reference advanced stats, mapped onto
// the finished set's real distribution by magnitude. That was also never
// productionised — the numbers were produced by an ad-hoc script that is gone,
// which is half the reason this file exists.
//
// KEPT, because the user asked for it explicitly:
//
//   - The MAGNITUDE-PRESERVING map onto the finished set's own distribution.
//     Rank/quantile mapping was tried first and rejected: it put Kawhi Leonard
//     and Stephen Curry in the same bucket purely because they ranked in the
//     same narrow top-N window, discarding a real gap. So the composite is
//     z-scored and rescaled by the finished set's mean and standard deviation,
//     which preserves relative distances exactly and lets a genuine cluster stay
//     a cluster.
//   - The refinement weight of 0.35.
//
// CHANGED: every input is now the ACTUAL season, and the nine Basketball-
// Reference stats are gone.
//
//   composite = z(EPM) + 0.35 * z(EW/GP)
//
// --- AND THE z IS NO LONGER TAKEN AGAINST THE POOL --------------------------
//
// It is taken against EVERY CARDABLE PLAYER-SEASON SINCE 2002 — 7,773 of them,
// measured by scripts/cardgen/epmArchive.js and committed to
// card-data/generated/epm-archive.json. So is the map's own calibration and its
// tail anchor. That file carries the full argument; the short version is the
// user's: "It shouldn't just be a 'this guy was the best by EPM this season so
// he automatically gets 34 power+speed' thing. It should be relative to the
// whole dataset."
//
// The level barely moves — EPM is re-centred every season at source, so the mean
// composite of a season's cardable players sits within +-0.07 of zero in all 25
// — and that is the point rather than a disappointment: the recalibration
// re-RANKS across eras without demoting the current set. What moves is the top,
// because the ceiling is now anchored on the 56th-best season since 2002 instead
// of on this year's third-best player.
//
// "THE ACTUAL SEASON" NOW MEANS REGULAR SEASON PLUS PLAYOFFS, folded into one
// sample by scripts/cardgen/poolSeasons.js rather than averaged. EPM is a
// per-100-possession rate and pools by possessions; EW/GP is already per-game
// and pools by games played. A player whose team missed the playoffs keeps his
// regular-season numbers untouched.
//
// FOR NINETEEN PLAYERS IT ALSO MEANS THE SEASON BEFORE. The force-include list
// suspends the G>=40 rule for eighteen injury-shortened stars and Ty Jerome, so
// several of them reach this file on a sample of ten to twenty games — Jerome's
// fifteen produced the seventh-highest budget in the set. Their 2024-25 is
// folded in by the same volume weighting, which is what makes a 15-game EPM
// count as fifteen games of evidence rather than as a season. See
// scripts/cardgen/priorSeasonBlend.js; every other player in the pool is
// untouched.
//
// --- WHY THE OFF/DEF TERM IS GONE -------------------------------------------
//
// The composite used to be `z(EPM) + 0.35 * mean(z(OFF), z(DEF), z(EW/GP))`. The
// argument for it was that EPM is exactly OFF + DEF, OFF has about 1.6x the
// spread of DEF, and so averaging the two z-scores puts the halves on equal
// footing — a "two-way presence" prior for a stat feeding Speed and Power.
//
// That argument is wrong about what Speed+Power is for, and the design intent
// says so directly: "if a player is much better defensively than offensively
// (Chet Holmgren, Zach Edey, Ausar Thompson, Matisse Thybulle) the DEFENSIVE
// BOOST provided by estimated def +/- will make up for a lackluster scoring
// chart." Speed+Power is TOTAL value; the defensive specialist is compensated
// through Def Boost, which is already derived from the same DEF number
// (attributes.js `defBoostFromEpm`). Up-weighting DEF inside the budget as well
// pays him twice, and it did: Chet Holmgren's budget went to the ceiling, above
// Stephen Curry, on a 5.23 EPM.
//
// So the two drivers are the two the user named — EPM and Estimated Wins per
// game. They correlate at 0.955 across the pool, so the weight between them
// barely moves anything (composite correlations: this against EPM alone 0.997,
// against an equal blend 0.997). What EW/GP still buys is the volume dimension
// EPM deliberately lacks: EPM is a rate, so a 13-minute reserve who is efficient
// in his minutes rates alongside a starter, and EW/GP is that rate times playing
// time. Paul Reed is the case in point — 3.57 EPM on 0.058 expected wins a game.
//
// OFF and DEF are still carried on every output record. They are provenance and
// the Def Boost's input, not composite terms.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './cache.js';
import { poolingSummary } from './poolSeasons.js';
import { readBlendedActual, reportBlend } from './priorSeasonBlend.js';
import { normalizeName } from './resolveTeams.js';
import { loadReferenceCards } from './referenceCards.js';
import { meanSd } from './attributes.js';
import { CURRENT_STATS_SEASON } from './fetchCalibrationData.js';
import {
  REFINEMENT_WEIGHT,
  archiveBasis,
  compositeFrom,
  requireArchive,
} from './epmArchive.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const OUTPUT_FILE = path.join(GEN_DIR, 'speed-power-totals-2026.json');

/**
 * How much the Estimated-Wins-per-game refinement moves the EPM-led ranking.
 *
 * DEFINED IN epmArchive.js and re-exported here, because the composite formula
 * it is a term of moved there when the basis became absolute. Every existing
 * importer keeps working and there is still exactly one 0.35 in the tree.
 */
export { REFINEMENT_WEIGHT };

/** Linear-interpolated quantile of an ASCENDING array. */
export function quantile(ascending, p) {
  if (!ascending.length) return null;
  const i = (ascending.length - 1) * Math.min(Math.max(p, 0), 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return ascending[lo] + (ascending[hi] - ascending[lo]) * (i - lo);
}

/**
 * The finished set's own Speed+Power distribution — the target of the map.
 *
 * Measured off the 283 non-legend cards in `Final Cards.csv`, and duplicated
 * here as the fallback for a checkout without that gitignored file, exactly like
 * POSITION_SPEED_SHARE in attributes.js. The 23 legends are excluded: their
 * budgets run 21-33 off peak historical seasons, and mixing them in would
 * inflate the scale for a pool of current players.
 *
 * `p90` and `ceilingShare` describe the SHAPE of its upper end, which is what
 * the tail taper below is fitted against. The finished set is dense up to 22
 * (29 cards sit on 22, then 8 on 23) and thin above it, and exactly 2 of the 283
 * ever reached the ceiling.
 */
export const REFERENCE_TOTALS = {
  mean: 17.7951,
  sd: 4.0814,
  min: 10,
  max: 28,
  p90: 22,
  ceilingShare: 0.0071,
};

/**
 * A widened target distribution for `mapToReferenceScale`.
 *
 * The reference is what the map aims at, so a widening IS a different reference
 * — no new mapping code is needed, and every property documented below about the
 * map (the untouched bulk, the tapered tail, the earned ceiling) still holds for
 * the widened one.
 *
 * `sdScale` is the dial that actually buys resolution. `min`/`max` alone only
 * release the cards the clamp was flattening, which is about sixteen of 350;
 * the compression that matters is in the BULK (46 cards shared S+P 16), and only
 * a larger spread separates those. The knee moves with the spread so the taper
 * keeps describing the same part of the shape.
 *
 * `meanShift` is included for completeness and is very nearly a no-op at the
 * table: `calcAdv` reads only differences, so moving the whole set up or down
 * cancels. It is not free OUTSIDE the set — the other four sets and the shipped
 * 306 cards are priced against this level — which is why it defaults to zero and
 * why WIDENING below does not use it.
 *
 * Lives here rather than in scripts/analysis/ because it is now production: the
 * shipped scale is a widening. scaleWidening.js re-exports it.
 */
export function widenReference(reference, { min, max, sdScale = 1, meanShift = 0 } = {}) {
  const mean = reference.mean + meanShift;
  return {
    mean,
    sd: reference.sd * sdScale,
    min: min ?? reference.min,
    max: max ?? reference.max,
    p90: mean + (reference.p90 - reference.mean) * sdScale,
    ceilingShare: reference.ceilingShare,
  };
}

/**
 * THE SHIPPED WIDENING — the printed Speed+Power scale is 6-30, not 10-28.
 *
 * The matchup matrix found only 142 distinct mechanical identities across 350
 * cards: two cards with the same Speed, Power and effective Def Boost play
 * identically whatever else is printed on them, and 46 cards shared S+P 16
 * alone. A wider printed range is the fix, and the user approved widening with
 * one condition — "that adds boosts and thus more scoring".
 *
 * scripts/analysis/runScaleWidening.js prices candidates against that condition.
 * The measured cost of this one, against the scale the set was actually on
 * before (per-pool 10-28), averaged over five seeds x 1200 cap-legal drafts:
 *
 *   - 142 -> 168 distinct identities (+26)
 *   - mean roll bonus over the full ordered matrix 1.822 -> 1.894
 *   - cap-legal 5v5 scoring 197.6 -> 197.2 pts/team/game, i.e. -0.4: the
 *     widening does not add scoring at all. Full-field 133.0 -> 133.2.
 *   - no card pinned to SALARY_MAX (top salary 1330 of 1500), so the best cards
 *     are still priced apart
 *   - the twelve-card pile on the old floor breaks up into five
 *
 * ── WHY THIS IS 6-30 AND NOT THE 8-31 x1.3 THAT WAS FIRST APPROVED ──────────
 *
 * Because the numbers 8-31 x1.3 were fitted against a PER-POOL distribution and
 * the scale is now absolute (see epmArchive.js), and re-deriving rather than
 * transplanting them changed two things.
 *
 * THE SPREAD IS ALREADY PART-WIDENED BEFORE THE DIAL IS TOUCHED. 2025-26 is a
 * high-spread season — composite sd 1.430 against the archive's 1.338 — so
 * mapping it onto an absolute scale stretches the set by about 7% on its own. A
 * x1.3 dial on top of that is an effective x1.39 relative to the pool's own
 * spread, which is more widening than was ever priced. Measured: transplanting
 * 8-31 x1.3 unchanged costs SEVEN points of cap-legal scoring per team per game
 * (197.6 -> 190.6), twenty times the approved budget, because a bigger star
 * costs more and a 5500 cap then fields a visibly weaker team.
 *
 * THE FLOOR HAS TO MOVE WITH THE SPREAD OR THE PILE JUST RELOCATES. The whole
 * complaint was twelve cards sharing the floor. Holding the floor at 8 while
 * widening to x1.25 clamps THIRTEEN cards onto it — the identical pathology, one
 * step to the left. Dropping to 6 leaves five, and buys four identities for
 * nothing: the scoring measurement is unchanged to within the measurement error,
 * because a cap-legal roster does not field these cards.
 *
 * THE CEILING COMES DOWN BECAUSE 31 SITS ON A CLIFF. Cap-legal scoring is not
 * smooth in the scale, and it should not be expected to be: a candidate moves
 * cards across salary steps, and a step decides whether a ten-man roster can
 * still afford its second star. max 31 at x1.3 lands in one of those dips
 * (-7.0), while 30 and 32 on either side of it are fine. This choice sits in the
 * flat part — x1.2 and x1.3 on either side of it measure +0.4 and -0.4 — so the
 * cost is not balanced on a knife edge. The neighbouring cliff at x1.35 (-6.6)
 * is the reason the dial stops at 1.25 rather than taking the two further
 * identities x1.3 would buy.
 *
 * 6-30 also straddles the reference mean almost exactly: 11.8 below, 12.2 above.
 * That is a consequence rather than a criterion, but it is the shape you would
 * draw by hand.
 *
 * WHAT WAS DELIBERATELY NOT TAKEN. A ceiling-only widening is still the only
 * family that separates the top six, and it is still rejected for the same
 * reason: it lifts only the cards a cap-legal team actually fields, and at 34 it
 * pins cards to SALARY_MAX.
 *
 * The scale is a printed range, not a mechanical constant — the engine reads
 * only `off.speed - def.speed` — so this moves EVERY set that maps onto it: the
 * base pool, Super Season, Rookie and both WNBA sets. That is the intent.
 */
export const WIDENING = { min: 6, max: 30, sdScale: 1.25 };

/**
 * The scale the cards are actually printed on: REFERENCE_TOTALS widened.
 *
 * REFERENCE_TOTALS stays a MEASUREMENT of the finished 2025-26 set and is not
 * edited to hold the new range — the finished set really did run 10-28, and the
 * widening is a decision applied on top of it. Every default in this file points
 * here, and `main` applies the same widening to the measured reference when the
 * gitignored CSV is present.
 */
export const PRINTED_SCALE = widenReference(REFERENCE_TOTALS, WIDENING);

export function measureReferenceTotals(cards) {
  const totals = (cards ?? [])
    .map(c => (c.speed ?? 0) + (c.power ?? 0))
    .filter(t => Number.isFinite(t) && t > 0);
  if (totals.length === 0) return null;
  const { mean, sd } = meanSd(totals);
  const ascending = [...totals].sort((a, b) => a - b);
  const max = ascending[ascending.length - 1];
  return {
    mean: Number(mean.toFixed(4)),
    sd: Number(sd.toFixed(4)),
    min: ascending[0],
    max,
    p90: quantile(ascending, 0.9),
    ceilingShare: Number((totals.filter(t => t === max).length / totals.length).toFixed(4)),
    n: totals.length,
  };
}

/**
 * The composite ranking score, one per player, AGAINST AN ABSOLUTE BASIS.
 *
 * `basis` is `{ epm: {mean, sd}, ewinsPerGame: {mean, sd} }` and defaults to the
 * 2002-2026 archive — every cardable player-season dunksandthrees has. It used
 * to be measured from `rows` themselves, which is what made the whole scale
 * relative to whoever happened to be in the pool; see epmArchive.js for the
 * argument and for what changed when it stopped being.
 *
 * Passing a basis measured from the rows reproduces the old behaviour exactly,
 * which is how speedPower.test.js still pins the per-pool arithmetic without the
 * production path depending on it.
 */
export function compositeScores(rows, { weight = REFINEMENT_WEIGHT, basis } = {}) {
  const from = basis ?? archiveBasis(requireArchive());
  return rows.map(r => compositeFrom(r, from, weight));
}

/** The basis measured from a set of rows — the pre-archive behaviour, by name. */
export function poolBasis(rows) {
  return {
    epm: meanSd(rows.map(r => r.epm)),
    ewinsPerGame: meanSd(rows.map(r => r.ewinsPerGame)),
  };
}

/**
 * Rescales composites onto the reference distribution by magnitude.
 *
 * NOT a rank/quantile map. The difference matters at the top: a quantile map
 * hands out exactly as many 28s as the finished set had, which forces players
 * with visibly different composites into the same bucket. The bulk of this map
 * only asks that the pool's mean and spread match, so a genuine cluster survives
 * as a cluster and a genuine gap survives as a gap.
 *
 * --- WHY THE TAIL IS TAPERED RATHER THAN CLIPPED ----------------------------
 *
 * The affine map alone cannot ship, because the two distributions are not the
 * same SHAPE. EPM is right-skewed with a genuinely fat top: the biggest composite
 * in the archive sits 4.7 standard deviations above its mean, while the finished
 * set's ceiling is only 2.5 above its own. Matching mean and spread therefore
 * sends a crowd past the ceiling, and the clamp collapses all of them onto it —
 * destroying exactly the gap that is the most visible feature of the EPM curve.
 *
 * The fix keeps the affine map for the BULK and rescales only the tail:
 *
 *     scaled  = reference.mean + z * reference.sd            (as before)
 *     knee    = the finished set's 90th percentile, scaled   (23.26 at x1.3)
 *     anchor  = the BASIS's (1 - ceilingShare) quantile of `scaled`
 *     out     = scaled                     , scaled <= knee
 *             = knee + (scaled - knee) * (reference.max - knee) / (anchor - knee)
 *
 * Three properties, and each one is the reason for a piece of it:
 *
 *   - EVERY CARD IN THE BULK IS UNTOUCHED. Below the knee the map is bit-for-bit
 *     what it was, so the set keeps the finished set's level and its floor still
 *     fills. That matters more than it looks: the engine only ever reads
 *     `off.speed - def.speed`, so a systematic shift of the whole set cancels in
 *     play but the SPREAD does not — and the shipped 306-card set is priced
 *     against this level.
 *   - THE TAIL KEEPS ITS PROPORTIONS. Above the knee the map is still linear, so
 *     the ratio of the gaps between the outliers survives; it is only the rate
 *     that drops. That is what puts real daylight between the outlier group and
 *     the top of the cluster instead of one rounding step.
 *   - THE CEILING IS EARNED, AND SINCE THE BASIS BECAME THE ARCHIVE IT IS EARNED
 *     AGAINST HISTORY RATHER THAN AGAINST THIS YEAR'S FIELD. The anchor is the
 *     basis quantile matching the share of the finished set that reached its own
 *     ceiling (2 of 283, so 0.71%). Read against one 331-player pool that is
 *     "the third-best player this season", whoever he is; read against 7,773
 *     player-seasons it is the 56th-best season since 2002. The measured
 *     consequence, per season, on the shipped scale: 2002 puts nobody on the
 *     ceiling, 2004/2005/2007/2011 put one each, and 2017 and 2019 put seven.
 *
 * The clamp is still there and still catches whatever sits above the anchor.
 * That is deliberate: a season that really did produce five of the best years of
 * the last quarter-century should print five ceiling cards, and one that
 * produced none should print none.
 */
/**
 * `calibrateOn` is the population the map is FITTED to, and IT IS NOW ALWAYS
 * PASSED.
 *
 * It exists because the population being mapped is never the population that
 * should define the scale. That used to mean "the current pool, when a
 * historical season is being carded"; it now means THE 2002-2026 ARCHIVE, for
 * every set including the current pool. Fit the map to the rows being mapped and
 * whoever leads them takes the ceiling by construction — a weak season's best
 * player and an all-time peak land on the same number, which is exactly the
 * complaint this change answers. See epmArchive.js.
 *
 * Defaulting to the input is kept, because it is what makes the function
 * self-contained and testable and it is bit-for-bit the behaviour it had before
 * the option existed — asserted in speedPower.test.js. No production caller
 * relies on the default any more.
 */
export function mapToReferenceScale(composites, reference = PRINTED_SCALE, { calibrateOn } = {}) {
  const basis = Array.isArray(calibrateOn) && calibrateOn.length > 0 ? calibrateOn : composites;
  const { mean, sd } = meanSd(basis);
  const rescale = c => reference.mean + (sd > 0 ? (c - mean) / sd : 0) * reference.sd;
  const scaled = composites.map(rescale);

  const knee = Number.isFinite(reference.p90) ? reference.p90 : reference.max;
  const anchor = quantile(
    basis.map(rescale).sort((a, b) => a - b),
    1 - (Number.isFinite(reference.ceilingShare) ? reference.ceilingShare : 0)
  );
  // Never STRETCH a tail that already fits — the map preserves magnitude, and a
  // taper above 1 would invent spread the composites do not have.
  const taper = anchor > knee ? Math.min((reference.max - knee) / (anchor - knee), 1) : 1;

  return scaled.map(v => {
    const tapered = v <= knee ? v : knee + (v - knee) * taper;
    return Math.min(Math.max(Math.round(tapered), reference.min), reference.max);
  });
}

/** Indexes actual rows by matching key, keeping the row covering the most games. */
export function indexByName(rows) {
  const m = new Map();
  for (const r of rows ?? []) {
    const k = normalizeName(r.name);
    const prev = m.get(k);
    if (!prev || (r.games ?? 0) > (prev.games ?? 0)) m.set(k, r);
  }
  return m;
}

/** Names the stat source spells differently from the pool. Mirrors generateCards.js. */
export const STAT_NAME_ALIASES = { 'Ron Holland': 'Ronald Holland II' };

export function buildSpeedPowerTotals({
  pool,
  actual,
  reference = PRINTED_SCALE,
  weight,
  archive = requireArchive(),
}) {
  const index = indexByName(actual);
  const lookup = name =>
    index.get(normalizeName(STAT_NAME_ALIASES[name] ?? name)) ?? index.get(normalizeName(name)) ?? null;

  const missing = [];
  const rows = pool.map(p => {
    const r = lookup(p.name);
    if (!r) missing.push(p.name);
    return {
      name: p.name,
      team: p.team,
      pos: p.pos,
      epm: r?.epm ?? null,
      epmOff: r?.epmOff ?? null,
      epmDef: r?.epmDef ?? null,
      ewinsPerGame: r?.ewinsPerGame ?? null,
      // Provenance, not an input: how many of the games behind those four
      // numbers were playoff games. Zero means the composite is his regular
      // season exactly as it was before the postseason was folded in.
      playoffGames: r?.playoffGames ?? 0,
      // And whether a PRIOR SEASON is in there too, which is true for the
      // force-included nineteen and nobody else. `games` is the pooled total,
      // so without this pair a reader cannot tell a 70-game season from a
      // 15-game one blended with a 70-game one — and the difference is the
      // whole reason those budgets moved.
      blended: r?.blended ?? false,
      currentGames: r?.blended ? r.currentGames : (r?.games ?? 0),
      priorGames: r?.priorGames ?? 0,
    };
  });

  const composites = compositeScores(rows, { weight, basis: archiveBasis(archive) });
  const totals = mapToReferenceScale(composites, reference, { calibrateOn: archive.composites });
  const records = rows.map((r, i) => ({
    name: r.name,
    team: r.team,
    pos: r.pos,
    epm: r.epm,
    epmOff: r.epmOff,
    epmDef: r.epmDef,
    ewinsPerGame: r.ewinsPerGame == null ? null : Number(r.ewinsPerGame.toFixed(4)),
    playoffGames: r.playoffGames,
    blended: r.blended,
    currentGames: r.currentGames,
    priorGames: r.priorGames,
    composite: Number(composites[i].toFixed(4)),
    speedPowerTotal: totals[i],
    provisional: true,
  }));
  records.sort((a, b) => b.composite - a.composite || a.name.localeCompare(b.name));
  return { records, missing };
}

export function main({ log = console.log } = {}) {
  // Regular season and playoffs, already folded into one row per player by
  // volume-weighted pooling — EPM, OFF and DEF by possessions, EW/GP by games.
  // See scripts/cardgen/poolSeasons.js.
  //
  // ...and then the PRIOR SEASON folded into the same row for the nineteen
  // force-included players, by the same arithmetic. Those nineteen are in the
  // pool despite failing the G>=40 rule, so several of them arrive here on ten
  // to twenty games — a sample that produced a top-ten budget for Ty Jerome off
  // fifteen. See scripts/cardgen/priorSeasonBlend.js.
  const blend = readBlendedActual(CURRENT_STATS_SEASON);
  if (!blend) {
    throw new Error(
      `No cached dunksandthrees ACTUAL rates for ${CURRENT_STATS_SEASON} — run ` +
        'scripts/cardgen/fetchCalibrationData.js first.'
    );
  }
  const actual = blend.rows;
  const pool = JSON.parse(fs.readFileSync(path.join(GEN_DIR, 'player-pool-2026.json'), 'utf8'));
  // The reference distribution is measured when the gitignored CSV is present
  // and falls back to the committed constants when it is not, so a public
  // checkout regenerates the same numbers.
  const referenceCards = loadReferenceCards();
  const measured = measureReferenceTotals(referenceCards);
  // The measurement describes the FINISHED set (10-28). The scale the cards are
  // printed on is that measurement WIDENED — see WIDENING. Applying the widening
  // here rather than baking it into REFERENCE_TOTALS keeps the constant honest
  // and keeps the measured and fallback paths on the same scale.
  const finished = measured ?? REFERENCE_TOTALS;
  const reference = widenReference(finished, WIDENING);
  const referenceTotals = (referenceCards ?? []).map(c => (c.speed ?? 0) + (c.power ?? 0));

  // The absolute basis. Everything about the map — the input z-scores, the
  // composite's own mean and spread, and the tail anchor — comes from here, and
  // not one number in it depends on who is in this year's pool.
  const archive = requireArchive();
  const { records, missing } = buildSpeedPowerTotals({ pool, actual, reference, archive });
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(records, null, 1)}\n`);

  const totals = records.map(r => r.speedPowerTotal).sort((a, b) => a - b);
  const { mean, sd } = meanSd(totals);
  log(`${records.length} budgets -> ${path.relative(REPO_ROOT, OUTPUT_FILE)}`);
  if (missing.length) log(`  no actual stat line for ${missing.length}: ${missing.join(', ')}`);
  const fold = poolingSummary(records);
  log(
    `  playoffs folded in: ${fold.gained}/${fold.players} players gained games ` +
      `(${fold.playoffGames} playoff games total, median ${fold.medianPlayoffGames}, ` +
      `max ${fold.maxPlayoffGames}); the other ${fold.players - fold.gained} are unchanged`
  );
  reportBlend(blend, log);
  log(
    `  finished set (${measured ? `measured, n=${measured.n}` : 'committed fallback'}): ` +
      `mean ${finished.mean} sd ${finished.sd} [${finished.min}, ${finished.max}] ` +
      `knee(p90) ${finished.p90} ceiling share ${(100 * finished.ceilingShare).toFixed(1)}%`
  );
  log(
    `  printed scale (widened x${WIDENING.sdScale}): mean ${reference.mean.toFixed(4)} ` +
      `sd ${reference.sd.toFixed(4)} [${reference.min}, ${reference.max}] ` +
      `knee(p90) ${reference.p90.toFixed(2)}`
  );
  const season = archive.bySeason.find(b => b.season === CURRENT_STATS_SEASON);
  log(
    `  absolute basis: ${archive.n} cardable player-seasons ` +
      `${archive.seasons[0]}-${archive.seasons[archive.seasons.length - 1]}, ` +
      `composite mean ${archive.composite.mean.toFixed(3)} sd ${archive.composite.sd.toFixed(3)}`
  );
  if (season) {
    // How this season compares with the archive it is now measured against —
    // the one line that says whether the set should be expected to come out
    // stronger or weaker than the finished one, and by how much.
    log(
      `    ${season.season} against it: mean ${season.mean.toFixed(3)} ` +
        `sd ${season.sd.toFixed(3)} (archive sd ${archive.composite.sd.toFixed(3)}), ` +
        `best composite ${season.max.toFixed(3)} vs archive max ` +
        `${archive.composites[archive.composites.length - 1].toFixed(3)}`
    );
  }
  log(
    `  produced: min ${totals[0]} median ${totals[Math.floor(totals.length / 2)]} ` +
      `max ${totals[totals.length - 1]} mean ${mean.toFixed(2)} sd ${sd.toFixed(2)}`
  );

  // The top of the scale is the whole point of the taper, so it is printed
  // per-value rather than summarised: this is where a regression would show.
  //
  // ALIGNED BY OFFSET FROM EACH SCALE'S OWN CEILING, not by raw value: the
  // printed scale now runs to 31 and the finished set ran to 28, so comparing
  // "how many 31s" against "how many 31s" would compare a real count against a
  // structural zero. The question the taper answers is how SPARSELY the top of
  // a scale is occupied, which is a comparison of shares at the same rank down
  // from the ceiling.
  const count = v => totals.filter(t => t === v).length;
  const referenceCount = measured
    ? v =>
        `${String(v).padStart(2)}: ${String(referenceTotals.filter(t => t === v).length).padStart(3)} ` +
        `(${((100 * referenceTotals.filter(t => t === v).length) / measured.n).toFixed(1)}%)`
    : () => '     n/a';
  log('  the top of the scale, produced vs the finished set (aligned on each ceiling):');
  for (let d = 0; d <= 4; d += 1) {
    const v = reference.max - d;
    log(
      `    ${v}: ${String(count(v)).padStart(3)} ` +
        `(${((100 * count(v)) / totals.length).toFixed(1)}%)   finished set ${referenceCount(finished.max - d)}`
    );
  }
  log('  top 20:');
  for (const r of records.slice(0, 20)) {
    log(
      `    ${String(r.speedPowerTotal).padStart(2)}  ${r.name.padEnd(24)} EPM ${r.epm.toFixed(2)} ` +
        `(off ${r.epmOff.toFixed(2)} def ${r.epmDef.toFixed(2)}) EW/GP ${r.ewinsPerGame.toFixed(3)}`
    );
  }
  return records;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
