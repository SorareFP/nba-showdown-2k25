// Who could be a team's completion reward, and what would their card be worth.
//
//   node scripts/cardgen/teamRewardCandidates.js            # every franchise
//   node scripts/cardgen/teamRewardCandidates.js OKC LAL    # just these
//
// ── WHY THIS IS A SCRIPT NOW ────────────────────────────────────────────────
//
// The original thirty picks were found by an ad-hoc query that was never saved,
// which was fine while every franchise wanted the same thing — one rare-band
// player — and became a problem the moment the rewards were laddered by
// difficulty. Re-picking twenty franchises into two new salary bands is not a
// job to do from memory, and the next re-pick should not have to reinvent it.
//
// ── THE ONE RULE THAT MATTERS ───────────────────────────────────────────────
//
// A candidate is priced THROUGH THE REAL PIPELINE — same buildSet, same
// priceAgainstBase. Estimating from EPM was tried and does not work: role and
// minutes drive play value as hard as efficiency does, so an EPM ranking and a
// salary ranking disagree constantly.
//
// TWO PASSES, AND THE FIRST ONE IS NOT THE ANSWER.
//
//   node scripts/cardgen/teamRewardCandidates.js            # per-100, all 3,148
//   node scripts/cardgen/fetchTeamRewardCandidateLogs.mjs   # logs for the top 30/team
//   node scripts/cardgen/teamRewardCandidates.js --real     # real logs, shortlist only
//
// The default pass prices from per-100 season rates because fetching a game log
// for three thousand candidates is not a thing to do. That is a RANKING, not an
// estimate: measured on 29 paired picks it correlates with the real-log price at
// r = 0.86, fitting `real ~= 104 + 0.621 x per100` with a residual sd of ~$103.
// So it says which thirty seasons a franchise should consider and it does not
// say which band one lands in — the slope alone means a per-100 number is about
// 60% too high, and the rewards shipped ~$300-450 over on exactly that error.
//
// `--real` re-prices the shortlist with `useRealGames: true`, which is how the
// cards are actually built. It DROPS any candidate whose log is not cached
// rather than letting it fall back to rates, because a batch that mixes the two
// paths is a batch where half the prices are 60% high and nothing says which.
//
// Even then the generator is the authority: the shooting layer assigns shot
// lines by percentile within the array it is handed, so a 900-card shortlist and
// a 33-card set differ by up to about $70. It asserts the band and fails loudly.
//
// The prefilter is therefore deliberately loose on quality and tight on volume:
// enough of a season to be worth a card, on one team, by someone no other set
// already holds. Whether they are good enough is a question the price answers.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCache, REPO_ROOT } from './cache.js';
import { normalizeName } from './resolveTeams.js';
import { buildSet, resolvePlayerIds } from './generateSpecialSets.js';
import { CALIBRATION_FILE } from './calibrateAttributes.js';
import { indexBiometrics, loadBiometrics } from './biometrics.js';
import { indexPositionShares, loadPositionShares } from './positionShares.js';
import { buildApiEpmIndex } from './summerStandouts.js';
import {
  NEVER_CARD, REWARDS_FILE, MIN_SYNTH_GAMES, CAP_SYNTH_MPG,
} from './generateTeamRewards.js';
import * as PV from './playValue.js';
import * as A from './attributes.js';
import { CARD_SETS } from '../../src/game/cardSets.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const OUTPUT_FILE = path.join(GEN_DIR, 'team-reward-candidates.json');

/** EPM begins in 2002, and a card without it has no Speed+Power basis. */
const FIRST_SEASON = 2002;
const LAST_SEASON = 2026;

/** Enough of a season that the card is a real season rather than a cameo. */
const MIN_GAMES = 41;
const MIN_MPG = 20;

/**
 * Where a historical team's collection lives today.
 *
 * CHH GOES TO CHARLOTTE, NOT NEW ORLEANS, and that is the league's own ruling
 * rather than a guess: when Charlotte reclaimed the Hornets name in 2014 the
 * NBA transferred the 1988-2002 records with it, and left the 2002-2013 New
 * Orleans seasons to the Pelicans. So the 2002 Charlotte Hornets reward
 * Charlotte, and the 2003 New Orleans Hornets reward New Orleans, even though
 * one roster became the other.
 */
const RELOCATED = {
  NJN: 'BKN', BRK: 'BKN',
  SEA: 'OKC',
  CHH: 'CHA', CHO: 'CHA', CHB: 'CHA',
  NOH: 'NOP', NOK: 'NOP',
  VAN: 'MEM',
  WSB: 'WAS',
  PHO: 'PHX',
};

/** The current franchise a stint's collection belongs to, or null for aggregates. */
export function franchiseOf(team) {
  const code = String(team ?? '').toUpperCase();
  if (/^\d?TM$|^TOT$/.test(code)) return null;
  return RELOCATED[code] ?? code;
}

/**
 * What another set already holds, and therefore what a reward may not duplicate.
 *
 * ── TWO RULES, BECAUSE ONE OF THEM MAY BE UNAFFORDABLE ──────────────────────
 *
 * BY PLAYER (the shipped rule): a reward is someone no other set carries at
 * all. Cleanest promise — the card is a player you cannot own any other way.
 *
 * BY SEASON (`byPlayer: false`): a reward is a SEASON no other set carries. The
 * same player may appear, on a different year, in a different uniform, with a
 * different chart.
 *
 * The by-player rule turns out to fight the difficulty ladder. A franchise is
 * hard to collect because its current roster is full of stars, and those same
 * franchises have had their history most thoroughly mined by Super Season,
 * Rookie and Summer Standouts — so the hardest rosters have the THINNEST
 * remaining candidate pools. Measured: eight of the ten easiest franchises can
 * offer a better card than the median of the ten hardest. Sacramento tops out
 * at $1,300 for a 15-pack collection while Cleveland tops out at $930 for an
 * 87-pack one.
 */
export function alreadyCarded({ byPlayer = true } = {}) {
  const keys = new Set();
  for (const [setId, cards] of Object.entries(CARD_SETS)) {
    if (setId === 'team-rewards') continue;
    for (const card of cards) {
      // A base-set card is this season by definition and carries no `season`.
      keys.add(byPlayer ? normalizeName(card.name) : `${normalizeName(card.name)}|${card.season ?? LAST_SEASON}`);
    }
  }
  return keys;
}

function seasonRows(season, kind) {
  let cached;
  try { cached = readCache(`bbref-${season}-${kind}-full`); } catch { return []; }
  return Array.isArray(cached) ? cached : cached?.rows ?? cached?.data ?? [];
}

/** A player's season-wide minutes, from the aggregate row where one exists. */
function seasonMinutes(rows, name) {
  let best = 0;
  for (const r of rows) {
    if (normalizeName(r.name) !== normalizeName(name)) continue;
    if (/TM$/.test(r.team ?? '')) return r.minutes ?? best;
    best = Math.max(best, r.minutes ?? 0);
  }
  return best;
}

/**
 * Every stint worth pricing, across every season EPM covers.
 *
 * One row per (player, season, team): a traded player is a candidate for BOTH
 * franchises he played for, because the card prints the stint and the stint is
 * what a collection is rewarding.
 */
export function gatherCandidates({ franchises = null, log = console.log, byPlayer = true } = {}) {
  const carded = alreadyCarded({ byPlayer });
  const apiEpm = buildApiEpmIndex();
  const want = franchises ? new Set(franchises) : null;
  const out = [];

  for (let season = FIRST_SEASON; season <= LAST_SEASON; season++) {
    const adv = seasonRows(season, 'advanced');
    if (adv.length === 0) continue;
    const pp = seasonRows(season, 'perPoss');
    const shooting = seasonRows(season, 'shooting');
    const ppByKey = new Map(pp.map(r => [`${normalizeName(r.name)}|${r.team}`, r]));
    const shByKey = new Map(shooting.map(r => [`${normalizeName(r.name)}|${r.team}`, r]));

    for (const row of adv) {
      const franchise = franchiseOf(row.team);
      if (!franchise) continue;
      if (want && !want.has(franchise)) continue;

      const games = row.games ?? 0;
      if (games < MIN_GAMES) continue;
      if ((row.minutes ?? 0) / games < MIN_MPG) continue;

      const norm = normalizeName(row.name);
      if (NEVER_CARD.has(norm)) continue;
      if (carded.has(byPlayer ? norm : `${norm}|${season}`)) continue;

      const key = `${norm}|${row.team}`;
      const ppRow = ppByKey.get(key);
      if (!ppRow) continue;
      const epm = apiEpm.get(`${norm}|${season}`);
      if (!epm || epm.epm == null) continue;

      out.push({
        franchise,
        name: row.name,
        season,
        team: row.team,
        epm: epm.epm,
        games,
        mpg: Number(((row.minutes ?? 0) / games).toFixed(1)),
        advRow: row,
        ppRow,
        shRow: shByKey.get(key) ?? null,
        trustMinutes: seasonMinutes(adv, row.name),
        ewinsPerGame: epm.ewinsPerGame ?? null,
      });
    }
  }
  log(`Candidates gathered: ${out.length} stints across ${FIRST_SEASON}-${LAST_SEASON}.`);
  return out;
}

/** Is this (player, season) game log already cached? */
export function hasGameLog(bbrefId, season) {
  try { return Boolean(readCache(`gamelog-full-${bbrefId}-${season}`)); } catch { return false; }
}

/**
 * Build and price every candidate as a FULL card through the real pipeline,
 * in one batch. priceCandidates keeps only the salaries; the Free Agents
 * builder (buildFreeAgent.mjs) keeps the card.
 */
export function buildCandidateCards(candidates, { log = console.log, useRealGames = false } = {}) {
  const calibration = JSON.parse(fs.readFileSync(CALIBRATION_FILE, 'utf8'));
  const archiveCache = readCache('bbref-history');
  const archiveRows = archiveCache?.data?.rows ?? archiveCache?.rows ?? [];
  const pool = JSON.parse(fs.readFileSync(path.join(GEN_DIR, 'player-pool-2026.json'), 'utf8'));
  const biometrics = indexBiometrics(loadBiometrics());
  const positionShares = indexPositionShares(loadPositionShares());

  // The base-set rows priceAgainstBase measures against, exactly as the real
  // generator assembles them.
  const currentByName = new Map();
  for (const row of archiveRows) {
    if (row.season !== LAST_SEASON) continue;
    const prev = currentByName.get(row.playerId);
    if (!prev || (row.games ?? 0) > (prev.games ?? 0)) currentByName.set(row.playerId, row);
  }
  const poolIds = new Set(resolvePlayerIds(pool, archiveRows).ids.values());
  const currentRows = [...currentByName.values()].filter(r => poolIds.has(r.playerId));

  // THE SAME SYNTHETIC WORKLOAD THE GENERATOR APPLIES. A reward card is built
  // on a floor of games and a cap on minutes per game, so a heavy-minutes
  // season does not price off a workload no modern card carries. Skipping it
  // here priced Antawn Jamison's 40-minute 2006 twenty dollars high and moved
  // half a dozen others, which is exactly the "estimate gets found out at
  // generation time" failure this script exists to prevent.
  const selections = candidates.map(c => ({
    player: { name: c.name, pos: c.advRow.pos },
    season: {
      ...c.advRow, ...c.ppRow,
      playerId: c.advRow.playerId,
      season: c.season,
      games: Math.max(c.games, MIN_SYNTH_GAMES),
      minutes: Math.max(c.games, MIN_SYNTH_GAMES) * Math.min(c.mpg, CAP_SYNTH_MPG),
      rimPct: c.shRow?.rimPct ?? null,
      rimShare: c.shRow?.rimShare ?? null,
      epm: c.epm,
      ewinsPerGame: c.ewinsPerGame,
      trustMinutes: c.trustMinutes,
    },
  }));

  log(`Pricing ${selections.length} candidate cards…`);
  // BUILT ON THE SYNTHETIC WORKLOAD, PRICED ON THE REAL ONE — because that is
  // what the generator does. It overwrites `games` and `mpg` with the true
  // season's numbers before calling priceAgainstBase, so the attributes come
  // off a capped workload while the play value comes off the real one.
  // Replicated here rather than corrected: this script's only job is to
  // predict the salary the generator will print, and predicting a tidier
  // pipeline than the one that ships is how a pick lands in the wrong band.
  const cards = buildSet({
    selections, currentRows, calibration, biometrics, positionShares, useRealGames,
  }).map((card, i) => ({ ...card, games: candidates[i].games, mpg: candidates[i].mpg }));
  PV.priceAgainstBase(cards, { roundSalary: A.roundSalary, min: A.SALARY_MIN, max: A.SALARY_MAX });
  return cards;
}

/** Price every candidate through the real card pipeline, in one batch. */
export function priceCandidates(candidates, opts = {}) {
  const cards = buildCandidateCards(candidates, opts);
  return candidates.map((c, i) => ({
    franchise: c.franchise,
    name: c.name,
    // Carried so the log fetcher can address the season without re-deriving it.
    bbrefId: c.advRow.playerId,
    season: c.season,
    team: c.team,
    epm: Number(c.epm.toFixed(2)),
    games: c.games,
    mpg: c.mpg,
    salary: cards[i].salary,
  }));
}

export function main({ franchises = null, log = console.log, useRealGames = false, byPlayer = true } = {}) {
  let candidates = gatherCandidates({ franchises, log, byPlayer });
  if (useRealGames) {
    const before = candidates.length;
    candidates = candidates.filter(c => hasGameLog(c.advRow.playerId, c.season));
    log(`Real-log pass: ${candidates.length} of ${before} candidates have a cached game log.`);
    if (candidates.length === 0) {
      throw new Error(
        'No shortlisted game logs are cached. Run `node scripts/cardgen/fetchTeamRewardCandidateLogs.mjs` first.'
      );
    }
  }
  const priced = priceCandidates(candidates, { log, useRealGames });

  // Best salary first inside each franchise — the pick is made by eye from
  // here, weighing "most identified with this team" against the target band.
  const byFranchise = {};
  for (const row of priced) (byFranchise[row.franchise] ??= []).push(row);
  for (const rows of Object.values(byFranchise)) rows.sort((a, b) => b.salary - a.salary);

  const body = {
    generatedAt: new Date().toISOString(),
    filters: { firstSeason: FIRST_SEASON, lastSeason: LAST_SEASON, minGames: MIN_GAMES, minMpg: MIN_MPG },
    useRealGames,
    note: useRealGames
      ? 'Priced on REAL GAME LOGS, the way the cards are built. Within ~$70 of what the generator will print.'
      : 'Priced on per-100 rates: a RANKING, not an estimate. real ~= 104 + 0.621 x this. Fetch logs and rerun with --real before picking.',
    current: REWARDS_FILE,
    byFranchise,
  };
  fs.mkdirSync(GEN_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(body, null, 1)}\n`);
  log(`  ${OUTPUT_FILE}`);
  return body;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const args = argv.filter(a => !a.startsWith('-'));
  main({
    franchises: args.length ? args : null,
    useRealGames: argv.includes('--real'),
    byPlayer: !argv.includes('--by-season'),
  });
}
