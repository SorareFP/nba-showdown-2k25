// THE "+" CARDS (The Climb, Task 6 — docs/plans/2026-10-18-the-climb-upgrades.md,
// approved by the user 2026-10-19 with five changes). Each card is played on
// the same board as its plain copy and as its "+" copy, and the test pins the
// difference the approved text promises — and that the plain card is as it was.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam } from './engine.js';
import { execCard } from './execCard.js';
import { canPlayCard } from './canPlay.js';
import { plusId } from './strats.js';

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed: 12, power: 12,
  shotLine: 14, paintBoost: 1, threePtBoost: 1, defBoost: 1, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...over,
});

/** A board with both fives on the floor, A to act, six assists and rebounds a side. */
function board(phase, { a = [], b = [] } = {}) {
  const roster = (prefix, over) => Array.from({ length: 5 }, (_, i) => mk(`${prefix}${i}`, over[i] ?? {}));
  const g = newGame(roster('a', a), roster('b', b));
  g.teamA.starters = g.teamA.roster.slice(0, 5);
  g.teamB.starters = g.teamB.roster.slice(0, 5);
  g.phase = phase;
  g.matchupTurn = 'A';
  g.scoringTurn = 'A';
  for (const t of [g.teamA, g.teamB]) { t.assists = 6; t.rebounds = 6; }
  // The defence holds answers, so an announced check waits (canAnswerCheck)
  // and the test can read it.
  g.teamB.hand = ['close_out', 'drop_coverage', 'smothering_defense', 'rim_protector'];
  return g;
}
const id = (card, plus) => (plus ? plusId(card) : card);
/** `key` plays `card` (plain or "+") from a hand of that card and one other. */
function play(g, key, card, plus, opts = {}) {
  getTeam(g, key).hand = [id(card, plus), 'turnover'];
  return execCard(g, key, id(card, plus), opts);
}
/** Both versions of one play on fresh copies of one board. */
function both(make, key, card, opts = {}) {
  const plain = play(make(), key, card, false, opts);
  const plus = play(make(), key, card, true, opts);
  return { plain, plus };
}
const okBoth = ({ plain, plus }) => { expect(plain.ok, plain.msg).toBe(true); expect(plus.ok, plus.msg).toBe(true); };
const screened = () => {
  const g = board('matchup_strats');
  const r = play(g, 'B', 'high_screen_roll', false, { swapSlot1: 0, swapSlot2: 1 });
  r.game.matchupTurn = 'A';
  return r.game;
};
const switchedOnA = (b = []) => {
  const g = board('matchup_strats', { b });
  const r = play(g, 'B', 'switch_the_screen', false, { slots: [0, 1] });
  r.game.matchupTurn = 'A';
  return r.game;
};
const checkByB = (type, extra = {}) => () => {
  const g = board('scoring', extra);
  g.pendingShotCheck = { teamKey: 'B', playerIdx: 0, type, bonus: 3 };
  return g;
};

describe('the core', () => {
  it('High Screen & Roll+: +1 Assist, and nothing can cancel it', () => {
    const r = both(() => board('matchup_strats'), 'A', 'high_screen_roll', { swapSlot1: 0, swapSlot2: 1 });
    okBoth(r);
    expect(r.plain.game.teamA.assists).toBe(6);
    expect(r.plus.game.teamA.assists).toBe(7);
    for (const [res, can] of [[r.plain, true], [r.plus, false]]) {
      const g = res.game;
      g.matchupTurn = 'B';
      for (const c of ['go_under', 'fight_over', 'veer_switch']) expect(canPlayCard(g, 'B', c).canPlay, c).toBe(can);
    }
  });

  it('Switch the Screen+: the opponent loses 1 Assist, and nothing answers it', () => {
    // Three, not six: dropping to exactly 5 trips the 5-Assist card draw, which sets 6.
    const make = () => { const g = board('matchup_strats'); g.teamB.assists = 3; return g; };
    const r = both(make, 'A', 'switch_the_screen', { slots: [0, 1] });
    okBoth(r);
    expect(r.plain.game.teamB.assists).toBe(3);
    expect(r.plus.game.teamB.assists).toBe(2);
    expect(canPlayCard(r.plain.game, 'B', 'overhelp').canPlay).toBe(true);
    expect(canPlayCard(r.plus.game, 'B', 'overhelp').canPlay).toBe(false);
  });

  it('Veer Switch+: draws a card', () => {
    const r = both(screened, 'A', 'veer_switch', { veerSwap: true });
    okBoth(r);
    expect(r.plus.game.teamA.hand.length).toBe(r.plain.game.teamA.hand.length + 1);
  });

  it('Go Under+: the offence still picks the shooter, at −4 instead of +2', () => {
    const r = both(screened, 'A', 'go_under');
    okBoth(r);
    expect(r.plain.game.pendingChoice).toMatchObject({ kind: 'go_under', teamKey: 'B', extra: 2 });
    expect(r.plus.game.pendingChoice).toMatchObject({ kind: 'go_under', teamKey: 'B', extra: -4 });
  });

  it('Overhelp+ and Burned on the Switch+: +5 instead of +3', () => {
    const o = both(() => switchedOnA(), 'A', 'overhelp', { playerIdx: 0 });
    okBoth(o);
    expect(o.plain.game.tempEff.A.r0).toBe(3);
    expect(o.plus.game.tempEff.A.r0).toBe(5);
    // b0 slow, b1 fast: swapping them puts the slow man on A1 — a weaker defender there.
    const b = both(() => switchedOnA([{ speed: 8 }, { speed: 14 }]), 'A', 'burned_switch');
    okBoth(b);
    const slot = Object.keys(b.plain.game.tempEff.A).find(k => /^r\d$/.test(k));
    expect(b.plain.game.tempEff.A[slot]).toBe(3);
    expect(b.plus.game.tempEff.A[slot]).toBe(5);
  });
});

describe('the speed kit', () => {
  it('Catch & Shoot+: Speed 11 is enough, and the check is at +4', () => {
    const slow = () => board('scoring', { a: [{ speed: 11 }, { speed: 11 }, { speed: 11 }, { speed: 11 }, { speed: 11 }] });
    expect(canPlayCard(slow(), 'A', 'catch_and_shoot').canPlay).toBe(false);
    expect(canPlayCard(slow(), 'A', plusId('catch_and_shoot')).canPlay).toBe(true);
    const r = both(slow, 'A', 'catch_and_shoot', { playerIdx: 0 });
    expect(r.plain.ok).toBe(false);
    expect(r.plus.game.pendingShotCheck).toMatchObject({ type: '3pt', bonus: 4 });
    expect(play(board('scoring'), 'A', 'catch_and_shoot', false, { playerIdx: 0 }).game.pendingShotCheck.bonus).toBe(2);
  });

  it('First Step+: +4 Speed, +6 with a Speed edge of 5', () => {
    const r = both(() => board('scoring'), 'A', 'first_step', { playerIdx: 0 });
    okBoth(r);
    expect([r.plain.game.tempEff.A.s0, r.plus.game.tempEff.A.s0]).toEqual([2, 4]);
    const big = both(() => board('scoring', { a: [{ speed: 18 }] }), 'A', 'first_step', { playerIdx: 0 });
    expect([big.plain.game.tempEff.A.s0, big.plus.game.tempEff.A.s0]).toEqual([3, 6]);
  });

  it('Drive the Lane+: three free throws, and the cold marker from a Speed edge of 4', () => {
    // A Speed edge of 4 (the defender's Defensive Bonus counts): cold for the "+" only.
    const r = both(() => board('scoring', { a: [{ speed: 17 }] }), 'A', 'drive_the_lane', { playerIdx: 0 });
    okBoth(r);
    const fts = res => res.game.log.filter(l => /Drive FT #/.test(l.msg)).length;
    expect([fts(r.plain), fts(r.plus)]).toEqual([2, 3]);
    const cold = res => res.game.teamB.stats.find(s => s.id === 'b0').cold;
    expect(cold(r.plain)).toBe(0);
    expect(cold(r.plus)).toBe(1);
  });

  it('Spain Pick & Roll+: +4 to the roll, still +1 Assist on a score', () => {
    const r = both(() => board('scoring', { a: [{ speed: 14 }] }), 'A', 'spain_pick_roll', { playerIdx: 0 });
    okBoth(r);
    expect([r.plain.game.tempEff.A.r0, r.plus.game.tempEff.A.r0]).toEqual([2, 4]);
    expect(r.plus.game.tempEff.A.astOnScore0).toBe(1);
  });

  it('Ghost Screen+: Speed 11 is enough, and the roll gets +2', () => {
    const make = () => board('scoring', { a: [{ speed: 11 }, { speed: 11 }, { speed: 11 }, { speed: 11 }, { speed: 11 }], b: [{ speed: 16, power: 16 }] });
    expect(canPlayCard(make(), 'A', 'ghost_screen').canPlay).toBe(false);
    expect(canPlayCard(make(), 'A', plusId('ghost_screen')).canPlay).toBe(true);
    const r = both(make, 'A', 'ghost_screen', { playerIdx: 0 });
    expect(r.plain.ok).toBe(false);
    expect(r.plus.game.ghosted.A_0).toBe(true);
    expect(r.plus.game.tempEff.A.r0).toBe(2);
    const fast = play(board('scoring'), 'A', 'ghost_screen', false, { playerIdx: 0 });
    expect(fast.game.tempEff.A?.r0).toBeUndefined();
  });

  it('Close Out+: −5 instead of −3', () => {
    const r = both(checkByB('3pt'), 'A', 'close_out');
    okBoth(r);
    expect([r.plain.game.pendingShotCheck.closeOutBonus, r.plus.game.pendingShotCheck.closeOutBonus]).toEqual([-3, -5]);
  });

  it('Passing Lane+: you gain 1 Assist, and the extra is 2', () => {
    const make = fast => () => {
      const g = board('scoring', { a: fast ? [{ speed: 16 }] : [] });
      g.lastRoll = { teamKey: 'B', idx: 0, ast: 2 };
      return g;
    };
    const even = both(make(false), 'A', 'passing_lane');
    okBoth(even);
    expect([even.plain.game.teamB.assists, even.plus.game.teamB.assists]).toEqual([4, 4]);
    expect([even.plain.game.teamA.assists, even.plus.game.teamA.assists]).toEqual([6, 7]);
    const edge = both(make(true), 'A', 'passing_lane');
    expect([edge.plain.game.teamB.assists, edge.plus.game.teamB.assists]).toEqual([3, 2]);
  });
});

describe('the paint kit', () => {
  it('Bully Ball+: checks at +2, +4 with a Power edge of 4', () => {
    // The defender's Defensive Bonus (1) counts against the edge (calcAdv).
    const small = both(() => board('scoring', { a: [{ power: 14 }] }), 'A', 'bully_ball', { playerIdx: 0 });
    okBoth(small);
    expect([small.plain.game.pendingShotCheck.bonus, small.plus.game.pendingShotCheck.bonus]).toEqual([0, 2]);
    const big = both(() => board('scoring', { a: [{ power: 17 }] }), 'A', 'bully_ball', { playerIdx: 0 });
    expect([big.plain.game.pendingShotCheck.bonus, big.plus.game.pendingShotCheck.bonus]).toEqual([2, 4]);
  });

  it('Power Move+: +4 Power, +6 with a Power edge of 5', () => {
    const r = both(() => board('scoring'), 'A', 'power_move', { playerIdx: 0 });
    okBoth(r);
    expect([r.plain.game.tempEff.A.p0, r.plus.game.tempEff.A.p0]).toEqual([2, 4]);
    const big = both(() => board('scoring', { a: [{ power: 18 }] }), 'A', 'power_move', { playerIdx: 0 });
    expect([big.plain.game.tempEff.A.p0, big.plus.game.tempEff.A.p0]).toEqual([3, 6]);
  });

  it('Back to the Basket+: Power 12 is enough, and the check is at +3', () => {
    const make = () => board('scoring', { a: [{ power: 12 }, { power: 12 }, { power: 12 }, { power: 12 }, { power: 12 }] });
    expect(canPlayCard(make(), 'A', 'back_to_basket').canPlay).toBe(false);
    expect(canPlayCard(make(), 'A', plusId('back_to_basket')).canPlay).toBe(true);
    const r = both(make, 'A', 'back_to_basket', { playerIdx: 0 });
    expect(r.plain.ok).toBe(false);
    expect(r.plus.game.pendingShotCheck).toMatchObject({ type: 'paint', bonus: 3 });
  });

  it('Offensive Board Mastery+: two rebounds, and the second roll has no penalty', () => {
    const make = reb => () => {
      const g = board('scoring');
      g.teamA.rebounds = reb;
      g.teamA.reboundsWon = 6;
      g.teamB.reboundsWon = 0;
      g.rollResults.A[0] = { die: 10, pts: 2 };
      return g;
    };
    const two = both(make(2), 'A', 'offensive_board', { playerIdx: 0 });
    expect(two.plain.ok).toBe(false);
    expect(two.plus.ok, two.plus.msg).toBe(true);
    expect(two.plus.game.teamA.rebounds).toBe(0);
    expect(two.plus.game.tempEff.A.extra_roll_0).toBe(0);
    const three = play(make(3)(), 'A', 'offensive_board', false, { playerIdx: 0 });
    expect(three.game.tempEff.A.extra_roll_0).toBe(-2);
    const lead2 = make(2)();
    lead2.teamA.reboundsWon = 2;
    expect(canPlayCard(lead2, 'A', plusId('offensive_board')).canPlay).toBe(true);
  });

  it('Putback Specialist+: the check is at +5, and a hit is +1 Assist', () => {
    const make = () => {
      const g = board('scoring');
      g.teamA.reboundsWon = 6;
      g.teamB.reboundsWon = 0;
      g.lastCheckMiss = { teamKey: 'A', playerIdx: 1 };
      return g;
    };
    const r = both(make, 'A', 'putback_specialist', { playerIdx: 0 });
    okBoth(r);
    expect([r.plain.game.pendingShotCheck.bonus, r.plus.game.pendingShotCheck.bonus]).toEqual([3, 5]);
    expect(r.plus.game.pendingShotCheck.onHit).toBe('ast');
  });

  it('Glass Cleaner+: +4 rebounds, +1 more with the Power edge', () => {
    const make = strong => () => {
      const g = board('scoring', { a: strong ? [{ power: 16 }] : [] });
      g.lastCheckMiss = { teamKey: 'B', playerIdx: 0 };
      return g;
    };
    const even = both(make(false), 'A', 'glass_cleaner');
    okBoth(even);
    expect([even.plain.game.teamA.rebounds, even.plus.game.teamA.rebounds]).toEqual([8, 10]);
    const edge = both(make(true), 'A', 'glass_cleaner');
    expect([edge.plain.game.teamA.rebounds, edge.plus.game.teamA.rebounds]).toEqual([9, 11]);
  });

  it('Box Out+: you gain 1 rebound, and the extra is 2', () => {
    const make = strong => () => {
      const g = board('scoring', { a: strong ? [{ power: 16 }] : [] });
      g.teamB.reboundsWon = 6;
      g.lastRoll = { teamKey: 'B', idx: 0, reb: 2 };
      return g;
    };
    const even = both(make(false), 'A', 'box_out');
    okBoth(even);
    expect([even.plain.game.teamA.rebounds, even.plus.game.teamA.rebounds]).toEqual([6, 7]);
    const edge = both(make(true), 'A', 'box_out');
    expect(edge.plus.game.log.at(-1).msg).toMatch(/4 REB cancelled/);
    expect(edge.plain.game.log.at(-1).msg).toMatch(/3 REB cancelled/);
  });
});

describe('the defense kit', () => {
  it('Drop Coverage+: −4 instead of −2', () => {
    const r = both(checkByB('paint'), 'A', 'drop_coverage');
    okBoth(r);
    expect([r.plain.game.pendingShotCheck.contest, r.plus.game.pendingShotCheck.contest]).toEqual([-2, -4]);
  });

  it('Smothering Defense+: the whole card bonus goes, and the check is at −1', () => {
    const r = both(checkByB('3pt'), 'A', 'smothering_defense');
    okBoth(r);
    expect(r.plain.game.pendingShotCheck.smother).toBe(3);
    expect(r.plain.game.pendingShotCheck.contest ?? 0).toBe(0);
    expect(r.plus.game.pendingShotCheck.smother).toBeGreaterThanOrEqual(99);
    expect(r.plus.game.pendingShotCheck.contest).toBe(-1);
  });

  it('Pick Up Full Court+: −4 to the roll, the same 4 minutes', () => {
    const r = both(() => board('matchup_strats'), 'A', 'pick_up_full_court', { targetIdx: 0 });
    okBoth(r);
    expect([r.plain.game.tempEff.B.r0, r.plus.game.tempEff.B.r0]).toEqual([-1, -4]);
    const min = res => res.game.teamB.stats.find(s => s.id === 'b0').minutes;
    expect([min(r.plain), min(r.plus)]).toEqual([4, 4]);
  });

  it('Rim Protector+: from Power + Defense 13, −5, and a miss is +3 rebounds', () => {
    const make = checkByB('paint', { a: [{ power: 12, defBoost: 1 }] });
    expect(canPlayCard(make(), 'A', 'rim_protector').canPlay).toBe(false);
    expect(canPlayCard(make(), 'A', plusId('rim_protector')).canPlay).toBe(true);
    const r = both(make, 'A', 'rim_protector');
    expect(r.plain.ok).toBe(false);
    expect(r.plus.game.pendingShotCheck).toMatchObject({ contest: -5, rimProtector: 'A', rimProtectorReb: 3 });
  });

  it('Help Defender+: from a +3 edge, and nobody is left open', () => {
    // Their edge over a defender with a Defensive Bonus of 1.
    const make = edge => () => board('scoring', { b: [{ speed: 13 + edge }] });
    expect(canPlayCard(make(3)(), 'A', 'help_defender').canPlay).toBe(false);
    expect(canPlayCard(make(3)(), 'A', plusId('help_defender')).canPlay).toBe(true);
    const r = both(make(4), 'A', 'help_defender', { targetIdx: 0, helperIdx: 1 });
    okBoth(r);
    expect(r.plain.game.tempEff.B.r1).toBe(3);
    expect(r.plus.game.tempEff.B?.r1).toBeUndefined();
  });

  it('Cold Spell+: answers a natural 1 to 5, Rebound Track −1', () => {
    const make = die => () => {
      const g = board('scoring');
      g.teamB.reboundsWon = 6;
      g.rollResults.B[0] = { die, pts: 0 };
      return g;
    };
    expect(canPlayCard(make(5)(), 'A', 'cold_spell').canPlay).toBe(false);
    expect(canPlayCard(make(5)(), 'A', plusId('cold_spell')).canPlay).toBe(true);
    expect(canPlayCard(make(6)(), 'A', plusId('cold_spell')).canPlay).toBe(false);
    const r = both(make(5), 'A', 'cold_spell', { playerIdx: 0 });
    expect(r.plain.ok).toBe(false);
    expect(r.plus.ok, r.plus.msg).toBe(true);
    expect(r.plus.game.teamB.stats.find(s => s.id === 'b0').cold).toBe(1);
    expect(r.plus.game.teamB.reboundsWon).toBe(5);
  });
});
