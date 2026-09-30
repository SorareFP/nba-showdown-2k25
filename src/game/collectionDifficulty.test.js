import { describe, it, expect } from 'vitest';
import {
  expectedPacks,
  goalDifficulty,
  GOAL_DIFFICULTY,
  TEAM_DIFFICULTY_RANK,
  REWARD_BANDS,
  rewardBandFor,
  nbaRewardBands,
} from './collectionDifficulty.js';
import { TEAM_ROSTERS, WNBA_ROSTERS, GOALS } from './collections.js';
import { CARD_SETS, BASE_SET, cardKey } from './cardSets.js';
import { getPlayerRarity } from './rarity.js';

describe('expectedPacks', () => {
  it('takes one pack when the pack always contains the only card', () => {
    expect(expectedPacks([1])).toBeCloseTo(1, 2);
  });

  it('matches the closed form for equal odds', () => {
    // With n equally likely coupons at p each, E[T] = (1/p) * n * H(n).
    const n = 4;
    const p = 0.5;
    const harmonic = [1, 2, 3, 4].reduce((s, k) => s + 1 / k, 0);
    expect(expectedPacks(Array(n).fill(p / n))).toBeCloseTo((n * harmonic) / p, 0);
  });

  it('is dominated by the rarest card, not the card count', () => {
    // The whole reason roster size is the wrong measure: adding nine easy cards
    // moves the total far less than one hard card does.
    const oneHard = expectedPacks([0.002]);
    const manyEasy = expectedPacks(Array(9).fill(0.5));
    expect(oneHard).toBeGreaterThan(manyEasy * 10);
    expect(expectedPacks([0.002, ...Array(9).fill(0.5)])).toBeLessThan(oneHard * 1.3);
  });

  it('is empty-safe', () => {
    expect(expectedPacks([])).toBe(0);
    expect(goalDifficulty([])).toBe(0);
    expect(goalDifficulty(['no-such-card'])).toBe(0);
  });
});

describe('the difficulty field', () => {
  it('scores every goal in the ladder', () => {
    for (const g of GOALS) expect(GOAL_DIFFICULTY[g.id], g.id).toBeGreaterThan(0);
  });

  it('lets rarity DEPTH outrank a single legendary', () => {
    // Not a defect — the thing the measure is for. Portland holds no legendary
    // and four super-rares, and is harder than several rosters that hold one,
    // because four long tails compound where one does not. A ladder built on
    // "does it contain a legendary" would have this backwards.
    const idx = Object.fromEntries(CARD_SETS[BASE_SET].map(c => [cardKey(c), c]));
    const rarest = team =>
      TEAM_ROSTERS[team].filter(k => getPlayerRarity(idx[k]) === 'legendary').length;
    const packs = team => GOAL_DIFFICULTY[`nba-team-${team}`];

    const noLegendary = Object.keys(TEAM_ROSTERS).filter(t => rarest(t) === 0);
    const oneLegendary = Object.keys(TEAM_ROSTERS).filter(t => rarest(t) === 1);
    const hardestWithout = Math.max(...noLegendary.map(packs));
    const easiestWithOne = Math.min(...oneLegendary.map(packs));
    expect(hardestWithout).toBeGreaterThan(easiestWithOne);
  });

  it('still makes a legendary the single most expensive card to chase', () => {
    // All else equal, swapping one card up a band must raise the total.
    const cheap = goalDifficulty(
      CARD_SETS[BASE_SET].filter(c => getPlayerRarity(c) === 'uncommon').slice(0, 5).map(cardKey)
    );
    const withApex = goalDifficulty([
      ...CARD_SETS[BASE_SET].filter(c => getPlayerRarity(c) === 'uncommon').slice(0, 4).map(cardKey),
      ...CARD_SETS[BASE_SET].filter(c => getPlayerRarity(c) === 'legendary').slice(0, 1).map(cardKey),
    ]);
    expect(withApex).toBeGreaterThan(cheap);
  });

  it('does not simply rank by roster size', () => {
    // The claim the module is built on. If size and difficulty agreed there
    // would be no reason for any of this.
    const rows = Object.entries(TEAM_ROSTERS).map(([team, keys]) => ({
      size: keys.length,
      packs: GOAL_DIFFICULTY[`nba-team-${team}`],
    }));
    const bySize = [...rows].sort((a, b) => b.size - a.size);
    const byPacks = [...rows].sort((a, b) => b.packs - a.packs);
    expect(bySize.map(r => r.packs)).not.toEqual(byPacks.map(r => r.packs));
    // Concretely: the biggest roster is not the hardest one.
    expect(bySize[0].packs).toBeLessThan(byPacks[0].packs);
  });
});

describe('the reward ladder', () => {
  it('splits each league into even thirds', () => {
    const nba = Object.values(nbaRewardBands()).map(b => b.band);
    const count = b => nba.filter(x => x === b).length;
    expect(nba).toHaveLength(30);
    expect(count('rare')).toBe(10);
    expect(count('super-rare')).toBe(10);
    expect(count('legendary')).toBe(10);
  });

  it('never gives an easier roster a better band than a harder one', () => {
    const order = REWARD_BANDS.map(b => b.band);
    const rows = Object.keys(TEAM_ROSTERS)
      .map(team => `nba-team-${team}`)
      .sort((a, b) => GOAL_DIFFICULTY[a] - GOAL_DIFFICULTY[b])
      .map(id => order.indexOf(rewardBandFor(id).band));
    for (let i = 1; i < rows.length; i++) expect(rows[i]).toBeGreaterThanOrEqual(rows[i - 1]);
  });

  it('puts the hardest roster in the top band and the easiest in the bottom', () => {
    const ids = Object.keys(TEAM_ROSTERS).map(t => `nba-team-${t}`);
    const hardest = ids.reduce((a, b) => (GOAL_DIFFICULTY[a] > GOAL_DIFFICULTY[b] ? a : b));
    const easiest = ids.reduce((a, b) => (GOAL_DIFFICULTY[a] < GOAL_DIFFICULTY[b] ? a : b));
    expect(rewardBandFor(hardest).band).toBe('legendary');
    expect(rewardBandFor(easiest).band).toBe('rare');
    expect(TEAM_DIFFICULTY_RANK[hardest]).toBe(1);
    expect(TEAM_DIFFICULTY_RANK[easiest]).toBe(0);
  });

  it('ranks each league against itself, not against the other', () => {
    // A fifteen-team league would otherwise be scored against thirty NBA
    // rosters and land wherever its absolute numbers happened to fall.
    const wnba = Object.keys(WNBA_ROSTERS).map(t => `wnba-team-${t}`);
    expect(Math.min(...wnba.map(id => TEAM_DIFFICULTY_RANK[id]))).toBe(0);
    expect(Math.max(...wnba.map(id => TEAM_DIFFICULTY_RANK[id]))).toBe(1);
  });

  it('has no band for a goal that is not a franchise', () => {
    expect(rewardBandFor('nba-set')).toBeNull();
    expect(rewardBandFor('nba-conference-East')).toBeNull();
    expect(rewardBandFor('nope')).toBeNull();
  });
});

describe('the shipped reward cards obey the ladder', () => {
  // The same invariant generateTeamRewards asserts at build time, checked here
  // against the JSON that actually ships — so a hand-edit to the generated file
  // fails too, not just a regeneration.
  // THE FLOOR REPLACED THE BAND (2026-09-30). The user: "all collection
  // rewards should be better than the best card in the collection as kind of
  // a rule", the margin $50. A reward that cannot clear it declares a
  // floorException saying why (nothing in Heat history clears Giannis).
  it('beats the best card its roster asks for by $50, or says why it cannot', () => {
    const best = team => Math.max(...CARD_SETS[BASE_SET].filter(c => c.team === team).map(c => c.salary));
    const wrong = CARD_SETS['team-rewards']
      .filter(card => card.salary < best(card.rewardFor) + 50 && !card.floorException)
      .map(card => `${card.rewardFor} ${card.name} $${card.salary} under the floor $${best(card.rewardFor) + 50}`);
    expect(wrong).toEqual([]);
  });

  it('declares only the exceptions the user ruled on', () => {
    const excused = CARD_SETS['team-rewards'].filter(c => c.floorException).map(c => c.rewardFor).sort();
    // Denver (the roster rule leaves no Nugget above it), Detroit, the Lakers,
    // Miami, Oklahoma City, Philadelphia, San Antonio and Toronto: rosters led
    // by a card nothing in the franchise's history clears.
    expect(excused).toEqual(['DEN', 'DET', 'LAL', 'MIA', 'OKC', 'PHI', 'SAS', 'TOR']);
  });

  it('gives the hardest roster a card worth more than the easiest', () => {
    const byTeam = Object.fromEntries(CARD_SETS['team-rewards'].map(c => [c.rewardFor, c]));
    const ids = Object.keys(TEAM_ROSTERS).map(t => `nba-team-${t}`);
    const hardest = ids.reduce((a, b) => (GOAL_DIFFICULTY[a] > GOAL_DIFFICULTY[b] ? a : b));
    const easiest = ids.reduce((a, b) => (GOAL_DIFFICULTY[a] < GOAL_DIFFICULTY[b] ? a : b));
    const salary = id => byTeam[id.replace('nba-team-', '')].salary;
    expect(salary(hardest)).toBeGreaterThan(salary(easiest));
  });

  it('keeps every FRANCHISE reward below the apex of the base set', () => {
    // Desirable, not meta-defining. A franchise reward may reach the legendary
    // BAND but must not be the best card in the game — the candidate search
    // offers a $2,580 Westbrook and the ladder deliberately does not take it.
    const apex = Math.max(...CARD_SETS[BASE_SET].map(c => c.salary));
    for (const card of CARD_SETS['team-rewards'].filter(c => c.rewardFor)) {
      expect(card.salary, card.name).toBeLessThan(apex);
    }
  });

  // THE TIERS ARE SET REWARDS SINCE 2026-09-30 (the user: "I'd lean 'set'").
  const TIER_GOALS = ['nba-conference-East', 'nba-conference-West', 'nba-set'];
  const tiers = () => CARD_SETS['set-rewards'].filter(c => TIER_GOALS.includes(c.rewardGoal));

  it('keeps no tier in the team reward set', () => {
    expect(CARD_SETS['team-rewards'].filter(c => !c.rewardFor)).toEqual([]);
    expect(tiers().map(c => c.rewardGoal).sort()).toEqual([...TIER_GOALS].sort());
  });

  it('ranks the tier rewards above every franchise reward', () => {
    const franchise = CARD_SETS['team-rewards'].filter(c => c.rewardFor);
    expect(Math.min(...tiers().map(c => c.salary)))
      .toBeGreaterThan(Math.max(...franchise.map(c => c.salary)));
  });

  it('lets the whole-set reward clear the best card in the set', () => {
    const apex = Math.max(...CARD_SETS[BASE_SET].map(c => c.salary));
    const whole = tiers().find(c => c.rewardGoal === 'nba-set');
    expect(whole.salary).toBeGreaterThanOrEqual(apex + 50);
  });
});

describe('a reward is always an upgrade', () => {
  // TEN OF THIRTY WERE DOWNGRADES before this rule existed. Completing Houston
  // won an Amen Thompson weaker than the one already pullable from a booster.
  // The cause was two correct rules multiplying into a wrong answer: picks
  // target the LOW end of their band to stay out of meta-defining territory,
  // and the band comes from COLLECTION DIFFICULTY, which knows nothing about
  // how good that player's current card happens to be.
  const base = new Map(CARD_SETS[BASE_SET].map(c => [c.name, c]));

  it('never pays a card worse than the one it celebrates', () => {
    const worse = CARD_SETS['team-rewards']
      .map(card => {
        const current = base.get(card.name);
        return current && card.salary <= current.salary
          ? `${card.name}: reward $${card.salary} vs 2026-27 $${current.salary}`
          : null;
      })
      .filter(Boolean);
    expect(worse).toEqual([]);
  });

  it('is never a player on the roster being completed', () => {
    // A preference until 2026-09-30 (Denver's Jokic was the one exception);
    // a rule since. The user: "I don't love the idea of getting the current
    // Joker card just to get a better Joker card. I'm not sure players on the
    // current roster should have their own team reward cards."
    const onRoster = CARD_SETS['team-rewards']
      .filter(c => c.rewardFor)
      .filter(c => (TEAM_ROSTERS[c.rewardFor] ?? []).some(k => base.get(c.name)?.id === k))
      .map(c => c.rewardFor);
    expect(onRoster).toEqual([]);
  });

  it('prints the jersey of the franchise it rewards, with no exceptions', () => {
    // The one HARD rule of the three. A Rockets card cannot reward Cleveland.
    for (const card of CARD_SETS['team-rewards'].filter(c => c.rewardFor)) {
      const printed = String(card.team).replace(/\d+$/, '');
      const canon = { BRK: 'BKN', CHO: 'CHA', PHO: 'PHX', NJN: 'BKN', SEA: 'OKC', CHH: 'CHA', NOH: 'NOP', NOK: 'NOP', CHB: 'CHA', VAN: 'MEM', WSB: 'WAS' };
      expect(canon[printed] ?? printed, card.name).toBe(card.rewardFor);
    }
  });
});

describe('migrated rewards', () => {
  // Twenty-seven of the thirty franchise rewards are cards MOVED out of Super
  // Season, Rookie and Summer Standouts rather than built fresh. The ladder
  // could not be filled any other way: a franchise is hard to collect because
  // its current roster is stacked, and those same franchises had their history
  // most thoroughly mined by the special sets, so the hardest rosters had the
  // thinnest fresh pools.
  const rewards = CARD_SETS['team-rewards'];
  const moved = rewards.filter(c => c.migratedFrom);

  // Most of the set was moved until the 2026-09-30 re-pick, which builds most
  // of it (the floor needs seasons no set held). What must hold either way:
  // a BUILT reward is a season no other set carries, or a moved one would
  // have been the honest card.
  it('builds a reward only for a season no other set already carries', () => {
    const others = Object.entries(CARD_SETS)
      .filter(([set]) => !['team-rewards', 'live'].includes(set))
      .flatMap(([, cards]) => cards)
      .map(c => `${c.name}|${c.season ?? 2026}`);
    const dupes = rewards.filter(c => !c.migratedFrom && others.includes(`${c.name}|${c.season}`)).map(c => `${c.name} ${c.season}`);
    expect(dupes).toEqual([]);
  });

  it('never leaves a copy behind in the set it came from', () => {
    // The whole reason a migration is a MOVE. Two copies would mean completing
    // a roster handed you a duplicate of something already pullable from packs.
    for (const card of moved) {
      const source = CARD_SETS[card.migratedFrom.set] ?? [];
      expect(source.find(c => c.id === card.migratedFrom.id), `${card.migratedFrom.set}:${card.id}`)
        .toBeUndefined();
    }
  });

  it('only ever migrates out of a set that has an origin badge', () => {
    for (const card of moved) {
      // Throwbacks since 2026-09-22: David Robinson's Spurs reward comes from
      // the Super Season his own Rookie card out-priced (demoted there).
      expect(['super-season', 'rookie', 'summer-standouts', 'throwbacks'], card.name)
        .toContain(card.migratedFrom.set);
    }
  });

  it('carries the origin badge, so the card still says what it was', () => {
    const expected = {
      'super-season': 'super-season',
      rookie: 'rookie',
      'summer-standouts': 'summer-standout',
      throwbacks: 'throwback',
    };
    for (const card of moved) {
      // UNLESS THE CLAIM WAS NOT TRUE. A Super Season badge asserts "this was
      // his best season", and John Stockton's 2001-02 is not — his 1994-95 is.
      // Provenance does not outrank accuracy: a card that dropped the claim
      // dropped it everywhere, including on the way into this set. See
      // scripts/cardgen/auditSuperSeasonBadges.js.
      if (card.notBestSeason) {
        expect(card.badges ?? [], card.name).not.toContain('super-season');
        continue;
      }
      expect(card.badges ?? [], card.name).toContain(expected[card.migratedFrom.set]);
    }
  });

  it('gives every reward exactly one goal, and every goal one reward', () => {
    const goals = rewards.map(c => c.rewardGoal);
    expect(goals.every(Boolean)).toBe(true);
    expect(new Set(goals).size).toBe(rewards.length);
  });

  it('repeats no player across the reward set', () => {
    // LeBron James rewarded both Cleveland and the Lakers on the 2026-09-30
    // re-pick until the user moved the Lakers to Magic's 1989-90 the same day.
    const names = rewards.map(c => c.name);
    const twice = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
    expect(twice).toEqual([]);
  });

  it('leaves each source set large enough to still be worth opening', () => {
    // Picks target the LOW end of their band, which is what stops the migration
    // from gutting the sets it draws on.
    for (const set of ['super-season', 'rookie', 'summer-standouts']) {
      expect(CARD_SETS[set].length, set).toBeGreaterThan(40);
    }
  });
});
