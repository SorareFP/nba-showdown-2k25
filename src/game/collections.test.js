import { describe, it, expect } from 'vitest';
import {
  GOALS,
  GOALS_BY_ID,
  TEAM_ROSTERS,
  WNBA_ROSTERS,
  TEAM_REWARDS,
  TEAM_CODES,
  WNBA_TEAM_CODES,
  REWARD_SET,
  goalProgress,
  allGoalProgress,
  claimableGoals,
  collectionSummary,
  COINS_ONLY_GOALS,
} from './collections.js';
import { CARD_SETS, BASE_SET, cardKey } from './cardSets.js';
import { CONFERENCES } from './packEngine.js';

const own = (...keys) => new Set(keys.flat());
const goal = id => GOALS_BY_ID[id];

describe('the ladder', () => {
  it('has a goal for every franchise, both conferences, and each league set', () => {
    const nbaTeams = GOALS.filter(g => g.league === 'NBA' && g.kind === 'team');
    const wnbaTeams = GOALS.filter(g => g.league === 'WNBA' && g.kind === 'team');
    expect(nbaTeams).toHaveLength(30);
    expect(wnbaTeams).toHaveLength(15);
    expect(GOALS.filter(g => g.kind === 'conference')).toHaveLength(2);
    // One base-set goal per league, plus a completion goal per packable special set.
    expect(GOALS_BY_ID['nba-set'].league).toBe('NBA');
    expect(GOALS_BY_ID['wnba-set'].league).toBe('WNBA');
    expect(GOALS.filter(g => g.kind === 'set' && g.league === 'NBA').map(g => g.id).sort())
      .toEqual(['nba-set', 'set-dissonance', 'set-rookie', 'set-summer-standouts', 'set-super-season']);
    expect(GOALS.filter(g => g.kind === 'set' && g.league === 'WNBA').map(g => g.id).sort())
      .toEqual(['set-wnba-rookie', 'set-wnba-super-season', 'wnba-set']);
  });

  it('gives the WNBA no conference tier, because the league has no even split', () => {
    // Fifteen teams and no conference standings. An East/West here would be a
    // 7-8 division we invented and then called real.
    expect(WNBA_TEAM_CODES).toHaveLength(15);
    expect(GOALS.filter(g => g.league === 'WNBA' && g.kind === 'conference')).toEqual([]);
  });

  it('carries no multi-team pseudo-franchise', () => {
    // A 2TM roster would be a 31st franchise nobody can complete, holding real
    // players who then belong to no real roster.
    const bad = /^(2TM|3TM|4TM|TOT)$/;
    expect(TEAM_CODES.filter(t => bad.test(t))).toEqual([]);
    expect(WNBA_TEAM_CODES.filter(t => bad.test(t))).toEqual([]);
  });

  it('derives every requirement from the cards, so nothing can drift', () => {
    const base = CARD_SETS[BASE_SET];
    expect(Object.values(TEAM_ROSTERS).reduce((n, r) => n + r.length, 0)).toBe(base.length);
    for (const card of base) {
      expect(TEAM_ROSTERS[card.team], card.name).toContain(cardKey(card));
    }
    expect(Object.values(WNBA_ROSTERS).reduce((n, r) => n + r.length, 0))
      .toBe(CARD_SETS.wnba.length);
  });
});

describe('the tiers agree with each other by construction', () => {
  it('makes a conference exactly the union of its teams', () => {
    for (const [name, teams] of Object.entries(CONFERENCES)) {
      const union = new Set(teams.flatMap(t => TEAM_ROSTERS[t] ?? []));
      expect(new Set(goal(`nba-conference-${name}`).requires)).toEqual(union);
    }
  });

  it('makes the set exactly the union of both conferences', () => {
    const conf = new Set(
      Object.keys(CONFERENCES).flatMap(n => goal(`nba-conference-${n}`).requires)
    );
    expect(new Set(goal('nba-set').requires)).toEqual(conf);
  });

  it('completes the set the instant the last team completes, never before', () => {
    // The tiers are built from one source, so this is structural rather than
    // two lists that happen to agree. Owning 29 of 30 rosters must leave BOTH
    // the last team and the set unfinished.
    const all = TEAM_CODES.flatMap(t => TEAM_ROSTERS[t]);
    const lastTeam = TEAM_CODES[TEAM_CODES.length - 1];
    const allButOne = TEAM_CODES.slice(0, -1).flatMap(t => TEAM_ROSTERS[t]);
    expect(goalProgress('nba-set', own(allButOne)).complete).toBe(false);
    expect(goalProgress(`nba-team-${lastTeam}`, own(allButOne)).complete).toBe(false);
    expect(goalProgress('nba-set', own(all)).complete).toBe(true);
  });
});

describe('rewards', () => {
  it('gives every NBA franchise a reward that is really in the reward set', () => {
    const rewardKeys = new Set(CARD_SETS[REWARD_SET].map(cardKey));
    for (const team of TEAM_CODES) {
      expect(TEAM_REWARDS[team], team).toBeTruthy();
      expect(rewardKeys.has(TEAM_REWARDS[team]), team).toBe(true);
    }
    expect(new Set(Object.values(TEAM_REWARDS)).size).toBe(TEAM_CODES.length);
  });

  it('never lets a reward count toward the roster it unlocks', () => {
    // Rewards print an ERA team (Lou Williams is ATL08), so a group-by-team
    // would fold them into the franchise they pay for and let one help earn
    // itself. Rosters come from the base set alone.
    const rosterKeys = new Set(Object.values(TEAM_ROSTERS).flat());
    for (const key of Object.values(TEAM_REWARDS)) expect(rosterKeys.has(key)).toBe(false);
  });

  it('rewards the conference and set tiers too, keyed by goal', () => {
    // These paid coins and minted nothing until the tier cards existed. They
    // are NOT franchise rewards, so they are keyed by goal id — a conference is
    // not a team and has no team code to key on.
    for (const id of ['nba-conference-East', 'nba-conference-West', 'nba-set']) {
      const p = goalProgress(id, own(goal(id).requires));
      expect(p.complete, id).toBe(true);
      expect(p.reward, id).toBeTruthy();
      expect(p.claimable, id).toBe(true);
    }
  });

  it('offers a goal that pays coins and no card', () => {
    // This was the bug the coins-only decision surfaced: `claimable` required a
    // reward CARD, so every card-less goal was complete, paid nothing, and
    // showed no button — even though claimGoal has always paid the coins.
    const p = goalProgress('wnba-set', own(goal('wnba-set').requires));
    expect(p.complete).toBe(true);
    expect(p.reward).toBeNull();
    expect(p.rewardCoins).toBeGreaterThan(0);
    expect(p.claimable).toBe(true);
  });

  it('names the coins-only franchises rather than leaving them to look unfinished', () => {
    // The distinction the tracker reads: these two will never mint a card, so
    // they show no difficulty band. Every other card-less goal is waiting on
    // one and keeps its band.
    expect([...COINS_ONLY_GOALS].sort()).toEqual(['wnba-team-GSV', 'wnba-team-TOR']);
    for (const id of COINS_ONLY_GOALS) expect(GOALS_BY_ID[id], id).toBeTruthy();
    // wnba-set is card-less too, and is NOT in the set: it is waiting on a pick.
    expect(COINS_ONLY_GOALS.has('wnba-set')).toBe(false);
  });

  it('pays coins to the two WNBA franchises that will never have a card', () => {
    // Toronto has never played, and Golden State's one season is entirely on
    // its current roster, so neither can cut a reward the collection does not
    // already contain. Coins are the decided answer, not a gap waiting on art.
    //
    // PORTLAND USED TO BE HERE. The revived Fire took the 2000-2002 Fire's name
    // and city, the archive files both under POR, and lineage counts — so it
    // rewards an original Fire season now and belongs in the test below.
    for (const team of ['TOR', 'GSV']) {
      const id = `wnba-team-${team}`;
      const p = goalProgress(id, own(goal(id).requires));
      expect(p.reward, team).toBeNull();
      expect(p.rewardCoins, team).toBeGreaterThan(0);
      expect(p.claimable, team).toBe(true);
    }
  });

  it('pays a card, not coins, to every WNBA franchise that has a history', () => {
    for (const team of Object.keys(WNBA_ROSTERS)) {
      const id = `wnba-team-${team}`;
      if (COINS_ONLY_GOALS.has(id)) continue;
      const p = goalProgress(id, own(goal(id).requires));
      expect(p.reward, team).toBeTruthy();
      expect(p.claimable, team).toBe(true);
    }
  });

  it('offers nothing for an incomplete goal, however well it pays', () => {
    const id = 'wnba-set';
    expect(goalProgress(id, own([])).claimable).toBe(false);
  });
});

describe('goalProgress', () => {
  const team = TEAM_CODES[0];
  const id = `nba-team-${team}`;

  it('reports nothing owned for an empty collection', () => {
    const p = goalProgress(id, own());
    expect(p.owned).toBe(0);
    expect(p.total).toBe(TEAM_ROSTERS[team].length);
    expect(p.complete).toBe(false);
  });

  it('names WHICH cards are missing, not just how many', () => {
    const all = TEAM_ROSTERS[team];
    const p = goalProgress(id, own(all.slice(1)));
    expect(p.missing).toEqual([all[0]]);
    expect(p.missingCount).toBe(1);
  });

  it('caps the missing list but keeps the count exact', () => {
    // A set-sized goal has hundreds of missing keys and nobody reads them.
    const p = goalProgress('nba-set', own(), { missingLimit: 5 });
    expect(p.missing).toHaveLength(5);
    expect(p.missingCount).toBe(CARD_SETS[BASE_SET].length);
  });

  it('completes only on the last card', () => {
    const all = TEAM_ROSTERS[team];
    expect(goalProgress(id, own(all.slice(0, -1))).complete).toBe(false);
    expect(goalProgress(id, own(all)).complete).toBe(true);
  });

  it('ignores other sets and other teams', () => {
    // A Rookie card of the same player is a DIFFERENT key; letting it stand in
    // would make a roster mean something different for every player.
    const all = TEAM_ROSTERS[team];
    const rookies = CARD_SETS.rookie.slice(0, 40).map(cardKey);
    expect(goalProgress(id, own(all.slice(1), rookies)).complete).toBe(false);
  });

  it('is unmoved by owning duplicates', () => {
    const all = TEAM_ROSTERS[team];
    expect(goalProgress(id, own(all, all)).complete).toBe(true);
  });

  it('returns null for a goal that does not exist', () => {
    expect(goalProgress('nba-team-ZZZ', own())).toBeNull();
  });
});

describe('claimableGoals', () => {
  const team = TEAM_CODES[3];
  const id = `nba-team-${team}`;

  it('claims nothing on an empty collection', () => {
    expect(claimableGoals(own())).toEqual([]);
  });

  it('offers a completed franchise exactly once', () => {
    expect(claimableGoals(own(TEAM_ROSTERS[team]))).toContain(id);
  });

  it('keeps offering a goal that still has coins to pay, and leans on the receipt', () => {
    // Holding the reward card used to be the only guard, which was a neat
    // property — it survived a dropped write — and it stopped being sufficient
    // the moment goals could pay coins as well. Every NBA goal pays coins, so
    // the collection alone can no longer say whether a claim already happened.
    // The CLAIM RECEIPT is the authority now; claimableForUser filters on it,
    // and claimGoal refuses a second claim outright.
    const held = own(TEAM_ROSTERS[team], [TEAM_REWARDS[team]]);
    const p = goalProgress(id, held);
    expect(p.rewardCoins).toBeGreaterThan(0);
    expect(claimableGoals(held)).toContain(id);
  });

  it('is still safe to re-ask, because asking is not claiming', () => {
    // The property that actually mattered: goalProgress is pure and derived
    // from the collection, so calling it twice changes nothing.
    const held = own(TEAM_ROSTERS[team]);
    expect(goalProgress(id, held)).toEqual(goalProgress(id, held));
  });

  it('offers a player who completed a roster before the feature existed', () => {
    // Same property from the other side: when the cards arrived never enters in.
    expect(claimableGoals(own(TEAM_ROSTERS[team]))).toContain(id);
  });
});

describe('allGoalProgress and collectionSummary', () => {
  it('keeps every row in alphabetical order whatever its progress', () => {
    // The user's rule (2026-09-06): a team stays where it is in the list —
    // completion and closeness never move it.
    const rows = allGoalProgress(new Set(), { league: 'NBA', kind: 'team' });
    const labels = rows.map(r => r.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    const full = new Set(rows.flatMap(r => GOALS_BY_ID[r.id].requires));
    const done = allGoalProgress(full, { league: 'NBA', kind: 'team' });
    expect(done.map(r => r.label)).toEqual(labels);
    expect(done.every(r => r.complete)).toBe(true);
  });

  it('filters by league and kind', () => {
    expect(allGoalProgress(own(), { league: 'WNBA' }).every(r => r.league === 'WNBA')).toBe(true);
    // Two base-set goals plus a completion goal for each of the six packable
    // special sets (SPECIAL_SETS).
    expect(allGoalProgress(own(), { kind: 'set' })).toHaveLength(8);
  });

  it('summarises against the whole base set', () => {
    const s = collectionSummary(own(), 'NBA');
    expect(s.teams).toBe(30);
    expect(s.teamsComplete).toBe(0);
    expect(s.totalCards).toBe(CARD_SETS[BASE_SET].length);
    expect(s.claimable).toBe(0);
  });

  it('counts a completed franchise and its claim', () => {
    const team = TEAM_CODES[4];
    const s = collectionSummary(own(TEAM_ROSTERS[team]), 'NBA');
    expect(s.teamsComplete).toBe(1);
    expect(s.ownedCards).toBe(TEAM_ROSTERS[team].length);
    expect(s.claimable).toBe(1);
  });
});
