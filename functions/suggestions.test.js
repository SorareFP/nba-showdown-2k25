// The suggestion box's callables, RUN FOR REAL against an in-memory Firestore
// (the rarityShift.test.js harness, with `where` and `limit` added).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const docs = new Map();
const TS = Symbol('serverTimestamp');
let clock = Date.parse('2026-10-01T12:00:00Z');
const stamp = () => { const at = clock; return { toMillis: () => at }; };
function apply(prev, data) {
  const out = { ...(prev ?? {}) };
  for (const [k, v] of Object.entries(data)) out[k] = v === TS ? stamp() : v;
  return out;
}
const snap = path => ({ exists: docs.has(path), id: path.split('/').pop(), data: () => docs.get(path) });
const ref = path => ({
  path,
  id: path.split('/').pop(),
  get: async () => snap(path),
  set: async (data, opts) => { docs.set(path, opts?.merge ? apply(docs.get(path), data) : apply(null, data)); },
});
let auto = 0;
const coll = (path, filters = [], cap = Infinity) => ({
  doc: id => ref(`${path}/${id ?? `auto${auto += 1}`}`),
  where: (field, op, value) => coll(path, [...filters, d => d?.[field] === value], cap),
  limit: n => coll(path, filters, n),
  get: async () => ({
    docs: [...docs.keys()]
      .filter(k => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'))
      .map(snap)
      .filter(s => filters.every(f => f(s.data())))
      .slice(0, cap),
  }),
});
const db = { doc: path => ref(path), collection: path => coll(path), runTransaction: async fn => fn({}) };

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts, handler) => handler,
  HttpsError: class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } },
}));
vi.mock('firebase-admin/app', () => ({ initializeApp: () => {} }));
vi.mock('firebase-admin/database', () => ({ getDatabase: () => ({}) }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => db,
  FieldValue: { increment: n => n, serverTimestamp: () => TS, delete: () => ({}) },
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


const { submitSuggestion, mySuggestions, listSuggestions, answerSuggestion, setSuggestionTrust } = await import('./index.js');

const as = (uid, email = `${uid}@example.com`) => data => ({ auth: { uid, token: { email, name: uid } }, data: data ?? {} });
const player = as('p1');
const admin = as('a1', 'hoopsonhoops@gmail.com');

const setClock = ms => { clock = ms; vi.setSystemTime(new Date(ms)); };
beforeEach(() => { docs.clear(); vi.useFakeTimers(); setClock(Date.parse('2026-10-01T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('the suggestion box', () => {
  it("takes a signed-in player's suggestion and nobody else's", async () => {
    const r = await submitSuggestion(player({ kind: 'idea', text: '  More Dantley cards ', screen: 'home' }));
    expect(docs.get(`suggestions/${r.id}`)).toMatchObject({ uid: 'p1', kind: 'idea', text: 'More Dantley cards', screen: 'home', status: 'new' });
    await expect(submitSuggestion({ data: { kind: 'idea', text: 'x' } })).rejects.toThrow(/Sign in/);
    await expect(submitSuggestion(player({ kind: 'idea', text: '' }))).rejects.toThrow(/Write/);
  });

  it('stops at ten a day', async () => {
    for (let i = 0; i < 10; i += 1) await submitSuggestion(player({ kind: 'bug', text: `bug ${i}` }));
    await expect(submitSuggestion(player({ kind: 'bug', text: 'one more' }))).rejects.toThrow(/10 today/);
    setClock(clock + 25 * 60 * 60 * 1000);
    await expect(submitSuggestion(player({ kind: 'bug', text: 'tomorrow' }))).resolves.toHaveProperty('id');
  });

  it('shows a player what became of theirs only once they are trusted', async () => {
    const { id } = await submitSuggestion(player({ kind: 'card', text: 'A Bernard King card' }));
    expect(await mySuggestions(player())).toEqual({ trusted: false, items: [] });
    await answerSuggestion(admin({ id, status: 'done', outcome: 'Built on 9/30.' }));
    await setSuggestionTrust(admin({ uid: 'p1', trusted: true }));
    const mine = await mySuggestions(player());
    expect(mine.trusted).toBe(true);
    expect(mine.items[0]).toMatchObject({ id, status: 'done', outcome: 'Built on 9/30.' });
  });

  it('keeps the queue, the answers and the trust switch to admins', async () => {
    const { id } = await submitSuggestion(player({ kind: 'idea', text: 'x' }));
    await expect(listSuggestions(player())).rejects.toThrow(/Admins only/);
    await expect(answerSuggestion(player({ id, status: 'done' }))).rejects.toThrow(/Admins only/);
    await expect(setSuggestionTrust(player({ uid: 'p1', trusted: true }))).rejects.toThrow(/Admins only/);
    await setSuggestionTrust(admin({ uid: 'p1', trusted: true }));
    const queue = await listSuggestions(admin());
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ id, uid: 'p1', email: 'p1@example.com', trusted: true });
    await expect(answerSuggestion(admin({ id, status: 'maybe' }))).rejects.toThrow(/Unknown status/);
    await expect(answerSuggestion(admin({ id: 'nope', status: 'done' }))).rejects.toThrow(/No such/);
  });
});
