// settleRarityShift, RUN FOR REAL against an in-memory Firestore (2026-09-30):
// the callable from index.js with the Admin SDK stubbed and the shared modules
// pointed at src/, as claimReceipts.test.js does. It prices from the committed
// table, so the keys below are read from it.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const docs = new Map();
const INC = Symbol('increment');
const TS = Symbol('serverTimestamp');
function apply(prev, data) {
  const out = { ...(prev ?? {}) };
  for (const [k, v] of Object.entries(data)) {
    if (v && v[INC] !== undefined) out[k] = (Number(out[k]) || 0) + v[INC];
    else if (v === TS) out[k] = Date.now();
    else out[k] = v;
  }
  return out;
}
const snap = path => ({ exists: docs.has(path), id: path.split('/').pop(), data: () => docs.get(path) });
const ref = path => ({ path, get: async () => snap(path) });
const coll = path => ({
  collectionPath: path,
  doc: id => ref(`${path}/${id}`),
  get: async () => ({ docs: [...docs.keys()].filter(k => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/')).map(snap) }),
});
let transactions = 0;
const db = {
  doc: path => ref(path),
  collection: path => coll(path),
  async runTransaction(fn) {
    transactions += 1;
    const writes = [];
    const tx = {
      get: async r => (r.collectionPath ? r.get() : snap(r.path)),
      set: (r, data, opts) => writes.push(() => docs.set(r.path, opts?.merge ? apply(docs.get(r.path), data) : apply(null, data))),
    };
    const out = await fn(tx);
    for (const w of writes) w();
    return out;
  },
};

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts, handler) => handler,
  HttpsError: class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } },
}));
vi.mock('firebase-admin/app', () => ({ initializeApp: () => {} }));
vi.mock('firebase-admin/database', () => ({ getDatabase: () => ({}) }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => db,
  FieldValue: { increment: n => ({ [INC]: n }), serverTimestamp: () => TS, delete: () => ({}) },
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

const { settleRarityShift } = await import('./index.js');
const { RARITY_SHIFT } = await import('../src/game/rarityShift.js');

const UID = 'u1';
const call = data => settleRarityShift({ auth: { uid: UID }, data: data ?? {} });
const coins = () => docs.get(`users/${UID}`)?.currency ?? 0;
const receipt = () => docs.get(`users/${UID}/claims/${RARITY_SHIFT.id}`);
const entries = Object.entries(RARITY_SHIFT.shifts);
const [downKey, down] = entries.find(([, m]) => m.coins > 0);
const [upKey, up] = entries.find(([, m]) => m.coins < 0);
const before = Date.parse(RARITY_SHIFT.cutoff) - 60_000;
const after = Date.parse(RARITY_SHIFT.cutoff) + 60_000;
let n = 0;
const give = (cardKey, fields) => docs.set(`users/${UID}/copies/c${n += 1}`, { cardKey, state: 'spare', ...fields });

beforeEach(() => {
  docs.clear();
  docs.set(`users/${UID}`, { currency: 100 });
});

describe('settleRarityShift', () => {
  it('pays the net burn difference over the copies held before the cutoff, once', async () => {
    give(downKey, { mintedAt: before });
    give(downKey, { mintedAt: before, state: 'collected' });
    give(downKey, { mintedAt: after });                       // pulled after the change: not owed
    give(downKey, { mintedAt: before, acquiredAt: after });   // bought after it: not owed
    give(upKey, { mintedAt: before });
    const owed = 2 * down.coins + up.coins;
    const first = await call();
    expect(first).toMatchObject({ id: RARITY_SHIFT.id, coins: Math.max(0, owed), net: owed, cards: 2 });
    expect(coins()).toBe(100 + Math.max(0, owed));
    expect(receipt()).toMatchObject({ coins: Math.max(0, owed), net: owed, cards: 2, shift: RARITY_SHIFT.id, label: 'Rarity changes' });

    const again = await call();
    expect(again).toMatchObject({ already: true, coins: first.coins, cards: 2 });
    expect(coins()).toBe(100 + Math.max(0, owed));
  });

  it('never charges a collection that came out ahead, and still writes the receipt', async () => {
    give(upKey, { mintedAt: before });
    const r = await call();
    expect(r).toMatchObject({ coins: 0, net: up.coins, cards: 1 });
    expect(coins()).toBe(100);
    expect(receipt()).toMatchObject({ coins: 0 });
  });

  it('pays nothing and records nothing to settle for an account that holds no moved card', async () => {
    give('Nobody_Moved', { mintedAt: before });
    const r = await call();
    expect(r).toMatchObject({ coins: 0, net: 0, cards: 0, lines: [] });
    expect(coins()).toBe(100);
    expect(receipt()).toMatchObject({ coins: 0, cards: 0 });
  });

  it('ignores anything the caller sends: the ledger names the price', async () => {
    give(downKey, { mintedAt: before });
    const r = await call({ coins: 99999, cards: ['whatever'] });
    expect(r.coins).toBe(down.coins);
    expect(coins()).toBe(100 + down.coins);
  });

  it('refuses a signed-out caller', async () => {
    await expect(settleRarityShift({ data: {} })).rejects.toThrow(/Sign in/);
  });
});
