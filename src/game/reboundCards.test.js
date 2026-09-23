// THE GLASS (2026-09-23) — four ways to spend a surplus on the boards, drafted
// in docs/plans/2026-09-23-rebound-cards-design.md and approved by the user
// ("Great, let's do it"):
//   Kick-Out Three    after your miss, 2 REB: a 3PT-Bonus teammate's 3PT check
//   Grab and Go       3 REB → 2 AST
//   Rebound and Push  after their miss, 2 REB: your defender on the shooter, paint +1
//   Own the Glass     lead the track by 6+, 5 REB: two paint checks at +1
import { describe, it, expect, vi, afterEach } from 'vitest';
import { newGame, getTeam } from './engine.js';
import { canPlayCard, kickOutTargets, pushGuardIdx } from './canPlay.js';
import { execCard } from './execCard.js';
import { aiBuildCardOpts } from './ai.js';
import { getStrat } from './strats.js';

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'PF', speed: 10, power: 10, defBoost: 0, salary: 500,
  shotLine: 14, paintBoost: 1, threePtBoost: 0,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...over,
});
const five = (pre, over) => Array.from({ length: 5 }, (_, i) => mk(`${pre}${i}`, over));
const filler = (pre, n) => Array.from({ length: n }, (_, i) => mk(`${pre}f${i}`));

function scoring({ who = 'A', hand = [], A = five('a'), B = five('b') } = {}) {
  const g = newGame([...A, ...filler('a', 5)], [...B, ...filler('b', 5)]);
  getTeam(g, 'A').starters = A;
  getTeam(g, 'B').starters = B;
  getTeam(g, 'A').hand = who === 'A' ? hand : [];
  getTeam(g, 'B').hand = who === 'B' ? hand : [];
  g.phase = 'scoring'; g.scoringTurn = who; g.scoringPasses = 0; g.placementStep = 10;
  // B's slot 3 guards A's slot 1 — so "the defender on the shooter" is not just the same slot.
  g.offMatchups = { A: [0, 3, 2, 1, 4], B: [0, 3, 2, 1, 4] };
  g.tempEff = { A: {}, B: {} };
  g.rollResults = { A: [], B: [] };
  return g;
}
/** Every die a 20 (hits) or a 1 (misses) while `fn` runs. */
const dice = (value, fn) => {
  const spy = vi.spyOn(Math, 'random').mockReturnValue(value === 20 ? 0.99 : 0);
  try { return fn(); } finally { spy.mockRestore(); }
};
afterEach(() => vi.restoreAllMocks());

describe('the four are registered as drafted', () => {
  it('has the phase, side, rarity and copies of the design', () => {
    expect(getStrat('kick_out_three')).toMatchObject({ phase: 'reaction', side: 'off', rarity: 'uncommon', copies: 2 });
    expect(getStrat('grab_and_go')).toMatchObject({ phase: 'scoring', side: 'off', rarity: 'common', copies: 2 });
    expect(getStrat('rebound_and_push')).toMatchObject({ phase: 'reaction', side: 'def', rarity: 'uncommon', copies: 2 });
    expect(getStrat('own_the_glass')).toMatchObject({ phase: 'scoring', side: 'off', rarity: 'rare', copies: 1 });
    // Kick-Out Three is Putback Specialist's twin: the same window and price.
    expect(getStrat('putback_specialist')).toMatchObject({ phase: 'reaction', side: 'off' });
  });
});

describe('Kick-Out Three', () => {
  const setup = () => {
    const A = five('a');
    A[1] = mk('a1', { threePtBoost: 2 });   // the shooter who missed: excluded
    A[2] = mk('a2', { threePtBoost: 1 });
    A[4] = mk('a4', { threePtBoost: 3 });
    const g = scoring({ hand: ['kick_out_three', 'putback_specialist'], A });
    getTeam(g, 'A').rebounds = 4;
    g.lastCheckMiss = { teamKey: 'A', type: 'paint', playerIdx: 1, claimed: false };
    return g;
  };

  it('opens on your own miss, for a 3PT-Bonus teammate other than the shooter', () => {
    const g = setup();
    expect(kickOutTargets(g, 'A').map(t => t.origIdx)).toEqual([2, 4]);
    expect(canPlayCard(g, 'A', 'kick_out_three').canPlay).toBe(true);
    g.lastCheckMiss.teamKey = 'B';
    expect(canPlayCard(g, 'A', 'kick_out_three').canPlay).toBe(false);
    g.lastCheckMiss.teamKey = 'A';
    getTeam(g, 'A').rebounds = 1;
    expect(canPlayCard(g, 'A', 'kick_out_three').canPlay).toBe(false);
  });

  it('refuses the shooter who missed and a player with no 3PT Bonus', () => {
    const g = setup();
    expect(execCard(g, 'A', 'kick_out_three', { playerIdx: 1 }).ok).toBe(false);
    expect(execCard(g, 'A', 'kick_out_three', { playerIdx: 0 }).ok).toBe(false);
  });

  it('spends 2 REB, claims the board, and the three pays 3', () => {
    const g = setup();
    const before = getTeam(g, 'A').score;
    const r = dice(20, () => execCard(g, 'A', 'kick_out_three', { playerIdx: 4 }));
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'A').rebounds).toBe(2);
    expect(getTeam(r.game, 'A').score).toBe(before + 3);
    // The board is taken: Putback Specialist cannot have the same miss.
    expect(canPlayCard(r.game, 'A', 'putback_specialist').canPlay).toBe(false);
  });

  it('the coach kicks it to the best three on the list', () => {
    expect(aiBuildCardOpts(setup(), 'A', 'kick_out_three')).toEqual({ playerIdx: 4 });
  });
});

describe('Rebound and Push', () => {
  const setup = () => {
    const g = scoring({ who: 'B', hand: ['rebound_and_push', 'glass_cleaner'] });
    getTeam(g, 'B').rebounds = 3;
    // A's slot 1 missed; B's slot 3 guards him (offMatchups.A[1] = 3).
    g.lastCheckMiss = { teamKey: 'A', type: '3pt', playerIdx: 1, claimed: false };
    return g;
  };

  it('opens on the opponent\'s miss and names the defender on the shooter', () => {
    const g = setup();
    expect(pushGuardIdx(g, 'B')).toBe(3);
    expect(canPlayCard(g, 'B', 'rebound_and_push').canPlay).toBe(true);
    g.lastCheckMiss.teamKey = 'B';
    expect(canPlayCard(g, 'B', 'rebound_and_push').canPlay).toBe(false);
  });

  it('spends 2 REB and the defender scores the paint check for his own team', () => {
    const g = setup();
    const before = getTeam(g, 'B').score;
    const r = dice(20, () => execCard(g, 'B', 'rebound_and_push', {}));
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'B').rebounds).toBe(1);
    expect(getTeam(r.game, 'B').score).toBe(before + 2);
    expect(r.game.log.some(l => /Rebound and Push: b3 boards the miss/.test(l.msg))).toBe(true);
    // Glass Cleaner wanted the same miss.
    expect(canPlayCard(r.game, 'B', 'glass_cleaner').canPlay).toBe(false);
  });
});

describe('Grab and Go', () => {
  it('turns 3 rebounds into 2 assists, and not fewer than 3', () => {
    const g = scoring({ hand: ['grab_and_go'] });
    getTeam(g, 'A').rebounds = 2;
    expect(canPlayCard(g, 'A', 'grab_and_go').canPlay).toBe(false);
    getTeam(g, 'A').rebounds = 7;
    getTeam(g, 'A').assists = 1;
    const r = execCard(g, 'A', 'grab_and_go', {});
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'A').rebounds).toBe(4);
    expect(getTeam(r.game, 'A').assists).toBe(3);
  });
});

describe('Own the Glass', () => {
  const setup = (mine, theirs) => {
    const g = scoring({ hand: ['own_the_glass'] });
    getTeam(g, 'A').rebounds = mine;
    getTeam(g, 'B').rebounds = theirs;
    return g;
  };

  it('needs a lead of 6 on the Rebound Track', () => {
    expect(canPlayCard(setup(10, 5), 'A', 'own_the_glass').canPlay).toBe(false);
    expect(canPlayCard(setup(11, 5), 'A', 'own_the_glass').canPlay).toBe(true);
    expect(execCard(setup(10, 5), 'A', 'own_the_glass', { playerIdx: 0 }).ok).toBe(false);
  });

  it('spends 5 REB on two paint checks at +1 by one player', () => {
    const g = setup(11, 5);
    const before = getTeam(g, 'A').score;
    const r = dice(20, () => execCard(g, 'A', 'own_the_glass', { playerIdx: 2 }));
    expect(r.ok).toBe(true);
    expect(getTeam(r.game, 'A').rebounds).toBe(6);
    expect(getTeam(r.game, 'A').score).toBe(before + 4);
    const checks = r.game.log.filter(l => /Own the Glass #[12]/.test(l.msg));
    expect(checks).toHaveLength(2);
  });

  it('the coach hands it to his best finisher', () => {
    const A = five('a');
    A[3] = mk('a3', { paintBoost: 4 });
    const g = scoring({ hand: ['own_the_glass'], A });
    expect(aiBuildCardOpts(g, 'A', 'own_the_glass')).toEqual({ playerIdx: 3 });
  });
});
