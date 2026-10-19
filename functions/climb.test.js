// THE CLIMB'S LEDGER, RUN FOR REAL against an in-memory Firestore
// (docs/plans/2026-10-18-the-climb.md, Task 7). The browser keeps the run;
// the server keeps the ledger: which game is open, which stops were won, and
// the pot it pays once — priced from the map it rebuilds from the run's seed,
// never from the browser's numbers.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── A Firestore small enough to read (functions/claimReceipts.test.js) ──────
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
  return { path, id: path.split('/').pop(), get: async () => snap(path) };
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
      delete: r => writes.push(() => docs.delete(r.path)),
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

const { climbStart, climbGame, climbBank, claimGameReward } = await import('./index.js');
const { generateMap, potOf, stopById, reachableGame, runClaimPreview } = await import('../src/game/modes/climbMap.js');

const UID = 'u1';
const call = (fn, data) => fn({ auth: { uid: UID }, data });
const coins = () => docs.get(`users/${UID}`).currency;
const ledger = runId => docs.get(`users/${UID}/runLedger/${runId}`);
const keyOf = (runId, stopId) => `fixture:climb:${runId}:${stopId}`;
const claim = (runId, stopId, won, more = {}) => {
  docs.get(`users/${UID}`).gameWindow = { at: 0, n: 0 };
  return call(claimGameReward, { won, margin: won ? 8 : -3, milestoneIds: [], aiLevel: 'deity', rungDraw: true, box: [], gameId: keyOf(runId, stopId), runId, ...more });
};
/** A run at a rung, and its map as the server will rebuild it. */
async function started(rung = 'prince') {
  const { runId, seed } = await call(climbStart, { rung });
  return { runId, map: generateMap(seed) };
}
/** Start and win the game at a stop. */
async function winAt(runId, stopId) {
  expect(await call(climbGame, { runId, stopId })).toMatchObject({ ok: true });
  return claim(runId, stopId, true);
}
/** A floor-1 stop, then a Game reached from it through Rest Days only. */
function twoGames(map) {
  for (const a of map.floors[0]) {
    for (const id of a.next) {
      const s = stopById(map, id);
      if (s.kind !== 'rest') return [a.id, s.id];
      for (const id2 of s.next) if (stopById(map, id2).kind !== 'rest') return [a.id, id2];
    }
  }
  throw new Error('no second game');
}

beforeEach(() => {
  docs.clear();
  docs.set(`users/${UID}`, { currency: 100, dailyMilestoneDate: new Date().toISOString().split('T')[0], dailyMilestoneCoins: 0, dailyFirstWin: false });
});

describe('starting a run', () => {
  it('writes a ledger with the server\'s seed and the rung, an unknown rung as Prince', async () => {
    const { runId, seed } = await call(climbStart, { rung: 'king' });
    expect(ledger(runId)).toMatchObject({ seed, rung: 'king', status: 'active', open: null, cleared: [] });
    expect(Number.isInteger(seed)).toBe(true);
    const other = await call(climbStart, { rung: 'grand-emperor' });
    expect(ledger(other.runId).rung).toBe('prince');
  });
});

describe('opening a game', () => {
  it('opens a floor-1 stop, refuses a floor-3 one, and lets the open game resume', async () => {
    const { runId } = await started();
    await expect(call(climbGame, { runId, stopId: '3-0' })).rejects.toThrow(/not open/);
    expect(await call(climbGame, { runId, stopId: '1-1' })).toMatchObject({ ok: true, status: 'active' });
    expect(ledger(runId).open).toBe('1-1');
    expect(await call(climbGame, { runId, stopId: '1-1' })).toMatchObject({ ok: true });
  });

  it('ends the run when another game opens over one that never reported', async () => {
    const { runId } = await started();
    await call(climbGame, { runId, stopId: '1-0' });
    expect(await call(climbGame, { runId, stopId: '1-1' })).toMatchObject({ ok: false, status: 'lost' });
    expect(ledger(runId)).toMatchObject({ status: 'lost', open: null });
  });
});

describe('a run game\'s claim', () => {
  // A QUARTER OF A GAME (2026-10-19: "it shouldn't be all-or-nothing"), at
  // the LEDGER's rung: the claim says Deity, the run is Prince.
  it('clears the stop on a win and pays a quarter of a game at the run\'s rung, once', async () => {
    const { runId, map } = await started();
    await call(climbGame, { runId, stopId: '1-0' });
    const res = await claim(runId, '1-0', true);
    const due = runClaimPreview(stopById(map, '1-0'), 'prince', true, 8).coins;
    expect(due).toBeGreaterThan(0);
    expect(res.coins).toBe(due);
    expect(res.run).toMatchObject({ status: 'active' });
    expect(coins()).toBe(100 + due);
    expect(ledger(runId)).toMatchObject({ cleared: ['1-0'], open: null, status: 'active' });
    expect(docs.get(`users/${UID}/gameReceipts/${keyOf(runId, '1-0')}`)).toMatchObject({ coins: due });
    expect(await claim(runId, '1-0', true)).toMatchObject({ already: true, coins: due });
    expect(coins()).toBe(100 + due);
    expect(ledger(runId).cleared).toEqual(['1-0']);
    expect(docs.get(`users/${UID}`).dailyFirstWin).toBe(false);
  });

  it('ends the run on a loss, and on a tie', async () => {
    for (const margin of [-3, 0]) {
      const { runId } = await started();
      await call(climbGame, { runId, stopId: '1-0' });
      expect((await claim(runId, '1-0', false, { margin })).run.status).toBe('lost');
      expect(ledger(runId).status).toBe('lost');
    }
  });

  it('changes nothing for a stop that is not open, or a run that is over', async () => {
    const { runId } = await started();
    await call(climbGame, { runId, stopId: '1-0' });
    expect(await claim(runId, '1-2', true)).toMatchObject({ coins: 0, run: { status: 'active' } });
    expect(ledger(runId)).toMatchObject({ open: '1-0', cleared: [] });
    expect(docs.has(`users/${UID}/gameReceipts/${keyOf(runId, '1-2')}`)).toBe(false);
    await claim(runId, '1-0', false);
    expect(await claim(runId, '1-1', true)).toMatchObject({ coins: 0, run: { status: 'lost' } });
    expect(ledger(runId)).toMatchObject({ status: 'lost', cleared: [] });
  });

  it('writes lifetime stats for owned cards only', async () => {
    docs.set(`users/${UID}/collection/LeBron_James`, { count: 1 });
    const { runId } = await started();
    await call(climbGame, { runId, stopId: '1-0' });
    const row = { pts: 10, reb: 2, ast: 3, min: 12, tpm: 1, tpa: 3 };
    await claim(runId, '1-0', true, { box: [{ key: 'LeBron_James', ...row }, { key: 'Stephen_Curry', ...row }] });
    expect(docs.get(`users/${UID}/cardStats/LeBron_James`)).toMatchObject({ games: 1, wins: 1, pts: 10 });
    expect(docs.has(`users/${UID}/cardStats/Stephen_Curry`)).toBe(false);
  });
});

describe('banking the pot', () => {
  it('pays the server\'s pot for the stops won, once, whatever the browser says', async () => {
    const { runId, map } = await started('king');
    const [a, b] = twoGames(map);
    await winAt(runId, a);
    await winAt(runId, b);
    const pot = potOf(map, [a, b], 'king');
    expect(pot.coins).toBeGreaterThan(0);
    const before = coins();   // the two games paid their quarters already
    const res = await call(climbBank, { runId, pot: 99999, coins: 99999 });
    expect(res).toMatchObject({ coins: pot.coins, booster: false });
    expect(coins()).toBe(before + pot.coins);
    expect(ledger(runId)).toMatchObject({ status: 'banked' });
    expect(await call(climbBank, { runId })).toMatchObject({ already: true, coins: pot.coins });
    expect(coins()).toBe(before + pot.coins);
  });

  it('adds a one-pack Booster box for the boss', async () => {
    const { runId, map } = await started();
    // Straight to the boss's ledger state: the claims above already prove the path.
    docs.set(`users/${UID}/runLedger/${runId}`, { ...ledger(runId), cleared: ['1-0', 'boss'], status: 'won' });
    const res = await call(climbBank, { runId });
    expect(res).toMatchObject({ coins: potOf(map, ['1-0', 'boss'], 'prince').coins, booster: true });
    const boxes = [...docs.entries()].filter(([k]) => k.startsWith(`users/${UID}/boxes/`)).map(([, v]) => v);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ packType: 'booster', left: 1, bonusLeft: 0, boughtAs: 'climb' });
  });

  // NOT A FORFEIT (2026-10-18). The boss game's claim goes out from its
  // results screen; a bank that overtook it would have found the game open
  // and ended the run. Refusing is as safe against "start a game, bank before
  // it ends" (an unreported game never lets the pot bank) and cannot lose a
  // won run to a slow claim.
  it('refuses while a game is still open, and pays once it reports', async () => {
    const { runId } = await started();
    await winAt(runId, '1-0');
    const map = generateMap(ledger(runId).seed);
    const b = map.floors.flat().find(s => reachableGame(map, '1-0', s.id)).id;
    expect(await call(climbGame, { runId, stopId: b })).toMatchObject({ ok: true });
    const before = coins();
    await expect(call(climbBank, { runId })).rejects.toThrow(/still open/);
    expect(ledger(runId)).toMatchObject({ status: 'active', open: b });
    expect(coins()).toBe(before);
    await claim(runId, b, true);
    expect((await call(climbBank, { runId })).coins).toBe(potOf(map, ['1-0', b], 'prince').coins);
  });

  it('refuses a lost run', async () => {
    const { runId } = await started();
    await call(climbGame, { runId, stopId: '1-0' });
    await claim(runId, '1-0', false);
    expect(coins()).toBe(100 + runClaimPreview({ kind: 'game', floor: 1 }, 'prince', false, -3).coins);   // the quarter, lost or not
    const before = coins();
    await expect(call(climbBank, { runId })).rejects.toThrow(/lost/);
    expect(coins()).toBe(before);
  });
});

// RECONCILING (final review, 2026-10-18): a run whose game was claimed but
// never recorded in the browser (the tab closed, another device) asks to open
// that stop again. The answer says it was won, so the browser can catch up
// instead of hitting "That stop is not open" or a dead end after the boss.
describe('a stop the ledger already cleared', () => {
  it('answers as cleared, without ending the run', async () => {
    const { runId } = await started();
    await winAt(runId, '1-0');
    expect(await call(climbGame, { runId, stopId: '1-0' })).toMatchObject({ ok: false, status: 'active', cleared: true });
    expect(ledger(runId).status).toBe('active');
  });

  it('answers the boss as cleared once the run is won', async () => {
    const { runId } = await started();
    docs.set(`users/${UID}/runLedger/${runId}`, { ...ledger(runId), cleared: ['1-0', 'boss'], status: 'won' });
    expect(await call(climbGame, { runId, stopId: 'boss' })).toMatchObject({ ok: false, status: 'won', cleared: true });
  });

  it('stamps the map version the run was drawn at', async () => {
    const { runId, mapVersion } = await call(climbStart, { rung: 'prince' });
    expect(mapVersion).toBe(1);
    expect(ledger(runId).mapVersion).toBe(1);
  });
});
