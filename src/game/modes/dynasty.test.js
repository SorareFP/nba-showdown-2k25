// The dynasty: a finite league, a DP payroll, drafts, free agency, ten years.
import { describe, it, expect } from 'vitest';
import {
  createDynasty, HUMAN_ID, MIN_ROSTER, MAX_ROSTER, DPHASE, RANDOM_POOL_PER_TEAM, FANTASY_ROUNDS,
  rosterKeys, contractsOf, payroll, freeAgentKeys, universe, rightsOf, quote, negotiate, waive, renounce,
  onClock, draftPick, draftAvailable, simDraft, aiDraftChoice, finishDraft, closeSigning, nextFaDay, fillRoster,
  startSeason, endSeason, closeResign, lotteryOdds, drawLottery, signRookie, closeRookies, classFor,
  projectedPayroll, summarizeDynasty, deadMoney, leagueKeys, passPick, classSize, ROOKIE_ROUNDS, buildDraftClass,
  baseAge, ageOf, retireChance, endDynasty, lotteryWeights, contractFor, aiCapDp, aiApronDp, tradeProblems,
  rookieTerms, rookieCommitted, rookieProblem, teamOf, pickId, pickValue, projectedSlot,
} from './dynasty.js';
import { CAP_DP, APRON_DP, AI_APRON_DP, FA_DAYS, fairDp, PERSONALITIES, CONTRACT_YEARS, rookieScale, talentValue, contractValue } from './dynastyMarket.js';
import { getPlayerRarity } from '../rarity.js';
import { dynastyYearEarnings, dynastyCompletionEarnings, dynastyClaim, DYNASTY_YEARS, SEASON_REWARDS, FANTASY_DYNASTY_FACTOR } from './prizes.js';
import { buildAiLeague } from './aiTeams.js';
import { recordResult, roundFixtures, advance, totalRounds, standings, PHASE } from './season.js';
import { CARDS } from '../cards.js';
import { getCardByKey, cardKey, CARD_SETS } from '../cardSets.js';
import { packDynasty, unpackDynasty } from './seasonPack.js';

const seeded = (s = 808) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
const BASE_IDS = new Set(CARDS.map(c => c.id));

function ownDynasty({ size = 4, length = 'short', roster = null, seed = 2 } = {}) {
  const brought = roster ?? buildAiLeague(1, { rng: seeded(1) })[0].roster;
  return createDynasty({ id: 'dyn', size, length, startMode: 'own', rng: seeded(seed), human: { name: 'Me', roster: brought } });
}

function fantasyDynasty({ size = 4, length = 'short', startMode = 'fantasy-full', seed = 3 } = {}) {
  return createDynasty({ id: 'fan', size, length, startMode, rng: seeded(seed), human: { name: 'Me' } });
}

/** Run a draft to the end, the human taking what the AI would take for him — or passing, as the AI does, when nothing fits. */
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
  it('puts every roster on its REAL contract, and opens in the preseason', () => {
    const d = ownDynasty();
    expect(d.phase).toBe(DPHASE.preseason);
    expect(d.teams).toHaveLength(4);
    expect(rosterKeys(d, HUMAN_ID)).toHaveLength(10);
    for (const t of d.teams.filter(t => !t.human)) {
      expect(rosterKeys(d, t.id).length).toBeGreaterThanOrEqual(MIN_ROSTER);
      expect(rosterKeys(d, t.id).length).toBeLessThanOrEqual(MAX_ROSTER);
    }
    // The deal he is really on (the user, 2026-09-12), or what the card is
    // worth when the source has no row for him — a retro card, or a free agent.
    const mine = contractsOf(d, HUMAN_ID);
    for (const k of mine) {
      const real = contractFor(k.key);
      expect(k.dp).toBe(real?.dp ?? fairDp(k.card));
      expect(k.years).toBeGreaterThanOrEqual(1);
      expect(k.years).toBeLessThanOrEqual(real ? CONTRACT_YEARS.max : 3);
    }
    // A team of current NBA players is mostly on real contracts.
    expect(mine.filter(k => contractFor(k.key)).length).toBeGreaterThan(0);
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

  it('refuses two cards of one player ON ONE TEAM', () => {
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
      // The AI's own apron (115 at Prince), not the human's 130.
      expect(payroll(d, t.id)).toBeLessThanOrEqual(aiApronDp(d));
    }
    d = startSeason(fillRoster(d, HUMAN_ID), { rng });
    expect(d.phase).toBe(DPHASE.season);
    expect(d.season.teams.filter(t => t.human).map(t => t.id)).toEqual([HUMAN_ID]);
    expectConserved(d);
  });

  it('a draftee you let walk asks you more to come back', () => {
    const rng = seeded(5);
    let d = finishDraft(driveDraft(fantasyDynasty(), rng), { rng });
    // Not a max-deal star: his ask has room to go up by a quarter.
    const key = rightsOf(d, HUMAN_ID, 'draft').find(k => d.traits[k] !== 'happy' && fairDp(getCardByKey(k)) >= 8 && quote(d, HUMAN_ID, k).ask <= 25);
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
    // A FULL ROSTER AND A FREE AGENT WHO IS DEFINITELY STILL FREE. Naming the
    // man we waived made the test depend on his price being higher than every
    // other free agent's, because fillRoster takes the cheapest that fits and
    // only then falls back to a camp invite. The 2026-09-12 reprice moved him
    // under somebody, fill signed him straight back, and the failure read
    // "that player is not a free agent" rather than anything about a roster.
    // So the roster is filled first and a free agent is made afterwards, off
    // another team's books, where nothing this test does can consume him.
    const filled = fillRoster(d, HUMAN_ID, MAX_ROSTER);
    const rival = filled.teams.find(t => !t.human);
    const [rivalTop] = contractsOf(filled, rival.id);
    const full = waive(filled, rival.id, rivalTop.key);
    expect(() => negotiate(full, HUMAN_ID, rivalTop.key, { dp: 5, years: 2 })).toThrow(/full/);
    const q = quote(d, HUMAN_ID, top.key);
    expect(q.room).toBeLessThan(q.ask);
    expect(() => negotiate(d, HUMAN_ID, top.key, { dp: q.ask, years: q.years })).toThrow(/does not fit/);
  });

  it('takes a full ten to enter with your own team', () => {
    expect(() => ownDynasty({ roster: CARDS.slice(0, 9) })).toThrow(/10 players/);
  });

  it('fantasy-drafts the AI teams around your ten — on real contracts, and by position', () => {
    const d = ownDynasty({ size: 8 });
    const group = pos => ({ PG: 'G', SG: 'G', SF: 'F', PF: 'F', C: 'C' }[pos]);
    for (const t of d.teams.filter(t => !t.human)) {
      const keys = rosterKeys(d, t.id);
      // An own start has no signing period, so the AI's teams arrive on real
      // contracts too — and UNDER the AI's cap (the user, 2026-09-17: "they
      // should not bring in a team over that cap"); only the coach's own ten
      // may open over it.
      expect(payroll(d, t.id)).toBeGreaterThan(0);
      expect(payroll(d, t.id)).toBeLessThanOrEqual(aiCapDp(d));
      for (const k of keys) {
        const real = contractFor(k);
        if (real) expect(d.contracts[k].dp).toBe(real.dp);
      }
      const counts = { G: 0, F: 0, C: 0 };
      for (const k of keys) counts[group(getCardByKey(k).pos)] += 1;
      expect(counts.G).toBeGreaterThanOrEqual(2);
      expect(counts.F).toBeGreaterThanOrEqual(2);
      expect(counts.C).toBeGreaterThanOrEqual(1);
    }
    expect(d.phase).toBe(DPHASE.preseason);
    expectConserved(d);
  });

  it('fills a short roster with camp invites from the draft pool when no free agent is left', () => {
    const d = ownDynasty();
    const ai = d.teams[1].id;
    const gone = rosterKeys(d, ai).slice(0, 3);
    // Three of theirs retired: no contracts, not free agents, and nobody else on the market.
    const x = {
      ...d,
      contracts: Object.fromEntries(Object.entries(d.contracts).filter(([k]) => !gone.includes(k))),
      retired: [...gone, ...freeAgentKeys(d)],
    };
    expect(freeAgentKeys(x)).toHaveLength(0);
    const y = fillRoster(x, ai);
    expect(rosterKeys(y, ai)).toHaveLength(MIN_ROSTER);
    expect(leagueKeys(y).length).toBe(leagueKeys(x).length + (MIN_ROSTER - rosterKeys(x, ai).length));
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

// ── CAP AND APRON (the user, 2026-09-17) ───────────────────────────────────
//
// "The AI should be able to go over that cap to the same apron as humans,
// but they should not bring in a team over that cap." The human's apron is
// 130 (the NBA's proportions); the AI arrives at or under 100 and may grow to
// its own 115 through re-signings, picks and free agency; trades hold each
// side to its own apron, and a side over its cap after a deal takes back at
// most 125% of what it sends.
describe('cap and apron (2026-09-17)', () => {
  const topTen = () => [...CARDS].sort((a, b) => (b.salary ?? 0) - (a.salary ?? 0)).slice(0, 10);
  const stacked = (seed = 2) => createDynasty({ id: 'cap', size: 6, length: 'online', startMode: 'own', rng: seeded(seed), human: { name: 'Me', roster: topTen() } });

  it('is 100 / 130 for a human and 100 / 115 for an AI team at Prince, scaled by the rung', () => {
    expect(CAP_DP).toBe(100);
    expect(APRON_DP).toBe(130);
    expect(AI_APRON_DP).toBe(115);
    const d = ownDynasty();
    expect(aiCapDp(d)).toBe(100);
    expect(aiApronDp(d)).toBe(115);
    expect(aiApronDp({ ...d, aiLevel: 'deity' })).toBeGreaterThan(115);
  });

  it('an own start with a 300-DP human leaves every AI team at or under its cap — and spending most of it', () => {
    const d = stacked();
    expect(payroll(d, HUMAN_ID)).toBeGreaterThanOrEqual(250);
    for (const t of d.teams.filter(t => !t.human)) {
      expect(payroll(d, t.id)).toBeLessThanOrEqual(aiCapDp(d));
      // The ranking prices talent once (aiDraftChoice, 2026-09-17): a draft
      // priced on real contracts that charged for price twice took ten rookie
      // deals and left the cap two-thirds unspent.
      expect(payroll(d, t.id)).toBeGreaterThanOrEqual(80);
      expect(rosterKeys(d, t.id)).toHaveLength(MAX_ROSTER);
    }
    expectConserved(d);
  });

  it('after one full offseason every AI team is at or under its apron', () => {
    const rng = seeded(41);
    let d = stacked(3);
    d = autoYear(d, rng);            // the season, then the AI re-signs at the turn of the year
    expect(d.phase).toBe(DPHASE.resign);
    d = closeResign(d);              // the AI's trades, then the lottery...
    d = finishDraft(driveDraft(drawLottery(d, { rng }), rng), { rng });   // ...its picks...
    d = closeRookies(d, { rng });
    for (let guard = 0; guard < 10 && d.phase === DPHASE.freeAgency; guard += 1) d = nextFaDay(d, { rng });   // ...and free agency
    expect(d.phase).toBe(DPHASE.preseason);
    for (const t of d.teams.filter(t => !t.human)) expect(payroll(d, t.id)).toBeLessThanOrEqual(aiApronDp(d));
    expectConserved(d);
  });

  describe('the trade rule', () => {
    // A preseason with the books set by hand: every contract on a team at
    // `each` DP, and one player — the one in the deal — at `star`.
    const d0 = ownDynasty({ size: 4 });
    const ai = d0.teams.find(t => !t.human).id;
    const books = (d, teamId, each, key, star) => ({
      ...d,
      contracts: Object.fromEntries(Object.entries(d.contracts).map(([k, c]) => [k, c.teamId === teamId ? { ...c, dp: k === key ? star : each } : c])),
    });
    const mine = rosterKeys(d0, HUMAN_ID)[0];
    const theirs = rosterKeys(d0, ai)[0];
    const swap = { from: HUMAN_ID, to: ai, give: [mine], get: [theirs] };

    it('holds a human to 130 and an AI team to 115', () => {
      // Human 9×11 + 30 = 129, takes 36 for 30 → 135: past 130. Matching is fine (36 ≤ 37.5).
      let d = books(books(d0, HUMAN_ID, 11, mine, 30), ai, 8, theirs, 36);
      expect(payroll(d, HUMAN_ID)).toBe(129);
      expect(tradeProblems(d, swap).join(' ')).toMatch(/past the 130 apron/);
      // Human 9×10 + 30 = 120 → 126: fine.
      d = books(d, HUMAN_ID, 10, mine, 30);
      expect(tradeProblems(d, swap)).toEqual([]);
      // AI 9×9 + 30 = 111, takes 36 for 30 → 117: past ITS 115.
      d = books(books(d0, HUMAN_ID, 10, mine, 36), ai, 9, theirs, 30);
      expect(payroll(d, ai)).toBe(111);
      expect(tradeProblems(d, swap).join(' ')).toMatch(/past the 115 apron/);
      // A payroll already past its apron may still come DOWN (the user, 2026-09-12).
      d = books(books(d0, HUMAN_ID, 30, mine, 35), ai, 8, theirs, 30);
      expect(payroll(d, HUMAN_ID)).toBe(305);
      expect(tradeProblems(d, swap)).toEqual([]);
    });

    it('lets an over-cap side take back up to 125% of what it sends, and no more', () => {
      // Human 9×10 + 30 = 120: over the cap after any of these.
      const at = star => books(books(d0, HUMAN_ID, 10, mine, 30), ai, 5, theirs, star);
      expect(tradeProblems(at(37), swap)).toEqual([]);                      // 37 ≤ 37.5
      expect(tradeProblems(at(38), swap).join(' ')).toMatch(/at most 125%/);  // 38 > 37.5, and 128 is under the apron
      // Taking a player back for nothing while over the cap is the same rule.
      expect(tradeProblems(at(5), { from: HUMAN_ID, to: ai, give: [], get: [theirs] }).join(' ')).toMatch(/at most 125%/);
      // Under the cap after the deal, no matching: 9×5 + 10 = 55, takes 35 for 10 → 80.
      const room = books(books(d0, HUMAN_ID, 5, mine, 10), ai, 5, theirs, 35);
      expect(tradeProblems(room, swap)).toEqual([]);
    });
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
    // The NBA's odds, shared over a two-team lottery; both of its picks drawn.
    expect(odds.entries.map(e => e.pct)).toEqual([81.5, 18.5]);
    expect(odds.draws).toBe(2);
    // The class: two a team plus four, drawn from the draft pool a year ahead
    // and stored, none of them ever in the league.
    const upcoming = classFor(d);
    const before = new Set(leagueKeys(d));
    expect(upcoming).toHaveLength(classSize(4));
    expect(d.draftClass).toEqual({ year: d.year, keys: upcoming });
    expect(upcoming.some(k => before.has(k))).toBe(false);
    expect(upcoming.every(k => d.draftPool.includes(k))).toBe(true);
    d = drawLottery(d, { rng });
    expect(d.lottery.order).toHaveLength(4);
    expect(d.lottery.order.slice(0, 2).sort()).toEqual(odds.entries.map(e => e.teamId).sort());
    expect(d.draft.pool).toEqual(upcoming);
    expect(d.draft.order).toHaveLength(ROOKIE_ROUNDS * 4);
    // Next year's class is drawn the moment this one leaves the pool.
    const next = d.draftClass;
    expect(next.year).toBe(d.year + 1);
    expect(next.keys).toHaveLength(classSize(4));
    expect(next.keys.some(k => upcoming.includes(k))).toBe(false);
    const waiting = d.draftPool.length;
    d = finishDraft(driveDraft(d, rng), { rng });
    // Two rounds taken (a team may pass); everyone else back on the end of the draft pool.
    const taken = d.draft.picks.filter(p => p.key).length;
    expect(taken).toBeGreaterThan(0);
    expect(d.draftPool.length).toBe(waiting + upcoming.length - taken);
    expect(d.draftPool.slice(-(upcoming.length - taken)).every(k => upcoming.includes(k))).toBe(true);
    expect(d.phase).toBe(DPHASE.rookies);
    expect(d.draftClass).toEqual(next);
    expect(classFor(d)).toEqual(next.keys);
    // The AI signed what fit at the scale; anything else is still ITS RIGHTS — nothing is renounced at the draft.
    const held = d.teams.filter(t => !t.human).reduce((t, x) => t + rightsOf(d, x.id, 'rookie').length, 0);
    const signed = Object.values(d.contracts).filter(k => k.how === 'rookie' && k.since === d.year).length;
    expect(signed + held).toBe(d.draft.picks.filter(p => p.key && !d.teams.find(t => t.id === p.teamId)?.human).length);
    d = closeRookies(d, { rng });
    expect(d.phase).toBe(DPHASE.freeAgency);
    expectConserved(d);
  });
});

// ── THE CLASS, THE SCALE AND THE RIGHTS WINDOW (the user, 2026-09-17) ───────
//
// "The class is way way way too good"; nobody signed their picks. So: the
// class is DRAWN by rarity, a pick costs its SLOT, and a drafted player is
// his team's rights until the season starts.
describe('the draft class (2026-09-17)', () => {
  const band = k => getPlayerRarity(getCardByKey(k));
  const count = (keys, b) => keys.filter(k => band(k) === b).length;
  // A fresh eight-team league's pool: every base leftover and the special-set persons.
  const league = createDynasty({ id: 'C', size: 8, length: 'online', startMode: 'own', rng: seeded(2), human: { name: 'Me', roster: buildAiLeague(1, { rng: seeded(1) })[0].roster } });

  it('is two a team plus four, drawn from the pool, one of each person', () => {
    const cls = buildDraftClass(league, seeded(5));
    expect(cls).toHaveLength(classSize(8));
    expect(classSize(8)).toBe(20);
    expect(new Set(cls).size).toBe(cls.length);
    expect(cls.every(k => league.draftPool.includes(k))).toBe(true);
    // Pure: the pool is untouched.
    expect(league.draftPool.length).toBeGreaterThan(cls.length);
  });

  it('lands on the target odds over many draws: a legendary about 0.15, never two; at least one rare; a second super-rare sometimes', () => {
    const rng = seeded(77);
    const n = 400;
    let legendary = 0;
    let twoSuper = 0;
    let anySuper = 0;
    const rares = [];
    for (let i = 0; i < n; i += 1) {
      const cls = buildDraftClass(league, rng);
      const L = count(cls, 'legendary');
      expect(L).toBeLessThanOrEqual(1);
      legendary += L;
      const S = count(cls, 'super-rare');
      expect(S).toBeLessThanOrEqual(2);
      if (S >= 1) anySuper += 1;
      if (S === 2) twoSuper += 1;
      const R = count(cls, 'rare');
      expect(R).toBeGreaterThanOrEqual(1);
      expect(R).toBeLessThanOrEqual(4);
      rares.push(R);
      expect(cls).toHaveLength(classSize(8));
    }
    expect(legendary / n).toBeGreaterThan(0.09);
    expect(legendary / n).toBeLessThan(0.22);
    expect(anySuper / n).toBeGreaterThan(0.5);
    expect(anySuper / n).toBeLessThan(0.7);
    expect(twoSuper / n).toBeGreaterThan(0.03);
    expect(twoSuper / n).toBeLessThan(0.16);
    // 1 + 0.6 + 0.6×0.35 + 0.6×0.35×0.15 ≈ 1.84 rares a class.
    const meanRares = rares.reduce((t, r) => t + r, 0) / n;
    expect(meanRares).toBeGreaterThan(1.6);
    expect(meanRares).toBeLessThan(2.1);
  });

  it('falls to the band below when a band is empty, and is decided once a year', () => {
    // A pool with no legendaries at all: the 0.15 seat goes to a super-rare.
    const thin = { ...league, draftPool: league.draftPool.filter(k => band(k) !== 'legendary') };
    const always = () => 0;   // every roll lands
    const cls = buildDraftClass(thin, always);
    expect(count(cls, 'legendary')).toBe(0);
    expect(count(cls, 'super-rare')).toBe(3);   // the legendary's seat, then two of its own
    expect(count(cls, 'rare')).toBe(4);
    // Nothing but commons: the whole class is common.
    const bare = { ...league, draftPool: league.draftPool.filter(k => band(k) === 'common') };
    expect(buildDraftClass(bare, always).every(k => band(k) === 'common')).toBe(true);
    // Nothing BELOW rare left to fill with: the filler seats take the nearest
    // band above rather than spin forever (they did, until 2026-09-18).
    const top = { ...league, draftPool: league.draftPool.filter(k => ['legendary', 'super-rare', 'rare'].includes(band(k))) };
    const full = buildDraftClass(top, seeded(3));
    expect(full).toHaveLength(Math.min(classSize(8), top.draftPool.length));
    expect(new Set(full).size).toBe(full.length);
  });

  // ONE class a year (the verifiers, 2026-09-18): the class a pick was valued
  // on in the season is the class that is drafted — closeResign drew a second,
  // different one until then.
  it('is the same class from the day it is drawn to its draft, and a pick is worth the same across the window', () => {
    const rng = seeded(11);
    let d = ownDynasty();
    // Year two's class is drawn at the league's opening.
    expect(d.draftClass.year).toBe(2);
    const drawn = d.draftClass.keys;
    expect(classFor(d)).toEqual(drawn);
    d = startSeason(d, { rng });
    expect(classFor(d)).toEqual(drawn);
    d = endSeason(finishSeason(d), { rng });
    expect(d.phase).toBe(DPHASE.resign);
    expect(classFor(d)).toEqual(drawn);
    const pick = pickId(d.year, 1, HUMAN_ID);
    const before = pickValue(d, pick, HUMAN_ID);
    d = closeResign(d, { rng });
    expect(d.draftClass).toEqual({ year: d.year, keys: drawn });
    expect(pickValue(d, pick, HUMAN_ID)).toBe(before);
    d = drawLottery(d, { rng });
    expect(d.draft.pool).toEqual(drawn);
    expect(drawn.some(k => d.draftPool.includes(k))).toBe(false);
    // During the draft, classFor is NEXT year's — what next year's picks are valued on.
    expect(classFor(d)).toEqual(d.draftClass.keys);
    expect(d.draftClass.year).toBe(d.year + 1);
  });

  it('is never taken by a camp invite', () => {
    // An own start opens with no free agents, so an AI fill reaches into the pool.
    let d = ownDynasty({ size: 8 });
    const drawn = new Set(d.draftClass.keys);
    const ai = d.teams.find(t => !t.human).id;
    const pool = d.draftPool.length;
    for (const key of rosterKeys(d, ai).slice(3)) d = waive(d, ai, key);
    d = fillRoster(d, ai, MAX_ROSTER);
    expect(d.draftPool.length).toBeLessThan(pool);
    expect([...drawn].every(k => d.draftPool.includes(k))).toBe(true);
    expect(d.draftClass.keys).toEqual([...drawn]);
  });
});

describe('the rights window (2026-09-17)', () => {
  // An own start through its first offseason to the draft, the human's picks made by the AI's logic.
  const toDraft = (seed = 12) => {
    const rng = seeded(seed);
    let d = closeResign(endSeason(finishSeason(startSeason(ownDynasty({ size: 6 }), { rng })), { rng }), { rng });
    d = finishDraft(driveDraft(drawLottery(d, { rng }), rng), { rng });
    return { d, rng };
  };

  it('prices a pick by its slot, and the AI signs what fits at the draft — no renouncing', () => {
    const { d } = toDraft();
    for (const p of d.draft.picks.filter(p => p.key)) {
      const terms = rookieScale(p.n, d.teams.length);
      const c = d.contracts[p.key];
      if (c) expect(c).toMatchObject({ teamId: p.teamId, dp: terms.dp, years: 3, how: 'rookie' });
      else expect(d.rights[p.key]).toMatchObject({ teamId: p.teamId, kind: 'rookie', pick: p.n });
      expect(freeAgentKeys(d)).not.toContain(p.key);
    }
    expect(d.news.some(n => /lapse/.test(n.text))).toBe(false);
  });

  it('lets a human sign a pick in free agency and the preseason, and lapses the rest when the season starts', () => {
    // Books set by hand: the human at 100 DP with two picks, so one fits under the apron and the second does not until a waive.
    const { d: drafted, rng } = toDraft();
    const mine = rightsOf(drafted, HUMAN_ID, 'rookie');
    // This seed hands the human picks; a seed that did not would test nothing.
    expect(mine.length).toBeGreaterThan(0);
    const [first] = mine;
    let d = closeRookies(drafted, { rng });
    expect(d.phase).toBe(DPHASE.freeAgency);
    expect(rightsOf(d, HUMAN_ID, 'rookie')).toEqual(mine);
    expect(projectedPayroll(d, HUMAN_ID)).toBe(payroll(d, HUMAN_ID) + rookieCommitted(d, HUMAN_ID));
    // Signable in free agency, at the slot's price, up to the apron — and not past it.
    const terms = rookieTerms(d, first);
    expect(terms).toEqual({ dp: rookieScale(d.rights[first].pick, 6).dp, years: 3 });
    const broke = { ...d, dead: [...d.dead, { teamId: HUMAN_ID, key: 'x', dp: APRON_DP, through: d.year }] };
    expect(rookieProblem(broke, HUMAN_ID, first)).toMatch(/apron/);
    expect(() => signRookie(broke, HUMAN_ID, first)).toThrow(/apron/);
    d = signRookie(d, HUMAN_ID, first);
    expect(d.contracts[first]).toMatchObject({ teamId: HUMAN_ID, dp: terms.dp, years: 3, how: 'rookie' });
    // Through free agency into the preseason the rest are still rights.
    for (let guard = 0; guard < 10 && d.phase === DPHASE.freeAgency; guard += 1) d = nextFaDay(d, { rng });
    expect(d.phase).toBe(DPHASE.preseason);
    const left = rightsOf(d, HUMAN_ID, 'rookie');
    expect(left).toEqual(mine.slice(1));
    for (const k of left) expect(freeAgentKeys(d)).not.toContain(k);
    // The deadline: the human's unsigned picks lapse to free agency; an AI
    // team's either lapse too or — shedding its worst contract for a better
    // player — sign at the scale as the season starts.
    const unsigned = d.teams.flatMap(t => rightsOf(d, t.id, 'rookie'));
    d = startSeason(fillRoster(d, HUMAN_ID), { rng });
    for (const k of unsigned) {
      expect(d.rights[k]).toBeUndefined();
      expect(leagueKeys(d)).toContain(k);
      if (d.contracts[k]) expect(d.contracts[k]).toMatchObject({ how: 'rookie', years: 3 });
    }
    for (const k of left) expect(d.contracts[k]).toBeUndefined();
    expect(d.teams.every(t => rightsOf(d, t.id, 'rookie').length === 0)).toBe(true);
    if (left.length) expect(d.news.some(n => /lapse unsigned/.test(n.text))).toBe(true);
    expectConserved(d);
  });

  it('a pick is not a free agent in the window, and cannot be signed in season', () => {
    const { d, rng } = toDraft();
    const held = d.teams.flatMap(t => rightsOf(d, t.id, 'rookie'));
    for (const k of held) expect(freeAgentKeys(d)).not.toContain(k);
    let x = closeRookies(d, { rng });
    for (let guard = 0; guard < 10 && x.phase === DPHASE.freeAgency; guard += 1) x = nextFaDay(x, { rng });
    x = startSeason(fillRoster(x, HUMAN_ID), { rng });
    const key = rosterKeys(x, HUMAN_ID)[0];
    expect(rookieProblem({ ...x, rights: { [key]: { teamId: HUMAN_ID, kind: 'rookie', pick: 1 } } }, HUMAN_ID, key)).toMatch(/between the draft and the season/);
  });
});

describe('the AI drafts what it can sign (2026-09-17)', () => {
  it('takes the best player for the roster when the slot fits its books, and passes when nothing fits and no shed helps', () => {
    const rng = seeded(13);
    let d = closeResign(endSeason(finishSeason(startSeason(ownDynasty({ size: 6 }), { rng })), { rng }), { rng });
    d = simDraft(drawLottery(d, { rng }), { rng });
    const clock = onClock(d);
    expect(clock.teamId).toBe(HUMAN_ID);
    const ai = d.teams.find(t => !t.human).id;
    // Pretend the AI team is on this clock. Rich books: the best two by talent × need.
    const rich = { ...d, contracts: Object.fromEntries(Object.entries(d.contracts).map(([k, c]) => [k, c.teamId === ai ? { ...c, dp: 1 } : c])) };
    const choice = aiDraftChoice({ ...rich, draft: { ...rich.draft, order: rich.draft.order.map((t, i) => (i === rich.draft.picks.length ? ai : t)) } }, ai, () => 0);
    const best = [...draftAvailable(rich)].sort((a, b) => talentValue(getCardByKey(b)) - talentValue(getCardByKey(a)))[0];
    expect(talentValue(getCardByKey(choice))).toBeGreaterThanOrEqual(0.7 * talentValue(getCardByKey(best)));
    // Books at the apron: nothing fits, and shedding does not free room this season (dead money), so it passes.
    // The roster is topped up to the floor first: a team BELOW it drafts past
    // its apron (2026-09-18, 'a short-handed AI team' below), so the pass is
    // pinned on the team this test always meant — one that can take the floor.
    const atFloor = { ...d, contracts: { ...d.contracts } };
    const spare = d.draftPool.filter(k => !d.draft.pool.includes(k));
    const short = MIN_ROSTER - rosterKeys(d, ai).length - rightsOf(d, ai).length;
    for (const k of spare.slice(0, Math.max(0, short))) atFloor.contracts[k] = { teamId: ai, dp: 1, years: 1, since: d.year, how: 'fill' };
    expect(rosterKeys(atFloor, ai).length + rightsOf(atFloor, ai).length).toBeGreaterThanOrEqual(MIN_ROSTER);
    const poor = { ...atFloor, dead: [...d.dead, { teamId: ai, key: 'x', dp: aiApronDp(d), through: d.year }] };
    const at = { ...poor, draft: { ...poor.draft, order: poor.draft.order.map((t, i) => (i === poor.draft.picks.length ? ai : t)) } };
    expect(aiDraftChoice(at, ai, () => 0)).toBeNull();
    // ...and simDraft turns that null into a pass, not a throw.
    const passed = simDraft(at, { rng });
    expect(passed.draft.picks[at.draft.picks.length]).toMatchObject({ teamId: ai, key: null });
    // A full roster with money: it takes the best player when shedding its weakest man (shedCandidate) frees a seat for him.
    // Full counts the picks it already holds this draft — each has a seat
    // waiting (aiDraftChoice's `mine`); the class-seed change of 2026-09-18
    // gave this seed's AI team a pick before this clock, and a roster of ten
    // plus that right had no seat even after a shed.
    const full = { ...rich, contracts: { ...rich.contracts } };
    const seats = MAX_ROSTER - rosterKeys(rich, ai).length - rightsOf(rich, ai).length;
    const board = draftAvailable(rich);
    const extra = board.slice(board.length - Math.max(0, seats));
    for (const k of extra) full.contracts[k] = { teamId: ai, dp: 1, years: 1, since: 1, how: 'fill' };
    full.draft = { ...full.draft, pool: full.draft.pool.filter(k => !extra.includes(k)), order: full.draft.order.map((t, i) => (i === full.draft.picks.length ? ai : t)) };
    expect(rosterKeys(full, ai).length + rightsOf(full, ai).length).toBe(MAX_ROSTER);
    const shedPick = aiDraftChoice(full, ai, () => 0);
    expect(shedPick).not.toBeNull();
    expect(talentValue(getCardByKey(shedPick))).toBe(Math.max(...draftAvailable(full).map(k => talentValue(getCardByKey(k)))));
  });

  it('budgets on the price of the slot on the clock and the scale of the rights it already holds', () => {
    // The two halves of the AI's draft budget (verifier, 2026-09-18): pricing
    // every pick as pick 1, or forgetting the picks it holds, passed the whole
    // suite. An eight-team league on the clock at overall pick n, the AI team
    // given exactly `room` DP under its apron by a dead-money entry.
    const rng = seeded(15);
    const base = drawLottery(closeResign(endSeason(finishSeason(startSeason(ownDynasty({ size: 8 }), { rng })), { rng }), { rng }), { rng });
    expect(base.phase).toBe(DPHASE.rookieDraft);
    const ai = base.teams.find(t => !t.human).id;
    const rights = Object.fromEntries(Object.entries(base.rights ?? {}).filter(([, r]) => !(r.teamId === ai && r.kind === 'rookie')));
    // Two open spots, so the held right below leaves a spot and only the money
    // decides; the rest at 1 DP a man, so the dead money can set any room.
    const contracts = Object.fromEntries(Object.entries(base.contracts).map(([k, c]) => [k, c.teamId === ai ? { ...c, dp: 1 } : c]));
    for (const k of rosterKeys(base, ai).slice(MAX_ROSTER - 2)) delete contracts[k];
    const cleared = { ...base, rights, contracts };
    expect(rosterKeys(cleared, ai).length).toBeLessThanOrEqual(MAX_ROSTER - 2);
    const onPick = (x, n, room) => {
      const picks = Array.from({ length: n - 1 }, (_, i) => ({ n: i + 1, round: Math.floor(i / 8) + 1, teamId: x.draft.order[i], key: null }));
      const order = x.draft.order.map((t, i) => (i === n - 1 ? ai : t));
      const gap = aiApronDp(x) - payroll(x, ai) - rookieCommitted(x, ai) - room;
      expect(gap).toBeGreaterThanOrEqual(0);
      const y = { ...x, dead: [...x.dead, { teamId: ai, key: 'x', dp: gap, through: x.year }], draft: { ...x.draft, picks, order } };
      expect(onClock(y)).toMatchObject({ n, teamId: ai });
      return y;
    };
    // 10 DP at pick 1, 5 at the last of round one, 3 and 2 across round two.
    for (const [n, dp] of [[1, 10], [8, 5], [9, 3], [16, 2]]) {
      expect(rookieScale(n, 8).dp).toBe(dp);
      expect(aiDraftChoice(onPick(cleared, n, dp), ai, () => 0)).not.toBeNull();
      expect(aiDraftChoice(onPick(cleared, n, dp - 1), ai, () => 0)).toBeNull();
    }
    // A right it already holds, from pick 8, reserves its 5 DP: ten DP of room
    // before it no longer buys pick 1, fifteen does.
    const held = cleared.draftPool.find(k => !cleared.draft.pool.includes(k));
    const holding = { ...cleared, rights: { ...cleared.rights, [held]: { teamId: ai, kind: 'rookie', pick: 8 } } };
    expect(rookieCommitted(holding, ai)).toBe(5);
    const tenBefore = onPick(holding, 1, 10 - 5);
    expect(aiApronDp(tenBefore) - payroll(tenBefore, ai)).toBe(10);
    expect(aiDraftChoice(tenBefore, ai, () => 0)).toBeNull();
    expect(aiDraftChoice(onPick(holding, 1, 15 - 5), ai, () => 0)).not.toBeNull();
  });

  it('by the season every AI pick is signed or lapsed, every roster legal, every payroll under its apron', () => {
    const rng = seeded(14);
    let d = ownDynasty({ size: 8 });
    d = autoYear(d, rng);
    d = closeResign(d, { rng });
    d = finishDraft(driveDraft(drawLottery(d, { rng }), rng), { rng });
    const picks = d.draft.picks.filter(p => p.key && !d.teams.find(t => t.id === p.teamId)?.human);
    expect(picks.length).toBeGreaterThan(0);
    d = closeRookies(d, { rng });
    for (let guard = 0; guard < 10 && d.phase === DPHASE.freeAgency; guard += 1) d = nextFaDay(d, { rng });
    d = startSeason(fillRoster(d, HUMAN_ID), { rng });
    for (const t of d.teams) expect(rightsOf(d, t.id, 'rookie')).toHaveLength(0);
    for (const t of d.teams.filter(t => !t.human)) {
      expect(payroll(d, t.id)).toBeLessThanOrEqual(aiApronDp(d));
      expect(rosterKeys(d, t.id).length).toBeGreaterThanOrEqual(MIN_ROSTER);
      expect(rosterKeys(d, t.id).length).toBeLessThanOrEqual(MAX_ROSTER);
    }
    // An AI pick it drafted to its books is on a scale contract, not renounced at the draft.
    const signed = picks.filter(p => d.contracts[p.key]?.how === 'rookie').length;
    expect(signed).toBeGreaterThan(0);
    expectConserved(d);
  });
});

// ── BUDGETING FOR THE PICKS, AND THE SHORT-HANDED TEAM (2026-09-18) ────────
// A verifier's own starts passed 192 of 420 AI rookie slots, 21 of 30 first-
// overall picks among them: aiResign re-signed to the apron holding nothing
// back, the draft passed for money, and fillRoster then signed a free agent
// past the apron anyway.
describe('the AI budgets for its picks (2026-09-18)', () => {
  it('a short-handed AI team at its apron drafts pick 1, has him under contract at tip-off, and no free agent takes it past the apron', () => {
    const rng = seeded(16);
    const base = drawLottery(closeResign(endSeason(finishSeason(startSeason(ownDynasty({ size: 8 }), { rng })), { rng }), { rng }), { rng });
    expect(base.phase).toBe(DPHASE.rookieDraft);
    expect(base.draft.picks).toHaveLength(0);
    // An AI team that also holds one of its own picks in this draft, so pick 1
    // and that one take it from six to the floor of eight.
    const ai = base.teams.find(t => !t.human && base.draft.order.slice(1).includes(t.id)).id;
    const contracts = { ...base.contracts };
    for (const k of rosterKeys(base, ai).slice(6)) delete contracts[k];
    const six = { ...base, contracts, draft: { ...base.draft, order: base.draft.order.map((t, i) => (i === 0 ? ai : t)) } };
    expect(rosterKeys(six, ai)).toHaveLength(6);
    const gap = aiApronDp(six) - payroll(six, ai);
    const at = { ...six, dead: [...six.dead, { teamId: ai, key: 'x', dp: gap, through: six.year }] };
    expect(payroll(at, ai)).toBe(aiApronDp(at));
    expect(onClock(at)).toMatchObject({ n: 1, teamId: ai });
    const before = new Set(rosterKeys(at, ai));

    let d = simDraft(at, { rng, all: true });
    const first = d.draft.picks[0];
    expect(first).toMatchObject({ n: 1, teamId: ai });
    expect(first.key).not.toBeNull();
    d = closeRookies(finishDraft(d, { rng }), { rng });
    for (let guard = 0; guard < 10 && d.phase === DPHASE.freeAgency; guard += 1) d = nextFaDay(d, { rng });
    d = startSeason(fillRoster(d, HUMAN_ID), { rng });

    expect(d.contracts[first.key]).toMatchObject({ teamId: ai, dp: rookieScale(1, 8).dp, years: 3, how: 'rookie' });
    expect(rosterKeys(d, ai).length).toBeGreaterThanOrEqual(MIN_ROSTER);
    // Everyone new is a pick on the scale: no free agent, no fill.
    const added = rosterKeys(d, ai).filter(k => !before.has(k));
    expect(added.every(k => d.contracts[k].how === 'rookie')).toBe(true);
    expect(payroll(d, ai)).toBe(aiApronDp(d) + added.reduce((t, k) => t + d.contracts[k].dp, 0));
  });

  it('opens that door only for an AI team that cannot fill the floor on minimum deals, and never for a human', () => {
    const rng = seeded(16);
    const base = drawLottery(closeResign(endSeason(finishSeason(startSeason(ownDynasty({ size: 8 }), { rng })), { rng }), { rng }), { rng });
    const ai = base.teams.find(t => !t.human).id;
    const trimmed = (x, teamId, n) => {
      const contracts = { ...x.contracts };
      for (const k of rosterKeys(x, teamId).slice(n)) delete contracts[k];
      return { ...x, contracts };
    };
    const withRoom = (x, teamId, room, apron) => ({ ...x, dead: [...x.dead, { teamId, key: `x-${teamId}`, dp: apron - payroll(x, teamId) - room, through: x.year }] });
    const onFirst = x => ({ ...x, draft: { ...x.draft, order: x.draft.order.map((t, i) => (i === 0 ? ai : t)) } });
    // Seven players and 7 DP of room: an eighth on a 1-DP deal keeps it under
    // the apron, so a 10-DP first pick is passed, not drafted past it.
    const seven = onFirst(withRoom(trimmed(base, ai, 7), ai, 7, aiApronDp(base)));
    expect(aiDraftChoice(seven, ai, () => 0)).toBeNull();
    // Seven and no room at all: the pick is drafted — it fills the seat.
    expect(aiDraftChoice(onFirst(withRoom(trimmed(base, ai, 7), ai, 0, aiApronDp(base))), ai, () => 0)).not.toBeNull();
    // A human of six at the apron signs nothing past it — the human's apron is a hard line.
    const spare = base.draftPool.filter(k => !base.draft.pool.includes(k))[0];
    let h = withRoom(trimmed(base, HUMAN_ID, 6), HUMAN_ID, 0, APRON_DP);
    h = { ...h, phase: DPHASE.rookies, rights: { ...h.rights, [spare]: { teamId: HUMAN_ID, kind: 'rookie', pick: 1 } } };
    expect(rookieProblem(h, HUMAN_ID, spare)).toMatch(/apron/);
    // ...where an AI team of six at its apron signs him.
    let a = withRoom(trimmed(base, ai, 6), ai, 0, aiApronDp(base));
    a = { ...a, phase: DPHASE.rookies, rights: { ...a.rights, [spare]: { teamId: ai, kind: 'rookie', pick: 1 } } };
    expect(rookieProblem(a, ai, spare)).toBeNull();
  });

  it('re-signs so that its payroll and the scale of its two projected first-rounders fit its apron', () => {
    const rng = () => 0;   // every expiring player wanted — only the money decides
    const s = seeded(17);
    let d = finishSeason(startSeason(ownDynasty({ size: 8 }), { rng: s }));
    // One AI team with a roster of dear players all expiring: its five
    // cheapest swapped for the other AI teams' five dearest, and all ten on
    // their last year.
    const ai = d.teams.find(t => !t.human).id;
    const contracts = { ...d.contracts };
    const cheap = rosterKeys(d, ai).sort((x, y) => contracts[x].dp - contracts[y].dp).slice(0, 5);
    const dear = Object.keys(contracts).filter(k => contracts[k].teamId !== ai && contracts[k].teamId !== HUMAN_ID)
      .sort((x, y) => contracts[y].dp - contracts[x].dp).slice(0, 5);
    cheap.forEach((k, i) => {
      const [a, b] = [contracts[k], contracts[dear[i]]];
      contracts[k] = { ...a, teamId: b.teamId };
      contracts[dear[i]] = { ...b, teamId: ai };
    });
    for (const k of Object.keys(contracts)) if (contracts[k].teamId === ai) contracts[k] = { ...contracts[k], years: 1 };
    d = { ...d, contracts };
    // ...and a second first-rounder: the worst team's, bought in a trade.
    const worst = [...d.teams].map(t => t.id).filter(id => id !== ai)
      .sort((x, y) => standings(d.season).find(r => r.id === y).rank - standings(d.season).find(r => r.id === x).rank)[0];
    d = { ...d, pickOwner: { ...d.pickOwner, [pickId(d.year + 1, 1, worst)]: ai } };

    const y = endSeason(d, { rng });
    expect(y.phase).toBe(DPHASE.resign);
    const firsts = [ai, worst].map(t => rookieScale(projectedSlot(y, t), 8).dp);
    const expiring = rosterKeys(d, ai);
    // The budget binds: keeping everyone would have gone far past the apron.
    expect(expiring.reduce((t, k) => t + d.contracts[k].dp, 0)).toBeGreaterThan(aiApronDp(y));
    expect(rosterKeys(y, ai).length).toBeGreaterThan(0);
    expect(payroll(y, ai) + firsts[0] + firsts[1]).toBeLessThanOrEqual(aiApronDp(y));
    // The same window with neither pick: it keeps more.
    const bare = { ...d, pickOwner: { ...d.pickOwner, [pickId(d.year + 1, 1, worst)]: worst, [pickId(d.year + 1, 1, ai)]: worst, [pickId(d.year + 1, 2, ai)]: worst } };
    expect(payroll(endSeason(bare, { rng }), ai)).toBeGreaterThan(payroll(y, ai));
  });

  it('a deal that runs past this year also leaves room for NEXT year’s picks', () => {
    // A verifier (2026-09-18): payroll carried from the year before passed
    // first-overall picks — a stacked start's LAL tipped into year three at
    // 109 DP with nothing to re-sign, its year-two re-sign and picks having
    // spent year three's room. One AI team, its whole roster on deals that
    // run past next season but one expiring player who wants years, and no
    // picks in the coming draft: this year he fits to the DP, and only next
    // year's picks can stop him.
    const rng = () => 0;   // every expiring player wanted — only the money decides
    const s = seeded(18);
    const done = finishSeason(startSeason(ownDynasty({ size: 8 }), { rng: s }));
    const ai = done.teams.find(t => !t.human).id;
    const next = done.year + 1;
    const noPicks = (x, years) => ({
      ...x,
      pickOwner: {
        ...x.pickOwner,
        ...Object.fromEntries(years.flatMap(y => [1, 2].map(r => [pickId(y, r, ai), HUMAN_ID]))),
      },
    });
    const books = (key, ballast) => {
      const contracts = { ...done.contracts };
      for (const k of rosterKeys(done, ai)) contracts[k] = { ...contracts[k], dp: 1, years: k === key ? 1 : 3 };
      const other = rosterKeys(done, ai).find(k => k !== key);
      contracts[other] = { ...contracts[other], dp: ballast };
      return { ...done, contracts };
    };
    // The one who wants a deal of two years or more, and what he re-signs for
    // when nothing is in the way (no picks in either draft, a light payroll).
    let key = null;
    let terms = null;
    for (const k of rosterKeys(done, ai)) {
      const t = endSeason(noPicks(books(k, 1), [next, next + 1]), { rng }).contracts[k];
      if (t?.teamId === ai && t.years >= 2) { key = k; terms = t; break; }
    }
    expect(key).not.toBeNull();
    // Payroll then lands on the apron to the DP: the ballast takes the rest.
    const others = rosterKeys(done, ai).length - 2;
    const ballast = aiApronDp(done) - terms.dp - others;
    expect(ballast).toBeGreaterThanOrEqual(1);
    expect(rosterKeys(done, ai).length).toBeGreaterThanOrEqual(MIN_ROSTER);
    // No picks in either draft: he fits this year and next, and re-signs.
    const free = endSeason(noPicks(books(key, ballast), [next, next + 1]), { rng });
    expect(free.contracts[key]).toMatchObject({ teamId: ai, dp: terms.dp, years: terms.years });
    expect(payroll(free, ai)).toBe(aiApronDp(free));
    // Its own picks in NEXT year's draft: this year still fits to the DP, but
    // next season's books cannot hold him and those picks, so he walks.
    const held = endSeason(noPicks(books(key, ballast), [next]), { rng });
    expect(held.contracts[key]).toBeUndefined();
    expect(freeAgentKeys(held)).toContain(key);
  });

  it('drafts for a full roster when the pick beats its weakest man, however bad its worst-value contract', () => {
    // The rookie draft's half of the shed (2026-09-18): the pick is weighed
    // against the man the deadline would waive — the weakest — not the worst-
    // value contract, which is often an overpaid star.
    const rng = seeded(19);
    const base = drawLottery(closeResign(endSeason(finishSeason(startSeason(ownDynasty({ size: 8 }), { rng })), { rng }), { rng }), { rng });
    const ai = base.teams.find(t => !t.human).id;
    const rights = Object.fromEntries(Object.entries(base.rights ?? {}).filter(([, r]) => !(r.teamId === ai && r.kind === 'rookie')));
    const contracts = Object.fromEntries(Object.entries(base.contracts).map(([k, c]) => [k, c.teamId === ai ? { ...c, dp: 1, years: 2 } : c]));
    const spare = base.draftPool.filter(k => !base.draft.pool.includes(k));
    const need = MAX_ROSTER - rosterKeys(base, ai).length;
    for (const k of spare.slice(0, need)) contracts[k] = { teamId: ai, dp: 1, years: 1, since: base.year, how: 'fill' };
    const talent = k => talentValue(getCardByKey(k));
    const star = [...rosterKeys({ contracts }, ai)].sort((a, b) => talent(b) - talent(a))[0];
    contracts[star] = { ...contracts[star], dp: 40, years: 3 };
    // Only players below the star are left on the board.
    const pool = base.draft.pool.filter(k => talent(k) < talent(star));
    const x = { ...base, rights, contracts, draft: { ...base.draft, pool, order: base.draft.order.map((t, i) => (i === 0 ? ai : t)) } };
    expect(rosterKeys(x, ai)).toHaveLength(MAX_ROSTER);
    expect(onClock(x)).toMatchObject({ n: 1, teamId: ai });
    expect(payroll(x, ai) + rookieScale(1, 8).dp).toBeLessThanOrEqual(aiApronDp(x));
    const value = k => contractValue(getCardByKey(k), x.contracts[k]);
    const worstValue = rosterKeys(x, ai).reduce((w, k) => (value(k) < value(w) ? k : w));
    const weakest = rosterKeys(x, ai).reduce((w, k) => (talent(k) < talent(w) ? k : w));
    const top = Math.max(...draftAvailable(x).map(talent));
    // The old rule would pass: the worst-value contract out-talents the board.
    expect(worstValue).toBe(star);
    expect(top).toBeGreaterThan(talent(weakest));
    const choice = aiDraftChoice(x, ai, () => 0);
    expect(choice).not.toBeNull();
    expect(talent(choice)).toBe(top);
  });
});

describe('the class seed (2026-09-18)', () => {
  it('draws independent classes for ids that differ only in their last characters', () => {
    // ids own1..own150 hashed to seeds in lock-step before the finalizer:
    // over 150 own starts a year-two super-rare 47% of the time against the
    // user's 60%. Here one league's pool under ids own1..own1000 — a thousand
    // so three standard errors are tight enough to tell: the raw hash drew a
    // super-rare in 65.7% of these classes, the mixed seed in 60.7% (and a
    // legendary in 17.3% against 15%).
    const d = ownDynasty({ size: 8 });
    const n = 1000;
    let sr = 0;
    let leg = 0;
    for (let i = 1; i <= n; i += 1) {
      const { draftClass: _drop, ...x } = { ...d, id: `own${i}` };
      const bands = classFor(x).map(k => getPlayerRarity(getCardByKey(k)));
      if (bands.includes('super-rare')) sr += 1;
      if (bands.includes('legendary')) leg += 1;
    }
    // Three standard errors either side.
    const within = (hits, p) => Math.abs(hits / n - p) <= 3 * Math.sqrt((p * (1 - p)) / n);
    expect(within(sr, 0.6)).toBe(true);
    expect(within(leg, 0.15)).toBe(true);
  });
});

describe('an older save (2026-09-17)', () => {
  it('with no stored class builds one on read — the same every read, even from storage — and drafts it', () => {
    const rng = seeded(11);
    const d = endSeason(finishSeason(startSeason(ownDynasty(), { rng })), { rng });
    const { draftClass: _gone, ...old } = d;   // a save from before the class was stored
    const cls = classFor(old);
    expect(cls).toHaveLength(classSize(4));
    expect(cls.every(k => old.draftPool.includes(k))).toBe(true);
    expect(classFor({ ...old })).toEqual(cls);
    expect(classFor(JSON.parse(JSON.stringify(old)))).toEqual(cls);
    // The window's close stores exactly the class it read, and the lottery drafts it.
    const closed = closeResign(old, { rng });
    expect(closed.draftClass).toEqual({ year: old.year, keys: cls });
    const drawn = drawLottery(closed, { rng });
    expect(drawn.phase).toBe(DPHASE.rookieDraft);
    expect(drawn.draft.pool).toEqual(cls);
    // An in-season save with none reads a class for a pick's trade value, and
    // the season's tip-off stores it before camp can reach into the pool.
    const { draftClass: _also, ...preseason } = ownDynasty();
    expect(classFor(preseason)).toHaveLength(classSize(4));
    expect(startSeason(preseason, { rng }).draftClass.keys).toEqual(classFor(preseason));
  });
});

// ── THE DEADLINE: SHED ONE, OR LET IT LAPSE (the user, 2026-09-17) ─────────
describe('the deadline shed (2026-09-17)', () => {
  // A preseason with one AI team's books set by hand: a full roster at 5 DP
  // a man, and picks still held that its roster has no spot for.
  const setup = pickKeys => {
    const d = ownDynasty({ size: 4 });
    const ai = d.teams.find(t => !t.human).id;
    const pool = d.draftPool.filter(k => !pickKeys.includes(k));
    const need = MAX_ROSTER - rosterKeys(d, ai).length;
    const fillers = pool.slice(0, need);
    const contracts = Object.fromEntries(Object.entries(d.contracts).map(([k, c]) => [k, c.teamId === ai ? { ...c, dp: 5 } : c]));
    for (const k of fillers) contracts[k] = { teamId: ai, dp: 5, years: 1, since: d.year, how: 'fill' };
    const rights = { ...d.rights };
    pickKeys.forEach((k, i) => { rights[k] = { teamId: ai, kind: 'rookie', pick: 2 + i * 4 }; });
    const x = {
      ...d, contracts, rights,
      league: [...leagueKeys(d), ...fillers, ...pickKeys],
      draftPool: pool.filter(k => !fillers.includes(k)),
    };
    expect(rosterKeys(x, ai)).toHaveLength(MAX_ROSTER);
    // The man it would shed: its weakest by talent, the contract worth least
    // over its years breaking a tie (the engine's shedCandidate, 2026-09-18 —
    // it was the worst-value contract alone until then).
    const worst = shedOf(x, ai);
    return { x, ai, worst };
  };
  const shedOf = (x, ai) => {
    const t = k => talentValue(getCardByKey(k));
    const v = k => contractValue(getCardByKey(k), x.contracts[k]);
    return rosterKeys(x, ai).reduce((w, k) => (t(k) < t(w) || (t(k) === t(w) && v(k) < v(w)) ? k : w));
  };
  const byTalent = keys => [...keys].sort((a, b) => talentValue(getCardByKey(b)) - talentValue(getCardByKey(a)));
  const d0 = ownDynasty({ size: 4 });

  it('waives its weakest man — dead money — for a better pick, ONE contract only, and lets the next pick lapse', () => {
    const [star, second] = byTalent(d0.draftPool);
    const { x, ai, worst } = setup([star, second]);
    expect(talentValue(getCardByKey(star))).toBeGreaterThan(talentValue(getCardByKey(worst)));
    expect(talentValue(getCardByKey(second))).toBeGreaterThan(talentValue(getCardByKey(worst)));
    const before = payroll(x, ai);
    const y = startSeason(fillRoster(x, HUMAN_ID), { rng: seeded(3) });
    expect(y.contracts[worst]).toBeUndefined();
    expect(y.dead).toContainEqual(expect.objectContaining({ teamId: ai, key: worst, dp: 5, through: y.year }));
    expect(y.contracts[star]).toMatchObject({ teamId: ai, dp: rookieScale(2, 4).dp, years: 3, how: 'rookie' });
    // One shed, not two: the second pick lapses to free agency.
    expect(y.contracts[second]).toBeUndefined();
    expect(freeAgentKeys(y)).toContain(second);
    expect(rosterKeys(y, ai)).toHaveLength(MAX_ROSTER);
    // The waived man's DP stays on the books: the shed bought the spot, not money.
    expect(payroll(y, ai)).toBe(before + rookieScale(2, 4).dp);
    expect(y.news.filter(n => /waived/.test(n.text) && n.text.startsWith(teamOf(y, ai).name))).toHaveLength(1);
  });

  it('keeps its roster and lets the pick lapse when the pick is no better than the man it would shed', () => {
    const scrub = byTalent(d0.draftPool).at(-1);
    const { x, ai, worst } = setup([scrub]);
    expect(talentValue(getCardByKey(scrub))).toBeLessThanOrEqual(talentValue(getCardByKey(worst)));
    const y = startSeason(fillRoster(x, HUMAN_ID), { rng: seeded(3) });
    expect(y.contracts[worst]).toMatchObject({ teamId: ai });
    expect(y.rights[scrub]).toBeUndefined();
    expect(freeAgentKeys(y)).toContain(scrub);
    expect(y.news.some(n => /lapse unsigned/.test(n.text) && n.text.includes(getCardByKey(scrub).name))).toBe(true);
  });

  it('weighs the pick against its weakest man, not its worst-value contract: an overpaid star stays, the scrub goes', () => {
    // A verifier's fantasy start (2026-09-18, seed 6, year 2) passed a first-
    // overall super-rare while carrying a 4.7-talent player, because the pick
    // was weighed against its worst-VALUE contract — a 128-talent star on a
    // big deal. Here the dearest-talent man is put on a deal far over his
    // worth, so he is the worst-value contract by a distance, and the pick
    // sits between him and the weakest man.
    const pool = byTalent(d0.draftPool);
    const pick = pool[Math.floor(pool.length / 4)];
    const { x: base, ai } = setup([pick]);
    const star = byTalent(rosterKeys(base, ai))[0];
    const x = { ...base, contracts: { ...base.contracts, [star]: { ...base.contracts[star], dp: 40, years: 3 } } };
    const value = k => contractValue(getCardByKey(k), x.contracts[k]);
    const worstValue = rosterKeys(x, ai).reduce((w, k) => (value(k) < value(w) ? k : w));
    const weakest = shedOf(x, ai);
    expect(worstValue).toBe(star);
    expect(weakest).not.toBe(star);
    // The old rule would have let him lapse; the new one sheds the weakest.
    expect(talentValue(getCardByKey(pick))).toBeLessThanOrEqual(talentValue(getCardByKey(star)));
    expect(talentValue(getCardByKey(pick))).toBeGreaterThan(talentValue(getCardByKey(weakest)));
    expect(payroll(x, ai) + rookieScale(2, 4).dp).toBeLessThanOrEqual(aiApronDp(x));
    const y = startSeason(fillRoster(x, HUMAN_ID), { rng: seeded(3) });
    expect(y.contracts[star]).toMatchObject({ teamId: ai, dp: 40 });
    expect(y.contracts[weakest]).toBeUndefined();
    expect(y.contracts[pick]).toMatchObject({ teamId: ai, how: 'rookie' });
    expect(rosterKeys(y, ai)).toHaveLength(MAX_ROSTER);
  });

  it('never sheds for money: an AI team of eight at its apron keeps its eight and lets the pick lapse', () => {
    // A verifier (2026-09-18): the deadline waived a team of eight down to
    // seven for a pick refused for MONEY, and seven is short-handed, so the
    // pick signed past the apron — a 20-DP starter waived and the team at 125
    // against 115. The shed frees a seat, never money; it answers the full
    // roster's refusal only.
    const d = ownDynasty({ size: 8, seed: 2 });
    const ai = d.teams.find(t => !t.human).id;
    const [star] = byTalent(d.draftPool);
    const contracts = { ...d.contracts };
    for (const k of rosterKeys(d, ai).slice(8)) delete contracts[k];
    const eight = { ...d, contracts };
    expect(rosterKeys(eight, ai)).toHaveLength(8);
    const x = {
      ...eight,
      dead: [...(eight.dead ?? []), { teamId: ai, key: 'x', dp: aiApronDp(eight) - payroll(eight, ai), through: eight.year }],
      rights: { ...eight.rights, [star]: { teamId: ai, kind: 'rookie', pick: 1 } },
      league: [...leagueKeys(eight), star],
      draftPool: eight.draftPool.filter(k => k !== star),
    };
    expect(payroll(x, ai)).toBe(aiApronDp(x));
    expect(rookieProblem(x, ai, star)).toMatch(/apron/);
    const before = rosterKeys(x, ai);
    const y = startSeason(fillRoster(x, HUMAN_ID), { rng: seeded(3) });
    expect(rosterKeys(y, ai).sort()).toEqual([...before].sort());
    expect(y.contracts[star]).toBeUndefined();
    expect(freeAgentKeys(y)).toContain(star);
    expect(payroll(y, ai)).toBe(aiApronDp(y));
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

describe('more than one coach (a dynasty with friends)', () => {
  it('seats every coach, ten each in an own start', () => {
    const [a, b] = buildAiLeague(2, { rng: seeded(1) }).map(t => t.roster);
    const d = createDynasty({
      id: 'M', size: 6, length: 'online', startMode: 'own', rng: seeded(2),
      humans: [{ id: 'h:1', name: 'One', uid: '1', roster: a }, { id: 'h:2', name: 'Two', uid: '2', roster: b }],
    });
    expect(d.humans).toEqual(['h:1', 'h:2']);
    expect(rosterKeys(d, 'h:1')).toHaveLength(10);
    expect(rosterKeys(d, 'h:2')).toHaveLength(10);
    expect(d.teams.filter(t => t.human).map(t => t.id)).toEqual(['h:1', 'h:2']);
    expectConserved(d);
  });

  // TWO COACHES, ONE PLAYER. The user, 2026-09-16: "It's ok if two users
  // bring the same player ... User 1 re-signs Rivers in the off-season and
  // User 2 does not. Instead of the Rivers duplicate going into the
  // free-agency pool, that card is removed."
  describe('two coaches bring the same player', () => {
    const omitKey = (o, k) => { const c = { ...(o ?? {}) }; delete c[k]; return c; };
    const shared = () => {
      const [a, b] = buildAiLeague(2, { rng: seeded(1) }).map(t => t.roster);
      const star = a[0];
      // Coach two's ten is nine of his own plus coach one's best card.
      const bb = [star, ...b.filter(c => c.id !== star.id).slice(0, 9)];
      const d = createDynasty({
        id: 'D', size: 6, length: 'online', startMode: 'own', rng: seeded(2),
        humans: [{ id: 'h:1', name: 'One', uid: '1', roster: a }, { id: 'h:2', name: 'Two', uid: '2', roster: bb }],
      });
      return { d, star, key: cardKey(star), copy: `${cardKey(star)}~2` };
    };

    it('lets both in, the second under a copy key that reads as the same card', () => {
      const { d, star, key, copy } = shared();
      expect(rosterKeys(d, 'h:1')).toContain(key);
      expect(rosterKeys(d, 'h:2')).toContain(copy);
      expect(getCardByKey(copy)).toBe(getCardByKey(key));
      expect(getCardByKey(copy).id).toBe(star.id);
      // Held twice, nobody free, and the pool holds no third.
      const held = [...Object.keys(d.contracts), ...Object.keys(d.rights)];
      expect(new Set(held).size).toBe(held.length);
      expect(d.draftPool.map(k => getCardByKey(k)?.id)).not.toContain(star.id);
    });

    it('removes the copy that goes unsigned while the other is still held', () => {
      const { d, key, copy } = shared();
      const x = { ...d, contracts: omitKey(d.contracts, copy), rights: { ...(d.rights ?? {}), [copy]: { teamId: 'h:2', kind: 'expiring' } } };
      const after = renounce(x, 'h:2', copy);
      expect(after.league).not.toContain(copy);
      expect(after.contracts[copy]).toBeUndefined();
      expect(after.rights[copy]).toBeUndefined();
      expect(freeAgentKeys(after)).not.toContain(copy);
      expect(after.contracts[key]?.teamId).toBe('h:1');
      expect(after.news[0].text).toMatch(/second card leaves the league/);   // say(): news feed, newest first
    });

    it('lets the last copy hit the market as ever', () => {
      const { d, key, copy } = shared();
      let x = { ...d, league: d.league.filter(k => k !== copy), contracts: omitKey(d.contracts, copy) };
      x = { ...x, contracts: omitKey(x.contracts, key), rights: { ...(x.rights ?? {}), [key]: { teamId: 'h:1', kind: 'expiring' } } };
      const after = renounce(x, 'h:1', key);
      expect(after.league).toContain(key);
      expect(freeAgentKeys(after)).toContain(key);
    });

    it('waiving a copy keeps the dead money but not the player', () => {
      const { d, key, copy } = shared();
      const after = waive({ ...d, phase: DPHASE.resign }, 'h:2', copy);
      expect(after.dead.some(m => m.key === copy && m.teamId === 'h:2')).toBe(true);
      expect(after.league).not.toContain(copy);
      expect(freeAgentKeys(after)).not.toContain(copy);
      expect(after.contracts[key]?.teamId).toBe('h:1');
    });
  });

  it('stops the fantasy draft for each coach, and closes a window for all of them', () => {
    const d = createDynasty({
      id: 'F2', size: 4, length: 'online', startMode: 'fantasy-full', rng: seeded(3),
      humans: [{ id: 'h:1', name: 'One' }, { id: 'h:2', name: 'Two' }],
    });
    let x = simDraft(d, { rng: seeded(4) });
    expect(['h:1', 'h:2']).toContain(onClock(x).teamId);
    x = finishDraft(driveDraft(x, seeded(5)), { rng: seeded(5) });
    expect(rightsOf(x, 'h:1', 'draft').length).toBeGreaterThan(0);
    expect(rightsOf(x, 'h:2', 'draft').length).toBeGreaterThan(0);
    x = closeSigning(x, { rng: seeded(6) });
    expect(rightsOf(x, 'h:1')).toHaveLength(0);
    expect(rightsOf(x, 'h:2')).toHaveLength(0);
    expect(summarizeDynasty(x, 'h:2').phase).toBe(DPHASE.freeAgency);
  });
});

describe('the lottery, scaled from the NBA', () => {
  it('shares the NBA\'s fourteen slots out over a smaller lottery, and is the NBA\'s at fourteen', () => {
    expect(lotteryWeights(14)).toEqual([140, 140, 140, 125, 105, 90, 75, 60, 45, 30, 20, 15, 10, 5]);
    expect(lotteryWeights(4)).toEqual([482.5, 332.5, 145, 40]);
    expect(lotteryWeights(2)).toEqual([815, 185]);
    for (const k of [2, 3, 4, 5, 6]) expect(lotteryWeights(k).reduce((t, w) => t + w, 0)).toBeCloseTo(1000);
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
    // A fantasy start pays FANTASY_DYNASTY_FACTOR (half — the user's correction, 2026-09-11).
    expect(done.coins).toBeGreaterThanOrEqual(Math.floor(600 * FANTASY_DYNASTY_FACTOR));
    const s = summarizeDynasty(d);
    expect(s.phaseLabel).toBe('Complete');
    const year1 = dynastyYearEarnings(d, 1);
    const h = d.history[0];
    if (h.champion === HUMAN_ID) expect(year1.coins).toBe(Math.floor(SEASON_REWARDS.short.champion * FANTASY_DYNASTY_FACTOR));
  });

  it('pays nothing for the ten-year bonus before the tenth season is in', () => {
    const d = ownDynasty();
    expect(dynastyCompletionEarnings(d)).toEqual({ coins: 0, label: null });
  });
});

// ── THE AI DRAFTS WELL WHATEVER THE COACH DIFFICULTY IS ─────────────────────
//
// The user, 2026-09-14: "I honestly think it makes sense for the AI to draft
// their teams intelligently regardless of the difficulty setting."
//
// An earlier version of this pinned the rung to the league and used it for
// both the draft and the coaching, so that a Settler dynasty could not be
// played at Deity for full coin. Separating the two removes that hole rather
// than papering over it — there is nothing left to exploit once the draft
// does not read the rung — and it means a player who wants an easier evening
// is not handed a decade of junk opponents.
describe('the draft does not read the coach difficulty', () => {
  it('drafts at full strength whatever rung the league is built at', () => {
    // The rung the league is built at is REMEMBERED (2026-09-16: a game in it
    // pays at the lower of that and the rung it was played at), and above
    // Prince it makes the AI teams' budget richer — but never their draft
    // dumber. null is Prince.
    const d = createDynasty({
      id: 'R', size: 4, length: 'short', startMode: 'fantasy-full',
      rng: seeded(11), human: { name: 'Me' },
    });
    expect(d.aiLevel).toBeNull();
    expect(d.iq).toBe(1);
    const hard = createDynasty({
      id: 'R1', size: 4, length: 'short', startMode: 'fantasy-full',
      rng: seeded(11), human: { name: 'Me' }, aiLevel: 'deity',
    });
    expect(hard.aiLevel).toBe('deity');
    expect(hard.iq).toBe(1);
  });

  it("gives a Deity league's AI teams a richer budget than a Prince league's", () => {
    // Same seed, same pool: the only difference is the cap the AI drafts to.
    const spend = level => {
      let d = createDynasty({
        id: 'B', size: 4, length: 'short', startMode: 'fantasy-full',
        rng: seeded(21), human: { name: 'Me' }, aiLevel: level,
      });
      // Drafted players are only RIGHTS until the signing window; finishDraft
      // is where the AI signs its draftees and a payroll exists to read.
      d = finishDraft(driveDraft(d, seeded(22)), { rng: seeded(23) });
      const ai = d.teams.filter(t => !t.human).map(t => t.id);
      return ai.reduce((sum, id) => sum + payroll(d, id), 0) / ai.length;
    };
    expect(spend('deity')).toBeGreaterThan(spend('prince'));
  });

  it('keeps the drafting dial available for a toggle that does not exist yet', () => {
    // The parameter survives so a drafting-difficulty toggle is one line; it
    // is simply not wired to the coach difficulty.
    const dumb = createDynasty({
      id: 'R2', size: 4, length: 'short', startMode: 'fantasy-full',
      rng: seeded(12), human: { name: 'Me' }, iq: 0,
    });
    expect(dumb.iq).toBe(0);
  });

  it('survives the round trip the friends league stores it through', () => {
    const d = createDynasty({
      id: 'R3', size: 4, length: 'short', startMode: 'fantasy-full',
      rng: seeded(13), human: { name: 'Me' },
    });
    expect(unpackDynasty(packDynasty(d)).iq).toBe(1);
  });
});
