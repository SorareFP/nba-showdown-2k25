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
// It used to. 140 players are known to have just had the best season of their
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
// player is therefore super-season-excluded too (33 of 33) — which is precisely
// why ROOKIE outranks SUPER SEASON in badges.js. The overlap set is not a mixed
// bag that needed a tie-break; it is the rookies, and calling a one-season
// career's only season his best one tells a reader nothing.
//
// The data below records BOTH badges for those 33 regardless — the file says
// what is TRUE, badges.js decides what PRINTS — which is what made that
// reprioritisation a one-line change needing no new run of this script. The
// counts it reports do change, because they are computed through pickBadge.
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
import { computeStatBands, delayFloor, delayUpperBands, usageAccessShift } from './bands.js';
import { historicalTeamDefense, loadSeasonRealGames } from './realGames.js';
import { reconcileBandsByRoll, shapeChart } from './generate.js';
import * as V from './variance.js';
import * as A from './attributes.js';
import * as PV from './playValue.js';
import * as S from './shooting.js';
import { CALIBRATION_FILE } from './calibrateAttributes.js';
import { indexBiometrics, loadBiometrics } from './biometrics.js';
import { indexPositionShares, loadPositionShares } from './positionShares.js';
import { loadLeagueRows, pickCareer } from './standoutSuperSeasons.js';
import { readSummerStandouts, buildApiEpmIndex, buildBpmBridge, buildFtLineBridge, loadFullSeasonTables, loadRimProfiles } from './summerStandouts.js';
import { readLegends } from './legends.js';
import { PRINTED_SCALE, REFINEMENT_WEIGHT, mapToReferenceScale } from './speedPower.js';
import { archiveBasis, collectRows, requireArchive } from './epmArchive.js';
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
  SUPER_SEASON_MIN_SALARY,
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
/**
 * The reason a Super Season pick is dropped because the player's CURRENT card
 * is at least as strong. Its own string, not the metric-detected one, so the
 * report and the tests can tell the two apart — but the same badge and the
 * same list, because the consequence is identical: the fact prints on the
 * base card.
 */
export const BEATEN_BY_BASE = 'best season is the current one — its card is stronger';

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
  // FALLS BACK TO THE MOST RECENT SEASON A PLAYER HAS, because the pool now
  // contains men with no current-season row at all: the carried-forward
  // players (Haliburton, Irving, Lillard, VanVleet) sat out entirely and are
  // carded from their last healthy year. They have full careers in the archive,
  // so the id is there — just not under this season. Without the fallback they
  // resolve to nothing and every downstream set reports them as unaccounted.
  const latest = new Map();
  for (const row of rows) {
    const key = normalizeName(row.name);
    if (row.season === season) {
      const prev = current.get(key);
      if (!prev || (row.games ?? 0) > (prev.games ?? 0)) current.set(key, row);
    }
    const seen = latest.get(key);
    if (!seen || row.season > seen.season) latest.set(key, row);
  }
  const ids = new Map();
  const missing = [];
  for (const p of pool) {
    const key = normalizeName(p.name);
    const hit = current.get(key) ?? latest.get(key);
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
 * The same bar, for a PLAYOFF-ONLY sample.
 *
 * A playoff run maxes out around 28 possible games — a third of a season — so
 * holding it to 1500 minutes shrinks every run toward replacement no matter
 * how deep it went: Kevin Durant's 2017 (533 minutes of +6.72 EPM through a
 * 16-1 postseason) came out 64% replacement and the whole Summer Standouts
 * set printed low Speed+Power. 750 is 20 games at hard starter minutes — a
 * sample only a deep run can produce, which is the only kind the set cards —
 * and the roster rule (Game 6 of the Conference Finals or later) already
 * guarantees the games are there. Short benches still shrink: 415 bench
 * minutes is 55% trust, not full.
 */
export const FULL_PLAYOFF_MINUTES = 750;

/**
 * ── THE SPEED+POWER COMPOSITE IS THE BASE SET'S, ON THE BASE SET'S DATA ─────
 *
 * It used to be a BPM STAND-IN, and the reason it was is now gone. The header
 * still records the substitution table because Def Boost and Paint Boost are
 * still standing in; Speed+Power no longer is. dunksandthrees' `season-epm`
 * serves 2002-2026, every Super Season and every Rookie season selected falls
 * inside that window (2009-2025 and 2004-2025 respectively), and so these cards
 * are now priced on THE SAME TWO NUMBERS a 2026-27 card is priced on:
 *
 *     composite = z(EPM) + 0.35 * z(EW/GP)
 *
 * with the z-scores taken against the 7,773-season archive rather than against
 * anybody's pool. See scripts/cardgen/epmArchive.js. That is the whole of the
 * user's "use it across all years and distribute power/speed based on the entire
 * data set", applied to the sets that are literally made of other years.
 *
 * WHAT THIS REPLACED, kept here because the old argument is still the reason the
 * shape of the composite is what it is: the stand-in was `z(BPM) + 0.35 *
 * z(VORP per game)`. BPM stood in for EPM and VORP per game for Estimated Wins
 * per game — VORP being BPM above replacement times minutes share, which is what
 * EW/GP is to EPM. (Win Shares per game filled that slot before VORP and was
 * removed: it is derived from a TEAM's win total, so it re-imported exactly the
 * team-quality bias the best-season rule had just been cleared of.) BPM and EPM
 * correlate 0.708 across the 15,219 player-seasons where both exist, which is
 * the size of the improvement this change buys.
 *
 * THE BEST-SEASON SELECTION IS STILL MADE ON BPM AND VORP, deliberately and not
 * as an oversight. Which season a player's Super Season card shows is a
 * curation decision with photographs already cropped against it; re-picking on
 * EPM would silently reshuffle the roster. So a card can now show a season that
 * is a player's best by BPM and merely his second-best by EPM. That is a real
 * inconsistency and it is the cheaper one.
 *
 * THE SHRINK BELOW IS UNCHANGED and is still doing most of the work at the thin
 * end: a season is pulled toward replacement level in proportion to how little
 * of a season it is.
 */
export const COMPOSITE_INPUTS = {
  epm: s => s.epm,
  ewinsPerGame: s => s.ewinsPerGame,
};

/**
 * What each input reads at replacement level — where a season with no minutes
 * behind it is shrunk TO.
 *
 * MEASURED, not chosen. Basketball-Reference defines replacement level as
 * -2.0 BPM and builds VORP on it, so that definition is the anchor; what these
 * two numbers are is the mean EPM and mean EW/GP of the 986 player-seasons whose
 * BPM lands within 0.25 of it, over the 15,219 seasons where the two sources
 * join. Carrying -2.0 across as if EPM and BPM were the same scale would have
 * been wrong by 0.3 of a point: EPM runs about half a point above BPM at that
 * level, and its spread is half BPM's.
 *
 * EW/GP is NOT zero at replacement, which is where the analogy with VORP breaks.
 * VORP is value ABOVE replacement and so is zero there by construction;
 * Estimated Wins is not a value-over-replacement measure, and a replacement
 * player who plays still produces a small positive number of them.
 */
export const COMPOSITE_REPLACEMENT = { epm: -1.691, ewinsPerGame: 0.0175 };

export const COMPOSITE_METRIC_SETS = {
  epmOnly: { epm: 1 },
  epmEwins: { epm: 1, ewinsPerGame: REFINEMENT_WEIGHT },
};

/** THE ACTIVE COMPOSITE. One line to change; the run report prints both. */
export const COMPOSITE_WEIGHTS = COMPOSITE_METRIC_SETS.epmEwins;

/**
 * Where a season with no minutes behind it is pulled TO.
 *
 * Kept as its own export because the shrink's whole argument is about this
 * number: shrinking toward the POOL MEAN instead — the obvious alternative —
 * would be wrong at both ends. It would hand a 53-minute flier an average card,
 * and it would hand a 53-minute disaster one too.
 */
export const REPLACEMENT_EPM = COMPOSITE_REPLACEMENT.epm;

/**
 * The composite for one season, shrunk for how much season is behind it.
 *
 * The z-scores are taken against the ARCHIVE's mean and spread, passed in, so a
 * historical season's composite is directly comparable with a 2026-27 card's —
 * and with a 1997 WNBA card's, which reaches the same scale by a different
 * route. The shrink is applied on top, toward the replacement composite.
 */
export function historicalComposite(season, basis, weights = COMPOSITE_WEIGHTS) {
  let raw = 0;
  let replacement = 0;
  for (const [key, w] of Object.entries(weights)) {
    raw += w * z(COMPOSITE_INPUTS[key](season), basis[key]);
    replacement += w * z(COMPOSITE_REPLACEMENT[key], basis[key]);
  }
  // A season with no plus/minus estimate at all carries no evidence, so it is
  // priced at replacement outright rather than at whatever a z-score of a null
  // rounds to. One rookie season in 317 is in this state — see EPM_JOIN below.
  const rated = Number.isFinite(COMPOSITE_INPUTS.epm(season));
  // A playoff-only stat line is measured against what a playoff sample CAN be,
  // not against an 82-game season — see FULL_PLAYOFF_MINUTES.
  const fullMinutes = season.playoffRun ? FULL_PLAYOFF_MINUTES : FULL_SEASON_MINUTES;
  // `trustMinutes` when the stat line is a SLICE of a larger body of evidence:
  // a TRADED card's chart is the stint's, but the skill estimate behind its
  // Speed+Power is the player's whole season — Rasheed Wallace's one game as
  // a Hawk is still played by the 2003-04 Rasheed Wallace.
  const evidence = season.trustMinutes ?? season.minutes ?? 0;
  const trust = rated ? Math.min(Math.max(evidence / fullMinutes, 0), 1) : 0;
  return trust * raw + (1 - trust) * replacement;
}

/**
 * Every season's Speed+Power total on the printed scale.
 *
 * NO `cut` AND NO CURRENT POOL. Both used to be arguments, because the map was
 * fitted to the 2026-27 pool and then applied to the history; it is now fitted
 * to the archive, which contains both and is a property of neither. What the
 * current pool still calibrates is the SHOOTING layer, which is why `buildSet`
 * still assembles a combined list.
 */
export function speedPowerTotals(seasons, { archive, weights = COMPOSITE_WEIGHTS } = {}) {
  const basis = archiveBasis(archive);
  const composites = seasons.map(s => historicalComposite(s, basis, weights));
  return mapToReferenceScale(composites, PRINTED_SCALE, { calibrateOn: archive.composites });
}

/**
 * EPM AND ESTIMATED WINS FOR ONE ARCHIVED SEASON, joined by name and year.
 *
 * The two sources spell a handful of players differently, and every difference
 * is the same kind: dunksandthrees carries the registered name where
 * Basketball-Reference carries the one on the jersey. Listed rather than
 * fuzzy-matched, because a fuzzy match between two 12,000-row tables is how a
 * father gets his son's card.
 */
export const EPM_NAME_ALIASES = {
  'Alex Sarr': 'Alexandre Sarr',
  'Bub Carrington': 'Carlton Carrington',
  'Nic Claxton': 'Nicolas Claxton',
  'Ron Holland': 'Ronald Holland II',
};

/** `name|season` -> the pooled regular-season-plus-playoffs row. */
export function indexEpmSeasons(rows) {
  const index = new Map();
  for (const r of rows ?? []) {
    if (!Number.isFinite(r?.epm)) continue;
    const key = `${normalizeName(r.name)}|${r.season}`;
    const prev = index.get(key);
    if (!prev || (r.games ?? 0) > (prev.games ?? 0)) index.set(key, r);
  }
  return index;
}

/**
 * Attaches EPM and EW/GP to each selection's season.
 *
 * Returns the unmatched list too, and the caller prints it: the ONE season that
 * legitimately has no EPM row is Jordan Goodwin's 2021-22, two NBA games in a
 * G-League year, which dunksandthrees rates as null. A second name appearing on
 * that list means a spelling has drifted, not that the archive has a hole.
 */
export function attachEpm(selections, index) {
  const unmatched = [];
  const attached = selections.map(sel => {
    const name = sel.player.name;
    const key = n => `${normalizeName(n)}|${sel.season.season}`;
    const row = index.get(key(EPM_NAME_ALIASES[name] ?? name)) ?? index.get(key(name)) ?? null;
    if (!row) unmatched.push(`${name} ${sel.season.season}`);
    return {
      ...sel,
      season: { ...sel.season, epm: row?.epm ?? null, ewinsPerGame: row?.ewinsPerGame ?? null },
    };
  });
  return { selections: attached, unmatched };
}

/**
 * Lazily built FT->TS bridge for the pre-dunksandthrees seasons — see
 * buildFtLineBridge in summerStandouts.js and the user's rule it encodes.
 */
let ftLineBridge = null;
const ftBridge = () => {
  if (!ftLineBridge) ftLineBridge = buildFtLineBridge();
  return ftLineBridge;
};

/** The season dunksandthrees' tables begin; earlier lines ride FT% touch. */
export const FIRST_DNT_SEASON = 2002;

/** The shooting inputs one archived season contributes. */
export function historicalShootingInput(season) {
  // THE WEAKEST SUBSTITUTION IN THE FILE, RETIRED WHERE THE DATA EXISTS.
  // 2P% blends the rim with the midrange, understating exactly the
  // rim-finishing bigs the Paint Boost exists to mark. Basketball-Reference's
  // shooting tables carry the real thing back to 1996-97 — share of attempts
  // at 0-3 feet and FG% there — and the enrichment pass in main() joins them
  // onto every selection as `rimPct`/`rimShare`. 2P% remains only for seasons
  // the table predates (1993-1996) and the WNBA, whose page has no split.
  const rimBased = Number.isFinite(season.rimPct) && Number.isFinite(season.rimShare);
  // PRE-DUNKSANDTHREES SEASONS TAKE THEIR LINE FROM FREE-THROW TOUCH — the
  // user's rule for the players the modern data never saw. The bridge keeps
  // the scale honest; TS% still carries every 2002+ season.
  const preDnt = (season.season ?? FIRST_DNT_SEASON) < FIRST_DNT_SEASON;
  const lineSignal = preDnt && Number.isFinite(season.ftPct)
    ? ftBridge().tsFromFt(season.ftPct)
    : season.tsPct ?? null;
  return {
    tsPct: lineSignal,
    paintPct: rimBased ? season.rimPct : season.fgPct2 ?? null,
    threePct: season.fgPct3 ?? null,
    paintAttempts: rimBased
      ? S.attemptsFromPer100((season.fga100 ?? 0) * season.rimShare, season.minutes)
      : S.attemptsFromPer100(season.fg2a100, season.minutes),
    threeAttempts: S.attemptsFromPer100(season.fg3a100, season.minutes),
    // Attempts per 100 — the signal for whether he shoots threes at all.
    threeRate: season.fg3a100 ?? 0,
    // And whether he gets to the rim at all — the paint line's volume prior.
    paintRate: rimBased ? (season.fga100 ?? 0) * season.rimShare : season.fg2a100 ?? 0,
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
export function buildHistoricalCard({
  player,
  season,
  shooting,
  speedPowerTotal,
  size,
  positionShares,
  calibration,
  // The season's real game-log rows (realGames.js), already adjusted. When
  // present they replace the synthetic distribution; the trust floor and
  // usage gate downstream apply to both paths alike.
  realGames = null,
}) {
  const games = season.games ?? 0;
  const mpg = games > 0 ? (season.minutes ?? 0) / games : 0;
  // ── THE STAT LINE IS TRUSTED THE WAY THE SKILL IS ─────────────────────────
  //
  // A 115-minute rookie year (Danny Green's) or an 11-minute fallback Super
  // Season (Quenton Jackson's, priced 400 before this) carries a per-100 line
  // made of garbage time, and the chart synthesized from it prints noise at
  // full price. So the chart inputs shrink toward a MEASURED fringe prior by
  // the same trust curve Speed+Power already rides: minutes over the full-
  // season bar (or the playoff bar on a playoff run). A full season is
  // untouched; Green's 115 minutes keep 7.7% of their own rate.
  //
  // The prior is the median per-100 line of the 2,025 player-seasons between
  // 100 and 600 minutes across 2015-2026 — what a fringe player's rate
  // actually looks like — not a number anyone liked.
  const CHART_PRIOR_PER100 = { pts: 17.4, reb: 8.1, ast: 3.3 };
  const chartTrust = Math.min(
    Math.max((season.minutes ?? 0) / (season.playoffRun ? FULL_PLAYOFF_MINUTES : FULL_SEASON_MINUTES), 0),
    1
  );
  const shrink = (own, prior) => chartTrust * (own ?? 0) + (1 - chartTrust) * prior;
  const per100 = {
    pts: shrink(season.pts100, CHART_PRIOR_PER100.pts),
    reb: shrink(season.trb100, CHART_PRIOR_PER100.reb),
    ast: shrink(season.ast100, CHART_PRIOR_PER100.ast),
  };
  // The positional MIX sets the centre and SIZE bends it, exactly as in
  // generateCards.js. Both tables reach back past 2004 — biometrics to 2002,
  // the play-by-play position estimates to 1997 — so a historical card is
  // measured the same way a current one is, and THE SHARES ARE THIS SEASON'S:
  // a Super Season card shows the role he played that year, not the one he
  // plays now. A player either table misses falls back a step.
  const { speed, power } = A.splitFromCalibration(speedPowerTotal, {
    pos: season.pos,
    size,
    positionShares,
    calibration,
  });
  const { shotLine, paintBoost, threePtBoost } = shooting;
  // DBPM in DEF EPM's place — the same rounding rule on the same kind of number.
  const defBoost = A.defBoostFromEpm(season.dbpm);

  const bands = {};
  for (const stat of V.CHART_STATS) {
    const fit = { level: calibration.chart.levels[stat], shape: calibration.chart.shape };
    const placedBands = computeStatBands(
      realGames ?? V.synthesizeGames({
        per100: { [stat]: per100[stat] },
        mpg,
        games,
        fit,
        // The shot profile, for the points event model. Without it points fall
        // back to a single Poisson on a league-typical two-point event, which
        // is what these sets were silently getting while the base set had the
        // real 2s / 3s / free-throw convolution. Basketball-Reference's
        // per-possession table carries every term.
        mix: {
          fga2: season.fg2a100,
          fga3: season.fg3a100,
          fta: season.fta100,
          pct2: season.fgPct2,
          pct3: season.fgPct3,
          pctFt: season.ftPct,
        },
      }),
      stat
    );
    // The usage gate touches the SCORING spine only; boards and assists are
    // read from their own ungated layouts by reconcileBandsByRoll — and every
    // stat's floor is delayed by the evidence the season lacks (delayFloor):
    // a 115-minute rookie prints zeroes where a full season prints points.
    const floored = delayFloor(placedBands, chartTrust);
    bands[stat] = stat === 'pts'
      ? delayUpperBands(floored, usageAccessShift(season.usgPct))
      : floored;
  }
  const chart = shapeChart(reconcileBandsByRoll(bands), { shotLine });

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
    // Since the real-log rebuild, per-card `provisional` means exactly what
    // it means on the base set: the chart is synthetic. The SET-level flag
    // stays true regardless — rim FG% is still absent from the shooting layer.
    provisional: !realGames,
  };

  // Salary is NOT set here. Play value is measured against a FIELD, so it is
  // filled in as a post-pass once every card exists — see priceCardsInPlace.
  return card;
}

/**
 * Builds one set from a list of `{ player, season }` selections.
 *
 * `currentRows` is the CURRENT pool's own season, and it is still not optional
 * — but it now calibrates ONE of the two pool-relative layers rather than both.
 * The shooting compression is measured over `[...current, ...selected]` and the
 * historical tail sliced back out, exactly as before. THE SPEED+POWER MAP NO
 * LONGER USES IT: it calibrates on the 2002-2026 archive, which is a property of
 * no pool at all. See speedPowerTotals.
 */
// ── Era: a season's three-point percentage in the base season's terms ───────
//
// A special set's three line is measured on the BASE set's scale (see
// `three.referenceCount` in shooting.js), and that scale was fitted on 2025-26
// shooting. A 1998 season's .340 was a league-average three in a .344 league
// and would read as below average in a .359 one, so each season's 3P% is
// shifted by the gap between its league's attempt-weighted mean and the base
// season's, both read from the cached Basketball-Reference per-100 tables. The
// shift is zero for a season whose table is not cached — and for the base
// season itself, which is where it should be.
const leagueThreeCache = new Map();

export function leagueThreePct(season) {
  if (leagueThreeCache.has(season)) return leagueThreeCache.get(season);
  const rows = readCache(`bbref-${season}-perPoss-full`) ?? readCache(`bbref-${season}-perPoss`);
  let num = 0;
  let den = 0;
  for (const r of rows ?? []) {
    const attempts = (r.fg3a100 ?? 0) * (r.minutes ?? 0);
    if (!(attempts > 0) || !Number.isFinite(r.fgPct3)) continue;
    num += r.fgPct3 * attempts;
    den += attempts;
  }
  const mean = den > 0 ? num / den : null;
  leagueThreeCache.set(season, mean);
  return mean;
}

// The same idea for overall efficiency. League TS% moved from .52-.53 in the
// 1990s-2000s to .58 in 2025-26 (mostly the three), so a season's TS% is
// shifted by the gap between its league's mean and the base season's before
// it meets the base set's Shot Line map. The shift is applied to the paint
// percentage too, so a player's own paint-versus-overall GAP — which is what
// the Paint Boost reads — is exactly what it was.
const leagueTsCache = new Map();

export function leagueTsPct(season) {
  if (leagueTsCache.has(season)) return leagueTsCache.get(season);
  const rows = readCache(`bbref-${season}-perPoss-full`) ?? readCache(`bbref-${season}-perPoss`);
  let pts = 0;
  let tsa = 0;
  for (const r of rows ?? []) {
    const w = r.minutes || 0;
    if (!(w > 0)) continue;
    pts += (r.pts100 || 0) * w;
    tsa += ((r.fga100 || 0) + 0.44 * (r.fta100 || 0)) * w;
  }
  const mean = tsa > 0 ? pts / (2 * tsa) : null;
  leagueTsCache.set(season, mean);
  return mean;
}

// THE PAINT LINE'S ERA AND SOURCE BRIDGE (2026-09-09). The paint line is
// absolute now (shooting.js): a rim percentage, not a gap from the Shot Line.
// That exposes three offsets the gap used to hide. Basketball-Reference's
// 0-3 ft percentage runs 5.7 points ABOVE dunksandthrees' rim zone on the
// same 2025-26 players (69.2 against 63.4, r = 0.88); the league's rim
// percentage moved from .589 in 2004-05 to .698 in 2025-26 on the
// Basketball-Reference scale; and seasons before the 1996-97 shooting table
// (and every WNBA row) carry only 2P%, which at .50 is not a rim percentage
// at all — David Robinson 1993-94 printed an 18 (15%) on it. So every season
// is expressed as a DEVIATION FROM ITS OWN LEAGUE and re-attached to the base
// season's rim mean: `base + (rimPct - leagueRimPct(season))`, or
// `base + (fgPct2 - leagueTwoPct(season))` where there is no split — the
// 2P%-to-rim slope is about 1 across eras (1.11, 1.17, 0.86, 0.78 for 1998,
// 2005, 2015, 2026; r 0.64-0.72), so the deviation carries over at face value.
const leagueRimCache = new Map();

/**
 * The league's attempt-weighted rim (0-3 ft) FG% that season, from the
 * shooting table; null before 1996-97. `kind` is 'shooting' or
 * 'playoffShooting' — a playoff run's rim percentage is read against the
 * PLAYOFF league, where finishing is harder, or every Summer Standout would
 * print a step worse than the same finishing earns in a regular season.
 */
export function leagueRimPct(season, kind = 'shooting') {
  const cacheKey = `${season}|${kind}`;
  if (leagueRimCache.has(cacheKey)) return leagueRimCache.get(cacheKey);
  const raw = readCache(`bbref-${season}-${kind}-full`) ?? readCache(`bbref-${season}-${kind}`);
  const rows = Array.isArray(raw) ? raw : raw?.data ?? [];
  let num = 0;
  let den = 0;
  for (const r of rows) {
    // Stint rows and the player's own total both appear; the total is the one
    // flagged as a multi-team row, so weight only rows that are not duplicates
    // of a total. Simpler and close enough: weight every row — a stint's
    // minutes and its total's minutes both describe the same shots, and the
    // league mean is a ratio, so double counting a traded player cancels.
    const w = (r.minutes ?? 0) * (r.rimShare ?? 0);
    if (!(w > 0) || !Number.isFinite(r.rimPct)) continue;
    num += r.rimPct * w;
    den += w;
  }
  const mean = den > 0 ? num / den : null;
  leagueRimCache.set(cacheKey, mean);
  return mean;
}

const leagueTwoCache = new Map();

/** The league's attempt-weighted 2P% that season, from the per-100 table ('perPoss' or 'playoffPerPoss'). */
export function leagueTwoPct(season, kind = 'perPoss') {
  const cacheKey = `${season}|${kind}`;
  if (leagueTwoCache.has(cacheKey)) return leagueTwoCache.get(cacheKey);
  const rows = readCache(`bbref-${season}-${kind}-full`) ?? readCache(`bbref-${season}-${kind}`);
  let num = 0;
  let den = 0;
  for (const r of rows ?? []) {
    const attempts = (r.fg2a100 ?? 0) * (r.minutes ?? 0);
    if (!(attempts > 0) || !Number.isFinite(r.fgPct2)) continue;
    num += r.fgPct2 * attempts;
    den += attempts;
  }
  const mean = den > 0 ? num / den : null;
  leagueTwoCache.set(cacheKey, mean);
  return mean;
}

// ── THE RIM PROFILE JOIN, FOR EVERY CALLER ───────────────────────────────────
//
// generateSpecialSets' own main() joined the 0-3 ft split onto its selections
// AND its calibration rows, and said why: "enriching only the selections put
// every historical card atop a 2P%-centred pool". The other buildSet callers
// (Summer Standouts, Dissonance, Team Rewards, the capstones) never did, so
// their reference rows carried 2P% while their seasons carried rim FG%, and
// with an absolute paint line that mis-centred every card they built: Dwight
// Howard's 2020-21 stint, .665 at the rim, printed a 16. The join lives here
// now and buildSet runs it over both halves of its pool, so no caller can
// forget it. Rows that already carry the split (a playoff run joined from
// the playoff table) are left alone.
const rimProfileCache = new Map();

/** playerId -> { rimPct, rimShare } for one season's regular-season shooting table; the multi-team total wins. */
export function rimProfilesFor(season) {
  if (rimProfileCache.has(season)) return rimProfileCache.get(season);
  const raw = readCache(`bbref-${season}-shooting-full`) ?? readCache(`bbref-${season}-shooting`);
  const rows = Array.isArray(raw) ? raw : raw?.data ?? [];
  const out = new Map();
  for (const r of rows) {
    if (!r?.playerId || !Number.isFinite(r.rimPct) || !Number.isFinite(r.rimShare)) continue;
    const have = out.get(r.playerId);
    const total = /TM$/.test(r.team ?? '');
    if (!have || total || (!have.total && (r.minutes ?? 0) > (have.minutes ?? 0))) {
      out.set(r.playerId, { rimPct: r.rimPct, rimShare: r.rimShare, minutes: r.minutes, total });
    }
  }
  rimProfileCache.set(season, out);
  return out;
}

/** Fill rimPct/rimShare on rows that lack them, from their own season's table. Mutates, like the original join. */
export function joinRimProfiles(rows, { season: fallbackSeason = LAST_SEASON } = {}) {
  let joined = 0;
  for (const row of rows) {
    if (!row || row.playoffRun) continue;
    if (Number.isFinite(row.rimPct) && Number.isFinite(row.rimShare)) continue;
    const season = row.season ?? fallbackSeason;
    const rim = rimProfilesFor(season).get(row.playerId);
    if (!rim) continue;
    row.rimPct = rim.rimPct;
    row.rimShare = rim.rimShare;
    joined += 1;
  }
  return joined;
}

/** The share of a two-point attempt that is a rim attempt, league-wide, where the table exists; a 1990s-shaped default before it. */
const RIM_SHARE_OF_TWOS_DEFAULT = 0.45;

/**
 * A season's paint inputs on the base season's rim scale. `baseRimMean` is
 * the attempt-weighted rim FG% of the base rows in THEIR source. Returns the
 * input untouched when the season's league mean is unknown.
 */
export function paintOnBaseScale(input, seasonRow, seasonYear, baseRimMean) {
  if (!Number.isFinite(baseRimMean) || !seasonRow) return input;
  const rimBased = Number.isFinite(seasonRow.rimPct) && Number.isFinite(seasonRow.rimShare);
  const playoffs = !!seasonRow.playoffRun;
  const first = (...xs) => xs.find(Number.isFinite);
  if (rimBased) {
    // A row that names its own league (a dunksandthrees playoff run) is read
    // against that; otherwise the Basketball-Reference table of its kind,
    // falling back to the regular season when the playoff table is not cached.
    const league = first(
      seasonRow.rimLeaguePct,
      playoffs ? leagueRimPct(seasonYear, 'playoffShooting') : null,
      leagueRimPct(seasonYear)
    );
    if (!Number.isFinite(league)) return input;
    return { ...input, paintPct: baseRimMean + (seasonRow.rimPct - league) };
  }
  if (!Number.isFinite(seasonRow.fgPct2)) return input;
  const league = first(
    seasonRow.twoLeaguePct,
    playoffs ? leagueTwoPct(seasonYear, 'playoffPerPoss') : null,
    leagueTwoPct(seasonYear)
  );
  if (!Number.isFinite(league)) return input;
  // 2P% deviation stands in for rim deviation (slope ~1, see above). The
  // attempt count and rate are ALL twos, so they are scaled to the rim share
  // of twos before they feed the shrinkage gate and its volume prior.
  return {
    ...input,
    paintPct: baseRimMean + (seasonRow.fgPct2 - league),
    paintAttempts: (input.paintAttempts ?? 0) * RIM_SHARE_OF_TWOS_DEFAULT,
    paintRate: (input.paintRate ?? 0) * RIM_SHARE_OF_TWOS_DEFAULT,
  };
}

export function eraTsOffset(season, base = LAST_SEASON) {
  const to = leagueTsPct(base);
  const from = leagueTsPct(season);
  return Number.isFinite(to) && Number.isFinite(from) ? to - from : 0;
}

export function eraThreeOffset(season, base = LAST_SEASON) {
  const to = leagueThreePct(base);
  const from = leagueThreePct(season);
  return Number.isFinite(to) && Number.isFinite(from) ? to - from : 0;
}

export function buildSet({
  selections,
  currentRows,
  calibration,
  archive = requireArchive(),
  weights = COMPOSITE_WEIGHTS,
  biometrics = new Map(),
  positionShares = null,
  // Real game logs, on by default: every selection whose (playerId, season)
  // page is cached gets its chart cut from the ACTUAL games of that season —
  // the playoff run alone when the season is a playoffRun selection. The
  // Dissonance set opts out: its cards are STINTS, and a full-season log
  // would contradict the stat line the stint rows define.
  useRealGames = true,
  // How a season's 3P% is moved onto the base season's league. A caller whose
  // seasons are another league's passes its own, or `() => 0`.
  eraThreeOffset: eraOffset = eraThreeOffset,
  eraTsOffset: tsOffset = eraTsOffset,
}) {
  const seasons = selections.map(s => s.season);
  // Every row carries the 0-3 ft split it can have before the shooting layer
  // sees the pool — see joinRimProfiles for why this cannot be left to callers.
  joinRimProfiles(currentRows, { season: LAST_SEASON });
  joinRimProfiles(seasons);
  const all = [...currentRows, ...seasons];
  const cut = currentRows.length;

  // Same jump-shooting / rim-points basis the base set uses (shooting.js
  // header). The historical rows carry Basketball-Reference's shape, so rim
  // and midrange are derived inside deriveShootingBasis; a season too old for
  // the shooting table returns null here and keeps its existing TS% signal,
  // including the pre-2002 free-throw bridge.
  const basis = S.deriveShootingBasis(all);
  const shift = (v, d) => (Number.isFinite(v) ? v + d : v);
  const rawInputs = all.map(historicalShootingInput);
  // The base rows' rim mean in THEIR source (dunksandthrees' zone) — what every
  // season's finishing is re-attached to. See paintOnBaseScale.
  const baseRimMean = (() => {
    let num = 0;
    let den = 0;
    for (let i = 0; i < cut; i += 1) {
      const pct = basis.rimPct[i] ?? rawInputs[i].paintPct;
      const w = rawInputs[i].paintAttempts ?? 0;
      if (!Number.isFinite(pct) || !(w > 0)) continue;
      num += pct * w;
      den += w;
    }
    return den > 0 ? num / den : null;
  })();
  const shootingInputs = rawInputs.map((input, i) => {
    // The seasons' percentages in the base season's terms; the base rows are
    // already there. TS% moves by the league TS gap; 3P% by its own league
    // gap; the rim percentage is re-attached to the base rows' rim mean as a
    // deviation from its own league (paintOnBaseScale), which covers the
    // era, the source and the seasons that only have 2P% in one move.
    const season = i >= cut ? seasons[i - cut].season : null;
    const ts = season != null ? tsOffset(season) : 0;
    const withBasis = {
      ...input,
      tsPct: shift(basis.shootingPct[i] ?? input.tsPct, ts),
      paintPct: basis.rimPct[i] ?? input.paintPct,
      paintRate: basis.rimRate[i] ?? input.paintRate,
      threePct: season != null ? shift(input.threePct, eraOffset(season)) : input.threePct,
    };
    return season != null ? paintOnBaseScale(withBasis, all[i], season, baseRimMean) : withBasis;
  });
  const shooting = S.buildShootingLayer(shootingInputs, {
    shotLineTarget: calibration.shotLine.target,
    paint: calibration.paintBoost,
    three: calibration.threePtBoost,
    // The Shot Line and three line on the BASE rows' scale — the seasons do
    // not get to move it (see referenceCount in shooting.js).
    referenceCount: cut,
  });

  const totals = [
    ...Array(cut).fill(null),
    ...speedPowerTotals(seasons, { archive, weights }),
  ];

  const defense = useRealGames ? historicalTeamDefense() : null;

  return selections.map((selection, i) =>
    buildHistoricalCard({
      player: selection.player,
      season: selection.season,
      shooting: shooting.players[cut + i],
      speedPowerTotal: totals[cut + i],
      size: biometrics.get(normalizeName(selection.player.name)) ?? null,
      // BY ID, not by name. These sets span 2004 onwards, where six pool names
      // belong to two different players — see the header of history.js.
      positionShares:
        positionShares?.careerForId(selection.season.playerId, selection.season.season) ?? null,
      calibration,
      realGames: useRealGames
        ? loadSeasonRealGames(selection.season.playerId, selection.season.season, defense, {
            playoffOnly: Boolean(selection.season.playoffRun),
          })
        : null,
    })
  );
}

/**
 * The same selections' Speed+Power totals under EVERY declared composite, so
 * the run report can show what the alternative would have printed.
 */
export function compareComposites({
  selections,
  archive = requireArchive(),
  sets = COMPOSITE_METRIC_SETS,
}) {
  const seasons = selections.map(s => s.season);
  const byName = {};
  for (const [name, weights] of Object.entries(sets)) {
    byName[name] = speedPowerTotals(seasons, { archive, weights });
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
  // `rookie` holds the BADGE-BEARING exclusion — a player whose rookie season is
  // the current one, whose base card already IS that season. `rookieThin` holds
  // the playing-time cut, which is not a fact about the player worth printing
  // and must stay out of the badge counts.
  const excluded = { superSeason: [], rookie: [], rookieThin: [] };
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
    } else if (!rookieSeasonCounts(first)) {
      excluded.rookieThin.push({
        name: player.name,
        season: first.season,
        games: first.games ?? 0,
        mpg: first.games ? +((first.minutes ?? 0) / first.games).toFixed(1) : 0,
        reason: 'rookie season below the playing-time bar',
      });
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
 * distribution the template would not draw — which is the whole point of
 * reporting `applies` and `printed` separately. They differ first by the nested
 * overlap described in the header: 140 players are true Super Seasons and 33
 * are true rookies, but those 33 are a SUBSET, so the gold pill loses 33.
 *
 * ── AND NOW BY THE SALARY TIER, WHICH IS WHY THIS TAKES A SECOND ARGUMENT ───
 *
 * `super-season` under SUPER_SEASON_MIN_SALARY prints BEST SEASON instead (see
 * `tierBadge` in badges.js), and a base card is as subject to that as a card in
 * the Super Season set — it is the same pill, and a $10 base card wearing the
 * gold while a $10 Super Season card does not would be the rule contradicting
 * itself on the same player.
 *
 * THE SALARIES ARE NOT THIS GENERATOR'S. They live in cards-2026-27.json, which
 * belongs to generateCards.js, so they arrive as a plain lookup rather than
 * being read here — and an EMPTY lookup is a legitimate answer, not an error.
 * A checkout that has never run the other generator has no salaries to tier on,
 * and `tierBadge` treats an unknown salary as gilded, so `printed` degrades to
 * exactly the distribution it reported before the tier existed.
 */
/**
 * Does this rookie season deserve a card?
 *
 * ── THE BAR ─────────────────────────────────────────────────────────────────
 *
 * MPG >= 12, the minutes half of the 2026-27 pool rule, AND at least 20 games —
 * half that rule's games half.
 *
 * The set previously carded EVERY active player's first season with no floor at
 * all, which reached 1-game, 3-minute seasons: Max Strus on two games at 3.0
 * MPG, Jordan Goodwin the same. Those are not rookie seasons, they are
 * call-ups, and 86 of the 363 cards were of that kind.
 *
 * ── WHY THE GAMES FLOOR IS HALVED RATHER THAN FULL ──────────────────────────
 *
 * At the full 40 the set loses Joel Embiid (31 G at 25.4 MPG), Zion Williamson
 * (24 at 27.8) and Chauncey Billups (29 at 31.7) — real rookie seasons ended by
 * injury, which is exactly the case the pool's own force-include list exists to
 * rescue. Halving the games floor keeps those thirty while still refusing the
 * cameo: Julius Randle's rookie year is ONE GAME, and a minutes bar alone would
 * have kept it, because he averaged 14 minutes in it.
 *
 * So the two halves do different work. Minutes ask whether he was playing;
 * games ask whether there was a season. A card needs both to be true.
 */
export const ROOKIE_MIN_GAMES = 20;

/**
 * ── AND WHY MINUTES ARE NOW A TOTAL RATHER THAN A RATE (2026-09-07) ─────────
 *
 * The bar was 12 MINUTES A NIGHT, which a 31-game bench rookie clears without
 * having played a season: Baylor Scheierman's 384 minutes priced at $650 while
 * Brandon Ingram's 2,275 priced at $130, and across the set a rookie under 700
 * minutes beat one over 1,500 in 31% of pairings. The user: "a lot of
 * low-usage guys like Baylor Scheierman are much better than guys who actually
 * played like Brandon Ingram ... we might be able to trim some rookies based
 * on playing time."
 *
 * A TOTAL asks the question a rate cannot: how much basketball is this card
 * actually made of. 600 was chosen off the distribution — it cuts 25 cards,
 * Scheierman and Day'Ron Sharpe and Luka Garza among them, and keeps the short
 * seasons that were real, Joel Embiid's 787 minutes and Zion Williamson's 667.
 * At 700 Zion goes, at 800 Embiid goes too, and those are the cards the halved
 * games floor above exists to rescue. Jared McCain at 591 is the one honest
 * casualty.
 *
 * The games floor still does its own job — Julius Randle's one-game rookie year
 * would pass a minutes total if it were somehow long enough, and "was there a
 * season" is not the same question as "did he play".
 */
export const ROOKIE_MIN_MINUTES = 600;

export function rookieSeasonCounts(season) {
  const games = season?.games ?? 0;
  const minutes = season?.minutes ?? 0;
  if (games < ROOKIE_MIN_GAMES) return false;
  return minutes >= ROOKIE_MIN_MINUTES;
}

export function badgeCounts(baseBadges, salaries = new Map()) {
  const applies = Object.fromEntries(BADGE_IDS.map(id => [id, 0]));
  const printed = Object.fromEntries(BADGE_IDS.map(id => [id, 0]));
  let multiple = 0;
  for (const record of baseBadges) {
    for (const id of record.badges) applies[id] += 1;
    if (record.badges.length > 1) multiple += 1;
    const shown = pickBadge(record.badges, salaries.get(record.id));
    if (shown) printed[shown.id] += 1;
  }
  return { players: baseBadges.length, applies, printed, multiple };
}

/**
 * The base set's salaries, by player id, when generateCards.js has produced any.
 *
 * MISSING IS FINE and returns an empty map — see badgeCounts. This is the only
 * thing this generator reads out of the other one's output, and it reads it
 * solely to report an honest `printed` count; nothing it WRITES depends on it,
 * so the two generators stay order-independent exactly as BADGE_FILE's note
 * requires.
 */
export function loadBaseSalaries(
  file = path.join(GEN_DIR, `cards-${CURRENT_SET}.json`)
) {
  if (!fs.existsSync(file)) return new Map();
  const cards = JSON.parse(fs.readFileSync(file, 'utf8')).cards ?? [];
  return new Map(cards.filter(c => c?.id != null).map(c => [c.id, c.salary]));
}

function writeSet(file, { set, cards, meta }) {
  fs.mkdirSync(GEN_DIR, { recursive: true });
  // Priced against the BASE SET, not against this set: a 210-card best-season
  // pool standardised on its own spread would call its weakest card
  // replacement level, when every card in it is somebody's peak.
  PV.priceAgainstBase(cards, { roundSalary: A.roundSalary, min: A.SALARY_MIN, max: A.SALARY_MAX });

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
  origin:
    'basketball-reference.com season tables (advanced + per-100), 2000-2026, for the roster and ' +
    'every printed stat; dunksandthrees season-epm, 2002-2026, for the Speed+Power budget',
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
    `z(EPM) + ${REFINEMENT_WEIGHT} * z(EW per game) — the base set's own composite on the base ` +
    "set's own data, no longer a BPM stand-in: dunksandthrees' season-epm covers 2002-2026 and " +
    'every carded season falls inside it. Shrunk toward replacement level for a short season, ' +
    'then mapped onto the printed Speed+Power scale with the 2002-2026 archive of every cardable ' +
    'player-season as the calibration basis — not any one pool',
  defBoost: 'DBPM, rounded — still a stand-in, though DEF EPM now exists back to 2002 as well',
  paintBoost: '2P% standing in for rim FG%, which Basketball-Reference does not carry',
  chart: 'synthesized from Basketball-Reference per-100 PTS/TRB/AST, same model as the base set',
  missing: ['rim FG%'],
  note:
    'the best-season SELECTION is still made on BPM and VORP, so a card can show a season that ' +
    'is a player\'s best by BPM and his second-best by EPM. That is deliberate: which season a ' +
    'card shows is a curation decision with photographs cropped against it',
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

  // ── The Speed+Power inputs, which are now the base set's own ──────────────
  //
  // The absolute scale (committed) and the per-player-season EPM rows behind it
  // (cached, like bbref-history.json above). Both selections are enriched here
  // rather than inside `buildSet`, so the join is reported once and both sets
  // are demonstrably scored off the same table.
  const archive = requireArchive();
  const epmIndex = indexEpmSeasons(collectRows().rows);
  if (epmIndex.size === 0) {
    throw new Error(
      'No cached season-epm rows. Run `node --env-file=.env.local ' +
        'scripts/cardgen/epmArchive.js` first — these sets are priced on real EPM now.'
    );
  }
  log(
    `Speed+Power basis: ${archive.n} cardable player-seasons ${archive.seasons[0]}-` +
      `${archive.seasons[archive.seasons.length - 1]}; ${epmIndex.size} rated seasons to join against.`
  );
  for (const key of ['superSeason', 'rookie']) {
    const joined = attachEpm(selection[key], epmIndex);
    selection[key] = joined.selections;
    log(
      joined.unmatched.length
        ? `  ${key}: no EPM row for ${joined.unmatched.length} — ${joined.unmatched.join(', ')} ` +
            '(priced at replacement level)'
        : `  ${key}: EPM for all ${joined.selections.length}`
    );
  }

  // ── The standout Super Seasons, DISPLACING the algorithmic picks ──────────
  //
  // card-data/summer-standouts.json names the Super Seasons the conflict rule
  // kept instead of a playoff card (the calls live in
  // standout-conflict-decisions.json). Each one replaces that player's
  // algorithmic best-season pick — same set, decided season, one card per
  // player. Runs AFTER attachEpm on purpose: most of these are retirees the
  // pool-scoped EPM index has never heard of, so their EPM comes from the API
  // caches here and a later join would blank it back to replacement level.
  const standouts = readSummerStandouts();
  // One bridge for both standout blocks, built only if a pre-EPM season needs
  // it — the basis is the same absolute EPM archive everything is scored on.
  let bridgeInstance = null;
  const standoutBridge = () => {
    if (!bridgeInstance) bridgeInstance = buildBpmBridge(archiveBasis(requireArchive()));
    return bridgeInstance;
  };
  const standoutNames = Object.keys(standouts.superSeasons);
  if (standoutNames.length) {
    // From 1986: Rodman's 1991-92 and Pippen's 1993-94 live well before the
    // old 2000 default, and the 1980s tables are cached to carry them.
    const tables = loadFullSeasonTables({ first: 1986 });
    const league = loadLeagueRows();
    const apiEpm = buildApiEpmIndex();
    const displaced = [];
    const failed = [];
    for (const name of standoutNames) {
      const pick = standouts.superSeasons[name];
      const careers = league.get(normalizeName(name));
      const careerRows = pickCareer(careers, { referenceSeason: pick.season });
      const id = careerRows?.[0]?.playerId;
      const adv = tables.advanced.get(`${id}|${pick.season}`);
      const pp = tables.perPoss.get(`${id}|${pick.season}`);
      if (!adv || !pp) { failed.push(`${name} (no ${pick.season} full-table row)`); continue; }
      let epm = apiEpm.get(`${normalizeName(name)}|${pick.season}`);
      // EPM begins in 2002; Shaquille O'Neal's 1999-00 pick lands before it
      // and was being priced at replacement (Speed+Power 14 on the 2000 MVP).
      // The BPM bridge re-expresses the season in EPM units instead.
      if (!epm && Number.isFinite(adv.bpm)) {
        const bridge = standoutBridge();
        epm = {
          epm: bridge.epmFromBpm(adv.bpm),
          ewinsPerGame: bridge.ewinsPerGameFromVorp(adv.vorp, adv.games),
        };
      }
      const before = selection.superSeason.length;
      selection.superSeason = selection.superSeason.filter(
        sel => normalizeName(sel.player.name) !== normalizeName(name)
      );
      if (selection.superSeason.length < before) displaced.push(name);
      selection.superSeason.push({
        player: { name, pos: adv.pos },
        season: {
          ...adv, ...pp,
          playerId: id,
          season: pick.season,
          epm: epm?.epm ?? null,
          ewinsPerGame: epm?.ewinsPerGame ?? null,
        },
      });
    }
    if (failed.length) {
      // The list is hand-picked; an unresolvable name is a data problem to
      // fix, not a player to drop silently.
      throw new Error(['Standout Super Seasons missing rows:', ...failed].join('\n  '));
    }
    log(
      `  standout Super Seasons: ${standoutNames.length} added ` +
        `(${displaced.length} displaced an algorithmic pick: ${displaced.join(', ') || 'none'})`
    );
  }

  // ── THE LEGENDS, FORCE-INCLUDED ───────────────────────────────────────────
  //
  // Super Season is "each CURRENT-POOL player's best season", so a player who
  // retired before the 2026-27 pool has no path in at all. Eleven of the
  // shipped 2025-26 set's twenty-three retro cards were in exactly that
  // position — Jordan, Kareem, Magic, Bird, Erving, Kobe, Duncan, Nowitzki,
  // Barkley, Robinson and Hill had no card in ANY generated set. This block
  // is how they return, alongside the strongest absent players the EPM
  // archive surfaced (Kirilenko, Aldridge, Stoudemire, Stockton, Yao, Roy).
  //
  // Mechanically identical to the standout block above, with two differences:
  // the season window opens at 1977 rather than 1986 (Kareem's and Erving's
  // picks predate it), and there is nothing to displace, because none of these
  // players is in the pool to have an algorithmic pick in the first place.
  //
  // Every one of them predates or straddles the EPM archive, so the BPM
  // bridge carries the skill — the same rank-preserving z-score route the
  // WNBA sets use to cross leagues. The user accepted these may run hot
  // against modern competition.
  const legends = readLegends();
  if (legends.length) {
    const tables = loadFullSeasonTables({ first: 1977 });
    const league = loadLeagueRows();
    const apiEpm = buildApiEpmIndex();
    const failedLegends = [];
    let added = 0;
    for (const { name, season } of legends) {
      const careers = league.get(normalizeName(name));
      const careerRows = pickCareer(careers, { referenceSeason: season });
      let id = careerRows?.[0]?.playerId;
      // loadLeagueRows' window does not reach the 1970s and 80s, so Kareem's
      // 1977, Erving's 1977, Bird's 1985 and Magic's 1990 resolve to no id
      // there. The season's own advanced table does carry them — it is the
      // table the pick was chosen from — so fall back to a name match inside
      // it rather than dropping four of the eleven legends this block exists
      // for. Scoped to the one season, so it cannot pick up a namesake from
      // another era.
      if (!id) {
        for (const [key, row] of tables.advanced) {
          if (!key.endsWith(`|${season}`)) continue;
          if (normalizeName(row.name ?? '') === normalizeName(name)) { id = row.playerId; break; }
        }
      }
      const adv = tables.advanced.get(`${id}|${season}`);
      const pp = tables.perPoss.get(`${id}|${season}`);
      if (!adv || !pp) { failedLegends.push(`${name} (no ${season} full-table row)`); continue; }
      let epm = apiEpm.get(`${normalizeName(name)}|${season}`);
      if (!epm && Number.isFinite(adv.bpm)) {
        const bridge = standoutBridge();
        epm = {
          epm: bridge.epmFromBpm(adv.bpm),
          ewinsPerGame: bridge.ewinsPerGameFromVorp(adv.vorp, adv.games),
        };
      }
      // A legend already carded by the algorithm (an active player who somehow
      // matched) would double up; drop the earlier pick and keep the declared
      // season, which is the whole point of naming it.
      selection.superSeason = selection.superSeason.filter(
        sel => normalizeName(sel.player.name) !== normalizeName(name)
      );
      selection.superSeason.push({
        player: { name, pos: adv.pos },
        season: {
          ...adv, ...pp,
          playerId: id,
          season,
          epm: epm?.epm ?? null,
          ewinsPerGame: epm?.ewinsPerGame ?? null,
        },
      });
      added += 1;
    }
    if (failedLegends.length) {
      // Hand-picked list: an unresolvable name is a data problem to fix, not a
      // legend to drop silently.
      throw new Error(['Legend Super Seasons missing rows:', ...failedLegends].join('\n  '));
    }
    log(`  legends force-included: ${added} of ${legends.length}`);
  }

  // ── Rookie cards for the standout NEWCOMERS ───────────────────────────────
  //
  // "Can we also add rookie cards for all new players that don't already have
  // one?" A standout who is not a pool member has no rookie card, because the
  // rookie set is derived from the pool. The rule here: every player named in
  // card-data/summer-standouts.json (either block) who is outside the pool
  // gets his rookie season carded, PROVIDED the career's first season in the
  // full-league cache is 2002 or later — 2000/2001 first appearances are
  // indistinguishable from a career the cache window truncated (Jason Kidd
  // "debuts" in 2000 by that reading), and 2002 is also where EPM begins, so
  // earlier rookies would price at replacement. The skipped are REPORTED, not
  // dropped silently: carding them means fetching the 1990s tables first.
  {
    const standoutBlocks = readSummerStandouts();
    // ── SUFFIXES MATTER FOR THIS ONE TEST ───────────────────────────────────
    //
    // `normalizeName` strips Jr/Sr/II/III on purpose — it is built for matching
    // one source's spelling to another's. Used HERE it says Gary Payton II,
    // who has a base card, IS Gary Payton, who does not, and the elder was
    // dropped from the rookie candidates as "already carded". He is the only
    // collision in the data today, and one is enough: the question this filter
    // asks is "is this exact person already in the pool", so it keeps the
    // suffix that distinguishes them.
    const exactKey = n => String(n ?? '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z]/g, '');
    const poolNames = new Set(pool.map(pl => exactKey(pl.name)));
    // FORCED ROOKIE SEASONS (card-data/rookie-legends-2026.json): players with
    // no base card, each with the rookie season named outright — which is what
    // gets Jordan's 1984-85 past the window guard below.
    const rookieLegendsFile = path.join(REPO_ROOT, 'card-data', 'rookie-legends-2026.json');
    const rookieLegends = fs.existsSync(rookieLegendsFile)
      ? Object.entries(readJson(rookieLegendsFile)).filter(([k, v]) => !k.startsWith('_') && Number.isFinite(v?.season))
      : [];
    const forcedRookies = new Map(rookieLegends.map(([k, v]) => [normalizeName(k), v.season]));
    // ── EVERY CURATED NAME, NOT TWO OF THEM ─────────────────────────────────
    //
    // This list used to be the Summer Standouts blocks plus the forced
    // legends, and nothing else — so a player who reached the game through
    // legends-2026.json (Super Season), dissonance.json or the team rewards
    // was never even CONSIDERED for a rookie card. That is how Allen Iverson,
    // Rookie of the Year in the season this archive covers, had none: he is a
    // Dissonance pick, and Dissonance was not in the universe (the user,
    // 2026-09-07: "I see we're missing Allen Iverson. Might be missing T-Mac
    // too.").
    //
    // Everything below is only a CANDIDATE list. The playing-time bar
    // (rookieSeasonCounts) and the archive-window guard still decide, which is
    // why adding a name here cannot smuggle in a card that has not earned one.
    const curatedNames = source => {
      try {
        const file = path.join(REPO_ROOT, 'card-data', source);
        if (!fs.existsSync(file)) return [];
        const json = readJson(file);
        // `picks` for the sets that wrap their entries; the object itself for
        // the ones keyed by name at the top level.
        const block = json.picks ?? json;
        return Object.keys(block).filter(k => !k.startsWith('_') && typeof block[k] === 'object');
      } catch {
        return [];
      }
    };
    // Team rewards are keyed by FRANCHISE, so the names are one level in.
    const teamRewardNames = () => {
      try {
        const file = path.join(REPO_ROOT, 'card-data', 'team-rewards-2026.json');
        if (!fs.existsSync(file)) return [];
        return Object.values(readJson(file).picks ?? {}).map(v => v?.name).filter(Boolean);
      } catch {
        return [];
      }
    };
    const rookieNames = [...new Set([
      ...Object.keys(standoutBlocks.playoffCards ?? {}),
      ...Object.keys(standoutBlocks.superSeasons ?? {}),
      ...rookieLegends.map(([k]) => k),
      ...curatedNames('legends-2026.json'),
      ...curatedNames('dissonance.json'),
      ...teamRewardNames(),
    ])].filter(n => !poolNames.has(exactKey(n)));
    if (rookieNames.length) {
      // From 1986: the tables reach Rodman's 1986-87 and Pippen's 1987-88
      // debuts, with 1986 cached as the SENTINEL that proves a 1987 first
      // appearance is a debut and not the window's edge.
      const tables = loadFullSeasonTables({ first: 1977 });
      const league = loadLeagueRows();
      const apiEpm = buildApiEpmIndex();
      const added = [];
      const skipped = [];
      for (const name of rookieNames) {
        // The id comes from the 2000+ league rows (every standout played into
        // them); the FIRST season comes from the full tables, which reach 1992.
        const careerRows = pickCareer(league.get(normalizeName(name)), {});
        let id = careerRows?.[0]?.playerId;
        // A FORCED SEASON TRUSTS THE SEASON, NOT THE CAREER ROW.
        //
        // This used to rescue only the case where no id resolved at all. The
        // worse case is an id that resolves to the WRONG PERSON: normalizeName
        // folds "Gary Payton II" onto "Gary Payton", the career lookup returns
        // the son, and the father's 1990-91 is then looked up under the son's
        // id and missed — reported as "no 1991 full-table row" for a season
        // that is right there in the archive. So when a season is named and
        // the resolved id has no row in it, re-resolve from that season's own
        // rows. Scoped to the one named season, so it cannot reach a namesake
        // in another era.
        const forcedYear = forcedRookies.get(normalizeName(name));
        if (forcedYear != null && (!id || !tables.advanced.has(`${id}|${forcedYear}`))) {
          for (const [key, row] of tables.advanced) {
            if (key.endsWith(`|${forcedYear}`) && normalizeName(row.name ?? '') === normalizeName(name)) { id = row.playerId; break; }
          }
        }
        if (!id) { skipped.push(`${name} (no career rows)`); continue; }
        let firstSeason = forcedRookies.get(normalizeName(name)) ?? null;
        const forced = firstSeason != null;
        for (const key of forced ? [] : tables.advanced.keys()) {
          const [rowId, seasonStr] = key.split('|');
          if (rowId !== id) continue;
          const season = Number(seasonStr);
          if (firstSeason == null || season < firstSeason) firstSeason = season;
        }
        if (firstSeason == null) { skipped.push(`${name} (no full-table rows)`); continue; }
        if (!forced && firstSeason <= 1986) {
          skipped.push(`${name} (first cached season ${firstSeason} — at the window's edge, possibly truncated)`);
          continue;
        }
        const adv = tables.advanced.get(`${id}|${firstSeason}`);
        const pp = tables.perPoss.get(`${id}|${firstSeason}`);
        if (!adv || !pp) { skipped.push(`${name} (no ${firstSeason} full-table row)`); continue; }
        // THE SAME PLAYING-TIME BAR the pool players face. This path adds the
        // Summer Standouts roster, and without the check it walked straight past
        // it — nine cards survived the first cut here, Max Strus's two-game
        // rookie year among them. A rule that applies to one door and not the
        // other is not the rule, it is a coincidence.
        if (!rookieSeasonCounts(adv)) {
          skipped.push(
            `${name} (${firstSeason} rookie season below the playing-time bar: ` +
            `${adv.games ?? 0} G, ${(adv.games ? (adv.minutes ?? 0) / adv.games : 0).toFixed(1)} MPG)`
          );
          continue;
        }
        // EPM where it exists (2002+); the BPM bridge in EPM units where it
        // does not — the same bridge the pre-EPM Super Seasons cross on.
        let epm = apiEpm.get(`${normalizeName(name)}|${firstSeason}`);
        if (!epm && Number.isFinite(adv.bpm)) {
          const bridge = standoutBridge();
          epm = {
            epm: bridge.epmFromBpm(adv.bpm),
            ewinsPerGame: bridge.ewinsPerGameFromVorp(adv.vorp, adv.games),
          };
        }
        selection.rookie.push({
          player: { name, pos: adv.pos },
          season: {
            ...adv, ...pp,
            playerId: id,
            season: firstSeason,
            epm: epm?.epm ?? null,
            ewinsPerGame: epm?.ewinsPerGame ?? null,
          },
        });
        added.push(`${name} ${firstSeason}`);
      }
      log(`  standout rookies: ${added.length} added (${added.join(', ') || 'none'})`);
      if (skipped.length) {
        log(`    skipped ${skipped.length} — ${skipped.join('; ')}`);
      }
    }
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

  // Height and weight, for the size half of the Speed/Power split. The archive
  // covers 2002 onwards and these sets reach back to 2004, so coverage is
  // reported rather than assumed.
  const biometrics = indexBiometrics(loadBiometrics());
  // The five positional shares of the season each card actually shows.
  const positionShares = indexPositionShares(loadPositionShares());
  log(`Split rule: ${A.SPLIT_RULE.name} (see SPLIT_RULE in scripts/cardgen/attributes.js).`);
  // ── The rim profiles, joined onto every selection ─────────────────────────
  //
  // One map, both sets: paintPct/paintAttempts prefer the real 0-3ft numbers
  // over the 2P% substitute wherever the shooting table reaches (1997+). See
  // historicalShootingInput.
  {
    const rims = loadRimProfiles();
    let joined = 0;
    let total = 0;
    for (const key of ['superSeason', 'rookie']) {
      for (const sel of selection[key]) {
        total += 1;
        const rim = rims.get(`${sel.season.playerId}|${sel.season.season}`);
        if (!rim || !Number.isFinite(rim.rimPct)) continue;
        sel.season.rimPct = rim.rimPct;
        sel.season.rimShare = rim.rimShare;
        joined += 1;
      }
    }
    // THE CALIBRATION ROWS TOO, or the whole join mis-centres: the layer's
    // scale is built over [pool, ...selections], and rim FG% runs ~15 points
    // above the 2P% it replaces. Enriching only the selections put every
    // historical card atop a 2P%-centred pool — sixty Super Seasons printed
    // +3 while Rudy Gobert's read 0.
    let poolJoined = 0;
    for (const row of currentRows) {
      const rim = rims.get(`${row.playerId}|${row.season}`);
      if (!rim || !Number.isFinite(rim.rimPct)) continue;
      row.rimPct = rim.rimPct;
      row.rimShare = rim.rimShare;
      poolJoined += 1;
    }
    log(`  rim profiles: ${joined} of ${total} selections and ${poolJoined} of ${currentRows.length} calibration rows carry the 0-3ft split.`);
  }

  const files = {};
  const builtSets = new Map();
  for (const [set, selections] of [
    [SUPER_SEASON_SET, selection.superSeason],
    [ROOKIE_SET, selection.rookie],
  ]) {
    const cards = buildSet({ selections, currentRows, calibration, biometrics, positionShares });
    // Priced NOW rather than in writeSet alone, because the same-season rule
    // below decides on the salary: writeSet re-prices identically, so nothing
    // double-counts.
    PV.priceAgainstBase(cards, { roundSalary: A.roundSalary, min: A.SALARY_MIN, max: A.SALARY_MAX });
    builtSets.set(set, cards);
  }

  // ── ONE CARD PER PLAYER-SEASON, ACROSS THE TWO SETS ───────────────────────
  //
  // Jaylen Wells' best season IS his rookie season (2024-25), which printed
  // the same year twice — once per set. The user's rule: "If it qualifies as
  // a super season, leave it a super season and give it that formatting. If
  // it's just a best season like Wells, make it a rookie card with an
  // additional best season badge." The gold line decides, as it decides the
  // pill; the losing set records the card on its excluded list, and the
  // surviving card carries the other set's fact as a second badge.
  // NOT the exclusion lists: those mean "the fact is printed on the BASE
  // card" and feed card-badges.json. A twin's fact moves to the other SPECIAL
  // card instead, so each set records its side in `mergedIntoTwin` and the
  // base badges stay exactly what they were.
  const mergedIntoTwin = { [SUPER_SEASON_SET]: [], [ROOKIE_SET]: [] };
  {
    const ss = builtSets.get(SUPER_SEASON_SET);
    const rk = builtSets.get(ROOKIE_SET);
    const rkByKey = new Map(rk.map(c => [`${c.bbrefId}|${c.season}`, c]));
    const merged = [];
    for (const card of [...ss]) {
      const twin = rkByKey.get(`${card.bbrefId}|${card.season}`);
      if (!twin) continue;
      // Gold also demands a season the floors actually trust: Leonard
      // Miller's 53-minute rookie year priced at 960 through sheer small-
      // sample noise, and a fallback-eligible season must not claim the gold
      // form on the strength of an artifact.
      const trusted =
        (card.games ?? 0) >= BEST_SEASON_MIN_GAMES &&
        (card.games ?? 0) * (card.mpg ?? 0) >= BEST_SEASON_MIN_MINUTES;
      if (trusted && (card.salary ?? 0) >= SUPER_SEASON_MIN_SALARY) {
        rk.splice(rk.indexOf(twin), 1);
        mergedIntoTwin[ROOKIE_SET].push({
          name: card.name,
          reason: `rookie season is his Super Season — one ${card.seasonLabel} card, gold, in the Super Season set, wearing the rookie badge too`,
        });
        card.badges = ['rookie'];
        merged.push(`${card.name} (super season keeps it)`);
      } else {
        ss.splice(ss.indexOf(card), 1);
        mergedIntoTwin[SUPER_SEASON_SET].push({
          name: card.name,
          reason: `best season is his rookie season — one ${card.seasonLabel} card in the Rookie set, wearing the best-season badge too`,
        });
        twin.badges = ['best-season'];
        merged.push(`${card.name} (rookie keeps it)`);
      }
    }
    log(`  same-season twins: ${merged.length} collapsed — ${merged.join('; ') || 'none'}`);
  }

  // ── THE CARD HAS TO BEAT THE BASE CARD ────────────────────────────────────
  //
  // A best season is chosen by z-scored BPM and VORP. A card's STRENGTH is a
  // different measure entirely — what the finished chart, speed, power and
  // shot line are worth in a game — and the two can disagree, most often for
  // low-minute role players whose rate stats spike in a season that builds a
  // thin card. When they disagree the set printed a Super Season card weaker
  // than the same player's base card, which is the one thing this set may
  // never do: 38 of 233 did, Julian Strawther at $140 against a $310 base
  // card among them. The user, 2026-09-07: "Do we have Super Season cards
  // that are lower salary than the corresponding players' other cards?
  // Because we shouldn't ... thus his 25-26 season was his best season and he
  // should not have a card in the super season set."
  //
  // So the base card has the final say, and a player it beats leaves by the
  // SAME path as the metric-detected case — onto the exclusion list, with the
  // badge moving to his base card — because that is precisely what an
  // exclusion means here: the fact prints on the base card instead.
  //
  // ── THIS IS THE ONE PLACE THE TWO GENERATORS ARE ORDERED ──────────────────
  //
  // loadBaseSalaries reads generateCards.js's output, and until now nothing
  // this generator WROTE depended on it (see its note). Now the Super Season
  // roster does. A missing base file returns an empty map and drops nobody,
  // which is the old behaviour exactly; a STALE one compares against stale
  // prices, so run the base set first after any repricing.
  {
    const ss = builtSets.get(SUPER_SEASON_SET);
    const baseSalaries = loadBaseSalaries();
    const demoted = [];
    for (const card of [...ss]) {
      const base = baseSalaries.get(card.id);
      if (base == null || base < (card.salary ?? 0)) continue;
      ss.splice(ss.indexOf(card), 1);
      selection.excluded.superSeason.push({
        name: card.name,
        reason: BEATEN_BY_BASE,
        badge: EXCLUSION_BADGES.superSeason,
      });
      const record = selection.baseBadges.find(b => b.name === card.name);
      if (record) {
        record.badges = BADGE_IDS.filter(
          b => record.badges.includes(b) || b === EXCLUSION_BADGES.superSeason
        );
      } else {
        selection.baseBadges.push({
          id: playerIdFromName(card.name),
          name: card.name,
          badges: [EXCLUSION_BADGES.superSeason],
        });
      }
      demoted.push(`${card.name} ${card.seasonLabel} $${card.salary} vs base $${base}`);
    }
    selection.baseBadges.sort((a, b) => a.name.localeCompare(b.name));
    log(
      `  beaten by the base card: ${demoted.length} dropped` +
        `${demoted.length ? ` — ${demoted.join('; ')}` : ''}`
    );
  }

  for (const [set, selections, file] of [
    [SUPER_SEASON_SET, selection.superSeason, OUTPUT_FILES[SUPER_SEASON_SET]],
    [ROOKIE_SET, selection.rookie, OUTPUT_FILES[ROOKIE_SET]],
  ]) {
    const cards = builtSets.get(set);
    const noSize = selections.filter(
      sel => !biometrics.get(normalizeName(sel.player.name))
    ).length;
    const noShares = selections.filter(
      sel => !positionShares.forId(sel.season.playerId, sel.season.season)
    ).length;
    log(
      noSize
        ? `  ${set}: ${noSize} of ${selections.length} have no height/weight (unsized split)`
        : `  ${set}: height and weight for all ${selections.length}`
    );
    log(
      noShares
        ? `  ${set}: ${noShares} of ${selections.length} have no positional shares for their season (position-LABEL split)`
        : `  ${set}: positional shares for all ${selections.length}`
    );
    cards.sort((a, b) => a.name.localeCompare(b.name));
    const excluded = set === SUPER_SEASON_SET ? selection.excluded.superSeason : selection.excluded.rookie;
    // The playing-time cut rides alongside rather than inside `excluded`: that
    // list means "the fact prints on the BASE card" and feeds card-badges.json,
    // which a thin rookie season has no business doing. Written out all the
    // same, because a player who silently vanishes from a set is the thing the
    // accounting test exists to catch.
    const excludedThin = set === ROOKIE_SET ? selection.excluded.rookieThin : [];
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
        excludedThin,
        excludedThinCount: excludedThin.length,
        // The same-season twins this set ceded to the other one — a third
        // category beside carded and excluded, so the one-card-per-pool-player
        // accounting still closes. See the twin rule above.
        mergedIntoTwin: mergedIntoTwin[set],
        mergedIntoTwinCount: mergedIntoTwin[set].length,
      },
    });
    log(
      `\n${set}: ${cards.length} cards (${excluded.length} excluded — ` +
        `${set === SUPER_SEASON_SET ? 'best season is the current one' : 'rookie season is the current one'}` +
        `; each gets the ${set === SUPER_SEASON_SET ? EXCLUSION_BADGES.superSeason : EXCLUSION_BADGES.rookie} badge on their ${CURRENT_SET} card)`
    );
    reportSet(cards, log);
    reportCompositeMetricSets(
      compareComposites({ selections, archive }),
      COMPOSITE_METRIC_SETS,
      log
    );
  }

  const counts = badgeCounts(selection.baseBadges, loadBaseSalaries());
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
 * cards will actually draw it once the priority AND the salary tier have been
 * applied. They differ by the 33 players who are both, and by the Super Seasons
 * that price under SUPER_SEASON_MIN_SALARY and print BEST SEASON instead — the
 * gap is the whole reason both numbers are reported rather than one.
 *
 * `best-season` is the one row where `applies` is legitimately 0 against a
 * non-zero `printed`: no player record claims that id, because it is not a fact
 * about a player. It is what the gilded badge becomes below the line.
 */
function reportBadges(c, log) {
  log(`\n${CURRENT_SET} badges: ${c.players} of the pool carry at least one.`);
  for (const id of BADGE_IDS) {
    const lost = c.applies[id] - c.printed[id];
    log(
      `  ${id.padEnd(14)}applies to ${String(c.applies[id]).padStart(3)}` +
        `   prints on ${String(c.printed[id]).padStart(3)}` +
        `${lost > 0 ? `   (${lost} outranked or under $${SUPER_SEASON_MIN_SALARY})` : ''}`
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
