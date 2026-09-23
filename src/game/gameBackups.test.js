// NO GAME IN PROGRESS IS EVER SIMPLY GONE (2026-09-23). The user lost a game
// mid-play: "that can't happen." Every write that would replace, clear or
// roll back an in-progress game keeps it first, a refused write is retried and
// reported, and the backups are what the Recover lists offer.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  writeLocalGame, readLocalGame, readBackups, backupSave, dropBackup, needsBackup, recoverable,
  requestRecover, takePendingRecover, trimLog, BACKUP_KEEP, REMOTE_LOG_KEEP, HOME_RECOVER_MS, LOCAL_KEY,
} from './gameSave.js';

/** A Storage stand-in that can be told to refuse writes past a size. */
function fakeStorage({ limit = Infinity } = {}) {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      const total = [...m].reduce((t, [key, val]) => t + (key === k ? 0 : val.length), 0) + String(v).length;
      if (total > limit) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      m.set(k, String(v));
    },
    removeItem: k => { m.delete(k); },
    _map: m,
  };
}
const game = (over = {}) => ({ teamA: { name: 'A', score: 10 }, teamB: { name: 'B', score: 8 }, quarter: 2, section: 1, done: false, log: [], ...over });
const save = (id, at, over = {}) => ({ game: game(over), preset: null, id, at });

let real;
beforeEach(() => { real = globalThis.localStorage; globalThis.localStorage = fakeStorage(); });
afterEach(() => { globalThis.localStorage = real; });

describe('needsBackup', () => {
  it('keeps an in-progress game that a different game, a clear or an older copy would land on', () => {
    const cur = save('g1', 200);
    expect(needsBackup(cur, save('g2', 300))).toBe(true);     // a different game
    expect(needsBackup(cur, null)).toBe(true);                // cleared
    expect(needsBackup(cur, save('g1', 100))).toBe(true);     // an older copy of itself
    expect(needsBackup(cur, save('g1', 300))).toBe(false);    // the same game, moved on
    expect(needsBackup(save('g1', 200, { done: true }), null)).toBe(false); // finished: nothing to lose
    expect(needsBackup(null, save('g2', 300))).toBe(false);
  });
});

describe('writeLocalGame', () => {
  it('backs up the game it replaces, and says the write landed', () => {
    expect(writeLocalGame(save('g1', 100))).toBe(true);
    expect(writeLocalGame(save('g2', 200))).toBe(true);
    expect(readLocalGame().id).toBe('g2');
    expect(readBackups().map(s => s.id)).toEqual(['g1']);
    // Clearing keeps the one it clears.
    expect(writeLocalGame(null)).toBe(true);
    expect(readLocalGame()).toBeNull();
    expect(readBackups().map(s => s.id)).toEqual(['g2', 'g1']);
  });

  it('marks a game abandoned on purpose, so Home can skip it', () => {
    writeLocalGame(save('g1', 100));
    writeLocalGame(null, { abandoned: true });
    expect(readBackups()[0]).toMatchObject({ id: 'g1', abandoned: true });
  });

  it('retries a refused write with the log trimmed, and reports a refusal it cannot beat', () => {
    const big = save('g1', 100, { log: Array.from({ length: 2000 }, (_, i) => ({ msg: `line ${i} ${'x'.repeat(40)}` })) });
    const room = JSON.stringify(trimLog(big)).length + 200;
    globalThis.localStorage = fakeStorage({ limit: room });
    expect(writeLocalGame(big)).toBe(true);
    const stored = readLocalGame();
    expect(stored.logTrimmed).toBe(true);
    expect(stored.game.log.length).toBe(REMOTE_LOG_KEEP);
    // Nothing fits at all: false, and the old save stays where it was.
    globalThis.localStorage = fakeStorage({ limit: 10 });
    expect(writeLocalGame(save('g2', 200))).toBe(false);
  });

  it('keeps the old save in place when a new one is refused', () => {
    const store = fakeStorage();
    globalThis.localStorage = store;
    writeLocalGame(save('g1', 100));
    const before = store.getItem(LOCAL_KEY);
    store.setItem = () => { throw new Error('QuotaExceededError'); };
    expect(writeLocalGame(save('g1', 200))).toBe(false);
    expect(store.getItem(LOCAL_KEY)).toBe(before);
  });
});

describe('the backups', () => {
  it('hold the newest copy of each game, newest first, BACKUP_KEEP deep', () => {
    for (let i = 0; i < BACKUP_KEEP + 3; i += 1) backupSave(save(`g${i}`, 100 + i));
    backupSave(save('g2', 999));
    const list = readBackups();
    expect(list.length).toBe(BACKUP_KEEP);
    expect(list[0]).toMatchObject({ id: 'g2', at: 999 });
    expect(list.filter(s => s.id === 'g2').length).toBe(1);
    // A finished game is never kept.
    backupSave(save('done', 5000, { done: true }));
    expect(readBackups().some(s => s.id === 'done')).toBe(false);
    dropBackup(save('g2', 0));
    expect(readBackups().some(s => s.id === 'g2')).toBe(false);
  });

  it('offer what can be recovered: in progress, not the game already going, one per game', () => {
    const now = 10_000_000;
    const list = recoverable(save('g1', now), [
      save('g1', now - 10),                              // the game already going
      save('g2', now - 20), save('g2', now - 30),        // one per game, the newest
      save('g3', now - 40, { done: true }),              // finished
      { ...save('g4', now - 50), abandoned: true },
    ], { now });
    expect(list.map(s => [s.id, s.at])).toEqual([['g2', now - 20], ['g4', now - 50]]);
    // Home skips abandoned games, even a copy of one without the mark, and old ones.
    const home = recoverable(null, [{ ...save('g4', now - 50), abandoned: true }, save('g4', now - 40), save('g5', now - HOME_RECOVER_MS - 1)],
      { skipAbandoned: true, maxAgeMs: HOME_RECOVER_MS, now });
    expect(home).toEqual([]);
  });
});

describe('a recovery asked for from Home', () => {
  it('reaches the Play tab by event while it is mounted, and by the pending key when it mounts', () => {
    const seen = [];
    const on = e => seen.push(e.detail.id);
    globalThis.addEventListener?.('showdown:recover', on);
    requestRecover(save('g7', 700));
    globalThis.removeEventListener?.('showdown:recover', on);
    if (globalThis.addEventListener) expect(seen).toEqual(['g7']);
    expect(takePendingRecover()).toMatchObject({ id: 'g7' });
    expect(takePendingRecover()).toBeNull();
  });
});
