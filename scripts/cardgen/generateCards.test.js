import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  buildCard,
  generateCards,
  expectedValuePerRoll,
  shootingInputFromRate,
  indexByName,
  summarize,
  histogram,
  STAT_NAME_ALIASES,
  OUTPUT_FILE,
} from './generateCards.js';
import { CALIBRATION_FILE } from './calibrateAttributes.js';
import { playerIdFromName } from '../../src/cards/playerId.js';
import { REPO_ROOT } from './cache.js';
import * as V from './variance.js';

const calibration = JSON.parse(readFileSync(CALIBRATION_FILE, 'utf8'));

const rate = (over = {}) => ({
  name: 'Test Player',
  pts100: 30,
  ast100: 6,
  orb100: 2,
  drb100: 8,
  tsPct: 0.58,
  usage: 0.25,
  fga2Per100: 14,
  fga3Per100: 8,
  ftaPer100: 5,
  fgPct2: 0.55,
  fgPct3: 0.37,
  ftPct: 0.8,
  epmDef: 1.4,
  ...over,
});

const player = (over = {}) => ({
  name: 'Test Player',
  team: 'SAS',
  pos: 'PG',
  mpg: 30,
  games: 70,
  ...over,
});

const poolCtx = players => {
  const inputs = players.map(p => shootingInputFromRate(p.rate, p.player.mpg));
  // Mirrors calibrateAttributes.poolContext without importing it, so a pool of
  // one still produces finite z-scores.
  const z = () => () => 0;
  return { z: { ts: z(), pts100: z(), usg: z(), mpg: z() }, meanFg3: 0.36, meanFg2: 0.54, inputs };
};

function card(over = {}, rateOver = {}) {
  const p = player(over);
  const r = rate(rateOver);
  return buildCard({
    player: p,
    rate: r,
    speedPowerTotal: over.speedPowerTotal ?? 20,
    calibration,
    pool: poolCtx([{ player: p, rate: r }]),
  });
}

describe('buildCard', () => {
  it('produces every field src/game/cards.js reads', () => {
    const c = card();
    for (const field of [
      'id',
      'name',
      'team',
      'pos',
      'speed',
      'power',
      'shotLine',
      'paintBoost',
      'threePtBoost',
      'defBoost',
      'salary',
      'chart',
    ]) {
      expect(c[field], field).not.toBe(undefined);
      expect(c[field], field).not.toBe(null);
    }
  });

  it('marks itself provisional, because every number on it is', () => {
    expect(card().provisional).toBe(true);
  });

  it('derives the id with the same rule that names the photo files', () => {
    expect(card({ name: 'Luka Dončić' }).id).toBe(playerIdFromName('Luka Dončić'));
  });

  it('conserves the Speed+Power budget exactly', () => {
    for (const total of [10, 17, 23, 28]) {
      const c = card({ speedPowerTotal: total });
      expect(c.speed + c.power).toBe(total);
    }
  });

  it('gives a point guard more Speed than the same budget gives a centre', () => {
    expect(card({ pos: 'PG', speedPowerTotal: 24 }).speed).toBeGreaterThan(
      card({ pos: 'C', speedPowerTotal: 24 }).speed
    );
  });

  // The hard floor from design doc section 3: a natural 1 is unconditionally
  // 0/0/0, for every card, no exceptions.
  it('puts a blank natural-1 tier under every card, however good the player', () => {
    for (const pts100 of [8, 20, 36]) {
      // lo AND hi are both 1: "a natural 1", not "the bottom band". This is
      // the tier the card does not print (see visibleTiers in CardTemplate).
      expect(card({}, { pts100 }).chart[0]).toMatchObject({
        lo: 1,
        hi: 1,
        pts: 0,
        reb: 0,
        ast: 0,
      });
    }
  });

  it('gives every card a SECOND, no-scoring tier above the blank one', () => {
    // The founding requirement: "at least a natural 1 result in 0pts, 0reb,
    // 0ast, and then a second tier where they don't score". Two tiers, and the
    // second one is different — it scores nothing but may still rebound and
    // assist, which is the only thing distinguishing it from the first.
    for (const pts100 of [8, 20, 36]) {
      const { chart } = card({}, { pts100 });
      expect(chart[1].lo).toBe(2);
      expect(chart[1].pts).toBe(0);
      // Deliberately NOT asserting that tier 2 scores. A weak enough scorer
      // legitimately rounds a third band to zero points as well, and the top
      // of the chart is left to the statistics — the floor guarantees a
      // minimum of two non-scoring tiers, not a maximum.
    }
  });

  it('keeps rebounds and assists on the no-scoring tier rather than blanking them', () => {
    // A rebounder who never shot on the possession is the case this exists
    // for. Zeroing reb/ast here would make tier 2 a copy of tier 1.
    const { chart } = card({}, { orb100: 8, drb100: 22, ast100: 14 });
    expect(chart[1].pts).toBe(0);
    expect(chart[1].reb).toBeGreaterThan(0);
    expect(chart[1].ast).toBeGreaterThan(0);
    // And that is what makes it a DIFFERENT row from the blank one below it.
    expect(chart[1]).not.toMatchObject({ reb: chart[0].reb, ast: chart[0].ast });
  });

  it('lays a contiguous roll range with an open top over at most six tiers', () => {
    // NOT exactly five any more. Adjacent tiers whose three printed numbers
    // are identical after rounding are merged (see shapeChart), so the count
    // varies with the player: two floor tiers plus up to four scoring ones.
    const { chart } = card();
    expect(chart.length).toBeGreaterThanOrEqual(2);
    expect(chart.length).toBeLessThanOrEqual(6);
    expect(chart[0].lo).toBe(1);
    for (let i = 1; i < chart.length; i += 1) {
      expect(chart[i].lo).toBe(chart[i - 1].hi + 1);
    }
    // 99 is rawCards.js's convention for "no ceiling" and what CardTemplate
    // renders as "20+".
    expect(chart[chart.length - 1].hi).toBe(99);
  });

  it('never lets a later tier score less than an earlier one', () => {
    const { chart } = card();
    for (let i = 1; i < chart.length; i += 1) {
      for (const stat of V.CHART_STATS) {
        expect(chart[i][stat]).toBeGreaterThanOrEqual(chart[i - 1][stat]);
      }
    }
  });

  it('puts the shot line on a row that exists, so the card can draw its arrow', () => {
    // CardTemplate.findShotLineIndex renders NO arrow when no tier contains the
    // shot line — a card silently missing a stat rather than showing a wrong one.
    const c = card();
    expect(c.chart.some(t => c.shotLine >= t.lo && c.shotLine <= t.hi)).toBe(true);
  });

  it('scales the chart with production', () => {
    const small = card({}, { pts100: 12 });
    const big = card({}, { pts100: 40 });
    expect(expectedValuePerRoll(big.chart, 'pts')).toBeGreaterThan(
      expectedValuePerRoll(small.chart, 'pts')
    );
  });

  it('follows DEF EPM straight into the Def Boost', () => {
    expect(card({}, { epmDef: 3.4 }).defBoost).toBe(3);
    expect(card({}, { epmDef: -1.6 }).defBoost).toBe(-2);
  });

  it('survives a player with no stat line at all', () => {
    const p = player();
    const c = buildCard({
      player: p,
      rate: null,
      speedPowerTotal: 12,
      calibration,
      pool: poolCtx([{ player: p, rate: {} }]),
    });
    expect(c.speed + c.power).toBe(12);
    // A player with nothing to say collapses to the fewest tiers the shape
    // allows — the blank natural 1 and one flat band — rather than five
    // identical rows. That IS the merge working, not a degenerate card.
    expect(c.chart.length).toBeGreaterThanOrEqual(2);
    expect(c.chart.length).toBeLessThanOrEqual(6);
    expect(c.chart[0]).toMatchObject({ lo: 1, hi: 1, pts: 0, reb: 0, ast: 0 });
    expect(c.chart[c.chart.length - 1].hi).toBe(99);
    expect(Number.isFinite(c.salary)).toBe(true);
  });

  it('prices a better card higher', () => {
    const star = card({ speedPowerTotal: 28 }, { pts100: 38, epmDef: 3 });
    const bench = card({ speedPowerTotal: 11 }, { pts100: 14, epmDef: -1 });
    expect(star.salary).toBeGreaterThan(bench.salary);
  });
});

describe('expectedValuePerRoll', () => {
  it('weights by d20 face, so the open top tier counts only its reachable rolls', () => {
    const chart = [
      { lo: 1, hi: 10, pts: 0 },
      { lo: 11, hi: 99, pts: 2 },
    ];
    expect(expectedValuePerRoll(chart, 'pts')).toBeCloseTo(1, 10);
  });
});

describe('indexByName and the alias list', () => {
  it('matches across diacritics and punctuation', () => {
    const index = indexByName([{ name: 'Luka Dončić' }, { name: 'A.J. Green' }]);
    expect(index.get('lukadoncic')).toBeDefined();
    expect(index.get('ajgreen')).toBeDefined();
  });

  it('keeps the row covering the most games when a name appears twice', () => {
    const index = indexByName([
      { name: 'Traded Guy', games: 20, team: 'BOS' },
      { name: 'Traded Guy', games: 62, team: '2TM' },
    ]);
    expect(index.get('tradedguy').games).toBe(62);
  });

  // A fuzzy matcher that is wrong hands a player someone else's stat line and
  // nothing downstream notices, so the exceptions are enumerated instead.
  it('spells out the one name the stat source disagrees about', () => {
    expect(STAT_NAME_ALIASES['Ron Holland']).toBe('Ronald Holland II');
  });
});

describe('generateCards', () => {
  const pool = [
    { name: 'Alpha Guard', team: '2TM', pos: 'PG', mpg: 30, games: 70 },
    { name: 'Beta Big', team: 'SAS', pos: 'C', mpg: 24, games: 60 },
  ];
  const teams = [{ name: 'Alpha Guard', team: 'BOS', pos: 'SG' }];
  const speedPower = [
    { name: 'Alpha Guard', speedPowerTotal: 22 },
    { name: 'Beta Big', speedPowerTotal: 15 },
  ];
  const rates = [rate({ name: 'Alpha Guard' }), rate({ name: 'Beta Big', pts100: 18 })];

  it('prefers the resolved team over the pool\'s trade aggregate code', () => {
    const { cards } = generateCards({ pool, teams, speedPower, rates, calibration });
    expect(cards[0].team).toBe('BOS');
    expect(cards[0].pos).toBe('SG');
    // Untouched where the resolver has nothing to say.
    expect(cards[1].team).toBe('SAS');
  });

  it('reports players it could find no stat line for instead of silently zeroing them', () => {
    const { missingRates } = generateCards({
      pool,
      teams,
      speedPower,
      rates: [rate({ name: 'Alpha Guard' })],
      calibration,
    });
    expect(missingRates).toEqual(['Beta Big']);
  });

  it('applies a sparse chart override on top of the generated chart', () => {
    const { cards } = generateCards({
      pool,
      teams,
      speedPower,
      rates,
      calibration,
      overrides: { Beta_Big: { chart: { 4: { pts: 9 } } } },
    });
    const beta = cards.find(c => c.id === 'Beta_Big');
    expect(beta.chart[4].pts).toBe(9);
    // Only the named field on the named tier moves.
    expect(beta.chart[3].pts).not.toBe(9);
  });
});

describe('summarize and histogram', () => {
  it('reports the spread of a field', () => {
    expect(summarize([5, 1, 3, 2, 4])).toMatchObject({ n: 5, min: 1, median: 3, max: 5, mean: 3 });
  });

  it('ignores non-finite values rather than producing NaN bounds', () => {
    expect(summarize([1, NaN, 3, undefined])).toMatchObject({ n: 2, min: 1, max: 3 });
  });

  // Pairs, not an object: an object would print the negative boosts after the
  // positive ones, because "-1" is not an integer index and JavaScript keeps
  // non-index keys in insertion order.
  it('counts values in ascending numeric order, negatives included', () => {
    expect(histogram([2, 0, -1, 2])).toEqual([
      [-1, 1],
      [0, 1],
      [2, 2],
    ]);
  });
});

// Guards the committed artefact itself, not just the code that writes it. A
// regenerate that silently drops players or breaks the join to the pool would
// otherwise only show up as blank cards in the studio.
describe('the committed cards-2026-27.json', () => {
  const exists = existsSync(OUTPUT_FILE);
  const file = exists ? JSON.parse(readFileSync(OUTPUT_FILE, 'utf8')) : null;
  const pool = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'card-data', 'generated', 'player-pool-2026.json'), 'utf8')
  );

  it.runIf(exists)('covers the whole pool, one card per player', () => {
    expect(file.cards).toHaveLength(pool.length);
    const ids = new Set(file.cards.map(c => c.id));
    expect(ids.size).toBe(file.cards.length);
    for (const p of pool) expect(ids.has(playerIdFromName(p.name))).toBe(true);
  });

  it.runIf(exists)('says provisional at the top and on every record', () => {
    expect(file.provisional).toBe(true);
    expect(file.cards.every(c => c.provisional === true)).toBe(true);
  });

  it.runIf(exists)('holds a complete, in-range stat line on every card', () => {
    for (const c of file.cards) {
      expect(c.speed + c.power, c.name).toBeGreaterThanOrEqual(2);
      expect(c.speed, c.name).toBeGreaterThanOrEqual(1);
      expect(c.power, c.name).toBeGreaterThanOrEqual(1);
      expect(c.shotLine, c.name).toBeGreaterThanOrEqual(12);
      expect(c.shotLine, c.name).toBeLessThanOrEqual(18);
      expect(c.salary, c.name).toBeGreaterThanOrEqual(10);
      // Between two and six: the blank natural-1 tier, the no-scoring tier,
      // and up to four scoring bands. Fixed at five before the merge landed.
      expect(c.chart.length, c.name).toBeGreaterThanOrEqual(2);
      expect(c.chart.length, c.name).toBeLessThanOrEqual(6);
      expect(c.chart[0], c.name).toMatchObject({ lo: 1, hi: 1, pts: 0, reb: 0, ast: 0 });
      expect(c.chart[1].lo, c.name).toBe(2);
      expect(c.chart[1].pts, c.name).toBe(0);
      expect(c.chart.at(-1).hi, c.name).toBe(99);
      // Contiguous: every roll from 1 to 20 resolves against exactly one tier.
      for (let i = 1; i < c.chart.length; i += 1) {
        expect(c.chart[i].lo, c.name).toBe(c.chart[i - 1].hi + 1);
      }
      // No two printed rows say the same three numbers — that is the merge.
      for (let i = 2; i < c.chart.length; i += 1) {
        const prev = c.chart[i - 1];
        const same =
          c.chart[i].pts === prev.pts && c.chart[i].reb === prev.reb && c.chart[i].ast === prev.ast;
        expect(same, `${c.name} tiers ${i - 1}/${i} print identically`).toBe(false);
      }
    }
  });
});
