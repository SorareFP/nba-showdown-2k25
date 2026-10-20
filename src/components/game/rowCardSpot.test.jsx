// THE ROSTER ROW'S CARD (2026-10-20). The user, on the board's team list: "When
// I hover over this, I should be able to see a pop-up of the card I'm hovering
// over". Where the card goes beside the row, kept on the screen.
import { describe, it, expect } from 'vitest';
import { rowCardSpot } from './CourtBoard.jsx';

const row = (left, top) => ({ left, right: left + 240, top, bottom: top + 22, height: 22 });

describe('the roster row card', () => {
  it('sits left of a right-hand panel, right of a left-hand one, centred on the row', () => {
    const b = rowCardSpot(row(1600, 400), 'left', 1920, 1080);
    expect(b.left).toBe(1600 - 260 - 12);
    expect(b.top + Math.round(260 * 1238 / 825) / 2).toBeCloseTo(411, 0);
    expect(rowCardSpot(row(40, 400), 'right', 1920, 1080).left).toBe(40 + 240 + 12);
  });

  it('flips to the other side rather than leave the screen, and never runs off the top or bottom', () => {
    expect(rowCardSpot(row(100, 400), 'left', 1920, 1080).left).toBe(100 + 240 + 12);
    expect(rowCardSpot(row(1600, 400), 'right', 1920, 1080).left).toBe(1600 - 260 - 12);
    expect(rowCardSpot(row(1600, 5), 'left', 1920, 1080).top).toBe(8);
    const low = rowCardSpot(row(1600, 1070), 'left', 1920, 1080);
    expect(low.top + Math.round(260 * 1238 / 825)).toBeLessThanOrEqual(1080 - 8);
  });
});
