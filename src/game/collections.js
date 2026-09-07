// Collection goals: the things a player can complete, and what completing pays.
//
// ── THE LADDER ──────────────────────────────────────────────────────────────
//
//   TEAM        every base card of one franchise      NBA x30, WNBA x15
//   CONFERENCE  every base card of one conference     NBA x2
//   SET         every base card in the league         NBA x1, WNBA x1
//
// THE WNBA HAS NO CONFERENCE TIER, and that is a fact about the league rather
// than an omission: it fields fifteen teams, so there is no even split to make,
// and the modern league does not run conference standings. Inventing an
// East/West here would mean inventing a 7-8 division and calling it real.
//
// ── WHAT COMPLETION MEANS ───────────────────────────────────────────────────
//
// One copy of every card in the goal's base set. Only base cards count: a
// Rookie or Super Season card of the same player is a different key, and
// letting one substitute would make "the Lakers roster" mean something
// different for every player depending on which mix they happened to own.
//
// Requirements are DERIVED FROM THE CARDS, never hand-listed, so a pool change
// moves every goal with it and the two can not drift apart. A conference is the
// union of its teams' rosters and a set is the union of everything, which also
// means the tiers are automatically consistent: finishing all thirty teams IS
// finishing the set, by construction rather than by a second list agreeing.
//
// ── WHY THIS IS PURE ────────────────────────────────────────────────────────
//
// Progress is a function of the keys owned and nothing else. Firebase decides
// WHEN to ask; it does not get to decide what completion means. That keeps the
// rule testable without a network and identical across the tracker, the claim,
// and anything later that asks the same question.
import { CARD_SETS, BASE_SET, cardKey } from './cardSets.js';
import { CONFERENCES } from './packEngine.js';
import { notionalPrice } from './rarity.js';

export const REWARD_SET = 'team-rewards';
export const WNBA_REWARD_SET = 'wnba-team-rewards';

/**
 * Both reward sets as one list.
 *
 * They are separate SETS because the league differs (see WNBA_TEAM_REWARDS_SET)
 * but they are the same MECHANIC, and every consumer here wants the mechanic:
 * "what does finishing this goal pay". Keeping the split visible at this one
 * line is cheaper than teaching four call sites which league they are in.
 */
// Team rewards AND set-completion rewards: both carry `rewardGoal`.
const REWARD_CARDS = [
  ...(CARD_SETS[REWARD_SET] ?? []), ...(CARD_SETS[WNBA_REWARD_SET] ?? []),
  ...(CARD_SETS['set-rewards'] ?? []), ...(CARD_SETS['wnba-set-rewards'] ?? []),
];
export const WNBA_SET = 'wnba';

/**
 * `goalId -> reward cardKey`, from the reward cards' own `rewardGoal`.
 *
 * KEYED BY GOAL, NOT BY FRANCHISE, because the conference and set tiers have
 * rewards now and neither is a franchise. `rewardFor` is still a bare team code
 * on the thirty, so the fallback keeps a card generated before this field
 * existed resolving to its franchise goal rather than dropping out.
 */
export const REWARD_BY_GOAL = Object.fromEntries(
  REWARD_CARDS
    .map(card => [card.rewardGoal ?? (card.rewardFor ? `nba-team-${card.rewardFor}` : null), cardKey(card)])
    .filter(([goal]) => goal)
);

/**
 * `franchise -> reward cardKey`, the thirty NBA teams alone.
 *
 * NOT widened to the WNBA, deliberately: franchise codes are not unique across
 * the leagues — ATL, CHI, LAS/LAL, MIN, PHO and WAS all exist in both — so one
 * map keyed on a bare code would silently overwrite. Anything that needs both
 * leagues wants REWARD_BY_GOAL, whose keys carry the league.
 */
export const TEAM_REWARDS = Object.fromEntries(
  (CARD_SETS[REWARD_SET] ?? [])
    .filter(card => card.rewardFor)
    .map(card => [card.rewardFor, cardKey(card)])
);

function rostersOf(setId) {
  const out = {};
  for (const card of CARD_SETS[setId] ?? []) (out[card.team] ??= []).push(cardKey(card));
  for (const team of Object.keys(out)) out[team].sort();
  return out;
}

/** `franchise -> [cardKey]` for the NBA base set. */
export const TEAM_ROSTERS = rostersOf(BASE_SET);
/** `franchise -> [cardKey]` for the WNBA set. */
export const WNBA_ROSTERS = rostersOf(WNBA_SET);

export const TEAM_CODES = Object.keys(TEAM_ROSTERS).sort();
export const WNBA_TEAM_CODES = Object.keys(WNBA_ROSTERS).sort();

/**
 * Every goal, in ladder order: teams, then conferences, then the whole set.
 *
 * `reward` is null for a tier whose card does not exist yet. That is deliberate
 * rather than a placeholder to tidy away — the structure is what the tracker
 * needs now, and a goal with no reward still shows real progress. A missing
 * reward blocks claiming, and nothing else.
 */
/**
 * The packable special sets, each of which is a collection of its own. The
 * reward sets are not here: their cards are earned, not pulled, so "collect
 * every team reward" would be a goal about goals.
 */
export const SPECIAL_SETS = [
  { id: 'super-season',      label: 'Super Season',      league: 'NBA' },
  { id: 'rookie',            label: 'Rookie',            league: 'NBA' },
  { id: 'summer-standouts',  label: 'Summer Standouts',  league: 'NBA' },
  { id: 'dissonance',        label: 'Dissonance',        league: 'NBA' },
  { id: 'wnba-super-season', label: 'WNBA Super Season', league: 'WNBA' },
  { id: 'wnba-rookie',       label: 'WNBA Rookie',       league: 'WNBA' },
];

export const GOALS = (() => {
  const goals = [];

  for (const team of TEAM_CODES) {
    goals.push({
      id: `nba-team-${team}`,
      kind: 'team', league: 'NBA', label: team,
      requires: TEAM_ROSTERS[team],
      reward: REWARD_BY_GOAL[`nba-team-${team}`] ?? null,
    });
  }
  for (const [name, teams] of Object.entries(CONFERENCES)) {
    goals.push({
      id: `nba-conference-${name}`,
      kind: 'conference', league: 'NBA', label: `${name}ern Conference`,
      requires: teams.flatMap(t => TEAM_ROSTERS[t] ?? []).sort(),
      reward: REWARD_BY_GOAL[`nba-conference-${name}`] ?? null,
    });
  }
  goals.push({
    id: 'nba-set',
    kind: 'set', league: 'NBA', label: 'Complete 2026-27 Set',
    requires: (CARD_SETS[BASE_SET] ?? []).map(cardKey).sort(),
    reward: REWARD_BY_GOAL['nba-set'] ?? null,
  });
  // A COMPLETION GOAL FOR EVERY SPECIAL SET (2026-09-06). The Collection tab
  // had started offering Collect on a Rookie or Super Season card with no
  // collection that wanted it — "we don't have collections for those. Maybe
  // we should spin some up for each one?" (the user). Rewards are null until
  // a capstone is chosen — his two candidates were the set's best card and a
  // card built to the difficulty — so these pay coins by the same buy-out
  // share as every other goal and claim as coins-only until then.
  for (const { id, label } of SPECIAL_SETS.filter(s => s.league === 'NBA')) {
    const requires = (CARD_SETS[id] ?? []).map(cardKey).sort();
    if (!requires.length) continue;
    goals.push({
      id: `set-${id}`,
      kind: 'set', league: 'NBA', label: `Complete ${label} Set`,
      requires,
      reward: REWARD_BY_GOAL[`set-${id}`] ?? null,
    });
  }

  for (const team of WNBA_TEAM_CODES) {
    goals.push({
      id: `wnba-team-${team}`,
      kind: 'team', league: 'WNBA', label: team,
      requires: WNBA_ROSTERS[team],
      reward: REWARD_BY_GOAL[`wnba-team-${team}`] ?? null,
    });
  }
  goals.push({
    id: 'wnba-set',
    kind: 'set', league: 'WNBA', label: 'Complete WNBA Set',
    requires: (CARD_SETS[WNBA_SET] ?? []).map(cardKey).sort(),
    reward: REWARD_BY_GOAL['wnba-set'] ?? null,
  });
  for (const { id, label } of SPECIAL_SETS.filter(s => s.league === 'WNBA')) {
    const requires = (CARD_SETS[id] ?? []).map(cardKey).sort();
    if (!requires.length) continue;
    goals.push({
      id: `set-${id}`,
      kind: 'set', league: 'WNBA', label: `Complete ${label} Set`,
      requires,
      reward: REWARD_BY_GOAL[`set-${id}`] ?? null,
    });
  }

  return goals;
})();

export const GOALS_BY_ID = Object.fromEntries(GOALS.map(g => [g.id, g]));

/** Every card some goal wants — what "eligible for collection" means. */
export const GOAL_CARD_KEYS = new Set(GOALS.flatMap(g => g.requires));

/**
 * Goals that pay COINS AND NOTHING ELSE, by decision rather than by omission.
 *
 * Two WNBA franchises have no history a reward card could be cut from. Toronto
 * has not played a game, and Golden State has exactly one season in which every
 * in-band player is still on the 2026 roster — so its ceiling is a card the
 * collection already contains. The alternative on the table was a boosted
 * current player badged with their Unrivaled team; coins won because a
 * manufactured card is a worse trophy than an honest payout.
 *
 * PORTLAND USED TO BE HERE AND IS NOT ANY MORE. The 2026 Fire revived the
 * 2000-2002 Fire's name and city, the season archive files both under POR, and
 * the user's rule is that lineage counts — so Sophia Witherspoon's 2000, an
 * original Fire season, rewards the revived one.
 *
 * This is a DIFFERENT STATE from "no card yet", which is where every other
 * card-less goal sits while it waits on a pick and art. The tracker shows a
 * difficulty band for those and none for these, because a rarity chip on a goal
 * that will never mint a card advertises something that is not coming.
 */
export const COINS_ONLY_GOALS = new Set(['wnba-team-TOR', 'wnba-team-GSV']);

/**
 * Progress on one goal.
 *
 * `missing` is returned, not just a count, because telling someone WHICH cards
 * they still need is the tracker's whole job — a bare "11/12" is the least
 * useful true thing it could say. It is capped for the set-sized goals, where a
 * full list is hundreds of keys nobody reads; `missingCount` stays exact.
 *
 * ── A GOAL CAN PAY COINS AND NOTHING ELSE ───────────────────────────────────
 *
 * `claimable` used to require a reward CARD, which quietly made every
 * coins-only goal unclaimable: claimGoal has always paid the coins, but no
 * button ever offered them because nothing reported the goal as claimable.
 * Three WNBA franchises will never have a card — Toronto and Golden State are
 * expansion sides with no history to draw one from, and Portland's original
 * Fire lasted three seasons — and coins are the deliberate answer for them
 * rather than a placeholder. So a goal is claimable when it has anything to
 * give.
 *
 * The card-ownership test survives for goals that DO mint one: holding the
 * reward is a durable marker that makes re-asking harmless even if the claim
 * receipt was lost. A coins-only goal has no such marker and rests on the
 * receipt alone, which is where claimableForUser already looks.
 */
/**
 * Which cards are IN the collection — the set `goalProgress` is asked about.
 *
 * `collection` is the index map, `{ [cardKey]: { count, collected?, earned? } }`.
 * Holding a copy is not collecting it. Until 2026-09-05 the first copy of a
 * card locked itself into the binder on the way out of the pack; the user's
 * rule now is that "they should have to go into the collections tab and hit
 * collect", so a pull is a spare — sellable, burnable — until its owner
 * presses Collect, which is when it starts counting toward a goal. A goal
 * reward (`earned`) is collected the moment it is minted, because a reward
 * can never be anything else. A count of zero is never collected, whatever
 * the flags say: a sold or burned card has left.
 */
export function collectedKeys(collection) {
  return new Set(
    Object.entries(collection ?? {})
      .filter(([, e]) => e && (e.collected === true || e.earned === true) && (e.count ?? 0) > 0)
      .map(([key]) => key)
  );
}

/**
 * Which cards are OWNED BUT NOT YET COLLECTED — a player card with a copy in
 * the box and nothing in the binder. The Collection tab shows a dot while
 * this is non-empty (the user, 2026-09-06: "a little dot or something
 * indicating that you have a card eligible for collection"). Strategy cards
 * are not collectable, so they never count.
 */
export function collectableKeys(collection) {
  return new Set(
    Object.entries(collection ?? {})
      .filter(([key, e]) =>
        e && e.type !== 'strat' && (e.count ?? 0) > 0 && e.collected !== true && e.earned !== true
        // Only a card some collection is asking for — a card no goal wants
        // is not "eligible" for anything, however many copies sit in the box.
        && GOAL_CARD_KEYS.has(key))
      .map(([key]) => key)
  );
}

export function goalProgress(goalId, ownedKeys, { missingLimit = 40 } = {}) {
  const goal = GOALS_BY_ID[goalId];
  if (!goal) return null;
  const missing = goal.requires.filter(key => !ownedKeys.has(key));
  const coins = goalCoinReward(goalId);
  return {
    id: goal.id,
    kind: goal.kind,
    league: goal.league,
    label: goal.label,
    total: goal.requires.length,
    owned: goal.requires.length - missing.length,
    missingCount: missing.length,
    missing: missing.slice(0, missingLimit),
    complete: goal.requires.length > 0 && missing.length === 0,
    reward: goal.reward,
    rewardCoins: coins,
    claimable:
      goal.requires.length > 0 &&
      missing.length === 0 &&
      ((Boolean(goal.reward) && !ownedKeys.has(goal.reward)) || coins > 0),
  };
}

/** Progress on every goal, optionally filtered, in alphabetical order — progress never moves a row. */
export function allGoalProgress(ownedKeys, { league = null, kind = null } = {}) {
  return GOALS
    .filter(g => (!league || g.league === league) && (!kind || g.kind === kind))
    .map(g => goalProgress(g.id, ownedKeys))
    // ALPHABETICAL, and only alphabetical, within a tier. The rows used to
    // float by completion — the closest collection first — and the user's rule
    // (2026-09-06) is that a team stays where it is in the list: "keep teams
    // in alphabetical order, do not change where they go based on collected%."
    .sort(
      (a, b) =>
        a.label.localeCompare(b.label)
    );
}

/** Goal ids that are complete, have a reward, and have not been claimed. */
export function claimableGoals(ownedKeys) {
  return GOALS.filter(g => goalProgress(g.id, ownedKeys).claimable).map(g => g.id);
}

/** Headline counts for a collection screen. */
export function collectionSummary(ownedKeys, league = 'NBA') {
  const rows = allGoalProgress(ownedKeys, { league });
  const teams = rows.filter(r => r.kind === 'team');
  // The base set's row by id: there are several set rows per league now.
  const set = rows.find(r => r.id === (league === 'WNBA' ? 'wnba-set' : 'nba-set'));
  return {
    teams: teams.length,
    teamsComplete: teams.filter(r => r.complete).length,
    ownedCards: set?.owned ?? 0,
    totalCards: set?.total ?? 0,
    claimable: rows.filter(r => r.claimable).length,
  };
}

/**
 * Coins paid for completing a goal.
 *
 * ── SCALED TO DIFFICULTY, MEASURED NOT GUESSED ──────────────────────────────
 *
 * The payout is a share of what the goal's cards would cost to buy outright,
 * which is the one difficulty measure that already accounts for both things
 * that make a roster hard: how many cards it holds AND how rare they are.
 *
 * Roster size alone would have paid out almost backwards. Washington has the
 * most cards (16) and is mid-table for difficulty; the Lakers have the fewest
 * (9) and are the fifth hardest, because they carry a legendary and a
 * super-rare. Across the league the real spread is about 6x, and buy-out cost
 * tracks it because it is priced off the same rarity bands.
 *
 * The share is a quarter. It has to be well under 1 or completing a collection
 * would fund the next one and the sink stops being a sink — but it should be
 * enough that a hard roster visibly pays for itself in a way an easy one does
 * not. Oklahoma City returns ~3,900 coins against Sacramento's ~350.
 */
export const GOAL_REWARD_SHARE = 0.25;

export function goalCoinReward(goalId) {
  const g = GOALS_BY_ID[goalId];
  if (!g) return 0;
  const cards = g.requires
    .map(key => CARD_INDEX[key])
    .filter(Boolean);
  // Notional, not market: an untradable set still has a value to complete.
  const buyOut = cards.reduce((sum, card) => sum + (notionalPrice(card) ?? 0), 0);
  return Math.round((buyOut * GOAL_REWARD_SHARE) / 10) * 10;
}

/** Every card by key, so a goal can price its own requirements. */
const CARD_INDEX = Object.fromEntries(
  Object.values(CARD_SETS).flat().map(card => [cardKey(card), card])
);
