import { describe, it, expect } from 'vitest';
import { calcAdv } from '../../src/game/engine.js';
import {
  ADVANTAGE,
  DISADVANTAGE,
  NEUTRAL,
  budgetOnlyNetEdges,
  buildMatchupMatrix,
  defBoostCredit,
  crossSetSummary,
  evaluateMatchup,
  pearson,
  profilePlayer,
  translationResiduals,
  zScores,
} from './matchupMatrix.js';

const card = (name, speed, power, defBoost = 0) => ({ id: name, name, speed, power, defBoost });

describe('evaluateMatchup agrees with the engine', () => {
  // Hand-worked against the rule in src/game/engine.js:150.
  //
  //   rawSpeed = 18 - 10 = 8      rawPower = 15 - 10 = 5
  //   neither is <= 0, so the advantage branch applies, db = 3
  //   speedAdv = max(0, 8 - 3) = 5    powerAdv = max(0, 5 - 3) = 2
  //   rollBonus = max(5, 2) = 5
  //   without Def Boost it would have been max(8, 5) = 8, so blunted = 3
  it('reproduces a hand-worked advantage, Def Boost shaving 3 off the top', () => {
    const m = evaluateMatchup(card('Att', 18, 15), card('Def', 10, 10, 3));
    expect(m).toMatchObject({
      outcome: ADVANTAGE,
      axis: 'both',
      speedAdv: 5,
      powerAdv: 2,
      rollBonus: 5,
      rawBonus: 8,
      blunted: 3,
      db: 3,
      hasPenalty: false,
    });
    // and it is literally the engine's own number
    expect(m.rollBonus).toBe(calcAdv(card('Att', 18, 15), card('Def', 10, 10, 3)).rollBonus);
  });

  //   rawSpeed = 12 - 10 = 2      rawPower = 8 - 10 = -2
  //   rawSpeed > 0 so the advantage branch applies, db = 2
  //   speedAdv = max(0, 2 - 2) = 0    powerAdv = max(0, -2 - 2) = 0
  //   rollBonus = 0 -> neutral, and it is neutral ONLY because of Def Boost
  it('reproduces a hand-worked advantage erased by Def Boost', () => {
    const m = evaluateMatchup(card('Att', 12, 8), card('Def', 10, 10, 2));
    expect(m).toMatchObject({
      outcome: NEUTRAL,
      axis: null,
      rollBonus: 0,
      rawBonus: 2,
      blunted: 2,
      neutralisedByDef: true,
    });
    expect(calcAdv(card('Att', 12, 8), card('Def', 10, 10, 2)).rollBonus).toBe(0);
  });

  //   rawSpeed = 6 - 12 = -6      rawPower = 7 - 15 = -8
  //   both <= 0, so the penalty branch applies and Def Boost is never consulted
  //   rollBonus = max(-6, -8) = -6
  it('reproduces a hand-worked penalty, where Def Boost is inert', () => {
    const m = evaluateMatchup(card('Att', 6, 7), card('Def', 12, 15, 4));
    expect(m).toMatchObject({
      outcome: DISADVANTAGE,
      axis: null,
      rollBonus: -6,
      rawBonus: -6,
      blunted: 0,
      hasPenalty: true,
    });
    // A 4-point Def Boost changed nothing: the same defender at 0 is identical.
    expect(evaluateMatchup(card('Att', 6, 7), card('Def', 12, 15, 0)).rollBonus).toBe(-6);
  });

  it('never lets a defender turn an attacker negative — Def Boost only neutralises', () => {
    for (let db = 0; db <= 12; db++) {
      const m = evaluateMatchup(card('Att', 14, 9), card('Def', 10, 10, db));
      expect(m.rollBonus).toBeGreaterThanOrEqual(0);
    }
  });

  it('makes a NEGATIVE Def Boost bite, exactly as the engine does', () => {
    // THIS TEST ONCE ASSERTED THE OPPOSITE — that -2 and 0 were the same
    // defender, because engine.js clamped with Math.max(0, def.defBoost || 0)
    // and a negative was therefore inert. That clamp sat on the BOOST; it now
    // sits on the defender's STATS instead, so a weak defender guards at lower
    // effective Speed and Power and the attacker really does get more.
    const att = card('Att', 14, 9);
    const nerfed = evaluateMatchup(att, card('Def', 10, 10, -2));
    const plain = evaluateMatchup(att, card('Def', 10, 10, 0));
    expect(plain.rollBonus).toBe(4);
    // Def 10 / Pow 10 at -2 guards as 8 / 8, so the 14-Speed attacker gains 2.
    expect(nerfed.rollBonus).toBe(6);
    // And the nerf OPENS A SECOND AXIS. At full strength this attacker beat the
    // defender on Speed alone (9 Power against 10 was a losing axis); against
    // the same defender at 8 Power it is a winning one. A Def Boost is not only
    // worth roll-bonus points, it decides how many ways in there are.
    expect(plain.axis).toBe('speed');
    expect(nerfed.axis).toBe('both');
    // Signed: the weakness HANDED OVER two points rather than removing any.
    expect(nerfed.blunted).toBe(-2);
    expect(plain.blunted).toBe(0);
  });

  it('floors a nerfed defender at zero rather than at less than nothing', () => {
    // Nick Richards by the numbers on his own card: Speed 2, Power 4, Def -3.
    // Speed floors at 0 instead of going to -1; Power lands on 1.
    const att = card('Att', 10, 10);
    const richards = evaluateMatchup(att, card('Richards', 2, 4, -3));
    expect(richards.rawSpeedDiff).toBe(10);
    expect(richards.rawPowerDiff).toBe(9);
    // A deeper nerf cannot take him below zero, so it cannot keep paying out.
    const deeper = evaluateMatchup(att, card('Deeper', 2, 4, -9));
    expect(deeper.rawSpeedDiff).toBe(10);
  });

  it('agrees with calcAdv across an exhaustive sweep of the printed range', () => {
    for (let os = 4; os <= 18; os += 2) {
      for (let op = 4; op <= 18; op += 2) {
        for (let ds = 4; ds <= 18; ds += 2) {
          for (let dp = 4; dp <= 18; dp += 2) {
            for (const db of [-3, 0, 1, 3, 5]) {
              const off = card('o', os, op), def = card('d', ds, dp, db);
              const m = evaluateMatchup(off, def);
              const engine = calcAdv(off, def);
              expect(m.rollBonus).toBe(engine.rollBonus);
              // rawBonus must equal what the engine returns with no Def Boost
              expect(m.rawBonus).toBe(calcAdv(off, card('d', ds, dp, 0)).rollBonus);
              // Signed now: a real Def Boost removes points, a negative one
              // hands them over, and 0 moves nothing.
              if (db > 0) expect(m.blunted).toBeGreaterThanOrEqual(0);
              else if (db === 0) expect(m.blunted).toBe(0);
              else expect(m.blunted).toBeLessThanOrEqual(0);
            }
          }
        }
      }
    }
  });

  it('only ever classifies a disadvantage as losing on both axes', () => {
    // Consequence of rollBonus = max(speed, power): you cannot be at a
    // disadvantage while leading either axis.
    for (let os = 4; os <= 18; os++) {
      for (let ds = 4; ds <= 18; ds++) {
        const m = evaluateMatchup(card('o', os, 11), card('d', ds, 11, 2));
        if (m.outcome === DISADVANTAGE) {
          expect(m.rawSpeedDiff).toBeLessThan(0);
          expect(m.rawPowerDiff).toBeLessThan(0);
        }
      }
    }
  });
});

describe('buildMatchupMatrix aggregation', () => {
  // A dominates; B and C have identical Speed/Power and differ only in Def
  // Boost, which isolates exactly what a Def Boost buys.
  const set = [
    card('A', 15, 15, 0),
    card('B', 10, 10, 0),
    card('C', 10, 10, 5),
  ];
  const rows = buildMatchupMatrix(set);
  const byName = Object.fromEntries(rows.map(r => [r.name, r]));

  it('gives every player one matchup per opponent in each direction', () => {
    for (const r of rows) {
      expect(r.offense.matchups).toBe(2);
      expect(r.defense.matchups).toBe(2);
      expect(r.offense.advantages + r.offense.disadvantages + r.offense.neutral).toBe(2);
      expect(r.defense.advantages + r.defense.disadvantages + r.defense.neutral).toBe(2);
    }
  });

  it('counts A: beats B by 5 on both axes, neutralised by C', () => {
    const a = byName.A.offense;
    expect(a).toMatchObject({
      advantages: 1, disadvantages: 0, neutral: 1,
      advByBoth: 1, advBySpeed: 0, advByPower: 0,
      advMagnitude: 5, netMagnitude: 5,
      neutralised: 1,   // C's Def Boost erased the other one
      blunted: 5,
    });
    expect(a.meanRollBonus).toBe(2.5);
  });

  it('counts A on defence: forces a penalty on everyone', () => {
    expect(byName.A.defense).toMatchObject({
      advantages: 0, disadvantages: 2, neutral: 0,
      disMagnitude: 10, netMagnitude: -10, blunted: 0,
    });
    expect(byName.A.defense.meanRollBonus).toBe(-5);
  });

  it('credits C\'s Def Boost with the advantage it erased', () => {
    expect(byName.C.defense).toMatchObject({
      advantages: 0, neutral: 2, disadvantages: 0,
      neutralised: 1, blunted: 5, netMagnitude: 0,
    });
    // B, identical but for Def Boost, concedes the full 5 instead.
    expect(byName.B.defense).toMatchObject({
      advantages: 1, neutralised: 0, blunted: 0, netMagnitude: 5,
    });
  });

  it('prices the Def Boost as netEdge: C is 2.5 better than an identical B', () => {
    expect(byName.A.netEdge).toBe(7.5);
    expect(byName.B.netEdge).toBe(-5);
    expect(byName.C.netEdge).toBe(-2.5);
    expect(byName.C.netEdge - byName.B.netEdge).toBe(2.5);
  });

  it('builds a roll-bonus histogram that sums to the matchup count', () => {
    for (const r of rows) {
      const total = Object.values(r.offense.histogram).reduce((s, n) => s + n, 0);
      expect(total).toBe(r.offense.matchups);
    }
    expect(byName.A.offense.histogram).toEqual({ 0: 1, 5: 1 });
  });

  it('conserves roll bonus across the two directions of the whole matrix', () => {
    // Every matchup is recorded once on offence and once on defence, so the
    // two sums over the entire set must be identical.
    const offTotal = rows.reduce((s, r) => s + r.offense.netMagnitude, 0);
    const defTotal = rows.reduce((s, r) => s + r.defense.netMagnitude, 0);
    expect(offTotal).toBe(defTotal);
  });

  it('excludes self-matchups', () => {
    const solo = buildMatchupMatrix([card('Only', 10, 10)]);
    expect(solo[0].offense.matchups).toBe(0);
    expect(solo[0].netEdge).toBe(0);
  });
});

describe('the Speed+Power identity', () => {
  const field = [
    card('a', 4, 18), card('b', 18, 4), card('c', 11, 11),
    card('d', 6, 9), card('e', 15, 8), card('f', 9, 13), card('g', 5, 5),
  ];

  it('is EXACT with no Def Boost: Net Edge is the budget minus the field mean', () => {
    const rows = buildMatchupMatrix(field);
    const predicted = budgetOnlyNetEdges(field);
    rows.forEach((r, i) => expect(r.netEdge).toBeCloseTo(predicted[i], 10));
  });

  it('makes the Speed/Power SPLIT irrelevant to Net Edge', () => {
    // Two cards on the same budget, split at opposite extremes, must land on
    // the same Net Edge even though they beat completely different opponents.
    const rows = buildMatchupMatrix(field);
    const a = rows.find(r => r.name === 'a');   // 4/18
    const b = rows.find(r => r.name === 'b');   // 18/4
    expect(a.speedPower).toBe(b.speedPower);
    expect(a.netEdge).toBeCloseTo(b.netEdge, 10);
    // ...while genuinely playing differently:
    expect(a.offense.advBySpeed).not.toBe(b.offense.advBySpeed);
  });

  it('credits Def Boost with the departure from that line, zero-sum', () => {
    const boosted = field.map(c => (c.name === 'g' ? { ...c, defBoost: 4 } : c));
    const rows = defBoostCredit(buildMatchupMatrix(boosted), boosted);
    const g = rows.find(r => r.name === 'g');
    const others = rows.filter(r => r.name !== 'g');

    expect(g.defBoostCredit).toBeGreaterThan(0);
    // A boost is taken FROM the field, not created: everyone else loses the
    // advantage it blunts, so the credits sum to zero across the set.
    expect(rows.reduce((s, r) => s + r.defBoostCredit, 0)).toBeCloseTo(0, 10);
    for (const r of others) expect(r.defBoostCredit).toBeLessThan(0);
    // With no boosts anywhere, every card sits exactly on the line.
    const flat = defBoostCredit(buildMatchupMatrix(field), field);
    for (const r of flat) expect(r.defBoostCredit).toBeCloseTo(0, 10);
  });

  it('pays a Def Boost less when nobody can beat the defender anyway', () => {
    // Same +4 boost on the strongest card in the field buys far less than on
    // the weakest, because it has almost no advantages left to blunt.
    const weak = field.map(c => (c.name === 'g' ? { ...c, defBoost: 4 } : c));
    const strong = field.map(c => (c.name === 'b' ? { ...c, defBoost: 4 } : c));
    const wc = defBoostCredit(buildMatchupMatrix(weak), weak).find(r => r.name === 'g');
    const sc = defBoostCredit(buildMatchupMatrix(strong), strong).find(r => r.name === 'b');
    expect(wc.defBoostCredit).toBeGreaterThan(sc.defBoostCredit);
  });
});

describe('profilePlayer', () => {
  const set = [card('A', 15, 15, 0), card('B', 10, 10, 0), card('C', 10, 10, 5)];

  it('reproduces a real member\'s matrix row exactly', () => {
    const row = buildMatchupMatrix(set).find(r => r.name === 'B');
    const solo = profilePlayer(card('B', 10, 10, 0), set);
    expect(solo.netEdge).toBe(row.netEdge);
    expect(solo.offense.netMagnitude).toBe(row.offense.netMagnitude);
    expect(solo.defense.netMagnitude).toBe(row.defense.netMagnitude);
  });

  it('measures the marginal value of a point of Def Boost', () => {
    const base = profilePlayer(card('B', 10, 10, 0), set);
    const boosted = profilePlayer(card('B', 10, 10, 1), set);
    // A attacks B for +5; one point of Def Boost shaves it to +4, over 2
    // matchups that is 0.5 of mean conceded, so netEdge rises by 0.5.
    expect(boosted.netEdge - base.netEdge).toBe(0.5);
  });
});

describe('crossSetSummary', () => {
  it('runs every attacker against every defender with no self-exclusion', () => {
    const s = crossSetSummary([card('A', 15, 15)], [card('A', 15, 15), card('B', 10, 10)]);
    expect(s.matchups).toBe(2);
    expect(s.neutral).toBe(1);      // the same card against itself is a wash
    expect(s.advantages).toBe(1);
    expect(s.meanRollBonus).toBe(2.5);
  });
});

describe('statistics helpers', () => {
  it('z-scores centre on the pool mean', () => {
    expect(zScores([1, 2, 3])).toEqual([-1, 0, 1]);
  });

  it('returns zeros rather than NaN for a flat pool', () => {
    expect(zScores([4, 4, 4])).toEqual([0, 0, 0]);
  });

  it('correlates a perfect line at 1', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
  });

  it('residual is positive when the card outperforms the EPM it came from', () => {
    const rows = [
      { name: 'Over', netEdge: 10 },
      { name: 'Mid', netEdge: 0 },
      { name: 'Under', netEdge: -10 },
    ];
    const epm = new Map([
      ['Over', { epm: 0 }],
      ['Mid', { epm: 0 }],
      ['Under', { epm: 10 }],
    ]);
    const out = translationResiduals(rows, epm, { metric: r => r.netEdge, epmKey: 'epm' });
    expect(out[0].residual).toBeGreaterThan(0);
    expect(out[2].residual).toBeLessThan(0);
  });

  it('marks a player with no EPM as null rather than dropping him', () => {
    const rows = [{ name: 'Known', netEdge: 1 }, { name: 'Unknown', netEdge: 2 }];
    const epm = new Map([['Known', { epm: 1 }]]);
    const out = translationResiduals(rows, epm, { metric: r => r.netEdge, epmKey: 'epm' });
    expect(out).toHaveLength(2);
    expect(out[1].residual).toBeNull();
  });
});
