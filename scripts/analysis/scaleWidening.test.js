import { describe, it, expect } from 'vitest';
import { evaluateMatchup } from './matchupMatrix.js';
import {
  SCORING_ROLLS_PER_GAME,
  SECTIONS_PER_GAME,
  STARTERS,
  bonusExchangeRate,
  bonusPointsCurve,
  budgetEdges,
  chartExpectedValues,
  clampRoll,
  countIdentities,
  draftRoster,
  expectedChartValue,
  mechanicalIdentity,
  respec,
  rng,
  sampledGameScoring,
  scoringProfile,
  widenReference,
} from './scaleWidening.js';

/** A chart with hand-checkable bands: 0 below 5, 2 through 19, 6 from 20 up. */
const chart = [
  { lo: 1, hi: 4, pts: 0, reb: 0, ast: 0 },
  { lo: 5, hi: 19, pts: 2, reb: 1, ast: 0 },
  { lo: 20, hi: 99, pts: 6, reb: 2, ast: 3 },
];

const card = (over = {}) => ({
  id: over.name ?? 'C',
  name: 'C',
  pos: 'SF',
  speed: 10,
  power: 10,
  defBoost: 0,
  shotLine: 15,
  paintBoost: 0,
  threePtBoost: 0,
  salary: 500,
  chart,
  ...over,
});

describe('the game shape the points estimate is built on', () => {
  // endSection advances section 1..3 then quarter 1..4, and CourtBoard rolls
  // one per starter per team per section.
  it('is 12 sections of 5 starters — 60 chart rolls per team per game', () => {
    expect(SECTIONS_PER_GAME).toBe(12);
    expect(STARTERS).toBe(5);
    expect(SCORING_ROLLS_PER_GAME).toBe(60);
  });

  it('clamps a roll to the engine\'s own 1..99 window', () => {
    expect(clampRoll(-40)).toBe(1);
    expect(clampRoll(0)).toBe(1);
    expect(clampRoll(7)).toBe(7);
    expect(clampRoll(400)).toBe(99);
  });
});

describe('expectedChartValue walks the chart rather than assuming linearity', () => {
  // At bonus 0 the d20 lands 1-4 (0 pts, 4 faces) and 5-20 (2 pts for 15 faces,
  // 6 pts for the single face 20): (15*2 + 6) / 20 = 1.8
  it('reproduces a hand-worked expectation at bonus 0', () => {
    expect(expectedChartValue(card(), 0)).toBeCloseTo((15 * 2 + 6) / 20, 10);
  });

  // A bonus of +19 puts every face at 20 or above, so every roll is the top tier.
  it('SATURATES once the bonus clears the top band — more buys nothing', () => {
    expect(expectedChartValue(card(), 19)).toBe(6);
    expect(expectedChartValue(card(), 40)).toBe(6);
    expect(expectedChartValue(card(), 400)).toBe(6);
  });

  // And it floors: with a big penalty every face clamps to 1, the 0-point band.
  it('FLOORS once the penalty buries every face in the bottom band', () => {
    expect(expectedChartValue(card(), -20)).toBe(0);
    expect(expectedChartValue(card(), -200)).toBe(0);
  });

  it('reads whichever stat it is asked for', () => {
    expect(expectedChartValue(card(), 19, 'reb')).toBe(2);
    expect(expectedChartValue(card(), 19, 'ast')).toBe(3);
    expect(chartExpectedValues(card())).toEqual({
      pts: expectedChartValue(card(), 0, 'pts'),
      reb: expectedChartValue(card(), 0, 'reb'),
      ast: expectedChartValue(card(), 0, 'ast'),
    });
  });
});

describe('the exchange rate between roll bonus and points', () => {
  // A chart that pays exactly the roll gives a slope of 1 pt per roll per bonus
  // point, which is SCORING_ROLLS_PER_GAME points a game.
  const linear = card({
    chart: Array.from({ length: 99 }, (_, i) => ({ lo: i + 1, hi: i + 1, pts: i + 1, reb: 0, ast: 0 })),
  });

  it('recovers the exact slope of a chart that is linear in the roll', () => {
    expect(bonusExchangeRate([linear], { at: 20, halfWidth: 4 })).toBeCloseTo(
      SCORING_ROLLS_PER_GAME,
      6
    );
  });

  it('reports zero once the chart has saturated', () => {
    expect(bonusExchangeRate([card()], { at: 40, halfWidth: 4 })).toBe(0);
  });

  it('describes the curve as points per roll and per game together', () => {
    const curve = bonusPointsCurve([card()], { from: -2, to: 2 });
    expect(curve.map(p => p.bonus)).toEqual([-2, -1, 0, 1, 2]);
    for (const p of curve) {
      expect(p.pointsPerGame).toBeCloseTo(p.ptsPerRoll * SCORING_ROLLS_PER_GAME, 10);
    }
  });
});

describe('mechanical identity', () => {
  it('collapses every negative Def Boost onto zero, as calcAdv does', () => {
    expect(mechanicalIdentity(card({ speed: 9, power: 8, defBoost: -3 }))).toBe(
      mechanicalIdentity(card({ speed: 9, power: 8, defBoost: 0 }))
    );
    expect(
      countIdentities([
        card({ speed: 9, power: 8, defBoost: -3 }),
        card({ speed: 9, power: 8, defBoost: 0 }),
        card({ speed: 9, power: 8, defBoost: 1 }),
      ])
    ).toBe(2);
  });

  it('separates cards that share a budget but not a split', () => {
    expect(countIdentities([card({ speed: 12, power: 6 }), card({ speed: 6, power: 12 })])).toBe(2);
  });
});

describe('widenReference', () => {
  const reference = { mean: 17.8, sd: 4, min: 10, max: 28, p90: 22, ceilingShare: 0.007 };

  it('leaves the reference untouched with no options', () => {
    expect(widenReference(reference)).toEqual(reference);
  });

  it('scales the spread AND the knee, so the taper keeps describing the same shape', () => {
    const w = widenReference(reference, { min: 6, max: 34, sdScale: 1.5 });
    expect(w.sd).toBeCloseTo(6, 10);
    expect(w.min).toBe(6);
    expect(w.max).toBe(34);
    // knee sits 4.2 above the mean at scale 1, so 6.3 above it at 1.5
    expect(w.p90).toBeCloseTo(17.8 + 4.2 * 1.5, 10);
    expect(w.mean).toBe(17.8);
    expect(w.ceilingShare).toBe(reference.ceilingShare);
  });

  it('shifts the mean and carries the knee with it', () => {
    const w = widenReference(reference, { meanShift: 2 });
    expect(w.mean).toBe(19.8);
    expect(w.p90).toBeCloseTo(19.8 + 4.2, 10);
  });
});

describe('respec re-prints a card at a new split', () => {
  const salaryModel = { coef: [0, 10, 0, 0, 0, 0, 0, 0, 0] };

  it('changes only speed, power and salary', () => {
    const before = card({ speed: 10, power: 8, salary: 180 });
    const after = respec(before, { speed: 14, power: 12 }, {
      salaryModel,
      chartEv: chartExpectedValues(before),
    });
    expect(after.speed).toBe(14);
    expect(after.power).toBe(12);
    // first salary feature is speed + power, coefficient 10, rounded to a ten
    expect(after.salary).toBe(260);
    const { speed: _s, power: _p, salary: _sal, ...restAfter } = after;
    const { speed: _s2, power: _p2, salary: _sal2, ...restBefore } = before;
    expect(restAfter).toEqual(restBefore);
  });

  it('does not mutate the card it was given', () => {
    const before = card({ speed: 10, power: 8 });
    respec(before, { speed: 1, power: 1 }, { salaryModel, chartEv: chartExpectedValues(before) });
    expect(before.speed).toBe(10);
    expect(before.power).toBe(8);
  });
});

describe('scoringProfile', () => {
  const set = [
    card({ name: 'A', id: 'A', speed: 12, power: 8 }),
    card({ name: 'B', id: 'B', speed: 10, power: 10 }),
    card({ name: 'C', id: 'C', speed: 8, power: 12 }),
  ];

  it('counts every ordered matchup once, self-matchups excluded', () => {
    expect(scoringProfile(set).matchups).toBe(3 * 2);
  });

  it('agrees with evaluateMatchup on the mean roll bonus', () => {
    let sum = 0;
    for (const a of set) for (const d of set) if (a !== d) sum += evaluateMatchup(a, d).rollBonus;
    expect(scoringProfile(set).meanRollBonus).toBeCloseTo(sum / 6, 12);
  });

  it('converts points per roll into a game total at the engine\'s roll count', () => {
    const p = scoringProfile(set);
    expect(p.pointsPerGame).toBeCloseTo(p.ptsPerRoll * SCORING_ROLLS_PER_GAME, 10);
  });

  // The claim the module header makes, and the mirror of the Net Edge identity:
  // with no Def Boost, adv(X,Y) + adv(Y,X) = |dX - dY| where d = speed - power,
  // so the mean roll bonus is a function of the SPLIT alone and the budget has
  // cancelled out entirely.
  it('mean roll bonus depends only on the SPLIT, never on the budget', () => {
    const flat = [
      card({ id: 'a', speed: 14, power: 6, defBoost: 0 }),
      card({ id: 'b', speed: 10, power: 10, defBoost: 0 }),
      card({ id: 'c', speed: 5, power: 15, defBoost: 0 }),
      card({ id: 'd', speed: 9, power: 3, defBoost: 0 }),
    ];
    let pairSum = 0;
    for (let i = 0; i < flat.length; i += 1) {
      for (let j = i + 1; j < flat.length; j += 1) {
        pairSum += Math.abs(
          flat[i].speed - flat[i].power - (flat[j].speed - flat[j].power)
        );
      }
    }
    const n = flat.length * (flat.length - 1);
    expect(scoringProfile(flat).meanRollBonus).toBeCloseTo(pairSum / n, 12);
  });

  it('and so adding the SAME amount to every budget changes nothing', () => {
    const flat = [
      card({ id: 'a', speed: 14, power: 6 }),
      card({ id: 'b', speed: 10, power: 10 }),
      card({ id: 'c', speed: 5, power: 15 }),
    ];
    // +4 speed and +4 power on every card: budgets all rise by 8, splits are
    // unchanged in DIFFERENCE, so the roll bonuses are identical.
    const lifted = flat.map(c => ({ ...c, speed: c.speed + 4, power: c.power + 4 }));
    expect(scoringProfile(lifted).meanRollBonus).toBeCloseTo(
      scoringProfile(flat).meanRollBonus,
      12
    );
  });
});

describe('budgetEdges', () => {
  it('is each card\'s budget minus the mean of the others', () => {
    const set = [card({ speed: 10, power: 10 }), card({ speed: 6, power: 6 })];
    expect(budgetEdges(set)).toEqual([20 - 12, 12 - 20]);
  });
});

describe('the sampled cap-legal draft', () => {
  const set = Array.from({ length: 40 }, (_, i) =>
    card({ id: `p${i}`, name: `p${i}`, speed: 5 + (i % 15), power: 5 + ((i * 7) % 15), salary: 100 + i * 30 })
  );

  it('is deterministic for a given seed', () => {
    const a = draftRoster(set, rng(1)).picks.map(c => c.id);
    const b = draftRoster(set, rng(1)).picks.map(c => c.id);
    expect(a).toEqual(b);
    expect(draftRoster(set, rng(2)).picks.map(c => c.id)).not.toEqual(a);
  });

  it('fills the roster without breaking the cap', () => {
    const { picks, spent } = draftRoster(set, rng(7), { cap: 5500, rosterSize: 10 });
    expect(picks).toHaveLength(10);
    expect(spent).toBeLessThanOrEqual(5500);
    expect(new Set(picks.map(c => c.id)).size).toBe(10);
  });

  it('never takes a card the other team already has', () => {
    const a = draftRoster(set, rng(3));
    const b = draftRoster(set, rng(4), { exclude: a.taken });
    const overlap = b.picks.filter(c => a.picks.some(x => x.id === c.id));
    expect(overlap).toEqual([]);
  });

  it('respects a cap too tight for expensive cards', () => {
    const { picks, spent } = draftRoster(set, rng(5), { cap: 1200, rosterSize: 10 });
    expect(spent).toBeLessThanOrEqual(1200);
    expect(picks.length).toBeLessThanOrEqual(10);
  });

  it('produces a reproducible game-scoring estimate', () => {
    const opts = { samples: 20, seed: 99 };
    const first = sampledGameScoring(set, opts);
    expect(sampledGameScoring(set, opts)).toEqual(first);
    expect(first.samples).toBeGreaterThan(0);
    expect(first.pointsPerGame).toBeGreaterThan(0);
  });
});

describe('rng', () => {
  it('is reproducible and stays inside [0, 1)', () => {
    const a = Array.from({ length: 50 }, rng(42));
    const b = Array.from({ length: 50 }, rng(42));
    expect(a).toEqual(b);
    for (const x of a) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
