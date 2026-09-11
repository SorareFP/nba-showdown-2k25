// A DYNASTY WITH FRIENDS (2026-09-11): ready and force, the draft clock,
// sealed free-agency weeks, and trades between coaches with a veto.
import { describe, it, expect } from 'vitest';
import {
  createDynasty, DPHASE, onClock, rosterKeys, rightsOf, freeAgentKeys, contractsOf, quote, startSeason,
} from './dynasty.js';
import {
  PICK_CLOCK_MS, setReady, allReady, advancePhase, stampClock, clockLeft, runDraftClock, coachPick,
  bidProblem, nextFaWeek, proposeTrade, respondTrade, withdrawTrade, vetoTrade, vetoable, openOffers,
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
    const d = toFreeAgency();
    const key = freeAgentKeys(d).find(k => !d.fa.rivals[k] && quote(d, A, k).ask >= 4 && quote(d, A, k).ask <= 20);
    const ask = quote(d, A, key).ask;
    const pref = quote(d, A, key).preferred;
    const x = nextFaWeek(d, [
      { teamId: A, key, dp: ask, years: pref },
      { teamId: B, key, dp: ask + 3, years: pref },
    ], { rng: seeded(9) });
    expect(x.contracts[key]?.teamId).toBe(B);
    expect(x.fa.day).toBe(2);
  });

  it('signs nobody on a bid under his floor', () => {
    const d = toFreeAgency();
    const key = freeAgentKeys(d).find(k => !d.fa.rivals[k] && quote(d, A, k).ask >= 8);
    const x = nextFaWeek(d, [{ teamId: A, key, dp: 1, years: 2 }], { rng: seeded(9) });
    expect(x.contracts[key]).toBeUndefined();
  });
});

describe('trades between coaches', () => {
  const d = own();
  const give = rosterKeys(d, A)[0];
  const get = rosterKeys(d, B)[0];
  const deal = { from: A, to: B, give: [give], get: [get] };

  it('waits for the other coach, then happens when he accepts', () => {
    const x = proposeTrade(d, deal, { id: 'o1', now: T0 });
    expect(openOffers(x, B).toMe.map(o => o.id)).toEqual(['o1']);
    expect(x.contracts[give].teamId).toBe(A);
    expect(() => respondTrade(x, 'o1', A, true)).toThrow(/not yours to answer/);
    const y = respondTrade(x, 'o1', B, true, { now: T0 + 1 });
    expect(y.contracts[give].teamId).toBe(B);
    expect(y.contracts[get].teamId).toBe(A);
    expect(y.offers[0].status).toBe('accepted');
  });

  it('can be declined or withdrawn, and moves nothing', () => {
    const x = proposeTrade(d, deal, { id: 'o2' });
    expect(respondTrade(x, 'o2', B, false).contracts[give].teamId).toBe(A);
    expect(withdrawTrade(x, 'o2', A).offers[0].status).toBe('withdrawn');
    expect(() => withdrawTrade(x, 'o2', B)).toThrow(/not yours to withdraw/);
  });

  it('the commissioner can strike an open offer or undo an accepted trade — until the pieces move on', () => {
    const open = vetoTrade(proposeTrade(d, deal, { id: 'o3' }), 'o3');
    expect(open.offers[0].status).toBe('vetoed');
    const done = respondTrade(proposeTrade(d, deal, { id: 'o4' }), 'o4', B, true);
    const undone = vetoTrade(done, 'o4');
    expect(undone.contracts[give].teamId).toBe(A);
    expect(undone.contracts[get].teamId).toBe(B);
    expect(undone.news[0].text).toMatch(/vetoed/);
    // Once the season has started, the trade stands.
    const later = startSeason(done, { rng: seeded(2) });
    expect(vetoable(later, later.offers[0])).toBe(false);
  });

  it('refuses an offer to an AI team or to yourself', () => {
    const ai = d.teams.find(t => !t.human).id;
    expect(() => proposeTrade(d, { ...deal, to: ai, get: [contractsOf(d, ai)[0].key] }, { id: 'x' })).toThrow(/one coach to another/);
    expect(() => proposeTrade(d, { ...deal, to: A }, { id: 'y' })).toThrow(/one coach to another/);
  });
});
