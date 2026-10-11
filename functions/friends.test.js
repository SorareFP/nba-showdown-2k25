// FRIENDS (2026-10-11): the callables, RUN FOR REAL against an in-memory
// Firestore (the claimReceipts.test.js harness, with queries and deletes).
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
const snap = path => ({ exists: docs.has(path), id: path.split('/').pop(), data: () => docs.get(path) });
const ref = path => ({
  path, id: path.split('/').pop(), get: async () => snap(path),
  set: async (data, opts) => { docs.set(path, opts?.merge ? apply(docs.get(path), data) : apply(null, data)); },
});
const coll = (path, filters = []) => ({
  doc: id => ref(`${path}/${id}`),
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
      get: async r => snap(r.path),
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

const { myFriends, requestFriend, answerFriendRequest, removeFriend } = await import('./index.js');
const { GOALS } = await import('../src/game/collections.js');

const as = (uid, name) => (data = {}) => ({ auth: { uid, token: { name } }, data });
const sam = as('sam', 'Sam Example');
const alex = as('alex', 'Alex Example');
const jo = as('jo', 'Jo Example');

beforeEach(() => { docs.clear(); for (const k of Object.keys(rooms)) delete rooms[k]; });

describe('friend codes and requests', () => {
  it('gives each player one code for good', async () => {
    const first = await myFriends(sam());
    expect(first.code).toMatch(/^[A-Z2-9]{6}$/);
    expect((await myFriends(sam())).code).toBe(first.code);
    expect(docs.get(`friendCodes/${first.code}`)).toEqual({ uid: 'sam' });
  });

  it('sends a request by code without telling the sender who it reached', async () => {
    const { code } = await myFriends(alex());
    const r = await requestFriend(sam({ code: code.toLowerCase() }));
    expect(r).toEqual({ sent: true });
    const theirs = await myFriends(alex());
    expect(theirs.incoming).toEqual([{ id: 'sam_alex', from: 'sam', name: 'Sam Example', via: 'code' }]);
    const mine = await myFriends(sam());
    expect(mine.outgoing).toEqual([{ id: 'sam_alex', to: 'alex', label: `code ${code}` }]);
    expect(JSON.stringify(mine)).not.toContain('Alex Example');
  });

  it('refuses a bad code, an unknown code, your own code and a second request', async () => {
    const { code } = await myFriends(alex());
    await expect(requestFriend(sam({ code: 'nope' }))).rejects.toThrow(/not a friend code/);
    await expect(requestFriend(sam({ code: 'ZZZZZZ' }))).rejects.toThrow(/No player has that code/);
    await expect(requestFriend(alex({ code }))).rejects.toThrow(/your own code/);
    await requestFriend(sam({ code }));
    await expect(requestFriend(sam({ code }))).rejects.toThrow(/already sent/);
  });

  it('turns a request back to someone who asked you first into a friendship', async () => {
    const { code: alexCode } = await myFriends(alex());
    const { code: samCode } = await myFriends(sam());
    await requestFriend(sam({ code: alexCode }));
    expect(await requestFriend(alex({ code: samCode }))).toEqual({ friends: true });
    expect(docs.has('friendRequests/sam_alex')).toBe(false);
    expect((await myFriends(sam())).friends.map(f => f.name)).toEqual(['Alex Example']);
  });

  it('accepts and declines only the recipient\'s own requests', async () => {
    const { code } = await myFriends(alex());
    await requestFriend(sam({ code }));
    await expect(answerFriendRequest(jo({ id: 'sam_alex', accept: true }))).rejects.toThrow(/Not your request/);
    expect(await answerFriendRequest(alex({ id: 'sam_alex', accept: true }))).toEqual({ friends: true, name: 'Sam Example' });
    expect((await myFriends(alex())).friends.map(f => f.uid)).toEqual(['sam']);
    const { code: joCode } = await myFriends(jo());
    await requestFriend(sam({ code: joCode }));
    expect(await answerFriendRequest(jo({ id: 'sam_jo', accept: false }))).toEqual({ declined: true });
    expect((await myFriends(sam())).friends.map(f => f.uid)).toEqual(['alex']);
  });

  it('stops at thirty friends', async () => {
    docs.set('friends/sam', { code: 'AAAAAA', uids: Array.from({ length: 30 }, (_, i) => `f${i}`), names: {} });
    const { code } = await myFriends(alex());
    await expect(requestFriend(sam({ code }))).rejects.toThrow(/30 friends/);
  });
});

describe('what a friend can see', () => {
  const befriend = async () => {
    const { code } = await myFriends(alex());
    await requestFriend(sam({ code }));
    await answerFriendRequest(alex({ id: 'sam_alex', accept: true }));
  };

  it('returns a friend\'s needs, cleaned, and nothing for a stranger', async () => {
    const g = GOALS.find(x => x.kind === 'team');
    const good = { cardKey: g.requires[0], goalId: g.id, goalLabel: 'Atlanta Hawks collection', missing: 1 };
    docs.set('profiles/alex', { needs: [good, { cardKey: 'Nobody_Real', goalId: g.id, missing: 1 }, 'junk'] });
    docs.set('profiles/jo', { needs: [good] });
    await befriend();
    const mine = await myFriends(sam());
    expect(mine.friends).toEqual([{ uid: 'alex', name: 'Alex Example', needs: [good] }]);
  });

  it('removes a friendship from both sides at once', async () => {
    await befriend();
    expect(await removeFriend(sam({ uid: 'alex' }))).toEqual({ removed: true });
    expect((await myFriends(sam())).friends).toEqual([]);
    expect((await myFriends(alex())).friends).toEqual([]);
    expect(docs.get('friends/alex').names).toEqual({});
  });

  it('lets you request someone you have played without a code, and nobody else', async () => {
    docs.set('users/sam/playedWith/alex', { label: 'Bench Mob (Fall League)', via: 'league' });
    docs.set('users/alex/playedWith/sam', { label: 'Glass Cleaners (Fall League)', via: 'league' });
    expect((await myFriends(sam())).playedWith).toEqual([{ uid: 'alex', label: 'Bench Mob (Fall League)', via: 'league' }]);
    expect(await requestFriend(sam({ uid: 'alex' }))).toEqual({ sent: true });
    expect((await myFriends(sam())).outgoing).toEqual([{ id: 'sam_alex', to: 'alex', label: 'Bench Mob (Fall League)' }]);
    await expect(requestFriend(sam({ uid: 'jo' }))).rejects.toThrow(/friend code/);
    expect((await myFriends(alex())).incoming).toEqual([{ id: 'sam_alex', from: 'sam', name: 'Sam Example', via: 'league' }]);
  });

  // A FORGED GAME (final review, 2026-10-11): anyone can write a PvP room that
  // names any seller and claim it, which records them on ONE side only. The
  // one-tap request needs both sides to have played, as a real game leaves.
  it('refuses a one-tap request when only the asker has the other on record', async () => {
    docs.set('users/sam/playedWith/alex', { label: 'Alex Example', via: 'pvp' });
    await expect(requestFriend(sam({ uid: 'alex' }))).rejects.toThrow(/friend code/);
    expect(docs.has('friendRequests/sam_alex')).toBe(false);
  });
});
describe('who you have played', () => {
  it('records a PvP opponent when the game is claimed, by the name the room showed', async () => {
    const { claimGameReward } = await import('./index.js');
    docs.set('users/sam', { currency: 0, dailyMilestoneDate: new Date().toISOString().split('T')[0], dailyMilestoneCoins: 1e9, dailyFirstWin: true });
    rooms['rooms/ROOM1/meta'] = { hostUid: 'sam', guestUid: 'alex', hostName: 'Sam Example', guestName: 'Alex Example' };
    await claimGameReward(sam({ won: true, margin: 5, milestoneIds: [], pvp: true, gameId: 'pvp:ROOM1:123' }));
    expect(docs.get('users/sam/playedWith/alex')).toMatchObject({ label: 'Alex Example', via: 'pvp' });
  });

  it('records every human coach in a started league as played, by team name and league', async () => {
    const { startLeague } = await import('./index.js');
    const L = await import('../src/game/modes/league.js');
    const { CARDS } = await import('../src/game/cards.js');
    const { cardKey } = await import('../src/game/cardSets.js');
    const roster = CARDS.slice(0, 10).map(cardKey);
    const coaches = [['sam', 'Bench Mob'], ['alex', 'Glass Cleaners'], ['jo', 'Pick and Roll'], ['kim', 'Zone Busters']];
    let league = L.newLeague({ id: 'tour-1', kind: 'tournament', name: 'Fall Cup', hostUid: 'sam', settings: { size: 4, fee: 0 }, entrant: L.entrantFor('sam', { name: 'Bench Mob', roster }), joinCode: 'JOIN01', now: Date.now() });
    for (const [uid, name] of coaches.slice(1)) league = L.addEntrant(league, L.entrantFor(uid, { name, roster }), Date.now());
    docs.set('leagues/tour-1', league);
    await startLeague(sam({ leagueId: 'tour-1' }));
    expect(docs.get('users/sam/playedWith/alex')).toMatchObject({ label: 'Glass Cleaners (Fall Cup)', via: 'league' });
    expect(docs.get('users/alex/playedWith/sam')).toMatchObject({ label: 'Bench Mob (Fall Cup)', via: 'league' });
    expect(docs.has('users/sam/playedWith/sam')).toBe(false);
    expect([...docs.keys()].filter(k => /^users\/[a-z]+\/playedWith\//.test(k))).toHaveLength(12);
  });

  it('records nothing for a room the claimer was not in, or a game that is not PvP', async () => {
    const { claimGameReward } = await import('./index.js');
    docs.set('users/jo', { currency: 0, dailyMilestoneDate: new Date().toISOString().split('T')[0], dailyMilestoneCoins: 1e9, dailyFirstWin: true });
    rooms['rooms/ROOM2/meta'] = { hostUid: 'sam', guestUid: 'alex', hostName: 'Sam Example', guestName: 'Alex Example' };
    await claimGameReward(jo({ won: true, margin: 5, milestoneIds: [], pvp: true, gameId: 'pvp:ROOM2:9' }));
    await claimGameReward(jo({ won: true, margin: 5, milestoneIds: [], gameId: 'game:x' }));
    expect([...docs.keys()].some(k => k.startsWith('users/jo/playedWith/'))).toBe(false);
  });
});
