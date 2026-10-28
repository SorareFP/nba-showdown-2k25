// SEND A REQUEST TO ANOTHER PLAYER (the user, 2026-10-28: "I just made a
// Barry Clemens card for my brother, but I requested it to my account. Can you
// send it to his?"). The callable RUN FOR REAL against an in-memory Firestore
// (the friends.test.js harness).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const docs = new Map();
const TS = Symbol('serverTimestamp');
const DEL = Symbol('delete');
function apply(prev, data) {
  const out = { ...(prev ?? {}) };
  for (const [k, v] of Object.entries(data)) {
    if (v === TS) out[k] = Date.now();
    else if (v === DEL) delete out[k];
    else out[k] = v;
  }
  return out;
}
const snap = path => ({ exists: docs.has(path), id: path.split('/').pop(), data: () => docs.get(path), get ref() { return ref(path); } });
const ref = path => ({
  path, id: path.split('/').pop(), get: async () => snap(path),
  set: async (data, opts) => { docs.set(path, opts?.merge ? apply(docs.get(path), data) : apply(null, data)); },
});
let auto = 0;
const coll = (path, filters = []) => ({
  doc: id => ref(`${path}/${id ?? `auto${auto += 1}`}`),
  where: (field, _op, value) => coll(path, [...filters, d => d?.[field] === value]),
  get: async () => ({
    docs: [...docs.keys()]
      .filter(k => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'))
      .map(snap)
      .filter(s => filters.every(f => f(s.data()))),
  }),
});
const db = {
  doc: path => ref(path),
  collection: path => coll(path),
  async runTransaction(fn) {
    const writes = [];
    const tx = {
      // A query (it has `where`) reads its documents; a document reads itself.
      get: async r => ('where' in r ? r.get() : snap(r.path)),
      set: (r, data, opts) => writes.push(() => docs.set(r.path, opts?.merge ? apply(docs.get(r.path), data) : apply(null, data))),
      update: (r, data) => writes.push(() => docs.set(r.path, apply(docs.get(r.path), data))),
      delete: r => writes.push(() => docs.delete(r.path)),
    };
    const out = await fn(tx);
    for (const w of writes) w();
    return out;
  },
};
const rooms = {};

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts, handler) => handler,
  HttpsError: class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } },
}));
vi.mock('firebase-admin/app', () => ({ initializeApp: () => {} }));
vi.mock('firebase-admin/database', () => ({ getDatabase: () => ({ ref: path => ({ get: async () => ({ val: () => rooms[path] ?? null }) }) }) }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => db,
  FieldValue: { increment: n => n, serverTimestamp: () => TS, delete: () => DEL },
}));
vi.mock('./shared/src/game/packEngine.js', () => import('../src/game/packEngine.js'));
vi.mock('./shared/src/game/collections.js', () => import('../src/game/collections.js'));
vi.mock('./shared/src/game/cardSets.js', () => import('../src/game/cardSets.js'));
vi.mock('./shared/src/game/rarity.js', () => import('../src/game/rarity.js'));
vi.mock('./shared/src/game/marketRules.js', () => import('../src/game/marketRules.js'));
vi.mock('./shared/src/game/strats.js', () => import('../src/game/strats.js'));
vi.mock('./shared/src/game/coinRewards.js', () => import('../src/game/coinRewards.js'));
vi.mock('./shared/src/game/modes/prizes.js', () => import('../src/game/modes/prizes.js'));
vi.mock('./shared/src/game/freeAgents.js', () => import('../src/game/freeAgents.js'));
vi.mock('./shared/src/game/modes/league.js', () => import('../src/game/modes/league.js'));
vi.mock('./shared/src/game/modes/dynasty.js', () => import('../src/game/modes/dynasty.js'));
vi.mock('./shared/src/game/modes/dynastyFriends.js', () => import('../src/game/modes/dynastyFriends.js'));
vi.mock('./shared/src/game/modes/seasonPack.js', () => import('../src/game/modes/seasonPack.js'));
vi.mock('./shared/src/game/rarityShift.js', () => import('../src/game/rarityShift.js'));
vi.mock('./shared/src/game/suggestions.js', () => import('../src/game/suggestions.js'));
vi.mock('./shared/src/game/friends.js', () => import('../src/game/friends.js'));
vi.mock('./shared/src/game/modes/climbMap.js', () => import('../src/game/modes/climbMap.js'));

const { sendCardRequest } = await import('./index.js');
const { ALL_CARDS, cardKey } = await import('../src/game/cardSets.js');

const as = (uid, email = `${uid}@example.com`) => (data = {}) => ({ auth: { uid, token: { email, name: uid } }, data });
const admin = as('boss', 'hoopsonhoops@gmail.com');
const player = as('kid');
const KEY = cardKey(ALL_CARDS.find(c => c.set === 'rookie'));

const request = (status, extra = {}) => docs.set('cardRequests/r1', {
  uid: 'boss', requester: 'The Boss', name: 'A Player', season: 1967, status, cardKey: KEY, ...extra,
});

beforeEach(() => {
  docs.clear();
  docs.set('friends/boss', { code: 'BSSS22', uids: ['bro'], names: { bro: 'Bro Example' } });
  docs.set('friendCodes/BRAV33', { uid: 'bro' });
  docs.set('friendCodes/BSSS22', { uid: 'boss' });
  docs.set('users/boss', { currency: 1000 });
});

describe('sending a request to another player', () => {
  it('moves a built card to a friend as a gift waiting on their Free Agents page', async () => {
    request('built');
    const out = await sendCardRequest(admin({ id: 'r1', friendUid: 'bro' }));
    const r = docs.get('cardRequests/r1');
    expect(r.uid).toBe('bro');
    expect(r.requester).toBe('Bro Example');
    expect(r.sentFrom).toBe('boss');
    expect(r.status).toBe('invoiced');
    expect(r.invoice).toMatchObject({ price: 0, gift: true });
    expect(out).toMatchObject({ id: 'r1', status: 'invoiced', removed: 0, refunded: 0 });
  });

  it('finds the player by friend code too', async () => {
    request('invoiced', { invoice: { price: 300 } });
    await sendCardRequest(admin({ id: 'r1', code: 'brav33' }));
    expect(docs.get('cardRequests/r1')).toMatchObject({ uid: 'bro', status: 'invoiced', invoice: { price: 0, gift: true } });
  });

  it('takes back the copy already signed into the old account, and the coins paid for it', async () => {
    request('signed', { invoice: { price: 300 }, signedAt: 1 });
    docs.set('users/boss/copies/c1', { cardKey: KEY, source: 'freeagent:r1', state: 'spare' });
    docs.set('users/boss/copies/c2', { cardKey: KEY, source: 'pack', state: 'spare' });
    docs.set(`users/boss/collection/${KEY}`, { count: 2 });
    const out = await sendCardRequest(admin({ id: 'r1', friendUid: 'bro' }));
    expect(docs.has('users/boss/copies/c1')).toBe(false);
    expect(docs.has('users/boss/copies/c2')).toBe(true);
    expect(out).toMatchObject({ removed: 1, refunded: 300 });
    expect(docs.get('cardRequests/r1')).toMatchObject({ uid: 'bro', status: 'invoiced', invoice: { gift: true } });
  });

  it('takes back a signed gift without paying anything back', async () => {
    request('gifted', { invoice: { price: 0, gift: true }, signedAt: 1 });
    docs.set('users/boss/copies/c1', { cardKey: KEY, source: 'freeagent:r1', state: 'earned' });
    docs.set(`users/boss/collection/${KEY}`, { count: 1, earned: true });
    const out = await sendCardRequest(admin({ id: 'r1', friendUid: 'bro' }));
    expect(docs.has(`users/boss/collection/${KEY}`)).toBe(false);
    expect(out).toMatchObject({ removed: 1, refunded: 0 });
  });

  it('moves a request not yet built and leaves it waiting', async () => {
    request('requested', { cardKey: null });
    await sendCardRequest(admin({ id: 'r1', friendUid: 'bro' }));
    expect(docs.get('cardRequests/r1')).toMatchObject({ uid: 'bro', status: 'requested' });
  });

  it("is the admin's alone, to a real player other than the owner, and never a rejected request", async () => {
    request('built');
    await expect(sendCardRequest(player({ id: 'r1', friendUid: 'bro' }))).rejects.toThrow(/Admins only/);
    await expect(sendCardRequest(admin({ id: 'r1', code: 'ZZZZZZ' }))).rejects.toThrow(/No player has that code/);
    await expect(sendCardRequest(admin({ id: 'r1', friendUid: 'stranger' }))).rejects.toThrow(/not one of your friends/);
    await expect(sendCardRequest(admin({ id: 'r1', code: 'BSSS22' }))).rejects.toThrow(/already theirs/);
    await expect(sendCardRequest(admin({ id: 'r1' }))).rejects.toThrow(/No player given/);
    request('rejected');
    await expect(sendCardRequest(admin({ id: 'r1', friendUid: 'bro' }))).rejects.toThrow(/rejected/);
  });
});
