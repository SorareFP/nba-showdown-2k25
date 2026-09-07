// The lifetime line as the card shows it.
import { describe, it, expect } from 'vitest';
import { careerLine } from './CardLightbox.jsx';

describe('careerLine', () => {
  it('averages over games played and shows the record', () => {
    const line = careerLine({ games: 4, wins: 3, pts: 50, reb: 22, ast: 9, tpm: 5, tpa: 12 });
    expect(line.games).toBe(4);
    expect(line.record).toBe('3–1');
    expect(line.averages).toBe('12.5 pts · 5.5 reb · 2.3 ast');
    expect(line.totals).toBe('50 pts · 22 reb · 9 ast · 5/12 3PT');
  });

  it('is nothing for a card never played', () => {
    expect(careerLine(undefined)).toBeNull();
    expect(careerLine({ games: 0 })).toBeNull();
  });
});
