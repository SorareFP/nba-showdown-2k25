// The dynasty: a finite league, a DP payroll, drafts, free agency, ten years.
import { describe, it, expect } from 'vitest';
import {
  createDynasty, HUMAN_ID, MIN_ROSTER, MAX_ROSTER, DPHASE, RANDOM_POOL_PER_TEAM, FANTASY_ROUNDS,
  rosterKeys, contractsOf, payroll, freeAgentKeys, universe, rightsOf, quote, negotiate, waive,
  onClock, draftPick, draftAvailable, simDraft, aiDraftChoice, finishDraft, closeSigning, nextFaDay, fillRoster,
  startSeason, endSeason, closeResign, lotteryOdds, drawLottery, signRookie, closeRookies, classFor,
  projectedPayroll, summarizeDynasty, deadMoney, leagueKeys, passPick, DRAFT_CLASS_PER_TEAM, ROOKIE_ROUNDS,
  baseAge, ageOf, retireChance, endDynasty,
} from './dynasty.js';
import { CAP_DP, APRON_DP, FA_DAYS, fairDp, PERSONALITIES } from './dynastyMarket.js';
import { dynastyYearEarnings, dynastyCompletionEarnings, dynastyClaim, DYNASTY_YEARS, SEASON_REWARDS } from './prizes.js';
import { buildAiLeague } from './aiTeams.js';
import { recordResult, roundFixtures, advance, totalRounds, PHASE } from './season.js';
import { CARDS } from '../cards.js';
import { getCardByKey, cardKey, CARD_SETS } from '../cardSets.js';

const seeded = (s = 808) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
const BASE_IDS = new Set(CARDS.map(c => c.id));

function ownDynasty({ size = 4, length = 'short', roster = null, seed = 2 } = {}) {
  const brought = roster ?? buildAiLeague(1, { rng: seeded(1) })[0].roster;
  return createDynasty({ id: 'dyn', size, length, startMode: 'own', rng: seeded(seed), human: { name: 'Me', roster: brought } });
}

function fantasyDynasty({ size = 4, length = 'short', startMode = 'fantasy-full', seed = 3 } = {}) {
  return createDynasty({ id: 'fan', size, length, startMode, rng: seeded(seed), human: { name: 'Me' } });
}

/** Run a draft to the end, the human taking what the AI would take for him. */
function driveDraft(d, rng) {
  let x = d;
  for (let guard = 0; guard < 500; guard += 1) {
    x = simDraft(x, { rng });
    const clock = onClock(x);
    if (!clock) break;
    x = draftPick(x, clock.teamId, aiDraftChoice(x, clock.teamId, rng));
  }
  return x;
}

/** Feed the live season results to its end: home wins, then the higher seed. */
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

/**
 * Contracts + rights + free agents is the league; nobody is both in the
 * league and waiting in the draft pool; one of each person everywhere.
 */
function expectConserved(d) {
  const league = leagueKeys(d);
  const held = [...Object.keys(d.contracts), ...Object.keys(d.rights)];
  expect(new Set(held).size).toBe(held.length);
  expect(held.every(k => league.includes(k))).toBe(true);
  // ...and the retired, who are neither held nor free.
  expect(held.length + freeAgentKeys(d).length + (d.retired ?? []).length).toBe(league.length);
  const waiting = new Set(d.draftPool);
  expect(league.some(k => waiting.has(k))).toBe(false);
  const persons = universe(d).map(k => getCardByKey(k)?.id);
  expect(persons.every(Boolean)).toBe(true);
  expect(new Set(persons).size).toBe(persons.length);
}

/** Every offseason decision the human could make, made the lazy way. */
function autoYear(d, rng) {
  let x = d;
  if (x.phase === DPHASE.resign) x = closeResign(x);
  if (x.phase === DPHASE.lottery) x = drawLottery(x, { rng });
  if (x.phase === DPHASE.rookieDraft) x = finishDraft(driveDraft(x, rng), { rng });
  if (x.phase === DPHASE.rookies) {
    for (const key of rightsOf(x, HUMAN_ID, 'rookie')) {
      try { x = signRookie(x, HUMAN_ID, key); } catch { /* full or over the apron: let him go */ }
    }
    x = closeRookies(x, { rng });
  }
  for (let guard = 0; guard < 10 && x.phase === DPHASE.freeAgency; guard += 1) x = nextFaDay(x, { rng });
  if (x.phase === DPHASE.preseason) x = startSeason(fillRoster(x, HUMAN_ID), { rng });
  if (x.phase === DPHASE.season) x = endSeason(finishSeason(x), { rng });
  return x;
}

describe('bringing your own team', () => {
  it('puts every roster on staggered contracts at fair value, and opens in the preseason', () => {
    const d = ownDynasty();
    expect(d.phase).toBe(DPHASE.preseason);
    expect(d.teams).toHaveLength(4);
    for (const t of d.teams) expect(rosterKeys(d, t.id)).toHaveLength(10);
    const mine = contractsOf(d, HUMAN_ID);
    for (const k of mine) {
      expect(k.dp).toBe(fairDp(k.card));
      expect(k.years).toBeGreaterThanOrEqual(1);
      expect(k.years).toBeLessThanOrEqual(3);
    }
    expectConserved(d);
  });

  it('bringing any card of a player takes his base card out of the league', () => {
    const special = CARD_SETS['super-season'].find(c => BASE_IDS.has(c.id));
    const filler = CARDS.filter(c => c.id !== special.id).slice(0, 9);
    const d = ownDynasty({ roster: [special, ...filler] });
    expect(d.league).toContain(cardKey(special));
    expect(universe(d).map(k => getCardByKey(k).id).filter(id => id === special.id)).toHaveLength(1);
    expectConserved(d);
  });

  it('refuses two cards of one player', () => {
    const c = CARDS[0];
    const twin = CARD_SETS['super-season'].find(x => x.id === c.id) ?? { ...c, set: 'super-season' };
    expect(() => ownDynasty({ roster: [c, twin] })).toThrow(/one card per player/);
  });

  it('carries the playoff series picked at setup into every year', () => {
    const brought = buildAiLeague(1, { rng: seeded(1) })[0].roster;
    const d = createDynasty({ id: 'S', size: 8, length: 'online', startMode: 'own', series: [3, 3, 7], rng: seeded(3), human: { name: 'Me', roster: brought } });
    expect(d.series).toEqual([3, 3, 7]);
    expect(startSeason(d, { rng: seeded(4) }).season.series).toEqual([3, 3, 7]);
  });
});

describe('the fantasy draft', () => {
  it('snakes ten rounds and stops for you', () => {
    const d = fantasyDynasty();
    expect(d.phase).toBe(DPHASE.draft);
    expect(d.draft.order).toHaveLength(4 * FANTASY_ROUNDS);
    expect(d.draft.order.slice(4, 8)).toEqual([...d.draft.order.slice(0, 4)].reverse());
    const x = simDraft(d, { rng: seeded(4) });
    expect(onClock(x).teamId).toBe(HUMAN_ID);
    const other = d.teams.find(t => t.id !== HUMAN_ID).id;
    expect(() => draftPick(x, other, draftAvailable(x)[0])).toThrow(/not on the clock/);
  });

  it('keeps a running total of what your picks will ask', () => {
    let x = simDraft(fantasyDynasty(), { rng: seeded(4) });
    const star = [...draftAvailable(x)].sort((a, b) => getCardByKey(b).salary - getCardByKey(a).salary)[0];
    x = draftPick(x, HUMAN_ID, star);
    expect(projectedPayroll(x, HUMAN_ID)).toBeGreaterThanOrEqual(fairDp(getCardByKey(star)) * 0.75);
    expect(rightsOf(x, HUMAN_ID, 'draft')).toEqual([star]);
  });

  it('then everyone signs who they drafted, under the cap', () => {
    const rng = seeded(5);
    let d = finishDraft(driveDraft(fantasyDynasty(), rng), { rng });
    expect(d.phase).toBe(DPHASE.signing);
    expect(rightsOf(d, HUMAN_ID, 'draft')).toHaveLength(FANTASY_ROUNDS);
    for (const t of d.teams.filter(t => !t.human)) {
      expect(payroll(d, t.id)).toBeLessThanOrEqual(CAP_DP);
      expect(rightsOf(d, t.id)).toHaveLength(0);
    }
    // Pay the first draftee his ask: he signs.
    const key = rightsOf(d, HUMAN_ID, 'draft')[0];
    const q = quote(d, HUMAN_ID, key);
    const { dynasty, result } = negotiate(d, HUMAN_ID, key, { dp: q.ask, years: q.years });
    expect(result.accepted).toBe(true);
    expect(dynasty.contracts[key]).toMatchObject({ teamId: HUMAN_ID, dp: q.ask, years: q.years, how: 'draft' });
    d = dynasty;
    expectConserved(d);

    // Close signing: the rest walk into a free agency the AI is already bidding
    // in — the AI keeps a spot and DP back from the draft for exactly this.
    d = closeSigning(d, { rng });
    expect(d.phase).toBe(DPHASE.freeAgency);
    expect(Object.keys(d.fa.rivals).length).toBeGreaterThan(0);
    expect(rightsOf(d, HUMAN_ID)).toHaveLength(0);
    expect(rosterKeys(d, HUMAN_ID)).toHaveLength(1);
    for (let i = 0; i < FA_DAYS; i += 1) d = nextFaDay(d, { rng });
    expect(d.phase).toBe(DPHASE.preseason);
    for (const t of d.teams.filter(t => !t.human)) {
      expect(rosterKeys(d, t.id).length).toBeGreaterThanOrEqual(MIN_ROSTER);
      expect(rosterKeys(d, t.id).length).toBeLessThanOrEqual(MAX_ROSTER);
      expect(payroll(d, t.id)).toBeLessThanOrEqual(APRON_DP);
    }
    d = startSeason(fillRoster(d, HUMAN_ID), { rng });
    expect(d.phase).toBe(DPHASE.season);
    expect(d.season.teams.filter(t => t.human).map(t => t.id)).toEqual([HUMAN_ID]);
    expectConserved(d);
  });

  it('a draftee you let walk asks you more to come back', () => {
    const rng = seeded(5);
    let d = finishDraft(driveDraft(fantasyDynasty(), rng), { rng });
    const key = rightsOf(d, HUMAN_ID, 'draft').find(k => d.traits[k] !== 'happy' && fairDp(getCardByKey(k)) >= 8);
    const before = quote(d, HUMAN_ID, key).ask;
    d = closeSigning(d, { rng });
    expect(d.spurned[key]).toBe(HUMAN_ID);
    expect(quote(d, HUMAN_ID, key).ask).toBeGreaterThan(before);
    // A new season forgives.
    for (let i = 0; i < FA_DAYS; i += 1) d = nextFaDay(d, { rng });
    d = startSeason(fillRoster(d, HUMAN_ID), { rng });
    expect(d.spurned).toEqual({});
  });

  it('sends the players nobody drafted to the draft pool, not free agency', () => {
    const rng = seeded(5);
    const drafted = driveDraft(fantasyDynasty(), rng);
    const left = draftAvailable(drafted);
    expect(left).toHaveLength(CARDS.length - 4 * FANTASY_ROUNDS);
    const d = closeSigning(finishDraft(drafted, { rng }), { rng });
    const fa = new Set(freeAgentKeys(d));
    expect(left.some(k => fa.has(k))).toBe(false);
    expect(left.every(k => d.draftPool.includes(k))).toBe(true);
    expectConserved(d);
  });

  it('a random pool is smaller and still spans the price range', () => {
    const d = fantasyDynasty({ startMode: 'fantasy-random', size: 6 });
    expect(d.draft.pool).toHaveLength(6 * RANDOM_POOL_PER_TEAM);
    const salaries = d.draft.pool.map(k => getCardByKey(k).salary).sort((a, b) => a - b);
    expect(salaries[salaries.length - 1]).toBeGreaterThan(1200);
    expect(salaries[0]).toBeLessThan(300);
  });
});

describe('the rules of a signing', () => {
  it('will not sign past a full roster or over the cap', () => {
    let d = ownDynasty();
    const [top] = contractsOf(d, HUMAN_ID);
    d = waive(d, HUMAN_ID, top.key);                     // a free agent now; his DP stays on the books
    const full = fillRoster(d, HUMAN_ID, MAX_ROSTER);    // a camp invite takes the spot
    expect(() => negotiate(full, HUMAN_ID, top.key, { dp: 5, years: 2 })).toThrow(/full/);
    const q = quote(d, HUMAN_ID, top.key);
    expect(q.room).toBeLessThan(q.ask);
    expect(() => negotiate(d, HUMAN_ID, top.key, { dp: q.ask, years: q.years })).toThrow(/does not fit/);
  });

  it('takes a full ten to enter with your own team', () => {
    expect(() => ownDynasty({ roster: CARDS.slice(0, 9) })).toThrow(/10 players/);
    expect(freeAgentKeys(ownDynasty())).toHaveLength(0);   // nobody has been a free agent yet
  });

  it('fills a short roster with camp invites from the draft pool when no free agent is left', () => {
    const d = ownDynasty();
    const ai = d.teams[1].id;
    const gone = rosterKeys(d, ai).slice(0, 3);
    // Three of theirs retired: no contracts, not free agents, and nobody else on the market.
    const x = { ...d, contracts: Object.fromEntries(Object.entries(d.contracts).filter(([k]) => !gone.includes(k))), retired: gone };
    expect(freeAgentKeys(x)).toHaveLength(0);
    const y = fillRoster(x, ai);
    expect(rosterKeys(y, ai)).toHaveLength(MIN_ROSTER);
    expect(leagueKeys(y).length).toBe(leagueKeys(x).length + 1);
    expectConserved(y);
  });

  it('waiving leaves his DP on the books for the season ahead, and frees him', () => {
    const d = ownDynasty();
    const [top] = contractsOf(d, HUMAN_ID);
    const x = waive(d, HUMAN_ID, top.key);
    expect(deadMoney(x, HUMAN_ID)).toBe(top.dp);
    expect(payroll(x, HUMAN_ID)).toBe(payroll(d, HUMAN_ID));
    expect(freeAgentKeys(x)).toContain(top.key);
    expectConserved(x);
  });

  // Free agency after a fantasy draft: your unsigned draftees and the AI's
  // tenth picks are on the market, and you have a whole cap of room.
  const market = seed => {
    const rng = seeded(seed);
    return closeSigning(finishDraft(driveDraft(fantasyDynasty(), rng), { rng }), { rng });
  };

  it('signs a free agent who takes the offer', () => {
    const d = market(6);
    const q = freeAgentKeys(d).map(k => quote(d, HUMAN_ID, k)).sort((a, b) => a.ask - b.ask)[0];
    const { dynasty, result } = negotiate(d, HUMAN_ID, q.key, { dp: q.ask, years: q.years });
    expect(result.accepted).toBe(true);
    expect(dynasty.contracts[q.key].teamId).toBe(HUMAN_ID);
  });

  it('haggles: an insulting offer costs patience and does not move his ask', () => {
    const d = market(6);
    const q = freeAgentKeys(d).map(k => quote(d, HUMAN_ID, k)).find(x => x.pid !== 'happy' && x.ask >= 8);
    const { dynasty, result } = negotiate(d, HUMAN_ID, q.key, { dp: 1, years: q.years });
    expect(result.accepted).toBe(false);
    expect(result.mood).toBe('insulted');
    expect(dynasty.talks[q.key].patience).toBe(PERSONALITIES[q.pid].patience - 2);
    expect(result.ask).toBe(q.ask);
  });
});

describe('the turn of the year', () => {
  it('files the season, ticks the contracts, and opens the exclusive window', () => {
    const rng = seeded(9);
    let d = startSeason(ownDynasty(), { rng });
    const expiring = contractsOf(d, HUMAN_ID).filter(k => k.years === 1).map(k => k.key);
    d = endSeason(finishSeason(d), { rng });
    expect(d.phase).toBe(DPHASE.resign);
    expect(d.year).toBe(2);
    expect(d.history).toHaveLength(1);
    expect(rightsOf(d, HUMAN_ID, 'expiring').sort()).toEqual([...expiring].sort());
    // The AI has already decided on its own.
    for (const t of d.teams.filter(t => !t.human)) expect(rightsOf(d, t.id, 'expiring')).toHaveLength(0);
    expect(d.teams.every(t => t.last)).toBe(true);
    expectConserved(d);
  });

  it('refuses to close a season still being played', () => {
    const d = startSeason(ownDynasty(), { rng: seeded(1) });
    expect(() => endSeason(d)).toThrow(/not finished/);
  });

  it('runs the lottery for the teams that missed, worst first, and drafts players from outside the pool', () => {
    const rng = seeded(11);
    let d = endSeason(finishSeason(startSeason(ownDynasty(), { rng })), { rng });
    d = closeResign(d);
    expect(d.phase).toBe(DPHASE.lottery);
    const odds = lotteryOdds(d);
    expect(odds.entries.map(e => e.pct)).toEqual([66.7, 33.3]);
    expect(odds.draws).toBe(1);
    // The class: the next ten a team off the draft pool, none of them ever in the league.
    const upcoming = classFor(d);
    const before = new Set(leagueKeys(d));
    expect(upcoming).toHaveLength(DRAFT_CLASS_PER_TEAM * 4);
    expect(upcoming.some(k => before.has(k))).toBe(false);
    d = drawLottery(d, { rng });
    expect(d.lottery.order).toHaveLength(4);
    expect(d.lottery.order.slice(0, 2).sort()).toEqual(odds.entries.map(e => e.teamId).sort());
    expect(d.draft.pool).toEqual(upcoming);
    expect(d.draft.order).toHaveLength(ROOKIE_ROUNDS * 4);
    const waiting = d.draftPool.length;
    d = finishDraft(driveDraft(d, rng), { rng });
    // Two rounds taken; everyone else back on the end of the draft pool.
    expect(d.draftPool.length).toBe(waiting + upcoming.length - ROOKIE_ROUNDS * 4);
    expect(d.draftPool.slice(-(upcoming.length - ROOKIE_ROUNDS * 4)).every(k => upcoming.includes(k))).toBe(true);
    expect(d.phase).toBe(DPHASE.rookies);
    for (const t of d.teams.filter(t => !t.human)) expect(rightsOf(d, t.id, 'rookie')).toHaveLength(0);
    d = closeRookies(d, { rng });
    expect(d.phase).toBe(DPHASE.freeAgency);
    expectConserved(d);
  });
});

describe('aging (2026-09-11)', () => {
  const aged = (seed = 31) => createDynasty({
    id: 'A', size: 4, length: 'online', startMode: 'own', aging: true, rng: seeded(seed),
    human: { name: 'Me', roster: buildAiLeague(1, { rng: seeded(1) })[0].roster },
  });

  it('gives every card an age: base cards from 2025-26, special cards their own', () => {
    expect(CARDS.every(c => Number.isFinite(baseAge(cardKey(c))))).toBe(true);
    expect(Math.max(...CARDS.map(c => baseAge(cardKey(c))))).toBeGreaterThanOrEqual(38);
    const rookie = CARD_SETS.rookie.find(c => Number.isFinite(c.age));
    expect(baseAge(cardKey(rookie))).toBe(rookie.age);
  });

  it('retires nobody before 35 and everybody by 40', () => {
    expect([34, 35, 37, 39, 40, 44].map(retireChance)).toEqual([0, 1 / 6, 0.5, 5 / 6, 1, 1]);
  });

  it('ages the league a year a season, retires the old, and prices age into the ask', () => {
    const rng = seeded(32);
    let d = startSeason(aged(), { rng });
    const young = rosterKeys(d, HUMAN_ID).find(k => ageOf(d, k) < 30);
    const before = ageOf(d, young);
    d = endSeason(finishSeason(d), { rng });
    expect(ageOf(d, young)).toBe(before + 1);
    for (const k of d.retired) {
      expect(ageOf(d, k)).toBeGreaterThanOrEqual(35);
      expect(d.contracts[k]).toBeUndefined();
      expect(freeAgentKeys(d)).not.toContain(k);
    }
    expectConserved(d);
    // The same player, same team: older is cheaper past 31.
    const probe = rosterKeys(d, HUMAN_ID)[0];
    const at = age => quote({ ...d, joined: { ...d.joined, [probe]: d.year - (age - baseAge(probe)) } }, HUMAN_ID, probe).ask;
    expect(at(baseAge(probe) + 12)).toBeLessThanOrEqual(at(baseAge(probe)));
  });

  it('never ages or retires anyone in a ten-year dynasty', () => {
    const rng = seeded(33);
    let t = startSeason(ownDynasty(), { rng });
    const k = rosterKeys(t, HUMAN_ID)[0];
    const a0 = ageOf(t, k);
    t = endSeason(finishSeason(t), { rng });
    expect(ageOf(t, k)).toBe(a0);
    expect(t.retired).toEqual([]);
  });

  it('runs past ten years, and ends when you end it', () => {
    const rng = seeded(34);
    let d = aged();
    for (let guard = 0; guard < 80 && d.history.length < 11; guard += 1) {
      d = autoYear(d, rng);
      expectConserved(d);
    }
    expect(d.history).toHaveLength(11);
    expect(d.phase).not.toBe(DPHASE.done);
    expect(summarizeDynasty(d).years).toBeNull();
    expect(dynastyCompletionEarnings(d).coins).toBe(0);
    d = endDynasty(d);
    expect(d.phase).toBe(DPHASE.done);
    expect(dynastyCompletionEarnings(d).coins).toBeGreaterThan(0);
    expect(dynastyClaim(d, 11).error ?? null).not.toBe('No such year');
    expect(() => endDynasty(ownDynasty())).toThrow(/ten-year/);
  });
});

describe('passing', () => {
  it('lets you pass on an offseason pick, and never on a fantasy one', () => {
    const rng = seeded(12);
    let d = closeResign(endSeason(finishSeason(startSeason(ownDynasty(), { rng })), { rng }));
    d = simDraft(drawLottery(d, { rng }), { rng });
    expect(onClock(d).teamId).toBe(HUMAN_ID);
    const after = passPick(d, HUMAN_ID);
    expect(after.draft.picks.at(-1)).toMatchObject({ teamId: HUMAN_ID, key: null });
    expect(rightsOf(after, HUMAN_ID, 'rookie')).toHaveLength(0);
    expect(() => passPick(simDraft(fantasyDynasty(), { rng }), HUMAN_ID)).toThrow(/fantasy/);
  });
});

describe('ten years', () => {
  it('runs a whole fantasy dynasty to the end, legal every year, and pays for it', () => {
    const rng = seeded(21);
    let d = fantasyDynasty({ startMode: 'fantasy-random', seed: 22 });
    d = closeSigning(finishDraft(driveDraft(d, rng), { rng }), { rng });
    for (let guard = 0; guard < 40 && d.phase !== DPHASE.done; guard += 1) {
      d = autoYear(d, rng);
      expectConserved(d);
    }
    expect(d.phase).toBe(DPHASE.done);
    expect(d.history.map(h => h.year)).toEqual(Array.from({ length: DYNASTY_YEARS }, (_, i) => i + 1));
    const done = dynastyCompletionEarnings(d);
    expect(done.coins).toBeGreaterThanOrEqual(Math.floor(600 * 1.5));
    const s = summarizeDynasty(d);
    expect(s.phaseLabel).toBe('Complete');
    const year1 = dynastyYearEarnings(d, 1);
    const h = d.history[0];
    if (h.champion === HUMAN_ID) expect(year1.coins).toBe(SEASON_REWARDS.short.champion * 1.5);
  });

  it('pays nothing for the ten-year bonus before the tenth season is in', () => {
    const d = ownDynasty();
    expect(dynastyCompletionEarnings(d)).toEqual({ coins: 0, label: null });
  });
});
