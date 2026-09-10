// saveRemoteGameIfCurrent, the guarded account write: a device whose copy has
// fallen behind (the desktop tab left open while the phone played on) must not
// land its next move on top of the phone's progress.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const acct = { cur: null, set: undefined, deleted: false };
vi.mock('./config.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...path) => ({ path: path.join('/') }),
  getDoc: vi.fn(), setDoc: vi.fn(), deleteDoc: vi.fn(),
  runTransaction: async (_db, fn) => fn({
    get: async () => ({ exists: () => acct.cur != null, data: () => acct.cur }),
    set: (_r, body) => { acct.set = body; },
    delete: () => { acct.deleted = true; },
  }),
}));

import { saveRemoteGameIfCurrent } from './games.js';

const save = at => ({ game: { quarter: 2, done: false, log: [] }, preset: null, id: 'g1', at });
beforeEach(() => { acct.cur = null; acct.set = undefined; acct.deleted = false; });

describe('saveRemoteGameIfCurrent', () => {
  it('writes when the account holds nothing, or nothing newer than this device last saw', async () => {
    expect(await saveRemoteGameIfCurrent('u1', save(10), 0)).toEqual({ ok: true });
    expect(acct.set.at).toBe(10);
    acct.cur = save(10);
    expect(await saveRemoteGameIfCurrent('u1', save(12), 10)).toEqual({ ok: true });
    expect(acct.set.at).toBe(12);
  });

  it('refuses when another device wrote since, and hands its copy back', async () => {
    acct.cur = save(20);                                       // the phone, later
    const r = await saveRemoteGameIfCurrent('u1', save(25), 10);   // the desktop, based on 10
    expect(r.ok).toBe(false);
    expect(r.newer.at).toBe(20);
    expect(acct.set).toBeUndefined();
  });

  it('clears with null under the same guard', async () => {
    acct.cur = save(10);
    expect(await saveRemoteGameIfCurrent('u1', null, 10)).toEqual({ ok: true });
    expect(acct.deleted).toBe(true);
    acct.deleted = false;
    acct.cur = save(30);
    expect((await saveRemoteGameIfCurrent('u1', null, 10)).ok).toBe(false);
    expect(acct.deleted).toBe(false);
  });

  it('does nothing signed out', async () => {
    expect(await saveRemoteGameIfCurrent(null, save(1), 0)).toEqual({ ok: false });
  });
});
