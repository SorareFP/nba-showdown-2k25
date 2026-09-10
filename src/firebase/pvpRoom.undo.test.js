// writeGameStateIf, the guarded write behind a PvP placement undo: the undo
// is usually made out of turn, so it must land only on the game it was
// judged against, never on top of a move the opponent got in first.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = { cur: null, written: undefined, meta: null };
vi.mock('./config.js', () => ({ rtdb: {} }));
vi.mock('firebase/database', () => ({
  ref: (_db, path) => ({ path }),
  set: vi.fn(), get: vi.fn(), onValue: vi.fn(), off: vi.fn(),
  update: vi.fn(async (_r, v) => { db.meta = v; }),
  // One pass of the updater against the room's current value, as the server runs it.
  runTransaction: vi.fn(async (_r, fn) => {
    const out = fn(db.cur);
    if (out === undefined) return { committed: false };
    db.written = out;
    return { committed: true };
  }),
}));

import { writeGameStateIf } from './pvpRoom.js';
import { prepareForFirebase, fixFromFirebase } from './pvpGame.js';

const room = (step, lines) => prepareForFirebase({ placementStep: step, log: lines.map(msg => ({ team: 'A', msg })) });
const seen = { step: 4, logLen: 2 };
const still = cur => (cur?.placementStep ?? 10) === seen.step && (cur?.log ?? []).length === seen.logLen;
const undone = { placementStep: 3, log: [{ team: 'A', msg: 'x' }], teamA: { starters: [] } };

beforeEach(() => { db.cur = null; db.written = undefined; db.meta = null; });

describe('writeGameStateIf', () => {
  it('writes when the room still holds the game the undo was judged against', async () => {
    db.cur = room(4, ['a', 'b']);
    expect(await writeGameStateIf('R1', undone, still)).toBe(true);
    expect(fixFromFirebase(db.written)).toEqual(undone);
    expect(db.meta.lastActionAt).toBeGreaterThan(0);
  });

  it('writes nothing once the opponent has placed or played a card', async () => {
    db.cur = room(5, ['a', 'b', 'c']);                                  // they placed
    expect(await writeGameStateIf('R1', undone, still)).toBe(false);
    db.cur = room(4, ['a', 'b', 'card']);                               // they played a card
    expect(await writeGameStateIf('R1', undone, still)).toBe(false);
    expect(db.written).toBeUndefined();
    expect(db.meta).toBeNull();
  });

  it('does not report success off an empty first pass', async () => {
    db.cur = null;
    expect(await writeGameStateIf('R1', undone, still)).toBe(false);
    expect(db.meta).toBeNull();
  });
});
