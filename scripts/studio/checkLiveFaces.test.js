// THE LIVE FACES MATCH THE LIVE NUMBERS (2026-10-23): a deploy that would ship
// last numbers on this season's faces stops (checkLiveFaces.mjs, predeploy).
import { describe, it, expect } from 'vitest';
import { staleLiveFaces } from './checkLiveFaces.mjs';

describe('the Live faces', () => {
  it('names a face that is missing or older than the numbers', () => {
    const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const times = { a: 2000, b: 500 };
    expect(staleLiveFaces({ cards, dataAt: 1000, mtimeOf: id => times[id] ?? null })).toEqual(['b', 'c']);
    expect(staleLiveFaces({ cards: [{ id: 'a' }], dataAt: 1000, mtimeOf: () => 1000 })).toEqual([]);
  });
});
