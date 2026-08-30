// Builds the two COMPUTABLE special sets — Super Season and Rookie.
//
//   node scripts/cardgen/generateSpecialSets.js
//
// Writes card-data/generated/cards-super-season.json, cards-rookie.json and
// card-badges.json, which the studio picks up automatically
// (src/studio/players.js). Needs no network: everything comes out of
// card-data/cache/bbref-history.json, which scripts/cardgen/fetchHistory.js
// produces and which is committed.
//
// ── WHAT EACH SET IS ────────────────────────────────────────────────────────
//
//   Super Season   Each active player's best individual season, chosen on BPM
//                  AND VORP, each scored against that season's own league. WIN
//                  SHARES USED TO BE IN THIS AND IS NOT ANY MORE — it allocates
//                  TEAM wins, so it docks a good player on a bad team;
//                  history.js states the argument, and states plainly what VORP
//                  does and does not fix (it buys durability back; it does not
//                  make the score team-independent). THE EXCLUSION RULE IS WHAT
//                  MAKES THE SET: if a player's best season IS the most recent
//                  one, he gets no card, because his base card already is that
//                  season.
//
//   Rookie         Each active player's rookie-year card. Same exclusion, for
//                  the same reason: a player whose rookie season IS the current
//                  one already has that card in the base set.
//
// ── AND THE EXCLUSION NO LONGER THROWS THE FACT AWAY ────────────────────────
//
// It used to. 149 players are known to have just had the best season of their
// careers and 33 to have just debuted, and until now the only trace of either
// was a line on an `excluded` list inside a generated file. Nothing on any card
// said so, which made the exclusion a silent loss of exactly the information
// these sets exist to surface.
//
// The user's call: "if there is any overlap between 2026-27 cards, Super Season
// and Rookie Cards, you can combine them. If 2025-26 was a player's 'Super
// Season' and/or rookie season, add the badges to that player and pull
// prioritize in that order. If last year was their super season, keep the 26-27
// design and just add the badge."
//
// So the exclusion stands — there is still no second card of the same season —
// and the fact moves onto the player's BASE card as a badge. That is what
// card-badges.json is: the exclusion lists, restated as the thing the base set
// should print. See src/cards/badges.js for how one is chosen and drawn.
//
// THE TWO LISTS ARE NESTED, and that is structural rather than a coincidence
// worth checking each run: a player whose FIRST season is the most recent one
// has exactly one season, so it is also his BEST one. Every rookie-excluded
// player is therefore super-season-excluded too (33 of 33), and since Super
// Season wins the priority, the ROOKIE badge does not print on any base card
// today. The data below records BOTH badges for those 33 anyway — the file says
// what is true, badges.js decides what prints — so flipping the priority is a
// one-line change in one place and needs no regeneration.
//
// ── EVERY NUMBER ON THESE CARDS IS PROVISIONAL, AND MORE SO THAN THE BASE SET ─
//
// dunksandthrees' prior seasons are paywalled, so EPM, Estimated Wins and rim
// FG% — the three inputs the base set's Speed/Power budget, Def Boost and Paint
// Boost are built on — do not exist for any of these seasons. The substitutes,
// each named so nobody has to guess later:
//
//   Speed + Power   BPM in EPM's place, and VORP PER GAME in the Estimated
//                   Wins refinement slot, at the same 0.35 weight the live
//                   pipeline uses. Win Shares per game used to fill that slot
//                   and was removed for the same reason it left the best-season
//                   rule. The composite is then mapped onto the
//                   finished set's Speed+Power distribution using the CURRENT
//                   POOL as the calibration basis. That last part is the whole
//                   of "work Speed+Power in by using the numbers we have and
//                   making best comparisons": a 2009 season is scored on the
//                   same yardstick the 2026-27 pool is, so the card sits
//                   correctly next to a current player instead of being
//                   recentred among other peaks. See mapToReferenceScale's
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
  BEST_SEASON_METRIC_SETS,
  BEST_SEASON_WEIGHTS,
  BEST_SEASON_MIN_GAMES,
  BEST_SEASON_MIN_MINUTES,
  careerSeasons,
  bestSeason,
  bestSeasonByMetricSet,
  rookieSeason,
  perMetricBest,
} from './history.js';
import { playerIdFromName } from '../../src/cards/playerId.js';
import { franchiseForSeason } from '../../src/cards/teams.js';
import { CURRENT_SET, SUPER_SEASON_SET, ROOKIE_SET } from '../../src/cards/sets.js';
import {
  BADGE_IDS,
  ROOKIE_BADGE,
  SUPER_SEASON_BADGE,
  pickBadge,
} from '../../src/cards/badges.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const OUTPUT_FILES = {
  [SUPER_SEASON_SET]: path.join(GEN_DIR, `cards-${SUPER_SEASON_SET}.json`),
  [ROOKIE_SET]: path.join(GEN_DIR, `cards-${ROOKIE_SET}.json`),
};

/**
 * Where the base set's badges are written.
 *
 * NOT INTO cards-2026-27.json, deliberately, even though that is the file whose
 * cards wear them. That file belongs to generateCards.js, which is deliberately
 * history-free and can be re-run at any time; writing badges into it from here
 * would make the two generators order-dependent and would lose every badge the
 * next time the other one ran. A separate file joined by player id has neither
 * problem, and it is also the one the studio already had a slot for — it
 * degrades to "no badges" if it was never generated, exactly as the stat file
 * degrades to placeholders.
 */
export const BADGE_FILE = path.join(GEN_DIR, 'card-badges.json');

/**
 * Which badge each exclusion turns into.
 *
 * The two rules are the same rule — "this season IS the card, so there is no
 * second card of it" — so the mapping is one table rather than a branch in each
 * of the two places that used to say it.
 */
export const EXCLUSION_BADGES = {
  superSeason: SUPER_SEASON_BADGE,
  rookie: ROOKIE_BADGE,
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

const z = (value, stats) =>
  Number.isFinite(value) && stats?.sd > 0 ? (value - stats.mean) / stats.sd : 0;

/** Null rather than 0 for a season with no games, so it leaves a basis alone. */
const perGame = (total, games) => (games > 0 ? (total ?? 0) / games : null);

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
 * ── THE SPEED+POWER COMPOSITE, AND WHY WIN SHARES IS NOT IN IT EITHER ───────
 *
 * It used to be `z(BPM) + 0.35 * z(WS per game)` — deliberately the same shape
 * as speedPower.js's `z(EPM) + 0.35 * z(EW/GP)`, with Win Shares per game
 * standing in for Estimated Wins per game because both are "wins credited,
 * divided by games". THE ANALOGY IS THE PROBLEM. Estimated Wins is derived from
 * EPM, a player-level plus/minus; Win Shares is derived from a TEAM's actual
 * win total, divided up. They look alike in units and are not alike in what
 * they measure, and the difference is precisely the team-quality bias the
 * best-season rule was just cleared of. Carrying it here would have docked the
 * same players a second time, on the same card.
 *
 * For a while the composite was therefore BPM alone, and the volume dimension it
 * lost was the same one the best-season rule lost. VORP PER GAME NOW FILLS THAT
 * SLOT: VORP is BPM above replacement times minutes share, so VORP per game is
 * BPM weighted by playing time — which is what EW/GP is to EPM, this time
 * honestly, since both terms are derived from the same plus/minus estimate
 * rather than from a team's win column.
 *
 * SAY EXACTLY WHAT THAT BUYS. It buys DURABILITY: a season that was a whole
 * season now outscores a hot two months at the same rate. It does NOT buy
 * team-independence. VORP inherits BPM's team adjustment rather than removing
 * it, so whatever team influence BPM carries is still here, now multiplied
 * through by availability. What it avoids is ADDING a second, different team
 * term — which is precisely what Win Shares per game was doing.
 *
 * The shrink below still runs and is still doing most of the work at the thin
 * end: a season is pulled toward replacement level in proportion to how little
 * of a season it is, which is a softer correction than any volume term and
 * applies to both of them. The run report prints both metric sets side by side.
 */
export const COMPOSITE_INPUTS = {
  bpm: s => s.bpm,
  vorpPerGame: s => perGame(s.vorp, s.games),
  wsPerGame: s => perGame(s.ws, s.games),
};

/**
 * What each input reads at replacement level — where a season with no minutes
 * behind it is shrunk TO.
 *
 * -2.0 BPM is not a taste call: it is the definition Basketball-Reference
 * builds VORP on, so it is the value the rest of this composite is already
 * stated against. VORP is zero at replacement level by that same definition,
 * which is what makes it drop into this table without a second decision.
 */
export const COMPOSITE_REPLACEMENT = { bpm: -2.0, vorpPerGame: 0, wsPerGame: 0 };

export const COMPOSITE_METRIC_SETS = {
  bpmOnly: { bpm: 1 },
  bpmVorp: { bpm: 1, vorpPerGame: REFINEMENT_WEIGHT },
};

/** THE ACTIVE COMPOSITE. One line to change. */
export const COMPOSITE_WEIGHTS = COMPOSITE_METRIC_SETS.bpmVorp;

/**
 * Where a season with no minutes behind it is pulled TO.
 *
 * Kept as its own export because the shrink's whole argument is about this
 * number: shrinking toward the POOL MEAN instead — the obvious alternative —
 * would be wrong at both ends. It would hand a 53-minute flier an average card,
 * and it would hand a 53-minute disaster one too.
 */
export const REPLACEMENT_BPM = COMPOSITE_REPLACEMENT.bpm;

/**
 * The composite for one season, shrunk for how much season is behind it.
 *
 * The z-scores are taken against the CURRENT POOL's mean and spread, passed in,
 * so a historical season's composite is directly comparable with a 2026-27
 * card's. The shrink is applied to the pool's own composites too, for the same
 * reason: the map is only a like-for-like comparison if both sides of it were
 * measured the same way.
 */
export function historicalComposite(season, basis, weights = COMPOSITE_WEIGHTS) {
  let raw = 0;
  let replacement = 0;
  for (const [key, w] of Object.entries(weights)) {
    raw += w * z(COMPOSITE_INPUTS[key](season), basis[key]);
    replacement += w * z(COMPOSITE_REPLACEMENT[key], basis[key]);
  }
  const trust = Math.min(Math.max((season.minutes ?? 0) / FULL_SEASON_MINUTES, 0), 1);
  return trust * raw + (1 - trust) * replacement;
}

/** Mean/sd of each composite input across the current pool's own season. */
export function compositeBasis(currentRows, weights = COMPOSITE_WEIGHTS) {
  const basis = {};
  for (const key of Object.keys(weights)) {
    basis[key] = A.meanSd(currentRows.map(COMPOSITE_INPUTS[key]));
  }
  return basis;
}

/**
 * Every season's Speed+Power total on the finished set's scale.
 *
 * `all` is the current pool's rows followed by the seasons being carded, and
 * `cut` is where the first ends — both layers are FITTED to the pool and then
 * applied to the history, which is what puts these cards on the base set's
 * scale rather than on a scale of their own.
 */
export function speedPowerTotals(all, cut, weights = COMPOSITE_WEIGHTS) {
  const basis = compositeBasis(all.slice(0, cut), weights);
  const composites = all.map(s => historicalComposite(s, basis, weights));
  return mapToReferenceScale(composites, REFERENCE_TOTALS, {
    calibrateOn: composites.slice(0, cut),
  });
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
export function buildSet({ selections, currentRows, calibration, weights = COMPOSITE_WEIGHTS }) {
  const seasons = selections.map(s => s.season);
  const all = [...currentRows, ...seasons];
  const cut = currentRows.length;

  const shooting = S.buildShootingLayer(all.map(historicalShootingInput), {
    shotLineTarget: calibration.shotLine.target,
    paint: calibration.paintBoost,
    three: calibration.threePtBoost,
  });

  const totals = speedPowerTotals(all, cut, weights);

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
 * The same selections' Speed+Power totals under EVERY declared composite, so
 * the run report can show what the alternative would have printed.
 */
export function compareComposites({ selections, currentRows, sets = COMPOSITE_METRIC_SETS }) {
  const all = [...currentRows, ...selections.map(s => s.season)];
  const cut = currentRows.length;
  const byName = {};
  for (const [name, weights] of Object.entries(sets)) {
    byName[name] = speedPowerTotals(all, cut, weights).slice(cut);
  }
  return selections.map((selection, i) => ({
    name: selection.player.name,
    season: selection.season.season,
    minutes: selection.season.minutes,
    totals: Object.fromEntries(Object.entries(byName).map(([set, t]) => [set, t[i]])),
  }));
}

/**
 * Which players are in each set, and who was excluded and why.
 *
 * Runs both selections in one pass because they share all their expensive work:
 * one career grouping per player answers both questions.
 */
export function selectSets({
  pool,
  rows,
  distributions,
  firstSeason = FIRST_SEASON,
  weights = BEST_SEASON_WEIGHTS,
  metricSets = BEST_SEASON_METRIC_SETS,
}) {
  const { ids, missing } = resolvePlayerIds(pool, rows);
  const byId = rowsById(rows);

  const superSeason = [];
  const rookie = [];
  const excluded = { superSeason: [], rookie: [] };
  /** The base set's badges: one record per player who earned at least one. */
  const baseBadges = [];
  const metricSetSplits = [];
  const notes = { fallbackFloor: [], gamesFallback: [], beyondRange: [], partialSeason: [] };

  const describe = s => ({
    season: s.season,
    games: s.games,
    minutes: s.minutes,
    bpm: s.bpm,
    vorp: s.vorp,
    ws: s.ws,
    ws48: s.ws48,
  });

  for (const player of pool) {
    const bbrefId = ids.get(player.name);
    if (!bbrefId) continue;
    const seasons = careerSeasons(byId.get(bbrefId) ?? []);
    if (seasons.length === 0) continue;

    const { scored, best, usedFallbackFloor, usedGamesFallback } = bestSeason(
      seasons,
      distributions,
      weights
    );
    if (usedFallbackFloor) notes.fallbackFloor.push(player.name);
    if (usedGamesFallback) {
      notes.gamesFallback.push(`${player.name} ${best.season} ${best.games}g ${best.minutes}m`);
    }

    const perMetric = perMetricBest(scored);

    // What every OTHER declared metric set would have chosen. Recorded only
    // where they part company — the agreements are the boring majority and
    // printing them would bury the cases worth looking at.
    const alternatives = bestSeasonByMetricSet(seasons, distributions, metricSets);
    const picks = Object.fromEntries(
      Object.entries(alternatives).map(([name, r]) => [name, r.best?.season ?? null])
    );
    if (new Set(Object.values(picks)).size > 1) {
      metricSetSplits.push({
        name: player.name,
        chosen: best.season,
        picks,
        seasons: scored
          .filter(s => Object.values(picks).includes(s.season))
          .map(describe),
      });
    }

    // THE EXCLUSION RULE. A best season that IS the most recent season is
    // already the player's base card; a second card of it would be the same
    // card twice. What it now ALSO does is badge that base card — the reason
    // for the exclusion is a fact about the player, and `badge` on the record
    // is that fact travelling to where it can be printed.
    const earned = [];
    if (best.season === LAST_SEASON) {
      excluded.superSeason.push({
        name: player.name,
        reason: 'best season is the current one',
        badge: EXCLUSION_BADGES.superSeason,
      });
      earned.push(EXCLUSION_BADGES.superSeason);
    } else {
      if (best.partialSeason) notes.partialSeason.push(`${player.name} ${best.season}`);
      superSeason.push({ player, season: best, perMetric });
    }

    const first = rookieSeason(seasons, firstSeason);
    if (first.beyondRange) notes.beyondRange.push(player.name);
    if (first.season === LAST_SEASON) {
      excluded.rookie.push({
        name: player.name,
        reason: 'rookie season is the current one',
        badge: EXCLUSION_BADGES.rookie,
      });
      earned.push(EXCLUSION_BADGES.rookie);
    } else {
      rookie.push({ player, season: first });
    }

    // EVERY badge that applies, in the priority order badges.js declares —
    // never only the winner. The file states what is TRUE of the player; which
    // of them prints is a rendering decision, and keeping it out of the data is
    // what makes re-prioritising a one-line change rather than a regeneration.
    if (earned.length) {
      baseBadges.push({
        id: playerIdFromName(player.name),
        name: player.name,
        badges: BADGE_IDS.filter(b => earned.includes(b)),
      });
    }
  }

  baseBadges.sort((a, b) => a.name.localeCompare(b.name));
  return {
    superSeason,
    rookie,
    excluded,
    baseBadges,
    metricSetSplits,
    notes,
    missingIds: missing,
  };
}

/**
 * What the base set will actually PRINT, from what the file records.
 *
 * Runs the same `pickBadge` the card does, so the run report cannot claim a
 * distribution the template would not draw — which matters more than usual
 * here, because the honest answer today is that one of the two badges never
 * wins. See the header.
 */
export function badgeCounts(baseBadges) {
  const applies = Object.fromEntries(BADGE_IDS.map(id => [id, 0]));
  const printed = Object.fromEntries(BADGE_IDS.map(id => [id, 0]));
  let multiple = 0;
  for (const record of baseBadges) {
    for (const id of record.badges) applies[id] += 1;
    if (record.badges.length > 1) multiple += 1;
    const shown = pickBadge(record.badges);
    if (shown) printed[shown.id] += 1;
  }
  return { players: baseBadges.length, applies, printed, multiple };
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

/**
 * The base set's badge file.
 *
 * Keyed by the player id `src/cards/playerId.js` derives — the same key the
 * photo store, cards-2026-27.json and the studio's own list all use — because
 * this file exists only to be JOINED onto a base-set card and a name would
 * work today and break the first time a source spelled one differently.
 */
function writeBadges({ set, badges, counts }) {
  fs.mkdirSync(GEN_DIR, { recursive: true });
  const body = {
    generatedAt: new Date().toISOString(),
    // WHICH set wears these. The studio checks it rather than assuming, so a
    // stale file from another season degrades to no badges instead of badging
    // the wrong 149 players.
    set,
    provisional: true,
    source:
      'the Super Season and Rookie exclusion lists: a player whose best or rookie season is ' +
      `${LAST_SEASON} gets no card in that set, because his base card already IS that season — ` +
      'so the fact is printed on the base card as a badge instead',
    // Recorded for provenance only; the ORDER THAT DECIDES lives in
    // src/cards/badges.js and is applied at render time, not here.
    priority: BADGE_IDS,
    counts,
    badges,
  };
  fs.writeFileSync(BADGE_FILE, `${JSON.stringify(body, null, 1)}\n`);
  return body;
}

/** The one-line description of every substitution, carried into both files. */
const SOURCES = {
  origin: 'basketball-reference.com season tables (advanced + per-100), 2000-2026',
  bestSeason:
    'BPM and VORP, equally weighted, each scored against its own season\'s league. Win Shares and ' +
    'WS/48 are deliberately excluded: they allocate TEAM wins, so they dock a good player on a bad ' +
    'team. VORP is in the rule for DURABILITY — it is BPM weighted by playing time, so a full ' +
    'season can outrank a shorter one at a higher rate. It does NOT make the score ' +
    'team-independent: VORP inherits BPM\'s team adjustment rather than removing it',
  eligibility:
    `a season must be at least ${BEST_SEASON_MIN_MINUTES} minutes AND ${BEST_SEASON_MIN_GAMES} ` +
    'games — 70% of an 82-game schedule — to be eligible as a career best. The two floors ask ' +
    'different questions: minutes ask whether a rate is measurable, games ask whether the season ' +
    'happened. They fall back one at a time (games first, then minutes) so a player whose only ' +
    'real season is short still gets a card',
  speedPower:
    `z(BPM) + ${REFINEMENT_WEIGHT} * z(VORP per game) — the same shape as the live pipeline's ` +
    'z(EPM) + 0.35 * z(EW per game), with the two Basketball-Reference stats standing in for the ' +
    'two dunksandthrees ones. Shrunk toward replacement level for a short season, then mapped ' +
    'onto the finished set\'s Speed+Power distribution with the 2026-27 pool as the calibration ' +
    'basis',
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
    log(
      `\n${set}: ${cards.length} cards (${excluded.length} excluded — ` +
        `${set === SUPER_SEASON_SET ? 'best season is the current one' : 'rookie season is the current one'}` +
        `; each gets the ${set === SUPER_SEASON_SET ? EXCLUSION_BADGES.superSeason : EXCLUSION_BADGES.rookie} badge on their ${CURRENT_SET} card)`
    );
    reportSet(cards, log);
    reportCompositeMetricSets(
      compareComposites({ selections, currentRows }),
      COMPOSITE_METRIC_SETS,
      log
    );
  }

  const counts = badgeCounts(selection.baseBadges);
  files.badges = writeBadges({
    set: CURRENT_SET,
    badges: selection.baseBadges,
    counts,
  });
  reportBadges(counts, log);

  reportBestSeasonMetricSets(selection.metricSetSplits, BEST_SEASON_METRIC_SETS, log);
  // ── HOW FAR ELIGIBILITY HAD TO FALL BACK, one line per tier ──────────────
  //
  // Both numbers are the cost of the two floors, and they are reported
  // separately because they mean different things: the games fallback is a
  // player who HAS a measurable season that is simply not long enough yet, and
  // the minutes fallback is a player who has no measurable season at all.
  if (selection.notes.gamesFallback.length) {
    log(
      `\nNo season of ${BEST_SEASON_MIN_GAMES}+ games over ${BEST_SEASON_MIN_MINUTES} minutes ` +
        `(games floor dropped, minutes floor held): ${selection.notes.gamesFallback.length}`
    );
    log(`  ${selection.notes.gamesFallback.join('; ')}`);
  }
  if (selection.notes.fallbackFloor.length) {
    log(
      `\nNo season over ${BEST_SEASON_MIN_MINUTES} minutes at all (both floors dropped): ` +
        `${selection.notes.fallbackFloor.length}`
    );
    log(`  ${selection.notes.fallbackFloor.slice(0, 12).join(', ')}`);
  }
  if (selection.notes.beyondRange.length) {
    log(`\n⚠ Earliest archived season is ${FIRST_SEASON} — the debut may be older: ${selection.notes.beyondRange.join(', ')}`);
  }
  log(
    `\nWrote:\n  ${OUTPUT_FILES[SUPER_SEASON_SET]}\n  ${OUTPUT_FILES[ROOKIE_SET]}\n  ${BADGE_FILE}`
  );
  return { files, selection };
}

/**
 * What the base set gains, and — the line worth reading — what it does not.
 *
 * `applies` is how many players each badge is TRUE of; `printed` is how many
 * cards will actually draw it once the priority has been applied. They differ
 * by the 33 players who are both, and the gap is the whole reason both numbers
 * are reported rather than one.
 */
function reportBadges(c, log) {
  log(`\n${CURRENT_SET} badges: ${c.players} of the pool carry at least one.`);
  for (const id of BADGE_IDS) {
    const lost = c.applies[id] - c.printed[id];
    log(
      `  ${id.padEnd(14)}applies to ${String(c.applies[id]).padStart(3)}` +
        `   prints on ${String(c.printed[id]).padStart(3)}` +
        `${lost ? `   (${lost} outranked)` : ''}`
    );
  }
  log(`  ${c.multiple} players earn more than one; the priority is ${BADGE_IDS.join(' > ')}.`);
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
 * BPM-ONLY VERSUS BPM+VORP, SIDE BY SIDE, ON EVERY RUN.
 *
 * The rule is BPM+VORP as of 2026-08-30 — see history.js for what VORP does buy
 * (durability) and what it does not (team-independence). This report is what
 * makes the switch legible after the fact and what would make a switch BACK
 * legible before it: the `Δmin` column is the point of the whole exercise, and
 * a positive number means bpmOnly chose the SHORTER season, which is exactly the
 * side effect VORP is here to remove.
 */
function reportBestSeasonMetricSets(splits, metricSets, log) {
  const names = Object.keys(metricSets);
  log(
    `\nBest season — metric sets compared (${names.join(' vs ')}):` +
      ` ${splits.length} players where they do not agree.`
  );
  const at = (d, set) => d.seasons.find(s => s.season === d.picks[set]) ?? null;
  const minutesGap = d => {
    const a = at(d, names[0]);
    const b = at(d, names[1] ?? names[0]);
    return (b?.minutes ?? 0) - (a?.minutes ?? 0);
  };
  const worst = [...splits].sort((a, b) => minutesGap(b) - minutesGap(a)).slice(0, 12);
  for (const d of worst) {
    log(
      `  ${d.name.padEnd(26)}${names.map(n => `${n} ${d.picks[n]}`).join('  ')}` +
        `   Δmin ${String(minutesGap(d)).padStart(5)}`
    );
    for (const s of d.seasons) {
      const chose = names.filter(n => d.picks[n] === s.season);
      log(
        `      ${s.season}  ${String(s.games).padStart(2)}g ${String(s.minutes).padStart(4)}m  ` +
          `BPM ${String(s.bpm).padStart(5)}  VORP ${String(s.vorp).padStart(4)}  ` +
          `WS ${String(s.ws).padStart(4)}  WS/48 ${String(s.ws48).padStart(5)}` +
          `${chose.length ? `   ← ${chose.join(', ')}` : ''}`
      );
    }
  }
}

/**
 * The same comparison for the Speed+Power composite, in printed card units.
 *
 * A metric-set difference that never changes a printed number is a difference
 * nobody needs to care about, so this reports the count that MOVE and how far,
 * not the composites themselves.
 */
function reportCompositeMetricSets(rows, sets, log) {
  const names = Object.keys(sets);
  if (names.length < 2) return;
  const [a, b] = names;
  const moved = rows.filter(r => r.totals[a] !== r.totals[b]);
  const deltas = moved.map(r => r.totals[b] - r.totals[a]);
  log(
    `  Speed+Power under ${b} instead of ${a}: ${moved.length}/${rows.length} cards move` +
      `${moved.length ? `, range ${Math.min(...deltas)} to ${Math.max(...deltas)}` : ''}`
  );
  const worst = [...moved]
    .sort((x, y) => Math.abs(y.totals[b] - y.totals[a]) - Math.abs(x.totals[b] - x.totals[a]))
    .slice(0, 6);
  for (const r of worst) {
    log(
      `    ${r.name.padEnd(26)}${r.season}  ${String(r.minutes).padStart(4)}m  ` +
        `${a} ${r.totals[a]} → ${b} ${r.totals[b]}`
    );
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
