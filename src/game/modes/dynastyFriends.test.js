// A DYNASTY WITH FRIENDS (2026-09-11): ready and force, the draft clock,
// sealed free-agency weeks, and trades between coaches with a veto.
import { describe, it, expect } from 'vitest';
import {
  createDynasty, DPHASE, onClock, rosterKeys, rightsOf, freeAgentKeys, contractsOf, quote, startSeason, waive, MAX_ROSTER, claimProblem,
  tradeProblems, payroll, tradeRelief, onWaivers, deadMoney, resolveWaivers, OPEN_OFFERS_PER_COACH, OFFERS_KEPT, trimOffers,
} from './dynasty.js';
import { rookieScale, fairDp, contractValue, APRON_DP } from './dynastyMarket.js';
import { getCardByKey, CARD_SETS, cardKey } from '../cardSets.js';
import { leagueKeys, importCost, fpOf } from './dynasty.js';
import {
  PICK_CLOCK_MS, setReady, allReady, advancePhase, stampClock, clockLeft, runDraftClock, coachPick,
  bidProblem, nextFaWeek, proposeTrade, respondTrade, withdrawTrade, vetoTrade, vetoable, openOffers, createFriendsDynasty,
  friendsAct, FRIEND_MOVES,
} from './dynastyFriends.js';
import { buildAiLeague } from './aiTeams.js';

const seeded = (s = 808) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
const A = 'h:a';
const B = 'h:b';
const T0 = 1_800_000_000_000;

function fantasy(seed = 3) {
  return createDynasty({ id: 'FR', size: 4, length: 'online', startMode: 'fantasy-full', rng: seeded(seed), humans: [{ id: A, name: 'Ann' }, { id: B, name: 'Bo' }] });
}
function own(seed = 3) {
  const [ra, rb] = buildAiLeague(2, { rng: seeded(1) }).map(t => t.roster);
  return createDynasty({ id: 'FO', size: 4, length: 'online', startMode: 'own', rng: seeded(seed), humans: [{ id: A, name: 'Ann', roster: ra }, { id: B, name: 'Bo', roster: rb }] });
}
/** Fantasy draft done by the clock, signing closed by both coaches: free agency, week one. */
function toFreeAgency() {
  let d = runDraftClock(fantasy(), { now: T0, rng: seeded(4) });
  for (let i = 0; i < 40 && d.phase === DPHASE.draft; i += 1) d = runDraftClock(d, { now: T0 + (i + 1) * PICK_CLOCK_MS, rng: seeded(5 + i) });
  expect(d.phase).toBe(DPHASE.signing);
  d = setReady(setReady(d, A), B);
  expect(allReady(d)).toBe(true);
  d = advancePhase(d, { rng: seeded(6) });
  expect(d.phase).toBe(DPHASE.freeAgency);
  expect(allReady(d)).toBe(false);
  return d;
}

describe('the draft clock', () => {
  it('starts when a coach comes on the clock and waits for him', () => {
    const d = runDraftClock(fantasy(), { now: T0, rng: seeded(4) });
    const c = onClock(d);
    expect([A, B]).toContain(c.teamId);
    expect(d.draft.clockAt).toBe(T0);
    expect(clockLeft(d, T0 + 1000)).toBe(PICK_CLOCK_MS - 1000);
    // Still his, an hour later.
    expect(onClock(runDraftClock(d, { now: T0 + 3_600_000, rng: seeded(4) })).n).toBe(c.n);
  });

  it('has the AI pick for a coach whose clock ran out, and says so', () => {
    const d = runDraftClock(fantasy(), { now: T0, rng: seeded(4) });
    const c = onClock(d);
    const x = runDraftClock(d, { now: T0 + PICK_CLOCK_MS + 1, rng: seeded(4) });
    expect(x.draft.picks.find(p => p.n === c.n).teamId).toBe(c.teamId);
    expect(x.news.some(n => /clock ran out/.test(n.text))).toBe(true);
  });

  it('lets the commissioner force the pick now, and a coach pick for himself', () => {
    const d = runDraftClock(fantasy(), { now: T0, rng: seeded(4) });
    const c = onClock(d);
    expect(onClock(runDraftClock(d, { now: T0, rng: seeded(4), force: true })).n).toBeGreaterThan(c.n);
    const key = d.draft.pool.find(k => !d.draft.picks.some(p => p.key === k));
    const mine = coachPick(d, c.teamId, key, { now: T0 + 5, rng: seeded(4) });
    expect(rightsOf(mine, c.teamId, 'draft')).toContain(key);
    expect(stampClock(mine, T0 + 9).draft.clockAt).toBe(mine.draft.clockAt);   // a stamp only moves on a new pick
  });
});

describe('ready and force', () => {
  it('moves on when every coach is ready — and closes every coach\'s window', () => {
    const d = toFreeAgency();
    expect(rightsOf(d, A)).toHaveLength(0);
    expect(rightsOf(d, B)).toHaveLength(0);
  });

  it('will not end a season that is still being played', () => {
    let d = own();
    d = advancePhase(d, { rng: seeded(8) });   // preseason → season
    expect(d.phase).toBe(DPHASE.season);
    expect(() => advancePhase(d)).toThrow(/still being played/);
  });
});

/**
 * Free agency with ONE FREE AGENT BUILT (2026-09-18): a card worth 10–15 DP
 * from the undrafted pool, Easygoing, nobody else bidding. The tests below
 * used to search the seeded market for a man asking 4–20 (or 8 or more) with
 * no rival bid, and the market is whatever the card pool dealt.
 */
function withFreeAgent() {
  const d = toFreeAgency();
  const key = d.draftPool.find(k => { const f = fairDp(getCardByKey(k)); return f >= 10 && f <= 15; });
  return {
    d: { ...d, draftPool: d.draftPool.filter(k => k !== key), league: [...d.league, key], traits: { ...d.traits, [key]: 'easy' } },
    key,
  };
}

describe('sealed free agency', () => {
  it('refuses a bid that could not be signed', () => {
    const d = toFreeAgency();
    const fa = freeAgentKeys(d)[0];
    expect(bidProblem(d, A, { key: fa, dp: 99, years: 2 })).toMatch(/DP a season/);
    expect(bidProblem(d, A, { key: fa, dp: 5, years: 9 })).toMatch(/years/);
    expect(bidProblem(d, A, { key: 'nobody', dp: 5, years: 2 })).toMatch(/not a free agent/);
    expect(bidProblem(d, A, { key: fa, dp: 5, years: 2 })).toBeNull();
  });

  it('signs the coach whose bid is best by the player\'s own lights', () => {
    const { d, key } = withFreeAgent();
    expect(freeAgentKeys(d)).toContain(key);
    expect(d.fa.rivals[key]).toBeUndefined();
    const ask = quote(d, A, key).ask;
    expect(ask).toBeLessThanOrEqual(30);
    const pref = quote(d, A, key).preferred;
    const x = nextFaWeek(d, [
      { teamId: A, key, dp: ask, years: pref },
      { teamId: B, key, dp: ask + 3, years: pref },
    ], { rng: seeded(9) });
    expect(x.contracts[key]?.teamId).toBe(B);
    expect(x.fa.day).toBe(2);
  });

  it('signs nobody on a bid under his floor', () => {
    const { d, key } = withFreeAgent();
    expect(quote(d, A, key).ask).toBeGreaterThanOrEqual(8);
    const x = nextFaWeek(d, [{ teamId: A, key, dp: 1, years: 2 }], { rng: seeded(9) });
    expect(x.contracts[key]).toBeUndefined();
  });
});

// THE RIGHTS WINDOW WITH FRIENDS (the user, 2026-09-17): a coach signs his
// pick through the server's move list in any phase until the season starts.
describe('a coach\'s picks', () => {
  // Free agency with a pick of Ann's still unsigned, from the draft pool.
  const withPick = () => {
    let d = toFreeAgency();
    const key = d.draftPool[0];
    d = { ...d, draftPool: d.draftPool.slice(1), league: [...d.league, key], rights: { ...d.rights, [key]: { teamId: A, kind: 'rookie', pick: 2 } } };
    if (rosterKeys(d, A).length >= MAX_ROSTER) d = waive(d, A, rosterKeys(d, A)[0]);
    return { d, key };
  };

  it('signs at the slot\'s scale in free agency and in the preseason — and not for another coach, nor in season', () => {
    expect(FRIEND_MOVES).toContain('signRookie');
    const { d, key } = withPick();
    const terms = { teamId: A, dp: rookieScale(2, d.teams.length).dp, years: 3, how: 'rookie' };
    expect(friendsAct(d, A, 'signRookie', { key }, { now: T0 }).dynasty.contracts[key]).toMatchObject(terms);
    expect(friendsAct({ ...d, phase: DPHASE.preseason }, A, 'signRookie', { key }, { now: T0 }).dynasty.contracts[key]).toMatchObject(terms);
    expect(() => friendsAct(d, B, 'signRookie', { key }, { now: T0 })).toThrow(/not your pick/);
    expect(() => friendsAct({ ...d, phase: DPHASE.season }, A, 'signRookie', { key }, { now: T0 })).toThrow(/between the draft and the season/);
  });
});

describe('trades between coaches', () => {
  // An own start posts the AI's offers at its first turn (2026-09-18), so a
  // coach's offer is found by its id, never by its place in d.offers.
  const offer = (x, id) => x.offers.find(o => o.id === id);
  // BUILT (2026-09-18): the coaches' real contracts came from whatever the
  // seeded pool dealt, so one card changing team could put a one-for-one
  // swap past Bo's apron or outside the 125% match and the offer threw
  // before the offer paths were tested. Every contract on both coaches'
  // books is set to 5 DP, and the deal's legality is asserted up front:
  // offer, accept, decline, withdraw and veto are all that is under test.
  const d0 = own();
  const d = { ...d0, contracts: Object.fromEntries(Object.entries(d0.contracts).map(([k, c]) => [k, c.teamId === A || c.teamId === B ? { ...c, dp: 5 } : c])) };
  const give = rosterKeys(d, A)[0];
  const get = rosterKeys(d, B)[0];
  const deal = { from: A, to: B, give: [give], get: [get] };

  it('is a legal deal before anyone answers it', () => {
    expect(tradeProblems(d, deal)).toEqual([]);
  });

  it('waits for the other coach, then happens when he accepts', () => {
    const x = proposeTrade(d, deal, { id: 'o1', now: T0 });
    // Only the coaches' offers: which AI offers Bo also has depends on the
    // pool the league was dealt (a clean checkout's showed two).
    expect(openOffers(x, B).toMe.filter(o => !o.ai).map(o => o.id)).toEqual(['o1']);
    expect(x.contracts[give].teamId).toBe(A);
    expect(() => respondTrade(x, 'o1', A, true)).toThrow(/not yours to answer/);
    const y = respondTrade(x, 'o1', B, true, { now: T0 + 1 });
    expect(y.contracts[give].teamId).toBe(B);
    expect(y.contracts[get].teamId).toBe(A);
    expect(offer(y, 'o1').status).toBe('accepted');
  });

  it('can be declined or withdrawn, and moves nothing', () => {
    const x = proposeTrade(d, deal, { id: 'o2' });
    expect(respondTrade(x, 'o2', B, false).contracts[give].teamId).toBe(A);
    expect(offer(withdrawTrade(x, 'o2', A), 'o2').status).toBe('withdrawn');
    expect(() => withdrawTrade(x, 'o2', B)).toThrow(/not yours to withdraw/);
  });

  it('the commissioner can strike an open offer or undo an accepted trade — until the pieces move on', () => {
    const open = vetoTrade(proposeTrade(d, deal, { id: 'o3' }), 'o3');
    expect(offer(open, 'o3').status).toBe('vetoed');
    const done = respondTrade(proposeTrade(d, deal, { id: 'o4' }), 'o4', B, true);
    const undone = vetoTrade(done, 'o4');
    expect(undone.contracts[give].teamId).toBe(A);
    expect(undone.contracts[get].teamId).toBe(B);
    expect(undone.news[0].text).toMatch(/vetoed/);
    // Once the season has started, the trade stands.
    const later = startSeason(done, { rng: seeded(2) });
    expect(vetoable(later, offer(later, 'o4'))).toBe(false);
  });

  it('a two-for-one into a full roster waives its weakest to make room — and a veto puts him back, while he is still on the wire', () => {
    // ROSTER RELIEF (2026-09-18): Bo ends at eleven, so his weakest is cut
    // as part of the deal; the accepted offer keeps who, so the
    // commissioner's veto can undo the trade whole.
    const [g1, g2] = rosterKeys(d, A);
    const two = { from: A, to: B, give: [g1, g2], get: [get] };
    expect(rosterKeys(d, B)).toHaveLength(MAX_ROSTER);
    const cut = tradeRelief(d, two)[B]?.[0];
    expect(cut).toBeTruthy();
    expect(tradeProblems(d, two)).toEqual([]);
    const done = respondTrade(proposeTrade(d, two, { id: 'o5' }), 'o5', B, true);
    expect(rosterKeys(done, B)).toHaveLength(MAX_ROSTER);
    expect(onWaivers(done, cut)).toBe(true);
    expect(offer(done, 'o5').relief).toEqual([{ teamId: B, key: cut, contract: d.contracts[cut] }]);
    const undone = vetoTrade(done, 'o5');
    expect(undone.contracts).toEqual(d.contracts);
    expect(onWaivers(undone, cut)).toBe(false);
    expect(deadMoney(undone, B)).toBe(deadMoney(d, B));
    expect(payroll(undone, B)).toBe(payroll(d, B));
    // Once the wire has resolved him, the trade stands.
    const resolved = resolveWaivers(done);
    expect(vetoable(resolved, offer(resolved, 'o5'))).toBe(false);
  });

  it('refuses an offer to an AI team or to yourself', () => {
    const ai = d.teams.find(t => !t.human).id;
    expect(() => proposeTrade(d, { ...deal, to: ai, get: [contractsOf(d, ai)[0].key] }, { id: 'x' })).toThrow(/one coach to another/);
    expect(() => proposeTrade(d, { ...deal, to: A }, { id: 'y' })).toThrow(/one coach to another/);
  });

  it('keeps what a coach has open bounded: no deal twice, and ten waiting at most (2026-09-18)', () => {
    // A review: 200 identical proposals kept 201 offers in a document
    // Firestore caps at 1 MiB, since open offers are never trimmed.
    let x = proposeTrade(d, deal, { id: 'b0' });
    expect(() => proposeTrade(x, deal, { id: 'b1' })).toThrow(/already offered/);
    const mine = rosterKeys(d, A);
    const theirs = rosterKeys(d, B);
    let n = 1;
    for (const g of mine) {
      for (const t of theirs) {
        if (n >= OPEN_OFFERS_PER_COACH) break;
        const other = { from: A, to: B, give: [g], get: [t] };
        if (tradeProblems(x, other).length || (g === give && t === get)) continue;
        x = proposeTrade(x, other, { id: `b${n}` });
        n += 1;
      }
    }
    expect(openOffers(x, A).fromMe).toHaveLength(OPEN_OFFERS_PER_COACH);
    const one = mine.flatMap(g => theirs.map(t => ({ from: A, to: B, give: [g], get: [t] })))
      .find(o => !tradeProblems(x, o).length && !x.offers.some(y => y.status === 'open' && y.give[0] === o.give[0] && y.get[0] === o.get[0]));
    expect(() => proposeTrade(x, one, { id: 'bx' })).toThrow(/withdraw one first/);
    // Withdrawing one makes room.
    expect(openOffers(proposeTrade(withdrawTrade(x, 'b0', A), one, { id: 'bx' }), A).fromMe).toHaveLength(OPEN_OFFERS_PER_COACH);
  });

  it('a trade the commissioner can still veto is never trimmed away, however many offers are decided since', () => {
    const done = respondTrade(proposeTrade(d, deal, { id: 'kept' }), 'kept', B, true);
    const filler = Array.from({ length: OFFERS_KEPT + 5 }, (_, i) => ({ id: `f${i}`, from: 'z', to: 'y', give: [], get: [], givePicks: [], getPicks: [], status: 'expired', ai: true, year: done.year, phase: done.phase }));
    const x = { ...done, offers: trimOffers([...done.offers, ...filler], done) };
    expect(offer(x, 'kept')).toBeTruthy();
    expect(vetoTrade(x, 'kept').contracts[give].teamId).toBe(A);
  });

  it("an AI team's offer is not the commissioner's to veto, open or accepted (2026-09-18)", () => {
    const ai = d.teams.find(t => !t.human).id;
    const aiOffer = { id: 'ai-x', from: ai, to: B, give: [rosterKeys(d, ai)[0]], get: [get], givePicks: [], getPicks: [], status: 'open', ai: true, year: d.year, phase: d.phase };
    expect(vetoable(d, aiOffer)).toBe(false);
    expect(vetoable(d, { ...aiOffer, status: 'accepted' })).toBe(false);
    expect(() => vetoTrade({ ...d, offers: [aiOffer] }, 'ai-x')).toThrow(/between coaches/);
  });
});

describe("the lobby's rung (2026-09-16)", () => {
  it('rides into the dynasty the server builds, so its AI teams draft to the rung and its games pay at it', () => {
    const league = {
      id: 'LR', name: 'Rung',
      settings: { size: 4, length: 'online', startMode: 'fantasy-full', series: null, aging: false, aiLevel: 'deity' },
      entrants: [{ id: A, name: 'Ann', uid: 'a' }, { id: B, name: 'Bo', uid: 'b' }],
    };
    expect(createFriendsDynasty(league, { rng: seeded(3), now: T0 }).aiLevel).toBe('deity');
    const fair = { ...league, settings: { ...league.settings, aiLevel: null } };
    expect(createFriendsDynasty(fair, { rng: seeded(3), now: T0 }).aiLevel).toBe(null);
  });
});

// ── WAIVERS WITH FRIENDS (the user, 2026-09-18: "If they are claimed, that
// money would come off the cap.") ────────────────────────────────────────────
// The server's own moves — 'waive', 'claim', 'unclaim' through friendsAct —
// and the week turning (nextFaWeek) as the league moving on. Built: Ann's
// man is put on a 1-DP, three-year deal (a bargain every AI team would
// claim), Bo is given a seat, and the standings that set the waiver order
// are written in, so the claimant is the rule's and never the pool's.
describe('waivers with friends (2026-09-18)', () => {
  function wire(worstFirst) {
    const d0 = toFreeAgency();
    const ai = d0.teams.filter(t => !t.human).map(t => t.id);
    const contracts = { ...d0.contracts };
    // Bo with a seat, whatever the draft dealt.
    for (const k of rosterKeys(d0, B).slice(MAX_ROSTER - 1)) delete contracts[k];
    // Ann's man: a card worth 10–15 DP from the undrafted pool, on 1 DP × 3.
    const key = d0.draftPool.find(k => { const f = fairDp(getCardByKey(k)); return f >= 10 && f <= 15; });
    contracts[key] = { teamId: A, dp: 1, years: 3, since: d0.year, how: 'fa' };
    // THE FIRST AI TEAM'S NINE DEALT BY HAND (2026-09-21): the nine cheapest
    // cards outside the coming class, on 1-DP deals, its drafted men released
    // to free agency. Until today its seeded ten stood, trimmed to nine — but
    // a fantasy draft signs an AI team up to its card-salary ceiling
    // (aiSalaryCap, 2026-09-18), and under one pool variant (Wembanyama moved
    // to Charlotte) the nine left had no room for Ann's $820 man, so the
    // claim the order gave it was refused. The claim rule is what is tested;
    // cheap men leave the ceiling thousands of room.
    for (const k of rosterKeys(d0, ai[0])) delete contracts[k];
    const drawn = new Set(d0.draftClass?.keys ?? []);
    const cheap = d0.draftPool.filter(k => k !== key && !drawn.has(k) && getCardByKey(k))
      .sort((p, q) => getCardByKey(p).salary - getCardByKey(q).salary).slice(0, MAX_ROSTER - 1);
    for (const k of cheap) contracts[k] = { teamId: ai[0], dp: 1, years: 2, since: d0.year, how: 'fill' };
    const order = worstFirst({ ai });
    const table = order.map((id, i) => ({ id, w: i, l: order.length - i, rank: order.length - i }));
    const d = {
      ...d0, contracts,
      league: [...d0.league, key, ...cheap],
      draftPool: d0.draftPool.filter(k => k !== key && !cheap.includes(k)),
      history: [{ year: 0, champion: null, runnerUp: null, playoffSeeds: [], table }],
    };
    expect(rosterKeys(d, ai[0])).toHaveLength(MAX_ROSTER - 1);
    const { dynasty } = friendsAct(d, A, 'waive', { key }, { now: T0, rng: seeded(7) });
    for (const t of [B, ai[0]]) expect(claimProblem(dynasty, t, key)).toBeNull();
    return { d: dynasty, key, ai };
  }

  it('a coach\'s claim, first in the order, takes the contract when the week turns — and off the waiving coach\'s books', () => {
    const { d, key, ai } = wire(({ ai }) => [B, ...ai, A]);
    expect(FRIEND_MOVES).toEqual(expect.arrayContaining(['claim', 'unclaim']));
    expect(d.waivers.map(w => w.key)).toEqual([key]);
    expect(d.dead.filter(m => m.teamId === A && m.key === key).map(m => m.dp)).toEqual([1]);
    // On waivers, not a free agent: no sealed bid can be made on him.
    expect(bidProblem(d, B, { key, dp: 2, years: 2 })).toMatch(/not a free agent/);
    // The waiving coach cannot claim his own man; a claim can be taken back.
    expect(() => friendsAct(d, A, 'claim', { key }, { now: T0 })).toThrow(/you waived him/);
    let x = friendsAct(d, B, 'claim', { key }, { now: T0 }).dynasty;
    expect(x.waivers[0].claims).toEqual([B]);
    expect(friendsAct(x, B, 'unclaim', { key }, { now: T0 }).dynasty.waivers[0].claims).toEqual([]);
    // The week turns: Bo, worst, takes him on the deal as it stood.
    const y = nextFaWeek(x, [], { rng: seeded(8) });
    expect(y.contracts[key]).toMatchObject({ teamId: B, dp: 1, years: 3, how: 'waivers' });
    expect(y.dead.filter(m => m.teamId === A && m.key === key)).toEqual([]);
    expect(y.waivers).toEqual([]);
    expect(y.news.some(n => /^Bo.* claimed .* off waivers — his salary comes off Ann.*'s books\.$/.test(n.text))).toBe(true);
    // Without his claim the first AI team in the order takes the bargain instead.
    x = nextFaWeek(d, [], { rng: seeded(8) });
    expect(x.contracts[key].teamId).toBe(ai[0]);
    expect(x.dead.filter(m => m.teamId === A && m.key === key)).toEqual([]);
  });

  it('an AI team ahead of the coach in the order claims first, whatever the coach put in', () => {
    const { d, key, ai } = wire(({ ai }) => [ai[0], B, ...ai.slice(1), A]);
    const x = friendsAct(d, B, 'claim', { key }, { now: T0 }).dynasty;
    expect(nextFaWeek(x, [], { rng: seeded(8) }).contracts[key].teamId).toBe(ai[0]);
  });

  it('at the preseason turn a coach of seven takes his claim before anyone fills his roster — as startSeason does alone', () => {
    // Reviewer, 2026-09-18: advancePhase filled a short coach first, and the
    // minimum deal took the seat or the apron room his standing claim needed.
    // Built: Ann at exactly seven on 5 DP a man; an AI team waives a man at
    // 30 DP — more than he is worth, so no AI team claims him — and Ann
    // claims him. Her claim fits to the last DP of the apron once the fill
    // is booked first, so the old order failed the claim outright.
    const d0 = own();
    expect(d0.phase).toBe(DPHASE.preseason);
    const ai = d0.teams.find(t => !t.human).id;
    const key = rosterKeys(d0, ai).find(k => fairDp(getCardByKey(k)) < 30);
    const seven = rosterKeys(d0, A).slice(0, 7);
    const contracts = { ...d0.contracts };
    for (const k of rosterKeys(d0, A)) delete contracts[k];
    for (const k of seven) contracts[k] = { ...d0.contracts[k], dp: 5 };
    contracts[key] = { ...contracts[key], dp: 30, years: 2 };
    // Ann's books sit exactly 30 under her apron: the claim fits, a claim plus a fill does not.
    const room = { teamId: A, key: 'ballast', dp: APRON_DP - 35 - 30, through: d0.year };
    const d1 = { ...d0, contracts, dead: [...(d0.dead ?? []), room] };
    expect(payroll(d1, A)).toBe(APRON_DP - 30);
    expect(contractValue(getCardByKey(key), { dp: 30, years: 2 })).toBeLessThanOrEqual(0);
    const waived = waive(d1, ai, key);
    expect(claimProblem(waived, A, key)).toBeNull();
    const d = friendsAct(waived, A, 'claim', { key }, { now: T0 }).dynasty;
    const x = advancePhase(d, { rng: seeded(9) });
    expect(x.phase).toBe(DPHASE.season);
    expect(x.contracts[key]).toMatchObject({ teamId: A, dp: 30, years: 2, how: 'waivers' });
    // His seven and the man he claimed — no fill he never asked for.
    expect([...rosterKeys(x, A)].sort()).toEqual([...seven, key].sort());
    expect(payroll(x, A)).toBe(APRON_DP);
    // The same claim alone: startSeason resolves the wire first too.
    expect(startSeason(d, { rng: seeded(9) }).contracts[key].teamId).toBe(A);
  });
});

describe('the deck and Franchise Points with friends (2026-09-22)', () => {
  it('names both moves; a deck is set through the dynasty move, and a card brought in for the points', () => {
    expect(FRIEND_MOVES).toContain('setDeck');
    expect(FRIEND_MOVES).toContain('import');
    const d = own();
    const deck = { high_screen_roll: 4 };
    const decked = friendsAct(d, A, 'setDeck', { deck, deckName: 'Screens' }, { now: T0 }).dynasty;
    expect(decked.teams.find(t => t.id === A)).toMatchObject({ deck, deckName: 'Screens' });
    expect(decked.teams.find(t => t.id === B).deck).toBe(d.teams.find(t => t.id === B).deck);
    // A card outside the league, a seat, and exactly the points it costs.
    const key = CARD_SETS['super-season'].map(c => cardKey(c))
      .find(k => !leagueKeys(d).includes(k) && !(d.draftPool ?? []).includes(k) && !(d.draftClass?.keys ?? []).includes(k));
    const cost = importCost(getCardByKey(key));
    const drop = rosterKeys(d, A)[0];
    const { [drop]: gone, ...contracts } = d.contracts;
    void gone;
    const room = { ...d, phase: DPHASE.preseason, contracts, league: leagueKeys(d).filter(k => k !== drop), fp: { [A]: cost } };
    const x = friendsAct(room, A, 'import', { key }, { now: T0 }).dynasty;
    expect(x.contracts[key]).toMatchObject({ teamId: A, how: 'imported' });
    expect(fpOf(x, A)).toBe(0);
    // Bo's ten is full; with a seat he still has no points. Ann cannot bring the same man in twice.
    expect(() => friendsAct(room, B, 'import', { key }, { now: T0 })).toThrow(/roster is full/);
    const dropB = rosterKeys(room, B)[0];
    const { [dropB]: goneB, ...withSeat } = room.contracts;
    void goneB;
    expect(() => friendsAct({ ...room, contracts: withSeat, league: leagueKeys(room).filter(k => k !== dropB) }, B, 'import', { key }, { now: T0 })).toThrow(/Franchise Points/);
    expect(() => friendsAct(x, A, 'import', { key }, { now: T0 })).toThrow(/already in this league/);
  });
});
