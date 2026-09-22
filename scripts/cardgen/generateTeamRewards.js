// TEAM COMPLETION REWARDS: one card per franchise, earned by collecting that
// team's entire 2026-27 roster.
//
//   node scripts/cardgen/generateTeamRewards.js
//
// THE PICK RULE, and why it is not "the best player who ever played there".
// A reward for a long collection grind has to be desirable without being
// meta-defining — hand someone peak Shaq for finishing the Lakers and the
// reward decides games rather than celebrating a milestone. So a pick is a
// player ABSENT from every other set, chosen for how identified he is with the
// franchise, landing just INSIDE the band that franchise has earned rather than
// at the top of it. The candidate search offers a $2,580 Westbrook; the Thunder
// reward is a $1,330 one.
//
// THE BAND IS EARNED, NOT CHOSEN. The thirty rosters are ranked by expected
// packs to complete (src/game/collectionDifficulty.js) and split into even
// thirds: hardest ten pay legendary, middle ten super-rare, easiest ten rare.
// Before this ladder existed every franchise paid the same rare card, so
// finishing Oklahoma City — ~200 team packs — was worth exactly what finishing
// Milwaukee is worth at eleven. assertEarnedBands below stops the build if a
// reprice ever drifts a card out of the band its franchise earned.
//
// HISTORICAL CODES MAP TO THE CURRENT FRANCHISE — a New Jersey Nets season
// rewards Brooklyn, a Seattle season rewards Oklahoma City — because the
// collection being completed is a modern roster. The card still PRINTS the
// era team it was played for, which franchiseForSeason resolves.
//
// The stat line is that season's own row for that team, through the same
// buildSet every special set uses.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCache, REPO_ROOT } from './cache.js';
import { normalizeName } from './resolveTeams.js';
import { NEVER_CARD_NAMES } from '../../src/game/neverCard.js';
import { buildSet, resolvePlayerIds } from './generateSpecialSets.js';
import { CALIBRATION_FILE } from './calibrateAttributes.js';
import { franchiseForSeason, canonicalTeam } from '../../src/cards/teams.js';
import { getPlayerRarity } from '../../src/game/rarity.js';
import { CARD_SETS, BASE_SET } from '../../src/game/cardSets.js';
import { rewardBandFor } from '../../src/game/collectionDifficulty.js';
import { indexBiometrics, loadBiometrics } from './biometrics.js';
import { indexPositionShares, loadPositionShares } from './positionShares.js';
import * as PV from './playValue.js';
import * as A from './attributes.js';
import { buildApiEpmIndex, buildBpmBridge } from './summerStandouts.js';
import { archiveBasis, requireArchive } from './epmArchive.js';
import { nbaCareerContext, nbaIdentityFor, settleTwin, wornByMigrated } from './rewardIdentity.js';
export { wornByMigrated };
import { setBadge } from '../../src/cards/sets.js';
import { BEST_SEASON_BADGE, SUPER_SEASON_BADGE } from '../../src/cards/badges.js';


export const SET_ID = 'team-rewards';
const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const OUTPUT_FILE = path.join(GEN_DIR, `cards-${SET_ID}.json`);
export const REWARDS_FILE = path.join(REPO_ROOT, 'card-data', 'team-rewards-2026.json');
const LAST_SEASON = 2026;
export const MIN_SYNTH_GAMES = 20;
export const CAP_SYNTH_MPG = 38;

const seasonLabel = season => `${season - 1}-${String(season).slice(2)}`;

/**
 * Players excluded from this game permanently, by the owner's decision.
 * Enforced HERE as well as in the data file so a future re-pick — a rerun of
 * the candidate query, a new franchise, an edit by anyone — cannot quietly
 * put one back. Matched on the normalized name, and on every name the player
 * has been listed under: Basketball-Reference retroactively renames, which is
 * exactly how this one entered the list in the first place.
 */
// Stored NORMALIZED, because every check is `NEVER_CARD.has(normalizeName(x))`
// and normalizeName strips spaces. Written as 'enes kanter' this set matched
// nothing, anywhere, until 2026-09-10 (caught by the Free Agents quote tests).
// The names live in src/game/neverCard.js, which the site and server read too.
export const NEVER_CARD = new Set(NEVER_CARD_NAMES.map(normalizeName));

/**
 * Every reward pick, franchises and the tiers above them, in file order.
 *
 * TWO SECTIONS, ONE LIST. `picks` is keyed by franchise and `tiers` by goal id,
 * because a conference reward is not a franchise's — but both produce the same
 * kind of card and both go through the same build, so they are flattened here
 * rather than duplicating the pipeline. `goal` is the field that survives:
 * `franchise` is only meaningful for the thirty.
 */
export function readTeamRewards(file = REWARDS_FILE) {
  if (!fs.existsSync(file)) return { built: [], moved: [] };
  const { picks = {}, tiers = {}, migrated = {} } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const built = [];
  const moved = [];
  const guard = (key, name) => {
    if (NEVER_CARD.has(normalizeName(name))) {
      throw new Error(
        `card-data/team-rewards-2026.json names ${name} for ${key}, who is permanently ` +
          'excluded from this game. Pick someone else.'
      );
    }
  };
  const take = (key, p, franchise) => {
    const goal = p.goal ?? (franchise ? `nba-team-${franchise}` : key);
    // A row naming a SET and an ID is a card to move; a row naming a player and
    // a season is a card to build.
    if (p.set && p.id) { moved.push({ franchise, goal, set: p.set, id: p.id, bandException: p.bandException }); return; }
    guard(key, p.name);
    built.push({ franchise, goal, ...p });
  };
  for (const [franchise, p] of Object.entries(picks)) take(franchise, p, franchise);
  for (const [franchise, p] of Object.entries(migrated)) take(franchise, p, franchise);
  for (const [goalId, p] of Object.entries(tiers)) take(goalId, p, null);
  return { built, moved };
}

/**
 * Take a finished card out of another set and make it a team reward.
 *
 * ── WHY MOVE RATHER THAN REBUILD ────────────────────────────────────────────
 *
 * The card is already correct. It was built by its own set's generator from the
 * same pipeline, priced against the same base field, with its chart cut from
 * the same real game logs — rebuilding it here would produce the same numbers
 * by a longer road, and any drift between the two roads would be a bug nobody
 * would notice. So it is carried across whole and only re-labelled.
 *
 * ── WHAT CHANGES AND WHAT DOES NOT ──────────────────────────────────────────
 *
 * Changes: `set`, and the reward fields that say what earns it.
 * Does NOT change: the numbers, the era team, the season, the art.
 *
 * `badges` gains the ORIGIN SET'S badge, and this is the whole point of moving
 * rather than copying. The team-rewards set declares TEAM REWARD, which becomes
 * the leading pill; the badge added here prints underneath it. A migrated Super
 * Season card therefore says TEAM REWARD over SUPER SEASON, which is exactly
 * what it is — the badge is not decoration, it is the reason the card is worth
 * winning.
 */
export const ORIGIN_BADGE = {
  'super-season': 'super-season',
  rookie: 'rookie',
  'summer-standouts': 'summer-standout',
  // A demoted Super Season (generateSpecialSets BEATEN_BY_ROOKIE, 2026-09-22)
  // lives in cards-throwbacks.json; David Robinson's Spurs reward comes from there.
  throwbacks: 'throwback',
};

/**
 * ── AND SINCE 2026-09-22 THE CARD WEARS ITS IDENTITY ────────────────────────
 *
 * The user (2026-09-18): "If a card does not qualify for super season or
 * rookie (or dissonance), 26-27, they should be throwbacks." A reward keeps
 * being the reward, but `wears` names the set whose LOOK it takes — gold for a
 * Super Season, green for a Rookie, the brush for a Throwback, its own for a
 * Summer Standout — and cardTreatment (src/cards/sets.js) reads exactly that
 * one field. The identity badge goes into `badges` too, for the audit, the
 * awards join and every reader older than the field.
 *
 * A MIGRATED card wears the set it came from, except a flagged Super Season
 * (wornByMigrated in rewardIdentity.js — Stockton's ruling); a BUILT card is
 * judged by the Free Agents classifier (wornByBuilt below).
 */
function moveCard({ set, id, franchise, goal, bandException }) {
  const file = path.join(GEN_DIR, `cards-${set}.json`);
  if (!fs.existsSync(file)) throw new Error(`Cannot migrate from ${set}: ${file} does not exist.`);
  const source = JSON.parse(fs.readFileSync(file, 'utf8')).cards.find(c => c.id === id);
  if (!source) throw new Error(`Cannot migrate ${set}:${id} — no such card in that set.`);
  const badge = ORIGIN_BADGE[set];
  if (!badge) throw new Error(`No origin badge declared for set ${set}.`);
  const wears = wornByMigrated(source, set);
  // A dropped claim stays dropped: the flagged card keeps its badges WITHOUT
  // super-season and gains the badge of what it wears instead.
  const carried = (source.badges ?? []).filter(b => !(source.notBestSeason && b === SUPER_SEASON_BADGE));
  const identity = wears === set ? badge : setBadge(wears);
  return {
    ...source,
    set: SET_ID,
    badges: [...new Set([...carried, identity])],
    wears,
    migratedFrom: { set, id },
    rewardFor: franchise,
    rewardGoal: goal,
    ...(bandException ? { bandException } : {}),
  };
}

/** One season's rows of one kind, raw — stint rows included. */
function seasonRows(season, kind) {
  let cached;
  try { cached = readCache(`bbref-${season}-${kind}-full`); } catch { return []; }
  const rows = Array.isArray(cached) ? cached : cached?.rows ?? cached?.data ?? [];
  return rows;
}

/** The row for one player's stint on one team, or null. */
function stintRow(rows, name, team) {
  return rows.find(
    r => normalizeName(r.name) === normalizeName(name) && r.team === team
  ) ?? null;
}

/** The player's SEASON-WIDE minutes — the aggregate row where one exists. */
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
 * Every reward must land in the band its franchise EARNED.
 *
 * ── WHY THIS IS A THROW AND NOT A WARNING ───────────────────────────────────
 *
 * The whole point of the ladder is that a harder collection pays a better card,
 * and nothing else in the pipeline defends that. Salary is a computed play
 * value: it moves when the pool moves, when the shooting calibration moves,
 * when a player's own last-82 window moves. Taj Gibson sat at $890 for months
 * and drifted to $920 on a routine rebuild — one band up, silently, into the
 * tier that is supposed to mean "you finished one of the ten hardest rosters".
 *
 * A ladder that can quietly flatten is worse than no ladder, because it still
 * looks like one. So the check runs at generation time and stops the build.
 */
function assertEarnedBands(cards) {
  const wrong = cards
    .map(card => {
      // Only the thirty franchises sit on the ladder. The conference and set
      // tiers are ABOVE it by construction — six and a half and sixteen times
      // the hardest roster — so there is no band for them to be out of, and
      // rewardBandFor correctly returns null.
      const want = rewardBandFor(card.rewardGoal ?? `nba-team-${card.rewardFor}`);
      const got = getPlayerRarity(card);
      // A DECLARED EXCEPTION IS ALLOWED, and has to say why. The bands are a
      // ladder, not a law: Philadelphia's best off-roster Philly-jersey card is
      // Julius Erving's 1976-77 at twenty dollars under the legendary floor,
      // and holding the line there would mean rewarding the Sixers with a
      // second Joel Embiid instead. The exception is recorded on the pick so it
      // is visible rather than silently tolerated.
      if (card.bandException) return null;
      return want && got !== want.band
        ? `  ${card.rewardFor}: ${card.name} ${card.seasonLabel} priced $${card.salary} (${got}), ` +
          `but ${card.rewardFor} earns ${want.band} ($${want.salary[0]}-${want.salary[1]})`
        : null;
    })
    .filter(Boolean);
  if (wrong.length === 0) return;
  throw new Error(
    `Team rewards are out of their earned difficulty bands:\n${wrong.join('\n')}\n` +
      'Re-pick with: node scripts/cardgen/teamRewardCandidates.js <TEAM>'
  );
}

/**
 * The identity a BUILT reward wears, and the badges that say so.
 *
 * Until 2026-09-22 this was `builtBadges`: it rebuilt the career from the
 * 2002+ tables and asked "first season? best season?" of that — and stamped
 * Anthony Parker's 2006-07 with a false ROOKIE, because his 1997-98 debut sat
 * in the 1985+ archive it never read. The judge is now the Free Agents
 * classifier over the WHOLE archive (rewardIdentity.js): rookie, super-season
 * or throwbacks by the rules the shipped sets use, and the twin rule settled
 * AFTER pricing because gold is a salary line. Never bbref-history (pool
 * careers only) and never a truncated window.
 *
 * `identity` is what nbaIdentityFor returned before pricing; the card's
 * salary is known here. A rookie year that is also the best but prints under
 * the gold line stays a Rookie wearing the BEST SEASON pill too, exactly as
 * generateSpecialSets' same-season twins do.
 */
export function wornByBuilt(identity, salary) {
  const wears = settleTwin(identity.wears, { ...identity, salary });
  const badges = [setBadge(wears)];
  if (wears === 'rookie' && identity.alsoBest) badges.push(BEST_SEASON_BADGE);
  return { wears, badges };
}

/**
 * A reward may never be a WORSE card than the one it celebrates.
 *
 * ── THE BUG THIS EXISTS FOR ─────────────────────────────────────────────────
 *
 * Ten of the thirty rewards were downgrades. Completing Houston won an Amen
 * Thompson card weaker than the Amen Thompson already pullable from a booster;
 * Memphis paid a Ja Morant $350 below his own. The cause was structural rather
 * than careless: picks target the LOW end of their band to stay out of
 * meta-defining territory, the band comes from COLLECTION DIFFICULTY, and
 * collection difficulty knows nothing about how good that player's current card
 * happens to be. Two correct rules multiplying into a wrong answer.
 *
 * So the comparison is made explicitly. If the reward's player has a 2026-27
 * card anywhere in the league, the reward must beat it.
 */
function assertUpgrades(cards) {
  const base = new Map((CARD_SETS[BASE_SET] ?? []).map(c => [c.name, c]));
  const wrong = cards
    .map(card => {
      const current = base.get(card.name);
      return current && card.salary <= current.salary
        ? `  ${card.rewardFor ?? card.rewardGoal}: ${card.name} ${card.seasonLabel} pays $${card.salary}, ` +
          `but his 2026-27 ${current.team} card is $${current.salary}`
        : null;
    })
    .filter(Boolean);
  if (wrong.length === 0) return;
  throw new Error(
    `Team rewards that are WORSE than the card they celebrate:\n${wrong.join('\n')}\n` +
      'A reward has to be an upgrade. Re-pick with: node scripts/cardgen/teamRewardCandidates.js <TEAM>'
  );
}

export function main({ log = console.log, enforceBands = true } = {}) {
  const { built: picks, moved } = readTeamRewards();
  if (picks.length + moved.length === 0) {
    throw new Error('card-data/team-rewards-2026.json names no picks.');
  }

  const calibration = JSON.parse(fs.readFileSync(CALIBRATION_FILE, 'utf8'));
  const historyCache = readCache('bbref-history');
  const archiveRows = historyCache?.data?.rows ?? historyCache?.rows ?? [];
  const pool = JSON.parse(fs.readFileSync(path.join(GEN_DIR, 'player-pool-2026.json'), 'utf8'));
  const biometrics = indexBiometrics(loadBiometrics());
  const positionShares = indexPositionShares(loadPositionShares());
  const apiEpm = buildApiEpmIndex();
  // THE PRE-2002 BPM BRIDGE, the same one the Super Season legends and the
  // Free Agents builder cross on. Until 2026-09-22 a built pick's skill came
  // only from the dunksandthrees index, which opens in 2002, so Vince Carter's
  // 1999-2000 — the Raptors reward the user picked by name — would have been
  // priced with no EPM at all ($620 instead of ~$1310). Built lazily: only a
  // pick the index does not reach pays for the archive load.
  let bridgeInstance = null;
  const bridge = () => {
    if (!bridgeInstance) bridgeInstance = buildBpmBridge(archiveBasis(requireArchive()));
    return bridgeInstance;
  };
  // The whole-archive careers the identity of a built pick is judged on.
  const identityCtx = nbaCareerContext();

  const currentByName = new Map();
  for (const row of archiveRows) {
    if (row.season !== LAST_SEASON) continue;
    const prev = currentByName.get(row.playerId);
    if (!prev || (row.games ?? 0) > (prev.games ?? 0)) currentByName.set(row.playerId, row);
  }
  const poolIds = new Set(resolvePlayerIds(pool, archiveRows).ids.values());
  const currentRows = [...currentByName.values()].filter(r => poolIds.has(r.playerId));

  const selections = [];
  const meta = [];
  const missing = [];
  for (const pick of picks) {
    const adv = seasonRows(pick.season, 'advanced');
    const pp = seasonRows(pick.season, 'perPoss');
    const shooting = seasonRows(pick.season, 'shooting');
    const advRow = stintRow(adv, pick.name, pick.team);
    const ppRow = stintRow(pp, pick.name, pick.team);
    if (!advRow || !ppRow) {
      missing.push(`${pick.goal}: ${pick.name} ${pick.team} ${pick.season} (no season row)`);
      continue;
    }
    const rim = stintRow(shooting, pick.name, pick.team);
    let epm = apiEpm.get(`${normalizeName(pick.name)}|${pick.season}`);
    if (!epm && Number.isFinite(advRow.bpm)) {
      epm = {
        epm: bridge().epmFromBpm(advRow.bpm),
        ewinsPerGame: bridge().ewinsPerGameFromVorp(advRow.vorp, advRow.games),
      };
    }
    const realGames = advRow.games ?? 0;
    const realMpg = realGames > 0 ? (advRow.minutes ?? 0) / realGames : 0;
    selections.push({
      player: { name: pick.name, pos: advRow.pos },
      season: {
        ...advRow, ...ppRow,
        playerId: advRow.playerId,
        season: pick.season,
        games: Math.max(realGames, MIN_SYNTH_GAMES),
        minutes: Math.max(realGames, MIN_SYNTH_GAMES) * Math.min(realMpg, CAP_SYNTH_MPG),
        rimPct: rim?.rimPct ?? null,
        rimShare: rim?.rimShare ?? null,
        epm: epm?.epm ?? null,
        ewinsPerGame: epm?.ewinsPerGame ?? null,
        trustMinutes: seasonMinutes(adv, pick.name),
      },
    });
    meta.push({
      ...pick, realGames, realMpg, playerId: advRow.playerId,
      identity: nbaIdentityFor(identityCtx, advRow.playerId, pick.season),
    });
  }
  if (missing.length) {
    // Hand-picked, one per franchise: a missing row leaves a team unrewardable
    // and is a data problem to fix, not a card to drop.
    throw new Error(`Team reward seasons missing:\n  ${missing.join('\\n  ')}`);
  }

  // ── CHARTS COME FROM REAL GAMES, like every other set ─────────────────────
  //
  // This ran on `useRealGames: false` — per-100 season rates — for no reason
  // except that the game logs were never fetched. Dissonance opts out for a
  // real reason (its cards are mid-season STINTS and a full-season log would
  // contradict the printed stat line); none of these thirty-three is a stint,
  // so this set had no such excuse.
  //
  // The cost of the omission was not cosmetic. Per-100 rates smooth a chart
  // toward the player's mean instead of cutting it from the spread of actual
  // games, and REBOUNDS AND ASSISTS ARE CURRENCY in playValue.js — 4 AST buys a
  // 3PT check, 3 REB a paint check. The smoothing put the reward set's median
  // assist row at 0.75 where every real-log set sits at 0.00-0.25, and that
  // fictional currency was being paid for in salary.
  const cards = buildSet({
    selections, currentRows, calibration, biometrics, positionShares, useRealGames: true,
  }).map((card, i) => ({
    ...card,
    team: franchiseForSeason(canonicalTeam(meta[i].team), meta[i].season),
    season: meta[i].season,
    seasonLabel: seasonLabel(meta[i].season),
    games: meta[i].realGames,
    mpg: Number(meta[i].realMpg.toFixed(1)),
    // WHICH ROSTER EARNS IT. The card prints its era team, but the reward is
    // unlocked by completing the CURRENT franchise — those differ for every
    // New Jersey, Seattle, Charlotte-Hornets and New-Orleans-Hornets pick.
    // `rewardFor` stays a bare franchise code for the thirty and is null above
    // them; `rewardGoal` is the field that always answers "what earns this",
    // and is what collections.js keys on.
    rewardFor: meta[i].franchise,
    rewardGoal: meta[i].goal,
    // A declared band exception travels from the pick to the card, the way it
    // already does for a MIGRATED one (moveCard). Without this a BUILT pick
    // could not carry one at all, which is how Miami sat unbuildable: Alonzo
    // Mourning's 2005-06 prices $40 under the super-rare floor and the user
    // wants him anyway ("Mourning is a fun enough card that it seems fine as
    // a reward", 2026-09-07).
    ...(meta[i].bandException ? { bandException: meta[i].bandException } : {}),
  }));

  PV.priceAgainstBase(cards, { roundSalary: A.roundSalary, min: A.SALARY_MIN, max: A.SALARY_MAX });

  // WHAT EACH BUILT CARD WEARS, settled now that the salary is known (the twin
  // rule is a gold-line question). The badge is stamped beside it.
  cards.forEach((card, i) => {
    const { wears, badges } = wornByBuilt(meta[i].identity, card.salary);
    card.wears = wears;
    card.badges = badges;
    log(`  ${meta[i].goal}: ${card.name} ${card.seasonLabel} $${card.salary} wears ${wears}`);
  });

  // MIGRATED CARDS ARE NOT REPRICED. They were priced by their own set against
  // the same base field; running them through priceAgainstBase again in this
  // batch would move them, because the shooting layer upstream assigns shot
  // lines by percentile within whatever array it is handed. The card that shows
  // up in a collection has to be the card the player saw in Super Season.
  cards.push(...moved.map(moveCard));
  cards.sort((a, b) => b.salary - a.salary);
  // `enforceBands: false` is for the re-pick loop only — it lets a caller SEE
  // every salary at once instead of learning them one thrown error at a time.
  // Nothing that writes the shipped file uses it.
  if (enforceBands) {
    assertEarnedBands(cards);
    assertUpgrades(cards);
  }

  fs.mkdirSync(GEN_DIR, { recursive: true });
  const body = {
    generatedAt: new Date().toISOString(),
    set: SET_ID,
    provisional: true,
    sources: {
      roster: `card-data/team-rewards-2026.json — ${moved.length} cards MOVED from Super Season/Rookie/Summer Standouts, ${picks.length} built (franchise picks and the 3 tiers)`,
      identity: 'every card WEARS its identity (wears): the set it came from, or for a built pick the Free Agents classifier over the 1976-2026 archive (rewardIdentity.js)',
      statLine: "that season's own row for that team, from the full-league tables",
      skill: 'EPM from the season table, Speed+Power trust from the season minutes',
      pricing: 'play value against the base set, like every special set',
      unlock: 'collect the goal named by rewardGoal — a franchise roster, a conference, or the full set',
    },
    cards,
  };
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(body, null, 1)}
`);
  log(`Team rewards: ${cards.length} cards (${moved.length} moved, ${picks.length} built).`);
  log(`  ${OUTPUT_FILE}`);
  return body;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
