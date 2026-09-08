// The roaming save's decisions, with no Firebase and no clock.
import { describe, it, expect, vi } from 'vitest';
import {
  makeSave, forFirestore, nestedArrayPath, newerSave, saveIsFixture, describeSave,
  createRemoteSaver, REMOTE_MAX_BYTES, REMOTE_LOG_KEEP,
} from './gameSave.js';

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
