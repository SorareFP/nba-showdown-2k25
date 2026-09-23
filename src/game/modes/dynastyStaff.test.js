// THE STAFF (the user, 2026-09-23): a front office bought with Franchise
// Points — the Head Scout, the Cap Strategist and Sports Science, three
// tiers each, in order, kept for the dynasty. Each perk is pinned where it
// bites: the lottery weights, the apron, the ask, the retirement roll, the
// steal after the last pick.
import { describe, it, expect } from 'vitest';
import {
  createDynasty, HUMAN_ID, DPHASE, MAX_ROSTER,
  STAFF_ROLES, STAFF_ORDER, LOTTERY_BOOST, HOMETOWN_DISCOUNT, LUXURY_APRON,
  staffTier, staffOf, hireProblem, hireStaff, apronOf, discountFor, retireShift,
  protectProblem, protectPlayer, stealProblem, stealPick,
  lotteryOdds, quote, negotiate, limitFor, fitsCap, rosterKeys, rightsOf, leagueKeys, teamOf, fpOf,
  onClock, draftPick, passPick, simDraft, aiDraftChoice, draftAvailable, draftDone, finishDraft, closeResign, drawLottery,
  startSeason, endSeason, ageOf, retireChance, RETIRE_FROM, rookieTerms,
} from './dynasty.js';
import { APRON_DP, CAP_DP, MIN_DP } from './dynastyMarket.js';
import { friendsAct, FRIEND_MOVES } from './dynastyFriends.js';
import { buildAiLeague } from './aiTeams.js';
import { roundFixtures, totalRounds, recordResult, advance, PHASE } from './season.js';

const seeded = (s = 808) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
function ownDynasty({ size = 4, length = 'short', seed = 2, aging = false } = {}) {
  const brought = buildAiLeague(1, { rng: seeded(1) })[0].roster;
  return createDynasty({ id: 'dyn', size, length, startMode: 'own', rng: seeded(seed), human: { name: 'Me', roster: brought }, aging });
}
const withFp = (d, n) => ({ ...d, fp: { ...(d.fp ?? {}), [HUMAN_ID]: n } });
/** Feed the live season to its end: home wins, then the higher seed. */
function finishSeason(d) {
  let s = d.season;
  for (let r = 0; r < totalRounds(s); r += 1) {
    for (const f of roundFixtures(s)) {
      if (f.result) continue;
      s = recordResult(s, { fixtureId: f.id, home: f.home, away: f.away, homeScore: 100, awayScore: 90 });
    }
    s = advance(s);
  }
  for (let guard = 0; guard < 20 && s.phase !== PHASE.done; guard += 1) {
    const m = s.bracket.matches.find(x => !x.winner && x.a && x.b);
    if (!m) break;
    s = recordResult(s, { fixtureId: m.id, home: m.a, away: m.b, homeScore: 120, awayScore: 100 });
  }
  expect(s.phase).toBe(PHASE.done);
  return { ...d, season: s };
}
/** Drive a draft to its end, the AI's choice for everyone. */
function driveDraft(d, rng) {
  let x = d;
  for (let guard = 0; guard < 500; guard += 1) {
    x = simDraft(x, { rng });
    const clock = onClock(x);
    if (!clock) break;
    const key = aiDraftChoice(x, clock.teamId, rng);
    x = key == null ? passPick(x, clock.teamId) : draftPick(x, clock.teamId, key);
  }
  return x;
}

describe('hiring', () => {
  it('is three roles of three tiers at 3, 6 and 12, bought in order with Franchise Points, by a coach only', () => {
    expect(STAFF_ORDER).toEqual(['scout', 'cap', 'science']);
    for (const role of STAFF_ORDER) expect(STAFF_ROLES[role].tiers.map(t => t.cost)).toEqual([3, 6, 12]);
    const d = withFp(ownDynasty(), 9);
    expect(staffOf(d, HUMAN_ID)).toEqual({ scout: 0, cap: 0, science: 0 });
    expect(hireProblem(d, HUMAN_ID, 'nope')).toMatch(/No such role/);
    expect(hireProblem(d, d.teams.find(t => !t.human).id, 'scout')).toMatch(/Only a coach/);
    // Sports Science has nothing to do in a ten-year dynasty.
    expect(hireProblem(d, HUMAN_ID, 'science')).toMatch(/aging/);
    expect(hireProblem(d, HUMAN_ID, 'scout')).toBeNull();
    const one = hireStaff(d, HUMAN_ID, 'scout');
    expect(staffTier(one, HUMAN_ID, 'scout')).toBe(1);
    expect(fpOf(one, HUMAN_ID)).toBe(6);
    expect(one.hires).toEqual([{ year: d.year, teamId: HUMAN_ID, role: 'scout', tier: 1, cost: 3 }]);
    expect(one.news[0].text).toMatch(/hire Scouting Department/);
    const two = hireStaff(one, HUMAN_ID, 'scout');
    expect(staffTier(two, HUMAN_ID, 'scout')).toBe(2);
    expect(fpOf(two, HUMAN_ID)).toBe(0);
    // Tier three costs twelve: not with nothing left.
    expect(hireProblem(two, HUMAN_ID, 'scout')).toMatch(/12 Franchise Points/);
    expect(() => hireStaff(two, HUMAN_ID, 'scout')).toThrow(/Franchise Points/);
    const three = hireStaff(withFp(two, 12), HUMAN_ID, 'scout');
    expect(hireProblem(three, HUMAN_ID, 'scout')).toMatch(/fully staffed/);
    // An old save with no staff reads as none.
    expect(staffTier({ ...d, staff: undefined }, HUMAN_ID, 'cap')).toBe(0);
  });

  it('is a friends-dynasty move, like importing', () => {
    expect(FRIEND_MOVES).toEqual(expect.arrayContaining(['hire', 'protect', 'steal']));
    const d = withFp(ownDynasty(), 3);
    const { dynasty: x } = friendsAct(d, HUMAN_ID, 'hire', { role: 'cap' }, { isHost: true, bids: [], id: 'm1', now: Date.now() });
    expect(staffTier(x, HUMAN_ID, 'cap')).toBe(1);
  });
});

describe('the Head Scout', () => {
  it('weights the coach\'s lottery slot by a quarter more at tier 2, and nobody else\'s', () => {
    const rng = seeded(5);
    let d = ownDynasty({ size: 4 });
    if (d.phase !== DPHASE.season) d = startSeason(d, { rng });
    d = endSeason(finishSeason(d), { rng });
    d = closeResign(d, { rng });
    expect(d.phase).toBe(DPHASE.lottery);
    const plain = lotteryOdds(d);
    const mine = plain.entries.find(e => e.teamId === HUMAN_ID);
    if (!mine) return; // the coach made the playoffs on this seed: no lottery slot to boost
    const boosted = lotteryOdds({ ...withFp(d, 9), staff: { [HUMAN_ID]: { scout: 2 } } });
    const mineB = boosted.entries.find(e => e.teamId === HUMAN_ID);
    expect(mineB.weight).toBeCloseTo(mine.weight * LOTTERY_BOOST, 6);
    for (const e of boosted.entries.filter(e => e.teamId !== HUMAN_ID)) {
      expect(e.weight).toBe(plain.entries.find(p => p.teamId === e.teamId).weight);
    }
    expect(mineB.pct).toBeGreaterThan(mine.pct);
  });

  it('steals one undrafted player after the last pick at tier 3, once, at the last slot\'s scale', () => {
    const rng = seeded(7);
    let d = ownDynasty({ size: 4 });
    if (d.phase !== DPHASE.season) d = startSeason(d, { rng });
    d = endSeason(finishSeason(d), { rng });
    d = closeResign(d, { rng });
    d = drawLottery(d, { rng });
    expect(d.phase).toBe(DPHASE.rookieDraft);
    // Not before the last pick, not without the tier.
    const first = draftAvailable(d)[0];
    expect(stealProblem(d, HUMAN_ID, first)).toMatch(/tier 3/);
    const scouted = { ...d, staff: { [HUMAN_ID]: { scout: 3 } } };
    expect(stealProblem(scouted, HUMAN_ID, first)).toMatch(/last pick/);
    let done = driveDraft(scouted, rng);
    expect(draftDone(done)).toBe(true);
    const left = draftAvailable(done);
    if (!left.length) return; // every prospect was taken on this seed
    const key = left[0];
    // The roster must have a seat for him.
    if (rosterKeys(done, HUMAN_ID).length + rightsOf(done, HUMAN_ID).length >= MAX_ROSTER) return;
    expect(stealProblem(done, HUMAN_ID, key)).toBeNull();
    const x = stealPick(done, HUMAN_ID, key);
    expect(x.rights[key]).toMatchObject({ teamId: HUMAN_ID, kind: 'rookie', pick: done.draft.order.length });
    expect(leagueKeys(x)).toContain(key);
    expect(x.draft.picks.at(-1)).toMatchObject({ teamId: HUMAN_ID, key, steal: true });
    expect(x.draft.stolen[HUMAN_ID]).toBe(key);
    expect(rookieTerms(x, key).dp).toBe(rookieTerms({ ...x, rights: { [key]: { pick: done.draft.order.length } } }, key).dp);
    // Once a draft.
    const other = draftAvailable(x)[0];
    if (other) expect(stealProblem(x, HUMAN_ID, other)).toMatch(/One steal/);
    // And the draft still closes, the stolen pick among the team's rights.
    const closed = finishDraft(x, { rng });
    expect(closed.phase).toBe(DPHASE.rookies);
    expect(rightsOf(closed, HUMAN_ID, 'rookie')).toContain(key);
  });
});

describe('the Cap Strategist', () => {
  it('raises the coach\'s apron by ten at tier 3, and only the coach\'s', () => {
    const d = ownDynasty();
    expect(apronOf(d, HUMAN_ID)).toBe(APRON_DP);
    const ai = d.teams.find(t => !t.human).id;
    const lux = { ...d, staff: { [HUMAN_ID]: { cap: 3 } } };
    expect(apronOf(lux, HUMAN_ID)).toBe(APRON_DP + LUXURY_APRON);
    expect(apronOf(lux, ai)).toBe(apronOf(d, ai));
    expect(apronOf({ ...d, staff: { [HUMAN_ID]: { cap: 2 } } }, HUMAN_ID)).toBe(APRON_DP);
    // Bird rights and the minimum deal read the raised apron; the cap does not move.
    const mine = rosterKeys(d, HUMAN_ID)[0];
    const expiring = { ...lux, rights: { ...lux.rights, [mine]: { teamId: HUMAN_ID, kind: 'expiring' } } };
    expect(limitFor(expiring, HUMAN_ID, mine)).toBe(APRON_DP + LUXURY_APRON);
    expect(limitFor(lux, HUMAN_ID, 'someone:else')).toBe(CAP_DP);
    // A payroll two over the plain apron: a minimum deal fits only the luxury one.
    const mineKeys = Object.keys(expiring.contracts).filter(k => expiring.contracts[k].teamId === HUMAN_ID);
    const big = APRON_DP + 2 - (mineKeys.length - 1);
    const heavy = { ...expiring, contracts: Object.fromEntries(Object.entries(expiring.contracts).map(([k, c]) => [k, c.teamId === HUMAN_ID ? { ...c, dp: k === mineKeys[0] ? big : 1 } : c])) };
    expect(fitsCap({ ...heavy, staff: {} }, HUMAN_ID, 'x:y', MIN_DP)).toBe(false);
    expect(fitsCap(heavy, HUMAN_ID, 'x:y', MIN_DP)).toBe(true);
  });

  it('asks 10% less of the coach for his own expiring player at tier 2, and judges the offer the same way', () => {
    const d = ownDynasty();
    const mine = rosterKeys(d, HUMAN_ID)[0];
    const base = { ...d, phase: DPHASE.resign, rights: { ...d.rights, [mine]: { teamId: HUMAN_ID, kind: 'expiring' } }, contracts: Object.fromEntries(Object.entries(d.contracts).filter(([k]) => k !== mine)) };
    const plain = quote(base, HUMAN_ID, mine);
    expect(plain.discount).toBe(1);
    expect(plain.floor).toBeNull();
    const staffed = { ...base, staff: { [HUMAN_ID]: { cap: 2 } } };
    const cut = quote(staffed, HUMAN_ID, mine);
    expect(discountFor(staffed, HUMAN_ID, mine)).toBe(HOMETOWN_DISCOUNT);
    expect(cut.ask).toBe(Math.max(MIN_DP, Math.ceil(plain.ask * HOMETOWN_DISCOUNT)));
    // Read the Room came with tier 1: the floor is shown, discounted too.
    expect(cut.floor).not.toBeNull();
    expect(cut.floor).toBeLessThanOrEqual(cut.ask);
    // Meeting the discounted ask signs at the discounted number.
    const r = negotiate(staffed, HUMAN_ID, mine, { dp: cut.ask, years: cut.years });
    expect(r.result.accepted).toBe(true);
    expect(r.dynasty.contracts[mine]).toMatchObject({ teamId: HUMAN_ID, dp: cut.ask, how: 'resign' });
    // A free agent who is not his gets no discount.
    const stranger = Object.keys(d.contracts).find(k => d.contracts[k].teamId !== HUMAN_ID);
    expect(discountFor(staffed, HUMAN_ID, stranger)).toBe(1);
  });
});

describe('Sports Science', () => {
  it('starts the coach\'s players\' retirement risk a year later at tier 1 and two at tier 3', () => {
    const d = ownDynasty({ aging: true });
    expect(retireShift(d, HUMAN_ID)).toBe(0);
    expect(retireShift({ ...d, staff: { [HUMAN_ID]: { science: 1 } } }, HUMAN_ID)).toBe(1);
    expect(retireShift({ ...d, staff: { [HUMAN_ID]: { science: 2 } } }, HUMAN_ID)).toBe(1);
    expect(retireShift({ ...d, staff: { [HUMAN_ID]: { science: 3 } } }, HUMAN_ID)).toBe(2);
    expect(retireShift(d, null)).toBe(0);
    expect(retireChance(RETIRE_FROM - 2)).toBe(0);
    expect(retireChance(RETIRE_FROM)).toBeGreaterThan(0);
  });

  it('protects one named player from the year\'s roll, and the protection is spent at the turn of the year', () => {
    const rng = seeded(9);
    let d = ownDynasty({ aging: true });
    const mine = rosterKeys(d, HUMAN_ID)[0];
    expect(protectProblem(d, HUMAN_ID, mine)).toMatch(/tier 2/);
    expect(protectProblem({ ...d, aging: false, staff: { [HUMAN_ID]: { science: 2 } } }, HUMAN_ID, mine)).toMatch(/ten-year/);
    d = { ...d, staff: { [HUMAN_ID]: { science: 2 } } };
    const stranger = Object.keys(d.contracts).find(k => d.contracts[k].teamId !== HUMAN_ID);
    expect(protectProblem(d, HUMAN_ID, stranger)).toMatch(/not yours/);
    expect(protectProblem(d, HUMAN_ID, mine)).toBeNull();
    d = protectPlayer(d, HUMAN_ID, mine);
    expect(d.protected[HUMAN_ID]).toBe(mine);
    expect(d.news[0].text).toMatch(/protect/);
    // Age him to certain retirement; the roll is skipped, and the shield is spent.
    const old = { ...d, joined: { ...d.joined, [mine]: d.year - 20 } };
    expect(retireChance(ageOf(old, mine))).toBe(1);
    if (old.phase !== DPHASE.season) d = startSeason(old, { rng }); else d = old;
    const closed = endSeason(finishSeason(d), { rng });
    expect(closed.contracts[mine]).toBeTruthy();
    expect(closed.retired ?? []).not.toContain(mine);
    expect(closed.protected).toEqual({});
    // Unprotected, the same man goes.
    const bare = { ...d, protected: {} };
    const gone = endSeason(finishSeason(bare), { rng });
    expect(gone.retired).toContain(mine);
  });
});
