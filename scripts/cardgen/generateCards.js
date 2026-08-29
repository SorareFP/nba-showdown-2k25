// Builds the whole 2026-27 card set: every stat on every card, for all 331
// players in the pool.
//
//   node scripts/cardgen/generateCards.js
//
// Writes card-data/generated/cards-2026-27.json, which the studio picks up
// automatically. Needs no network — the stat snapshot is in card-data/cache/ and
// the fitted parameters are in card-data/generated/card-calibration.json, both
// committed. Re-run scripts/cardgen/fetchCalibrationData.js to refresh the
// snapshot and scripts/cardgen/calibrateAttributes.js to refit.
//
// EVERY VALUE IT PRODUCES IS PROVISIONAL, and the file says so on every record.
// The three layers come from three different places and are of three different
// qualities, which is worth knowing before trusting any single number:
//
//   Speed / Power   The combined budget was already derived (EPM-led composite,
//                   mapped onto the finished set's distribution). All that
//                   happens here is the positional split from
//                   memory/speed_power_methodology.md, using shares measured off
//                   the finished cards. This is the most faithful layer.
//
//   Scoring chart   A real distribution is not available for this pool, only
//                   per-100 means. The spread is borrowed from a fitted model of
//                   30 real game logs and the size from the finished card set;
//                   the band logic itself is the untouched, validated
//                   computeStatBands. Reproduces the finished cards' band values
//                   exactly about 70% of the time and within one about 99%.
//
//   Shooting        The weakest. The original rules were hand-calibrated and are
//                   not recoverable (memory/shooting_attributes_methodology.md
//                   says so plainly). These are refits against the finished
//                   cards, anchored on the one verified thing — the D20
//                   probability calibration — and their error rates are printed
//                   on every run. Paint Boost in particular is close to
//                   unpredictable from box-score rates: 90% of real ones are
//                   zero and the model largely agrees by also saying zero.
//
// Def Boost is neither of those: it is dunksandthrees' DEF EPM rounded, which is
// the user's own recorded proposal, followed literally.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCache, REPO_ROOT } from './cache.js';
import { normalizeName } from './resolveTeams.js';
import { computeStatBands } from './bands.js';
import { reconcileBands } from './generate.js';
import { enforceZeroFloor } from './zeroFloor.js';
import { applyOverrides } from './overrides.js';
import * as V from './variance.js';
import * as A from './attributes.js';
import { trb100 } from './sources/dunksAndThrees.js';
import {
  poolContext,
  shotLineFeatures,
  threePtFeatures,
  paintFeatures,
  CALIBRATION_FILE,
} from './calibrateAttributes.js';
import { CURRENT_STATS_SEASON } from './fetchCalibrationData.js';
import { playerIdFromName } from '../../src/cards/playerId.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const OUTPUT_FILE = path.join(GEN_DIR, 'cards-2026-27.json');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * Names the stat source spells differently from the pool.
 *
 * Kept as an explicit list rather than a fuzzy matcher: a fuzzy match that is
 * wrong gives a player somebody else's stat line, and nothing downstream would
 * ever notice. One entry today.
 */
export const STAT_NAME_ALIASES = {
  // dunksandthrees lists Detroit's rookie under his full legal name.
  'Ron Holland': 'Ronald Holland II',
};

export function indexByName(rows, keyOf = r => r.name) {
  const m = new Map();
  for (const r of rows ?? []) {
    const k = normalizeName(keyOf(r));
    const prev = m.get(k);
    if (!prev || (r.games ?? 0) > (prev.games ?? 0)) m.set(k, r);
  }
  return m;
}

const lookup = (index, name) =>
  index.get(normalizeName(STAT_NAME_ALIASES[name] ?? name)) ?? index.get(normalizeName(name)) ?? null;

/** The shooting inputs, in the units calibrateAttributes.js's feature builders expect. */
export function shootingInputFromRate(rate, mpg) {
  const fga3 = rate.fga3Per100 ?? 0;
  const fga2 = rate.fga2Per100 ?? 0;
  return {
    ts: rate.tsPct ?? 0,
    pts100: rate.pts100 ?? 0,
    usg: rate.usage ?? 0,
    mpg: mpg ?? 0,
    fg3: rate.fgPct3 ?? 0,
    fg3a100: fga3,
    // Basketball-Reference's 3PAr is 3PA/FGA; dunksandthrees splits attempts by
    // location instead, so it is reconstructed rather than read.
    fg3aRate: fga2 + fga3 > 0 ? fga3 / (fga2 + fga3) : 0,
    fg2: rate.fgPct2 ?? 0,
    fg2a100: fga2,
    fta100: rate.ftaPer100 ?? 0,
  };
}

/**
 * Builds one card.
 *
 * ORDER MATTERS and is the resolution order from the shooting model: the Shot
 * Line is the baseline, the boosts are modifiers measured AGAINST that baseline
 * (which is why they need it as an input, not the other way round), and salary
 * prices the finished card, so it comes last.
 */
export function buildCard({ player, rate, speedPowerTotal, calibration, pool }) {
  const per100 = {
    pts: rate?.pts100 ?? 0,
    reb: rate ? trb100(rate) : 0,
    ast: rate?.ast100 ?? 0,
  };
  const { speed, power } = A.splitSpeedPower(
    speedPowerTotal,
    player.pos,
    calibration.positionSpeedShare
  );

  const input = shootingInputFromRate(rate ?? {}, player.mpg);
  const shotLine = A.shotLineFromScore(
    A.applyModel(calibration.shotLine.model, shotLineFeatures(input, pool))
  );
  const withLine = { ...input, shotLine };
  const threePtBoost = A.shapeBoost(
    A.applyModel(calibration.threePtBoost.model, threePtFeatures(withLine, pool)),
    calibration.threePtBoost
  );
  const paintBoost = A.shapeBoost(
    A.applyModel(calibration.paintBoost.model, paintFeatures(withLine, pool)),
    calibration.paintBoost
  );
  const defBoost = A.defBoostFromEpm(rate?.epmDef);

  // Each stat gets its own corrected level (see fitChartLevel), so the three
  // columns are synthesized separately and then reconciled onto one spine.
  const bands = {};
  for (const stat of V.CHART_STATS) {
    const fit = { level: calibration.chart.levels[stat], shape: calibration.chart.shape };
    const games = V.synthesizeGames({
      per100: { [stat]: per100[stat] },
      mpg: player.mpg,
      games: player.games,
      fit,
    });
    bands[stat] = computeStatBands(games, stat);
  }
  const chart = enforceZeroFloor(reconcileBands(bands));

  const card = {
    id: playerIdFromName(player.name),
    name: player.name,
    team: player.team,
    pos: player.pos,
    speed,
    power,
    shotLine,
    paintBoost,
    threePtBoost,
    defBoost,
    salary: null,
    // The top tier is open-ended, matching src/game/rawCards.js's convention and
    // what CardTemplate's formatRollRange renders as "20+".
    chart: chart.map((t, i) => ({
      lo: t.lo,
      hi: i === chart.length - 1 ? 99 : t.hi,
      pts: t.pts,
      reb: t.reb,
      ast: t.ast,
    })),
    provisional: true,
  };

  const ev = Object.fromEntries(
    V.CHART_STATS.map(stat => [stat, expectedValuePerRoll(card.chart, stat)])
  );
  card.salary = A.roundSalary(
    A.applyModel(calibration.salary.model, A.salaryFeatures(card, ev))
  );
  return card;
}

/** Expected value per face of a d20, the measure the finished set is priced on. */
export function expectedValuePerRoll(chart, stat, faces = 20) {
  let total = 0;
  for (let roll = 1; roll <= faces; roll += 1) {
    const tier = chart.find(t => roll >= t.lo && roll <= t.hi);
    total += tier?.[stat] ?? 0;
  }
  return total / faces;
}

export function generateCards({ pool: poolPlayers, teams, speedPower, rates, calibration, overrides = {} }) {
  const teamIndex = indexByName(teams);
  const spIndex = indexByName(speedPower);
  const rateIndex = indexByName(rates);

  const resolved = poolPlayers.map(p => {
    const team = teamIndex.get(normalizeName(p.name));
    return { ...p, team: team?.team ?? p.team, pos: team?.pos ?? p.pos };
  });

  const inputs = resolved.map(p => shootingInputFromRate(lookup(rateIndex, p.name) ?? {}, p.mpg));
  const poolCtx = poolContext(inputs);

  const cards = [];
  const missingRates = [];
  for (const player of resolved) {
    const rate = lookup(rateIndex, player.name);
    if (!rate) missingRates.push(player.name);
    const sp = spIndex.get(normalizeName(player.name));
    cards.push(
      buildCard({
        player,
        rate,
        speedPowerTotal: sp?.speedPowerTotal ?? 0,
        calibration,
        pool: poolCtx,
      })
    );
  }

  const byId = Object.fromEntries(cards.map(c => [c.id, c]));
  const overridden = applyOverrides(byId, overrides);
  return { cards: cards.map(c => overridden[c.id]), missingRates };
}

/** min / median / max plus a value histogram, for the run report. */
export function summarize(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return { n: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return {
    n: v.length,
    min: v[0],
    p10: v[Math.floor(0.1 * (v.length - 1))],
    median: v[Math.floor(0.5 * (v.length - 1))],
    p90: v[Math.floor(0.9 * (v.length - 1))],
    max: v[v.length - 1],
    mean: Number(mean.toFixed(2)),
  };
}

/**
 * Value counts, in ascending numeric order, as PAIRS.
 *
 * Not a plain object: JavaScript orders an object's integer-like keys
 * numerically but keeps every other key in insertion order, and "-1" is not an
 * integer index. So an object histogram of boosts prints as
 * `0 1 2 3 4 -3 -2 -1` — the negatives exiled to the end, which in a report
 * about a stat whose whole point is that it can be negative reads as a bug in
 * the data rather than in the printing.
 */
export function histogram(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0] - b[0]);
}

export function main({ log = console.log } = {}) {
  const calibration = readJson(CALIBRATION_FILE);
  const rates = readCache(`dunksandthrees-epm-${CURRENT_STATS_SEASON}`);
  if (!rates) {
    throw new Error(
      `No cached dunksandthrees rates for ${CURRENT_STATS_SEASON} — run ` +
        'scripts/cardgen/fetchCalibrationData.js first.'
    );
  }
  const overridesFile = path.join(REPO_ROOT, 'scripts', 'cardgen', 'overrides.json');
  const { cards, missingRates } = generateCards({
    pool: readJson(path.join(GEN_DIR, 'player-pool-2026.json')),
    teams: readJson(path.join(GEN_DIR, 'player-teams-2026.json')),
    speedPower: readJson(path.join(GEN_DIR, 'speed-power-totals-2026.json')),
    rates,
    calibration,
    overrides: fs.existsSync(overridesFile) ? readJson(overridesFile) : {},
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    provisional: true,
    set: '2026-27',
    statsSeason: CURRENT_STATS_SEASON,
    calibratedAgainst: calibration.referenceSeason,
    note:
      'PROVISIONAL. Charts are synthesized from per-100 season rates, not real per-game logs; ' +
      'Shot Line and the Paint/3PT boosts are refits against the finished 2025-26 card set, not ' +
      'the original hand-calibrated rules. See scripts/cardgen/variance.js and ' +
      'card-data/generated/card-calibration.json for the fitted parameters and their error rates.',
    cards,
  };
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(payload, null, 1)}\n`);

  log(`${cards.length} cards -> ${path.relative(REPO_ROOT, OUTPUT_FILE)}`);
  if (missingRates.length) {
    log(`  no stat line for ${missingRates.length}: ${missingRates.join(', ')}`);
  }
  log('');
  const fields = ['speed', 'power', 'shotLine', 'paintBoost', 'threePtBoost', 'defBoost', 'salary'];
  log('field         n   min   p10   med   p90   max   mean');
  for (const f of fields) {
    const s = summarize(cards.map(c => c[f]));
    log(
      `${f.padEnd(13)}${String(s.n).padStart(3)}${String(s.min).padStart(6)}${String(s.p10).padStart(6)}` +
        `${String(s.median).padStart(6)}${String(s.p90).padStart(6)}${String(s.max).padStart(6)}${String(s.mean).padStart(7)}`
    );
  }
  log('');
  for (const f of ['shotLine', 'paintBoost', 'threePtBoost', 'defBoost']) {
    log(`${f.padEnd(13)} ${histogram(cards.map(c => c[f])).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  }
  log('');
  log('chart expected value per d20 roll');
  for (const stat of V.CHART_STATS) {
    const s = summarize(cards.map(c => Number(expectedValuePerRoll(c.chart, stat).toFixed(2))));
    log(`  ${stat}  min ${s.min}  median ${s.median}  p90 ${s.p90}  max ${s.max}  mean ${s.mean}`);
  }
  const zeroFloor = cards.filter(c => c.chart[0].pts === 0 && c.chart[0].reb === 0 && c.chart[0].ast === 0);
  const twoZero = cards.filter(
    c => c.chart.length > 1 && c.chart[1].pts === 0 && c.chart[1].reb === 0 && c.chart[1].ast === 0
  );
  log(`  zero floor on natural 1 : ${zeroFloor.length}/${cards.length}`);
  log(`  second non-scoring tier : ${twoZero.length}/${cards.length}`);
  log(`  speed+power sums to budget : ${cards.every(c => c.speed >= 1 && c.power >= 1) ? 'all >= 1 each' : 'CHECK'}`);
  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
