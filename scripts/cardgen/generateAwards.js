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
import {
  fetchLeagueChampion,
  fetchSeasonTable,
  fetchTeamRoster,
  SEASON_TABLES,
} from './sources/basketballReference.js';
import { normalizeName } from './resolveTeams.js';
import {
  AWARD_CODES,
  CHAMPION_CODE,
  MAX_CARD_AWARDS,
  awardsEarned,
  orderAwardCodes,
  postSeasonAwardsEarned,
  selectionsIn,
} from '../../src/cards/awards.js';
import { canonicalTeam, franchiseForSeason } from '../../src/cards/teams.js';
import {
  CURRENT_SET,
  ROOKIE_SET,
  SUMMER_STANDOUTS_SET,
  TRADED_SET,
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
 * The cache key one season's PLAYOFF awards column is stored under.
 *
 * A SECOND KEY RATHER THAN A WIDER FIRST ONE, for exactly the reason
 * AWARDS_CACHE_KEY gives for existing at all. Twenty-three
 * `bbref-{season}-awards.json` files are committed and correct; folding the
 * playoff rows into them would invalidate every one and force a re-scrape of
 * pages this repo already has. A new key is additive — nothing that exists is
 * stale, and a rebuild fetches only what is genuinely new.
 *
 * It also keeps the two tables apart in the FILE, which is worth more than the
 * saved requests: a reader can see that the regular-season cache holds no
 * `Finals` anywhere and the playoff cache holds nothing else.
 */
export const POST_AWARDS_CACHE_KEY = season => `bbref-${season}-awards-post`;

/**
 * WHICH TABLES THE COLUMN IS READ OFF.
 *
 * `advanced` — one row per player per team, the same table history.js already
 * reads, and it carries `awards` on every season checked (2004, 2025, 2026).
 * The choice is not free: the four season tables list the same players but the
 * awards column is a per-PLAYER fact, so reading it off two of them would be
 * two chances to disagree. One table, named here.
 *
 * `advanced_post` — THE SAME PAGE'S PLAYOFF TABLE, and the exception that
 * proves the rule above rather than breaking it. It is not a second chance to
 * disagree, because it does not carry the same facts: its awards column holds
 * ONE cell a season and that cell is always `Finals MVP-1` (verified live for
 * 2004, 2015, 2021 and 2026), a trophy the regular-season table has never
 * carried. The two tables are read into two fields and joined by two functions
 * — `awardsEarned` for the first and `postSeasonAwardsEarned` for the second —
 * so a playoff string cannot produce a regular-season mark even if the site
 * starts repeating the cell. See src/cards/awards.js.
 */
export const AWARDS_TABLE = 'advanced';
export const POST_AWARDS_TABLE = 'advancedPost';

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

/**
 * Fetches (or reads from cache) one season's PLAYOFF awards column.
 *
 * SAME URL AS ABOVE, second table — so a cold rebuild costs two requests for
 * one page. Deliberate, and cheap at the scale this runs: the alternative is a
 * fetch layer that returns several parsed tables per page, which would be a
 * change to every caller of `fetchSeasonTable` to save twenty-three requests
 * once. The cache is what makes it once.
 *
 * `extractAwards` is reused unchanged: the playoff table has the same shape,
 * the same `data-append-csv` ids and the same awards cell, and a player traded
 * mid-season has the same several rows there too.
 */
export async function loadSeasonPostAwards(season, { fetchImpl = fetch, force = false } = {}) {
  return cached(
    POST_AWARDS_CACHE_KEY(season),
    async () => extractAwards(await fetchSeasonTable(season, POST_AWARDS_TABLE, { fetchImpl })),
    {
      force,
      meta: {
        source: `https://www.basketball-reference.com/leagues/NBA_${season}_${SEASON_TABLES[POST_AWARDS_TABLE].slug}.html#${SEASON_TABLES[POST_AWARDS_TABLE].tableId}`,
        season,
        kind: 'awards-post',
      },
    }
  );
}

/**
 * The cache key one season's CHAMPION is stored under.
 *
 * ONE ENTRY FOR TWO FETCHES. The champion is named on the league index page and
 * his roster is on the team's own page, and neither is useful without the
 * other: knowing the Knicks won 2026 marks no cards, and a roster with no
 * season attached marks the wrong ones. So the cached value is the joined
 * answer — team, season and the twenty men on it — and a cache hit costs the
 * site nothing where a miss costs it two requests.
 */
export const CHAMPION_CACHE_KEY = season => `bbref-${season}-champion`;

/**
 * One season's champion and his roster, or null for a season nobody has won yet.
 *
 * The roster is fetched at the abbreviation the SUMMARY PAGE linked, never one
 * this repo spells — see parseLeagueChampionHtml. And the season on the record
 * is the one the href carried, so a page that answered about a different year
 * cannot be joined to this year's cards.
 */
export async function loadSeasonChampion(season, { fetchImpl = fetch, force = false } = {}) {
  return cached(
    CHAMPION_CACHE_KEY(season),
    async () => {
      const champion = await fetchLeagueChampion(season, { fetchImpl });
      if (!champion) return null;
      await politeDelay(DEFAULT_REQUEST_SPACING_MS);
      const roster = await fetchTeamRoster(champion.abbr, champion.season, { fetchImpl });
      return { ...champion, roster };
    },
    {
      force,
      meta: {
        source: `https://www.basketball-reference.com/leagues/NBA_${season}.html`,
        season,
        kind: 'champion',
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
function awardRecord(card, row, season, championEntry = null, postRow = null) {
  // THE RING IS A JERSEY FACT ON A SEASON CARD, AND A CHAMPION FACT ON A BASE
  // CARD. The champion join finds a player on the winning roster by id — which
  // was always enough while every card showed the team its whole season was
  // played for. The TRADED set broke that: Rasheed Wallace's one game as a
  // 2003-04 Hawk is the same season as his Pistons ring, and the roster join
  // hung Detroit's ring on an Atlanta card. So on a card that IS a specific
  // season-with-a-team (every special set carries `season`), the ring only
  // prints when the card wears the champion's jersey — era keys included,
  // which is what franchiseForSeason resolves.
  //
  // The BASE set keeps the roster join whole, by the user's call: a base card
  // carries no `season` field and shows where the man plays NOW, and a
  // reigning champion who changed teams over the summer is still a reigning
  // champion — Yabusele and Mitchell Robinson keep their rings.
  if (championEntry && card.team && Number.isFinite(card.season)) {
    const champKey = franchiseForSeason(canonicalTeam(championEntry.team), card.season);
    if (champKey !== card.team) championEntry = null;
  }
  // THREE SOURCES, ANY OF WHICH IS ENOUGH. The regular-season awards column is
  // one; the champion's roster is the second, and it is the reason this does
  // not return early on a missing `row` — most of a title-winning roster wins
  // nothing individually (fourteen of the Knicks' twenty in 2026 have no awards
  // string at all) and a guard that required one would have handed the ring to
  // the stars and to nobody else, which is the opposite of what a team fact
  // means. The PLAYOFF column is the third, and it is the same argument once
  // more: a Finals MVP need not have won anything in the regular season, and
  // Andre Iguodala's 2015 is exactly that card — no regular-season awards
  // string at all, and the Finals MVP.
  if (!row && !championEntry && !postRow) return null;
  const earned = awardsEarned(row?.awards);
  // THE PLAYOFF STRING GOES THROUGH ITS OWN DOOR, never through `awardsEarned`.
  // That is the whole guard: `postSeasonAwardsEarned` keeps only codes declared
  // `postSeason`, so this column can contribute a Finals MVP and nothing else —
  // not an All-Star selection, not a regular-season trophy — however the site
  // rewrites it. See src/cards/awards.js.
  const earnedInPlayoffs = postSeasonAwardsEarned(postRow?.awards);
  return {
    id: card.id,
    name: card.name,
    // The season the awards were READ FROM, which is the card's own on the two
    // special sets and the SET's stats season on the base one — a base card
    // carries no `season` field at all, deliberately (see showsSeason in
    // sets.js), so taking it from the record would have written `undefined`
    // into every row of the biggest set in the file.
    season,
    // FROM WHICHEVER SIDE MATCHED. Both carry Basketball-Reference's own id and
    // they agree where both are present (the roster and the season table are
    // the same site's key for the same man); the awards row is preferred only
    // because it is the join this file was built around.
    bbrefId: row?.playerId ?? championEntry?.playerId ?? postRow?.playerId ?? null,
    // Null rather than absent when the only reason this card has a record is
    // the ring: `raw` is the EVIDENCE for the -1 rule, and a champion with no
    // awards string has no such evidence to record. An empty string would read
    // as "the column was empty", which is a different fact from "he is here for
    // something that was never in the column".
    raw: row?.awards ?? null,
    // THE PLAYOFF COLUMN'S OWN STRING, kept in its own field and never
    // concatenated into `raw`. Two reasons, and the second is the load-bearing
    // one. It is the same evidence argument as `raw` — a reader can see that
    // `Finals MVP-1` is what produced the mark. And joining the two strings
    // would hand ONE string to whichever parser ran on it, which is precisely
    // the confusion the two-door design exists to prevent: `raw` is read by
    // `awardsEarned` and this is read by `postSeasonAwardsEarned`, and neither
    // can ever see the other's cell.
    rawPost: postRow?.awards ?? null,
    // The TEAM he won it with, in Basketball-Reference's own abbreviation for
    // that season — NJN in 2011, BRK in 2013. Recorded because "why does this
    // card have a ring" is the first question anyone will ask of the output,
    // and answering it from the file beats re-deriving it from a cache.
    champion: championEntry ? championEntry.team : null,
    // Declared codes only — the file records what a card may PRINT, and `raw`
    // above is what it records for everything it does not. `awardsEarned` is
    // where the -1 rule and the declaration meet; `orderAwardCodes` is what
    // puts the externally-resolved ring, and now the playoff column's trophy,
    // in their declared places rather than on the end. THREE lists arrive here
    // in three different orders and exactly one leaves. See src/cards/awards.js.
    awards: orderAwardCodes([
      ...earned,
      ...earnedInPlayoffs,
      ...(championEntry ? [CHAMPION_CODE] : []),
    ]),
  };
}

/**
 * One season's champion roster, indexed BOTH WAYS, because the two sets join
 * differently.
 *
 * The special sets carry `bbrefId` and match on it exactly. The base set does
 * not carry one at all, so it matches on `normalizeName` — the same key
 * `joinByName` already uses for the awards column, and safe here for a stronger
 * reason than it is there: the pool being matched against is ONE SEVENTEEN-MAN
 * ROSTER rather than the league's six hundred, so the chance of two entries
 * folding to one key is nil. It is checked anyway, and throws rather than
 * quietly giving one man another man's ring.
 *
 * Returns null for a season nobody has won yet — the state an in-progress
 * season's index page is genuinely in, and not an error.
 */
export function championIndex(champion) {
  if (!champion?.roster) return null;
  const byId = new Map();
  const byName = new Map();
  for (const player of champion.roster) {
    const entry = { playerId: player.playerId, name: player.name, team: champion.abbr };
    byId.set(player.playerId, entry);
    const key = normalizeName(player.name);
    if (byName.has(key)) {
      throw new Error(
        `generateAwards: two ${champion.abbr} ${champion.season} roster entries normalize to ` +
          `${JSON.stringify(key)} (${byName.get(key).name} / ${player.name}) — ` +
          'the champion name join is unsafe'
      );
    }
    byName.set(key, entry);
  }
  return { byId, byName, abbr: champion.abbr, season: champion.season, name: champion.name };
}

/**
 * Award rows indexed by the cross-source name key, throwing on a collision.
 *
 * Shared by the two tables so the guard is written once and cannot drift: a
 * name that is unsafe to join on is unsafe whichever column it came out of.
 * `what` names the table in the error, because "two award rows collide" is a
 * different thing to go and look at from "two playoff award rows collide".
 */
function indexAwardsByName(rows, what) {
  const byKey = new Map();
  for (const row of rows ?? []) {
    const key = normalizeName(row.name);
    if (byKey.has(key)) {
      throw new Error(
        `generateAwards: two ${what} rows normalize to ${JSON.stringify(key)} ` +
          `(${byKey.get(key).name} / ${row.name}) — the name join is unsafe`
      );
    }
    byKey.set(key, row);
  }
  return byKey;
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
 *
 * `postSeasonAwards` is the playoff table's rows for the same season, indexed
 * and collision-checked the same way — a one-row list today, and checked anyway
 * for the reason above rather than because it is close to colliding.
 */
export function joinByName(cards, seasonAwards, season, champions = null, postSeasonAwards = []) {
  const matched = new Set();
  const byKey = indexAwardsByName(seasonAwards, 'award');
  const postByKey = indexAwardsByName(postSeasonAwards, 'playoff award');
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
    const record = awardRecord(
      card,
      row,
      season,
      champions?.byName.get(key) ?? null,
      postByKey.get(key) ?? null
    );
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
 *
 * THE RING IS JOINED ON THE SAME KEY, and the champion looked up is THIS CARD'S
 * OWN SEASON's — which is the whole reason the two special sets could not have
 * shared the base set's single-season lookup. A Super Season card of Andre
 * Iguodala's 2014-15 wants the 2015 champion; the Rookie card of the same man
 * wants 2005's, and neither wants 2026's. `card.season` answers both.
 *
 * ── A CARD CAN NOW HAVE A RECORD WITH NO AWARDS ROW ─────────────────────────
 *
 * `awardsBySeason` still gates the loop, because a season nobody fetched has
 * neither awards NOR a champion. But past that gate the awards row is optional:
 * a role player on a title team gets a record built from the roster alone, and
 * so does a Finals MVP who won nothing in the regular season.
 *
 * `postAwardsBySeason` is the playoff column, keyed the same two ways — season,
 * then bbref id — and read through the same card season, so Andre Iguodala's
 * Super Season card of 2014-15 finds 2015's Finals MVP and his Rookie card of
 * 2004-05 finds nothing.
 */
export function joinById(
  cards,
  awardsBySeason,
  championsBySeason = null,
  postAwardsBySeason = null
) {
  const out = [];
  for (const card of cards) {
    const season = awardsBySeason.get(card.season);
    if (!season) continue;
    const champions = championsBySeason?.get(card.season) ?? null;
    const post = postAwardsBySeason?.get(card.season) ?? null;
    const record = awardRecord(
      card,
      season.get(card.bbrefId),
      card.season,
      champions?.byId.get(card.bbrefId) ?? null,
      post?.get(card.bbrefId) ?? null
    );
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
  let mostHeld = 0;
  for (const r of records) {
    if (r.awards.length > 0) marked += 1;
    if (r.awards.length > 1) multiple += 1;
    if (r.awards.length > MAX_CARD_AWARDS) capped += 1;
    if (r.awards.length > mostHeld) mostHeld = r.awards.length;
    if (r.awards.length > 0 || selectionsIn(r.raw).length > 0) ifSelectionsCounted += 1;
    for (const code of r.awards) byCode[code] += 1;
  }
  return {
    cards: records.length,
    marked,
    multiple,
    capped,
    // THE HIGH-WATER MARK, recorded rather than inferred. `capped` says whether
    // the row is overflowing TODAY; this says how much headroom is left before
    // it does, which is the number MAX_CARD_AWARDS and the sidebar's height are
    // chosen against. A season in which one man wins MVP, DPOY, makes the team
    // and wins the title moves this to 4 and nothing else in the file notices.
    mostHeld,
    ifSelectionsCounted,
    byCode,
  };
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
  const standouts = readJson(path.join(GEN_DIR, `cards-${SUMMER_STANDOUTS_SET}.json`));
  const traded = readJson(path.join(GEN_DIR, `cards-${TRADED_SET}.json`));

  const baseSeason = statsSeasonEndYear(CURRENT_SET);
  if (baseSeason == null) {
    throw new Error(`generateAwards: ${CURRENT_SET} declares no season-shaped statsSeason`);
  }

  const plan = [
    { set: CURRENT_SET, season: baseSeason, cards: base.cards },
    { set: SUPER_SEASON_SET, cards: superSeason.cards },
    { set: ROOKIE_SET, cards: rookie.cards },
    // A playoff-run card is the season a ring or a Finals MVP was actually won
    // in — the set where the champion join earns its keep most literally.
    { set: SUMMER_STANDOUTS_SET, cards: standouts.cards },
    // The strange-jersey season is still a season: Iverson made the 2009
    // All-Star team as the Piston this set cards him as.
    { set: TRADED_SET, cards: traded.cards },
  ];
  const seasons = seasonsNeeded(plan);

  const bySeason = new Map();
  const postBySeason = new Map();
  const championsBySeason = new Map();
  const champions = [];
  const finalsMvps = [];
  let fetched = 0;
  for (const season of seasons) {
    const before = fs.existsSync(path.join(CACHE_DIR, `${AWARDS_CACHE_KEY(season)}.json`));
    const rows = await loadSeasonAwards(season);
    bySeason.set(season, new Map(rows.map(r => [r.playerId, r])));
    if (!before) {
      fetched += 1;
      // Only after a real request. A cache hit asks nothing of the site and so
      // owes it nothing.
      await politeDelay(DEFAULT_REQUEST_SPACING_MS);
    }
    // THE SAME PAGE'S PLAYOFF TABLE, behind a key of its own — one more request
    // on a cold cache and none on a warm one. See POST_AWARDS_CACHE_KEY.
    const hadPost = fs.existsSync(path.join(CACHE_DIR, `${POST_AWARDS_CACHE_KEY(season)}.json`));
    const postRows = await loadSeasonPostAwards(season);
    postBySeason.set(season, new Map(postRows.map(r => [r.playerId, r])));
    // WHO WON THE FINALS MVP EACH SEASON, WRITTEN DOWN — the same argument the
    // `champions` list is kept for one loop down. The marks in `sets` below are
    // otherwise unfalsifiable without re-fetching, and a reader who wants to
    // check that 2015 went to Iguodala and not to Curry can do it from the file.
    for (const row of postRows) {
      for (const code of postSeasonAwardsEarned(row.awards)) {
        finalsMvps.push({ season, code, name: row.name, playerId: row.playerId });
      }
    }
    if (!hadPost) {
      fetched += 1;
      await politeDelay(DEFAULT_REQUEST_SPACING_MS);
    }
    // THE RING'S TWO PAGES, in the same polite pass and behind the same cache.
    const hadChampion = fs.existsSync(
      path.join(CACHE_DIR, `${CHAMPION_CACHE_KEY(season)}.json`)
    );
    const champion = await loadSeasonChampion(season);
    championsBySeason.set(season, championIndex(champion));
    if (champion) {
      champions.push({
        season,
        abbr: champion.abbr,
        name: champion.name,
        roster: champion.roster.length,
      });
    }
    if (!hadChampion) {
      fetched += 1;
      if (season !== seasons[seasons.length - 1]) await politeDelay(DEFAULT_REQUEST_SPACING_MS);
    }
  }

  const baseJoin = joinByName(
    base.cards,
    [...bySeason.get(baseSeason).values()],
    baseSeason,
    championsBySeason.get(baseSeason),
    [...(postBySeason.get(baseSeason)?.values() ?? [])]
  );
  const sets = {
    [CURRENT_SET]: baseJoin.records,
    [SUPER_SEASON_SET]: joinById(superSeason.cards, bySeason, championsBySeason, postBySeason),
    [ROOKIE_SET]: joinById(rookie.cards, bySeason, championsBySeason, postBySeason),
    [SUMMER_STANDOUTS_SET]: joinById(standouts.cards, bySeason, championsBySeason, postBySeason),
    [TRADED_SET]: joinById(traded.cards, bySeason, championsBySeason, postBySeason),
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
          'suffix is its finishing position, so only -1 is a win — plus the same pages\' ' +
          '`advanced_post` table, whose awards column holds one cell a season and that cell ' +
          'is always `Finals MVP-1`, plus each season index ' +
          "page's League Champion row and that team's roster, which is where the ring comes " +
          'from and which is in no column at all',
        declared: AWARD_CODES,
        seasons,
        // WHICH TEAM WON EACH SEASON, WRITTEN DOWN. The rings in `sets` below
        // are otherwise unfalsifiable without re-fetching: a reader who wants
        // to check that the 2016 marks went to Cleveland and not to Golden
        // State can do it from this list, and so can a test.
        champions,
        // AND WHO WON THE FINALS EACH SEASON, for the same reason and checked
        // the same way. This is EVERY holder the playoff column named, not only
        // the ones who have a card — so a reader can tell a season whose Finals
        // MVP is out of the pool from one the join missed.
        finalsMvps,
        counts,
        sets,
      },
      null,
      1
    )}\n`
  );

  const log = console.log;
  log(`Seasons read: ${seasons.length} (${fetched} page fetches)`);
  log(
    `Champions resolved: ${champions.length} of ${seasons.length} ` +
      `(${champions.map(c => `${c.season} ${c.abbr}`).join(', ')})`
  );
  log(
    `Finals MVPs read: ${finalsMvps.length} of ${seasons.length} ` +
      `(${finalsMvps.map(f => `${f.season} ${f.name}`).join(', ')})`
  );
  for (const [set, c] of Object.entries(counts)) {
    log(
      `  ${set.padEnd(14)} ${String(c.marked).padStart(3)} of ${String(c.cards).padStart(3)} ` +
        `cards marked  (${c.multiple} with more than one; ` +
        `most held ${c.mostHeld}; ` +
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
