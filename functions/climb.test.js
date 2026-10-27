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

const { climbStart, climbGame, climbBank, climbContinue, climbPerk, claimGameReward } = await import('./index.js');
const { generateMap, potOf, potOfRun, stopById, reachableGame, runClaimPreview } = await import('../src/game/modes/climbMap.js');

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
      if (!['rest', 'event'].includes(s.kind)) return [a.id, s.id];
      for (const id2 of s.next) if (!['rest', 'event'].includes(stopById(map, id2).kind)) return [a.id, id2];
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
    // 2 since 2026-10-25 (? stops), 3 since 2026-10-27 (Makeup Games); a run keeps its own.
    expect(mapVersion).toBe(3);
    expect(ledger(runId).mapVersion).toBe(3);
  });

  // A MAKEUP GAME (map version 3): a ? on the screens, a Game to the ledger.
  it('opens, clears and prices a Makeup Game as the Game it is', async () => {
    const { runId } = await started();
    let seed = 1;
    let pair = null;
    for (; seed < 2000 && !pair; seed += 1) {
      const m = generateMap(seed, 3);
      const mk = m.floors[1].find(s => s.makeup);
      const from = mk && m.floors[0].find(s => s.next.includes(mk.id));
      if (from) pair = [from.id, mk.id, m];
    }
    expect(pair).toBeTruthy();
    const [from, mk, map] = pair;
    Object.assign(ledger(runId), { seed: seed - 1 });
    await winAt(runId, from);
    const before = potOfRun(ledger(runId)).coins;
    await winAt(runId, mk);
    expect(ledger(runId).cleared).toEqual([from, mk]);
    expect(potOfRun(ledger(runId)).coins - before).toBe(potOf(map, [mk], 'prince').coins);
  });
});

// THREE ACTS (2026-10-20, docs/plans/2026-10-20-the-climb-three-acts.md): a
// boss win waits on the player's choice — bank, or keep climbing into the
// next act with the pot riding on. One pot: a loss in any act loses all of it.
describe('three acts', () => {
  const wonAct1 = async () => {
    const { runId } = await started();
    docs.set(`users/${UID}/runLedger/${runId}`, { ...ledger(runId), cleared: ['1-0', 'boss'], status: 'won' });
    return runId;
  };

  it('keeps climbing only from a beaten boss, one act at a time, and answers a repeat', async () => {
    const { runId } = await started();
    await expect(call(climbContinue, { runId, toAct: 2 })).rejects.toThrow(/Beat the boss/);
    const won = await wonAct1();
    await expect(call(climbContinue, { runId: won, toAct: 3 })).rejects.toThrow(/no act/);
    expect(await call(climbContinue, { runId: won, toAct: 2 })).toEqual({ ok: true, act: 2 });
    expect(ledger(won)).toMatchObject({ status: 'active', act: 2, open: null });
    expect(await call(climbContinue, { runId: won, toAct: 2 })).toEqual({ ok: true, act: 2 });
    // Past Act III there is nowhere to go.
    docs.set(`users/${UID}/runLedger/${won}`, { ...ledger(won), act: 3, status: 'won' });
    await expect(call(climbContinue, { runId: won, toAct: 4 })).rejects.toThrow(/no act/);
    // A banked run has no next act.
    docs.set(`users/${UID}/runLedger/${won}`, { ...ledger(won), act: 1, status: 'banked' });
    await expect(call(climbContinue, { runId: won, toAct: 2 })).rejects.toThrow(/Beat the boss/);
  });

  it('opens the next act from its own first floor, never an earlier act\'s stop', async () => {
    const runId = await wonAct1();
    await call(climbContinue, { runId, toAct: 2 });
    await expect(call(climbGame, { runId, stopId: '1-1' })).rejects.toThrow(/not open/);
    await expect(call(climbGame, { runId, stopId: 'a2:3-0' })).rejects.toThrow(/not open/);
    expect(await call(climbGame, { runId, stopId: 'a2:1-0' })).toMatchObject({ ok: true });
    await claim(runId, 'a2:1-0', true);
    expect(ledger(runId)).toMatchObject({ status: 'active', act: 2 });
    expect(ledger(runId).cleared).toEqual(['1-0', 'boss', 'a2:1-0']);
  });

  it('loses the whole pot on a loss in a later act', async () => {
    const runId = await wonAct1();
    await call(climbContinue, { runId, toAct: 2 });
    await call(climbGame, { runId, stopId: 'a2:1-0' });
    await claim(runId, 'a2:1-0', false);
    expect(ledger(runId).status).toBe('lost');
    await expect(call(climbBank, { runId })).rejects.toThrow(/lost/);
    expect([...docs.keys()].some(k => k.startsWith(`users/${UID}/boxes/`))).toBe(false);
  });

  it('banks every act\'s stops at its act\'s rate, and every beaten boss\'s pack', async () => {
    const runId = await wonAct1();
    const cleared = ['1-0', 'boss', 'a2:1-0', 'a2:boss', 'a3:1-0', 'a3:boss'];
    docs.set(`users/${UID}/runLedger/${runId}`, { ...ledger(runId), act: 3, cleared, status: 'won' });
    const pot = potOfRun({ ...ledger(runId) });
    // A Prince run since map version 3: the Mega Deluxe is King's and Deity's (bossPacksOf).
    expect(pot.packs).toEqual(['booster', 'rare_deluxe', 'super_deluxe']);
    // Act II's floor-1 Game pays half again Act I's, Act III's double.
    const one = potOfRun({ ...ledger(runId), cleared: ['1-0'] }).coins;
    expect(potOfRun({ ...ledger(runId), cleared: ['a2:1-0'] }).coins).toBe(Math.round(one * 1.5));
    expect(potOfRun({ ...ledger(runId), cleared: ['a3:1-0'] }).coins).toBe(one * 2);
    const before = coins();
    const res = await call(climbBank, { runId });
    expect(res).toMatchObject({ coins: pot.coins, booster: true, packs: ['booster', 'rare_deluxe', 'super_deluxe'] });
    expect(coins()).toBe(before + pot.coins);
    const boxes = [...docs.entries()].filter(([k]) => k.startsWith(`users/${UID}/boxes/`)).map(([, v]) => v.packType).sort();
    expect(boxes).toEqual(['booster', 'rare_deluxe', 'super_deluxe']);
  });

  // THE PACKS CLIMB WITH THE RUNG (2026-10-27; the user: "boy there's a lot
  // of loot!"): the server banks the ledger's rung's packs, and a run drawn
  // before map version 3 keeps the old three.
  it('banks the packs of the ledger\'s rung, and the old three for a run drawn before them', async () => {
    const cleared = ['1-0', 'boss', 'a2:1-0', 'a2:boss', 'a3:1-0', 'a3:boss'];
    const bank = async (rung, mapVersion) => {
      const { runId } = await started(rung);
      docs.set(`users/${UID}/runLedger/${runId}`, { ...ledger(runId), mapVersion, act: 3, cleared, status: 'won' });
      return (await call(climbBank, { runId })).packs;
    };
    expect(await bank('settler', 3)).toEqual(['booster']);
    expect(await bank('deity', 3)).toEqual(['rare_deluxe', 'super_deluxe', 'mega_deluxe']);
    expect(await bank('settler', 2)).toEqual(['booster', 'rare_deluxe', 'mega_deluxe']);
  });
});

// THE PERKS THE LEDGER KEEPS (2026-10-22, climbPerk): Sponsorship and Max
// Contract price the pot, Travel Day opens a stop off the links, Second
// Chance turns a loss into a replay.
describe('the ledger\'s perks', () => {
  it('refuses a perk before a win, a boss\'s in Act I, and one the ledger does not keep', async () => {
    const { runId } = await started();
    await expect(call(climbPerk, { runId, perk: 'sponsorship' })).rejects.toThrow(/Win a game first/);
    await expect(call(climbPerk, { runId, perk: 'gym_rat' })).rejects.toThrow(/Which run/);
    await expect(call(climbPerk, { runId, perk: 'second_chance' })).rejects.toThrow(/boss/);
  });

  it('Sponsorship: every win after it adds a fifth more, and the bank pays what the pot says', async () => {
    const { runId, map } = await started();
    const [a, b] = twoGames(map);
    await winAt(runId, a);
    expect(await call(climbPerk, { runId, perk: 'sponsorship' })).toEqual({ ok: true });
    expect(await call(climbPerk, { runId, perk: 'sponsorship' })).toEqual({ ok: true });   // a repeat catches up
    expect(ledger(runId).perks).toEqual([{ id: 'sponsorship', at: 1 }]);
    await winAt(runId, b);
    const l = ledger(runId);
    const plain = potOfRun({ ...l, perks: [] }).coins;
    const pot = potOfRun(l).coins;
    expect(pot).toBeGreaterThan(plain);
    const before = coins();
    await call(climbBank, { runId });
    expect(coins() - before).toBe(pot);
  });

  it('Travel Day: a stop off the links opens and spends one; without it, it is refused', async () => {
    // A map with a floor-1 Game and a floor-2 fight it does not link to (seeds vary).
    let runId, map, from;
    for (let i = 0; i < 50 && !from; i += 1) {
      ({ runId, map } = await started());
      from = map.floors[0].find(s => map.floors[1].some(t => !s.next.includes(t.id) && !['rest', 'event'].includes(t.kind)));
    }
    const off = map.floors[1].find(t => !from.next.includes(t.id) && !['rest', 'event'].includes(t.kind));
    await winAt(runId, from.id);
    await expect(call(climbGame, { runId, stopId: off.id })).rejects.toThrow(/not open/);
    await call(climbPerk, { runId, perk: 'travel_day' });
    expect(ledger(runId).travel).toBe(3);
    expect(await call(climbGame, { runId, stopId: off.id })).toMatchObject({ ok: true });
    expect(ledger(runId).travel).toBe(2);
  });

  it('Second Chance: the first loss is replayed under its own key, the second ends the run', async () => {
    const { runId, map } = await started();
    const [a, b] = twoGames(map);
    await winAt(runId, a);
    // A boss's perk, so the ledger is put in Act II's opening as a boss's reward finds it.
    docs.set(`users/${UID}/runLedger/${runId}`, { ...ledger(runId), act: 2 });
    await call(climbPerk, { runId, perk: 'second_chance' });
    docs.set(`users/${UID}/runLedger/${runId}`, { ...ledger(runId), act: 1 });
    expect(await call(climbGame, { runId, stopId: b })).toMatchObject({ ok: true });
    const lost = await claim(runId, b, false);
    expect(lost.run.status).toBe('active');
    expect(lost.breakdown.at(-1).label).toMatch(/Second Chance/);
    expect(ledger(runId)).toMatchObject({ status: 'active', open: null, replay: b, secondChanceUsed: true });
    // The replay: the same stop opens again, and only its own key claims it.
    expect(await call(climbGame, { runId, stopId: b })).toMatchObject({ ok: true });
    expect((await claim(runId, b, false)).run.status).toBe('active');   // the first key is spent: nothing moves
    expect((await claim(runId, b, false, { gameId: `${keyOf(runId, b)}:2` })).run.status).toBe('lost');
  });
});
