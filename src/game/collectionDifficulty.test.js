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
  it('prices every franchise reward into its earned band', () => {
    const wrong = CARD_SETS['team-rewards']
      .map(card => {
        // A pick may declare a band exception, and must say why. Philadelphia's
        // is Julius Erving at twenty dollars under the legendary floor, because
        // every Philly-jersey card above it belongs to a player on the very
        // roster the reward is for.
        if (card.bandException) return null;
        const want = rewardBandFor(`nba-team-${card.rewardFor}`);
        const got = getPlayerRarity(card);
        return want && got !== want.band
          ? `${card.rewardFor} ${card.name} $${card.salary} is ${got}, earns ${want.band}`
          : null;
      })
      .filter(Boolean);
    expect(wrong).toEqual([]);
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

  it('lets the TIERS stand above the base set, and the capstone above them', () => {
    // The deliberate exception, and it is the tier level rather than one card:
    // a conference is roughly seven times the hardest single roster and the
    // full set is sixteen, so both earn cards the base set cannot offer. What
    // must stay singular is the TOP — a capstone that ties a conference would
    // make the largest goal in the game no better than a third of it.
    const rewards = CARD_SETS['team-rewards'];
    const apex = Math.max(...CARD_SETS[BASE_SET].map(c => c.salary));
    const above = rewards.filter(c => c.salary >= apex);
    expect(above.every(c => !c.rewardFor)).toBe(true);
    const top = rewards.reduce((a, b) => (b.salary > a.salary ? b : a));
    expect(top.rewardGoal).toBe('nba-set');
    expect(rewards.filter(c => c.salary === top.salary)).toHaveLength(1);
  });

  it('ranks the tier rewards above every franchise reward', () => {
    const franchise = CARD_SETS['team-rewards'].filter(c => c.rewardFor);
    const tiers = CARD_SETS['team-rewards'].filter(c => !c.rewardFor);
    expect(tiers).toHaveLength(3);
    expect(Math.min(...tiers.map(c => c.salary)))
      .toBeGreaterThan(Math.max(...franchise.map(c => c.salary)));
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

  it('prefers a player who is NOT on the roster being completed', () => {
    // The user's rule: the reward should be absent from THAT TEAM'S base set,
    // so finishing a roster hands you a card you could not already have. Two
    // franchises cannot satisfy it — every Denver season above the band is
    // Jokic's and every Portland one is Lillard's, both on their own rosters —
    // and those fall back to an on-roster UPGRADE, which the test above still
    // guarantees. Pinned so a third exception has to be argued for.
    const onRoster = CARD_SETS['team-rewards']
      .filter(c => c.rewardFor)
      .filter(c => (TEAM_ROSTERS[c.rewardFor] ?? []).some(k => base.get(c.name)?.id === k))
      .map(c => c.rewardFor);
    // ['DEN'] since 2026-09-09: Portland's reward is Wesley Matthews's 2014-15,
    // off the roster, after the paint-line reprice dropped POR to super-rare
    // and Lillard's 2019-20 went back to Super Season.
    expect(onRoster.sort()).toEqual(['DEN']);
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

  it('moves most of the set rather than building it', () => {
    expect(moved.length).toBeGreaterThan(rewards.length / 2);
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
      expect(['super-season', 'rookie', 'summer-standouts'], card.name)
        .toContain(card.migratedFrom.set);
    }
  });

  it('carries the origin badge, so the card still says what it was', () => {
    const expected = {
      'super-season': 'super-season',
      rookie: 'rookie',
      'summer-standouts': 'summer-standout',
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

  it('never repeats a player across the reward set', () => {
    const names = rewards.map(c => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('leaves each source set large enough to still be worth opening', () => {
    // Picks target the LOW end of their band, which is what stops the migration
    // from gutting the sets it draws on.
    for (const set of ['super-season', 'rookie', 'summer-standouts']) {
      expect(CARD_SETS[set].length, set).toBeGreaterThan(40);
    }
  });
});
