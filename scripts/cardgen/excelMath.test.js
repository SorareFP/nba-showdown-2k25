import { describe, it, expect } from 'vitest';
import { percentileExc, roundDown } from './excelMath.js';

describe('percentileExc', () => {
  it('matches Excel PERCENTILE.EXC for a simple sorted array', () => {
    // Excel: =PERCENTILE.EXC({1,2,3,4,5,6,7,8,9,10}, 0.1) = 1.1
    expect(percentileExc([1,2,3,4,5,6,7,8,9,10], 0.1)).toBeCloseTo(1.1, 10);
    // =PERCENTILE.EXC({1,2,3,4,5,6,7,8,9,10}, 0.9) = 9.9
    expect(percentileExc([1,2,3,4,5,6,7,8,9,10], 0.9)).toBeCloseTo(9.9, 10);
    // =PERCENTILE.EXC({1,2,3,4,5,6,7,8,9,10}, 0.5) = 5.5
    expect(percentileExc([1,2,3,4,5,6,7,8,9,10], 0.5)).toBeCloseTo(5.5, 10);
  });

  it('sorts input before computing (order-independent)', () => {
    expect(percentileExc([10,3,7,1,5,2,9,4,8,6], 0.33)).toBeCloseTo(
      percentileExc([1,2,3,4,5,6,7,8,9,10], 0.33), 10
    );
  });

  it('throws for p out of Excel-valid range given array length (Excel #NUM! case)', () => {
    // rank = p*(n+1) must land within [1, n]
    expect(() => percentileExc([1,2,3], 0.9)).toThrow();
  });
});

describe('roundDown', () => {
  it('rounds toward zero to the given decimal digits', () => {
    expect(roundDown(2.789, 1)).toBe(2.7);
    expect(roundDown(2.789, 0)).toBe(2);
    expect(roundDown(-2.789, 1)).toBe(-2.7);
  });
});
