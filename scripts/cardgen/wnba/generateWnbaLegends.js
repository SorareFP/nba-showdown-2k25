// Builds the WNBA SUPER SEASON set — sixteen retired greats, each on her best
// individual season.
//
//   node scripts/cardgen/wnba/generateWnbaLegends.js
//
// Writes card-data/generated/cards-wnba-super-season.json, which the studio
// picks up automatically (src/studio/players.js). Needs no network.
//
// Full rebuild order:
//   node scripts/cardgen/wnba/fetchWnba.js            (2025 + 2026, for the scale)
//   node scripts/cardgen/wnba/fetchWnbaHistory.js     (1997-2024)
//   node scripts/cardgen/wnba/fitBpmModel.js
//   node scripts/cardgen/wnba/generateWnbaCards.js    (the current WNBA set)
//   node scripts/cardgen/wnba/generateWnbaLegends.js
//
// ── WHAT THIS SET IS ────────────────────────────────────────────────────────
//
// The NBA Super Season set and the WNBA set, crossed. It takes the first one's
// QUESTION — which single season was this player's best, and card that season
// on the team she played it for — and the second one's MACHINERY, because the
// WNBA publishes no plus/minus estimate of any kind and a WNBA game is 40
// minutes.
//
// Its roster is the one thing neither parent has: a NAMED LIST. Every other set
// in this repo is a threshold (MPG >= 12 and G >= 40, MPG >= 16 and G >= 20,
// "every active player"). This one is sixteen players the user asked for by
// name, and card-data/wnba-legends.json is that list. No rule can add a
// seventeenth and no rule can drop one of the sixteen; a name that matches no
// row in the archive fails the run rather than shortening the set silently.
//
// ── HOW FAR BACK THE FITTED BPM CAN HONESTLY BE APPLIED ─────────────────────
//
// This is the question the set turns on, and the run REPORTS it rather than
// asserting it. Three separate things could have gone wrong and each is
// measured:
//
//   1. THE COLUMNS COULD BE ABSENT. They are not: Basketball-Reference's 1997
//      advanced table carries PER, TS%, USG%, ORtg, DRtg and the Win Shares
//      family, identically to 2026. Verified on live pages.
//
//   2. THE COLUMNS COULD BE EMPTY. `inputCoverage` counts, per season, how many
//      rows actually carry each of the model's 31 inputs — because
//      `centredFeatures` reads a missing value as EXACTLY LEAGUE AVERAGE, which
//      is silent and would make a hollow season look like an ordinary one.
//
//   3. THE MODEL COULD BE EXTRAPOLATING. The ridge was fitted on fifteen modern
//      NBA seasons; applied inside the range of inputs it saw, it is doing the
//      job its out-of-sample R² measured, and applied far outside that range it
//      is doing something nobody validated. `extrapolation` measures the share
//      of feature values falling outside the NBA fit's own 1st-99th percentile,
//      per season, and the report prints it as a trend.
//
// What CANNOT be measured from inside this data is whether an NBA-fitted
// coefficient means the same thing in the 1997 WNBA as in the 2026 one — that
// is the league-context assumption bpmModel.js states and it does not go away
// by being restated here. The three checks above bound the part that can be
// checked; the run prints the earliest season it would stand behind, and says
// what it is standing on.
//
// ── AND THE ERA ADJUSTMENT, WHICH THE NBA SET DOES NOT DO ───────────────────
//
// A percentage is compressed against a POOL, and the pool here is the 2026
// WNBA. Feeding it Lisa Leslie's 1997 true shooting raw would compare 1997 with
// 2026 and call her a poor shooter for playing in a league that scored less. So
// each shooting percentage is shifted by the gap between its own season's
// league mean and 2026's — see wnba/legends.js's `eraShift`, and the report
// prints the size of every shift it applied.
//
// THE SCORING CHART IS NOT SHIFTED, and that is a decision rather than an
// oversight: the chart is what she DID over four minutes, and the NBA Super
// Season set treats its charts the same way. The report prints each season's
// league scoring rate so a smaller chart on an older card can be read for what
// it is.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCache, REPO_ROOT } from '../cache.js';
import { normalizeName } from '../resolveTeams.js';
import { computeStatBands } from '../bands.js';
import { reconcileBands, shapeChart, MAX_CHART_TIERS } from '../generate.js';
import * as V from '../variance.js';
import * as A from '../attributes.js';
import * as S from '../shooting.js';
import { CALIBRATION_FILE } from '../calibrateAttributes.js';
import { REFERENCE_TOTALS, mapToReferenceScale } from '../speedPower.js';
import { playerIdFromName } from '../../../src/cards/playerId.js';
import { WNBA_SET, WNBA_SUPER_SEASON_SET } from '../../../src/cards/sets.js';
import { getWnbaTeam, wnbaFranchiseForSeason } from '../../../src/cards/teams.js';
import { centringBasis, centredFeatures, predict, FEATURES } from './bpmModel.js';
import { MODEL_FILE, featureRow } from './fitBpmModel.js';
import { readSeason } from './fetchWnba.js';
import { archivedSeasons } from './fetchWnbaHistory.js';
import {
  WNBA_SEASON,
  WNBA_GAME_MINUTES,
  WNBA_FIRST_SEASON,
  WNBA_LAST_ARCHIVED_SEASON,
} from './constants.js';
import { joinWnbaSeason, per4MinFromTotals, wnbaFeatureRow } from './pool.js';
import { vorpPerGame, COMPOSITE_WEIGHTS, compositeBasis, composite } from './generateWnbaCards.js';
import * as L from './legends.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const LEGENDS_FILE = path.join(REPO_ROOT, 'card-data', 'wnba-legends.json');
export const CARDS_FILE = path.join(GEN_DIR, `cards-${WNBA_SUPER_SEASON_SET}.json`);
export const ROSTER_FILE = path.join(GEN_DIR, 'wnba-legends-roster.json');
const WNBA_CARDS_FILE = path.join(GEN_DIR, `cards-${WNBA_SET}.json`);

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

/** The named roster, in file order. `_comment` is documentation, never a name. */
export function readLegends(file = LEGENDS_FILE) {
  const { _comment, ...entries } = readJson(file);
  return Object.entries(entries).map(([name, era]) => ({ name, era }));
}

/**
 * Every archived season this set can see, oldest first.
 *
 * The archive's own range plus the two seasons the CURRENT set already caches.
 * A season the cache does not hold is skipped rather than fatal — the run then
 * says which, because a missing 2007 would silently cost Lauren Jackson her
 * best year and nothing else would look wrong.
 */
export function loadArchive(seasons = [...archivedSeasons(), 2025, WNBA_SEASON]) {
  const loaded = [];
  const missing = [];
  for (const season of seasons) {
    const tables = readSeason(season);
    if (!tables) {
      missing.push(season);
      continue;
    }
    const rows = joinWnbaSeason({ season, ...tables });
    loaded.push({ season, rows, splits: tables.splits ?? [] });
  }
  return { loaded, missing };
}

/**
 * Every legend's Basketball-Reference WNBA player id.
 *
 * MATCHED BY NAME, AND THE COLLISION CHECK IS THE POINT. The NBA history path
 * refuses to join by name at all — six pool names belong to two different
 * players there, and Jaren Jackson Jr. would have inherited his father's
 * season. Here a name is the ONLY key available: the roster is a hand-written
 * list of sixteen names and there is nothing else to resolve them from.
 *
 * So the join is by name and the ambiguity is CHECKED rather than assumed away.
 * A name matching two different player ids anywhere in the archive is reported
 * and fails the run, which is the same standard by a different route.
 */
export function resolveLegendIds(legends, archive) {
  const byName = new Map();
  for (const { rows } of archive) {
    for (const row of rows) {
      const key = normalizeName(row.name);
      if (!byName.has(key)) byName.set(key, new Map());
      const ids = byName.get(key);
      ids.set(row.playerId, (ids.get(row.playerId) ?? 0) + (row.minutes ?? 0));
    }
  }
  const resolved = [];
  const missing = [];
  const ambiguous = [];
  for (const legend of legends) {
    const ids = byName.get(normalizeName(legend.name));
    if (!ids || ids.size === 0) {
      missing.push(legend.name);
      continue;
    }
    if (ids.size > 1) {
      ambiguous.push({ name: legend.name, ids: [...ids.keys()] });
      continue;
    }
    resolved.push({ ...legend, playerId: [...ids.keys()][0] });
  }
  return { resolved, missing, ambiguous };
}

/**
 * Every season of every archived league, rated with the fitted model.
 *
 * THE CENTRING BASIS IS THE WHOLE LEAGUE, ONE SEASON AT A TIME. That is what
 * makes a fitted BPM league-relative and therefore era-relative for free: a
 * 1997 player is measured against 1997, so her +5 and a 2019 player's +5 are
 * the same claim about two different leagues. Passing the sixteen legends as
 * their own basis would have measured each of them against the other fifteen,
 * which is not a league and not a scale anyone could read.
 */
export function rateArchive(archive, model) {
  const shipped = { features: model.features, targets: model.targets };
  const out = new Map();
  for (const { season, rows, splits } of archive) {
    const featured = rows.map(wnbaFeatureRow);
    const basis = centringBasis(featured, model.features);
    const rated = featured.map(row => {
      const x = centredFeatures(row, basis, model.features);
      return {
        ...row,
        centred: x,
        bpmHat: predict(shipped.targets.bpm, x),
        obpmHat: predict(shipped.targets.obpm, x),
        dbpmHat: predict(shipped.targets.dbpm, x),
      };
    });
    out.set(season, {
      season,
      rows: rated,
      splits,
      basis,
      schedule: L.scheduleLength(rows),
      shooting: L.shootingBasis(rows),
      scoring: L.scoringEnvironment(rows),
      distribution: L.fittedDistribution(rated),
    });
  }
  return out;
}

/** One legend's career: every season she played, scored against its own league. */
export function careerOf(playerId, seasons) {
  const career = [];
  for (const s of seasons.values()) {
    const row = s.rows.find(r => r.playerId === playerId);
    if (!row || !((row.games ?? 0) > 0)) continue;
    const games = row.games ?? 0;
    career.push({
      ...row,
      mpg: games > 0 ? (row.minutes ?? 0) / games : 0,
      schedule: s.schedule,
      minGames: L.minGamesFor(s.schedule),
      score: L.seasonScore(row.bpmHat, s.distribution),
      team: L.seasonTeam(row.team, s.splits.filter(x => x.playerId === playerId)),
    });
  }
  return career.sort((a, b) => a.season - b.season);
}

/**
 * The shooting inputs for one carded season, ERA-SHIFTED onto the reference
 * league's scale.
 *
 * `paintAttempts` and `threeAttempts` are NOT shifted and must not be: they are
 * real counts, and the shrinkage gate they feed asks "how big was the sample",
 * which is the same question in any era.
 */
export function legendShootingInput(row, seasonBasis, referenceBasis) {
  const shift = field => L.eraShift(row[field], seasonBasis?.[field], referenceBasis?.[field]);
  return {
    tsPct: shift('tsPct'),
    // 2P% stands in for rim FG%, the same substitution and the same weakness
    // every other set in this repo carries.
    paintPct: shift('fgPct2'),
    threePct: shift('fgPct3'),
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
 * Identical to buildWnbaCard's path — the same per-four-minute anchor, the same
 * NBA-convention restatement, the same salary model — with the season's
 * provenance added and the franchise resolved THROUGH THE ERA. That last part
 * is why Lauren Jackson's card is hunter green: see wnbaFranchiseForSeason.
 */
export function buildLegendCard({ row, shooting, speedPowerTotal, calibration }) {
  const games = row.games ?? 0;
  const minutes = row.minutes ?? 0;
  const mpg = games > 0 ? minutes / games : 0;
  const per4 = total => per4MinFromTotals(total, minutes);
  // variance.js reads its input as an NBA-convention per-100 rate, so exact
  // per-four-minute production is restated in those units. A UNIT CHANGE, not
  // an approximation — see nbaConventionPer100 in wnba/constants.js.
  const NBA_PER_100_TO_PER_4MIN = 4 / 48;
  const per100 = {
    pts: per4(row.ptsTotal) / NBA_PER_100_TO_PER_4MIN,
    reb: per4(row.trbTotal) / NBA_PER_100_TO_PER_4MIN,
    ast: per4(row.astTotal) / NBA_PER_100_TO_PER_4MIN,
  };
  // POSITION ONLY, deliberately. The NBA sets bend this split by the player's
  // height and weight (A.SIZE_SPEED_SHARE), but the biometrics come from
  // dunksandthrees' `season-epm`, which is an NBA endpoint with no WNBA
  // equivalent — Basketball-Reference is the only source this set has, and it is
  // the reason every WNBA card is provisional. Omitting the size argument gives
  // exactly the rule this file has always used rather than dropping players who
  // cannot be measured, which is what `splitSpeedPower` makes the default.
  const { speed, power } = A.splitSpeedPower(speedPowerTotal, row.pos, calibration.positionSpeedShare);
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
    // THE FRANCHISE AS IT WAS. `wnbaFranchiseForSeason` turns a 2010 "SEA" into
    // the Storm's hunter-green era and a 2009 "PHO" into the Mercury's Planet
    // Red one — the WNBA counterpart of the NBA set putting Kevin Durant's
    // rookie card in Seattle.
    team: wnbaFranchiseForSeason(row.team, row.season),
    // The abbreviation the stat row actually carried, kept so a franchise
    // resolution can be audited without re-deriving it.
    statRowTeam: row.team,
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
    // ── Provenance ───────────────────────────────────────────────────────────
    league: 'WNBA',
    season: row.season,
    // A WNBA season is ONE YEAR and is named for it — "2010", never "2009-10".
    // The NBA sets' seasonLabel spans two because an NBA season does.
    seasonLabel: String(row.season),
    games,
    mpg: Number(mpg.toFixed(1)),
    minutes,
    schedule: row.schedule,
    bbrefId: row.playerId,
    metrics: {
      bpmHat: Number((row.bpmHat ?? 0).toFixed(2)),
      obpmHat: Number((row.obpmHat ?? 0).toFixed(2)),
      dbpmHat: Number((row.dbpmHat ?? 0).toFixed(2)),
      // Its own league's standard deviations above that league's mean — the
      // number the season was CHOSEN on.
      seasonZ: Number((row.score ?? 0).toFixed(2)),
      per: row.per == null ? null : Number(row.per.toFixed(1)),
      ws: row.ws == null ? null : Number(row.ws.toFixed(1)),
      wsPer40: row.wsPer40 == null ? null : Number(row.wsPer40.toFixed(3)),
      tsPct: row.tsPct,
      pts100: row.pts100 == null ? null : Number(row.pts100.toFixed(1)),
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
 * The logos this set needs and does not have.
 *
 * Computed from the franchises the FINISHED CARDS land on, never from the whole
 * historical table — the user asked which marks they need to supply, and the
 * answer is sixteen cards' worth, not twenty-six franchises' worth.
 *
 * THREE GRADES, because they are three different asks and only the first is
 * urgent:
 *
 *   missing         no mark at all. The card draws CardTemplate's lettered
 *                   circle, which is a correct placeholder and obviously one.
 *   anachronistic   the modern mark on a card from another era — legible,
 *                   right as to franchise, wrong as to year.
 *   poor            an era-correct mark that draws badly. Today that is the
 *                   Comets' wordmark lockup, which `contain` shrinks to half
 *                   the slot; see `logoNote` on the row.
 *
 * A franchise whose mark is era-correct AND draws well asks for nothing, which
 * is what keeps this list short enough to act on.
 */
export function logoShoppingList(cards, teamOf) {
  const buckets = { missing: new Map(), anachronistic: new Map(), poor: new Map() };
  for (const card of cards) {
    const team = teamOf(card.team);
    if (!team) continue;
    const grade = !team.logo ? 'missing' : team.logoEra ? 'anachronistic' : team.logoNote ? 'poor' : null;
    if (!grade) continue;
    const bucket = buckets[grade];
    if (!bucket.has(card.team)) {
      bucket.set(card.team, {
        key: card.team,
        team: `${team.city} ${team.name}`,
        era: team.era ?? null,
        cards: [],
        file: `public/logos/WNBA/${card.team}.png`,
        have: team.logo ?? null,
        haveEra: team.logoEra ?? null,
        note: team.logoNote ?? null,
      });
    }
    bucket.get(card.team).cards.push(`${card.name} ${card.season}`);
  }
  const sorted = m => [...m.values()].sort((a, b) => a.team.localeCompare(b.team));
  return {
    missing: sorted(buckets.missing),
    anachronistic: sorted(buckets.anachronistic),
    poor: sorted(buckets.poor),
  };
}

function summarize(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return { n: 0 };
  const at = p => v[Math.floor(p * (v.length - 1))];
  return {
    n: v.length,
    min: v[0],
    median: at(0.5),
    max: v[v.length - 1],
    mean: Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)),
  };
}

/** The NBA fit's own centred feature ranges, for the extrapolation check. */
function nbaEnvelope(model) {
  const rows = [];
  for (const season of model.fittedOn.seasons) {
    const advanced = readCache(`bbref-wide-${season}-advanced`);
    const perPoss = readCache(`bbref-wide-${season}-perposs`);
    if (!advanced || !perPoss) continue;
    const rates = new Map(perPoss.map(r => [`${r.playerId}|${r.team}`, r]));
    const league = [];
    for (const a of advanced) {
      const p = rates.get(`${a.playerId}|${a.team}`);
      if (!p) continue;
      league.push(featureRow({ ...a, ...p, season, league: 'nba' }));
    }
    if (league.length === 0) continue;
    const basis = centringBasis(league, model.features);
    for (const row of league) {
      if ((row.minutes ?? 0) < model.fittedOn.minMinutes) continue;
      rows.push(centredFeatures(row, basis, model.features));
    }
  }
  return rows.length ? L.featureEnvelope(rows, model.features) : null;
}

export function main({ log = console.log } = {}) {
  const calibration = readJson(CALIBRATION_FILE);
  const model = readJson(MODEL_FILE);
  const legends = readLegends();

  const { loaded, missing: missingSeasons } = loadArchive();
  if (loaded.length === 0) {
    throw new Error(
      'No cached WNBA season tables — run `node scripts/cardgen/wnba/fetchWnbaHistory.js` first.'
    );
  }
  if (missingSeasons.length) {
    console.error(
      `FAILED: ${missingSeasons.length} season(s) are not cached and every one of them is a ` +
        `season a legend may have played: ${missingSeasons.join(', ')}. Run ` +
        '`node scripts/cardgen/wnba/fetchWnbaHistory.js`.'
    );
    process.exitCode = 1;
  }

  const seasons = rateArchive(loaded, model);
  const reference = seasons.get(WNBA_SEASON);
  if (!reference) {
    throw new Error(
      `The reference season ${WNBA_SEASON} is not cached, and it is what every era shift and ` +
        'every pool-relative layer is stated against. Run `node scripts/cardgen/wnba/fetchWnba.js`.'
    );
  }

  const { resolved, missing, ambiguous } = resolveLegendIds(legends, loaded);
  if (missing.length) {
    console.error(
      `FAILED: ${missing.length} named legend(s) match no row anywhere in the ` +
        `${WNBA_FIRST_SEASON}-${WNBA_SEASON} archive: ${missing.join(', ')}. Check the spelling ` +
        'in card-data/wnba-legends.json against Basketball-Reference.'
    );
    process.exitCode = 1;
  }
  if (ambiguous.length) {
    console.error(
      `FAILED: ${ambiguous.length} name(s) belong to more than one player id, so the join is ` +
        'not safe: ' +
        ambiguous.map(a => `${a.name} (${a.ids.join(' / ')})`).join('; ')
    );
    process.exitCode = 1;
  }

  // ── The selection ─────────────────────────────────────────────────────────
  const selections = [];
  for (const legend of resolved) {
    const career = careerOf(legend.playerId, seasons);
    if (career.length === 0) continue;
    const { best, eligibility, scored } = L.bestLegendSeason(career);
    selections.push({ ...legend, best, eligibility, career: scored });
  }

  // ── The two pool-relative layers, both calibrated on the CURRENT sets ──────
  //
  // Shooting on the 2026 WNBA pool, Speed+Power on the NBA pool, exactly as
  // generateWnbaCards.js does — so a legend's card sits on the same yardstick
  // as a 2026 WNBA card and a 2026-27 NBA card rather than on a scale of its
  // own. Both are computed over [pool, ...legends] and the tail sliced back out.
  // The compression basis is the CURRENT WNBA SET'S OWN 108 PLAYERS where that
  // file exists — the same population its Shot Lines were fitted on, so a
  // legend's line means the same thing as a 2026 player's. A checkout that has
  // not generated it falls back to the pool rule, which is the same population
  // to within the force-included seven.
  const wnbaSet = fs.existsSync(WNBA_CARDS_FILE) ? readJson(WNBA_CARDS_FILE) : null;
  const cardedIds = new Set((wnbaSet?.cards ?? []).map(c => c.bbrefId));
  const poolRows = cardedIds.size
    ? reference.rows.filter(r => cardedIds.has(r.playerId))
    : reference.rows.filter(r => (r.mpg ?? 0) >= 16);

  const shootingRows = [
    ...poolRows.map(r => ({
      tsPct: r.tsPct,
      paintPct: r.fgPct2,
      threePct: r.fgPct3,
      paintAttempts: r.fg2aTotal ?? 0,
      threeAttempts: r.fg3aTotal ?? 0,
    })),
    ...selections.map(s =>
      legendShootingInput(s.best, seasons.get(s.best.season).shooting, reference.shooting)
    ),
  ];
  const shooting = S.buildShootingLayer(shootingRows, {
    shotLineTarget: calibration.shotLine.target,
    paint: calibration.paintBoost,
    three: calibration.threePtBoost,
  });

  const nba = readJson(path.join(GEN_DIR, 'player-pool-2026.json'));
  const nbaRows = nbaBasisRows(model, nba);
  const withVorp = r => ({
    bpmHat: r.bpmHat,
    vorpPerGameHat: vorpPerGame(r.bpmHat, r, WNBA_GAME_MINUTES),
  });
  const spRows = [...nbaRows, ...selections.map(s => withVorp(s.best))];
  const cut = nbaRows.length;
  const basis = compositeBasis(spRows.slice(0, cut), COMPOSITE_WEIGHTS);
  const composites = spRows.map(r => composite(r, basis, COMPOSITE_WEIGHTS));
  const totals = mapToReferenceScale(composites, REFERENCE_TOTALS, {
    calibrateOn: composites.slice(0, cut),
  });

  const cards = selections.map((s, i) =>
    buildLegendCard({
      row: s.best,
      shooting: shooting.players[poolRows.length + i],
      speedPowerTotal: totals[cut + i],
      calibration,
    })
  );
  cards.sort((a, b) => a.name.localeCompare(b.name));

  // ── The trust audit ───────────────────────────────────────────────────────
  const envelope = nbaEnvelope(model);
  const audit = [];
  for (const s of seasons.values()) {
    const coverage = L.inputCoverage(s.rows, model.features, (r, key) => FEATURES[key](r));
    audit.push({
      season: s.season,
      players: s.rows.length,
      schedule: s.schedule,
      coverage,
      // ── AND WHETHER THE GAPS ARE GAPS AT ALL ──────────────────────────────
      //
      // Every input the coverage check reports absent is one of TS%, eFG% or
      // 3PAr, and every one of those is undefined BY DEFINITION for a player
      // who took no shots — a divide by zero, not a hole in the archive.
      // Measured across all thirty seasons: 33 such rows, 33 of them with zero
      // season field-goal attempts, none otherwise. Recorded per season so the
      // claim stays checkable rather than becoming a comment nobody re-runs.
      gapsAreZeroAttempt: s.rows
        .filter(r => (r.minutes ?? 0) > 0 && !Number.isFinite(r.tsPct))
        .every(r => !((r.fgaTotal ?? 0) > 0)),
      extrapolation: envelope
        ? L.extrapolation(s.rows.map(r => r.centred), envelope, model.features)
        : null,
      fittedBpm: {
        mean: Number(s.distribution.mean.toFixed(3)),
        sd: Number(s.distribution.sd.toFixed(3)),
        n: s.distribution.n,
      },
      scoringPer4Min: s.scoring == null ? null : Number(s.scoring.toFixed(3)),
      shooting: Object.fromEntries(
        Object.entries(s.shooting).map(([k, v]) => [k, Number(v.toFixed(4))])
      ),
    });
  }
  audit.sort((a, b) => a.season - b.season);

  const shoppingList = logoShoppingList(cards, getWnbaTeam);

  // ── Write ─────────────────────────────────────────────────────────────────
  fs.mkdirSync(GEN_DIR, { recursive: true });
  const roster = selections
    .map(s => ({
      name: s.name,
      season: s.best.season,
      team: wnbaFranchiseForSeason(s.best.team, s.best.season),
      pos: s.best.pos,
      games: s.best.games,
      mpg: Number((s.best.mpg ?? 0).toFixed(1)),
      bbrefId: s.playerId,
      eligibility: s.eligibility,
      careerSeasons: s.career.length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(ROSTER_FILE, `${JSON.stringify(roster, null, 2)}\n`);

  const payload = {
    generatedAt: new Date().toISOString(),
    provisional: true,
    set: WNBA_SUPER_SEASON_SET,
    league: 'WNBA',
    statsSeason: 'career-best season',
    firstSeason: WNBA_FIRST_SEASON,
    lastSeason: WNBA_LAST_ARCHIVED_SEASON,
    referenceSeason: WNBA_SEASON,
    rosterSize: cards.length,
    named: legends.length,
    rule: {
      bestSeason:
        'the fitted BPM, scored against its OWN season\'s WNBA — the same question the NBA ' +
        'Super Season set asks of real BPM',
      minGamesShare: L.LEGEND_MIN_GAMES_SHARE,
      minMpg: L.LEGEND_MIN_MPG,
      eligibility:
        `a season must be at least ${Math.round(L.LEGEND_MIN_GAMES_SHARE * 100)}% of its own ` +
        `schedule and at least ${L.LEGEND_MIN_MPG} minutes a game. Stated as a SHARE because a ` +
        'WNBA season has run 28, 30, 32, 34, 36, 40 and 44 games, so no flat number means the ' +
        'same thing twice; stated per game because a 40-minute game makes a season-minutes ' +
        'floor carry the schedule length inside it. Falls back one floor at a time, games first',
    },
    sources: {
      origin: `basketball-reference.com/wnba season tables, ${WNBA_FIRST_SEASON}-${WNBA_LAST_ARCHIVED_SEASON}`,
      bpm:
        'FITTED — the WNBA publishes no BPM, OBPM, DBPM or VORP in any season. Every season is ' +
        'rated with its OWN league as the centring basis, which is what makes a 1997 rating and ' +
        'a 2019 rating the same claim about two different leagues. See the `audit` block for ' +
        'how far back that can honestly be applied',
      speedPower:
        'z(fitted BPM) + 0.35 * z(fitted VORP per game), mapped onto the finished set\'s ' +
        'distribution with the current NBA pool as the calibration basis — the same map the ' +
        'current WNBA set uses, so the two sets share a yardstick',
      shotLine:
        'real TS%, ERA-SHIFTED onto the reference season\'s league mean before compression. ' +
        'The NBA Super Season set does not do this and does not need to; this set spans the ' +
        'league\'s whole history, over which its shooting moved far more',
      paintBoost: '2P%, era-shifted, standing in for rim FG% which Basketball-Reference does not carry',
      defBoost: 'the fitted DBPM, rounded',
      chart:
        'synthesized from season TOTALS: production per four-minute section is 4 * total / ' +
        'minutes, measured, with no pace in it. NOT era-shifted — the chart is what she did, ' +
        'the same treatment the NBA Super Season set gives its charts. The `audit` block ' +
        'carries each season\'s league scoring rate so an older card\'s smaller chart can be read',
      missing: ['BPM', 'OBPM', 'DBPM', 'VORP', 'EPM', 'rim FG%', 'DRB%'],
    },
    note:
      'PROVISIONAL, and league-and-era-relative by design. Every rating here says where a player ' +
      'stood in the league SHE played in, placed on the current sets\' scale so the cards can ' +
      'share a table. It is not a claim that the 1997 and 2024 WNBA were equally strong, nor ' +
      'that either is comparable in absolute terms with the NBA.',
    logosNeeded: shoppingList,
    audit,
    cards,
  };
  fs.writeFileSync(CARDS_FILE, `${JSON.stringify(payload, null, 1)}\n`);

  report({ log, cards, selections, audit, shoppingList, model, seasons, reference, legends });
  log(`\nWrote:\n  ${path.relative(REPO_ROOT, CARDS_FILE)}\n  ${path.relative(REPO_ROOT, ROSTER_FILE)}`);
  return payload;
}

/** The NBA pool's rows, rated by the SAME fitted model — the Speed+Power basis. */
function nbaBasisRows(model, pool) {
  const advanced = readCache('bbref-wide-2026-advanced');
  const perPoss = readCache('bbref-wide-2026-perposs');
  if (!advanced || !perPoss) {
    throw new Error(
      'No cached bbref-wide-2026 tables — run `node scripts/cardgen/wnba/fitBpmModel.js` first; ' +
        'the NBA pool is the calibration basis for the Speed+Power map.'
    );
  }
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
  const basis = centringBasis(league, model.features);
  const byName = new Map();
  for (const row of league) {
    const key = normalizeName(row.name);
    const prev = byName.get(key);
    if (!prev || (row.minutes ?? 0) > (prev.minutes ?? 0)) byName.set(key, row);
  }
  const rows = [];
  for (const p of pool) {
    const hit = byName.get(normalizeName(p.name));
    if (!hit) continue;
    const bpmHat = predict(model.targets.bpm, centredFeatures(hit, basis, model.features));
    rows.push({ bpmHat, vorpPerGameHat: vorpPerGame(bpmHat, hit, 48) });
  }
  return rows;
}

function report({ log, cards, selections, audit, shoppingList, model, seasons, reference, legends }) {
  log(`${cards.length} WNBA Super Season cards, from ${legends.length} named legends.`);
  log(
    `  archive ${audit[0].season}-${audit[audit.length - 1].season}, ` +
      `${audit.length} seasons, ${audit.reduce((a, s) => a + s.players, 0)} player-seasons.`
  );

  log('\n── EVERY LEGEND\'S BEST SEASON ──────────────────────────────────────────');
  log('player                    season  team   g/sched  mpg   BPM^   z    S/P   SL  $');
  for (const c of cards) {
    const s = selections.find(x => playerIdFromName(x.name) === c.id);
    log(
      `  ${c.name.padEnd(24)}${String(c.season).padStart(4)}   ${String(c.team).padEnd(6)}` +
        `${String(c.games).padStart(3)}/${String(c.schedule).padEnd(3)} ${String(c.mpg).padStart(5)}` +
        `${String(c.metrics.bpmHat).padStart(7)}${String(c.metrics.seasonZ).padStart(6)}` +
        `${String(c.speed + c.power).padStart(6)}${String(c.shotLine).padStart(5)}  $${c.salary}` +
        `${s && s.eligibility !== 'both' ? `   [${s.eligibility}]` : ''}`
    );
  }

  log('\n── THE RUNNERS-UP, so a pick can be argued with ─────────────────────────');
  for (const s of selections.slice(0, 4)) {
    const top = [...s.career].sort((a, b) => b.score - a.score).slice(0, 3);
    log(`  ${s.name}`);
    for (const t of top) {
      log(
        `      ${t.season}  ${String(t.games).padStart(2)}/${String(t.schedule).padEnd(2)}g ` +
          `${t.mpg.toFixed(1).padStart(4)} mpg  BPM^ ${t.bpmHat.toFixed(2).padStart(6)}  ` +
          `z ${t.score.toFixed(2).padStart(5)}  PER ${String(t.per).padStart(4)}` +
          `${t.season === s.best.season ? '   <- carded' : ''}` +
          `${t.games < t.minGames ? `   (short of ${t.minGames})` : ''}`
      );
    }
  }

  // ── How far back the model can be applied ────────────────────────────────
  log('\n── MODEL TRUST BY ERA ───────────────────────────────────────────────────');
  log('season  n    sched  inputs        outside NBA fit range   fitted BPM sd   lg TS%   pts/4min');
  for (const a of audit) {
    const gaps = Object.entries(a.coverage.missing)
      .map(([k, v]) => `${k} ${v.absent}`)
      .slice(0, 3)
      .join(' ');
    log(
      `${a.season}  ${String(a.players).padStart(3)}  ${String(a.schedule).padStart(5)}  ` +
        `${(a.coverage.complete ? 'complete' : gaps).padEnd(24)}` +
        `${a.extrapolation ? `${(100 * a.extrapolation.share).toFixed(2)}%`.padStart(7) : '      -'}` +
        `${String(a.fittedBpm.sd).padStart(16)}` +
        `${String(a.shooting.tsPct).padStart(9)}${String(a.scoringPer4Min).padStart(11)}`
    );
  }

  const realGaps = audit.filter(a => !a.gapsAreZeroAttempt);
  log(
    `\n  Input coverage: ${realGaps.length === 0
      ? 'COMPLETE in every season. Every value the check reports absent is TS%, eFG% or 3PAr ' +
        'on a player who took no shots — undefined by definition, not a hole in the archive.'
      : `${realGaps.length} season(s) have a genuine gap: ${realGaps.map(a => a.season).join(', ')}`}`
  );

  const worst = [...audit].sort((a, b) => (b.extrapolation?.share ?? 0) - (a.extrapolation?.share ?? 0))[0];
  log(
    `\n  Widest extrapolation: ${worst.season} at ${(100 * (worst.extrapolation?.share ?? 0)).toFixed(2)}% ` +
      `of feature values outside the NBA fit's 1st-99th percentile` +
      `${worst.extrapolation ? ` (${Object.entries(worst.extrapolation.byFeature).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`
  );
  log(
    `  Model: ${model.featureSet} feature set, ${model.features.length} inputs, held-out-season ` +
      `R² bpm ${model.targets.bpm.heldOutSeasonsR2} dbpm ${model.targets.dbpm.heldOutSeasonsR2} ` +
      `(measured on the NBA — there is no WNBA BPM to check against, in any season).`
  );

  // ── The era shift actually applied ───────────────────────────────────────
  log('\n── ERA SHIFT APPLIED TO EACH CARDED SEASON\'S SHOOTING ───────────────────');
  log(`  reference: ${reference.season} league TS% ${reference.shooting.tsPct.toFixed(4)}, ` +
    `2P% ${reference.shooting.fgPct2.toFixed(4)}, 3P% ${reference.shooting.fgPct3.toFixed(4)}`);
  for (const c of cards) {
    const s = seasons.get(c.season);
    log(
      `  ${c.name.padEnd(24)}${c.season}   TS% ${((reference.shooting.tsPct - s.shooting.tsPct) * 100 >= 0 ? '+' : '')}` +
        `${((reference.shooting.tsPct - s.shooting.tsPct) * 100).toFixed(2)}pp   ` +
        `3P% ${((reference.shooting.fgPct3 - s.shooting.fgPct3) * 100 >= 0 ? '+' : '')}` +
        `${((reference.shooting.fgPct3 - s.shooting.fgPct3) * 100).toFixed(2)}pp`
    );
  }

  // ── The card fields ──────────────────────────────────────────────────────
  log('\nfield          n   min   med   max   mean');
  for (const f of ['speed', 'power', 'shotLine', 'paintBoost', 'threePtBoost', 'defBoost', 'salary']) {
    const s = summarize(cards.map(c => c[f]));
    log(
      `${f.padEnd(14)}${String(s.n).padStart(3)}${String(s.min).padStart(6)}${String(s.median).padStart(6)}` +
        `${String(s.max).padStart(6)}${String(s.mean).padStart(8)}`
    );
  }
  const tooTall = cards.filter(c => c.chart.length > MAX_CHART_TIERS);
  if (tooTall.length) {
    log(`  *** ${tooTall.length} CHARTS ARE TOO TALL TO PRINT: ${tooTall.map(c => c.id).join(', ')}`);
  }

  // ── Does the chart still integrate to the player the box score describes? ──
  //
  // The same guard the base set and the WNBA set run, against the same
  // committed reference, and it is the one check that would catch a unit error
  // in the 40-minute conversion. AST runs low on this set and that is expected
  // rather than drift: a d20 face pays a WHOLE assist, and eleven of these
  // sixteen are bigs and wings producing well under half an assist per four
  // minutes, so the chart's granularity floors them. The base set's own AST
  // reference is 0.88 for the same reason.
  const REFERENCE_RATIO = { pts: 1.0, reb: 1.16, ast: 0.88 };
  const totalKeyOf = { pts: 'ptsTotal', reb: 'trbTotal', ast: 'astTotal' };
  log('\nchart expected value per roll, over the player\'s per-4-minute rate');
  for (const stat of V.CHART_STATS) {
    const ratios = cards
      .map(c => {
        const sel = selections.find(s => playerIdFromName(s.name) === c.id);
        const target = per4MinFromTotals(sel?.best?.[totalKeyOf[stat]], sel?.best?.minutes);
        return target > 0 ? expectedValuePerRoll(c.chart, stat) / target : null;
      })
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const at = p => ratios[Math.floor(p * (ratios.length - 1))];
    const drift = at(0.5) - REFERENCE_RATIO[stat];
    log(
      `  ${stat}  p10 ${at(0.1).toFixed(2)}  median ${at(0.5).toFixed(2)}  p90 ${at(0.9).toFixed(2)}` +
        `   vs the finished set's ${REFERENCE_RATIO[stat].toFixed(2)} -> ` +
        `${drift >= 0 ? '+' : ''}${drift.toFixed(3)}${Math.abs(drift) > 0.15 ? '  *** DRIFTED' : ''}`
    );
  }

  // ── The shopping list ────────────────────────────────────────────────────
  log('\n── HISTORICAL LOGOS NEEDED ──────────────────────────────────────────────');
  if (shoppingList.missing.length === 0) log('  none missing.');
  for (const e of shoppingList.missing) {
    log(`  MISSING   ${e.team} (${e.era})   save as ${e.file}`);
    log(`            for ${e.cards.join(', ')}`);
  }
  for (const e of shoppingList.anachronistic) {
    log(`  WRONG ERA ${e.team} (${e.era}) — currently drawing the ${e.haveEra} mark, ${e.have}`);
    log(`            for ${e.cards.join(', ')}`);
  }
  for (const e of shoppingList.poor) {
    log(`  DRAWS BAD ${e.team} (${e.era}) — ${e.have}`);
    log(`            ${e.note}`);
    log(`            for ${e.cards.join(', ')}`);
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
