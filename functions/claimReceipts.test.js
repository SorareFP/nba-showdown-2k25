// THE CLAIM CALLABLES, RUN FOR REAL against an in-memory Firestore (2026-09-18).
//
// The farm investigation found a finished game re-claimed on every reload: the
// save stayed until Play Again, the results screen mounted again, and the
// server kept no per-game receipt. These run the actual claimGameReward and
// claimSeasonReward from index.js — the Admin SDK and firebase-functions
// stubbed, the shared game modules pointed at src/ so a stale functions/shared
// cannot make this pass or fail — and check what they write.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── A Firestore small enough to read ────────────────────────────────────────
const docs = new Map();
const INC = Symbol('increment');
const TS = Symbol('serverTimestamp');
const DEL = Symbol('delete');
function apply(prev, data) {
  const out = { ...(prev ?? {}) };
  for (const [k, v] of Object.entries(data)) {
    if (v && v[INC] !== undefined) out[k] = (Number(out[k]) || 0) + v[INC];
    else if (v === TS) out[k] = Date.now();
    else if (v === DEL) delete out[k];
    else out[k] = v;
  }
  return out;
}
const snap = path => ({ exists: docs.has(path), id: path.split('/').pop(), data: () => docs.get(path), ref: ref(path) });
function ref(path) {
  return { path, get: async () => snap(path) };
}
let autoId = 0;
const db = {
  doc: path => ref(path),
  collection: path => ({
    doc: id => ref(`${path}/${id ?? `auto${autoId += 1}`}`),
    get: async () => ({ docs: [...docs.keys()].filter(k => k.startsWith(`${path}/`)).map(snap) }),
  }),
  async runTransaction(fn) {
    const writes = [];
    const tx = {
      get: async r => snap(r.path),
      set: (r, data, opts) => writes.push(() => docs.set(r.path, opts?.merge ? apply(docs.get(r.path), data) : apply(null, data))),
      update: (r, data) => writes.push(() => docs.set(r.path, apply(docs.get(r.path), data))),
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
  FieldValue: { increment: n => ({ [INC]: n }), serverTimestamp: () => TS, delete: () => DEL },
}));
// The shared modules, from src/ — what prepare.mjs would copy.
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

const { claimGameReward, claimSeasonReward } = await import('./index.js');
const { REWARD, DAILY_MILESTONE_CAP } = await import('../src/game/coinRewards.js');
const { SEASON_REWARDS } = await import('../src/game/modes/prizes.js');

const UID = 'u1';
const call = (fn, data) => fn({ auth: { uid: UID }, data });
const coins = () => docs.get(`users/${UID}`).currency;

beforeEach(() => {
  docs.clear();
  // Already won today, milestone cap spent: the next game's plain price.
  docs.set(`users/${UID}`, { currency: 0, dailyMilestoneDate: new Date().toISOString().split('T')[0], dailyMilestoneCoins: DAILY_MILESTONE_CAP, dailyFirstWin: true });
});

describe('claimGameReward', () => {
  const win = { won: true, margin: 20, milestoneIds: [], aiLevel: 'prince', rungDraw: true };

  it('pays a game once, however many times the same id is claimed, and answers the repeat', async () => {
    const first = await call(claimGameReward, { ...win, gameId: 'game:abc' });
    expect(first.coins).toBeGreaterThan(0);
    expect(coins()).toBe(first.coins);
    // The reload: the results screen mounts again and claims again.
    docs.get(`users/${UID}`).gameWindow = { at: 0, n: 0 };   // not the rate limit's refusal
    const again = await call(claimGameReward, { ...win, gameId: 'game:abc' });
    expect(again).toMatchObject({ already: true, coins: first.coins });
    expect(coins()).toBe(first.coins);
    const receipt = docs.get(`users/${UID}/gameReceipts/game:abc`);
    expect(receipt).toMatchObject({ game: 'game:abc', coins: first.coins });
    expect(receipt.expireAt).toBeInstanceOf(Date);
  });

  // The client reads the whole `claims` collection on every Home and
  // Collection load (collection.js loadClaims), so a game's receipt must not
  // land there — one read per game ever played (2026-09-18).
  it('keeps game receipts out of `claims`, which Home reads whole', async () => {
    await call(claimGameReward, { ...win, gameId: 'game:home' });
    expect([...docs.keys()].filter(k => k.includes('/claims/'))).toEqual([]);
    expect(docs.has(`users/${UID}/gameReceipts/game:home`)).toBe(true);
  });

  it('keys each game on its own receipt: two games pay twice, their repeats pay nothing', async () => {
    const a = await call(claimGameReward, { ...win, gameId: 'game:a' });
    docs.get(`users/${UID}`).gameWindow = { at: 0, n: 0 };
    const b = await call(claimGameReward, { ...win, gameId: 'game:b' });
    expect(coins()).toBe(a.coins + b.coins);
    docs.get(`users/${UID}`).gameWindow = { at: 0, n: 0 };
    expect(await call(claimGameReward, { ...win, gameId: 'game:a' })).toMatchObject({ already: true, coins: a.coins });
    expect(await call(claimGameReward, { ...win, gameId: 'game:b' })).toMatchObject({ already: true, coins: b.coins });
    expect(coins()).toBe(a.coins + b.coins);
  });

  it('writes no receipt under a key that would be a path — and one under a well-formed key', async () => {
    const bad = await call(claimGameReward, { ...win, gameId: 'x/../y' });
    expect(bad.coins).toBeGreaterThan(0);
    expect([...docs.keys()].filter(k => k.includes('/gameReceipts/'))).toEqual([]);
    docs.get(`users/${UID}`).gameWindow = { at: 0, n: 0 };
    await call(claimGameReward, { ...win, gameId: 'game:ok' });
    expect([...docs.keys()].filter(k => k.includes('/gameReceipts/'))).toEqual([`users/${UID}/gameReceipts/game:ok`]);
  });

  it('prices a Deity win against a team the coach did not draw at the fair rate — and an old client too', async () => {
    const prince = await call(claimGameReward, { ...win, gameId: 'game:p' });
    docs.get(`users/${UID}`).gameWindow = { at: 0, n: 0 };
    const custom = await call(claimGameReward, { ...win, aiLevel: 'deity', rungDraw: false, gameId: 'game:c' });
    expect(custom.coins).toBe(prince.coins);
    docs.get(`users/${UID}`).gameWindow = { at: 0, n: 0 };
    const { rungDraw, ...old } = win;
    void rungDraw;
    const legacy = await call(claimGameReward, { ...old, aiLevel: 'deity', gameId: 'game:o' });
    expect(legacy.coins).toBe(prince.coins);
    docs.get(`users/${UID}`).gameWindow = { at: 0, n: 0 };
    const drawn = await call(claimGameReward, { ...win, aiLevel: 'deity', gameId: 'game:d' });
    expect(drawn.coins).toBe(Math.round(prince.coins * 1.5));
  });

  it('pays a Deity loss the fair rate', async () => {
    const r = await call(claimGameReward, { won: false, margin: -40, milestoneIds: [], aiLevel: 'deity', rungDraw: true, gameId: 'game:l' });
    expect(r.coins).toBe(REWARD.complete);
  });

  it('counts a verified season fixture as drawn at the season\'s rung, floored by it', async () => {
    docs.set(`users/${UID}/seasons/s1`, { aiLevel: 'deity', phase: 'regular', teams: [] });
    const prince = await call(claimGameReward, { ...win, gameId: 'game:p' });
    docs.get(`users/${UID}`).gameWindow = { at: 0, n: 0 };
    // The client says rungDraw false for a fixture; the server knows the league drew it.
    const inDeity = await call(claimGameReward, { ...win, aiLevel: 'deity', rungDraw: false, seasonId: 's1', gameId: 'fixture:s1:r1m1' });
    expect(inDeity.coins).toBe(Math.round(prince.coins * 1.5));
    // A season that records no rung was drawn at the plain cap: Prince's.
    docs.set(`users/${UID}/seasons/s0`, { phase: 'regular', teams: [] });
    docs.get(`users/${UID}`).gameWindow = { at: 0, n: 0 };
    const old = await call(claimGameReward, { ...win, aiLevel: 'deity', seasonId: 's0', gameId: 'fixture:s0:r1m1' });
    expect(old.coins).toBe(prince.coins);
  });

  // The claim GameOver actually sends for a plain season's fixture since
  // 2026-09-18 (PlayTab fixtureFrom — before, a plain season sent no seasonId
  // and every one of these paid 1x): the fixture key, the season's ids, the
  // rung it was dealt at, rungDraw false as a fixture always says.
  const fixtureClaim = (seasonId, aiLevel) => ({
    ...win, aiLevel, rungDraw: false, gameId: `fixture:${seasonId}:r1m1`,
    dynastyId: null, leagueId: null, seasonId,
  });

  it('floors a Settler-built season played with the dial at Deity to Settler\'s pay', async () => {
    docs.set(`users/${UID}/seasons/s5`, { aiLevel: 'settler', phase: 'regular', teams: [] });
    const prince = await call(claimGameReward, { ...win, gameId: 'game:p' });
    docs.get(`users/${UID}`).gameWindow = { at: 0, n: 0 };
    const r = await call(claimGameReward, fixtureClaim('s5', 'deity'));
    expect(r.coins).toBe(Math.round(prince.coins * 0.5));
  });

  it('pays a Deity-built season\'s win the Deity rate from the claim the client sends', async () => {
    docs.set(`users/${UID}/seasons/s6`, { aiLevel: 'deity', phase: 'regular', teams: [] });
    const prince = await call(claimGameReward, { ...win, gameId: 'game:p' });
    docs.get(`users/${UID}`).gameWindow = { at: 0, n: 0 };
    const r = await call(claimGameReward, fixtureClaim('s6', 'deity'));
    expect(r.coins).toBe(Math.round(prince.coins * 1.5));
    expect(r.breakdown.some(l => /only when the coach draws/.test(l.label))).toBe(false);
  });

  it('does not verify a season named under another game\'s key', async () => {
    docs.set(`users/${UID}/seasons/s7`, { aiLevel: 'deity', phase: 'regular', teams: [] });
    const prince = await call(claimGameReward, { ...win, gameId: 'game:p' });
    docs.get(`users/${UID}`).gameWindow = { at: 0, n: 0 };
    // A sandbox game borrowing a Deity season's id to be priced as drawn at the rung.
    const r = await call(claimGameReward, { ...fixtureClaim('s7', 'deity'), gameId: 'game:borrowed' });
    expect(r.coins).toBe(prince.coins);
  });
});

describe('claimSeasonReward', () => {
  const r = (home, away, simulated = false) => ({ home, away, homeScore: 100, awayScore: 90, ...(simulated ? { simulated: true } : {}) });

  it('pays a champion who simmed half of their own games half the purse', async () => {
    docs.set(`users/${UID}/seasons/s2`, {
      phase: 'done', length: 'quick', champion: 'you', teams: [{ id: 'you', human: true }, { id: 'a' }],
      results: [r('you', 'a'), r('a', 'you', true), r('you', 'a'), r('a', 'you', true), r('a', 'a2', true)],
    });
    const res = await call(claimSeasonReward, { seasonId: 's2' });
    expect(res.coins).toBe(SEASON_REWARDS.quick.champion / 2);
    expect(res.label).toBe('Season Champion · 2 of 4 games played');
    expect(coins()).toBe(SEASON_REWARDS.quick.champion / 2);
  });

  it('refuses a season with every own game simmed, and says why', async () => {
    docs.set(`users/${UID}/seasons/s3`, {
      phase: 'done', length: 'quick', champion: 'you', teams: [{ id: 'you', human: true }],
      results: [r('you', 'a', true), r('a', 'you', true)],
    });
    await expect(call(claimSeasonReward, { seasonId: 's3' })).rejects.toThrow(/simmed/);
    expect(coins()).toBe(0);
  });
});
