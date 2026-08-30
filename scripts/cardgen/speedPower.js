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
// KEPT, because the user asked for both explicitly:
//
//   - The MAGNITUDE-PRESERVING map onto the finished set's own distribution.
//     Rank/quantile mapping was tried first and rejected: it put Kawhi Leonard
//     and Stephen Curry in the same bucket purely because they ranked in the
//     same narrow top-N window, discarding a real gap. So the composite is
//     z-scored and rescaled by the finished set's mean and standard deviation,
//     which preserves relative distances exactly and lets a genuine cluster stay
//     a cluster.
//   - The refinement weight of 0.35. Still first-pass and still tunable; kept
//     rather than re-tuned so that switching data sources is the only variable
//     in this change.
//
// CHANGED: every input is now the ACTUAL season, and the nine Basketball-
// Reference stats are gone.
//
//   composite = z(EPM) + 0.35 * mean( z(OFF), z(DEF), z(EW/GP) )
//
// WHY THOSE THREE as the refinement, when EPM is exactly OFF + DEF and so
// carries no information the split does not:
//
//   - The SPLIT is the information. OFF has about 1.6x the spread of DEF across
//     the pool, so EPM alone is roughly an OFF ranking with a defensive
//     rounding error. Averaging z(OFF) and z(DEF) puts the two halves on equal
//     footing, which is the right prior for a stat feeding SPEED and POWER —
//     two-way physical presence, not offensive value.
//   - EW/GP restores the volume dimension EPM deliberately lacks. EPM is a rate:
//     a 13-minute reserve who is efficient in his minutes rates alongside a
//     starter. Expected wins per game is that rate times playing time, which is
//     what the nine Basketball-Reference stats (VORP, WS, OWS, DWS) were
//     contributing before, from a source we no longer need.
//
// The old note's known limitation still stands: the finished set is sparse at
// the extremes (only two players ever reached 28), so genuinely different
// composites can land on the same integer near the top. That is a property of
// preserving the finished set's shape, and the user declined the available fix
// (blending in the legend cards' headroom) — "we won't touch the legends".

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCache, REPO_ROOT } from './cache.js';
import { normalizeName } from './resolveTeams.js';
import { loadReferenceCards } from './referenceCards.js';
import { meanSd, zScorer } from './attributes.js';
import { CURRENT_STATS_SEASON } from './fetchCalibrationData.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const OUTPUT_FILE = path.join(GEN_DIR, 'speed-power-totals-2026.json');

/** How much the OFF/DEF/EW-per-game refinement moves the EPM-led ranking. */
export const REFINEMENT_WEIGHT = 0.35;

/**
 * The finished set's own Speed+Power distribution — the target of the map.
 *
 * Measured off the 283 non-legend cards in `Final Cards.csv`, and duplicated
 * here as the fallback for a checkout without that gitignored file, exactly like
 * POSITION_SPEED_SHARE in attributes.js. The 23 legends are excluded: their
 * budgets run 21-33 off peak historical seasons, and mixing them in would
 * inflate the scale for a pool of current players.
 */
export const REFERENCE_TOTALS = { mean: 17.7951, sd: 4.0814, min: 10, max: 28 };

export function measureReferenceTotals(cards) {
  const totals = (cards ?? [])
    .map(c => (c.speed ?? 0) + (c.power ?? 0))
    .filter(t => Number.isFinite(t) && t > 0);
  if (totals.length === 0) return null;
  const { mean, sd } = meanSd(totals);
  return {
    mean: Number(mean.toFixed(4)),
    sd: Number(sd.toFixed(4)),
    min: Math.min(...totals),
    max: Math.max(...totals),
    n: totals.length,
  };
}

/**
 * The composite ranking score, one per player.
 *
 * Every input is z-scored WITHIN THIS POOL, so the composite says "relative to
 * the 331 players being carded" rather than "relative to all 602 in the league",
 * which is the population the card set actually has to spread across.
 */
export function compositeScores(rows, { weight = REFINEMENT_WEIGHT } = {}) {
  const z = {
    epm: zScorer(rows.map(r => r.epm)),
    off: zScorer(rows.map(r => r.epmOff)),
    def: zScorer(rows.map(r => r.epmDef)),
    ewPerGame: zScorer(rows.map(r => r.ewinsPerGame)),
  };
  return rows.map(r => {
    const refinement = (z.off(r.epmOff) + z.def(r.epmDef) + z.ewPerGame(r.ewinsPerGame)) / 3;
    return z.epm(r.epm) + weight * refinement;
  });
}

/**
 * Rescales composites onto the reference distribution by magnitude.
 *
 * NOT a rank/quantile map. The difference matters at the top: a quantile map
 * hands out exactly as many 28s as the finished set had, which forces players
 * with visibly different composites into the same bucket. This map only asks
 * that the pool's mean and spread match, so a genuine cluster survives as a
 * cluster and a genuine gap survives as a gap.
 */
export function mapToReferenceScale(composites, reference = REFERENCE_TOTALS) {
  const { mean, sd } = meanSd(composites);
  return composites.map(c => {
    const z = sd > 0 ? (c - mean) / sd : 0;
    const scaled = Math.round(reference.mean + z * reference.sd);
    return Math.min(Math.max(scaled, reference.min), reference.max);
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
    composite: Number(composites[i].toFixed(4)),
    speedPowerTotal: totals[i],
    provisional: true,
  }));
  records.sort((a, b) => b.composite - a.composite || a.name.localeCompare(b.name));
  return { records, missing };
}

export function main({ log = console.log } = {}) {
  const actual = readCache(`dunksandthrees-actual-${CURRENT_STATS_SEASON}`);
  if (!actual) {
    throw new Error(
      `No cached dunksandthrees ACTUAL rates for ${CURRENT_STATS_SEASON} — run ` +
        'scripts/cardgen/fetchCalibrationData.js first.'
    );
  }
  const pool = JSON.parse(fs.readFileSync(path.join(GEN_DIR, 'player-pool-2026.json'), 'utf8'));
  // The reference distribution is measured when the gitignored CSV is present
  // and falls back to the committed constants when it is not, so a public
  // checkout regenerates the same numbers.
  const measured = measureReferenceTotals(loadReferenceCards());
  const reference = measured ?? REFERENCE_TOTALS;

  const { records, missing } = buildSpeedPowerTotals({ pool, actual, reference });
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(records, null, 1)}\n`);

  const totals = records.map(r => r.speedPowerTotal).sort((a, b) => a - b);
  const { mean, sd } = meanSd(totals);
  log(`${records.length} budgets -> ${path.relative(REPO_ROOT, OUTPUT_FILE)}`);
  if (missing.length) log(`  no actual stat line for ${missing.length}: ${missing.join(', ')}`);
  log(
    `  reference (${measured ? `measured, n=${measured.n}` : 'committed fallback'}): ` +
      `mean ${reference.mean} sd ${reference.sd} [${reference.min}, ${reference.max}]`
  );
  log(
    `  produced: min ${totals[0]} median ${totals[Math.floor(totals.length / 2)]} ` +
      `max ${totals[totals.length - 1]} mean ${mean.toFixed(2)} sd ${sd.toFixed(2)}`
  );
  log('  top 10:');
  for (const r of records.slice(0, 10)) {
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
