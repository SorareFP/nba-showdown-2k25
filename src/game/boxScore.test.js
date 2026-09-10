// The box a finished game reports: who played, keyed by collection key.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam } from './engine.js';
import { CARDS } from './cards.js';
import { cardKey } from './cardSets.js';
import { boxScoreFor } from './boxScore.js';
import { sanitizeBox, MAX_BOX_ROWS } from './coinRewards.js';

describe('boxScoreFor', () => {
  it('lists only the players who took the floor, with their lines', () => {
    const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
    const t = getTeam(g, 'A');
    t.stats[0] = { ...t.stats[0], pts: 24, reb: 6, ast: 3, totalMinutes: 32, threepm: 3, threepa: 8 };
    t.stats[1] = { ...t.stats[1], pts: 0, reb: 0, ast: 0, totalMinutes: 4 };
    // stats[2..9] never played: totalMinutes 0
    const box = boxScoreFor(g, 'A');
    expect(box).toHaveLength(2);
    expect(box[0]).toEqual({ key: cardKey(t.roster[0]), pts: 24, reb: 6, ast: 3, min: 32, tpm: 3, tpa: 8, alw: 0, gs: 0, fta: 0, ftm: 0, pnta: 0, pntm: 0, dca: 0, dcm: 0, blk: 0, onf: 0, ona: 0 });
    expect(box[1].key).toBe(cardKey(t.roster[1]));
  });

  it('is empty for a team that does not exist', () => {
    expect(boxScoreFor({}, 'B')).toEqual([]);
  });
});

describe('sanitizeBox', () => {
  it('keeps the shape and nothing else', () => {
    const out = sanitizeBox([
      { key: 'a', pts: 12.4, reb: '3', ast: -2, min: 999, tpm: 'x', tpa: 4, extra: 'no' },
      { key: 'a', pts: 99 },              // duplicate key: dropped
      { pts: 5 },                          // no key: dropped
      { key: 'b' },
    ]);
    expect(out).toEqual([
      { key: 'a', pts: 12, reb: 3, ast: 0, min: 200, tpm: 0, tpa: 4, alw: 0, gs: 0, fta: 0, ftm: 0, pnta: 0, pntm: 0, dca: 0, dcm: 0, blk: 0, onf: 0, ona: 0 },
      { key: 'b', pts: 0, reb: 0, ast: 0, min: 0, tpm: 0, tpa: 0, alw: 0, gs: 0, fta: 0, ftm: 0, pnta: 0, pntm: 0, dca: 0, dcm: 0, blk: 0, onf: 0, ona: 0 },
    ]);
  });

  it('caps the number of rows and survives garbage', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, pts: 1 }));
    expect(sanitizeBox(many)).toHaveLength(MAX_BOX_ROWS);
    expect(sanitizeBox(null)).toEqual([]);
    expect(sanitizeBox('nope')).toEqual([]);
  });
});
