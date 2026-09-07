// WNBA FRANCHISE COMPLETION REWARDS — the card you get for finishing a roster.
//
//   node scripts/cardgen/wnba/generateWnbaRewards.js
//
// ── HOW THIS DIFFERS FROM THE NBA REWARD SET ────────────────────────────────
//
// The NBA set is mostly MIGRATION: twenty-seven of its thirty-three cards were
// MOVED out of Super Season, Rookie or Summer Standouts, because those sets had
// already mined exactly the seasons a stacked franchise would want to reward.
// Almost nothing like that happens here, and for a reason: the two WNBA special
// sets hold sixteen legends and a rookie class between them, and emptying a
// roster the user named by hand to feed this one would cost more than it pays.
// So twelve of the thirteen are BUILT.
//
// THE EXCEPTION IS BECKY HAMMON, and it is the case migration exists for. Her
// Super Season card is San Antonio 2009; the Aces reward this search picked was
// San Antonio 2008. Two Hammon cards, same jersey, adjacent years, one winnable
// and one packable — which is exactly the duplicate the NBA set's migration
// rule was written to prevent. The user's call: move the Super Season card
// rather than print a second one. It clears the legendary floor on its own, so
// nothing about the ladder bends to accommodate it.
//
// This makes the pricing harder in a way worth stating. A BUILT card's salary
// is not known until it is built, and buildShootingLayer assigns shot lines by
// PERCENTILE WITHIN THE BATCH IT IS HANDED — so the number a shortlist run
// reports is not the number this run prints. That is what assertEarnedBands is
// for: the shortlist proposes, the build disposes. A MIGRATED card is not
// repriced at all (see moveCard), so the two kinds are checked the same way but
// arrive at their salaries differently.
//
// ── THE THREE RULES, SAME AS THE NBA SET ────────────────────────────────────
//
//   1. HARD — the card wears that franchise's jersey. A reward for collecting
//      the Storm is a Storm card, whatever era it prints.
//   2. HARD — it is an upgrade on that player's own current card, if she has
//      one. Rewarding Indiana with a WORSE Aliyah Boston would make finishing
//      the roster a punishment.
//   3. PREFERRED — she is off that team's CURRENT roster, so the reward is a
//      card the collection could not otherwise produce. Exceptions are declared
//      in the picks file, never silent.
//
// Rule 2 is why Tamika Catchings is here at all. She is carded in the WNBA
// Super Season set on one season, which under a by-NAME exclusion would lock
// the Fever — the hardest collection in the league — out of every legendary
// card it could possibly earn. The NBA set answers this with a BY-SEASON
// allowance, and so does this: a carded player on a DIFFERENT season is a
// different card, and thirteen other Catchings years qualify.
//
// ── WHO IS NOT HERE ─────────────────────────────────────────────────────────
//
// Golden State and Toronto. Not an omission and not a gap in the search: the
// Valkyries have one season of history and every in-band player in it is on the
// 2026 roster, and the Tempo have no history at all. Both stay coins-only
// goals, which is what a coins-only goal is for. See `_excluded` in the picks
// file.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from '../cache.js';
import { normalizeName } from '../resolveTeams.js';
import { CALIBRATION_FILE } from '../calibrateAttributes.js';
import { getPlayerRarity } from '../../../src/game/rarity.js';
import { CARD_SETS } from '../../../src/game/cardSets.js';
import { rewardBandFor } from '../../../src/game/collectionDifficulty.js';
import { WNBA_SET } from '../../../src/cards/sets.js';
import * as PV from '../playValue.js';
import * as A from '../attributes.js';
import { loadArchive, rateArchive, buildWnbaCards } from './generateWnbaLegends.js';
import { franchiseOf, MIN_GAMES } from './wnbaRewardCandidates.js';

/**
 * The badge a migrated card keeps from the set it came from.
 *
 * A team reward that used to be a Super Season card is STILL somebody's best
 * season — that claim did not stop being true when the card changed sets — so
 * it prints both marks: the set's own TEAM REWARD leads and this one follows.
 * Declared as a map rather than assumed, so a migration from a set with no
 * badge is an error instead of a silently unbadged card.
 */
export const ORIGIN_BADGE = {
  'wnba-super-season': 'super-season',
  'wnba-rookie': 'rookie',
};

export const SET_ID = 'wnba-team-rewards';
const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const OUTPUT_FILE = path.join(GEN_DIR, `cards-${SET_ID}.json`);
export const REWARDS_FILE = path.join(REPO_ROOT, 'card-data', 'wnba-team-rewards-2026.json');
const MODEL_FILE = path.join(GEN_DIR, 'wnba-bpm-model.json');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * The picks file, flattened to a list.
 *
 * `_comment` and `_excluded` are documentation and are dropped here; they are
 * the reasons, and the reasons belong next to the data rather than in a commit
 * message nobody will read again.
 */
export function readWnbaRewards(file = REWARDS_FILE) {
  const { picks = {}, migrated = {} } = readJson(file);
  return {
    built: Object.entries(picks).map(([franchise, pick]) => ({ franchise, ...pick })),
    moved: Object.entries(migrated).map(([franchise, move]) => ({ franchise, ...move })),
  };
}

/**
 * Lift a card out of the set it was printed in and into this one.
 *
 * NOT A COPY. The card leaves its old set — src/game/cardSets.js filters on
 * `migratedFrom`, so the game holds exactly one of it — because a reward that
 * is also packable is not a reward. Everything else about the card is
 * untouched, salary above all: it was priced against the same base field by its
 * own set, and re-pricing it in THIS batch would move it, since the shooting
 * layer upstream assigns shot lines by percentile within whatever array it is
 * handed. The card a player wins has to be the card they saw in Super Season.
 */
function moveCard({ set, id, franchise, goal, bandException }) {
  const file = path.join(GEN_DIR, `cards-${set}.json`);
  if (!fs.existsSync(file)) throw new Error(`Cannot migrate from ${set}: ${file} does not exist.`);
  const source = readJson(file).cards.find(c => c.id === id);
  if (!source) throw new Error(`Cannot migrate ${set}:${id} — no such card in that set.`);
  const badge = ORIGIN_BADGE[set];
  if (!badge) throw new Error(`No origin badge declared for set ${set}.`);
  return {
    ...source,
    set: SET_ID,
    badges: [...new Set([...(source.badges ?? []), badge])],
    migratedFrom: { set, id },
    rewardFor: franchise,
    rewardGoal: goal,
    ...(bandException ? { bandException } : {}),
  };
}

/**
 * The rated archive row a pick names.
 *
 * Matched on NAME + SEASON + the stat row's own team code, because none of the
 * three identifies a season on its own: a name repeats across a career, a
 * season holds the whole league, and a player traded mid-year has two rows in
 * it. The team code is the one that disambiguates the last case, and it is why
 * the picks file records the ERA code (Katie Smith's 2008 is DET, not DAL).
 */
function findRow(pick, seasons) {
  const entry = seasons.get(pick.season);
  if (!entry) {
    throw new Error(
      `${pick.franchise}: season ${pick.season} is not in the archive. ` +
        'Run `node scripts/cardgen/wnba/fetchWnbaHistory.js`.'
    );
  }
  const want = normalizeName(pick.name);
  const rows = (entry.rows ?? []).filter(
    r => normalizeName(r.name) === want && String(r.team).toUpperCase() === pick.team.toUpperCase()
  );
  if (rows.length === 0) {
    throw new Error(
      `${pick.franchise}: no ${pick.season} row for ${pick.name} on ${pick.team}. ` +
        'Check the spelling and the era team code against Basketball-Reference.'
    );
  }
  // A player with two stints on the SAME team in one season is vanishingly
  // rare, but taking the fuller one is the same call every other generator
  // makes and costs nothing to state.
  return rows.sort((a, b) => (b.games ?? 0) - (a.games ?? 0))[0];
}

/**
 * The jersey rule, rule 1, and the only one that is about the card rather than
 * about its price.
 *
 * `franchiseOf` is the same resolver the candidate search uses, so a Detroit
 * Shock season resolving to Dallas passes here for exactly the reason it was
 * offered there. A mismatch means the picks file names a season the franchise
 * never played, which is a typo, not a judgement call.
 */
function assertFranchise(picks, rows) {
  const wrong = picks
    .map((pick, i) => {
      const got = franchiseOf(rows[i].team);
      return got === pick.franchise
        ? null
        : `  ${pick.franchise}: ${pick.name} ${pick.season} played for ${rows[i].team}, ` +
          `which is ${got ?? 'a franchise that no longer exists'} — not ${pick.franchise}`;
    })
    .filter(Boolean);
  if (wrong.length === 0) return;
  throw new Error(`WNBA rewards wearing the wrong jersey:\n${wrong.join('\n')}`);
}

/**
 * Rule 2. A reward has to beat the card it celebrates.
 *
 * Keyed on NAME against the current WNBA set, which is the only set whose cards
 * a collector can already own from a WNBA pack. A player absent from it — most
 * of this roster — has nothing to be worse than and passes trivially.
 */
function assertUpgrades(cards) {
  const current = new Map((CARD_SETS[WNBA_SET] ?? []).map(c => [normalizeName(c.name), c]));
  const wrong = cards
    .map(card => {
      const base = current.get(normalizeName(card.name));
      return base && card.salary <= base.salary
        ? `  ${card.rewardFor}: ${card.name} ${card.seasonLabel} pays $${card.salary}, ` +
          `but her ${base.season} ${base.team} card is $${base.salary}`
        : null;
    })
    .filter(Boolean);
  if (wrong.length === 0) return;
  throw new Error(
    `WNBA rewards that are WORSE than the card they celebrate:\n${wrong.join('\n')}\n` +
      'A reward has to be an upgrade. Re-pick with: node scripts/cardgen/wnba/wnbaRewardCandidates.js <TEAM>'
  );
}

/**
 * The difficulty ladder, enforced.
 *
 * A franchise earns a BAND from how many packs its roster takes to complete,
 * and the card it rewards has to sit in that band. This is the assertion the
 * whole set exists to satisfy, and it runs on the BUILT salary rather than the
 * shortlist's, because the shortlist priced a different batch.
 *
 * A declared `bandException` is allowed and has to say why — the same escape
 * the NBA set gives Philadelphia. None of the thirteen currently uses one.
 */
function assertEarnedBands(cards) {
  const wrong = cards
    .map(card => {
      if (card.bandException) return null;
      const want = rewardBandFor(card.rewardGoal);
      const got = getPlayerRarity(card);
      return want && got !== want.band
        ? `  ${card.rewardFor}: ${card.name} ${card.seasonLabel} priced $${card.salary} (${got}), ` +
          `but ${card.rewardFor} earns ${want.band} ($${want.salary[0]}-${want.salary[1]})`
        : null;
    })
    .filter(Boolean);
  if (wrong.length === 0) return;
  throw new Error(
    `WNBA rewards are out of their earned difficulty bands:\n${wrong.join('\n')}\n` +
      'Re-pick with: node scripts/cardgen/wnba/wnbaRewardCandidates.js <TEAM>'
  );
}

export function main({ log = console.log, enforceBands = true } = {}) {
  const { built: picks, moved } = readWnbaRewards();
  if (picks.length + moved.length === 0) {
    throw new Error('card-data/wnba-team-rewards-2026.json names no picks.');
  }

  const calibration = readJson(CALIBRATION_FILE);
  const model = readJson(MODEL_FILE);
  const { loaded } = loadArchive();
  if (loaded.length === 0) {
    throw new Error(
      'No cached WNBA season tables — run `node scripts/cardgen/wnba/fetchWnbaHistory.js` first.'
    );
  }
  const seasons = rateArchive(loaded, model);
  const reference = seasons.get(Math.max(...seasons.keys()));

  const rows = picks.map(pick => findRow(pick, seasons));
  assertFranchise(picks, rows);

  const thin = picks
    .map((pick, i) =>
      (rows[i].games ?? 0) < MIN_GAMES ? `${pick.name} ${pick.season} (${rows[i].games}g)` : null
    )
    .filter(Boolean);
  if (thin.length) {
    throw new Error(
      `WNBA rewards cut from too few games (min ${MIN_GAMES}): ${thin.join(', ')}. ` +
        'A chart from a part-season is a chart of an injury.'
    );
  }

  // The same pipeline the Super Season legends run through, so a reward sits on
  // the same yardstick as the set it could have been migrated from. Pricing is
  // a SEPARATE step downstream of the build — buildWnbaCards leaves salary null
  // on purpose, because the play-value model needs the finished chart.
  const cards = buildWnbaCards({
    selections: picks.map((pick, i) => ({ name: pick.name, era: null, best: rows[i] })),
    seasons,
    reference,
    calibration,
  }).map((card, i) => ({
    ...card,
    // WHICH ROSTER EARNS IT. The card prints its era team — Hammon's SAS, the
    // Shock's DET — but the reward is unlocked by completing the CURRENT
    // franchise, and `rewardGoal` is the field collections.js keys on.
    rewardFor: picks[i].franchise,
    rewardGoal: picks[i].goal,
    ...(picks[i].bandException ? { bandException: picks[i].bandException } : {}),
  }));

  PV.priceAgainstBase(cards, { roundSalary: A.roundSalary, min: A.SALARY_MIN, max: A.SALARY_MAX });

  // AFTER pricing, never through it — see moveCard.
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
      roster:
        'card-data/wnba-team-rewards-2026.json — 13 franchises; Golden State and Toronto stay coins-only',
      statLine: "that season's own row for that team, from the cached full-league tables",
      skill: 'the fitted BPM equivalent, same model as the WNBA Super Season set',
      pricing: 'play value against the base set, like every special set',
      unlock: 'collect the franchise named by rewardGoal',
    },
    cards,
  };
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(body, null, 1)}\n`);
  log(`WNBA team rewards: ${cards.length} cards (${moved.length} moved, ${picks.length} built).`);
  for (const card of cards) {
    const band = rewardBandFor(card.rewardGoal);
    log(
      `  ${String(card.rewardFor).padEnd(4)} $${String(card.salary).padStart(4)} ` +
        `${String(getPlayerRarity(card)).padEnd(11)} ${card.seasonLabel} ` +
        `${String(card.team).padEnd(5)} ${card.name}` +
        (card.migratedFrom ? `   [moved from ${card.migratedFrom.set}]` : '') +
        (band ? '' : '   [no band]')
    );
  }
  log(`  ${OUTPUT_FILE}`);
  return body;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
