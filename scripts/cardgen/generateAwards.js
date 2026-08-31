// Builds the AWARD MARKS every generated set's cards carry.
//
//   node scripts/cardgen/generateAwards.js
//
// Writes card-data/generated/card-awards.json, which the studio picks up
// automatically (src/studio/players.js). Reads Basketball-Reference's season
// tables through the same cache every other generator uses, so a second run
// costs nothing and asks nothing of the site.
//
// ── WHERE THE DATA COMES FROM, AND WHY IT NEEDED A FETCH AT ALL ─────────────
//
// Basketball-Reference's season tables carry an `awards` column — one string
// per player, e.g. `MVP-1,CPOY-1,AS,NBA1` — and parseSeasonTableHtml has always
// returned it, because it returns every `data-stat` cell it finds. What it did
// NOT do was survive the cache: cache.js stores NORMALIZED JSON rather than raw
// pages, and every normalizer in this directory picks out the handful of
// metrics it needs and drops the rest. So `card-data/cache/bbref-2026-advanced-
// full.json` has BPM and VORP and no awards at all, and the column had to be
// fetched and cached under a key of its own. That is what AWARDS_CACHE_KEY is.
//
// ── WHICH SEASON'S AWARDS A CARD SHOWS ──────────────────────────────────────
//
// THE SEASON THE CARD'S NUMBERS CAME FROM, always — which is a different season
// for each set, and is the whole reason this is not a single lookup:
//
//   2026-27         the base set, built from 2025-26 stats, so 2025-26 awards.
//                   A base card is this season by definition; `statsSeason` in
//                   sets.js is what says which one that is.
//
//   super-season    THAT CARD'S season, one per card, spanning 2008-09..2024-25.
//                   This is where the feature earns its place: a Super Season
//                   card is somebody's career-best year, which is exactly the
//                   year he is likeliest to have won something, and until now
//                   the card said so only in the numbers.
//
//   rookie          that card's rookie season, 2003-04..2024-25 — where ROY
//                   lives, and nothing else could carry it.
//
// ── THE WNBA SETS ARE NOT COVERED, AND THAT IS A DATA GAP, NOT A DECISION ───
//
// Basketball-Reference serves the WNBA under a different path with its own
// table ids, read here by scripts/cardgen/sources/wnbaReference.js, and that
// adapter does not fetch a table carrying an awards column. Rather than guess
// at one, the two WNBA sets are simply absent from the output — and because
// every join downstream is "this set's map, or nothing", they render exactly as
// they did before this file existed. Wiring them up is adding a season list and
// a parser here; nothing else has to change.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { cached, CACHE_DIR, politeDelay, DEFAULT_REQUEST_SPACING_MS } from './cache.js';
import { fetchSeasonTable, SEASON_TABLES } from './sources/basketballReference.js';
import { normalizeName } from './resolveTeams.js';
import {
  AWARD_CODES,
  MAX_CARD_AWARDS,
  awardsEarned,
  selectionsIn,
} from '../../src/cards/awards.js';
import {
  CURRENT_SET,
  ROOKIE_SET,
  SUPER_SEASON_SET,
  setStatsSeason,
} from '../../src/cards/sets.js';

const GEN_DIR = path.resolve(CACHE_DIR, '..', 'generated');

export const AWARDS_FILE = path.join(GEN_DIR, 'card-awards.json');

/**
 * The cache key one season's awards column is stored under.
 *
 * A KEY OF ITS OWN rather than a wider re-fetch of `bbref-{season}-advanced-
 * full`, for cache.js's stated invalidation rule: "when a parser changes, delete
 * the affected cache file". Widening the existing normalizer would have made
 * every one of those twenty-seven files stale at once, on a repo where they are
 * committed and where re-fetching them is a five-minute polite scrape. A new key
 * is additive: nothing that exists is invalidated and nothing that exists is
 * re-fetched.
 */
export const AWARDS_CACHE_KEY = season => `bbref-${season}-awards`;

/**
 * WHICH TABLE THE COLUMN IS READ OFF.
 *
 * `advanced` — one row per player per team, the same table history.js already
 * reads, and it carries `awards` on every season checked (2004, 2025, 2026).
 * The choice is not free: the four season tables list the same players but the
 * awards column is a per-PLAYER fact, so reading it off two of them would be
 * two chances to disagree. One table, named here.
 */
export const AWARDS_TABLE = 'advanced';

/**
 * One season's awards, as `{ playerId, name, awards }` for the players who have
 * any.
 *
 * TRADED PLAYERS HAVE SEVERAL ROWS in these tables — a combined `2TM` row and
 * one per team — so the strings are unioned per player id rather than taking
 * the first row found. Verified against 2004, 2025 and 2026: no player carries
 * awards on more than one row today, so the union is a guard rather than a fix,
 * and it is the guard that matters if the site ever starts repeating the cell.
 */
export function extractAwards(rows) {
  const byId = new Map();
  for (const row of rows) {
    const raw = row?.cells?.awards;
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    const prev = byId.get(row.playerId);
    if (!prev) {
      byId.set(row.playerId, { playerId: row.playerId, name: row.name, awards: raw.trim() });
      continue;
    }
    const merged = new Set([...prev.awards.split(','), ...raw.split(',')].map(t => t.trim()));
    prev.awards = [...merged].join(',');
  }
  return [...byId.values()];
}

/** Fetches (or reads from cache) one season's awards column. */
export async function loadSeasonAwards(season, { fetchImpl = fetch, force = false } = {}) {
  return cached(
    AWARDS_CACHE_KEY(season),
    async () => extractAwards(await fetchSeasonTable(season, AWARDS_TABLE, { fetchImpl })),
    {
      force,
      meta: {
        source: `https://www.basketball-reference.com/leagues/NBA_${season}_${SEASON_TABLES[AWARDS_TABLE].slug}.html`,
        season,
        kind: 'awards',
      },
    }
  );
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * The Basketball-Reference season a set's cards are built from, when the set
 * declares one number for all of them.
 *
 * `setStatsSeason` hands back a LABEL ("2025-26") or prose ("career-best
 * season"); this turns the first into the END year Basketball-Reference indexes
 * by (2026) and the second into null, which is the signal that the set's cards
 * carry their own seasons instead. Nothing here spells a season: the base set's
 * awards year moves when sets.js's does.
 */
export function statsSeasonEndYear(set) {
  const label = setStatsSeason(set);
  const m = /^(\d{4})-(\d{2})$/.exec(String(label ?? ''));
  if (!m) return null;
  // "2025-26" -> 2026. The century comes from the first half, so 1999-00 works.
  return Math.floor(Number(m[1]) / 100) * 100 + Number(m[2]) + (m[2] === '00' ? 100 : 0);
}

/**
 * One card's award record, or null if the season carried nothing for him.
 *
 * `raw` is kept ALONGSIDE the parsed codes, and it is not redundant. It is the
 * evidence for the rule: Luka Dončić's 2025-26 row reads `MVP-4,CPOY-8,AS,NBA1`
 * and produces `['AS']` — the All-Star selection and NOT the fourth-place MVP
 * finish, off one string, in one call. A file that recorded only the outcome
 * could not tell that apart from a row that simply said `AS`, nor either of
 * them from a fetch that had failed. It is also what the argument about the
 * REMAINING selections is settled against — `ifSelectionsCounted` in
 * countAwards is computed from it, and the header of src/cards/awards.js
 * quotes the result.
 */
function awardRecord(card, row, season) {
  if (!row) return null;
  return {
    id: card.id,
    name: card.name,
    // The season the awards were READ FROM, which is the card's own on the two
    // special sets and the SET's stats season on the base one — a base card
    // carries no `season` field at all, deliberately (see showsSeason in
    // sets.js), so taking it from the record would have written `undefined`
    // into every row of the biggest set in the file.
    season,
    bbrefId: row.playerId,
    raw: row.awards,
    // Declared codes only — the file records what a card may PRINT, and `raw`
    // above is what it records for everything it does not. `awardsEarned` is
    // where the -1 rule and the declaration meet; see src/cards/awards.js.
    awards: awardsEarned(row.awards),
  };
}

/**
 * The base set's cards joined to one season's awards BY NAME.
 *
 * BY NAME BECAUSE THERE IS NOTHING ELSE. cards-2026-27.json carries no
 * Basketball-Reference id — generateCards.js is deliberately history-free — so
 * the join key is `normalizeName`, the same cross-source key resolveTeams.js
 * matches nba.com's roster on, which folds diacritics, case, punctuation and
 * suffixes.
 *
 * AND THE COLLISION IS CHECKED RATHER THAN ASSUMED. Two players sharing a
 * normalized name would silently give one of them the other's trophy, so the
 * key is required to be unique on BOTH sides and the run throws if it is not.
 * A generator that stops is recoverable; an MVP on the wrong card is not.
 */
export function joinByName(cards, seasonAwards, season) {
  const matched = new Set();
  const byKey = new Map();
  for (const row of seasonAwards) {
    const key = normalizeName(row.name);
    if (byKey.has(key)) {
      throw new Error(
        `generateAwards: two award rows normalize to ${JSON.stringify(key)} ` +
          `(${byKey.get(key).name} / ${row.name}) — the name join is unsafe`
      );
    }
    byKey.set(key, row);
  }
  const seen = new Set();
  const out = [];
  for (const card of cards) {
    const key = normalizeName(card.name);
    if (seen.has(key)) {
      throw new Error(
        `generateAwards: two cards normalize to ${JSON.stringify(key)} — the name join is unsafe`
      );
    }
    seen.add(key);
    const row = byKey.get(key);
    if (row) matched.add(key);
    const record = awardRecord(card, row, season);
    if (record) out.push(record);
  }
  // EVERY AWARD ROW SHOULD FIND A CARD, and when one does not it is worth
  // saying out loud rather than silently dropping: an award-winning player
  // missing from the pool is either a genuine pool decision (he retired, he
  // fell under the minutes floor) or a name the join failed on, and those two
  // look identical in a count that only reports what matched.
  const unmatched = [...byKey.values()].filter(r => !matched.has(normalizeName(r.name)));
  return { records: out, unmatched };
}

/**
 * A special set's cards joined to their OWN seasons' awards, by bbref id.
 *
 * NO NAME MATCHING HERE, and that is the point of doing it separately: these
 * cards carry `bbrefId` because generateSpecialSets.js resolved it once, from
 * the most recent season only, which is the rule that keeps fathers and sons
 * apart. Reusing it costs nothing and cannot be wrong.
 */
export function joinById(cards, awardsBySeason) {
  const out = [];
  for (const card of cards) {
    const season = awardsBySeason.get(card.season);
    if (!season) continue;
    const record = awardRecord(card, season.get(card.bbrefId), card.season);
    if (record) out.push(record);
  }
  return out;
}

/**
 * What the run reports, and what the file records.
 *
 * FOUR NUMBERS PER SET, and each one answers a question the others cannot:
 *
 *   marked                cards that print at least one mark.
 *   multiple              cards that print more than one.
 *   capped                cards holding MORE codes than the row can draw, so
 *                         `pickAwards` is silently dropping the least of them.
 *                         ZERO IN EVERY SET TODAY and it needs to stay that
 *                         way — a dropped trophy is the one failure this
 *                         feature cannot have, and a count that regenerates is
 *                         how the next season's data says so out loud instead
 *                         of at export time. See MAX_CARD_AWARDS.
 *   ifSelectionsCounted   cards that would be marked if ALL FIVE selections
 *                         counted, not just the All-Star one this build now
 *                         declares. It keeps the argument for leaving All-NBA
 *                         and All-Defensive out measurable rather than
 *                         asserted, which is worth more than a number typed
 *                         into a comment in src/cards/awards.js.
 *
 * The last one is measured through `selectionsIn` rather than as "has any award
 * string at all", which is what it used to be and which was WRONG in a way that
 * mattered: a card whose only token is `MVP-4` holds no selection and would not
 * be marked by admitting them, but it was counted anyway. That inflation is
 * where the 37%-of-Super-Season figure came from while All-Star was being
 * decided; the honest ceiling is lower, and the All-Star-alone cost — the
 * decision that was actually taken — is `marked`.
 */
export function countAwards(records) {
  const byCode = Object.fromEntries(AWARD_CODES.map(c => [c, 0]));
  let marked = 0;
  let ifSelectionsCounted = 0;
  let multiple = 0;
  let capped = 0;
  for (const r of records) {
    if (r.awards.length > 0) marked += 1;
    if (r.awards.length > 1) multiple += 1;
    if (r.awards.length > MAX_CARD_AWARDS) capped += 1;
    if (r.awards.length > 0 || selectionsIn(r.raw).length > 0) ifSelectionsCounted += 1;
    for (const code of r.awards) byCode[code] += 1;
  }
  return { cards: records.length, marked, multiple, capped, ifSelectionsCounted, byCode };
}

/**
 * Every season any generated set needs, so the fetch loop is one polite pass.
 *
 * Derived from the card files rather than declared, for the reason nothing in
 * this tree spells a season: a regenerated Super Season set that reaches one
 * year further back needs no edit here.
 */
export function seasonsNeeded(sets) {
  const seasons = new Set();
  for (const { season, cards } of sets) {
    if (season != null) seasons.add(season);
    for (const card of cards ?? []) {
      if (Number.isFinite(card.season)) seasons.add(card.season);
    }
  }
  return [...seasons].sort((a, b) => a - b);
}

async function main() {
  const base = readJson(path.join(GEN_DIR, `cards-${CURRENT_SET}.json`));
  const superSeason = readJson(path.join(GEN_DIR, `cards-${SUPER_SEASON_SET}.json`));
  const rookie = readJson(path.join(GEN_DIR, `cards-${ROOKIE_SET}.json`));

  const baseSeason = statsSeasonEndYear(CURRENT_SET);
  if (baseSeason == null) {
    throw new Error(`generateAwards: ${CURRENT_SET} declares no season-shaped statsSeason`);
  }

  const plan = [
    { set: CURRENT_SET, season: baseSeason, cards: base.cards },
    { set: SUPER_SEASON_SET, cards: superSeason.cards },
    { set: ROOKIE_SET, cards: rookie.cards },
  ];
  const seasons = seasonsNeeded(plan);

  const bySeason = new Map();
  let fetched = 0;
  for (const season of seasons) {
    const before = fs.existsSync(path.join(CACHE_DIR, `${AWARDS_CACHE_KEY(season)}.json`));
    const rows = await loadSeasonAwards(season);
    bySeason.set(season, new Map(rows.map(r => [r.playerId, r])));
    if (!before) {
      fetched += 1;
      // Only after a real request. A cache hit asks nothing of the site and so
      // owes it nothing.
      if (season !== seasons[seasons.length - 1]) await politeDelay(DEFAULT_REQUEST_SPACING_MS);
    }
  }

  const baseJoin = joinByName(
    base.cards,
    [...bySeason.get(baseSeason).values()],
    baseSeason
  );
  const sets = {
    [CURRENT_SET]: baseJoin.records,
    [SUPER_SEASON_SET]: joinById(superSeason.cards, bySeason),
    [ROOKIE_SET]: joinById(rookie.cards, bySeason),
  };

  const counts = Object.fromEntries(
    Object.entries(sets).map(([set, records]) => [set, countAwards(records)])
  );

  fs.mkdirSync(GEN_DIR, { recursive: true });
  fs.writeFileSync(
    AWARDS_FILE,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source:
          "Basketball-Reference's season `advanced` tables, awards column — a voted award's " +
          'suffix is its finishing position, so only -1 is a win',
        declared: AWARD_CODES,
        seasons,
        counts,
        sets,
      },
      null,
      1
    )}\n`
  );

  const log = console.log;
  log(`Seasons read: ${seasons.length} (${fetched} fetched, ${seasons.length - fetched} cached)`);
  for (const [set, c] of Object.entries(counts)) {
    log(
      `  ${set.padEnd(14)} ${String(c.marked).padStart(3)} of ${String(c.cards).padStart(3)} ` +
        `cards marked  (${c.multiple} with more than one; ` +
        `${c.capped} over the ${MAX_CARD_AWARDS}-mark row; ` +
        `${c.ifSelectionsCounted} if every selection counted)`
    );
    log(
      `                 ${AWARD_CODES.map(code => `${code} ${c.byCode[code]}`).join('  ')}`
    );
  }
  log(`\nWrote:\n  ${AWARDS_FILE}`);
}

// Run-as-script guard. pathToFileURL rather than a path string compare: on
// Windows `process.argv[1]` is `C:\...` and `import.meta.url` is `file:///C:/...`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
