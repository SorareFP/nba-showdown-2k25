// TRADES BETWEEN FRIENDS (2026-11-02): the callables, RUN FOR REAL against an
// in-memory Firestore (the friends.test.js harness, with real increments and
// queries inside a transaction). docs/plans/2026-11-02-friend-trades-design.md
import { describe, it, expect, vi, beforeEach } from 'vitest';

const docs = new Map();
const TS = Symbol('serverTimestamp');
const DEL = Symbol('delete');
function apply(prev, data) {
  const out = { ...(prev ?? {}) };
  for (const [k, v] of Object.entries(data)) {
    if (v === TS) out[k] = Date.now();
    else if (v?.inc != null) out[k] = (out[k] ?? 0) + v.inc;
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
  FieldValue: { increment: n => ({ inc: n }), serverTimestamp: () => TS, delete: () => DEL },
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

const { friendSpares, sendTrade, answerTrade, cancelTrade, myTrades, requestFriend, answerFriendRequest, myFriends, removeFriend } = await import('./index.js');
const { CARDS } = await import('../src/game/cards.js');
const { cardKey } = await import('../src/game/cardSets.js');
const { getPlayerRarity } = await import('../src/game/rarity.js');

const as = (uid, name) => (data = {}) => ({ auth: { uid, token: { name } }, data });
const sam = as('sam', 'Sam Example');
const alex = as('alex', 'Alex Example');
const jo = as('jo', 'Jo Example');
const DAY = 24 * 60 * 60 * 1000;

const keys = rarity => CARDS.filter(c => getPlayerRarity(c) === rarity).map(cardKey);
const [R1, R2, R3, R4] = keys('rare');
const [U1, U2, U3, U4, U5] = keys('uncommon');
const [S1] = keys('super-rare');

let n = 0;
/** A copy in an account, and the index that counts it. */
function hold(uid, key, state = 'spare') {
  n += 1;
  docs.set(`users/${uid}/copies/c${n}`, { cardKey: key, type: 'player', state, mintedAt: 5, source: 'pack' });
  const at = `users/${uid}/collection/${key}`;
  docs.set(at, { type: 'player', count: (docs.get(at)?.count ?? 0) + 1 });
  return `c${n}`;
}
const copiesOf = (uid, key) => [...docs.entries()].filter(([k, v]) => k.startsWith(`users/${uid}/copies/`) && v.cardKey === key).map(([, v]) => v);
const count = (uid, key) => docs.get(`users/${uid}/collection/${key}`)?.count ?? 0;
const trade = id => docs.get(`trades/${id}`);
const offer = (data = {}) => sendTrade(sam({ friendUid: 'alex', give: [R1], get: [R2], ...data }));

beforeEach(() => {
  docs.clear();
  docs.set('users/sam', { currency: 100 });
  docs.set('users/alex', { currency: 100 });
  docs.set('friends/sam', { code: 'AAAAAA', uids: ['alex'], names: { alex: 'Alex Example' } });
  docs.set('friends/alex', { code: 'BBBBBB', uids: ['sam'], names: { sam: 'Sam Example' } });
  docs.set('friendCodes/AAAAAA', { uid: 'sam' });
  docs.set('friendCodes/BBBBBB', { uid: 'alex' });
  hold('sam', R1);
  hold('alex', R2);
});

describe("a friend's spares", () => {
  it('are spare player cards, counted, both ways', async () => {
    hold('alex', R2);
    hold('alex', R3, 'collected');
    hold('alex', R4, 'listed');
    hold('alex', U1, 'earned');
    docs.set('users/alex/copies/strat', { cardKey: 'high_screen_roll', type: 'strat', state: 'spare' });
    const out = await friendSpares(sam({ friendUid: 'alex' }));
    expect(out.theirs).toEqual([{ cardKey: R2, count: 2 }]);
    expect(out.mine).toEqual([{ cardKey: R1, count: 1 }]);
    expect(out.opensAt).toBeNull();
  });

  it('are for friends', async () => {
    await expect(friendSpares(jo({ friendUid: 'alex' }))).rejects.toThrow(/friend/);
  });

  it('say when a new friendship can trade', async () => {
    const at = Date.now() - 2 * DAY;
    docs.get('friends/sam').since = { alex: at };
    expect((await friendSpares(sam({ friendUid: 'alex' }))).opensAt).toBe(at + 7 * DAY);
  });
});

describe('sending an offer', () => {
  it('opens for three days, from both sides\' names', async () => {
    const { id } = await offer();
    expect(trade(id)).toMatchObject({ from: 'sam', to: 'alex', fromName: 'Sam Example', toName: 'Alex Example', give: [R1], get: [R2], status: 'open' });
    expect(trade(id).expiresAt - trade(id).createdAt).toBe(3 * DAY);
    expect(copiesOf('sam', R1).length).toBe(1);
  });

  it('is for friends', async () => {
    await expect(sendTrade(jo({ friendUid: 'alex', give: [R1], get: [R2] }))).rejects.toThrow(/friend/);
  });

  it('waits a week into a friendship', async () => {
    docs.get('friends/sam').since = { alex: Date.now() - 6 * DAY };
    await expect(offer()).rejects.toThrow(/week/);
    docs.get('friends/sam').since = { alex: Date.now() - 7 * DAY };
    await expect(offer()).resolves.toMatchObject({ id: expect.any(String) });
  });

  it('refuses an uneven offer', async () => {
    hold('alex', S1);
    await expect(offer({ get: [S1] })).rejects.toThrow(/uneven/);
  });

  it('refuses a card the owner has no spare of, either side', async () => {
    await expect(offer({ give: [R3] })).rejects.toThrow(/spare/);
    await expect(offer({ get: [R3] })).rejects.toThrow(/spare/);
    hold('alex', R3, 'collected');
    await expect(offer({ get: [R3] })).rejects.toThrow(/spare/);
  });

  // Review Focus: two copies named, one spare.
  it('refuses two copies of a card with one spare', async () => {
    hold('alex', R3);
    await expect(offer({ give: [R1, R1], get: [R2, R3] })).rejects.toThrow(/spare/);
    hold('sam', R1);
    await expect(offer({ give: [R1, R1], get: [R2, R3] })).resolves.toBeDefined();
  });

  it('stops at five open, and an expired one does not count', async () => {
    for (let i = 0; i < 5; i += 1) await offer();
    await expect(offer()).rejects.toThrow(/five open|5 open/i);
    const [first] = [...docs.keys()].filter(k => k.startsWith('trades/'));
    docs.get(first).expiresAt = Date.now() - 1;
    await expect(offer()).resolves.toBeDefined();
  });
});

describe('answering an offer', () => {
  it('swaps every card and both counts, and leaves the supply alone', async () => {
    const { id } = await offer();
    expect(await answerTrade(alex({ id, accept: true }))).toEqual({ status: 'accepted' });
    expect(copiesOf('sam', R1)).toEqual([]);
    expect(copiesOf('alex', R1)).toEqual([expect.objectContaining({ state: 'spare', tradedFrom: 'sam', mintedAt: 5, source: 'pack' })]);
    expect(copiesOf('sam', R2)).toEqual([expect.objectContaining({ state: 'spare', tradedFrom: 'alex' })]);
    expect([count('sam', R1), count('sam', R2), count('alex', R1), count('alex', R2)]).toEqual([0, 1, 1, 0]);
    expect(trade(id).status).toBe('accepted');
    expect(docs.has('supply/current')).toBe(false);
  });

  it('moves several cards each way', async () => {
    for (const k of [U1, U2, U3, U4, U5]) hold('sam', k);
    const { id } = await offer({ give: [U1, U2, U3, U4, U5], get: [R2] });
    await answerTrade(alex({ id, accept: true }));
    expect(copiesOf('alex', U5).length).toBe(1);
    expect(copiesOf('sam', R2).length).toBe(1);
  });

  it('takes one spare and leaves the collected copy', async () => {
    hold('alex', R2, 'collected');
    const { id } = await offer();
    await answerTrade(alex({ id, accept: true }));
    expect(copiesOf('alex', R2).map(c => c.state)).toEqual(['collected']);
  });

  it('declines, and nothing moves', async () => {
    const { id } = await offer();
    expect(await answerTrade(alex({ id, accept: false }))).toEqual({ status: 'declined' });
    expect(copiesOf('sam', R1).length).toBe(1);
  });

  it('is the recipient\'s alone', async () => {
    const { id } = await offer();
    await expect(answerTrade(sam({ id, accept: true }))).rejects.toThrow(/not for you/);
    await expect(answerTrade(jo({ id, accept: true }))).rejects.toThrow(/not for you/);
  });

  // Review Focus: a double tap.
  it('cannot be accepted twice', async () => {
    hold('sam', R1);
    hold('alex', R2);
    const { id } = await offer();
    await answerTrade(alex({ id, accept: true }));
    await expect(answerTrade(alex({ id, accept: true }))).rejects.toThrow(/no longer open/);
    expect([count('sam', R1), count('alex', R1)]).toEqual([1, 1]);
  });

  // Review Focus: one card of several has gone.
  it('moves nothing when a card has gone, and says why', async () => {
    const extra = hold('sam', R3);
    hold('alex', R4);
    const { id } = await offer({ give: [R1, R3], get: [R2, R4] });
    docs.delete(`users/sam/copies/${extra}`);
    const out = await answerTrade(alex({ id, accept: true }));
    expect(out).toMatchObject({ status: 'failed', why: expect.stringMatching(/no longer/) });
    expect(trade(id)).toMatchObject({ status: 'failed', failedWhy: out.why });
    expect(copiesOf('sam', R1).length).toBe(1);
    expect(copiesOf('alex', R2).length).toBe(1);
    expect(copiesOf('alex', R1)).toEqual([]);
  });

  it('fails when a card was listed after the offer', async () => {
    const { id } = await offer();
    const [path] = [...docs.entries()].find(([k, v]) => k.startsWith('users/sam/copies/') && v.cardKey === R1);
    docs.get(path).state = 'listed';
    expect((await answerTrade(alex({ id, accept: true }))).status).toBe('failed');
  });

  // Live rarities move overnight: the value rule runs again at accept.
  it('fails when the values no longer fit', async () => {
    const { id } = await offer();
    trade(id).get = [S1];
    hold('alex', S1);
    const out = await answerTrade(alex({ id, accept: true }));
    expect(out).toMatchObject({ status: 'failed', why: expect.stringMatching(/uneven/) });
  });

  it('fails between players who are no longer friends', async () => {
    const { id } = await offer();
    await removeFriend(sam({ uid: 'alex' }));
    expect((await answerTrade(alex({ id, accept: true }))).status).toBe('failed');
  });

  it('refuses an expired offer', async () => {
    const { id } = await offer();
    trade(id).expiresAt = Date.now() - 1;
    await expect(answerTrade(alex({ id, accept: true }))).rejects.toThrow(/no longer open/);
  });
});

describe('cancelling an offer', () => {
  it('is the sender\'s, while it is open', async () => {
    const { id } = await offer();
    await expect(cancelTrade(alex({ id }))).rejects.toThrow(/not yours/);
    expect(await cancelTrade(sam({ id }))).toEqual({ status: 'cancelled' });
    await expect(cancelTrade(sam({ id }))).rejects.toThrow(/no longer open/);
  });
});

describe('a counter', () => {
  const counter = (id, data = {}) => sendTrade(alex({ friendUid: 'sam', give: [R2], get: [R1], counterOf: id, ...data }));

  it('closes the offer it answers and goes back with fresh days', async () => {
    const { id } = await offer();
    trade(id).expiresAt = Date.now() + 1000;
    const out = await counter(id);
    expect(trade(id).status).toBe('countered');
    expect(trade(out.id)).toMatchObject({ from: 'alex', to: 'sam', counterOf: id, status: 'open' });
    expect(trade(out.id).expiresAt - trade(out.id).createdAt).toBe(3 * DAY);
  });

  it('goes back and forth', async () => {
    const { id } = await offer();
    const a = await counter(id);
    const b = await sendTrade(sam({ friendUid: 'alex', give: [R1], get: [R2], counterOf: a.id }));
    expect(await answerTrade(alex({ id: b.id, accept: true }))).toEqual({ status: 'accepted' });
  });

  it('meets the same rules as an offer', async () => {
    const { id } = await offer();
    hold('sam', S1);
    await expect(counter(id, { get: [S1] })).rejects.toThrow(/uneven/);
    expect(trade(id).status).toBe('open');
  });

  it('does not count against the five', async () => {
    docs.set('friends/jo', { uids: ['alex'], names: {} });
    docs.get('friends/alex').uids.push('jo');
    hold('jo', R3);
    for (let i = 0; i < 5; i += 1) await sendTrade(alex({ friendUid: 'jo', give: [R2], get: [R3] }));
    const { id } = await offer();
    await expect(counter(id)).resolves.toBeDefined();
  });

  // Review Focus: a counter that should not stand.
  it('refuses an offer that is not for you, or has gone', async () => {
    const { id } = await offer();
    await expect(sendTrade(sam({ friendUid: 'alex', give: [R1], get: [R2], counterOf: id }))).rejects.toThrow(/no longer open/);
    trade(id).expiresAt = Date.now() - 1;
    await expect(counter(id)).rejects.toThrow(/no longer open/);
    expect(trade(id).status).toBe('open');
  });
});

describe('your trades', () => {
  it('lists offers for you and from you, with the other player\'s name', async () => {
    const { id } = await offer();
    const mine = await myTrades(sam());
    const theirs = await myTrades(alex());
    expect(mine.outgoing.map(t => t.id)).toEqual([id]);
    expect(mine.outgoing[0].name).toBe('Alex Example');
    expect(theirs.incoming[0]).toMatchObject({ id, from: 'sam', name: 'Sam Example', give: [R1], get: [R2], counter: false });
    expect(theirs.outgoing).toEqual([]);
  });

  it('marks a counter', async () => {
    const { id } = await offer();
    await sendTrade(alex({ friendUid: 'sam', give: [R2], get: [R1], counterOf: id }));
    expect((await myTrades(sam())).incoming[0].counter).toBe(true);
  });

  it('moves a finished offer to recent, an expired one too', async () => {
    const a = await offer();
    await answerTrade(alex({ id: a.id, accept: false }));
    hold('alex', R2);
    const b = await offer();
    trade(b.id).expiresAt = Date.now() - 1;
    const out = await myTrades(sam());
    expect(out.outgoing).toEqual([]);
    expect(out.recent.map(t => t.status).sort()).toEqual(['declined', 'expired']);
  });
});

// Review Focus: the week starts over.
describe('the week', () => {
  it('starts when a friendship does, and over when it is made again', async () => {
    await removeFriend(sam({ uid: 'alex' }));
    expect(docs.get('friends/sam').since?.alex).toBeUndefined();
    const { code } = await myFriends(alex());
    await requestFriend(sam({ code }));
    await answerFriendRequest(alex({ id: 'sam_alex', accept: true }));
    expect(docs.get('friends/sam').since.alex).toBeGreaterThan(Date.now() - 1000);
    expect(docs.get('friends/alex').since.sam).toBeGreaterThan(Date.now() - 1000);
    await expect(offer()).rejects.toThrow(/week/);
  });
});
