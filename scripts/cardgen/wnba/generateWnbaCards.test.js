import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  COMPOSITE_METRIC_SETS,
  COMPOSITE_WEIGHTS,
  REPLACEMENT_BPM,
  composite,
  compositeBasis,
  expectedValuePerRoll,
  speedPowerTotals,
  vorpPerGame,
  wnbaShootingInput,
} from './generateWnbaCards.js';
import { REFERENCE_TOTALS, REFINEMENT_WEIGHT } from '../speedPower.js';
import { WNBA_GAME_MINUTES } from './constants.js';
import { getWnbaTeam } from '../../../src/cards/teams.js';

const load = name =>
  JSON.parse(readFileSync(new URL(`../../../card-data/generated/${name}`, import.meta.url), 'utf8'));
const SET = load('cards-wnba.json');
const POOL = load('wnba-pool-2026.json');
const CARDS = SET.cards;

describe('vorpPerGame', () => {
  it('is value above replacement times the share of the game she is on the floor', () => {
    // 40 games at 30 minutes of a 40-minute game is 0.75 of every game.
    expect(vorpPerGame(4, { minutes: 1200, games: 40 }, WNBA_GAME_MINUTES)).toBeCloseTo(
      (4 - REPLACEMENT_BPM) * 0.75,
      9
    );
  });

  it('is zero at replacement level, which is what makes it fall out of BPM', () => {
    expect(vorpPerGame(REPLACEMENT_BPM, { minutes: 1200, games: 40 }, 40)).toBe(0);
    expect(REPLACEMENT_BPM).toBe(-2.0);
  });

  it('separates two players with the same rate and different playing time', () => {
    // The whole reason the composite carries a volume term: a rate alone rates
    // an efficient reserve alongside a starter.
    const starter = vorpPerGame(3, { minutes: 1200, games: 40 }, 40);
    const reserve = vorpPerGame(3, { minutes: 640, games: 40 }, 40);
    expect(starter).toBeGreaterThan(reserve);
  });

  it('is league-length agnostic — the same role scores the same in either league', () => {
    const wnba = vorpPerGame(3, { minutes: 1200, games: 40 }, 40); // 30 of 40
    const nba = vorpPerGame(3, { minutes: 2952, games: 82 }, 48); // 36 of 48
    expect(wnba).toBeCloseTo(nba, 9);
  });

  it('has no answer without minutes or games, rather than dividing by zero', () => {
    expect(vorpPerGame(3, { minutes: 0, games: 40 }, 40)).toBeNull();
    expect(vorpPerGame(3, { minutes: 100, games: 0 }, 40)).toBeNull();
    expect(vorpPerGame(null, { minutes: 100, games: 40 }, 40)).toBeNull();
  });
});

describe('the composite', () => {
  const rows = [
    { bpmHat: -2, vorpPerGameHat: 0 },
    { bpmHat: 2, vorpPerGameHat: 2 },
  ];

  it('is the BASE set\'s shape — the rate plus a 0.35 volume refinement', () => {
    expect(COMPOSITE_WEIGHTS).toEqual({ bpm: 1, vorpPerGame: REFINEMENT_WEIGHT });
    expect(REFINEMENT_WEIGHT).toBe(0.35);
  });

  it('z-scores against the basis it is handed, not against itself', () => {
    const basis = compositeBasis(rows);
    expect(composite(rows[0], basis)).toBeCloseTo(-1 - 0.35, 9);
    expect(composite(rows[1], basis)).toBeCloseTo(1 + 0.35, 9);
  });

  it('offers bpmOnly as the declared alternative, so the weight is reviewable', () => {
    expect(COMPOSITE_METRIC_SETS.bpmOnly).toEqual({ bpm: 1 });
  });
});

describe('speedPowerTotals', () => {
  it('fits the map to the FIRST population and applies it to both', () => {
    // The historical sets' structure, for the same reason: fit the map to the
    // population being mapped and every card in it is recentred onto the
    // reference mean, which would say nothing about how a WNBA card compares
    // with an NBA one.
    const nba = Array.from({ length: 50 }, (_, i) => ({
      bpmHat: -4 + i * 0.2,
      vorpPerGameHat: i * 0.05,
    }));
    // A WNBA half that is uniformly excellent must NOT come back centred.
    const wnba = Array.from({ length: 10 }, () => ({ bpmHat: 6, vorpPerGameHat: 1.5 }));
    const { totals } = speedPowerTotals([...nba, ...wnba], nba.length);
    const wnbaTotals = totals.slice(nba.length);
    expect(Math.min(...wnbaTotals)).toBeGreaterThan(REFERENCE_TOTALS.mean);
  });

  it('holds every total inside the finished set\'s printed range', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      bpmHat: -20 + i,
      vorpPerGameHat: i * 0.5,
    }));
    const { totals } = speedPowerTotals(rows, rows.length);
    for (const t of totals) {
      expect(t).toBeGreaterThanOrEqual(REFERENCE_TOTALS.min);
      expect(t).toBeLessThanOrEqual(REFERENCE_TOTALS.max);
    }
  });
});

describe('wnbaShootingInput', () => {
  it('uses REAL attempt totals, where both NBA paths reconstruct them from a pace', () => {
    const input = wnbaShootingInput({
      tsPct: 0.55,
      fgPct2: 0.5,
      fgPct3: 0.35,
      fg2aTotal: 300,
      fg3aTotal: 120,
    });
    expect(input).toEqual({
      tsPct: 0.55,
      paintPct: 0.5,
      threePct: 0.35,
      paintAttempts: 300,
      threeAttempts: 120,
    });
  });

  it('sends 2P% in as the paint signal, since no WNBA table has a rim split', () => {
    expect(wnbaShootingInput({ fgPct2: 0.61 }).paintPct).toBe(0.61);
  });
});

describe('expectedValuePerRoll', () => {
  it('walks a d20 and ignores anything above 20', () => {
    const chart = [
      { lo: 1, hi: 10, pts: 0 },
      { lo: 11, hi: 20, pts: 2 },
      { lo: 21, hi: 99, pts: 10 },
    ];
    expect(expectedValuePerRoll(chart, 'pts')).toBeCloseTo(1, 9);
  });
});

describe('the generated WNBA set', () => {
  it('holds the 101 who pass the bar plus the seven who were named', () => {
    expect(CARDS).toHaveLength(108);
    expect(SET.byRule).toBe(101);
    expect(SET.forced).toHaveLength(7);
    expect(POOL).toHaveLength(108);
  });

  it('gives every card the full stat line', () => {
    for (const c of CARDS) {
      expect(c.id, c.name).toBeTruthy();
      expect(c.speed + c.power, c.name).toBeGreaterThanOrEqual(REFERENCE_TOTALS.min);
      expect(c.speed + c.power, c.name).toBeLessThanOrEqual(REFERENCE_TOTALS.max);
      expect(c.speed, c.name).toBeGreaterThanOrEqual(1);
      expect(c.power, c.name).toBeGreaterThanOrEqual(1);
      expect(c.shotLine, c.name).toBeGreaterThanOrEqual(1);
      expect(c.shotLine, c.name).toBeLessThanOrEqual(21);
      expect(c.salary, c.name).toBeGreaterThan(0);
      expect(c.chart.length, c.name).toBeGreaterThan(1);
      expect(Number.isFinite(c.defBoost), c.name).toBe(true);
    }
  });

  it('leaves every chart a printable rule for the shot-line arrow', () => {
    // Below index 1 the "boundary" is the table's top frame, which carries no
    // rule for the arrow to sit on. See the known Jay Huff case on the NBA side.
    for (const c of CARDS) {
      expect(c.chart.findIndex(t => t.lo === c.shotLine), c.name).toBeGreaterThan(1);
    }
  });

  it('gives every card a real WNBA franchise', () => {
    for (const c of CARDS) expect(getWnbaTeam(c.team), `${c.name} ${c.team}`).toBeTruthy();
  });

  it('has no duplicate ids inside the set', () => {
    expect(new Set(CARDS.map(c => c.id)).size).toBe(CARDS.length);
  });

  it('blends exactly the seven named players and nobody else', () => {
    const blended = CARDS.filter(c => c.blended);
    expect(blended.map(c => c.name).sort()).toEqual(SET.forced.slice().sort());
    for (const c of blended) {
      expect(c.seasonsPooled).toEqual([2025, 2026]);
      expect(c.seasonLabel).toBe('2025+2026');
      // Every one of them ends up with MORE season behind her than her 2026
      // sample, which is the entire point of blending.
      expect(c.games).toBeGreaterThan(20);
    }
    for (const c of CARDS.filter(c => !c.blended)) {
      expect(c.seasonLabel).toBe('2026');
    }
  });

  it('records the 40-minute derivation in the file, not only in a comment', () => {
    expect(SET.sources.chart).toMatch(/40-minute WNBA game/);
    // The measured pace and the section size it implies, both on the record.
    expect(SET.sources.chart).toMatch(/79\.\d+ possessions per 40 minutes/);
    expect(SET.sources.chart).toMatch(/7\.9\d\d possessions/);
    // And what it is being compared with.
    expect(SET.sources.chart).toMatch(/8\.333/);
  });

  it('says the chart is anchored on TOTALS, with no pace in the path', () => {
    // The distinction that matters: the pace figure is reported because it is
    // the answer to "how big is a WNBA four-minute section", but it is NOT how
    // the charts were built — going through a per-100 rate would have carried
    // each player's own team pace as a ±6% error.
    expect(SET.sources.chart).toMatch(/TOTALS/);
    expect(SET.sources.chart).toMatch(/4 \* total \/ minutes/);
  });

  it('says on the record that the BPM is fitted and lists what is missing', () => {
    expect(SET.sources.bpm).toMatch(/FITTED/);
    expect(SET.sources.missing).toEqual(
      expect.arrayContaining(['BPM', 'OBPM', 'DBPM', 'VORP', 'rim FG%'])
    );
    expect(SET.provisional).toBe(true);
    for (const c of CARDS) expect(c.provisional).toBe(true);
  });

  it('says the cross-league comparison is league-relative rather than absolute', () => {
    // The one claim this pipeline must not be read as making.
    expect(SET.note).toMatch(/league-relative/);
    expect(SET.note).toMatch(/not a claim that the leagues are equally strong/);
  });

  it('sits on the same scale as the base set rather than on one of its own', () => {
    // The Speed+Power map is calibrated on the NBA pool, so the WNBA set has to
    // reach the same floor and ceiling and sit at a comparable centre — not
    // cluster in the middle and not fill the top.
    const totals = CARDS.map(c => c.speed + c.power).sort((a, b) => a - b);
    expect(totals[0]).toBe(REFERENCE_TOTALS.min);
    expect(totals[totals.length - 1]).toBe(REFERENCE_TOTALS.max);
    const median = totals[Math.floor(totals.length / 2)];
    expect(median).toBeGreaterThan(REFERENCE_TOTALS.mean - 3);
    expect(median).toBeLessThan(REFERENCE_TOTALS.mean + 3);
  });

  it('produces Shot Lines in the finished set\'s own range', () => {
    // The shooting layer is compressed against the WNBA pool so that a
    // league-wide shooting offset cancels; the target it is compressed ONTO is
    // the finished set's, so the two sets are playable against each other.
    const lines = CARDS.map(c => c.shotLine).sort((a, b) => a - b);
    expect(lines[0]).toBeGreaterThanOrEqual(10);
    expect(lines[lines.length - 1]).toBeLessThanOrEqual(18);
  });
});
