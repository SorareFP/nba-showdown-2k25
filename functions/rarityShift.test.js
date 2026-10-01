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
vi.mock('./shared/src/game/suggestions.js', () => import('../src/game/suggestions.js'));

const { settleRarityShift } = await import('./index.js');
const { RARITY_SHIFTS } = await import('../src/game/rarityShift.js');

// Several tables since 2026-09-30 (evening): each change keeps its own, and an
// account settles whichever it has not claimed, each once, on its own receipt.
const FIRST = RARITY_SHIFTS[0];
const NEWEST = RARITY_SHIFTS.at(-1);
const UID = 'u1';
const call = data => settleRarityShift({ auth: { uid: UID }, data: data ?? {} });
const coins = () => docs.get(`users/${UID}`)?.currency ?? 0;
const receipt = id => docs.get(`users/${UID}/claims/${id}`);
// A key that moved in ONE table only, so each test knows exactly what is owed.
const exclusive = (t, sign) => Object.entries(t.shifts)
  .find(([k, m]) => Math.sign(m.coins) === sign && RARITY_SHIFTS.every(o => o === t || !(k in o.shifts)));
// The newest table with both a card that fell and one that rose (a table can
// hold only one direction: the 2026-10-01 one is all downgrades).
const BOTH = [...RARITY_SHIFTS].reverse().find(t => exclusive(t, 1) && exclusive(t, -1));
const [downKey, down] = exclusive(BOTH, 1);
const [upKey, up] = exclusive(BOTH, -1);
const [firstKey, firstMove] = exclusive(FIRST, 1);
const [newKey, newMove] = exclusive(NEWEST, 1);
const before = Math.min(...RARITY_SHIFTS.map(t => Date.parse(t.cutoff))) - 60_000;
const after = Math.max(...RARITY_SHIFTS.map(t => Date.parse(t.cutoff))) + 60_000;
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
    expect(first).toMatchObject({ id: NEWEST.id, coins: Math.max(0, owed), net: owed, cards: 2 });
    expect(coins()).toBe(100 + Math.max(0, owed));
    expect(receipt(BOTH.id)).toMatchObject({ coins: Math.max(0, owed), net: owed, cards: 2, shift: BOTH.id, label: 'Rarity changes' });
    // Nothing of theirs moved in the other tables, and each receipt is written all the same.
    for (const t of RARITY_SHIFTS.filter(x => x !== BOTH)) expect(receipt(t.id)).toMatchObject({ coins: 0, cards: 0, shift: t.id });

    const again = await call();
    expect(again).toMatchObject({ already: true });
    expect(coins()).toBe(100 + Math.max(0, owed));
  });

  it('settles every table for an account that had not signed in between them', async () => {
    give(firstKey, { mintedAt: before });
    give(newKey, { mintedAt: before });
    const r = await call();
    expect(r.coins).toBe(firstMove.coins + newMove.coins);
    expect(receipt(FIRST.id)).toMatchObject({ coins: firstMove.coins, cards: 1 });
    expect(receipt(NEWEST.id)).toMatchObject({ coins: newMove.coins, cards: 1 });
    expect(coins()).toBe(100 + firstMove.coins + newMove.coins);
  });

  it('settles only the newest table for an account that already claimed the earlier ones', async () => {
    for (const t of RARITY_SHIFTS.slice(0, -1)) docs.set(`users/${UID}/claims/${t.id}`, { coins: 7, net: 7, cards: 1, lines: [] });
    give(firstKey, { mintedAt: before });
    give(newKey, { mintedAt: before });
    const r = await call();
    expect(r).toMatchObject({ id: NEWEST.id, coins: newMove.coins, cards: 1 });
    expect(receipt(FIRST.id)).toMatchObject({ coins: 7 });
    expect(coins()).toBe(100 + newMove.coins);
  });

  it('never charges a collection that came out ahead, and still writes the receipt', async () => {
    give(upKey, { mintedAt: before });
    const r = await call();
    expect(r).toMatchObject({ coins: 0, net: up.coins, cards: 1 });
    expect(coins()).toBe(100);
    expect(receipt(BOTH.id)).toMatchObject({ coins: 0 });
  });

  it('pays nothing and records nothing to settle for an account that holds no moved card', async () => {
    give('Nobody_Moved', { mintedAt: before });
    const r = await call();
    expect(r).toMatchObject({ coins: 0, net: 0, cards: 0, lines: [] });
    expect(coins()).toBe(100);
    expect(receipt(NEWEST.id)).toMatchObject({ coins: 0, cards: 0 });
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
