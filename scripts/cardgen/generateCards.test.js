import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  buildCard,
  generateCards,
  expectedValuePerRoll,
  actualShootingInput,
  indexByName,
  summarize,
  histogram,
  STAT_NAME_ALIASES,
  OUTPUT_FILE,
} from './generateCards.js';
import * as S from './shooting.js';
import * as A from './attributes.js';
import * as PV from './playValue.js';

const BASE_SET = PV.BASE_SET_FILE;
import { CALIBRATION_FILE } from './calibrateAttributes.js';
import { playerIdFromName } from '../../src/cards/playerId.js';
import { REPO_ROOT } from './cache.js';
import * as V from './variance.js';
import { MAX_CHART_TIERS, MAX_PRINTED_ROWS } from './generate.js';

const calibration = JSON.parse(readFileSync(CALIBRATION_FILE, 'utf8'));

/** A PREDICTED per-100 row — all the chart reads. */
const rate = (over = {}) => ({
  name: 'Test Player',
  pts100: 30,
  ast100: 6,
  orb100: 2,
  drb100: 8,
  ...over,
});

/** An ACTUAL season row — everything else reads this. */
const actual = (over = {}) => ({
  name: 'Test Player',
  games: 70,
  minutes: 2100,
  tsPct: 0.58,
  fgPctRim: 0.66,
  fgPct3: 0.37,
  fgaRimPer75: 4,
  fga3Per75: 6,
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

/**
 * The shooting layer over a one-player pool.
 *
 * The rule is pool-relative, so a single player is always exactly average and
 * every boost comes out 0. That is the correct answer for a pool of one, and it
 * keeps these tests about the parts buildCard still decides.
 */
const shootingFor = rows =>
  S.buildShootingLayer(rows.map(actualShootingInput), {
    shotLineTarget: calibration.shotLine.target,
    paint: calibration.paintBoost,
    three: calibration.threePtBoost,
  });

function card(over = {}, rateOver = {}, actualOver = {}) {
  const p = player(over);
  const r = rate(rateOver);
  const a = actual(actualOver);
  return buildCard({
    player: p,
    rate: r,
    actual: a,
    shooting: shootingFor([a]).players[0],
    speedPowerTotal: over.speedPowerTotal ?? 20,
    calibration,
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
      'chart',
    ]) {
      expect(c[field], field).not.toBe(undefined);
      expect(c[field], field).not.toBe(null);
    }
    // Salary is the ONE field buildCard deliberately leaves unset. Play value is
    // measured against a field, so it cannot exist until every card does;
    // generateCards fills it in as a post-pass. Null rather than a placeholder
    // so a card that escapes that pass is obviously broken, not quietly cheap.
    expect(c.salary).toBeNull();
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

  // The hard floor from design doc section 3, widened to rolls 1-2 so the card
  // and engine.js agree about which rolls are the bad ones: engine.js already
  // marks a player cold on a die of 1 or 2.
  it('blanks rolls 1 and 2 on every card, however good the player', () => {
    for (const pts100 of [8, 20, 36]) {
      const bottom = card({}, { pts100 }).chart[0];
      expect(bottom).toMatchObject({ lo: 1, pts: 0, reb: 0, ast: 0 });
      // hi is at LEAST 2. It can be more: where the no-scoring tier above also
      // reads 0/0/0 the merge folds the two into one row, which is the merge
      // working rather than a missing tier.
      expect(bottom.hi).toBeGreaterThanOrEqual(2);
    }
  });

  it('gives EVERY card a second, no-scoring tier, whatever its bottom decile pays', () => {
    // The founding requirement: "at least a natural 1 result in 0pts, 0reb,
    // 0ast, and then a second tier where they don't score". Tier 1 is the blank
    // floor and is not printed; tier 2 is the card's bottom PRINTED row, and it
    // always starts at roll 3 — the merge is never allowed to swallow it.
    for (const rateOver of [{}, { pts100: 8 }, { orb100: 8, drb100: 22, ast100: 14 }]) {
      const { chart } = card({}, rateOver);
      expect(chart[0]).toMatchObject({ lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 });
      expect(chart[1].lo).toBe(3);
      expect(chart[1].pts).toBe(0);
    }
  });

  it('never leaves two PRINTED rows saying the same three numbers, except across the shot line', () => {
    // The merge, and its one exception. A chart that breaks at the shot line
    // can legitimately show the same outcome either side of the break — that
    // is the price of giving the arrow a rule, and it is paid deliberately.
    // Tier 0 is excluded: the blank floor is not printed, and it deliberately
    // reads the same as an all-zero no-scoring row above it.
    const c = card();
    for (let i = 2; i < c.chart.length; i += 1) {
      const prev = c.chart[i - 1];
      const t = c.chart[i];
      const identical = t.pts === prev.pts && t.reb === prev.reb && t.ast === prev.ast;
      if (identical) expect(t.lo, `rows ${i - 1}/${i}`).toBe(c.shotLine);
    }
  });

  it('breaks the chart exactly at the shot line, so the arrow has a rule to sit on', () => {
    // The card communicates Shot Line with one arrow and nothing else, and that
    // arrow sits ON the hairline between the last miss and the first make. The
    // hairline only exists if a band starts at the shot line — so the generator
    // makes one, rather than hoping the percentiles landed there.
    for (const pts100 of [8, 20, 36]) {
      const c = card({}, { pts100 });
      const at = c.chart.findIndex(t => t.lo === c.shotLine);
      expect(at, `shot line ${c.shotLine} in ${JSON.stringify(c.chart.map(t => t.lo))}`)
        .toBeGreaterThan(0); // > 0: a rule between two rows, not the top frame
    }
  });

  it('lays a contiguous roll range with an open top, within the rows the card can print', () => {
    // NOT exactly five any more. Adjacent tiers whose three printed numbers are
    // identical after rounding are merged (see shapeChart) — except across the
    // shot line, which has to stay a break. Every tier is printed, so the table
    // height caps the count outright.
    const { chart } = card();
    expect(chart.length).toBeGreaterThanOrEqual(2);
    expect(chart.length).toBeLessThanOrEqual(MAX_CHART_TIERS);
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
    // CardTemplate.findShotLineBoundary renders NO arrow when no tier holds the
    // last miss — a card silently missing a stat rather than showing a wrong one.
    const c = card();
    expect(c.chart.some(t => c.shotLine >= t.lo && c.shotLine <= t.hi)).toBe(true);
    expect(c.chart.some(t => c.shotLine - 1 >= t.lo && c.shotLine - 1 <= t.hi)).toBe(true);
  });

  it('scales the chart with production', () => {
    const small = card({}, { pts100: 12 });
    const big = card({}, { pts100: 40 });
    expect(expectedValuePerRoll(big.chart, 'pts')).toBeGreaterThan(
      expectedValuePerRoll(small.chart, 'pts')
    );
  });

  it('follows the ACTUAL DEF EPM straight into the Def Boost', () => {
    expect(card({}, {}, { epmDef: 3.4 }).defBoost).toBe(3);
    expect(card({}, {}, { epmDef: -1.6 }).defBoost).toBe(-2);
  });

  it('survives a player with no stat line at all', () => {
    const p = player();
    const c = buildCard({
      player: p,
      rate: null,
      actual: null,
      shooting: shootingFor([null]).players[0],
      speedPowerTotal: 12,
      calibration,
    });
    expect(c.speed + c.power).toBe(12);
    // A player with nothing to say collapses to the fewest tiers the shape
    // allows — the blank natural 1 and one flat band — rather than five
    // identical rows. That IS the merge working, not a degenerate card.
    expect(c.chart.length).toBeGreaterThanOrEqual(2);
    expect(c.chart.length).toBeLessThanOrEqual(MAX_CHART_TIERS);
    expect(c.chart[0]).toMatchObject({ lo: 1, pts: 0, reb: 0, ast: 0 });
    expect(c.chart[0].hi).toBeGreaterThanOrEqual(2); // rolls 1-2 at minimum
    expect(c.chart[c.chart.length - 1].hi).toBe(99);
    expect(c.salary).toBeNull(); // priced by the post-pass, not here
  });

  it('prices a better card higher, once the post-pass has run', () => {
    const star = card({ speedPowerTotal: 28 }, { pts100: 38 }, { epmDef: 3 });
    const bench = card({ speedPowerTotal: 11 }, { pts100: 14 }, { epmDef: -1 });
    // Both come back null from buildCard; the ordering is the PRICER's job now.
    expect(star.salary).toBeNull();
    expect(bench.salary).toBeNull();

    // Priced against the real set, because play value is measured against a
    // FIELD and a two-card field is degenerate -- each card would face exactly
    // one opponent, and the pair can come out identical.
    const field = JSON.parse(readFileSync(BASE_SET, 'utf8')).cards;
    const salaries = PV.priceSet([star, bench], {
      field,
      basis: PV.computePlayValue(field, { field }).value,
      roundSalary: A.roundSalary,
      min: A.SALARY_MIN,
      max: A.SALARY_MAX,
    });
    expect(salaries[0]).toBeGreaterThan(salaries[1]);
  });

  it('sees chart SHAPE, not just the chart average', () => {
    // The whole reason the price changed. These two have IDENTICAL expected
    // points on a bare d20 -- 2.0 each -- and the old linear fit, which read
    // only that average, therefore priced them the same. They are nothing alike
    // at the table, and the play-derived price says so.
    //
    // Note which way it goes is NOT asserted, deliberately. A cliff at 17 gains
    // more from a positive roll bonus than a flat chart that is already
    // saturated, so the volatile card can be worth MORE once matchups are
    // played out. What matters is that the price can tell them apart at all.
    const base = card({ speedPowerTotal: 20 }, { pts100: 24 }, {});
    const flat = {
      ...base, id: 'flat', name: 'Flat',
      chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
    };
    const cliff = {
      ...base, id: 'cliff', name: 'Cliff',
      chart: [
        { lo: 1, hi: 16, pts: 0, reb: 0, ast: 0 },
        { lo: 17, hi: 99, pts: 10, reb: 5, ast: 5 },
      ],
    };
    expect(expectedValuePerRoll(flat.chart, 'pts')).toBeCloseTo(2, 10);
    expect(expectedValuePerRoll(cliff.chart, 'pts')).toBeCloseTo(2, 10);

    const field = JSON.parse(readFileSync(BASE_SET, 'utf8')).cards;
    const [a, b] = PV.priceSet([flat, cliff], {
      field,
      basis: PV.computePlayValue(field, { field }).value,
      roundSalary: A.roundSalary,
      min: A.SALARY_MIN,
      max: A.SALARY_MAX,
    });
    expect(Math.abs(a - b)).toBeGreaterThan(100);
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
  const actuals = [
    actual({ name: 'Alpha Guard' }),
    actual({ name: 'Beta Big', tsPct: 0.62, fgPctRim: 0.72, fgPct3: 0.24 }),
  ];

  it('prefers the resolved team over the pool\'s trade aggregate code', () => {
    const { cards } = generateCards({ pool, teams, speedPower, rates, actual: actuals, calibration });
    expect(cards[0].team).toBe('BOS');
    expect(cards[0].pos).toBe('SG');
    // Untouched where the resolver has nothing to say.
    expect(cards[1].team).toBe('SAS');
  });

  it('reports players it could find no stat line for instead of silently zeroing them', () => {
    const { missingRates, missingActual } = generateCards({
      pool,
      teams,
      speedPower,
      rates: [rate({ name: 'Alpha Guard' })],
      actual: [actual({ name: 'Alpha Guard' })],
      calibration,
    });
    expect(missingRates).toEqual(['Beta Big']);
    expect(missingActual).toEqual(['Beta Big']);
  });

  // The rule is pool-relative, so a card cannot be built one player at a time:
  // the compression scale and each boost's centre are measured across everyone.
  it('reads the shooting layer off the whole pool, not one player at a time', () => {
    const { cards } = generateCards({ pool, teams, speedPower, rates, actual: actuals, calibration });
    // Beta Big is the better FINISHER and much the worse SHOOTER, and since
    // 2026-09-03 those land on different attributes: Shot Line reads jump
    // shooting only, so his rim work can no longer buy him a better line, and
    // Paint Boost reads rim points added, so it is where his finishing pays.
    // This test previously asserted the opposite — that the better finisher
    // took the better Shot Line — which was the TS%-basis bug itself (a .671
    // Jarrett Allen out-shooting Curry on paper). See shooting.js's header.
    const [alpha, beta] = cards;
    expect(beta.shotLine).toBeGreaterThan(alpha.shotLine);
    expect(beta.paintBoost).toBeGreaterThanOrEqual(alpha.paintBoost);
    expect(beta.threePtBoost).toBeLessThan(alpha.threePtBoost);
  });

  it('applies a sparse chart override on top of the generated chart', () => {
    const { cards } = generateCards({
      pool,
      teams,
      speedPower,
      rates,
      actual: actuals,
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

  it.runIf(exists)('marks provisional honestly: only synthetic-chart cards', () => {
    // Since the real-log rebuild, `provisional` on a card means exactly one
    // thing: its chart came from the synthesized distribution instead of the
    // player's own last-82 game log. The bulk of the set is real; the flag
    // survives for whoever the fetch could not serve (and the four
    // carried-forward players, whose seasons do not exist to fetch).
    expect(typeof file.provisional).toBe('boolean');
    const synthetic = file.cards.filter(c => c.provisional === true);
    const real = file.cards.filter(c => c.provisional === false);
    expect(real.length).toBeGreaterThan(synthetic.length);
    expect(synthetic.length + real.length).toBe(file.cards.length);
  });

  it.runIf(exists)('holds a complete, in-range stat line on every card', () => {
    for (const c of file.cards) {
      expect(c.speed + c.power, c.name).toBeGreaterThanOrEqual(2);
      expect(c.speed, c.name).toBeGreaterThanOrEqual(1);
      expect(c.power, c.name).toBeGreaterThanOrEqual(1);
      expect(c.shotLine, c.name).toBeGreaterThanOrEqual(12);
      expect(c.shotLine, c.name).toBeLessThanOrEqual(18);
      expect(c.salary, c.name).toBeGreaterThanOrEqual(10);
      // The blank tier is not printed, so the table's five-row height caps the
      // tier count at six.
      expect(c.chart.length, c.name).toBeGreaterThanOrEqual(2);
      expect(c.chart.length, c.name).toBeLessThanOrEqual(MAX_CHART_TIERS);
      expect(c.chart.length - 1, c.name).toBeLessThanOrEqual(MAX_PRINTED_ROWS);
      // Rolls 1 AND 2 produce nothing, on every card — the same two rolls
      // engine.js hands out a cold marker for — and that tier is never merged
      // away, so every card keeps a no-scoring row starting at roll 3.
      expect(c.chart[0], c.name).toEqual({ lo: 1, hi: 2, pts: 0, reb: 0, ast: 0 });
      expect(c.chart[1].lo, c.name).toBe(3);
      expect(c.chart[1].pts, c.name).toBe(0);
      expect(c.chart.at(-1).hi, c.name).toBe(99);
      // The chart breaks exactly at the shot line, between two PRINTED rows, so
      // the arrow has a real dividing rule to sit on. Index > 1: a break at
      // tier 1 is the top of the printed table, which is frame, not a rule.
      expect(c.chart.findIndex(t => t.lo === c.shotLine), c.name).toBeGreaterThan(1);
      // Contiguous: every roll from 1 to 20 resolves against exactly one tier.
      for (let i = 1; i < c.chart.length; i += 1) {
        expect(c.chart[i].lo, c.name).toBe(c.chart[i - 1].hi + 1);
      }
      // No two PRINTED rows say the same three numbers — that is the merge —
      // unless they sit either side of the shot line, which may not close up.
      for (let i = 2; i < c.chart.length; i += 1) {
        const prev = c.chart[i - 1];
        const same =
          c.chart[i].pts === prev.pts && c.chart[i].reb === prev.reb && c.chart[i].ast === prev.ast;
        if (same) {
          expect(c.chart[i].lo, `${c.name} tiers ${i - 1}/${i} print identically`).toBe(c.shotLine);
        }
      }
    }
  });
});
