// The WNBA reward set's own guarantees.
//
// The generator asserts three things at build time and throws rather than
// writing a bad set, so these do not re-prove the assertions — they prove the
// SHIPPED FILE still satisfies them, which is a different claim. A generator
// that is never re-run cannot catch a change to the difficulty table, to the
// WNBA roster, or to a rarity threshold; this file can.
import { describe, it, expect } from 'vitest';
import { CARD_SETS, cardKey } from '../../../src/game/cardSets.js';
import { WNBA_SET, WNBA_TEAM_REWARDS_SET, getSet } from '../../../src/cards/sets.js';
import { getPlayerRarity } from '../../../src/game/rarity.js';
import { rewardBandFor } from '../../../src/game/collectionDifficulty.js';
import {
  COINS_ONLY_GOALS, REWARD_BY_GOAL, GOALS_BY_ID, WNBA_ROSTERS,
} from '../../../src/game/collections.js';
import { normalizeName } from '../resolveTeams.js';
import { franchiseOf } from './wnbaRewardCandidates.js';
import { readWnbaRewards } from './generateWnbaRewards.js';

const CARDS = CARD_SETS[WNBA_TEAM_REWARDS_SET] ?? [];
const WNBA = CARD_SETS[WNBA_SET] ?? [];

describe('the WNBA reward set exists and is wired', () => {
  it('ships a card for every franchise the picks file names, built or moved', () => {
    const { built, moved } = readWnbaRewards();
    expect(CARDS).toHaveLength(built.length + moved.length);
    expect(CARDS.length).toBeGreaterThan(0);
  });

  it('moves a card out of its old set rather than copying it', () => {
    // The duplicate this prevents is concrete: Becky Hammon's Super Season card
    // is San Antonio 2009 and the Aces reward search picked San Antonio 2008 —
    // the same player in the same jersey a year apart, one winnable and one
    // packable. Moving the printed card is the fix; this pins that the card
    // really LEFT, in the game and not only in the reward file.
    const migrated = CARDS.filter(c => c.migratedFrom);
    expect(migrated.length).toBeGreaterThan(0);
    for (const card of migrated) {
      const origin = CARD_SETS[card.migratedFrom.set] ?? [];
      expect(origin.some(c => c.id === card.migratedFrom.id),
        `${card.name} is still in ${card.migratedFrom.set}`).toBe(false);
      // The claim its old set made is still true, so the mark comes along.
      expect(card.badges, card.name).toContain('super-season');
    }
  });

  it('carries no player twice across every set in the game', () => {
    // The general form of the rule above, and the one that would catch the next
    // migration somebody forgets to wire into MIGRATED_OUT.
    const seen = new Map();
    for (const card of CARDS) {
      for (const [setId, cards] of Object.entries(CARD_SETS)) {
        if (setId === WNBA_TEAM_REWARDS_SET) continue;
        for (const other of cards) {
          if (normalizeName(other.name) !== normalizeName(card.name)) continue;
          if (other.season === card.season) seen.set(card.name, setId);
        }
      }
    }
    expect([...seen.entries()]).toEqual([]);
  });

  it('is declared as a WNBA set carrying the team-reward mark', () => {
    const set = getSet(WNBA_TEAM_REWARDS_SET);
    expect(set).toBeTruthy();
    expect(set.league).toBe('WNBA');
    expect(set.badge).toBe('team-reward');
  });

  it('reaches every WNBA franchise goal exactly once, or pays coins instead', () => {
    for (const team of Object.keys(WNBA_ROSTERS)) {
      const goal = `wnba-team-${team}`;
      const paysCoins = COINS_ONLY_GOALS.has(goal);
      expect(Boolean(REWARD_BY_GOAL[goal]), `${goal} reward`).toBe(!paysCoins);
      expect(GOALS_BY_ID[goal].reward ?? null, `${goal} goal wiring`)
        .toBe(paysCoins ? null : REWARD_BY_GOAL[goal]);
    }
  });

  it('leaves exactly the two franchises with no history on coins', () => {
    // Not a snapshot of a decision — a statement of WHY. Toronto has never
    // played, and Golden State's one season is entirely on its current roster,
    // so neither can cut a card that the collection does not already contain.
    expect([...COINS_ONLY_GOALS].sort()).toEqual(['wnba-team-GSV', 'wnba-team-TOR']);
  });

  it('rewards Portland, whose revived name carries the original Fire seasons', () => {
    // The regression this guards: `PORF` was in the candidate search's FOLDED
    // set, which would have kept Portland coins-only forever. It was never in
    // the archive — both Fires file under POR — so the entry did nothing, and
    // the user's lineage rule says it should not have been there anyway.
    const key = REWARD_BY_GOAL['wnba-team-POR'];
    expect(key).toBeTruthy();
    const card = CARDS.find(c => cardKey(c) === key);
    expect(card.season).toBeLessThan(2003);
  });
});

describe('the three pick rules hold on the shipped cards', () => {
  it('wears the jersey of the franchise that earns it', () => {
    for (const card of CARDS) {
      expect(franchiseOf(card.statRowTeam), `${card.name} ${card.seasonLabel}`)
        .toBe(card.rewardFor);
    }
  });

  it('beats that player’s own current card, where she has one', () => {
    const current = new Map(WNBA.map(c => [normalizeName(c.name), c]));
    for (const card of CARDS) {
      const base = current.get(normalizeName(card.name));
      if (!base) continue;
      expect(card.salary, `${card.name}: reward vs her ${base.season} card`)
        .toBeGreaterThan(base.salary);
    }
  });

  it('sits in the difficulty band its franchise earned', () => {
    for (const card of CARDS) {
      if (card.bandException) continue;
      const band = rewardBandFor(card.rewardGoal);
      expect(band, `${card.rewardGoal} has no band`).toBeTruthy();
      expect(getPlayerRarity(card), `${card.rewardFor}: ${card.name} $${card.salary}`)
        .toBe(band.band);
    }
  });

  it('is off the roster it rewards, so completing the team pays a new card', () => {
    // The rule the NBA set states as PREFERRED with declared exceptions. None
    // of the thirteen currently needs one — and this test is the reason the
    // off-roster check earns its keep, because it was silently broken during
    // the search: roster ids are prefixed `wnba:A_ja_Wilson` and card ids are
    // bare, so every comparison missed and A'ja Wilson was briefly offered as
    // the reward for collecting the Aces.
    const byTeam = {};
    for (const card of WNBA) (byTeam[card.team] ??= new Set()).add(normalizeName(card.name));
    for (const card of CARDS) {
      if (card.rosterException) continue;
      expect(byTeam[card.rewardFor]?.has(normalizeName(card.name)) ?? false,
        `${card.name} is on the ${card.rewardFor} roster she rewards`).toBe(false);
    }
  });
});

describe('a reward is earned, never bought', () => {
  it('names a goal on every card, so nothing is unreachable', () => {
    for (const card of CARDS) {
      expect(card.rewardGoal, `${card.name} has no rewardGoal`).toBeTruthy();
      expect(GOALS_BY_ID[card.rewardGoal], `${card.rewardGoal} is not a real goal`).toBeTruthy();
    }
  });

  it('gives each franchise its own card, with no player carded twice', () => {
    expect(new Set(CARDS.map(c => c.rewardFor)).size).toBe(CARDS.length);
    expect(new Set(CARDS.map(c => c.id)).size).toBe(CARDS.length);
  });
});
