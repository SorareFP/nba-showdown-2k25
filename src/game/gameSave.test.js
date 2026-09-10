// The roaming save's decisions, with no Firebase and no clock.
import { describe, it, expect, vi } from 'vitest';
import {
  makeSave, forFirestore, nestedArrayPath, newerSave, saveIsFixture, describeSave,
  createRemoteSaver, REMOTE_MAX_BYTES, REMOTE_LOG_KEEP,
  newGameId, gameIdentity, sameGame, remoteDecision, fixtureDecision, samePreset,
} from './gameSave.js';

describe('samePreset', () => {
  it('matches a fixture by key, so opening it from the season is not a change to save', () => {
    const restored = { key: 's1:f3', label: 'Round 3' };
    const fromApp = { key: 's1:f3', label: 'Round 3', rosterA: [] };
    expect(samePreset(restored, fromApp)).toBe(true);
    expect(samePreset(restored, { key: 's1:f4' })).toBe(false);
    expect(samePreset(null, null)).toBe(true);
    expect(samePreset(null, fromApp)).toBe(false);
    expect(samePreset({}, {})).toBe(false);                   // no key, not the same object
  });
});

const game = (over = {}) => ({
  quarter: 2, section: 3, done: false,
  teamA: { name: 'Home', score: 41 }, teamB: { name: 'Away', score: 38 },
  log: [{ team: 'A', msg: 'tip' }],
  ...over,
});

describe('forFirestore', () => {
  it('strips undefined and keeps everything else', () => {
    const save = makeSave(game({ openMan: undefined, tempEff: { A: { r0: 1, gone: undefined } } }), null);
    const body = forFirestore(save);
    expect('openMan' in body.game).toBe(false);
    expect('gone' in body.game.tempEff.A).toBe(false);
    expect(body.game.tempEff.A.r0).toBe(1);
    expect(body.at).toBe(save.at);
  });

  it('refuses an array inside an array, naming where', () => {
    expect(nestedArrayPath({ a: { b: [1, [2]] } })).toBe('$.a.b[1]');
    expect(nestedArrayPath({ a: [{ c: [] }] })).toBe(null);
    expect(() => forFirestore(makeSave(game({ rows: [[1]] }), null))).toThrow(/array inside an array/);
  });

  it('trims the log only when the save is over the guard', () => {
    const small = forFirestore(makeSave(game(), null));
    expect(small.game.log).toHaveLength(1);
    expect(small.logTrimmed).toBeUndefined();

    const huge = game({ log: Array.from({ length: 20000 }, (_, i) => ({ team: 'A', msg: 'x'.repeat(60) + i })) });
    expect(JSON.stringify(huge).length).toBeGreaterThan(REMOTE_MAX_BYTES);
    const body = forFirestore(makeSave(huge, null));
    expect(body.game.log).toHaveLength(REMOTE_LOG_KEEP);
    expect(body.logTrimmed).toBe(true);
  });

  it('returns null when even a trimmed save is too big, and for no game', () => {
    const blob = game({ blob: 'y'.repeat(REMOTE_MAX_BYTES + 10) });
    expect(forFirestore(makeSave(blob, null))).toBe(null);
    expect(forFirestore(null)).toBe(null);
  });
});

describe('newerSave', () => {
  const at = t => ({ game: game(), at: t });
  it('prefers the strictly newer copy and calls a tie local', () => {
    expect(newerSave(null, null)).toBe('none');
    expect(newerSave(at(10), null)).toBe('local');
    expect(newerSave(null, at(10))).toBe('remote');
    expect(newerSave(at(10), at(20))).toBe('remote');
    expect(newerSave(at(20), at(10))).toBe('local');
    expect(newerSave(at(10), at(10))).toBe('local');
  });
  it('ignores a copy with no game in it', () => {
    expect(newerSave({ at: 99 }, at(1))).toBe('remote');
  });
});

describe('saveIsFixture', () => {
  it('matches on the preset key only', () => {
    const save = { game: game(), preset: { key: 's1:f3' }, at: 1 };
    expect(saveIsFixture(save, { key: 's1:f3' })).toBe(true);
    expect(saveIsFixture(save, { key: 's1:f4' })).toBe(false);
    expect(saveIsFixture(save, null)).toBe(false);
    expect(saveIsFixture({ game: game(), at: 1 }, { key: 's1:f3' })).toBe(false);
  });
});

describe('describeSave', () => {
  it('says what, where, the score and how long ago', () => {
    const now = 1_000_000_000;
    const save = { game: game(), preset: { key: 'k', label: 'Week 3 · vs Celtics' }, at: now - 7 * 60000 };
    expect(describeSave(save, now)).toBe('Week 3 · vs Celtics — Q2 · section 3, 41–38, saved 7 min ago.');
    const sandbox = { game: game(), preset: null, at: now - 3 * 3600000 };
    expect(describeSave(sandbox, now)).toBe('Home vs Away — Q2 · section 3, 41–38, saved 3 h ago.');
  });
});

describe('createRemoteSaver', () => {
  it('coalesces a burst into one write, skips a resend of the same snapshot, and clears on null', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => {});
    const clear = vi.fn(async () => {});
    const s = createRemoteSaver({ save, clear, delay: 100 });
    s.push({ game: game(), at: 1 });
    s.push({ game: game(), at: 2 });
    s.push({ game: game(), at: 3 });
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].at).toBe(3);

    s.push({ game: game(), at: 3 });   // same snapshot again
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);

    s.push(null);
    await vi.advanceTimersByTimeAsync(100);
    expect(clear).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('flush writes what is pending at once, and errors reach onError', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => { throw new Error('offline'); });
    const onError = vi.fn();
    const s = createRemoteSaver({ save, clear: async () => {}, delay: 1000, onError });
    s.push({ game: game(), at: 5 });
    await s.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);   // nothing left queued
    vi.useRealTimers();
  });
});

// ── Desktop to phone and back (2026-09-10) ───────────────────────────────────
// The user: "It does not look like the game state shifts elegantly from
// desktop to mobile. Not in season games at least."

const fx = { key: 's1:f3', seasonId: 's1', fixtureId: 'f3' };
const other = { key: 's1:f4', seasonId: 's1', fixtureId: 'f4' };
const S = (at, o = {}) => ({ game: game(o.game), preset: o.preset ?? null, ...(o.id ? { id: o.id } : {}), at });

describe('game identity', () => {
  it('names a fixture by its key and any other game by its id, and cannot name an old save', () => {
    expect(gameIdentity(S(1, { preset: fx }))).toBe('fixture:s1:f3');
    expect(gameIdentity(S(1, { id: 'abc' }))).toBe('game:abc');
    expect(gameIdentity(S(1))).toBeNull();
    expect(sameGame(S(1, { id: 'abc' }), S(9, { id: 'abc' }))).toBe(true);
    expect(sameGame(S(1), S(9))).toBe(false);                 // nameless is never "the same"
    expect(newGameId()).not.toBe(newGameId());
    expect(makeSave(game(), null, 'abc').id).toBe('abc');
    expect('id' in makeSave(game(), null)).toBe(false);
  });
});

describe('remoteDecision', () => {
  const held = S(100, { id: 'x' });

  it('takes a newer copy of the same game without asking', () => {
    expect(remoteDecision({ held, remote: S(200, { id: 'x' }), baseAt: 100 })).toBe('adopt');
    expect(remoteDecision({ held: S(100, { preset: fx }), remote: S(200, { preset: fx }), baseAt: 90 })).toBe('adopt');
  });

  it('does nothing when the account is not ahead of this device', () => {
    expect(remoteDecision({ held, remote: S(100, { id: 'x' }), baseAt: 100 })).toBe('none');
    expect(remoteDecision({ held: S(300, { id: 'x' }), remote: S(200, { id: 'x' }), baseAt: 100 })).toBe('none');
    expect(remoteDecision({ held, remote: null, baseAt: 100 })).toBe('none');
  });

  it('asks before a different game replaces one in progress, and just takes it when nothing is going', () => {
    expect(remoteDecision({ held, remote: S(200, { id: 'y' }), baseAt: 100 })).toBe('ask');
    expect(remoteDecision({ held: null, remote: S(200, { id: 'y' }), baseAt: 0 })).toBe('adopt');
    expect(remoteDecision({ held: S(100, { id: 'x', game: { done: true } }), remote: S(200, { id: 'y' }), baseAt: 100 })).toBe('adopt');
  });

  it('lets go of a game finished on the other device, and ignores someone else\'s finished game', () => {
    expect(remoteDecision({ held, remote: S(200, { id: 'x', game: { done: true } }), baseAt: 100 })).toBe('drop');
    expect(remoteDecision({ held, remote: S(200, { id: 'y', game: { done: true } }), baseAt: 100 })).toBe('none');
  });
});

describe('fixtureDecision', () => {
  it('plays the newest copy of the fixture, here or on the account', () => {
    expect(fixtureDecision({ held: S(100, { preset: fx }), remote: S(200, { preset: fx }), preset: fx }))
      .toMatchObject({ use: 'remote', discards: false });                // the stale phone copy used to win
    expect(fixtureDecision({ held: S(300, { preset: fx }), remote: S(200, { preset: fx }), preset: fx }).use).toBe('local');
    expect(fixtureDecision({ held: S(200, { preset: fx }), remote: S(200, { preset: fx }), preset: fx }).use).toBe('local');
  });

  it('offers the account\'s copy even with a different game going here, and says that game would go', () => {
    const d = fixtureDecision({ held: S(300, { id: 'sandbox' }), remote: S(200, { preset: fx }), preset: fx });
    expect(d).toMatchObject({ use: 'remote', discards: true });         // it used to deal fresh over the top
    expect(d.save.at).toBe(200);
  });

  it('deals when no copy of this fixture exists, asking first over a game in progress', () => {
    expect(fixtureDecision({ held: null, remote: S(200, { preset: other }), preset: fx })).toEqual({ use: 'deal', discards: false });
    expect(fixtureDecision({ held: S(100, { id: 'sandbox' }), remote: null, preset: fx })).toEqual({ use: 'deal', discards: true });
  });

  it('never replays a fixture finished on the other device, and keeps one finished here to be reported', () => {
    expect(fixtureDecision({ held: null, remote: S(200, { preset: fx, game: { done: true } }), preset: fx }).use).toBe('finished');
    expect(fixtureDecision({ held: S(300, { preset: fx, game: { done: true } }), remote: S(200, { preset: fx }), preset: fx }).use).toBe('local');
  });
});

describe('createRemoteSaver, refused', () => {
  it('hands the account\'s newer copy to onConflict and does not mark the write sent', async () => {
    vi.useFakeTimers();
    const newer = { game: game(), at: 50 };
    let refuse = true;
    const save = vi.fn(async () => (refuse ? { ok: false, newer } : { ok: true }));
    const onConflict = vi.fn();
    const s = createRemoteSaver({ save, clear: async () => ({ ok: false, newer }), delay: 10, onConflict });
    s.push({ game: game(), at: 40 });
    await vi.advanceTimersByTimeAsync(10);
    expect(onConflict).toHaveBeenCalledWith(newer);
    refuse = false;
    s.push({ game: game(), at: 40 });                 // the same snapshot is tried again, not skipped
    await vi.advanceTimersByTimeAsync(10);
    expect(save).toHaveBeenCalledTimes(2);
    s.push(null);                                     // a refused clear does not pull the other game in
    await vi.advanceTimersByTimeAsync(10);
    expect(onConflict).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
