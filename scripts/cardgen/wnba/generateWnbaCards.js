// Builds the whole WNBA set.
//
//   node scripts/cardgen/wnba/generateWnbaCards.js
//
// Writes card-data/generated/wnba-pool-2026.json (who is in) and
// card-data/generated/cards-wnba.json (every number on every card), both of
// which the studio picks up automatically. Needs no network: the WNBA tables
// are cached by wnba/fetchWnba.js, the BPM model by wnba/fitBpmModel.js, and
// the shared attribute calibration by the base set's calibrateAttributes.js.
//
// Full rebuild order:
//   node scripts/cardgen/wnba/fetchWnba.js
//   node scripts/cardgen/wnba/fitBpmModel.js
//   node scripts/cardgen/wnba/generateWnbaCards.js
//
// ── WHERE EACH LAYER COMES FROM, AND HOW FAR IT CAN BE TRUSTED ──────────────
//
//   Speed + Power   z(fitted BPM) + 0.35 * z(fitted VORP per game), mapped onto
//                   the finished set's Speed+Power distribution WITH THE
//                   CURRENT NBA POOL AS THE CALIBRATION BASIS — so a WNBA card
//                   sits on the same yardstick as a 2026-27 one rather than on
//                   a scale of its own. The composite's shape is the BASE set's
//                   (`z(EPM) + 0.35 * z(EW/GP)`), not the special sets', and
//                   the reason is that the special sets dropped their volume
//                   term only because Win Shares was the sole stand-in for it
//                   and Win Shares is team-dependent. A fitted VORP restores
//                   volume without restoring team quality, which is exactly
//                   what generateSpecialSets.js says it would do if it had one.
//
//   Def Boost       The fitted DBPM, rounded — the same rule and the same
//                   rounding the special sets apply to real DBPM.
//
//   Shot Line and   The stated probability rule on real WNBA TS% / 2P% / 3P%,
//   the boosts      compressed onto the finished set's own distribution USING
//                   THE WNBA POOL AS THE COMPRESSION BASIS. See runShooting.
//
//   Scoring chart   The same synthesis the base set uses, anchored on
//                   Basketball-Reference's WNBA season TOTALS — real
//                   production, not a prediction, and per-four-minute
//                   production straight from `4 * total / minutes` with no pace
//                   in it. THE NBA PIPELINE CANNOT DO THIS: dunksandthrees
//                   publishes per-100 rates only, so it has to reconstruct the
//                   figure at an assumed league pace and wears each player's
//                   own team pace as error. See wnba/constants.js for the
//                   40-minute derivation and why it is reported anyway.
//
//   Salary          The finished set's salary model, applied to the finished
//                   card, exactly as everywhere else.
//
// ── THE ONE THING THAT IS NOT MEASURABLE FROM INSIDE THIS DATA ──────────────
//
// EVERY CROSS-LEAGUE COMPARISON HERE IS LEAGUE-RELATIVE, NOT ABSOLUTE. The
// fitted BPM is a deviation from the WNBA's own average and it is placed on the
// NBA pool's scale, so the top of this set lands where the top of the NBA set
// does. That is a design decision — it is what makes a WNBA card playable
// beside an NBA one — and it is not a claim that the two leagues' best players
// are equally good. Nothing in any published data could settle that, and this
// pipeline does not pretend to.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCache, REPO_ROOT } from '../cache.js';
import { normalizeName } from '../resolveTeams.js';
import { computeStatBands } from '../bands.js';
import { reconcileBands, shapeChart, MAX_CHART_TIERS } from '../generate.js';
import * as V from '../variance.js';
import * as A from '../attributes.js';
import * as PV from '../playValue.js';
import * as S from '../shooting.js';
import { CALIBRATION_FILE } from '../calibrateAttributes.js';
import { PRINTED_SCALE, REFINEMENT_WEIGHT, mapToReferenceScale } from '../speedPower.js';
import * as bpmArchive from './nbaBpmArchive.js';
import { playerIdFromName } from '../../../src/cards/playerId.js';
import { WNBA_SET } from '../../../src/cards/sets.js';
import { applyModel, centringBasis, centredFeatures, predict } from './bpmModel.js';
import { featureRow } from './fitBpmModel.js';
import { MODEL_FILE } from './fitBpmModel.js';
import { readRoster, readSeason } from './fetchWnba.js';
import {
  WNBA_SEASON,
  WNBA_BLEND_SEASON,
  WNBA_POOL_RULE,
  WNBA_GAME_MINUTES,
  SECTIONS_PER_GAME,
  leaguePace,
  possessionsPerSection,
  possessionsFromMinutes,
  nbaConventionPer100,
} from './constants.js';
import {
  buildPool,
  cardedRows,
  joinWnbaSeason,
  readForceInclude,
  per4MinFromTotals,
  poolWeighted,
  wnbaFeatureRow,
} from './pool.js';
import { resolveWnbaTeams } from './resolveWnbaTeams.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const POOL_FILE = path.join(GEN_DIR, 'wnba-pool-2026.json');
export const CARDS_FILE = path.join(GEN_DIR, `cards-${WNBA_SET}.json`);
const NBA_POOL_FILE = path.join(GEN_DIR, 'player-pool-2026.json');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * Replacement level, in BPM units. Basketball-Reference's own definition, and
 * therefore the point VORP is zero at — which is what lets a fitted VORP fall
 * out of a fitted BPM without a second decision.
 */
export const REPLACEMENT_BPM = -2.0;

/**
 * A VORP-equivalent, per game: value above replacement times time on the floor.
 *
 * `minutes / games / gameMinutes` is the share of a game the player is on it, so
 * this is a rate multiplied by playing time — the same thing Estimated Wins per
 * game is to EPM in the base set's composite, and league-length-agnostic
 * because each league divides by its own game.
 */
export function vorpPerGame(bpm, { minutes, games }, gameMinutes) {
  if (!Number.isFinite(bpm) || !(games > 0) || !(minutes > 0)) return null;
  return (bpm - REPLACEMENT_BPM) * (minutes / games / gameMinutes);
}

export const COMPOSITE_INPUTS = {
  bpm: r => r.bpmHat,
  vorpPerGame: r => r.vorpPerGameHat,
};

export const COMPOSITE_METRIC_SETS = {
  bpmOnly: { bpm: 1 },
  bpmVorp: { bpm: 1, vorpPerGame: REFINEMENT_WEIGHT },
};

/** THE ACTIVE COMPOSITE. One line to change; the run report prints both. */
export const COMPOSITE_WEIGHTS = COMPOSITE_METRIC_SETS.bpmVorp;

const z = (value, stats) =>
  Number.isFinite(value) && stats?.sd > 0 ? (value - stats.mean) / stats.sd : 0;

export function composite(row, basis, weights = COMPOSITE_WEIGHTS) {
  let total = 0;
  for (const [key, w] of Object.entries(weights)) {
    total += w * z(COMPOSITE_INPUTS[key](row), basis[key]);
  }
  return total;
}

export function compositeBasis(rows, weights = COMPOSITE_WEIGHTS) {
  const basis = {};
  for (const key of Object.keys(weights)) basis[key] = A.meanSd(rows.map(COMPOSITE_INPUTS[key]));
  return basis;
}

/**
 * Speed+Power totals for the WNBA pool, on the NBA's absolute scale.
 *
 * `archive` is scripts/cardgen/wnba/nbaBpmArchive.js — 4,780 cardable NBA
 * player-seasons, 2012-2026, rated by this same fitted model. BOTH the z-score
 * basis and the map's tail anchor come from it, and the WNBA rows are then
 * pushed through unchanged. That file carries the full argument, including the
 * cross-league assumption this rests on and the reason both sides are scored
 * with PREDICTED rather than real BPM.
 *
 * WHAT THIS REPLACED: the basis used to be the 2026-27 NBA POOL — one season,
 * 350 players — so a WNBA card was placed relative to this year's NBA field and
 * the tail anchor was "the third-best NBA player of 2025-26". The reason it is
 * not any more is the reason every other set changed; see epmArchive.js.
 */
export function speedPowerTotals(
  rows,
  { archive = bpmArchive.requireArchive(), weights = COMPOSITE_WEIGHTS, reference = PRINTED_SCALE } = {}
) {
  const basis = bpmArchive.archiveBasis(archive);
  const composites = rows.map(r => composite(r, basis, weights));
  return {
    composites,
    totals: mapToReferenceScale(composites, reference, { calibrateOn: archive.composites }),
  };
}

/**
 * The shooting inputs for one WNBA player.
 *
 * 2P% stands in for rim FG%, the same substitution and the same weakness the
 * special sets carry: it blends the rim with the midrange, so it understates
 * exactly the rim-finishing bigs the Paint Boost exists to mark. There is no
 * shot-location split anywhere in Basketball-Reference's WNBA tables.
 *
 * THE ATTEMPT COUNTS ARE REAL, which is one place this set is BETTER than
 * either NBA path. Both of those reconstruct attempts from a per-possession
 * rate and an assumed league pace; the WNBA per-game table publishes attempts
 * per game and games played, so the product is the season's attempts exactly,
 * and the shrinkage gate is weighted on a measured sample size rather than an
 * estimated one.
 */
export function wnbaShootingInput(row) {
  return {
    tsPct: row.tsPct ?? null,
    paintPct: row.fgPct2 ?? null,
    threePct: row.fgPct3 ?? null,
    paintAttempts: row.fg2aTotal ?? 0,
    threeAttempts: row.fg3aTotal ?? 0,
  };
}

/** Expected value per face of a d20 — the measure the finished set is priced on. */
export function expectedValuePerRoll(chart, stat, faces = 20) {
  let total = 0;
  for (let roll = 1; roll <= faces; roll += 1) {
    const tier = chart.find(t => roll >= t.lo && roll <= t.hi);
    total += tier?.[stat] ?? 0;
  }
  return total / faces;
}

/**
 * One card.
 *
 * The per-100 rates are restated in the NBA's per-100 convention on the way
 * into `synthesizeGames`, which is what carries the 40-minute correction — see
 * wnba/constants.js. Everything else is the base set's own path, unchanged.
 */
export function buildWnbaCard({ row, team, shooting, speedPowerTotal, calibration }) {
  const games = row.games ?? 0;
  const minutes = row.minutes ?? 0;
  const mpg = games > 0 ? minutes / games : 0;
  // `synthesizeGames` reads its input as an NBA-convention per-100 rate, so the
  // exact per-four-minute production is restated in those units — see
  // nbaConventionPer100 in wnba/constants.js. It is a UNIT CHANGE and not an
  // approximation: what goes in is `4 * total / minutes`, measured.
  const per100 = {
    pts: nbaConventionPer100(per4MinFromTotals(row.ptsTotal, minutes)),
    reb: nbaConventionPer100(per4MinFromTotals(row.trbTotal, minutes)),
    ast: nbaConventionPer100(per4MinFromTotals(row.astTotal, minutes)),
  };
  // POSITION LABEL ONLY, deliberately, and now for two reasons rather than one.
  //
  // SIZE: the NBA sets bend this split by height and weight (A.SIZE_SPEED_SHARE),
  // but the biometrics come from dunksandthrees' `season-epm`, which is an NBA
  // endpoint with no WNBA equivalent.
  //
  // SHARES: the NBA sets also read Basketball-Reference's play-by-play position
  // estimates (A.SPLIT_RULE). CHECKED, NOT ASSUMED —
  // /wnba/years/2025_play-by-play.html and /wnba/years/2026_play-by-play.html
  // both answer 404 (verified 2026-08-31), and no WNBA table on the site carries
  // a Position Estimate group at all.
  //
  // Basketball-Reference is the only source this set has, and that is the reason
  // every WNBA card is provisional. Omitting both arguments gives exactly the
  // rule this file has always used rather than dropping players who cannot be
  // measured, which is what `splitSpeedPower` makes the default.
  const { speed, power } = A.splitSpeedPower(
    speedPowerTotal,
    row.pos,
    calibration.positionSpeedShare
  );
  const { shotLine, paintBoost, threePtBoost } = shooting;
  const defBoost = A.defBoostFromEpm(row.dbpmHat);

  const bands = {};
  for (const stat of V.CHART_STATS) {
    const fit = { level: calibration.chart.levels[stat], shape: calibration.chart.shape };
    bands[stat] = computeStatBands(
      V.synthesizeGames({ per100: { [stat]: per100[stat] }, mpg, games, fit }),
      stat
    );
  }
  const chart = shapeChart(reconcileBands(bands), { shotLine });

  const card = {
    id: playerIdFromName(row.name),
    name: row.name,
    team,
    pos: row.pos,
    speed,
    power,
    shotLine,
    paintBoost,
    threePtBoost,
    defBoost,
    salary: null,
    chart: chart.map((t, i) => ({
      lo: t.lo,
      hi: i === chart.length - 1 ? 99 : t.hi,
      pts: t.pts,
      reb: t.reb,
      ast: t.ast,
    })),
    // ── Provenance ──────────────────────────────────────────────────────────
    league: 'WNBA',
    season: WNBA_SEASON,
    // A blended card names BOTH seasons, unspaced so it fits the 127px sidebar
    // column at 16px bold. It is the honest label: six of these cards are built
    // on two seasons pooled, and a card that says only 2026 would be claiming a
    // sample it does not have.
    seasonLabel: row.blended ? row.seasonsPooled.join('+') : String(WNBA_SEASON),
    games,
    mpg: Number(mpg.toFixed(1)),
    bbrefId: row.playerId,
    blended: row.blended === true,
    seasonsPooled: row.seasonsPooled,
    metrics: {
      bpmHat: Number((row.bpmHat ?? 0).toFixed(2)),
      obpmHat: Number((row.obpmHat ?? 0).toFixed(2)),
      dbpmHat: Number((row.dbpmHat ?? 0).toFixed(2)),
      per: row.per == null ? null : Number(row.per.toFixed(1)),
      ws: row.ws == null ? null : Number(row.ws.toFixed(1)),
      wsPer40: row.wsPer40 == null ? null : Number(row.wsPer40.toFixed(3)),
      offRtg: row.offRtg == null ? null : Math.round(row.offRtg),
      defRtg: row.defRtg == null ? null : Math.round(row.defRtg),
      tsPct: row.tsPct,
      pts100: row.pts100 == null ? null : Number(row.pts100.toFixed(1)),
    },
    provisional: true,
  };

  // Salary is NOT set here. Play value is measured against a FIELD, so it is
  // filled in as a post-pass once every card exists — see priceCardsInPlace.
  return card;
}

/**
 * The fitted BPM/OBPM/DBPM for every carded player.
 *
 * A BLENDED PLAYER IS RATED PER SEASON AND THEN POOLED, not rated on her
 * pooled profile. The two are not the same and the difference is the point of
 * the exercise: a plus/minus estimate is a statement about a player RELATIVE TO
 * THE LEAGUE SHE PLAYED IN, so her 2025 is scored against 2025 and her 2026
 * against 2026, and the two are folded on possessions — the denominator the
 * quantity is a rate over, exactly as poolSeasons.js folds EPM.
 */
export function fittedImpact({ model, carded, leagueRows, priorLeagueRows, priorById }) {
  const shipped = { features: model.features, targets: model.targets };
  const basisNow = centringBasis(leagueRows.map(wnbaFeatureRow), model.features);
  const basisPrior = priorLeagueRows.length
    ? centringBasis(priorLeagueRows.map(wnbaFeatureRow), model.features)
    : basisNow;

  const rate = (row, basis) => {
    const x = centredFeatures(wnbaFeatureRow(row), basis, model.features);
    return {
      bpm: predict(shipped.targets.bpm, x),
      obpm: predict(shipped.targets.obpm, x),
      dbpm: predict(shipped.targets.dbpm, x),
    };
  };

  return carded.map(row => {
    if (!row.blended) {
      const r = rate(row, basisNow);
      return { ...row, bpmHat: r.bpm, obpmHat: r.obpm, dbpmHat: r.dbpm };
    }
    const parts = [];
    const prior = priorById.get(row.playerId);
    if (prior) parts.push({ row: prior, basis: basisPrior });
    parts.push({ row: row.currentSeasonRow, basis: basisNow });

    const rated = parts
      .filter(p => p.row)
      .map(p => ({
        ...rate(p.row, p.basis),
        weight: possessionsFromMinutes(p.row.minutes ?? 0, p.row.season),
      }));
    const fold = key => poolWeighted(rated.map(r => ({ value: r[key], weight: r.weight })));
    return { ...row, bpmHat: fold('bpm'), obpmHat: fold('obpm'), dbpmHat: fold('dbpm') };
  });
}

/**
 * The NBA pool's own rows, rated by the SAME fitted model. The calibration
 * basis for the Speed+Power map — see speedPowerTotals for why it must be the
 * fitted value on both sides rather than the NBA's real BPM.
 */
export function nbaBasisRows({ model, pool }) {
  const advanced = readCache('bbref-wide-2026-advanced');
  const perPoss = readCache('bbref-wide-2026-perposs');
  if (!advanced || !perPoss) return null;
  const rates = new Map(perPoss.map(r => [`${r.playerId}|${r.team}`, r]));
  const best = new Map();
  for (const a of advanced) {
    const prev = best.get(a.playerId);
    if (!prev || (a.games ?? 0) > (prev.games ?? 0)) best.set(a.playerId, a);
  }
  const league = [];
  for (const a of best.values()) {
    const p = rates.get(`${a.playerId}|${a.team}`);
    if (!p) continue;
    league.push(featureRow({ ...a, ...p, season: 2026, league: 'nba' }));
  }
  const hats = applyModel({ features: model.features, targets: model.targets }, league);
  const byName = new Map();
  league.forEach((row, i) => {
    const key = normalizeName(row.name);
    const prev = byName.get(key);
    if (!prev || (row.minutes ?? 0) > (prev.row.minutes ?? 0)) byName.set(key, { row, hat: hats[i] });
  });

  const rows = [];
  const missing = [];
  for (const p of pool) {
    const hit = byName.get(normalizeName(p.name));
    if (!hit) {
      missing.push(p.name);
      continue;
    }
    rows.push({
      name: p.name,
      bpmHat: hit.hat.bpm,
      vorpPerGameHat: vorpPerGame(hit.hat.bpm, hit.row, 48),
      realBpm: hit.row.bpm,
    });
  }
  return { rows, missing, leagueSize: league.length };
}

/**
 * The shooting layer, over THE WNBA POOL ALONE.
 *
 * Not over `[...nbaPool, ...wnbaPool]`, which is what the special sets do, and
 * the difference is deliberate. shooting.js's own header states why: every
 * pool-relative quantity in it — the shrinkage strength, the compression scale,
 * the centre of each boost — is measured from the pool it is handed, and that
 * is what makes "a provider's or a season's systematic offset cancel on both
 * sides". A DIFFERENT LEAGUE is the strongest version of that offset: WNBA true
 * shooting runs several points below the NBA's, so compressing WNBA percentages
 * against an NBA-fitted scale would hand every player in the league a harder
 * Shot Line — a flat balance change dressed up as a measurement, and one that
 * would make every WNBA team systematically worse at scoring than every NBA
 * team at the same Speed+Power.
 *
 * Calibrated against the SAME finished-set targets, so the produced Shot Lines
 * occupy the same range and the same spread the 2026-27 set does.
 */
export function runShooting(rows, calibration) {
  return S.buildShootingLayer(rows.map(wnbaShootingInput), {
    shotLineTarget: calibration.shotLine.target,
    paint: calibration.paintBoost,
    three: calibration.threePtBoost,
  });
}

function summarize(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return { n: 0 };
  const at = p => v[Math.floor(p * (v.length - 1))];
  return {
    n: v.length,
    min: v[0],
    p10: at(0.1),
    median: at(0.5),
    p90: at(0.9),
    max: v[v.length - 1],
    mean: Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)),
  };
}

function histogram(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0] - b[0]);
}

export function main({ log = console.log } = {}) {
  const calibration = readJson(CALIBRATION_FILE);
  const model = readJson(MODEL_FILE);
  const current = readSeason(WNBA_SEASON);
  const prior = readSeason(WNBA_BLEND_SEASON);
  if (!current) {
    throw new Error(
      `No cached WNBA ${WNBA_SEASON} tables — run \`node scripts/cardgen/wnba/fetchWnba.js\` first.`
    );
  }

  const leagueRows = joinWnbaSeason({ season: WNBA_SEASON, ...current });
  const priorRows = prior ? joinWnbaSeason({ season: WNBA_BLEND_SEASON, ...prior }) : [];
  const forceInclude = readForceInclude();
  const { pool, byRule, forced, unmatched } = buildPool(leagueRows, {
    rule: WNBA_POOL_RULE,
    forceInclude,
  });

  if (unmatched.length) {
    console.error(
      `FAILED: ${unmatched.length} force-include name(s) match no row in the ${WNBA_SEASON} ` +
        `WNBA per-game table: ${unmatched.join(', ')}. Check the spelling in ` +
        'card-data/wnba-force-include-2026.json against Basketball-Reference.'
    );
    process.exitCode = 1;
  }

  const blendIds = new Set(forced.map(r => r.playerId));
  const priorById = new Map(priorRows.map(r => [r.playerId, r]));
  const currentById = new Map(leagueRows.map(r => [r.playerId, r]));
  const carded = cardedRows({ pool, blendRows: priorRows, blendIds }).map(row => ({
    ...row,
    currentSeasonRow: currentById.get(row.playerId),
  }));

  const rated = fittedImpact({
    model,
    carded,
    leagueRows,
    priorLeagueRows: priorRows,
    priorById,
  }).map(row => ({
    ...row,
    vorpPerGameHat: vorpPerGame(row.bpmHat, row, WNBA_GAME_MINUTES),
  }));

  // WHICH FRANCHISE EACH CARD PRINTS — the live roster first, the season's last
  // stint second, the stat row last. See resolveWnbaTeams.js for why a roster
  // outranks a stat row that already names a real team.
  const roster = readRoster();
  const resolvedTeams = resolveWnbaTeams({ rows: rated, splits: current.splits, roster });
  const displayTeam = row => resolvedTeams.teamOf.get(row.playerId) ?? row.team;

  const nba = nbaBasisRows({ model, pool: readJson(NBA_POOL_FILE) });
  if (!nba) {
    throw new Error(
      'No cached bbref-wide-2026 tables — run `node scripts/cardgen/wnba/fitBpmModel.js` first; ' +
        'the NBA pool is the calibration basis for the Speed+Power map.'
    );
  }

  const spArchive = bpmArchive.requireArchive();
  const { totals } = speedPowerTotals(rated, { archive: spArchive });
  const shooting = runShooting(rated, calibration);

  const cards = rated.map((row, i) =>
    buildWnbaCard({
      row,
      team: displayTeam(row),
      shooting: shooting.players[i],
      speedPowerTotal: totals[i],
      calibration,
    })
  );
  cards.sort((a, b) => a.name.localeCompare(b.name));

  // ── The pool file, the studio's spine for this set ────────────────────────
  const poolRecords = rated.map(row => ({
    name: row.name,
    team: displayTeam(row),
    pos: row.pos,
    games: row.games,
    mpg: Number((row.mpg ?? 0).toFixed(1)),
    bbrefId: row.playerId,
    blended: row.blended === true,
  }));
  poolRecords.sort((a, b) => b.mpg - a.mpg);
  fs.mkdirSync(GEN_DIR, { recursive: true });
  fs.writeFileSync(POOL_FILE, `${JSON.stringify(poolRecords, null, 2)}\n`);

  const pace = leaguePace(WNBA_SEASON);
  // Priced against the NBA base set, the same common field every other set
  // uses -- these cards share a table with it.
  PV.priceAgainstBase(cards, { roundSalary: A.roundSalary, min: A.SALARY_MIN, max: A.SALARY_MAX });

  const payload = {
    generatedAt: new Date().toISOString(),
    provisional: true,
    set: WNBA_SET,
    league: 'WNBA',
    statsSeason: String(WNBA_SEASON),
    blendSeason: String(WNBA_BLEND_SEASON),
    poolRule: WNBA_POOL_RULE,
    poolSize: cards.length,
    byRule,
    forced: forced.map(f => f.name),
    sources: {
      origin: `basketball-reference.com/wnba season tables (per-game, advanced, per-100), ${WNBA_BLEND_SEASON}-${WNBA_SEASON}`,
      speedPower:
        'z(fitted BPM) + 0.35 * z(fitted VORP per game), mapped onto the finished set\'s ' +
        'Speed+Power distribution with the current NBA pool as the calibration basis. Both ' +
        'sides of that map are scored with the SAME fitted model, so its compression cancels.',
      bpm:
        'FITTED. Basketball-Reference publishes no BPM, OBPM, DBPM or VORP for the WNBA. The ' +
        'model is regressed on 15 NBA seasons using only inputs the WNBA pages also carry, ' +
        'every input centred on its own league-season mean. See card-data/generated/' +
        'wnba-bpm-model.json for the out-of-sample R² and what real BPM uses that this cannot.',
      defBoost: 'the fitted DBPM, rounded — the special sets\' rule on a fitted input',
      paintBoost: '2P% standing in for rim FG%, which Basketball-Reference does not carry for either league',
      shotLine:
        'real WNBA TS%, compressed onto the finished set\'s Shot Line distribution using the ' +
        'WNBA POOL as the compression basis, so a league-wide shooting offset cancels instead ' +
        'of becoming a flat balance change',
      chart:
        'synthesized from Basketball-Reference WNBA season TOTALS: production per four-minute ' +
        `section is 4 * total / minutes, measured, with no pace in it. For reference, a ` +
        `${WNBA_GAME_MINUTES}-minute WNBA game at the measured ${WNBA_SEASON} league pace of ` +
        `${pace} possessions per ${WNBA_GAME_MINUTES} minutes makes a four-minute section ` +
        `${possessionsPerSection(pace).toFixed(3)} possessions, against the NBA convention's ` +
        '8.333 — which is what a per-100 rate would have had to be read against, and what ' +
        'carries each team’s own pace as error. Same synthesis model as the base set.',
      missing: ['BPM', 'OBPM', 'DBPM', 'VORP', 'EPM', 'rim FG%', 'DRB%'],
    },
    note:
      'PROVISIONAL, and league-relative by design. Every cross-league number here says where a ' +
      'player stands in HER OWN league, placed on the NBA set\'s scale so the cards can share a ' +
      'table. It is not a claim that the leagues are equally strong; no published data could ' +
      'settle that.',
    cards,
  };
  fs.writeFileSync(CARDS_FILE, `${JSON.stringify(payload, null, 1)}\n`);

  // ── Report ───────────────────────────────────────────────────────────────
  log(`${cards.length} WNBA cards -> ${path.relative(REPO_ROOT, CARDS_FILE)}`);
  log(
    `  ${leagueRows.length} in the ${WNBA_SEASON} table | ${byRule} pass MPG>=${WNBA_POOL_RULE.minMpg} ` +
      `& G>=${WNBA_POOL_RULE.minGames} | ${forced.length} added by the force-include list`
  );
  for (const row of rated.filter(r => r.blended)) {
    const parts = (row.parts ?? [])
      .map(p => `${p.season}: ${p.games}g ${p.minutes}m`)
      .join(', ');
    log(
      `    ${row.name.padEnd(24)}${parts}  ->  ${row.games}g ${row.minutes}m ` +
        `${(row.mpg ?? 0).toFixed(1)} mpg`
    );
  }
  // ── Where each card's franchise came from ────────────────────────────────
  const rt = resolvedTeams.stats;
  log(
    `  teams: ${rt.roster} from the wnba.com roster | ${rt.lastStint} from her last stint | ` +
      `${rt.statRow} straight off the stat row` +
      (roster.length ? '' : ' | NO ROSTER CACHED — run `node scripts/cardgen/wnba/fetchWnba.js`')
  );
  for (const c of resolvedTeams.changes) {
    log(
      `    ${c.name.padEnd(26)}${String(c.from).padEnd(5)}-> ${c.to.padEnd(5)}` +
        `(${c.path}${c.offSeasonMove ? ', move the stat table has not caught up with' : ''})`
    );
  }
  if (resolvedTeams.unresolved.length) {
    console.error(
      `FAILED: ${resolvedTeams.unresolved.length} player(s) could not be placed on a real ` +
        `franchise and will render on the grey fallback: ` +
        `${resolvedTeams.unresolved.map(u => `${u.name} (${u.statRow})`).join(', ')}.`
    );
    process.exitCode = 1;
  }

  log(
    `  chart scale: WNBA ${WNBA_GAME_MINUTES}-minute game, ${SECTIONS_PER_GAME} sections, pace ` +
      `${pace} -> ${possessionsPerSection(pace).toFixed(3)} possessions per section ` +
      `(NBA convention 8.333, ratio ${(possessionsPerSection(pace) / (100 * 4 / 48)).toFixed(4)})`
  );
  log(
    `  BPM model: ${model.featureSet} feature set, ${model.features.length} inputs, ` +
      `held-out-season R² bpm ${model.targets.bpm.heldOutSeasonsR2} ` +
      `obpm ${model.targets.obpm.heldOutSeasonsR2} dbpm ${model.targets.dbpm.heldOutSeasonsR2}`
  );
  if (nba.missing.length) {
    log(`  ⚠ no NBA 2026 row for ${nba.missing.length} pool players: ${nba.missing.join(', ')}`);
  }
  log(
    `  Speed+Power calibrated on ${spArchive.n} cardable NBA player-seasons ` +
      `${spArchive.seasons[0]}-${spArchive.seasons[spArchive.seasons.length - 1]}, ` +
      'scored with this same fitted model (card-data/generated/nba-bpm-archive.json). ' +
      'The 2026 NBA pool below is context, not the basis.'
  );

  const nbaHats = nba.rows.map(r => r.bpmHat);
  const wnbaHats = rated.map(r => r.bpmHat);
  const stat = v => {
    const { mean, sd } = A.meanSd(v);
    return `mean ${mean.toFixed(2)} sd ${sd.toFixed(2)} max ${Math.max(...v).toFixed(2)}`;
  };
  log(`    NBA pool  fitted BPM  ${stat(nbaHats)}   real BPM  ${stat(nba.rows.map(r => r.realBpm))}`);
  log(`    WNBA pool fitted BPM  ${stat(wnbaHats)}`);

  log('');
  log('field         n   min   p10   med   p90   max   mean');
  for (const f of ['speed', 'power', 'shotLine', 'paintBoost', 'threePtBoost', 'defBoost', 'salary']) {
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

  // Does the chart still integrate to the player the statistics describe? The
  // same check the base set runs, against the same committed reference.
  const REFERENCE_RATIO = { pts: 1.0, reb: 1.16, ast: 0.88 };
  log('');
  log('chart expected value per roll, over the player\'s per-4-minute rate');
  log(`  (the 2025-26 set sits at pts 1.00 / reb 1.16 / ast 0.88)`);
  const totalKeyOf = { pts: 'ptsTotal', reb: 'trbTotal', ast: 'astTotal' };
  for (const s of V.CHART_STATS) {
    const ratios = cards
      .map(c => {
        const row = rated.find(r => playerIdFromName(r.name) === c.id);
        const target = per4MinFromTotals(row?.[totalKeyOf[s]], row?.minutes);
        return target > 0 ? expectedValuePerRoll(c.chart, s) / target : null;
      })
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const at = p => ratios[Math.floor(p * (ratios.length - 1))];
    const drift = at(0.5) - REFERENCE_RATIO[s];
    log(
      `  ${s}  p10 ${at(0.1).toFixed(2)}  median ${at(0.5).toFixed(2)}  p90 ${at(0.9).toFixed(2)}` +
        `   vs 2025-26 ${REFERENCE_RATIO[s].toFixed(2)} -> ${drift >= 0 ? '+' : ''}${drift.toFixed(3)}` +
        `${Math.abs(drift) > 0.05 ? '  *** DRIFTED' : ''}`
    );
  }

  const tooTall = cards.filter(c => c.chart.length > MAX_CHART_TIERS);
  if (tooTall.length) {
    log(`  *** ${tooTall.length} CHARTS ARE TOO TALL TO PRINT: ${tooTall.map(c => c.id).join(', ')}`);
  }
  const breaks = cards.filter(c => c.chart.findIndex(t => t.lo === c.shotLine) > 1).length;
  log(`  charts with a printable rule for the shot-line arrow: ${breaks}/${cards.length}`);

  log('');
  log('top 15 by Speed+Power:');
  const byBudget = [...cards].sort(
    (a, b) => b.speed + b.power - (a.speed + a.power) || b.salary - a.salary
  );
  for (const c of byBudget.slice(0, 15)) {
    log(
      `  ${c.name.padEnd(24)}${String(c.team).padEnd(5)}${String(c.pos).padEnd(4)}` +
        `S/P ${String(c.speed).padStart(2)}/${String(c.power).padStart(2)} = ${String(c.speed + c.power).padStart(2)}  ` +
        `SL ${String(c.shotLine).padStart(2)}  D ${String(c.defBoost).padStart(2)}  ` +
        `BPM ${String(c.metrics.bpmHat).padStart(5)}  $${c.salary}`
    );
  }

  // What the other declared composite would have printed. Same reporting the
  // special sets do, and for the same reason: a weight nobody can see the
  // effect of is a weight nobody can review.
  const alt = speedPowerTotals(rated, {
    archive: spArchive,
    weights: COMPOSITE_METRIC_SETS.bpmOnly,
  }).totals;
  const moved = rated.filter((r, i) => alt[i] !== totals[i]);
  log('');
  log(
    `  Speed+Power under bpmOnly instead of bpmVorp: ${moved.length}/${rated.length} cards move` +
      (moved.length
        ? `, range ${Math.min(...rated.map((r, i) => alt[i] - totals[i]))} to ` +
          `${Math.max(...rated.map((r, i) => alt[i] - totals[i]))}`
        : '')
  );
  log(`\nWrote:\n  ${path.relative(REPO_ROOT, POOL_FILE)}\n  ${path.relative(REPO_ROOT, CARDS_FILE)}`);
  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
