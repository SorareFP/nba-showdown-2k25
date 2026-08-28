import { describe, it, expect } from 'vitest';
import { enforceZeroFloor } from './zeroFloor.js';

describe('enforceZeroFloor', () => {
  it('forces the first tier to 0/0/0 regardless of input', () => {
    const chart = [
      { lo: 1, hi: 3, pts: 2, reb: 1, ast: 0 },
      { lo: 4, hi: 11, pts: 3, reb: 1, ast: 1 },
    ];
    const result = enforceZeroFloor(chart);
    expect(result[0]).toMatchObject({ pts: 0, reb: 0, ast: 0 });
  });

  it('leaves roll ranges (lo/hi) untouched', () => {
    const chart = [
      { lo: 1, hi: 3, pts: 2, reb: 1, ast: 0 },
      { lo: 4, hi: 11, pts: 3, reb: 1, ast: 1 },
    ];
    const result = enforceZeroFloor(chart);
    expect(result[0]).toMatchObject({ lo: 1, hi: 3 });
    expect(result[1]).toMatchObject({ lo: 4, hi: 11 });
  });

  it('does not touch tiers beyond the first', () => {
    const chart = [
      { lo: 1, hi: 3, pts: 0, reb: 0, ast: 0 },
      { lo: 4, hi: 11, pts: 3, reb: 1, ast: 1 },
    ];
    const result = enforceZeroFloor(chart);
    expect(result[1]).toMatchObject({ pts: 3, reb: 1, ast: 1 });
  });
});
