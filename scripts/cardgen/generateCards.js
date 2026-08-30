// Builds the whole 2026-27 card set: every stat on every card, for all 350
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
// The layers come from different places and are of different qualities, which is
// worth knowing before trusting any single number:
//
// "THE ACTUAL SEASON" below means the regular season AND THE PLAYOFFS, folded
// into a single sample per player by scripts/cardgen/poolSeasons.js — each stat
// weighted by the volume it is actually a rate over, so those games count as
// additional data rather than as a second set to average against. A player whose
// team missed the playoffs keeps his regular-season figures exactly.
//
//   Speed / Power   From the ACTUAL season's OFF / DEF / EPM / EW-per-game
//                   (scripts/cardgen/speedPower.js), mapped onto the finished
//                   set's own distribution by magnitude. All that happens here
//                   is the positional split from
//                   memory/speed_power_methodology.md, using shares measured off
//                   the finished cards.
//
//   Shooting        From the ACTUAL season's TS%, rim FG% and 3P%, by the rule
//                   in scripts/cardgen/shooting.js: a player misses at his real
//                   miss rate, compressed onto the range the finished cards
//                   occupy. This is the layer that changed most — it used to be
//                   a regression against those cards.
//
//   Def Boost       The ACTUAL season's DEF EPM, rounded. The user's own
//                   recorded proposal, followed literally.
//
//   Scoring chart   THE ONE THING STILL ON PREDICTED DATA, and the weakest
//                   layer. A chart needs per-100 PTS / REB / AST, and the actual
//                   page reports rebounds and assists as rate percentages that
//                   cannot be inverted without team and opponent totals. (Points
//                   alone could be recovered — TS% is defined as
//                   PTS / (2 * (FGA + 0.44 * FTA)) and both attempt rates are on
//                   the page — but a chart built from actual points and
//                   predicted rebounds would be worse than one built
//                   consistently.) A real per-game distribution is not available
//                   for this pool either, so the spread comes from a fitted
//                   model of 30 real game logs and the size from the finished
//                   card set; the band logic itself is the untouched, validated
//                   computeStatBands.
//
//   Salary          Prices the FINISHED card, so it moves whenever any of the
//                   above does. Still a refit against the finished cards.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCache, REPO_ROOT } from './cache.js';
import { normalizeName } from './resolveTeams.js';
import { computeStatBands } from './bands.js';
import { reconcileBands, shapeChart } from './generate.js';
import { isBlankTier } from './zeroFloor.js';
import { applyOverrides } from './overrides.js';
import * as V from './variance.js';
import * as A from './attributes.js';
import * as S from './shooting.js';
import { readPooledActual, poolingSummary } from './poolSeasons.js';
import { trb100 } from './sources/dunksAndThrees.js';
import { CALIBRATION_FILE } from './calibrateAttributes.js';
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

/**
 * The shooting inputs for one player, from his ACTUAL season row.
 *
 * Rim FG% is the paint signal — the location the Paint Boost is about — rather
 * than overall 2P%, which blends the rim with the midrange and so understates
 * exactly the players the boost exists to mark. `attemptsFromPer75` reconstructs
 * the volume behind each percentage, which gates how far it is trusted.
 *
 * `rate` is a POOLED row (regular season plus playoffs), and that is what makes
 * the volume gate behave correctly across the fold: the attempt rate is
 * possession-weighted and `minutes` is a pooled total, so their product is
 * exactly regular-season attempts plus playoff attempts. A player with a deep
 * run therefore arrives at the shrinkage with a genuinely larger sample and is
 * shrunk less — pooled before shrinking, not after. See poolSeasons.js.
 */
export function actualShootingInput(rate) {
  return {
    tsPct: rate?.tsPct ?? null,
    paintPct: rate?.fgPctRim ?? null,
    threePct: rate?.fgPct3 ?? null,
    paintAttempts: S.attemptsFromPer75(rate?.fgaRimPer75, rate?.minutes),
    threeAttempts: S.attemptsFromPer75(rate?.fga3Per75, rate?.minutes),
  };
}

/**
 * Builds one card.
 *
 * The shooting values arrive already computed, because the rule that produces
 * them is pool-relative and cannot be evaluated one player at a time — see
 * generateCards below. What is still ordered here is salary: it prices the
 * FINISHED card (design philosophy point 8), so it comes last, after the chart
 * it is a function of exists.
 */
export function buildCard({ player, rate, actual, shooting, speedPowerTotal, calibration }) {
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

  const { shotLine, paintBoost, threePtBoost } = shooting;
  const defBoost = A.defBoostFromEpm(actual?.epmDef);

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
  const chart = shapeChart(reconcileBands(bands));

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

export function generateCards({
  pool: poolPlayers,
  teams,
  speedPower,
  rates,
  actual,
  calibration,
  overrides = {},
}) {
  const teamIndex = indexByName(teams);
  const spIndex = indexByName(speedPower);
  const rateIndex = indexByName(rates);
  const actualIndex = indexByName(actual);

  const resolved = poolPlayers.map(p => {
    const team = teamIndex.get(normalizeName(p.name));
    return { ...p, team: team?.team ?? p.team, pos: team?.pos ?? p.pos };
  });

  // The shooting layer is a POOL operation, not a per-player one: the
  // compression scale, the shrinkage strength and the centre of each boost are
  // all measured across these 350 players, so it has to run once over all of
  // them before any single card can be built.
  const actualRows = resolved.map(p => lookup(actualIndex, p.name));
  const shooting = S.buildShootingLayer(actualRows.map(actualShootingInput), {
    shotLineTarget: calibration.shotLine.target,
    paint: calibration.paintBoost,
    three: calibration.threePtBoost,
  });

  const cards = [];
  const missingRates = [];
  const missingActual = [];
  resolved.forEach((player, i) => {
    const rate = lookup(rateIndex, player.name);
    if (!rate) missingRates.push(player.name);
    if (!actualRows[i]) missingActual.push(player.name);
    const sp = spIndex.get(normalizeName(player.name));
    cards.push(
      buildCard({
        player,
        rate,
        actual: actualRows[i],
        shooting: shooting.players[i],
        speedPowerTotal: sp?.speedPowerTotal ?? 0,
        calibration,
      })
    );
  });

  const byId = Object.fromEntries(cards.map(c => [c.id, c]));
  const overridden = applyOverrides(byId, overrides);
  return {
    cards: cards.map(c => overridden[c.id]),
    missingRates,
    missingActual,
    shooting,
    // How much of the pool's stat line is postseason. Zero for a pool built off
    // regular-season-only rows, which is what makes this safe to report always.
    pooling: poolingSummary(actualRows.filter(Boolean)),
    names: resolved.map(p => p.name),
  };
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

/**
 * The shooting layer, RAW against COMPRESSED, side by side.
 *
 * The raw column is the rule applied literally — a player's Shot Line is the
 * roll at which he misses at his real TS% miss rate, and a boost is the distance
 * from there to what he really shoots at that spot. It is printed on every run
 * because it is the thing being traded away: raw lines are three to seven rolls
 * easier than any card the game has ever printed, which would roughly double
 * shot-check success and undo the balance pass in
 * docs/plans/2026-03-31-scoring-balance-design.md. Seeing both is how that trade
 * stays a decision rather than a default.
 */
export function reportShooting({ cards, shooting, names, calibration, log }) {
  const players = shooting.players;
  const line = (label, values) => {
    const v = summarize(values);
    log(
      `  ${label.padEnd(22)}${String(v.min).padStart(6)}${String(v.p10).padStart(6)}` +
        `${String(v.median).padStart(6)}${String(v.p90).padStart(6)}${String(v.max).padStart(6)}` +
        `${String(v.mean).padStart(8)}`
    );
  };

  log('SHOOTING — the rule raw, and compressed onto the finished set');
  log('                            min   p10   med   p90   max    mean');
  line('shot line RAW (TS%)', players.map(p => p.literal.shotLine));
  line('shot line COMPRESSED', cards.map(c => c.shotLine));
  line('paint boost RAW', players.map(p => p.literal.paintGap));
  line('paint boost COMPRESSED', cards.map(c => c.paintBoost));
  // The 3PT column is the player's own three-point LINE, not a gap: the boost is
  // absolute three-point ability re-centred on the pool, not a distance from the
  // Shot Line. See scripts/cardgen/shooting.js.
  line('3PT line RAW (3P%)', players.map(p => p.literal.threeLine));
  line('3PT boost COMPRESSED', cards.map(c => c.threePtBoost));
  log(
    `  d20 success rate at the median line: raw ${(
      100 * S.successRateForLine(summarize(players.map(p => p.literal.shotLine)).median)
    ).toFixed(0)}%, compressed ${(
      100 * S.successRateForLine(summarize(cards.map(c => c.shotLine)).median)
    ).toFixed(0)}%`
  );

  log('');
  log('  a spread of players, raw -> compressed');
  // One player per compressed line, and within each the one with the biggest
  // Speed+Power budget — spanning the range while naming players a reader can
  // actually check, rather than eight names nobody recognises.
  const byLine = new Map();
  names.forEach((name, i) => {
    const line = cards[i].shotLine;
    const best = byLine.get(line);
    const budget = cards[i].speed + cards[i].power;
    if (!best || budget > best.budget) byLine.set(line, { name, i, budget });
  });
  const num = v => (v == null ? '  -' : String(v).padStart(3));
  for (const [, { name, i }] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
    const p = players[i];
    const c = cards[i];
    log(
      `    ${name.padEnd(24)} line ${String(p.literal.shotLine).padStart(2)} -> ${String(c.shotLine).padStart(2)}` +
        `   paint ${num(p.literal.paintGap)} -> ${String(c.paintBoost).padStart(2)}` +
        `   3PT line ${num(p.literal.threeLine)} -> boost ${String(c.threePtBoost).padStart(2)}`
    );
  }

  log('');
  log('  boost distribution vs the finished cards it was calibrated against');
  for (const key of ['paintBoost', 'threePtBoost']) {
    const real = calibration[key].quality.realHistogram;
    const realTotal = Object.values(real).reduce((a, b) => a + b, 0);
    const asShare = h =>
      Object.entries(h)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([k, v]) => `${k}:${((100 * v) / (h === real ? realTotal : cards.length)).toFixed(0)}%`)
        .join(' ');
    const produced = Object.fromEntries(histogram(cards.map(c => c[key])));
    log(`    ${key} produced  ${asShare(produced)}`);
    log(`    ${' '.repeat(key.length)} real      ${asShare(real)}`);
  }

  // Sizes the follow-up task: the chart restructure wants a band boundary AT the
  // shot line, so that the arrow marks the row where scoring starts. This counts
  // how many charts already happen to break there.
  const breaks = cards.filter(c => c.chart.some(t => t.lo === c.shotLine)).length;
  log('');
  log(
    `  charts whose band already starts exactly at the shot line: ${breaks}/${cards.length} ` +
      `(${((100 * breaks) / cards.length).toFixed(0)}%)`
  );
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
  // Regular season and playoffs folded into one sample per player — see
  // scripts/cardgen/poolSeasons.js for which volume each stat pools on.
  const actual = readPooledActual(CURRENT_STATS_SEASON);
  if (!actual) {
    throw new Error(
      `No cached dunksandthrees ACTUAL rates for ${CURRENT_STATS_SEASON} — run ` +
        'scripts/cardgen/fetchCalibrationData.js first.'
    );
  }
  const overridesFile = path.join(REPO_ROOT, 'scripts', 'cardgen', 'overrides.json');
  const { cards, missingRates, missingActual, shooting, pooling, names } = generateCards({
    pool: readJson(path.join(GEN_DIR, 'player-pool-2026.json')),
    teams: readJson(path.join(GEN_DIR, 'player-teams-2026.json')),
    speedPower: readJson(path.join(GEN_DIR, 'speed-power-totals-2026.json')),
    rates,
    actual,
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
      'PROVISIONAL. Shot Line, Paint Boost, 3PT Boost, Def Boost and the Speed/Power budget come ' +
      "from dunksandthrees' ACTUAL 2025-26 season page, REGULAR SEASON AND PLAYOFFS POOLED — " +
      'playoff games are folded in as additional data, each stat volume-weighted by the ' +
      'denominator it is a rate over (possessions for EPM/OFF/DEF, true shooting attempts for ' +
      'TS%, the relevant attempts for each location percentage, games for EW/GP); a player whose ' +
      'team missed the playoffs is unchanged. The shooting three are the stated probability rule ' +
      "(a player misses at his real miss rate) compressed onto the finished set's own " +
      'distribution. Charts are still synthesized from the PREDICTED per-100 rates, because the ' +
      'actual page carries no per-100 rebound or assist counts. See scripts/cardgen/shooting.js, ' +
      'scripts/cardgen/poolSeasons.js and card-data/generated/card-calibration.json.',
    cards,
  };
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(payload, null, 1)}\n`);

  log(`${cards.length} cards -> ${path.relative(REPO_ROOT, OUTPUT_FILE)}`);
  if (missingRates.length) {
    log(`  no predicted stat line for ${missingRates.length}: ${missingRates.join(', ')}`);
  }
  if (missingActual.length) {
    log(`  no ACTUAL stat line for ${missingActual.length}: ${missingActual.join(', ')}`);
  }
  log(
    `  playoffs folded in: ${pooling.gained}/${pooling.players} players gained games ` +
      `(${pooling.playoffGames} playoff games total, median ${pooling.medianPlayoffGames}, ` +
      `max ${pooling.maxPlayoffGames}); the other ${pooling.players - pooling.gained} are unchanged`
  );
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
  const blank = cards.filter(c => isBlankTier(c.chart[0]));
  const noScoring = cards.filter(c => c.chart.length > 1 && c.chart[1].pts === 0);
  // Tier 2 is meant to READ differently from tier 1 — "they don't score", not
  // "nothing happens". Where the bottom decile's rebounds and assists both
  // round to zero it cannot, and that is worth counting rather than hiding.
  const alsoBlank = noScoring.filter(c => c.chart[1].reb === 0 && c.chart[1].ast === 0);
  log(`  blank natural-1 tier    : ${blank.length}/${cards.length}`);
  log(`  second non-scoring tier : ${noScoring.length}/${cards.length}`);
  log(`    of those, also 0 reb and 0 ast : ${alsoBlank.length}`);
  log(
    `  tiers per card          : ${histogram(cards.map(c => c.chart.length))
      .map(([k, v]) => `${k}:${v}`)
      .join(' ')}  (printed rows: one fewer)`
  );
  log(`  speed+power sums to budget : ${cards.every(c => c.speed >= 1 && c.power >= 1) ? 'all >= 1 each' : 'CHECK'}`);
  log('');
  reportShooting({ cards, shooting, names, calibration, log });
  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
