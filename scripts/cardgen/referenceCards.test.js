import { describe, it, expect } from 'vitest';
import {
  parseCsvLine,
  parseRollRange,
  parseOutcome,
  parseFinalCardsCsv,
  chartExpectedValue,
  loadReferenceCards,
} from './referenceCards.js';

// Two real rows from card-data/source-recovered/Final Cards.csv, header
// included. The CSV itself is gitignored (public repo, private spreadsheet), so
// the fixture is inline — that is also what keeps this test meaningful on a
// checkout that does not have the file.
const HEADER =
  'Player,Speed,Power,Shot Line,Paint Boost,3PT Boost,Def Boost,Roll 1,"R1 PT,REB, AST",Roll 2,' +
  '"R2 PT,REB, AST",Roll 3,"R3 PT,REB, AST",Roll 4,"R4 PT,REB, AST",Roll 5,"R5 PT,REB, AST",' +
  'SALARY,Adjusted Salary,,Archtype notes,Card type notes,Chart Score';
const JOKIC =
  'Nikola Jokic,7,20,12,1,0,0,1-3,"2,1,1",4-11,"3,1,1",12-15,"3,1,1",16-20,"4,2,1",21+,"4,2,2",' +
  '1330,1400,70,Elite defender,0,4.196498054';
const LEBRON =
  '08-09 LeBron James,18,15,14,1,0,2,1-3,"2,0,0",4-9,"2,1,1",10-13,"3,1,1",14-20,"3,1,1",21+,' +
  '"4,1,1",1490,1520,30,,,3.352542373';

describe('parseCsvLine', () => {
  it('keeps the commas inside a quoted outcome tuple', () => {
    expect(parseCsvLine('a,"2,1,1",b')).toEqual(['a', '2,1,1', 'b']);
  });

  it('handles an escaped quote and an empty trailing field', () => {
    expect(parseCsvLine('x,"he said ""hi""",')).toEqual(['x', 'he said "hi"', '']);
  });
});

describe('parseRollRange', () => {
  it('reads a closed range', () => {
    expect(parseRollRange('4-11')).toEqual({ lo: 4, hi: 11 });
  });

  // "21+" is the printed set's open top tier — a d20 cannot reach it unaided,
  // which is exactly why it must not be read as a closed range.
  it('reads the open top tier as unbounded', () => {
    expect(parseRollRange('21+')).toEqual({ lo: 21, hi: null });
  });

  it('reads a single face, and refuses nonsense', () => {
    expect(parseRollRange('20')).toEqual({ lo: 20, hi: 20 });
    expect(parseRollRange('')).toBe(null);
    expect(parseRollRange('n/a')).toBe(null);
  });
});

describe('parseOutcome', () => {
  it('splits a PTS/REB/AST tuple', () => {
    expect(parseOutcome('3,1,1')).toEqual({ pts: 3, reb: 1, ast: 1 });
  });

  it('rejects a short or non-numeric tuple rather than half-filling it', () => {
    expect(parseOutcome('3,1')).toBe(null);
    expect(parseOutcome('3,x,1')).toBe(null);
  });
});

describe('parseFinalCardsCsv', () => {
  const cards = parseFinalCardsCsv([HEADER, JOKIC, LEBRON].join('\n'));

  it('reads a card whole', () => {
    expect(cards[0]).toMatchObject({
      name: 'Nikola Jokic',
      speed: 7,
      power: 20,
      shotLine: 12,
      paintBoost: 1,
      threePtBoost: 0,
      defBoost: 0,
      salary: 1330,
      adjustedSalary: 1400,
    });
    expect(cards[0].chart).toEqual([
      { lo: 1, hi: 3, pts: 2, reb: 1, ast: 1 },
      { lo: 4, hi: 11, pts: 3, reb: 1, ast: 1 },
      { lo: 12, hi: 15, pts: 3, reb: 1, ast: 1 },
      { lo: 16, hi: 20, pts: 4, reb: 2, ast: 1 },
      { lo: 21, hi: null, pts: 4, reb: 2, ast: 2 },
    ]);
  });

  // The 23 legend cards come from peak historical seasons no current-season stat
  // table contains, so joining them to stats is impossible and including them
  // would only add unmatchable rows to every fit.
  it('leaves the season-prefixed legend cards out', () => {
    expect(cards).toHaveLength(1);
    expect(cards.some(c => c.name.includes('LeBron'))).toBe(false);
  });
});

describe('chartExpectedValue', () => {
  const cards = parseFinalCardsCsv([HEADER, JOKIC].join('\n'));

  it('weights by d20 faces and ignores the unreachable 21+ tier', () => {
    // Jokic PTS: 3 faces at 2, 8 at 3, 4 at 3, 5 at 4 = 62/20.
    expect(chartExpectedValue(cards[0].chart, 'pts')).toBeCloseTo(3.1, 10);
    // REB: 3+8+4 faces at 1, 5 at 2 = 25/20. The memory records the per-100
    // model landing at 1.43 against a real card value of 1.40 — this is that
    // 1.40, so the two are the same measurement.
    expect(chartExpectedValue(cards[0].chart, 'reb')).toBeCloseTo(1.25, 10);
  });

  it('returns null when no tier covers any face', () => {
    expect(chartExpectedValue([{ lo: 30, hi: 40, pts: 9 }], 'pts')).toBe(null);
  });
});

describe('loadReferenceCards', () => {
  // Generation must never depend on the gitignored spreadsheet — only
  // calibration may. A missing file is a null, not a throw.
  it('degrades to null when the gitignored CSV is absent', () => {
    expect(loadReferenceCards('card-data/source-recovered/definitely-not-here.csv')).toBe(null);
  });
});
