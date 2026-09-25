// The dynasty: a finite league, a DP payroll, drafts, free agency, ten years.
import { describe, it, expect } from 'vitest';
import {
  createDynasty, HUMAN_ID, MIN_ROSTER, MAX_ROSTER, DPHASE, RANDOM_POOL_PER_TEAM, FANTASY_ROUNDS,
  rosterKeys, contractsOf, payroll, freeAgentKeys, universe, rightsOf, quote, negotiate, waive, renounce,
  onClock, draftPick, draftAvailable, simDraft, aiDraftChoice, finishDraft, closeSigning, nextFaDay, fillRoster,
  startSeason, endSeason, closeResign, lotteryOdds, drawLottery, signRookie, closeRookies, classFor, nextDraftYear,
  projectedPayroll, summarizeDynasty, deadMoney, leagueKeys, passPick, classSize, ROOKIE_ROUNDS, buildDraftClass,
  baseAge, ageOf, retireChance, endDynasty, lotteryWeights, contractFor, aiCapDp, aiApronDp, tradeProblems,
  rookieTerms, rookieCommitted, rookieProblem, teamOf, pickId, pickValue, projectedSlot,
  waiverList, onWaivers, waiverOrder, claimWaiver, withdrawClaim, claimProblem, resolveWaivers, seasonTurn,
  AI_TRADES_PER_OFFSEASON, aiSalaryCap, aiSalaryOf, salaryFits, signingFits, floorOf,
  closeRetirements, retirementsOf, retirementWatch, isOffseason, PHASE_LABEL,
} from './dynasty.js';
import { CAP_DP, APRON_DP, AI_APRON_DP, FA_DAYS, fairDp, PERSONALITIES, CONTRACT_YEARS, rookieScale, talentValue, contractValue, preferredYears } from './dynastyMarket.js';
import { getPlayerRarity } from '../rarity.js';
import { dynastyYearEarnings, dynastyCompletionEarnings, dynastyClaim, DYNASTY_YEARS, SEASON_REWARDS, FANTASY_DYNASTY_FACTOR } from './prizes.js';
import { buildAiLeague } from './aiTeams.js';
import { recordResult, roundFixtures, advance, totalRounds, standings, PHASE } from './season.js';
import { CARDS } from '../cards.js';
import { getCardByKey, cardKey, CARD_SETS } from '../cardSets.js';
import { packDynasty, unpackDynasty } from './seasonPack.js';
import { fpFinishPoints, fpEarned, fpOf, importCost, importProblem, importCandidates, importCard, setTeamDeck, IMPORT_YEARS, FP_PER_SERIES, FP_TITLE } from './dynasty.js';
import { payFactorOf as payOf } from '../coinRewards.js';

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
 * Contracts + rights + the waiver wire + free agents is the league; nobody is
 * both in the league and waiting in the draft pool; one of each person
 * everywhere.
 */
function expectConserved(d) {
  const league = leagueKeys(d);
  const held = [...Object.keys(d.contracts), ...Object.keys(d.rights)];
  expect(new Set(held).size).toBe(held.length);
  expect(held.every(k => league.includes(k))).toBe(true);
  // On waivers is neither held nor free (2026-09-18) — and never both.
  const wire = waiverList(d).map(w => w.key);
  expect(wire.some(k => held.includes(k))).toBe(false);
  // ...and the retired, who are neither held nor free.
  expect(held.length + wire.length + freeAgentKeys(d).length + (d.retired ?? []).length).toBe(league.length);
  const waiting = new Set(d.draftPool);
  expect(league.some(k => waiting.has(k))).toBe(false);
  const persons = universe(d).map(k => getCardByKey(k)?.id);
  expect(persons.every(Boolean)).toBe(true);
  expect(new Set(persons).size).toBe(persons.length);
}

/**
 * EXACTLY `n` men on `teamId` (2026-09-18): the roster trimmed, or topped up
 * on 1-DP fill deals from the cards outside this year's draft (moved from the
 * pool into the league, so the league stays conserved). A seeded year's own
 * count moves with the card pool — one card changing team left a team five
 * where a test needed six — so a test that needs a size builds it.
 */
/**
 * `n` men on `teamId`, every one of them replaced by the CHEAPEST cards
 * outside this year's draft, on 1-DP deals (2026-09-19). The AI's card-salary
 * ceiling (aiSalaryCap) binds a seeded AI team near $5,500, and how near moved
 * with every change to the AI's re-signing reserve — a test of the DP rules
 * builds a team the ceiling cannot decide for. Its men before are released.
 */
function cheaply(x, teamId, n) {
  const contracts = Object.fromEntries(Object.entries(x.contracts).filter(([, c]) => c.teamId !== teamId));
  const spare = x.draftPool.filter(k => !(x.draft?.pool ?? []).includes(k) && !(x.draftClass?.keys ?? []).includes(k) && getCardByKey(k))
    .sort((a, b) => getCardByKey(a).salary - getCardByKey(b).salary).slice(0, n);
  for (const k of spare) contracts[k] = { teamId, dp: 1, years: 2, since: x.year, how: 'fill' };
  const y = { ...x, contracts, league: [...x.league, ...spare], draftPool: x.draftPool.filter(k => !spare.includes(k)) };
  expect(rosterKeys(y, teamId)).toHaveLength(n);
  return y;
}

function exactly(x, teamId, n) {
  const contracts = { ...x.contracts };
  for (const k of rosterKeys(x, teamId).slice(n)) delete contracts[k];
  const spare = x.draftPool.filter(k => !(x.draft?.pool ?? []).includes(k) && getCardByKey(k));
  const filled = spare.slice(0, Math.max(0, n - rosterKeys({ contracts }, teamId).length));
  for (const k of filled) contracts[k] = { teamId, dp: 1, years: 2, since: x.year, how: 'fill' };
  const y = { ...x, contracts, league: [...x.league, ...filled], draftPool: x.draftPool.filter(k => !filled.includes(k)) };
  expect(rosterKeys(y, teamId)).toHaveLength(n);
  return y;
}

/**
 * The offseason's AI-AI trades already made (2026-09-18): the directed
 * search runs at closeResign, closeFreeAgency and startSeason, and which
 * deals it finds depends on the card pool — a verifier's pool swap had one
 * move a signed pick to another team, and one swap a tip-off roster. A test
 * of something else that needs an AI roster to stay put spends the budget.
 */
const noAiTrades = x => ({ ...x, aiDeals: { year: x.year, n: AI_TRADES_PER_OFFSEASON } });

/** Every offseason decision the human could make, made the lazy way. */
function autoYear(d, rng) {
  let x = d;
  if (x.phase === DPHASE.retirements) x = closeRetirements(x);
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
    // Guards the spurned premium (dynastyMarket TEAM_FACTORS.spurned) and the
    // new season's pardon. THE DRAFTEE IS BUILT (2026-09-18): it was looked
    // for among the human's seeded picks — not Happy to Be Here, worth 8 DP or
    // more, asking 25 or less — and a pool with one card more or less dealt
    // picks with no such man. Now one is put under the human's draft rights:
    // a card worth 10–15 DP from the undrafted pool, Easygoing, so his ask
    // has room to rise by a quarter under the 35 max.
    const rng = seeded(5);
    let d = finishDraft(driveDraft(fantasyDynasty(), rng), { rng });
    const key = d.draftPool.find(k => { const f = fairDp(getCardByKey(k)); return f >= 10 && f <= 15; });
    d = {
      ...d,
      draftPool: d.draftPool.filter(k => k !== key),
      league: [...d.league, key],
      rights: { ...d.rights, [key]: { teamId: HUMAN_ID, kind: 'draft', pick: 99 } },
      traits: { ...d.traits, [key]: 'easy' },
    };
    expectConserved(d);
    const before = quote(d, HUMAN_ID, key).ask;
    expect(before).toBeLessThan(28);
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
    // Spread over the whole range (spreadSample draws from each tenth of the
    // set by salary): a card from the dearest tenth and one from the cheapest.
    // Measured against the set itself (2026-09-18), not the $1,200 and $300
    // this pinned — numbers that were only true of one season's cards.
    const all = CARDS.map(c => c.salary ?? 0).sort((a, b) => a - b);
    const tenth = Math.floor(all.length / 10);
    const salaries = d.draft.pool.map(k => getCardByKey(k).salary).sort((a, b) => a - b);
    expect(salaries[salaries.length - 1]).toBeGreaterThanOrEqual(all[all.length - tenth]);
    expect(salaries[0]).toBeLessThanOrEqual(all[tenth]);
  });
});

describe('the rules of a signing', () => {
  it('will not sign past a full roster or over the cap', () => {
    let d = ownDynasty();
    // His worst-paid card — any card is worth less than a 35-DP deal but a max star.
    const top = contractsOf(d, HUMAN_ID).sort((a, b) => a.card.salary - b.card.salary)[0];
    // Waived onto the wire, and — nobody claiming an overpaid deal at 35 DP
    // for five years — a free agent once it resolves; his DP stays on the books.
    d = { ...d, contracts: { ...d.contracts, [top.key]: { ...d.contracts[top.key], dp: 35, years: 5 } } };
    d = resolveWaivers(waive(d, HUMAN_ID, top.key));
    expect(freeAgentKeys(d)).toContain(top.key);
    // Books set by hand, so the room is short whatever the pool dealt: the
    // human's nine left at 11 DP each, 99 + 35 dead = 134 against 130.
    d = { ...d, contracts: Object.fromEntries(Object.entries(d.contracts).map(([k, c]) => [k, c.teamId === HUMAN_ID ? { ...c, dp: 11 } : c])) };
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
    const rivalTop = contractsOf(filled, rival.id).sort((a, b) => a.card.salary - b.card.salary)[0];
    const full = resolveWaivers(waive({ ...filled, contracts: { ...filled.contracts, [rivalTop.key]: { ...filled.contracts[rivalTop.key], dp: 35, years: 5 } } }, rival.id, rivalTop.key));
    expect(freeAgentKeys(full)).toContain(rivalTop.key);
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

  it('waiving leaves his DP on the books for the season ahead, puts him on waivers, and — unclaimed — frees him', () => {
    const d = ownDynasty();
    const top = contractsOf(d, HUMAN_ID).sort((a, b) => a.card.salary - b.card.salary)[0];
    // Overpaid past anything an AI team would claim (contractValue < 0).
    const d1 = { ...d, contracts: { ...d.contracts, [top.key]: { ...d.contracts[top.key], dp: 35, years: 5 } } };
    expect(contractValue(top.card, { dp: 35, years: 5 })).toBeLessThan(0);
    const x = waive(d1, HUMAN_ID, top.key);
    expect(deadMoney(x, HUMAN_ID)).toBe(35);
    expect(payroll(x, HUMAN_ID)).toBe(payroll(d1, HUMAN_ID));
    // On the wire, not yet a free agent: nobody can sign him, only claim him.
    expect(onWaivers(x, top.key)).toBe(true);
    expect(freeAgentKeys(x)).not.toContain(top.key);
    expectConserved(x);
    const y = resolveWaivers(x);
    expect(freeAgentKeys(y)).toContain(top.key);
    expect(deadMoney(y, HUMAN_ID)).toBe(35);
    expect(waiverList(y)).toEqual([]);
    expectConserved(y);
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
    // The free agent is chosen, not found (2026-09-18): the dearest on the
    // market, made Easygoing — patience 4, so an insult's two leave him talking.
    const d0 = market(6);
    const dearest = freeAgentKeys(d0).sort((a, b) => getCardByKey(b).salary - getCardByKey(a).salary)[0];
    const d = { ...d0, traits: { ...d0.traits, [dearest]: 'easy' } };
    const q = quote(d, HUMAN_ID, dearest);
    expect(q.ask).toBeGreaterThanOrEqual(8);
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

  it('an own start with a 300-DP human leaves every AI team at or under its cap — and spending most of its salary ceiling', () => {
    const d = stacked();
    expect(payroll(d, HUMAN_ID)).toBeGreaterThanOrEqual(250);
    for (const t of d.teams.filter(t => !t.human)) {
      expect(payroll(d, t.id)).toBeLessThanOrEqual(aiCapDp(d));
      // THE CARD-SALARY CEILING BINDS FIRST (2026-09-18): on real contracts a
      // $5,500 ten costs ~45-65 DP, so the draft now stops at the ceiling
      // with DP to spare (it asserted 80+ DP spent until the ceiling came in,
      // when AI teams arrived at ~$8,800 of card salary). The ranking still
      // prices talent once (aiDraftChoice, 2026-09-17): a draft that charged
      // for price twice took ten rookie deals and left the budget unspent.
      expect(aiSalaryOf(d, t.id)).toBeLessThanOrEqual(aiSalaryCap(d));
      expect(aiSalaryOf(d, t.id)).toBeGreaterThanOrEqual(0.95 * aiSalaryCap(d));
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
    //
    // BOTH ROSTERS BUILT (2026-09-21): the twenty cheapest cards outside the
    // draft, ten a side on 1-DP deals (cheaply), so the AI's card-salary
    // ceiling (aiSalaryCap, 2026-09-18) has nothing to say. Until today the
    // deal swapped the seeded rosters' first men: an own start's AI team
    // arrives within ~$100 of $5,500, and once the user's free-agent pool
    // grew (5 cards at HEAD, 15 now) the swap took it to $5,650 — the
    // ceiling refused a deal that was only ever about DP. Only the aprons
    // and the matching rule decide here.
    const seededLeague = ownDynasty({ size: 4 });
    const ai = seededLeague.teams.find(t => !t.human).id;
    const d0 = cheaply(cheaply(seededLeague, ai, MAX_ROSTER), HUMAN_ID, MAX_ROSTER);
    const books = (d, teamId, each, key, star) => ({
      ...d,
      contracts: Object.fromEntries(Object.entries(d.contracts).map(([k, c]) => [k, c.teamId === teamId ? { ...c, dp: k === key ? star : each } : c])),
    });
    const mine = rosterKeys(d0, HUMAN_ID)[0];
    const theirs = rosterKeys(d0, ai)[0];
    const swap = { from: HUMAN_ID, to: ai, give: [mine], get: [theirs] };

    it('is built so the ceiling cannot decide: the AI side stays far under $5,500 taking your man on', () => {
      expect(aiSalaryOf(d0, ai) + getCardByKey(mine).salary).toBeLessThan(aiSalaryCap(d0) / 2);
      expect(tradeProblems(d0, swap)).toEqual([]);
    });

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

  it('lands on the target odds over many draws: a legendary about 0.15, never two; at least one rare; two super-rares in about 15% of classes', () => {
    const rng = seeded(77);
    // n = 2000 (verifiers, 2026-09-18): at 400 the old 0.15 second roll came
    // in at 0.100 on this very stream and passed the ±3 SE window.
    const n = 2000;
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
    // TWO SUPER-RARES IN 15% OF ALL CLASSES (the user, 2026-09-18): the
    // second roll is 0.25 after the first's 0.60. Three standard errors
    // either side of 0.15 at n = 2000 is ±0.024 — the old second roll of
    // 0.15 (two in about 0.09 of classes; 0.0855 on this stream) is outside.
    const se = Math.sqrt((0.15 * 0.85) / n);
    expect(Math.abs(twoSuper / n - 0.15)).toBeLessThanOrEqual(3 * se);
    // And the roll itself: given one super-rare, a second in about a quarter
    // of those classes (±0.0375 at ~1200), where the old roll gives 0.15.
    const seCond = Math.sqrt((0.25 * 0.75) / anySuper);
    expect(Math.abs(twoSuper / anySuper - 0.25)).toBeLessThanOrEqual(3 * seCond);
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
    // BOOKS AND PICKS SET BY HAND (2026-09-18). This read whatever picks the
    // seeded draft happened to hand the human — and a pool that moved could
    // hand none, or leave a roster too full or too dear to sign them. Now the
    // human keeps eight players at 5 DP and holds two picks built from the
    // undrafted pool on top of any the draft dealt, so the window always has
    // a pick to sign and one to let lapse.
    const { d: dealt, rng } = toDraft();
    const eight = rosterKeys(dealt, HUMAN_ID).slice(0, 8);
    const contracts = Object.fromEntries(Object.entries(dealt.contracts)
      .filter(([k, c]) => c.teamId !== HUMAN_ID || eight.includes(k))
      .map(([k, c]) => [k, c.teamId === HUMAN_ID ? { ...c, dp: 5 } : c]));
    const built = dealt.draftPool.filter(k => getCardByKey(k)).slice(0, 2);
    const drafted = {
      ...dealt,
      contracts,
      draftPool: dealt.draftPool.filter(k => !built.includes(k)),
      league: [...dealt.league, ...built],
      rights: { ...dealt.rights, [built[0]]: { teamId: HUMAN_ID, kind: 'rookie', pick: 3 }, [built[1]]: { teamId: HUMAN_ID, kind: 'rookie', pick: 9 } },
    };
    expectConserved(drafted);
    const mine = rightsOf(drafted, HUMAN_ID, 'rookie');
    expect(mine.length).toBeGreaterThanOrEqual(2);
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
    // Its roster built to have a seat and no picks of its own yet (2026-09-18:
    // under a pool of four more cards this seed's team already held a pick
    // before this clock, a full ten plus one, and passed — the test read a
    // pass as a bad pick).
    let rich = { ...d, rights: { ...d.rights } };
    for (const k of Object.keys(rich.rights)) if (rich.rights[k].teamId === ai && rich.rights[k].kind === 'rookie') delete rich.rights[k];
    // ITS NINE ARE THE CHEAPEST CARDS OUTSIDE THE DRAFT, on 1-DP deals
    // (cheaply, 2026-09-21). Until today the seeded ten stood, trimmed to
    // nine, and the board was narrowed to what its card-salary ceiling
    // (aiSalaryCap, 2026-09-18) had room for — but an own-start team arrives
    // AT the ceiling, so which cards those were was the pool's doing, and on
    // an empty free-agent pool the board narrowed to nothing. The talent
    // rule is what is tested here; cheap men leave the ceiling thousands of
    // room, so the whole board is on and the ceiling (which has tests of its
    // own) never speaks.
    rich = cheaply(rich, ai, MAX_ROSTER - 1);
    expect(rosterKeys(rich, ai).length + rightsOf(rich, ai).length).toBeLessThan(MAX_ROSTER);
    expect(draftAvailable(rich).every(k => salaryFits(rich, ai, [k]))).toBe(true);
    expect(draftAvailable(rich).length).toBeGreaterThan(1);
    const choice = aiDraftChoice({ ...rich, draft: { ...rich.draft, order: rich.draft.order.map((t, i) => (i === rich.draft.picks.length ? ai : t)) } }, ai, () => 0);
    expect(choice).not.toBeNull();
    const best = [...draftAvailable(rich)].sort((a, b) => talentValue(getCardByKey(b)) - talentValue(getCardByKey(a)))[0];
    // The pick is talent × need, and need runs 0.85 to 1.3 (needFactor): the
    // most a need can pull the pick below the best talent is 0.85 / 1.3. That
    // bound is the rule's, where the 0.7 this pinned was one pool's gap.
    expect(talentValue(getCardByKey(choice))).toBeGreaterThanOrEqual((0.85 / 1.3) * talentValue(getCardByKey(best)));
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
    // Its seats filled from the CHEAP end of the board (2026-09-19): the
    // dear end took a seeded seven to past its $5,500 card-salary ceiling,
    // and then no card on the board fitted even in the shed man's place.
    const board = [...draftAvailable(rich)].sort((a, b) => getCardByKey(a).salary - getCardByKey(b).salary);
    const extra = board.slice(0, Math.max(0, seats));
    for (const k of extra) full.contracts[k] = { teamId: ai, dp: 1, years: 1, since: 1, how: 'fill' };
    full.draft = { ...full.draft, pool: full.draft.pool.filter(k => !extra.includes(k)), order: full.draft.order.map((t, i) => (i === full.draft.picks.length ? ai : t)) };
    expect(rosterKeys(full, ai).length + rightsOf(full, ai).length).toBe(MAX_ROSTER);
    // The board narrowed to men better than the weakest (2026-09-18): the
    // pick is talent for the roster's need, so a weaker man at a position
    // this team lacked could rank first and be passed for not beating the
    // shed — which one a seeded pool puts first is the pool's doing (one
    // more card in it did exactly that). On this board the shed rule alone
    // decides, and a rule that passed a full roster by would fail here.
    const t = k => talentValue(getCardByKey(k));
    // Its weakest man swapped for the weakest card left out of the draft, so
    // the board has men above him whatever the seeded roster was (a pool of
    // twenty more cards dealt a roster whose weakest beat the whole board).
    // Read off the pool as it stands after the nine were dealt (2026-09-21),
    // never a man already on the roster.
    const low = rich.draftPool.filter(k => !rich.draft.pool.includes(k) && getCardByKey(k)).sort((a, b) => t(a) - t(b))[0];
    const weakestMan = rosterKeys(full, ai).reduce((w, k) => (t(k) < t(w) ? k : w));
    if (t(low) < t(weakestMan)) {
      delete full.contracts[weakestMan];
      full.contracts[low] = { teamId: ai, dp: 1, years: 1, since: 1, how: 'fill' };
    }
    expect(rosterKeys(full, ai).length + rightsOf(full, ai).length).toBe(MAX_ROSTER);
    const floor = Math.min(...rosterKeys(full, ai).map(t));
    // ...and to men whose card fits the AI's salary ceiling in the shed man's
    // place (aiSalaryCap, 2026-09-18) — the ceiling has its own tests; here
    // the shed rule alone decides.
    const shedMan = rosterKeys(full, ai).reduce((w, k) => (t(k) < t(w) ? k : w));
    full.draft = { ...full.draft, pool: full.draft.pool.filter(k => t(k) > floor && salaryFits(full, ai, [k], [shedMan])) };
    expect(draftAvailable(full).length).toBeGreaterThan(1);
    const shedPick = aiDraftChoice(full, ai, () => 0);
    expect(shedPick).not.toBeNull();
    expect(draftAvailable(full)).toContain(shedPick);
    expect(t(shedPick)).toBeGreaterThan(floor);
    const topMan = [...draftAvailable(full)].sort((a, b) => t(b) - t(a))[0];
    expect(aiDraftChoice({ ...full, draft: { ...full.draft, pool: [topMan] } }, ai, () => 0)).toBe(topMan);
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
    // EXACTLY EIGHT (2026-09-18): the seeded year can leave this team fewer
    // after its expiring deals walk — it did when one card in the pool changed
    // team — and a team short of eight may draft past its books
    // (shortHanded), so a room one DP short still bought the pick. At eight,
    // the money alone decides. And the eight are the cheapest cards outside
    // the draft (cheaply, 2026-09-19): a seeded eight near the AI's $5,500
    // card-salary ceiling left no card on the board it could sign, so the
    // ceiling, not the money, passed the pick.
    const cleared = cheaply({ ...base, rights }, ai, MIN_ROSTER);
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
    // A pick traded on after he signs would not be on the team that drafted him.
    d = closeRookies(noAiTrades(d), { rng });
    for (let guard = 0; guard < 10 && d.phase === DPHASE.freeAgency; guard += 1) d = nextFaDay(d, { rng });
    d = startSeason(fillRoster(d, HUMAN_ID), { rng });
    for (const t of d.teams) expect(rightsOf(d, t.id, 'rookie')).toHaveLength(0);
    for (const t of d.teams.filter(t => !t.human)) {
      expect(payroll(d, t.id)).toBeLessThanOrEqual(aiApronDp(d));
      expect(rosterKeys(d, t.id).length).toBeGreaterThanOrEqual(MIN_ROSTER);
      expect(rosterKeys(d, t.id).length).toBeLessThanOrEqual(MAX_ROSTER);
    }
    // Whoever the AI did sign from its picks is on the scale of his slot.
    for (const p of picks.filter(q => d.contracts[q.key]?.how === 'rookie')) {
      expect(d.contracts[p.key]).toMatchObject({ teamId: p.teamId, dp: rookieScale(p.n, 8).dp, years: 3 });
    }
    expectConserved(d);
  });

  it('an AI team with a seat and room signs the pick it holds by tip-off, on the scale of his slot', () => {
    // BUILT (2026-09-18): the count of signed picks in the seeded year above
    // moved with the books the pool dealt, so the rule is pinned here on a
    // case of its own — an AI team of exactly eight on 1-DP deals, far under
    // its apron with seats to spare, holding the first pick unsigned. It
    // fails if the AI stops signing its picks, or renounces them at the draft.
    const rng = seeded(14);
    let d = ownDynasty({ size: 8 });
    d = autoYear(d, rng);
    d = closeResign(d, { rng });
    d = finishDraft(driveDraft(drawLottery(d, { rng }), rng), { rng });
    expect(d.phase).toBe(DPHASE.rookies);
    const ai = d.teams.find(t => !t.human).id;
    const rights = Object.fromEntries(Object.entries(d.rights ?? {}).filter(([, r]) => !(r.teamId === ai && r.kind === 'rookie')));
    // The eight are the cheapest cards outside the draft (cheaply,
    // 2026-09-19), so the AI's card-salary ceiling has room for the pick too.
    let x = cheaply({ ...d, rights }, ai, MIN_ROSTER);
    const key = x.draftPool.find(k => getCardByKey(k));
    x = { ...x, draftPool: x.draftPool.filter(k => k !== key), league: [...x.league, key], rights: { ...x.rights, [key]: { teamId: ai, kind: 'rookie', pick: 1 } } };
    // The AI-AI trade search runs on the way to tip-off, and which deals it
    // finds depends on the pool: on 2026-09-24 (56 dormant Throwbacks left it)
    // it moved this signed pick to Dallas. The budget is spent, as noAiTrades says.
    x = closeRookies(noAiTrades(x), { rng });
    for (let guard = 0; guard < 10 && x.phase === DPHASE.freeAgency; guard += 1) x = nextFaDay(x, { rng });
    x = startSeason(fillRoster(x, HUMAN_ID), { rng });
    expect(x.contracts[key]).toMatchObject({ teamId: ai, dp: rookieScale(1, 8).dp, years: 3, how: 'rookie' });
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
    // EXACTLY SIX (2026-09-18): trimmed, or topped up from outside the draft —
    // the seeded year left this team five when one card changed team.
    const sixed = exactly(base, ai, 6);
    const six = { ...sixed, draft: { ...sixed.draft, order: sixed.draft.order.map((t, i) => (i === 0 ? ai : t)) } };
    expect(rosterKeys(six, ai)).toHaveLength(6);
    const gap = aiApronDp(six) - payroll(six, ai);
    // No AI-AI trade either: one would change the roster this compares to.
    const at = noAiTrades({ ...six, dead: [...six.dead, { teamId: ai, key: 'x', dp: gap, through: six.year }] });
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
    // Exactly n, not at most n (2026-09-18): a trim alone left fewer when the
    // seeded year did, and the case under test changed with the pool.
    const trimmed = (x, teamId, n) => exactly(x, teamId, n);
    const withRoom = (x, teamId, room, apron) => ({ ...x, dead: [...x.dead, { teamId, key: `x-${teamId}`, dp: apron - payroll(x, teamId) - room, through: x.year }] });
    const onFirst = x => ({ ...x, draft: { ...x.draft, order: x.draft.order.map((t, i) => (i === 0 ? ai : t)) } });
    // Seven players and 7 DP of room: an eighth on a 1-DP deal keeps it under
    // the apron, so a 10-DP first pick is passed, not drafted past it.
    const seven = onFirst(withRoom(trimmed(base, ai, 7), ai, 7, aiApronDp(base)));
    expect(aiDraftChoice(seven, ai, () => 0)).toBeNull();
    // Seven and no room at all: the pick is drafted — it fills the seat.
    expect(aiDraftChoice(onFirst(withRoom(trimmed(base, ai, 7), ai, 0, aiApronDp(base))), ai, () => 0)).not.toBeNull();
    // A human of six at the apron signs nothing past it — the human's apron is a hard line.
    // THE CHEAPEST card outside the draft (2026-09-21): the pool's first card
    // was the pick until today, and on the committed free-agent pool that was
    // a $1,260 card the AI's card-salary ceiling (2026-09-18) refused for
    // six men at $5,500 — this is the DP door's test, so the card must be
    // one the ceiling has nothing to say about.
    const spare = base.draftPool.filter(k => !base.draft.pool.includes(k) && getCardByKey(k))
      .sort((p, q) => getCardByKey(p).salary - getCardByKey(q).salary)[0];
    let h = withRoom(trimmed(base, HUMAN_ID, 6), HUMAN_ID, 0, APRON_DP);
    h = { ...h, phase: DPHASE.rookies, rights: { ...h.rights, [spare]: { teamId: HUMAN_ID, kind: 'rookie', pick: 1 } } };
    expect(rookieProblem(h, HUMAN_ID, spare)).toMatch(/apron/);
    // ...where an AI team of six at its apron signs him.
    let a = withRoom(trimmed(base, ai, 6), ai, 0, aiApronDp(base));
    a = { ...a, phase: DPHASE.rookies, rights: { ...a.rights, [spare]: { teamId: ai, kind: 'rookie', pick: 1 } } };
    expect(rookieProblem(a, ai, spare)).toBeNull();
  });

  it('re-signs so that its payroll and the scale of its two projected first-rounders fit its apron', () => {
    // BUILT (2026-09-21). Until today the AI team's ten were its five
    // cheapest swapped for the other AI teams' five dearest, and "keeping
    // everyone would have gone far past the apron" was read off their OLD
    // contracts — which came to 104 DP on the live pool once the card-salary
    // ceiling (2026-09-18) had own-start AI teams arriving on ~40 DP of real
    // contracts, so the budget never bound. What a re-sign costs is the
    // man's FLOOR, priced off his card, so the case is built on the cards:
    // ten Easygoing men whose floors are 5 DP each, all expiring, and dead
    // money that leaves room for some of them beside the scale of the two
    // first-rounders it holds in the coming draft (its own and the worst
    // team's, bought in a trade; its second-rounder is given away so the
    // picks under test are the two the title names). The first man asks 5,
    // plus at most 20 of scale and 25 kept for the five seats still short
    // (AI_RESERVE_PER_SPOT) — 50 of room; all ten ask 50 plus at least 15 of
    // scale — 65. Dead money of the apron less 60 sits between: some are
    // kept, some walk, and what is kept fits beside both picks.
    const rng = () => 0;   // every expiring player wanted — only the money decides
    const s = seeded(17);
    const played = finishSeason(startSeason(ownDynasty({ size: 8 }), { rng: s }));
    const ai = played.teams.find(t => !t.human).id;
    const worst = [...played.teams].map(t => t.id).filter(id => id !== ai)
      .sort((x, y) => standings(played.season).find(r => r.id === y).rank - standings(played.season).find(r => r.id === x).rank)[0];
    const spare = played.draftPool.filter(k => !(played.draftClass?.keys ?? []).includes(k) && getCardByKey(k));
    const easy = { ...played, traits: { ...played.traits, ...Object.fromEntries(spare.map(k => [k, 'easy'])) } };
    // THE CHEAPEST TEN CARDS, not the first ten found: the case is about the
    // DP budget, so the card-salary ceiling must have nothing to say (the
    // precondition below). Taking the first ten let one card added to the
    // pool deal a dearer ten past $5,500 — a Free Agents build did, 2026-09-25.
    const ten = spare.filter(k => floorOf(easy, k, ai, preferredYears('easy'), 1) === 5)
      .sort((a, b) => getCardByKey(a).salary - getCardByKey(b).salary)
      .slice(0, MAX_ROSTER);
    expect(ten).toHaveLength(MAX_ROSTER);
    const contracts = Object.fromEntries(Object.entries(easy.contracts).filter(([, c]) => c.teamId !== ai));
    for (const k of ten) contracts[k] = { teamId: ai, dp: 1, years: 1, since: easy.year, how: 'fill' };
    const dead = aiApronDp(played) - 60;
    // AND A CHEAP CLASS, pinned: the seeded draw moves with the pool, and one
    // new card (2026-09-25) drew Michael Jordan's $2,080 Super Season into it,
    // which the ceiling then had to reserve for twice. The case is the DP
    // budget, so the class keeps only cards of $1,000 or less.
    const cheapClass = classFor(easy).filter(k => (getCardByKey(k)?.salary ?? Infinity) <= 1000);
    const d = {
      ...easy, contracts, league: [...easy.league, ...ten], draftPool: easy.draftPool.filter(k => !ten.includes(k)),
      draftClass: { ...(easy.draftClass ?? {}), year: nextDraftYear(easy), keys: cheapClass },
      dead: [...easy.dead, { teamId: ai, key: 'x', dp: dead, through: easy.year + 1 }],
      pickOwner: { ...easy.pickOwner, [pickId(easy.year + 1, 1, worst)]: ai, [pickId(easy.year + 1, 2, ai)]: HUMAN_ID },
    };
    expect(rosterKeys(d, ai)).toHaveLength(MAX_ROSTER);
    // The ceiling has nothing to say: at its tightest (the tenth man, no
    // seat short) it holds the ten cards and the class card each first-
    // rounder is projected to carry — under $5,500 even at the class's
    // dearest card twice over.
    const dearestInClass = Math.max(...classFor(d).filter(k => getCardByKey(k)).map(k => getCardByKey(k).salary));
    expect(aiSalaryOf(d, ai) + 2 * dearestInClass).toBeLessThanOrEqual(aiSalaryCap(d));

    const y = endSeason(d, { rng });
    expect(y.phase).toBe(DPHASE.resign);
    const firsts = [ai, worst].map(t => rookieScale(projectedSlot(y, t), 8).dp);
    const kept = rosterKeys(y, ai);
    // The budget binds: keeping all ten at their floors would have gone past the apron.
    expect(dead + MAX_ROSTER * 5 + firsts[0] + firsts[1]).toBeGreaterThan(aiApronDp(y));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(MAX_ROSTER);
    for (const k of kept) expect(y.contracts[k]).toMatchObject({ teamId: ai, dp: 5, how: 'resign' });
    for (const k of ten.filter(k => !kept.includes(k))) expect(freeAgentKeys(y)).toContain(k);
    expect(payroll(y, ai) + firsts[0] + firsts[1]).toBeLessThanOrEqual(aiApronDp(y));
  });

  it('lets a man walk for its picks alone: the same window without them keeps him', () => {
    // BUILT (2026-09-18). This was the last line of the test above — "the
    // same window with neither pick keeps more DP" — and one card changing
    // team broke it: the re-sign is greedy, dearest first, so freed room can
    // keep one dear man in place of two cheaper ones and end LOWER (a
    // verifier's pool: 87 both ways; the live pool 90 against 87 by luck).
    // So one man decides it here: nine players on deals that run on, one
    // expiring, and dead money leaving room for exactly his ask. With the
    // picks held he walks; without them he stays. Guards that the pick
    // reserve (draftReserve) is what the re-sign spends against.
    const rng = () => 0;   // every expiring player wanted — only the money decides
    const played = finishSeason(startSeason(ownDynasty({ size: 8 }), { rng: seeded(17) }));
    const ai = played.teams.find(t => !t.human).id;
    // The ten are the cheapest cards outside the draft (cheaply), so the AI's
    // CARD-salary ceiling (aiSalaryCap) never binds and only the DP decides.
    // On 2026-09-24 the pool's reshuffle handed this roster Shai
    // Gilgeous-Alexander and a card total over that ceiling: every expiring
    // man walked, cheap or dear, and the test decided nothing.
    const full = cheaply(played, ai, MAX_ROSTER);
    const worst = played.teams.map(t => t.id).find(id => id !== ai);
    const windowFor = expiring => {
      const contracts = { ...full.contracts, [expiring]: { ...full.contracts[expiring], years: 1 } };
      for (const k of rosterKeys(full, ai).filter(k => k !== expiring)) contracts[k] = { ...contracts[k], dp: 5, years: 3 };
      const withPicks = { ...full, contracts, pickOwner: { ...full.pickOwner, [pickId(full.year + 1, 1, ai)]: ai, [pickId(full.year + 1, 2, ai)]: ai, [pickId(full.year + 1, 1, worst)]: ai } };
      const noPicks = { ...withPicks, pickOwner: { ...withPicks.pickOwner, [pickId(full.year + 1, 1, ai)]: worst, [pickId(full.year + 1, 2, ai)]: worst, [pickId(full.year + 1, 1, worst)]: worst } };
      return { withPicks, noPicks };
    };
    // THE EXPIRING MAN IS ONE THE ROOM CAN KEEP: the first on the roster whose
    // ask the all-room window meets, so which man sits first cannot decide it.
    const expiring = rosterKeys(full, ai).find(k => endSeason(windowFor(k).noPicks, { rng }).contracts[k]?.dp > 0);
    const { withPicks, noPicks } = windowFor(expiring);
    // His ask, read off a window with all the room in the world (the floor
    // reads his card, trait, last team and standing — never the money).
    const ask = endSeason(noPicks, { rng }).contracts[expiring]?.dp;
    expect(ask).toBeGreaterThan(0);
    // Dead money through next season leaves room for exactly that ask.
    const tight = x => ({ ...x, dead: [...x.dead, { teamId: ai, key: 'x', dp: aiApronDp(x) - (MAX_ROSTER - 1) * 5 - ask, through: x.year + 1 }] });
    const kept = endSeason(tight(noPicks), { rng });
    expect(kept.contracts[expiring]).toMatchObject({ teamId: ai, dp: ask });
    expect(payroll(kept, ai)).toBe(aiApronDp(kept));
    const walked = endSeason(tight(withPicks), { rng });
    expect(walked.contracts[expiring]).toBeUndefined();
    expect(walked.rights[expiring]).toBeUndefined();
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
    const played = finishSeason(startSeason(ownDynasty({ size: 8 }), { rng: s }));
    const ai = played.teams.find(t => !t.human).id;
    // BUILT (2026-09-18): the man was SEARCHED for — whoever on this roster
    // wanted two years or more — so the case hung on the traits the pool
    // dealt. He is chosen and made Loyal, who wants three (PERSONALITIES).
    const key = rosterKeys(played, ai)[0];
    const done = { ...played, traits: { ...played.traits, [key]: 'loyal' } };
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
    // What he re-signs for when nothing is in the way (no picks in either
    // draft, a light payroll): a deal that runs past this year.
    const terms = endSeason(noPicks(books(key, 1), [next, next + 1]), { rng }).contracts[key];
    expect(terms).toMatchObject({ teamId: ai, years: PERSONALITIES.loyal.years });
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
    // Topped up from the CHEAP end of what is outside the draft (2026-09-18):
    // the pick also has to fit the AI's card-salary ceiling (aiSalaryCap).
    const spare = base.draftPool.filter(k => !base.draft.pool.includes(k) && getCardByKey(k))
      .sort((a, b) => getCardByKey(a).salary - getCardByKey(b).salary);
    const need = MAX_ROSTER - rosterKeys(base, ai).length;
    for (const k of spare.slice(0, need)) contracts[k] = { teamId: ai, dp: 1, years: 1, since: base.year, how: 'fill' };
    const talent = k => talentValue(getCardByKey(k));
    const star = [...rosterKeys({ contracts }, ai)].sort((a, b) => talent(b) - talent(a))[0];
    contracts[star] = { ...contracts[star], dp: 40, years: 3 };
    // Only players below the star and above the weakest man are left on the
    // board (2026-09-18). The pick is talent for the roster's NEED, so with a
    // weaker man on the board a pool that dealt this team different
    // positions could rank him first and pass — the test read it as the rule
    // failing. Every man on this board beats the weakest, so the rule under
    // test (weigh the pick against the weakest, not the worst-value contract)
    // is all that decides whether it drafts.
    const weakestNow = k => talent(k) > Math.min(...rosterKeys({ contracts }, ai).map(talent));
    // ...and who fit the ceiling in the weakest man's place, so the salary
    // ceiling (its own tests below) is not what decides here either.
    const shed = rosterKeys({ contracts }, ai).reduce((w, k) => (talent(k) < talent(w) ? k : w));
    const fitsShed = k => salaryFits({ ...base, contracts }, ai, [k], [shed]);
    const pool = base.draft.pool.filter(k => talent(k) < talent(star) && weakestNow(k) && fitsShed(k));
    expect(pool.length).toBeGreaterThan(1);
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
    expect(pool).toContain(choice);
    expect(talent(choice)).toBeGreaterThan(talent(weakest));
    // With the board narrowed to one man better than the weakest, it is him.
    const only = [...pool].sort((a, b) => talent(b) - talent(a))[0];
    expect(top).toBe(talent(only));
    expect(aiDraftChoice({ ...x, draft: { ...x.draft, pool: [only] } }, ai, () => 0)).toBe(only);
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
  //
  // `roster` (2026-09-18, a verifier's pool-shift run): when given, the AI
  // team's dealt men are released to free agency and exactly these keys —
  // taken from the undrafted pool — are signed at 5 DP each, so a test sets
  // the talent of every man the shed is weighed against instead of taking
  // whatever the seeded draft dealt. Without it, the dealt roster is topped
  // up from the front of the pool, as before.
  const setup = (pickKeys, roster = null) => {
    const d = ownDynasty({ size: 4 });
    const ai = d.teams.find(t => !t.human).id;
    const pool = d.draftPool.filter(k => !pickKeys.includes(k));
    const dealt = roster ? rosterKeys(d, ai) : [];
    const need = roster ? 0 : MAX_ROSTER - rosterKeys(d, ai).length;
    const fillers = roster ? [...roster] : pool.slice(0, need);
    if (roster) expect(roster.every(k => pool.includes(k))).toBe(true);
    const contracts = Object.fromEntries(Object.entries(d.contracts)
      .filter(([k]) => !dealt.includes(k))
      .map(([k, c]) => [k, c.teamId === ai ? { ...c, dp: 5 } : c]));
    for (const k of fillers) contracts[k] = { teamId: ai, dp: 5, years: 1, since: d.year, how: 'fill' };
    const rights = { ...d.rights };
    pickKeys.forEach((k, i) => { rights[k] = { teamId: ai, kind: 'rookie', pick: 2 + i * 4 }; });
    // No AI-AI trade at tip-off: the roster under test stays the one built here.
    const x = noAiTrades({
      ...d, contracts, rights,
      league: [...leagueKeys(d), ...fillers, ...pickKeys],
      draftPool: pool.filter(k => !fillers.includes(k)),
    });
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
  // The undrafted pool ranked by talent, and a band of eight from its middle:
  // a roster every test below can set by hand (2026-09-18). Each test asserts
  // the talent gap it relies on, so a pool with no spread fails loudly here
  // rather than passing on a tie.
  //
  // A band from the pool's LOW end, not its middle (2026-09-18): an AI team's
  // pick also has to fit its card-salary ceiling (aiSalaryCap, $5,500 at
  // Prince), and the middle ten already came to ~$5,480 — no pick would ever
  // have fitted beside them. Each test asserts the room it relies on.
  const ranked = byTalent(d0.draftPool);
  const mid = Math.floor(ranked.length * 0.9);
  const middle = ranked.slice(mid, mid + MAX_ROSTER);
  const salaryOfKeys = keys => keys.reduce((t, k) => t + getCardByKey(k).salary, 0);

  it('waives its weakest man — dead money — for a better pick, ONE contract only, and lets the next pick lapse', () => {
    // Guards: the shed fires for a pick better than the weakest man, sheds ONE
    // contract (its DP stays as dead money), and the second pick lapses. The
    // picks are the pool's best two; the roster is the pool's middle eight.
    const [star, second] = ranked;
    const { x, ai, worst } = setup([star, second], middle);
    expect(middle).toContain(worst);
    expect(talentValue(getCardByKey(star))).toBeGreaterThan(talentValue(getCardByKey(worst)));
    expect(talentValue(getCardByKey(second))).toBeGreaterThan(talentValue(getCardByKey(worst)));
    // The star fits the ceiling in place of the weakest man, so the shed is
    // weighed on talent alone (the second lapses: one shed a team).
    expect(salaryOfKeys([...middle.filter(k => k !== worst), star])).toBeLessThanOrEqual(aiSalaryCap(x));
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
    // Guards: no shed when the pick is no better than the weakest man. The
    // pick is the pool's least talent; the roster is the pool's middle eight,
    // so every man on it is at least as good (built, not searched: the dealt
    // roster could hold someone below the pool's floor).
    const scrub = ranked.at(-1);
    const { x, ai, worst } = setup([scrub], middle);
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
    // BUILT (2026-09-18, a verifier's pool shift tied the pick with the
    // weakest man): the roster is the pool's best card plus seven of its
    // middle, and the pick sits at the pool's quarter mark — strictly above
    // every middle man, never above the best.
    const pick = ranked[Math.floor(ranked.length / 4)];
    const { x: base, ai } = setup([pick], [ranked[0], ...middle.slice(0, MAX_ROSTER - 1)]);
    const star = byTalent(rosterKeys(base, ai))[0];
    expect(star).toBe(ranked[0]);
    // 55 DP (40 until 2026-09-18): the pool's best card is worth ~40, so 40
    // was only "far over his worth" beside a middle band on underpaid deals;
    // beside the low band the ceiling needs, 55 keeps him the worst value.
    const x = { ...base, contracts: { ...base.contracts, [star]: { ...base.contracts[star], dp: 55, years: 3 } } };
    const value = k => contractValue(getCardByKey(k), x.contracts[k]);
    const worstValue = rosterKeys(x, ai).reduce((w, k) => (value(k) < value(w) ? k : w));
    const weakest = shedOf(x, ai);
    expect(worstValue).toBe(star);
    expect(weakest).not.toBe(star);
    // The old rule would have let him lapse; the new one sheds the weakest.
    expect(talentValue(getCardByKey(pick))).toBeLessThanOrEqual(talentValue(getCardByKey(star)));
    expect(talentValue(getCardByKey(pick))).toBeGreaterThan(talentValue(getCardByKey(weakest)));
    expect(payroll(x, ai) + rookieScale(2, 4).dp).toBeLessThanOrEqual(aiApronDp(x));
    expect(aiSalaryOf(x, ai) - getCardByKey(weakest).salary + getCardByKey(pick).salary).toBeLessThanOrEqual(aiSalaryCap(x));
    const y = startSeason(fillRoster(x, HUMAN_ID), { rng: seeded(3) });
    expect(y.contracts[star]).toMatchObject({ teamId: ai, dp: 55 });
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
    // No AI-AI trade at tip-off: "keeps its eight" means these eight.
    const x = noAiTrades({
      ...eight,
      dead: [...(eight.dead ?? []), { teamId: ai, key: 'x', dp: aiApronDp(eight) - payroll(eight, ai), through: eight.year }],
      rights: { ...eight.rights, [star]: { teamId: ai, kind: 'rookie', pick: 1 } },
      league: [...leagueKeys(eight), star],
      draftPool: eight.draftPool.filter(k => k !== star),
    });
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

// ── WAIVERS (the user, 2026-09-18) ─────────────────────────────────────────
//
// "If they are claimed, that money would come off the cap." Every case here
// is BUILT: each team's roster is dealt from the base set by rank — not by
// what a seeded draft happened to leave it — every contract is set by hand,
// and the standings that fix waiver priority are written in. So no test
// below moves when the card pool does.
describe('waivers (2026-09-18)', () => {
  const talentOf = k => talentValue(getCardByKey(k));
  /**
   * A preseason of `size` teams — the human first — every roster rebuilt
   * from base cards worth 3–29 DP (each worth more than a 1-DP deal, none a
   * max star), `sizes(ids)[teamId]` players a team (nine by default: a
   * seat free), every contract 1 DP × 2 years, and a regular season in the
   * history ranking `worstFirst(ids)` from the bottom up. `ids` is the
   * league's team ids, the human first.
   */
  function wireLeague({ size = 4, sizes: sizesOf = () => ({}), worstFirst: orderOf = null } = {}) {
    const d = ownDynasty({ size });
    const ids = d.teams.map(t => t.id);
    const sizes = sizesOf(ids);
    const worstFirst = orderOf ? orderOf(ids) : null;
    // The CHEAP end of that band, cheapest first (2026-09-18): every AI team
    // must sit under its card-salary ceiling (aiSalaryCap, $5,500 at Prince)
    // for a claim to turn on DP, seats and value — dealt from the dear end,
    // nine men a team were $10,000+ and could add no salary at all.
    const deck = CARDS.filter(c => fairDp(c) >= 3 && fairDp(c) <= 29)
      .sort((a, b) => a.salary - b.salary || a.id.localeCompare(b.id)).map(cardKey);
    const contracts = {};
    let at = 0;
    for (const id of ids) {
      const n = sizes[id] ?? 9;
      for (let i = 0; i < n; i += 1) {
        contracts[deck[at]] = { teamId: id, dp: 1, years: 2, since: 1, how: 'brought' };
        at += 1;
      }
    }
    const dealt = new Set(Object.keys(contracts));
    const order = worstFirst ?? ids;
    const table = order.map((id, i) => ({ id, w: i, l: order.length - i, rank: order.length - i }));
    const x = {
      ...d,
      contracts,
      league: [...new Set([...leagueKeys(d), ...dealt])],
      draftPool: d.draftPool.filter(k => !dealt.has(k)),
      rights: {},
      dead: [],
      history: [{ year: 0, champion: null, runnerUp: null, playoffSeeds: [], table }],
    };
    expectConserved(x);
    return { d: x, ids };
  }
  const setDeal = (d, key, deal) => ({ ...d, contracts: { ...d.contracts, [key]: { ...d.contracts[key], ...deal } } });
  const best = (d, teamId) => [...rosterKeys(d, teamId)].sort((a, b) => talentOf(b) - talentOf(a))[0];
  const worstOf = (d, teamId) => [...rosterKeys(d, teamId)].sort((a, b) => talentOf(a) - talentOf(b))[0];

  it('a claim clears the dead money of the waive it took — not an earlier waive of the same man — and no DP leaves the league', () => {
    // Reviewer, 2026-09-18: the claim removed the FIRST dead entry for the
    // man that year. Waived unclaimed at 35, back on 1, waived and claimed:
    // the 35 went and the claimant took the 1 — 34 DP gone from the league.
    const { d: d0, ids: [me, a, b, c] } = wireLeague({ worstFirst: ([me, a, b, c]) => [c, b, a, me] });
    const key = best(d0, me);
    const total = x => x.teams.reduce((t, team) => t + payroll(x, team.id), 0);
    // Overpaid at 35 × 3: nobody claims him, and the 35 stays dead.
    const first = resolveWaivers(waive(setDeal(d0, key, { dp: 35, years: 3 }), me, key));
    expect(first.contracts[key]).toBeUndefined();
    expect(freeAgentKeys(first)).toContain(key);
    expect(deadMoney(first, me)).toBe(35);
    // Back on a 1-DP deal (a re-sign at his ask, a trade back), then waived again.
    const back = { ...first, contracts: { ...first.contracts, [key]: { teamId: me, dp: 1, years: 3, since: first.year, how: 'fa' } } };
    const before = total(back);
    const second = waive(back, me, key);
    expect(deadMoney(second, me)).toBe(36);
    // A bargain at 1 DP: the worst record with a seat claims him.
    const y = resolveWaivers(second);
    expect(y.contracts[key]).toMatchObject({ teamId: c, dp: 1, years: 3, how: 'waivers' });
    // Only the claimed waive's 1 DP comes off; the first waive's 35 stays.
    expect(deadMoney(y, me)).toBe(35);
    expect(y.dead.filter(m => m.teamId === me && m.key === key)).toEqual([{ teamId: me, key, dp: 35, through: y.year }]);
    expect(total(y)).toBe(before);
    expectConserved(y);
  });

  it('orders the wire worst record first, and before any season by a seeded order the same on every read', () => {
    const { d, ids: [me, a, b, c] } = wireLeague({ worstFirst: ([me, a, b, c]) => [c, me, b, a] });
    expect(waiverOrder(d)).toEqual([c, me, b, a]);
    const { history: _none, ...fresh } = d;
    const seededOrder = waiverOrder({ ...fresh, history: [] });
    expect([...seededOrder].sort()).toEqual([...d.teams.map(t => t.id)].sort());
    expect(waiverOrder(JSON.parse(JSON.stringify({ ...fresh, history: [] })))).toEqual(seededOrder);
  });

  it('a waived bargain is claimed by the worst-record team with room, and the waiving team\'s dead money disappears', () => {
    const { d: d0, ids: [me, a, b, c] } = wireLeague({ worstFirst: ([me, a, b, c]) => [c, b, me, a] });
    const key = best(d0, a);
    const d = setDeal(d0, key, { dp: 1, years: 3 });
    expect(contractValue(getCardByKey(key), { dp: 1, years: 3 })).toBeGreaterThan(0);
    const x = waive(d, a, key);
    // On the wire: off A's roster, its DP dead for now, and nobody's free agent.
    expect(onWaivers(x, key)).toBe(true);
    expect(freeAgentKeys(x)).not.toContain(key);
    expect(deadMoney(x, a)).toBe(1);
    expect(() => negotiate(x, me, key, { dp: 5, years: 2 })).toThrow(/on waivers/);
    expectConserved(x);
    // The league moves on — the season tips off — and the wire resolves first.
    const y = startSeason(x, { rng: seeded(3) });
    expect(y.contracts[key]).toEqual({ teamId: c, dp: 1, years: 3, since: y.year, how: 'waivers' });
    expect(deadMoney(y, a)).toBe(0);
    expect(payroll(y, a)).toBe(payroll(d, a) - 1);
    expect(waiverList(y)).toEqual([]);
    const name = getCardByKey(key).name;
    expect(y.news.some(n => n.text === `${teamOf(y, c).name} claimed ${name} off waivers — his salary comes off ${teamOf(y, a).name}'s books.`)).toBe(true);
    expect(y.season.teams.find(t => t.id === c).roster.map(cardKey)).toContain(key);
    expectConserved(y);
  });

  it('an overpaid contract goes unclaimed: the dead money stays and he is a free agent', () => {
    const { d: d0, ids: [, a, b, c] } = wireLeague({ worstFirst: ([, a, b, c]) => [c, b, a] });
    const key = worstOf(d0, a);
    const d = setDeal(d0, key, { dp: 30, years: 3 });
    // Worth under 30 DP (the deck stops at 29), so every AI team with room still passes.
    expect(contractValue(getCardByKey(key), { dp: 30, years: 3 })).toBeLessThan(0);
    for (const t of [b, c]) expect(claimProblem(waive(d, a, key), t, key)).toBeNull();
    const y = resolveWaivers(waive(d, a, key));
    expect(y.contracts[key]).toBeUndefined();
    expect(freeAgentKeys(y)).toContain(key);
    expect(deadMoney(y, a)).toBe(30);
    expect(y.news[0].text).toMatch(/^Nobody claimed .* stays on .*'s books/);
    expectConserved(y);
  });

  it('a coach\'s claim beats a lower-priority AI claim and loses to a higher one; no claim, no contract', () => {
    // A waives a bargain; the order is B, then you, then C.
    const build = bSize => {
      const { d: d0, ids: [me, a, b, c] } = wireLeague({ worstFirst: ([me, a, b, c]) => [b, me, c, a], sizes: ([, , b]) => ({ [b]: bSize }) });
      const key = best(d0, a);
      return { x: waive(setDeal(d0, key, { dp: 1, years: 3 }), a, key), key, me, a, b, c };
    };
    // B is full, so it is passed over: your claim, ahead of C, takes him.
    const full = build(MAX_ROSTER);
    expect(claimProblem(full.x, full.b, full.key)).toMatch(/full/);
    const mine = claimWaiver(full.x, full.me, full.key);
    expect(waiverList(mine)[0].claims).toEqual([full.me]);
    expect(resolveWaivers(mine).contracts[full.key].teamId).toBe(full.me);
    // Without your claim C, behind you, takes him — a coach never claims by default.
    expect(resolveWaivers(full.x).contracts[full.key].teamId).toBe(full.c);
    // A claim taken back is no claim.
    expect(resolveWaivers(withdrawClaim(mine, full.me, full.key)).contracts[full.key].teamId).toBe(full.c);
    // B with a seat is ahead of you and claims him whatever you put in.
    const open = build(9);
    expect(resolveWaivers(claimWaiver(open.x, open.me, open.key)).contracts[open.key].teamId).toBe(open.b);
    // You cannot claim your own waive, and an AI team cannot put in a claim.
    expect(() => claimWaiver(open.x, open.a, open.key)).toThrow(/only a coach/);
    const mineWaived = waive(wireLeague().d, HUMAN_ID, best(wireLeague().d, HUMAN_ID));
    expect(() => claimWaiver(mineWaived, HUMAN_ID, waiverList(mineWaived)[0].key)).toThrow(/you waived him/);
  });

  it('a claim never takes a team past its apron or its roster size', () => {
    // Five teams; A waives. The order is B (full), C (at its apron), you, E.
    const { d: d0, ids: [me, a, b, c, e] } = wireLeague({ size: 5, worstFirst: ([me, a, b, c, e]) => [b, c, me, e, a], sizes: ([, , b]) => ({ [b]: MAX_ROSTER }) });
    const key = best(d0, a);
    // 2 DP (4 until 2026-09-18, when the league was dealt from the cheap end
    // of the band for the salary ceiling): under his worth, so E claims him.
    const d1 = setDeal(d0, key, { dp: 2, years: 3 });
    expect(contractValue(getCardByKey(key), { dp: 2, years: 3 })).toBeGreaterThan(0);
    // C one DP under its apron: a 2-DP claim would take it past.
    const d = { ...d1, dead: [{ teamId: c, key: 'x', dp: aiApronDp(d1) - payroll(d1, c) - 1, through: d1.year }] };
    let x = waive(d, a, key);
    expect(claimProblem(x, b, key)).toMatch(/full at 10/);
    expect(claimProblem(x, c, key)).toMatch(/past the 115 apron/);
    // Your claim is checked when you make it and again when the wire resolves.
    x = claimWaiver(x, me, key);
    const filler = x.draftPool[0];
    const crowded = { ...x, contracts: { ...x.contracts, [filler]: { teamId: me, dp: 1, years: 1, since: 1, how: 'fill' } }, league: [...x.league, filler], draftPool: x.draftPool.slice(1) };
    expect(rosterKeys(crowded, me)).toHaveLength(MAX_ROSTER);
    expect(() => claimWaiver(crowded, me, key)).toThrow(/full/);
    const broke = { ...x, dead: [...x.dead, { teamId: me, key: 'y', dp: APRON_DP - payroll(x, me) - 1, through: x.year }] };
    expect(() => claimWaiver(broke, me, key)).toThrow(/past the 130 apron/);
    for (const [state, name] of [[crowded, 'crowded'], [broke, 'broke']]) {
      const y = resolveWaivers(state);
      expect(y.contracts[key].teamId, name).toBe(e);
      for (const t of y.teams) {
        expect(rosterKeys(y, t.id).length).toBeLessThanOrEqual(MAX_ROSTER);
        if (payroll(y, t.id) > payroll(state, t.id)) expect(payroll(y, t.id)).toBeLessThanOrEqual(t.human ? APRON_DP : aiApronDp(y));
      }
    }
    // With your roster and books fine, your standing claim is ahead of E.
    expect(resolveWaivers(x).contracts[key].teamId).toBe(me);
  });

  it('an AI team\'s deadline shed goes through waivers too, and a claim in season clears its books at the next round', () => {
    // A: a full ten at 1 DP a man, holding a pick far better than its weakest.
    const { d: d0, ids: [me, a, b, c] } = wireLeague({ worstFirst: ([me, a, b, c]) => [c, b, me, a], sizes: ([, a]) => ({ [a]: MAX_ROSTER }) });
    const floor = Math.min(...rosterKeys(d0, a).map(talentOf));
    const pick = [...d0.draftPool].filter(k => getCardByKey(k)).sort((x, y) => talentOf(y) - talentOf(x))[0];
    expect(talentOf(pick)).toBeGreaterThan(floor);
    const d = {
      ...d0,
      rights: { [pick]: { teamId: a, kind: 'rookie', pick: 2 } },
      league: [...d0.league, pick],
      draftPool: d0.draftPool.filter(k => k !== pick),
    };
    const y = startSeason(d, { rng: seeded(3) });
    // The shed — its weakest man (shedCandidate) — off A's books but for the
    // dead money, on the wire, and the pick signed.
    expect(y.contracts[pick]).toMatchObject({ teamId: a, how: 'rookie' });
    const weakest = waiverList(y).find(w => w.from === a)?.key;
    expect(talentOf(weakest)).toBe(floor);
    expect(onWaivers(y, weakest)).toBe(true);
    expect(freeAgentKeys(y)).not.toContain(weakest);
    expect(deadMoney(y, a)).toBe(1);
    expectConserved(y);
    // A result that does not turn the round leaves the wire alone...
    expect(onWaivers(seasonTurn(y, { ...y.season }), weakest)).toBe(true);
    // ...and the round turning resolves it: C, worst, claims his 1-DP deal.
    const z = seasonTurn(y, { ...y.season, round: y.season.round + 1 });
    expect(z.contracts[weakest]).toMatchObject({ teamId: c, dp: 1, how: 'waivers' });
    expect(deadMoney(z, a)).toBe(0);
    expect(z.season.teams.find(t => t.id === c).roster.map(cardKey)).toContain(weakest);
    expectConserved(z);
  });

  it('an older save with no waiver list reads as an empty one, and waives, claims and resolves as a new one', () => {
    const { d: withWire, ids: [me, a] } = wireLeague();
    const { waivers: _none, ...old } = JSON.parse(JSON.stringify(withWire));
    expect(old.waivers).toBeUndefined();
    expect(waiverList(old)).toEqual([]);
    expect(resolveWaivers(old)).toBe(old);
    expect(freeAgentKeys(old)).toEqual(freeAgentKeys(withWire));
    expect(claimProblem(old, me, rosterKeys(old, a)[0])).toMatch(/not on waivers/);
    expect(startSeason(old, { rng: seeded(3) }).phase).toBe(DPHASE.season);
    const key = best(old, a);
    const x = claimWaiver(waive(setDeal(old, key, { dp: 1, years: 3 }), a, key), me, key);
    const back = unpackDynasty(packDynasty(x));
    expect(waiverList(back)).toEqual(waiverList(x));
    expect(resolveWaivers(back).contracts[key]).toBeDefined();
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

  it('reads a join year of 0 as a real join, not as never joined', () => {
    // Guards ageOf (2026-09-18): it tested the join year for truthiness, so a
    // join back-dated to year 0 (the aging test below writes one whenever the
    // young card it is handed is 25 in year 1 — a verifier found it on the
    // committed card pool) left the man at his base age.
    const d = { ...aged(), year: 3 };
    const key = rosterKeys(d, HUMAN_ID)[0];
    expect(ageOf({ ...d, joined: { ...d.joined, [key]: 0 } }, key)).toBe(baseAge(key) + 3);
    expect(ageOf({ ...d, joined: { ...d.joined, [key]: 1 } }, key)).toBe(baseAge(key) + 2);
    // No join year at all still means he has not aged here.
    const { [key]: _none, ...rest } = d.joined;
    expect(ageOf({ ...d, joined: rest }, key)).toBe(baseAge(key));
  });

  it('ages the league a year a season, retires the old, and prices age into the ask', () => {
    const rng = seeded(32);
    let d = startSeason(aged(), { rng });
    // BUILT (2026-09-18): a man under 30 was searched for on the dealt roster.
    // A card of 26 or under is PUT on it instead — taken from the undrafted
    // pool into the league, in place of the first man, who becomes a free
    // agent — and made exactly 26 (joined set as the ask probe below does;
    // an age can be raised this way, never lowered), so retirement cannot
    // take him and the year's aging is all that is read. A card of 25 in year
    // 1 gets a join year of 0, which ageOf reads as a real join since
    // 2026-09-18 (the test above).
    const young = d.draftPool.find(k => getCardByKey(k) && baseAge(k) <= 26);
    const [out] = rosterKeys(d, HUMAN_ID);
    const { [out]: gone, ...kept } = d.contracts;
    d = {
      ...d,
      contracts: { ...kept, [young]: gone },
      league: [...d.league, young],
      draftPool: d.draftPool.filter(k => k !== young),
      joined: { ...d.joined, [young]: d.year - (26 - baseAge(young)) },
    };
    const before = ageOf(d, young);
    expect(before).toBe(26);
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
    // ...so its offseason has no retirements step: straight to re-signing.
    expect(t.phase).toBe(DPHASE.resign);
    expect(retirementWatch(t, HUMAN_ID)).toEqual([]);
  });

  // RETIREMENTS OPEN THE OFFSEASON (the user, 2026-09-25: "I had a player
  // retire in my dynasty and had no idea. Player retirements should be the
  // first part of the off-season.").
  it('opens the offseason on its retirements: yours with the deal that went, then on to re-signing', () => {
    const rng = seeded(35);
    let d = startSeason(aged(), { rng });
    // Two of the coach's men certain to go: one mid-deal, one whose deal runs out now.
    const [mid, last] = rosterKeys(d, HUMAN_ID);
    d = {
      ...d,
      joined: { ...d.joined, [mid]: d.year - (45 - baseAge(mid)), [last]: d.year - (45 - baseAge(last)) },
      contracts: { ...d.contracts, [mid]: { ...d.contracts[mid], years: 3 }, [last]: { ...d.contracts[last], years: 1 } },
    };
    const closed = endSeason(finishSeason(d), { rng });
    expect(closed.phase).toBe(DPHASE.retirements);
    expect(isOffseason(closed)).toBe(true);
    expect(PHASE_LABEL[closed.phase]).toBe('Retirements');
    const r = retirementsOf(closed);
    expect(r.year).toBe(closed.year);
    const mine = Object.fromEntries(r.list.filter(x => x.teamId === HUMAN_ID).map(x => [x.key, x]));
    expect(mine[mid]).toMatchObject({ deal: { years: 2, dp: d.contracts[mid].dp } });   // the deal still to run
    expect(mine[last]).toMatchObject({ deal: { rights: 'expiring' } });                  // the deal that had just run out
    for (const x of r.list) {
      expect(closed.retired).toContain(x.key);
      expect(x.age).toBeGreaterThanOrEqual(35);
    }
    expect(closed.retired.length).toBe(r.list.length);
    // The league has already moved: the AI re-signed at the turn, as it
    // always has, and this step only shows what happened.
    for (const t of closed.teams.filter(t => !t.human)) expect(rightsOf(closed, t.id, 'expiring')).toEqual([]);
    expect(nextDraftYear(closed)).toBe(closed.year);
    // On to the window, and nothing else changes.
    const open = closeRetirements(closed);
    expect(open.phase).toBe(DPHASE.resign);
    expect(open.contracts).toEqual(closed.contracts);
    expect(open.offers).toEqual(closed.offers);
    expect(() => closeRetirements(open)).toThrow(/retirements step/);
    // A year later the step is about that year, not this one.
    expect(retirementsOf({ ...open, year: open.year + 1 }).list).toEqual([]);
  });

  it('warns of next year\'s roll: a year older, with the Sports Science shift', () => {
    const d = { ...aged(), year: 2 };
    // A young man: a join year can raise an age, never lower it.
    const key = rosterKeys(d, HUMAN_ID).find(k => baseAge(k) <= 30);
    const at = age => ({ ...d, joined: { ...d.joined, [key]: d.year - (age - baseAge(key)) } });
    // 33 now is 34 at the turn: no chance yet; 36 now is 37 then.
    expect(retirementWatch(at(33), HUMAN_ID).map(w => w.key)).not.toContain(key);
    expect(retirementWatch(at(36), HUMAN_ID).find(w => w.key === key)).toEqual({ key, age: 37, chance: retireChance(37) });
    const sci = { ...at(36), staff: { [HUMAN_ID]: { science: 3 } } };
    expect(retirementWatch(sci, HUMAN_ID).find(w => w.key === key)?.chance).toBe(retireChance(35));
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

// THE USER'S IDEAS OF 2026-09-18, built 2026-09-22: a dynasty's own currency,
// earned by the finish, the series and the title, weighted by the rung; spent
// to bring an owned card in. And a deck that is never frozen.
describe('Franchise Points and the deck (2026-09-22)', () => {
  // Every base card is in the league already (the undrafted pool is the free
  // agents), so what a coach brings in is a special-set card.
  const outsider = d => CARD_SETS['super-season'].map(c => cardKey(c))
    .find(k => !leagueKeys(d).includes(k) && !(d.draftPool ?? []).includes(k) && !(d.draftClass?.keys ?? []).includes(k));
  /** The own start's ten with one seat opened: the first man's deal gone, and he leaves the league. */
  const withSeat = d => {
    const drop = rosterKeys(d, HUMAN_ID)[0];
    const { [drop]: gone, ...contracts } = d.contracts;
    void gone;
    return { ...d, contracts, league: leagueKeys(d).filter(k => k !== drop) };
  };

  it('pays the finish (first of N is 10, last 0), the series and the title, weighted by the rung', () => {
    expect(fpFinishPoints(1, 8)).toBe(10);
    expect(fpFinishPoints(8, 8)).toBe(0);
    expect(fpFinishPoints(4, 8)).toBe(6);
    expect(fpFinishPoints(null, 8)).toBe(0);
    const rng = seeded(11);
    let d = ownDynasty({ size: 4 });
    if (d.phase !== DPHASE.season) d = startSeason(d, { rng });
    const fin = finishSeason(d);
    const table = standings(fin.season);
    const e = fpEarned(fin, fin.season, HUMAN_ID, table);
    const rank = table.find(r => r.id === HUMAN_ID).rank;
    const base = fpFinishPoints(rank, 4) + FP_PER_SERIES * e.series + (fin.season.champion === HUMAN_ID ? FP_TITLE : 0);
    expect(e.points).toBe(Math.round(base * payOf(fin.aiLevel)));
    expect(e.why).toContain(`of 4`);
    // Deity pays more for the same year; the easiest rung less.
    expect(fpEarned({ ...fin, aiLevel: 'deity' }, fin.season, HUMAN_ID, table).points).toBe(Math.round(base * payOf('deity')));
    expect(payOf('deity')).toBeGreaterThan(payOf('settler'));
    // The year's close banks it, writes it into the history entry, and says so.
    const closed = endSeason(fin, { rng });
    expect(fpOf(closed, HUMAN_ID)).toBe(e.points);
    expect(closed.history.at(-1).fp[HUMAN_ID]).toBe(e.points);
    expect(closed.news.some(n => n.text.includes('Franchise Points'))).toBe(true);
    // An old save with no points reads as none.
    expect(fpOf({ ...closed, fp: undefined }, HUMAN_ID)).toBe(0);
  });

  it('brings an owned card in for its price, signed at its value for two years, and refuses everything else', () => {
    const d = ownDynasty({ size: 4 });
    const key = outsider(d);
    const card = getCardByKey(key);
    const cost = importCost(card);
    const dp = fairDp(card);
    expect(cost).toBeGreaterThan(0);
    const full = { ...d, phase: DPHASE.resign, fp: { [HUMAN_ID]: cost } };
    expect(importProblem(full, HUMAN_ID, key)).toMatch(/roster is full/);
    expect(() => importCard(full, HUMAN_ID, key)).toThrow(/roster is full/);
    const room = withSeat(full);
    expect(importProblem(room, HUMAN_ID, key)).toBeNull();
    const x = importCard(room, HUMAN_ID, key);
    expect(x.contracts[key]).toMatchObject({ teamId: HUMAN_ID, dp, years: IMPORT_YEARS, how: 'imported' });
    expect(rosterKeys(x, HUMAN_ID)).toContain(key);
    expect(leagueKeys(x)).toContain(key);
    expect(fpOf(x, HUMAN_ID)).toBe(0);
    expect(x.imports).toEqual([{ year: d.year, teamId: HUMAN_ID, key, cost, dp }]);
    expect(x.news[0].text).toContain('bring in');
    // Every refusal, by name.
    expect(importProblem(x, HUMAN_ID, key)).toMatch(/already in this league/);
    expect(importProblem({ ...room, fp: { [HUMAN_ID]: cost - 1 } }, HUMAN_ID, key)).toMatch(/Franchise Points/);
    expect(importProblem({ ...room, phase: DPHASE.season }, HUMAN_ID, key)).toMatch(/offseason/);
    expect(importProblem({ ...room, phase: DPHASE.draft }, HUMAN_ID, key)).toMatch(/offseason/);
    expect(importProblem(room, HUMAN_ID, rosterKeys(room, HUMAN_ID)[0])).toMatch(/already in this league/);
    expect(importProblem(room, HUMAN_ID, key, { owned: false })).toMatch(/do not own/);
    expect(importProblem(room, HUMAN_ID, 'nope:Nobody')).toMatch(/No such card/);
    const ai = room.teams.find(t => !t.human).id;
    expect(importProblem(room, ai, key)).toMatch(/Only a coach/);
    // The cap: nine men at 11 DP leave no room for anyone dearer than a minimum deal.
    const capped = { ...room, contracts: Object.fromEntries(Object.entries(room.contracts).map(([k, c]) => [k, c.teamId === HUMAN_ID ? { ...c, dp: 11 } : c])) };
    if (dp > 1) expect(importProblem(capped, HUMAN_ID, key)).toMatch(/cap/);
    // The candidates: owned, not in the league, best first, each priced and judged.
    const inLeague = rosterKeys(room, HUMAN_ID)[0];
    const cands = importCandidates(room, HUMAN_ID, { [key]: { count: 1 }, [inLeague]: { count: 2 }, 'nope:Nobody': { count: 1 } });
    expect(cands.map(c => c.key)).toEqual([key]);
    expect(cands[0]).toMatchObject({ cost, dp, problem: null });
    expect(importCandidates(room, HUMAN_ID, { [key]: { count: 0 } })).toEqual([]);
  });

  it('changes the deck any time, on the team and on a live season alike', () => {
    const d = ownDynasty({ size: 4 });
    const deck = { high_screen_roll: 4 };
    const x = setTeamDeck(d, HUMAN_ID, deck, 'Screens');
    expect(teamOf(x, HUMAN_ID)).toMatchObject({ deck, deckName: 'Screens' });
    expect(teamOf(x, x.teams.find(t => !t.human).id).deck).toBe(teamOf(d, d.teams.find(t => !t.human).id).deck);
    const live = startSeason(x, { rng: seeded(3) });
    const back = setTeamDeck(live, HUMAN_ID, null, 'ignored');
    expect(teamOf(back, HUMAN_ID)).toMatchObject({ deck: null, deckName: null });
    expect(back.season.teams.find(t => t.id === HUMAN_ID)).toMatchObject({ deck: null, deckName: null });
    const again = setTeamDeck(back, HUMAN_ID, deck, 'Screens');
    expect(again.season.teams.find(t => t.id === HUMAN_ID)).toMatchObject({ deck, deckName: 'Screens' });
    expect(teamOf(again, HUMAN_ID).deckName).toBe('Screens');
  });
});
