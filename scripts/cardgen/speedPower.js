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
import { meanSd, zScorer } from './attributes.js';
import { CURRENT_STATS_SEASON } from './fetchCalibrationData.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const OUTPUT_FILE = path.join(GEN_DIR, 'speed-power-totals-2026.json');

/** How much the Estimated-Wins-per-game refinement moves the EPM-led ranking. */
export const REFINEMENT_WEIGHT = 0.35;

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
 * The composite ranking score, one per player.
 *
 * Every input is z-scored WITHIN THIS POOL, so the composite says "relative to
 * the 350 players being carded" rather than "relative to all 602 in the league",
 * which is the population the card set actually has to spread across.
 */
export function compositeScores(rows, { weight = REFINEMENT_WEIGHT } = {}) {
  const z = {
    epm: zScorer(rows.map(r => r.epm)),
    ewPerGame: zScorer(rows.map(r => r.ewinsPerGame)),
  };
  return rows.map(r => z.epm(r.epm) + weight * z.ewPerGame(r.ewinsPerGame));
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
 * same SHAPE. EPM is right-skewed with a genuinely fat top: the biggest outlier
 * in the pool sits about 4.1 standard deviations above the pool mean, while the
 * finished set's ceiling is only 2.5 above its own. Matching mean and spread
 * therefore sends six players past 28, and the clamp collapses all six onto it —
 * destroying exactly the gap that is the most visible feature of the EPM curve.
 * Stephen Curry came out one step below Shai Gilgeous-Alexander despite sitting
 * with the main body of the league rather than with the four outliers above it.
 *
 * The fix keeps the affine map for the BULK and rescales only the tail:
 *
 *     scaled  = reference.mean + z * reference.sd            (as before)
 *     knee    = the finished set's 90th percentile           (22)
 *     anchor  = the pool's own (1 - ceilingShare) quantile of `scaled`
 *     out     = scaled                     , scaled <= knee
 *             = knee + (scaled - knee) * (reference.max - knee) / (anchor - knee)
 *
 * Three properties, and each one is the reason for a piece of it:
 *
 *   - EVERY CARD IN THE BULK IS UNTOUCHED. Below the knee the map is bit-for-bit
 *     what it was, so the set keeps the finished set's level and spread and its
 *     floor still fills. That matters more than it looks: the engine only ever
 *     reads `off.speed - def.speed`, so a systematic shift of the whole set
 *     cancels in play but the SPREAD does not — and the legends (21-33, not
 *     being touched) and the shipped 306-card set are both priced against this
 *     level.
 *   - THE TAIL KEEPS ITS PROPORTIONS. Above the knee the map is still linear, so
 *     the ratio of the gaps between the outliers survives; it is only the rate
 *     that drops. That is what puts real daylight between the outlier group and
 *     the top of the cluster instead of one rounding step.
 *   - THE CEILING IS EARNED. The anchor is the pool quantile matching the share
 *     of the finished set that reached its own ceiling (2 of 283), so the top of
 *     the scale is occupied about as sparsely as it was in the set being matched
 *     rather than by everyone the clamp caught.
 *
 * The clamp is still there and still catches the two or three players above the
 * anchor. That is deliberate — the user's own expectation is "only Shai and
 * maybe Wemby/Jokic should have 28" — and it is a different thing from the six
 * it used to catch.
 */
/**
 * `calibrateOn` is the population the map is FITTED to, when that is not the
 * population being mapped.
 *
 * It exists for the historical sets. A Super Season card has to sit correctly
 * relative to CURRENT players, and the only way to guarantee that is to derive
 * the whole map — the composite's mean and standard deviation, and the tail
 * anchor — from the current pool and then push a 2009 season through it. Fit
 * the map to the historical seasons themselves and you get a set that is
 * internally sensible and means nothing next to a 2026-27 card: every card in a
 * set of career-best seasons is above average FOR THAT SET, so the map would
 * recentre a league of peaks onto the same mean as a league of everybodys.
 *
 * Defaults to the input, which is bit-for-bit the behaviour this function had
 * before the option existed — asserted in speedPower.test.js.
 */
export function mapToReferenceScale(composites, reference = REFERENCE_TOTALS, { calibrateOn } = {}) {
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

export function buildSpeedPowerTotals({ pool, actual, reference = REFERENCE_TOTALS, weight }) {
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

  const composites = compositeScores(rows, { weight });
  const totals = mapToReferenceScale(composites, reference);
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
  const reference = measured ?? REFERENCE_TOTALS;
  const referenceTotals = (referenceCards ?? []).map(c => (c.speed ?? 0) + (c.power ?? 0));

  const { records, missing } = buildSpeedPowerTotals({ pool, actual, reference });
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
    `  reference (${measured ? `measured, n=${measured.n}` : 'committed fallback'}): ` +
      `mean ${reference.mean} sd ${reference.sd} [${reference.min}, ${reference.max}] ` +
      `knee(p90) ${reference.p90} ceiling share ${(100 * reference.ceilingShare).toFixed(1)}%`
  );
  log(
    `  produced: min ${totals[0]} median ${totals[Math.floor(totals.length / 2)]} ` +
      `max ${totals[totals.length - 1]} mean ${mean.toFixed(2)} sd ${sd.toFixed(2)}`
  );

  // The top of the scale is the whole point of the taper, so it is printed
  // per-value rather than summarised: this is where a regression would show.
  const count = v => totals.filter(t => t === v).length;
  const referenceCount = measured
    ? v =>
        `${String(referenceTotals.filter(t => t === v).length).padStart(3)} ` +
        `(${((100 * referenceTotals.filter(t => t === v).length) / measured.n).toFixed(1)}%)`
    : () => '  n/a';
  log('  the top of the scale, produced vs the finished set:');
  for (let v = reference.max; v >= reference.max - 4; v -= 1) {
    log(
      `    ${v}: ${String(count(v)).padStart(3)} ` +
        `(${((100 * count(v)) / totals.length).toFixed(1)}%)   finished set ${referenceCount(v)}`
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
