// Builds the two COMPUTABLE special sets — Super Season and Rookie.
//
//   node scripts/cardgen/generateSpecialSets.js
//
// Writes card-data/generated/cards-super-season.json and cards-rookie.json,
// which the studio picks up automatically (src/studio/players.js). Needs no
// network: everything comes out of card-data/cache/bbref-history.json, which
// scripts/cardgen/fetchHistory.js produces and which is committed.
//
// ── WHAT EACH SET IS ────────────────────────────────────────────────────────
//
//   Super Season   Each active player's best individual season, chosen from
//                  Basketball-Reference's VORP, WS, WS/48 and BPM. THE
//                  EXCLUSION RULE IS WHAT MAKES THE SET: if a player's best
//                  season IS the most recent one, he gets no card, because his
//                  base card already is that season. See history.js for how the
//                  four metrics are combined and why.
//
//   Rookie         Each active player's rookie-year card. Same exclusion, for
//                  the same reason: a player whose rookie season IS the current
//                  one already has that card in the base set. (This is the
//                  user's open question about current-season rookies, answered
//                  the way the Super Season rule answers its own version of it —
//                  one rule, one reason, in both sets.)
//
// ── EVERY NUMBER ON THESE CARDS IS PROVISIONAL, AND MORE SO THAN THE BASE SET ─
//
// dunksandthrees' prior seasons are paywalled, so EPM, Estimated Wins and rim
// FG% — the three inputs the base set's Speed/Power budget, Def Boost and Paint
// Boost are built on — do not exist for any of these seasons. The substitutes,
// each named so nobody has to guess later:
//
//   Speed + Power   BPM in EPM's place and WS-per-game in Estimated Wins',
//                   combined with the SAME 0.35 refinement weight, and then
//                   mapped onto the finished set's Speed+Power distribution
//                   using the CURRENT POOL as the calibration basis. That last
//                   part is the whole of "work Speed+Power in by using the
//                   numbers we have and making best comparisons": a 2009 season
//                   is scored on the same yardstick the 2026-27 pool is, so the
//                   card sits correctly next to a current player instead of
//                   being recentred among other peaks. See mapToReferenceScale's
//                   `calibrateOn`.
//
//   Def Boost       DBPM instead of DEF EPM, through the same rounding rule.
//                   The two are the same kind of quantity — a per-100-possession
//                   defensive plus/minus — and DBPM is the only one that exists
//                   before this season.
//
//   Paint Boost     2P% instead of rim FG%. THE WEAKEST SUBSTITUTION IN THE
//                   FILE and it is worth knowing which way it is wrong: 2P%
//                   blends the rim with the midrange, so it understates exactly
//                   the rim-finishing bigs the Paint Boost exists to mark, and
//                   flatters midrange shooters. Basketball-Reference has no
//                   shot-location split at all in the season tables, so the
//                   choice was this or no Paint Boost.
//
//   Scoring chart   The same synthesis the base set uses, from Basketball-
//                   Reference's per-100 columns instead of dunksandthrees'
//                   predicted ones — which is, if anything, an improvement:
//                   these are what the player actually did.
//
// The `provisional` flag on every card and the `sources` block in each file say
// all of this in machine-readable form. Nothing here should be treated as
// settled; the point is a curatable roster with plausible numbers on it.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCache, REPO_ROOT } from './cache.js';
import { normalizeName } from './resolveTeams.js';
import { computeStatBands } from './bands.js';
import { reconcileBands, shapeChart } from './generate.js';
import * as V from './variance.js';
import * as A from './attributes.js';
import * as S from './shooting.js';
import { CALIBRATION_FILE } from './calibrateAttributes.js';
import {
  REFERENCE_TOTALS,
  REFINEMENT_WEIGHT,
  mapToReferenceScale,
} from './speedPower.js';
import {
  HISTORY_CACHE_KEY,
  FIRST_SEASON,
  LAST_SEASON,
  loadPool,
  isAggregateTeam,
} from './fetchHistory.js';
import {
  careerSeasons,
  bestSeason,
  rookieSeason,
  perMetricBest,
  metricsDisagree,
} from './history.js';
import { playerIdFromName } from '../../src/cards/playerId.js';
import { franchiseForSeason } from '../../src/cards/teams.js';
import { SUPER_SEASON_SET, ROOKIE_SET } from '../../src/cards/sets.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const OUTPUT_FILES = {
  [SUPER_SEASON_SET]: path.join(GEN_DIR, `cards-${SUPER_SEASON_SET}.json`),
  [ROOKIE_SET]: path.join(GEN_DIR, `cards-${ROOKIE_SET}.json`),
};

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * Each pool player's Basketball-Reference id, resolved from the MOST RECENT
 * season only.
 *
 * The pool is built from that season, so every one of its players has a row in
 * it — verified: 350 of 350. Resolving there and nowhere else is what keeps
 * fathers and sons apart; see the header of history.js.
 */
export function resolvePlayerIds(pool, rows, season = LAST_SEASON) {
  const current = new Map();
  for (const row of rows) {
    if (row.season !== season) continue;
    const key = normalizeName(row.name);
    const prev = current.get(key);
    if (!prev || (row.games ?? 0) > (prev.games ?? 0)) current.set(key, row);
  }
  const ids = new Map();
  const missing = [];
  for (const p of pool) {
    const hit = current.get(normalizeName(p.name));
    if (hit) ids.set(p.name, hit.playerId);
    else missing.push(p.name);
  }
  return { ids, missing };
}

/** Every archived row for one Basketball-Reference id. */
export function rowsById(rows) {
  const byId = new Map();
  for (const row of rows) {
    if (!byId.has(row.playerId)) byId.set(row.playerId, []);
    byId.get(row.playerId).push(row);
  }
  return byId;
}

/**
 * The Speed+Power composite, in Basketball-Reference's vocabulary.
 *
 * Deliberately the SAME SHAPE as speedPower.js's `z(EPM) + 0.35 * z(EW/GP)`,
 * with the closest available stand-in in each slot — BPM for EPM (both are
 * per-100-possession plus/minus estimates) and Win Shares per game for
 * Estimated Wins per game (both are wins credited, divided by games). Keeping
 * the shape and the weight means the only thing that changed between the two
 * sets is the measurement, not the model.
 *
 * The z-scores are taken against the CURRENT POOL's mean and spread, passed in,
 * so a historical season's composite is directly comparable with a 2026-27
 * card's.
 */
const z = (value, stats) =>
  Number.isFinite(value) && stats?.sd > 0 ? (value - stats.mean) / stats.sd : 0;

/**
 * Minutes at which a season's composite is trusted in full.
 *
 * Below it the composite is pulled toward replacement level in proportion to
 * how little of a season it is. THIS IS NOT A REFINEMENT, it is the difference
 * between a usable set and an absurd one: Leonard Miller's rookie year is 17
 * games and 53 MINUTES, over which he posted a BPM of +9.6. Unshrunk, that is
 * the single highest composite in the Rookie set and his card came out a step
 * above Victor Wembanyama's. BPM over 53 minutes is not a measurement of a
 * player, it is a measurement of one good week.
 *
 * 1500 minutes is about 20 minutes a night over a full season — the point at
 * which a plus/minus estimate is describing the player rather than the sample.
 */
export const FULL_SEASON_MINUTES = 1500;

/**
 * Where a season with no minutes behind it is pulled TO.
 *
 * Replacement level, -2.0 BPM, and it is not a taste call: that is the
 * definition Basketball-Reference builds VORP on, so it is the value the rest
 * of this composite is already stated against. Shrinking toward the POOL MEAN
 * instead — the obvious alternative — would be wrong at both ends: it would
 * hand a 53-minute flier an average card, and it would hand a 53-minute
 * disaster one too.
 */
export const REPLACEMENT_BPM = -2.0;

/**
 * The Speed+Power composite, in Basketball-Reference's vocabulary, shrunk for
 * how much season is behind it.
 *
 * Deliberately the SAME SHAPE as speedPower.js's `z(EPM) + 0.35 * z(EW/GP)`,
 * with the closest available stand-in in each slot — BPM for EPM (both are
 * per-100-possession plus/minus estimates) and Win Shares per game for
 * Estimated Wins per game (both are wins credited, divided by games). Keeping
 * the shape and the weight means the only thing that changed between the two
 * sets is the measurement, not the model.
 *
 * The z-scores are taken against the CURRENT POOL's mean and spread, passed in,
 * so a historical season's composite is directly comparable with a 2026-27
 * card's. The shrink is applied to the pool's own composites too, for the same
 * reason: the map is only a like-for-like comparison if both sides of it were
 * measured the same way.
 */
export function historicalComposite(season, basis, weight = REFINEMENT_WEIGHT) {
  const wsPerGame = season.games > 0 ? (season.ws ?? 0) / season.games : 0;
  const raw = z(season.bpm, basis.bpm) + weight * z(wsPerGame, basis.wsPerGame);
  const replacement = z(REPLACEMENT_BPM, basis.bpm) + weight * z(0, basis.wsPerGame);
  const trust = Math.min(Math.max((season.minutes ?? 0) / FULL_SEASON_MINUTES, 0), 1);
  return trust * raw + (1 - trust) * replacement;
}

/** Mean/sd of the two composite inputs across the current pool's own season. */
export function compositeBasis(currentRows) {
  const bpm = A.meanSd(currentRows.map(r => r.bpm));
  const wsPerGame = A.meanSd(
    currentRows.map(r => (r.games > 0 ? (r.ws ?? 0) / r.games : null))
  );
  return { bpm, wsPerGame };
}

/** The shooting inputs one archived season contributes. */
export function historicalShootingInput(season) {
  return {
    tsPct: season.tsPct ?? null,
    // 2P% stands in for rim FG%, which Basketball-Reference does not carry.
    paintPct: season.fgPct2 ?? null,
    threePct: season.fgPct3 ?? null,
    paintAttempts: S.attemptsFromPer100(season.fg2a100, season.minutes),
    threeAttempts: S.attemptsFromPer100(season.fg3a100, season.minutes),
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
 * Basketball-Reference's season end-year as the label a card prints.
 * 2009 -> "2008-09". Two digits on the back half, the way the finished set's
 * own legend cards are named (08_09_LeBron_James.png).
 */
export function seasonLabel(endYear) {
  if (!Number.isFinite(endYear)) return null;
  return `${endYear - 1}-${String(endYear % 100).padStart(2, '0')}`;
}

/**
 * One card, from one archived season.
 *
 * The shooting values arrive already computed because that layer is pool-
 * relative and cannot be evaluated a player at a time — exactly as in
 * generateCards.js, and for the same reason.
 */
export function buildHistoricalCard({ player, season, shooting, speedPowerTotal, calibration }) {
  const games = season.games ?? 0;
  const mpg = games > 0 ? (season.minutes ?? 0) / games : 0;
  const per100 = {
    pts: season.pts100 ?? 0,
    reb: season.trb100 ?? 0,
    ast: season.ast100 ?? 0,
  };
  const { speed, power } = A.splitSpeedPower(
    speedPowerTotal,
    season.pos,
    calibration.positionSpeedShare
  );
  const { shotLine, paintBoost, threePtBoost } = shooting;
  // DBPM in DEF EPM's place — the same rounding rule on the same kind of number.
  const defBoost = A.defBoostFromEpm(season.dbpm);

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
    id: playerIdFromName(player.name),
    name: player.name,
    // The team he played that season FOR, resolved through the era — Kevin
    // Durant's rookie card says SEA. See franchiseForSeason in src/cards/teams.js.
    team: franchiseForSeason(season.team, season.season),
    pos: season.pos,
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
    // ── Provenance. Not decoration: these sets exist because of WHICH season
    // each card is, so the season has to survive onto the record.
    season: season.season,
    seasonLabel: seasonLabel(season.season),
    age: season.age ?? null,
    games,
    mpg: Number(mpg.toFixed(1)),
    bbrefId: season.playerId,
    traded: season.traded ?? false,
    metrics: {
      bpm: season.bpm,
      vorp: season.vorp,
      ws: season.ws,
      ws48: season.ws48,
      per: season.per,
    },
    provisional: true,
  };

  const ev = Object.fromEntries(
    V.CHART_STATS.map(stat => [stat, expectedValuePerRoll(card.chart, stat)])
  );
  card.salary = A.roundSalary(A.applyModel(calibration.salary.model, A.salaryFeatures(card, ev)));
  return card;
}

/**
 * Builds one set from a list of `{ player, season }` selections.
 *
 * `currentRows` is the CURRENT pool's own season, and it is not optional: both
 * pool-relative layers — the shooting compression and the Speed+Power map — are
 * calibrated on it and then applied to the historical seasons, which is what
 * puts these cards on the same scale as the base set rather than on a scale of
 * their own. Both are computed over `[...current, ...selected]` and the
 * historical tail is sliced back out.
 */
export function buildSet({ selections, currentRows, calibration }) {
  const seasons = selections.map(s => s.season);
  const all = [...currentRows, ...seasons];
  const cut = currentRows.length;

  const shooting = S.buildShootingLayer(all.map(historicalShootingInput), {
    shotLineTarget: calibration.shotLine.target,
    paint: calibration.paintBoost,
    three: calibration.threePtBoost,
  });

  const basis = compositeBasis(currentRows);
  const composites = all.map(s => historicalComposite(s, basis));
  const totals = mapToReferenceScale(composites, REFERENCE_TOTALS, {
    calibrateOn: composites.slice(0, cut),
  });

  return selections.map((selection, i) =>
    buildHistoricalCard({
      player: selection.player,
      season: selection.season,
      shooting: shooting.players[cut + i],
      speedPowerTotal: totals[cut + i],
      calibration,
    })
  );
}

/**
 * Which players are in each set, and who was excluded and why.
 *
 * Runs both selections in one pass because they share all their expensive work:
 * one career grouping per player answers both questions.
 */
export function selectSets({ pool, rows, distributions, firstSeason = FIRST_SEASON }) {
  const { ids, missing } = resolvePlayerIds(pool, rows);
  const byId = rowsById(rows);

  const superSeason = [];
  const rookie = [];
  const excluded = { superSeason: [], rookie: [] };
  const disagreements = [];
  const notes = { fallbackFloor: [], beyondRange: [], partialSeason: [] };

  for (const player of pool) {
    const bbrefId = ids.get(player.name);
    if (!bbrefId) continue;
    const seasons = careerSeasons(byId.get(bbrefId) ?? []);
    if (seasons.length === 0) continue;

    const { scored, best, usedFallbackFloor } = bestSeason(seasons, distributions);
    if (usedFallbackFloor) notes.fallbackFloor.push(player.name);

    const perMetric = perMetricBest(scored);
    if (metricsDisagree(perMetric)) {
      disagreements.push({
        name: player.name,
        chosen: best.season,
        perMetric,
        // The two seasons the disagreement is actually between, with the
        // numbers that drive it — enough to judge the rule without re-running.
        seasons: scored
          .filter(s => Object.values(perMetric).includes(s.season))
          .map(s => ({
            season: s.season,
            games: s.games,
            minutes: s.minutes,
            bpm: s.bpm,
            vorp: s.vorp,
            ws: s.ws,
            ws48: s.ws48,
            score: Number(s.score.toFixed(3)),
          })),
      });
    }

    // THE EXCLUSION RULE. A best season that IS the most recent season is
    // already the player's base card; a second card of it would be the same
    // card twice.
    if (best.season === LAST_SEASON) {
      excluded.superSeason.push({ name: player.name, reason: 'best season is the current one' });
    } else {
      if (best.partialSeason) notes.partialSeason.push(`${player.name} ${best.season}`);
      superSeason.push({ player, season: best, perMetric });
    }

    const first = rookieSeason(seasons, firstSeason);
    if (first.beyondRange) notes.beyondRange.push(player.name);
    if (first.season === LAST_SEASON) {
      excluded.rookie.push({ name: player.name, reason: 'rookie season is the current one' });
    } else {
      rookie.push({ player, season: first });
    }
  }

  return { superSeason, rookie, excluded, disagreements, notes, missingIds: missing };
}

function writeSet(file, { set, cards, meta }) {
  fs.mkdirSync(GEN_DIR, { recursive: true });
  const body = {
    generatedAt: new Date().toISOString(),
    set,
    provisional: true,
    ...meta,
    cards,
  };
  fs.writeFileSync(file, `${JSON.stringify(body, null, 1)}\n`);
  return body;
}

/** The one-line description of every substitution, carried into both files. */
const SOURCES = {
  origin: 'basketball-reference.com season tables (advanced + per-100), 2000-2026',
  speedPower: 'z(BPM) + 0.35 * z(WS per game), mapped onto the finished set\'s Speed+Power distribution with the 2026-27 pool as the calibration basis',
  defBoost: 'DBPM, rounded — DEF EPM does not exist before the current season',
  paintBoost: '2P% standing in for rim FG%, which Basketball-Reference does not carry',
  chart: 'synthesized from Basketball-Reference per-100 PTS/TRB/AST, same model as the base set',
  missing: ['EPM', 'Estimated Wins', 'rim FG%'],
};

export function main({ log = console.log } = {}) {
  const history = readCache(HISTORY_CACHE_KEY);
  if (!history) {
    throw new Error(
      `No card-data/cache/${HISTORY_CACHE_KEY}.json — run \`node scripts/cardgen/fetchHistory.js\` first.`
    );
  }
  const pool = loadPool();
  const calibration = readJson(CALIBRATION_FILE);
  const rows = history.rows;

  const selection = selectSets({ pool, rows, distributions: history.seasons });
  log(`Pool ${pool.length}; ${rows.length} archived player-seasons.`);
  if (selection.missingIds.length) {
    log(`  ⚠ no ${LAST_SEASON} row for: ${selection.missingIds.join(', ')}`);
  }

  // The current pool's own season rows, one per player, as the calibration
  // basis for both pool-relative layers. Aggregates only — a traded player's
  // whole season, not one of its halves.
  const currentByName = new Map();
  for (const row of rows) {
    if (row.season !== LAST_SEASON) continue;
    const key = `${row.playerId}`;
    const prev = currentByName.get(key);
    if (!prev || (row.games ?? 0) > (prev.games ?? 0)) currentByName.set(key, row);
  }
  const poolIds = new Set(
    resolvePlayerIds(pool, rows).ids.values()
  );
  const currentRows = [...currentByName.values()].filter(r => poolIds.has(r.playerId));
  log(`Calibration basis: ${currentRows.length} current-season rows.`);

  const files = {};
  for (const [set, selections, file] of [
    [SUPER_SEASON_SET, selection.superSeason, OUTPUT_FILES[SUPER_SEASON_SET]],
    [ROOKIE_SET, selection.rookie, OUTPUT_FILES[ROOKIE_SET]],
  ]) {
    const cards = buildSet({ selections, currentRows, calibration });
    cards.sort((a, b) => a.name.localeCompare(b.name));
    const excluded = set === SUPER_SEASON_SET ? selection.excluded.superSeason : selection.excluded.rookie;
    files[set] = writeSet(file, {
      set,
      cards,
      meta: {
        sources: SOURCES,
        firstSeason: FIRST_SEASON,
        lastSeason: LAST_SEASON,
        poolPlayers: pool.length,
        excluded,
        excludedCount: excluded.length,
      },
    });
    log(`\n${set}: ${cards.length} cards (${excluded.length} excluded — ${set === SUPER_SEASON_SET ? 'best season is the current one' : 'rookie season is the current one'})`);
    reportSet(cards, log);
  }

  reportDisagreements(selection.disagreements, log);
  if (selection.notes.fallbackFloor.length) {
    log(`\nNo season over ${1000} minutes (largest season used instead): ${selection.notes.fallbackFloor.length}`);
    log(`  ${selection.notes.fallbackFloor.slice(0, 12).join(', ')}`);
  }
  if (selection.notes.beyondRange.length) {
    log(`\n⚠ Earliest archived season is ${FIRST_SEASON} — the debut may be older: ${selection.notes.beyondRange.join(', ')}`);
  }
  log(`\nWrote:\n  ${OUTPUT_FILES[SUPER_SEASON_SET]}\n  ${OUTPUT_FILES[ROOKIE_SET]}`);
  return { files, selection };
}

function counts(values) {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

function reportSet(cards, log) {
  const totals = cards.map(c => (c.speed ?? 0) + (c.power ?? 0)).sort((a, b) => a - b);
  const seasons = counts(cards.map(c => c.season));
  const teams = counts(cards.map(c => c.team));
  log(
    `  Speed+Power  min ${totals[0]}  median ${totals[Math.floor(totals.length / 2)]}  max ${totals[totals.length - 1]}`
  );
  log(`  seasons      ${seasons.map(([s, n]) => `${s}:${n}`).join(' ')}`);
  const historic = teams.filter(([t]) => ['SEA', 'NJN', 'NOH', 'NOK', 'CHB', 'CHH', 'VAN'].includes(t));
  log(`  teams        ${teams.length} distinct${historic.length ? ` (historic: ${historic.map(([t, n]) => `${t}:${n}`).join(' ')})` : ''}`);
  const top = [...cards].sort((a, b) => (b.speed + b.power) - (a.speed + a.power)).slice(0, 8);
  for (const c of top) {
    log(`    ${String(c.seasonLabel).padEnd(8)}${c.name.padEnd(26)}${c.team.padEnd(5)}S/P ${c.speed}/${c.power}  SL ${c.shotLine}  $${c.salary}`);
  }
}

/**
 * The players the four metrics disagree about — printed on EVERY run.
 *
 * This is the whole reason the combining rule is a defensible default rather
 * than a decision made behind the user's back. The rule chose one of these
 * seasons; the report shows the others it chose against, with the numbers.
 */
function reportDisagreements(disagreements, log) {
  log(`\nMetrics disagree about the best season for ${disagreements.length} players.`);
  const spread = d => Math.max(...d.seasons.map(s => s.season)) - Math.min(...d.seasons.map(s => s.season));
  const worst = [...disagreements].sort((a, b) => spread(b) - spread(a)).slice(0, 10);
  for (const d of worst) {
    log(
      `  ${d.name.padEnd(26)}chose ${d.chosen}  ` +
        `[BPM ${d.perMetric.bpm} · VORP ${d.perMetric.vorp} · WS ${d.perMetric.ws} · WS/48 ${d.perMetric.ws48}]`
    );
    for (const s of d.seasons) {
      log(
        `      ${s.season}  ${String(s.games).padStart(2)}g ${String(s.minutes).padStart(4)}m  ` +
          `BPM ${String(s.bpm).padStart(5)}  VORP ${String(s.vorp).padStart(4)}  ` +
          `WS ${String(s.ws).padStart(4)}  WS/48 ${String(s.ws48).padStart(5)}  score ${s.score}`
      );
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

export { isAggregateTeam };
