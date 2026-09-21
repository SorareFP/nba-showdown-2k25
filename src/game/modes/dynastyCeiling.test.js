// THE AI'S CARD-SALARY CEILING (the user, 2026-09-18).
//
// "AI $5,500×rung ceiling — AI rosters must ALSO fit a card-salary cap
// ($5,500 × the rung's cap, e.g. ×1.12 at Deity) on top of DP, on every AI
// path: draft, re-sign, rookies, FA, trades, claims. You stay on DP only —
// never a worse you."
//
// Every case is BUILT: an AI team's roster is dealt by hand from the cards
// outside the draft, on 1-DP deals so DP never decides, with its card salary
// set against the ceiling — usually so that the same move is refused at
// Prince ($5,500) and allowed at Deity ($6,160), on salary alone.
import { describe, it, expect } from 'vitest';
import {
  createDynasty, HUMAN_ID, MIN_ROSTER, MAX_ROSTER, DPHASE, rosterKeys, leagueKeys, freeAgentKeys,
  aiSalaryCap, aiSalaryOf, salaryFits, signingFits, aiResign, rookieProblem, signRookie, aiDraftChoice,
  nextFaDay, aiRivalOffers, fillRoster, tradeProblems, evaluateTrade, waive, claimProblem, resolveWaivers,
  startSeason, onClock, quote, aiProposals, onWaivers, finishDraft, simDraft, closeSigning,
  endSeason, closeResign, drawLottery, closeRookies, draftPick, passPick, AI_TRADES_PER_OFFSEASON, tradeRelief,
  picksOf, classFor, aiTrades, deadMoney,
} from './dynasty.js';
import { talentValue } from './dynastyMarket.js';
import { nextFaWeek } from './dynastyFriends.js';
import { recordResult, roundFixtures, advance, totalRounds, PHASE } from './season.js';
import { buildAiLeague } from './aiTeams.js';
import { getCardByKey } from '../cardSets.js';
import { CAP } from '../teamRules.js';

const seeded = (s = 808) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
const salary = k => getCardByKey(k).salary;
const sum = keys => keys.reduce((t, k) => t + salary(k), 0);
const noAiTrades = x => ({ ...x, aiDeals: { year: x.year, n: AI_TRADES_PER_OFFSEASON } });

function ownDynasty({ size = 4, seed = 2, aiLevel = null } = {}) {
  const brought = buildAiLeague(1, { rng: seeded(1) })[0].roster;
  return createDynasty({ id: 'ceil', size, length: 'short', startMode: 'own', rng: seeded(seed), human: { name: 'Me', roster: brought }, aiLevel });
}

/** Cards nobody holds and no draft is about to take, cheapest first — what a built roster is dealt from. */
function spare(x) {
  const drafting = new Set([...(x.draft?.pool ?? []), ...(x.draftClass?.keys ?? [])]);
  return x.draftPool.filter(k => getCardByKey(k) && !drafting.has(k)).sort((a, b) => salary(a) - salary(b));
}

/**
 * A team's roster replaced by exactly `keys` (from spare), each on `dp` a
 * season. Its men before are released to free agency — still in the league,
 * so the league stays whole.
 */
function setRoster(x, teamId, keys, { dp = 1, years = 2 } = {}) {
  const contracts = Object.fromEntries(Object.entries(x.contracts).filter(([, c]) => c.teamId !== teamId));
  const joining = keys.filter(k => !leagueKeys(x).includes(k));
  for (const k of keys) contracts[k] = { teamId, dp, years, since: x.year, how: 'fill' };
  const y = { ...x, contracts, league: [...leagueKeys(x), ...joining], draftPool: x.draftPool.filter(k => !joining.includes(k)) };
  expect(rosterKeys(y, teamId).sort()).toEqual([...keys].sort());
  return y;
}

/**
 * The team's picks in the coming drafts handed to `to` (2026-09-19): a
 * re-signing AI team keeps its picks' card salary back (draftReserve), so a
 * case about the man alone builds a team with no picks of its own.
 */
function withoutPicks(x, teamId, to) {
  const pickOwner = { ...(x.pickOwner ?? {}) };
  for (const id of picksOf(x, teamId)) pickOwner[id] = to;
  return { ...x, pickOwner };
}

/** The one deal between two teams that turned `before` into `after`, read off the contracts and pick owners — or null when nothing moved. */
function dealMade(before, after) {
  const moved = Object.keys(before.contracts).filter(k => after.contracts[k] && after.contracts[k].teamId !== before.contracts[k].teamId);
  const owners = { ...(after.pickOwner ?? {}) };
  const picks = Object.keys(owners).filter(id => (before.pickOwner ?? {})[id] !== owners[id]);
  if (!moved.length && !picks.length) return null;
  const from = moved.length ? before.contracts[moved[0]].teamId : picks[0].split('-').slice(2).join('-');
  const to = moved.length ? after.contracts[moved[0]].teamId : owners[picks[0]];
  const originOf = id => id.split('-').slice(2).join('-');
  return {
    from, to,
    give: moved.filter(k => before.contracts[k].teamId === from), get: moved.filter(k => before.contracts[k].teamId === to),
    givePicks: picks.filter(id => ((before.pickOwner ?? {})[id] ?? originOf(id)) === from),
    getPicks: picks.filter(id => ((before.pickOwner ?? {})[id] ?? originOf(id)) === to),
  };
}

/** The `n` cards of `from` whose salaries sit nearest `each`. */
const near = (from, each, n) => [...from].sort((a, b) => Math.abs(salary(a) - each) - Math.abs(salary(b) - each)).slice(0, n);
/** A card of `from` with a salary in [lo, hi], or undefined. */
const within = (from, lo, hi) => from.find(k => salary(k) >= lo && salary(k) <= hi);
const atRung = (x, aiLevel) => ({ ...x, aiLevel });

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
  return { ...d, season: s };
}

/** Run a draft to its end, the human drafting as the AI would for him. */
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

describe('the ceiling itself', () => {
  it('is the Team Builder cap times the rung — $5,500 to Prince, $5,775 King, $6,160 Deity', () => {
    const d = ownDynasty();
    expect(CAP).toBe(5500);
    expect(aiSalaryCap(d)).toBe(5500);
    expect(aiSalaryCap(atRung(d, 'settler'))).toBe(5500);
    expect(aiSalaryCap(atRung(d, 'king'))).toBe(5775);
    expect(aiSalaryCap(atRung(d, 'deity'))).toBe(6160);
  });

  it("sums the card records' salary over the contracted roster, and never binds a coach", () => {
    const d = ownDynasty();
    for (const t of d.teams) expect(aiSalaryOf(d, t.id)).toBe(sum(rosterKeys(d, t.id)));
    const dearest = spare(d).at(-1);
    expect(salaryFits(d, HUMAN_ID, [dearest, ...spare(d).slice(-6)])).toBe(true);
    expect(signingFits(d, HUMAN_ID, dearest)).toBe(true);
  });

  it('an own start drafts every AI team to it, at Prince and at Deity, with ten men', () => {
    for (const aiLevel of [null, 'deity']) {
      const d = ownDynasty({ size: 8, aiLevel });
      for (const t of d.teams.filter(t => !t.human)) {
        expect(aiSalaryOf(d, t.id)).toBeLessThanOrEqual(aiSalaryCap(d));
        expect(rosterKeys(d, t.id)).toHaveLength(MAX_ROSTER);
      }
    }
  });

  it('a fantasy draft signs every AI team under it, and free agency keeps it there', () => {
    const rng = seeded(7);
    let d = createDynasty({ id: 'fan', size: 6, length: 'short', startMode: 'fantasy-full', rng: seeded(3), human: { name: 'Me' } });
    d = finishDraft(driveDraft(d, rng), { rng });
    for (const t of d.teams.filter(t => !t.human)) expect(aiSalaryOf(d, t.id)).toBeLessThanOrEqual(aiSalaryCap(d));
    d = closeSigning(d, { rng });
    for (let g = 0; g < 10 && d.phase === DPHASE.freeAgency; g += 1) d = nextFaDay(d, { rng });
    for (const t of d.teams.filter(t => !t.human)) expect(aiSalaryOf(d, t.id)).toBeLessThanOrEqual(aiSalaryCap(d));
  });
});

describe('every AI path', () => {
  const d0 = ownDynasty({ size: 4 });
  const ai = d0.teams.find(t => !t.human).id;
  const other = d0.teams.filter(t => !t.human)[1].id;

  it('re-signing: the same expiring man walks at Prince and is kept at Deity, on salary alone', () => {
    // Seven men near $520 and a dear expiring star: together past $5,500 and
    // within $6,160. Every deal is 1 DP, so the books never decide.
    const pool = spare(d0);
    const star = pool.at(-1);
    const seven = near(pool.slice(0, -1), (5830 - salary(star)) / 7, 7);
    const total = sum(seven) + salary(star);
    expect(total).toBeGreaterThan(5500);
    expect(total).toBeLessThanOrEqual(6160);
    // Its picks are another team's, so no pick holds room (the next case).
    let x = withoutPicks(setRoster(d0, ai, seven), ai, other);
    x = { ...x, rights: { ...x.rights, [star]: { teamId: ai, kind: 'expiring' } }, league: [...x.league, star], draftPool: x.draftPool.filter(k => k !== star) };
    const prince = aiResign(x, () => 0);
    expect(prince.contracts[star]).toBeUndefined();
    expect(freeAgentKeys(prince)).toContain(star);
    expect(aiSalaryOf(prince, ai)).toBeLessThanOrEqual(5500);
    const deity = aiResign(atRung(x, 'deity'), () => 0);
    expect(deity.contracts[star]).toMatchObject({ teamId: ai, how: 'resign' });
  });

  it("re-signing keeps its coming picks' card salary back, as it keeps their scale (2026-09-19)", () => {
    // The same eight at Deity, the room left under $6,160 less than the
    // cheapest card in the coming class: holding its own picks, the team
    // lets the star walk rather than pass a pick for salary; its picks
    // traded away, it keeps him.
    const pool = spare(d0);
    const cls = classFor(d0).filter(k => getCardByKey(k));
    const cheapestPick = Math.min(...cls.map(salary));
    const seven = near(pool, 5300 / 7, 7);
    const star = within(pool.filter(k => !seven.includes(k)), 6161 - cheapestPick - sum(seven), 6160 - sum(seven));
    expect(star).toBeDefined();
    expect(6160 - sum(seven) - salary(star)).toBeLessThan(cheapestPick);
    let x = atRung(setRoster(d0, ai, seven), 'deity');
    x = { ...x, rights: { ...x.rights, [star]: { teamId: ai, kind: 'expiring' } }, league: [...x.league, star], draftPool: x.draftPool.filter(k => k !== star) };
    expect(picksOf(x, ai).length).toBeGreaterThan(0);
    expect(aiResign(x, () => 0).contracts[star]).toBeUndefined();
    expect(aiResign(withoutPicks(x, ai, other), () => 0).contracts[star]).toMatchObject({ teamId: ai, how: 'resign' });
  });

  it('the rookie draft: at the ceiling it takes the pick it can pay for, and passes when none fits', () => {
    // Nine men with $300 of room, on the clock at pick 1 with a dear and a cheap man on the board.
    const pool = spare(d0);
    const dear = pool.at(-1);
    const cheap = pool[0];
    const nine = near(pool.filter(k => k !== dear && k !== cheap), 5200 / 9, 9);
    const x0 = setRoster(d0, ai, nine);
    const room = 5500 - aiSalaryOf(x0, ai);
    expect(salary(cheap)).toBeLessThanOrEqual(room);
    expect(salary(dear)).toBeGreaterThan(room);
    const onTheClock = board => ({
      ...x0, phase: DPHASE.rookieDraft,
      draftPool: x0.draftPool.filter(k => !board.includes(k)),
      draft: { kind: 'rookie', order: [ai, ...x0.teams.map(t => t.id).filter(id => id !== ai)], picks: [], pool: board },
    });
    expect(onClock(onTheClock([dear, cheap]))).toMatchObject({ n: 1, teamId: ai });
    expect(aiDraftChoice(onTheClock([dear, cheap]), ai, () => 0)).toBe(cheap);
    expect(aiDraftChoice(onTheClock([dear]), ai, () => 0)).toBeNull();
    // At Deity the room is $660 more: a man past Prince's room and within
    // Deity's is refused at Prince and taken at Deity, on salary alone.
    const between = within(pool.filter(k => !nine.includes(k) && k !== cheap), room + 1, room + 660);
    expect(between).toBeDefined();
    expect(aiDraftChoice(onTheClock([between]), ai, () => 0)).toBeNull();
    expect(aiDraftChoice(atRung(onTheClock([between]), 'deity'), ai, () => 0)).toBe(between);
  });

  it('a team short of eight keeps a cheap card\'s room for each seat it still has to fill — picks, trades and claims (2026-09-19)', () => {
    // Six men, and a card that fits the room under $5,500 but not with $150
    // kept for the eighth seat: a verifier's step trace had exactly this
    // take a 6-man team to the ceiling and the fill sign past it.
    const pool = spare(d0);
    const six = near(pool.slice(20), 5000 / 6, 6);
    const room = 5500 - sum(six);
    const man = within(pool.filter(k => !six.includes(k)), room - 149, room);
    const cheap = within(pool.filter(k => !six.includes(k)), 30, room - 150);
    expect(man).toBeDefined();
    expect(cheap).toBeDefined();
    const x = setRoster(d0, ai, six);
    // Signing a pick: he would be the seventh, with less than $150 for the eighth.
    const holding = key => ({
      ...x, phase: DPHASE.rookies,
      rights: { ...x.rights, [key]: { teamId: ai, kind: 'rookie', pick: 3 } },
      league: [...x.league, key], draftPool: x.draftPool.filter(k => k !== key),
    });
    expect(rookieProblem(holding(man), ai, man)).toMatch(/salary ceiling/);
    expect(rookieProblem(holding(cheap), ai, cheap)).toBeNull();
    expect(rookieProblem(atRung(holding(man), 'deity'), ai, man)).toBeNull();
    // Drafting him: the draft holds the same room, so it takes the cheaper man.
    const board = [man, cheap];
    const clock = {
      ...x, phase: DPHASE.rookieDraft,
      draftPool: x.draftPool.filter(k => !board.includes(k)),
      draft: { kind: 'rookie', order: [ai, ...x.teams.map(t => t.id).filter(id => id !== ai)], picks: [], pool: board },
    };
    expect(aiDraftChoice({ ...clock, draft: { ...clock.draft, pool: [man] } }, ai, () => 0)).toBeNull();
    expect(aiDraftChoice(clock, ai, () => 0)).toBe(cheap);
    // Taking him in a trade — your man for nothing: refused, and the reason says so.
    const mine = setRoster(x, HUMAN_ID, [...rosterKeys(x, HUMAN_ID).slice(2), man, cheap]);
    const gift = key => ({ from: HUMAN_ID, to: ai, give: [key], get: [] });
    expect(tradeProblems(noAiTrades(mine), gift(man)).join(' ')).toMatch(/need \$150 more for their picks and empty seats — past the AI's \$5500 ceiling/);
    expect(tradeProblems(noAiTrades(mine), gift(cheap)).filter(p => /card salary/.test(p))).toEqual([]);
    expect(tradeProblems(atRung(noAiTrades(mine), 'deity'), gift(man)).filter(p => /card salary/.test(p))).toEqual([]);
    // Claiming him off waivers.
    const waived = waive(mine, HUMAN_ID, man);
    expect(claimProblem(waived, ai, man)).toMatch(/salary ceiling/);
    expect(claimProblem(atRung(waived, 'deity'), ai, man)).toBeNull();
  });

  it('a LEVEL two-for-one that leaves an AI team one short of eight at its ceiling is refused (2026-09-19)', () => {
    // The re-measure's last two tip-offs over the ceiling: New York, eight
    // men at $5,490, sent two for one at the same salary in closeFreeAgency's
    // trades, and the fill signed its eighth past $5,500.
    const pool = spare(d0);
    const eight = near(pool.slice(20), 5460 / 8, 8);
    const rest = pool.filter(k => !eight.includes(k));
    let pair = null;
    for (const a of eight) {
      for (const b of eight) {
        if (a >= b) continue;
        const two = salary(a) + salary(b);
        const one = rest.find(k => salary(k) > two - 130 && salary(k) <= two && sum(eight) - two + salary(k) > 5350);
        if (one) { pair = { a, b, one }; break; }
      }
      if (pair) break;
    }
    expect(pair).not.toBeNull();
    let x = setRoster(d0, ai, eight);
    x = noAiTrades(setRoster(x, HUMAN_ID, [...rosterKeys(x, HUMAN_ID).slice(1), pair.one]));
    const after = sum(eight) - salary(pair.a) - salary(pair.b) + salary(pair.one);
    expect(after).toBeLessThanOrEqual(5500);
    expect(after).toBeLessThanOrEqual(sum(eight));
    const deal = { from: HUMAN_ID, to: ai, give: [pair.one], get: [pair.a, pair.b] };
    expect(tradeProblems(x, deal).join(' ')).toMatch(/need \$150 more for their picks and empty seats/);
    // A one-for-one that keeps its eight and takes no salary on is its to make.
    const cheapest = rest.find(k => k !== pair.one);
    expect(salary(cheapest)).toBeLessThanOrEqual(salary(pair.a));
    const y = noAiTrades(setRoster(x, HUMAN_ID, [...rosterKeys(x, HUMAN_ID).slice(1), cheapest]));
    expect(tradeProblems(y, { from: HUMAN_ID, to: ai, give: [cheapest], get: [pair.a] }).filter(p => /card salary/.test(p))).toEqual([]);
  });

  it('the fantasy draft: with little room left the AI takes the cheaper card, and a draftee it cannot sign walks', () => {
    const f0 = createDynasty({ id: 'fan-ceil', size: 4, length: 'short', startMode: 'fantasy-full', rng: seeded(3), human: { name: 'Me' } });
    const fa = f0.teams.find(t => !t.human).id;
    // Dealt from the whole fantasy board as well as the pool: the draft
    // object is replaced below, so no card is in two places.
    const pool = [...new Set([...spare(f0), ...f0.draft.pool])].filter(k => getCardByKey(k)).sort((a, b) => salary(a) - salary(b));
    const group = k => ({ PG: 'G', SG: 'G', SF: 'F', PF: 'F', C: 'C' })[getCardByKey(k).pos] ?? 'F';
    // Nine men; one pick left (the last of its draft), $X of room.
    const nine = near(pool.slice(30), 5200 / 9, 9);
    const room = 5500 - sum(nine);
    const rest = pool.filter(k => !nine.includes(k));
    // A dear card past the room (and within Deity's), a cheap one of his
    // position under it and weaker — so at Deity nothing but salary decides.
    const dear = within(rest, room + 1, room + 660);
    expect(dear).toBeDefined();
    const cheap = rest.find(k => group(k) === group(dear) && salary(k) <= room && talentValue(getCardByKey(k)) < talentValue(getCardByKey(dear)));
    expect(cheap).toBeDefined();
    const x = setRoster(f0, fa, nine);
    const last = board => ({ ...x, draftPool: x.draftPool.filter(k => !board.includes(k)), draft: { kind: 'fantasy', order: [fa], picks: [], pool: board } });
    expect(onClock(last([dear, cheap]))).toMatchObject({ n: 1, teamId: fa });
    expect(aiDraftChoice(last([dear, cheap]), fa, () => 0)).toBe(cheap);
    expect(aiDraftChoice(atRung(last([dear, cheap]), 'deity'), fa, () => 0)).toBe(dear);
    // Nothing fits: the pick still has to be made — the cheapest card.
    expect(aiDraftChoice(last([dear]), fa, () => 0)).toBe(dear);
    // ...and at finishDraft a draftee past the ceiling walks, on six men so
    // the roster has seats and the books room: at Deity the same man signs.
    const six = nine.slice(0, 6);
    const tight = within(rest, 5501 - sum(six), 6160 - sum(six));
    expect(tight).toBeDefined();
    const y = setRoster(f0, fa, six);
    const drafted = {
      ...y, draftPool: y.draftPool.filter(k => k !== tight), league: [...y.league, tight],
      rights: { ...y.rights, [tight]: { teamId: fa, kind: 'draft', pick: 1 } },
      draft: { kind: 'fantasy', order: [fa], picks: [{ n: 1, round: 1, teamId: fa, key: tight }], pool: [tight] },
    };
    const walked = finishDraft(drafted, { rng: seeded(2) });
    expect(walked.contracts[tight]).toBeUndefined();
    expect(freeAgentKeys(walked)).toContain(tight);
    expect(aiSalaryOf(walked, fa)).toBe(sum(six));
    expect(finishDraft(atRung(drafted, 'deity'), { rng: seeded(2) }).contracts[tight]).toMatchObject({ teamId: fa, how: 'draft' });
  });

  it("the deadline shed: a full ten at the ceiling keeps its man when shedding him would not make the pick's card fit", () => {
    const pool = spare(d0);
    const ten = near(pool.slice(20), 5300 / 10, 10);
    const t = k => talentValue(getCardByKey(k));
    const weakest = ten.reduce((w, k) => (t(k) < t(w) ? k : w));
    // Shedding the weakest frees his card's salary: a pick past that room,
    // and better than him — the shed rule's own test passes, the ceiling's does not.
    const freed = 5500 - sum(ten) + salary(weakest);
    const pick = pool.filter(k => !ten.includes(k)).find(k => salary(k) > freed && salary(k) <= freed + 660 && t(k) > t(weakest));
    expect(pick).toBeDefined();
    const x = noAiTrades({
      ...setRoster(d0, ai, ten), phase: DPHASE.preseason,
      rights: { ...d0.rights, [pick]: { teamId: ai, kind: 'rookie', pick: 2 } },
    });
    const y = { ...x, league: [...x.league, pick], draftPool: x.draftPool.filter(k => k !== pick) };
    const dead = deadMoney(y, ai);
    const prince = startSeason(fillRoster(y, HUMAN_ID), { rng: seeded(8) });
    expect(rosterKeys(prince, ai).sort()).toEqual([...ten].sort());
    expect(deadMoney(prince, ai)).toBe(dead);
    expect(prince.contracts[pick]?.teamId).not.toBe(ai);
    // At Deity the $660 more is room enough: it sheds him and signs the pick.
    const deity = startSeason(fillRoster(atRung(y, 'deity'), HUMAN_ID), { rng: seeded(8) });
    expect(deity.contracts[pick]).toMatchObject({ teamId: ai, how: 'rookie' });
    expect(rosterKeys(deity, ai)).not.toContain(weakest);
  });

  it("the AI's own trades: the deal it makes at Deity, which takes a team past $5,500, is refused at Prince on salary alone", () => {
    // BUILT (2026-09-21). It was PINNED to a seeded league a probe had found
    // (2026-09-19: Sacramento's pick-for-a-man at the re-sign window), and
    // the pool moved — on the user's live free agents (5 cards at HEAD, 15
    // now) the search made no deal there and the test read a pick off an
    // empty list. Now the three AI teams are dealt by hand at the
    // preseason: two "wing" teams of five guards and five forwards near
    // $545, about $5,450 — and a third of the five cheapest centres dearer
    // than what a wing team has left under $5,500 once its DEAREST man is
    // out, plus five forwards near $400, with no guard at all. Positional
    // need (needFactor: short at a position, up to 30% more; long, down to
    // 15% less) makes any wing man for any centre a win for both sides, and
    // because every centre costs more than the room any wing man leaves,
    // ANY such swap takes a wing team past $5,500: within Deity's $6,160,
    // past Prince's ceiling and nothing else. The shape is flat on purpose:
    // an earlier build gave the wing team one cheap guard and priced the
    // centres off HIM, and the search swapped a dearer wing man of the same
    // talent as a centre instead, under $5,500 — and a centre far dearer
    // than the man it takes back carries more talent and 1-DP surplus than
    // the centre team will give up for him (a $350 guard against $420
    // centres came up "close", 40.3 against the 41.0 its edge asks). The
    // guards below pin that geometry, so a pool change shows up as a
    // built-case failure, not a search that found something else.
    const dd = ownDynasty({ size: 4, aiLevel: 'deity' });
    const [a, b, c] = dd.teams.filter(t => !t.human).map(t => t.id);
    const group = k => ({ PG: 'G', SG: 'G', SF: 'F', PF: 'F', C: 'C' })[getCardByKey(k).pos] ?? 'F';
    const used = new Set();
    const take = (pred, each, n) => {
      const out = near(spare(dd).filter(k => !used.has(k) && pred(k)), each, n);
      out.forEach(k => used.add(k));
      return out;
    };
    const wings = () => [...take(k => group(k) === 'G', 545, 5), ...take(k => group(k) === 'F', 545, 5)];
    const A = wings();
    const C = wings();
    // A wing team's salary without its dearest man: any centre dearer than
    // what is left under $5,500 takes it past, whoever goes — the five cheapest such.
    const without = wing => sum(wing) - Math.max(...wing.map(salary));
    const crossing = 5500 - Math.min(without(A), without(C));
    const B = [...take(k => group(k) === 'C' && salary(k) > crossing, crossing + 1, 5), ...take(k => group(k) === 'F', 400, 5)];
    const x = setRoster(setRoster(setRoster(dd, a, A), b, B), c, C);
    const centres = B.filter(k => group(k) === 'C');
    expect(centres).toHaveLength(5);
    for (const wing of [A, C]) {
      expect(wing.every(k => group(k) !== 'C')).toBe(true);
      expect(sum(wing)).toBeLessThanOrEqual(5500);
      expect(without(wing) + Math.min(...centres.map(salary))).toBeGreaterThan(5500);
      expect(without(wing) + Math.max(...centres.map(salary))).toBeLessThanOrEqual(6160);
    }
    // A crossing deal is there to be found: a wing man of the first team
    // for one of the centres, taken by both sides on their own valuations.
    const bothTake = A.some(w => centres.some(k =>
      evaluateTrade(x, { from: a, to: b, give: [w], get: [k] }).verdict === 'accept'
      && evaluateTrade(x, { from: b, to: a, give: [k], get: [w] }).verdict === 'accept'));
    expect(bothTake).toBe(true);
    const traded = aiTrades(x, { max: 1 });
    const deal = dealMade(x, traded);
    expect(deal).not.toBeNull();
    const up = [deal.from, deal.to].find(id => aiSalaryOf(traded, id) > 5500 && aiSalaryOf(traded, id) > aiSalaryOf(x, id));
    expect(up).toBeDefined();
    expect(aiSalaryOf(traded, up)).toBeLessThanOrEqual(6160);
    expect(tradeProblems(x, deal)).toEqual([]);
    // At Prince the only thing wrong with it is the ceiling...
    const prince = atRung(x, null);
    const problems = tradeProblems(prince, deal);
    expect(problems.length).toBeGreaterThan(0);
    for (const p of problems) expect(p).toMatch(/card salary/);
    // ...and the AI's search does not make it; whatever it makes instead keeps every AI team within its ceiling.
    const after = aiTrades(prince);
    for (const key of [...deal.give, ...deal.get]) expect(after.contracts[key]?.teamId).toBe(prince.contracts[key].teamId);
    for (const id of [...deal.givePicks, ...deal.getPicks]) expect(after.pickOwner?.[id]).toBe(prince.pickOwner?.[id]);
    for (const team of x.teams.filter(tm => !tm.human)) {
      expect(aiSalaryOf(after, team.id)).toBeLessThanOrEqual(Math.max(5500, aiSalaryOf(prince, team.id)));
    }
  });

  it('signing picks: refused past the ceiling for an AI team, never for a coach', () => {
    const pool = spare(d0);
    const nine = near(pool, 5300 / 9, 9);
    const pick = within(pool.filter(k => !nine.includes(k)), 5501 - sum(nine), 6160 - sum(nine));
    expect(pick).toBeDefined();
    const x = setRoster(d0, ai, nine);
    const withPick = (y, team) => ({
      ...y, phase: DPHASE.rookies,
      rights: { ...y.rights, [pick]: { teamId: team, kind: 'rookie', pick: 3 } },
      league: [...y.league, pick], draftPool: y.draftPool.filter(k => k !== pick),
    });
    expect(rookieProblem(withPick(x, ai), ai, pick)).toMatch(/salary ceiling/);
    expect(rookieProblem(atRung(withPick(x, ai), 'deity'), ai, pick)).toBeNull();
    // A coach with the same nine — and far past $5,500 besides — signs him.
    const rich = setRoster(x, HUMAN_ID, pool.slice(-10).filter(k => k !== pick).slice(0, 9));
    expect(aiSalaryOf(rich, HUMAN_ID)).toBeGreaterThan(5500);
    const mine = withPick(rich, HUMAN_ID);
    expect(rookieProblem(mine, HUMAN_ID, pick)).toBeNull();
    expect(signRookie(mine, HUMAN_ID, pick).contracts[pick]).toMatchObject({ teamId: HUMAN_ID, how: 'rookie' });
  });

  it("free agency: a standing bid that would take it past the ceiling does not sign, and it makes no such bid", () => {
    const pool = spare(d0);
    const eight = near(pool, 5300 / 8, 8);
    const target = within(pool.filter(k => !eight.includes(k)), 5501 - sum(eight), 6160 - sum(eight));
    expect(target).toBeDefined();
    // The target is a free agent: in the league, held by nobody.
    let x = setRoster(d0, ai, eight);
    x = { ...x, league: [...x.league, target], draftPool: x.draftPool.filter(k => k !== target) };
    expect(freeAgentKeys(x)).toContain(target);
    const fa = y => noAiTrades({ ...y, phase: DPHASE.freeAgency, fa: { day: 1, rivals: { [target]: { teamId: ai, dp: 1, years: 1, ratio: 5 } } } });
    const prince = nextFaDay(fa(x), { rng: seeded(4) });
    expect(prince.contracts[target]?.teamId).not.toBe(ai);
    expect(aiSalaryOf(prince, ai)).toBeLessThanOrEqual(5500);
    const deity = nextFaDay(fa(atRung(x, 'deity')), { rng: seeded(4) });
    expect(deity.contracts[target]).toMatchObject({ teamId: ai, how: 'fa' });
    // Its own bids today: every card on them fits its room, all of them together.
    const bids = Object.entries(aiRivalOffers({ ...x, phase: DPHASE.freeAgency, fa: { day: 1, rivals: {} } }, seeded(5)))
      .filter(([, r]) => r.teamId === ai).map(([k]) => k);
    expect(sum(bids)).toBeLessThanOrEqual(5500 - sum(eight));
    expect(bids).not.toContain(target);
  });

  it('with friends, a sealed week signs an AI bid only within its ceiling, and a coach past $5,500 all the same', () => {
    const pool = spare(d0);
    const eight = near(pool, 5300 / 8, 8);
    const [target, dear] = [within(pool.filter(k => !eight.includes(k)), 5501 - sum(eight), 6160 - sum(eight)), pool.at(-1)];
    let x = setRoster(d0, ai, eight);
    x = setRoster(x, HUMAN_ID, pool.slice(-10, -1).filter(k => k !== target));
    x = { ...x, league: [...x.league, target, dear], draftPool: x.draftPool.filter(k => k !== target && k !== dear) };
    expect(aiSalaryOf(x, HUMAN_ID)).toBeGreaterThan(5500);
    x = noAiTrades({ ...x, phase: DPHASE.freeAgency, fa: { day: 1, rivals: { [target]: { teamId: ai, dp: 1, years: 1, ratio: 5 } } } });
    const bid = { teamId: HUMAN_ID, key: dear, dp: quote(x, HUMAN_ID, dear).ask, years: quote(x, HUMAN_ID, dear).years };
    const y = nextFaWeek(x, [bid], { rng: seeded(6) });
    expect(y.contracts[target]?.teamId).not.toBe(ai);
    expect(y.contracts[dear]).toMatchObject({ teamId: HUMAN_ID, how: 'fa' });
  });

  it('the fill: the cheapest deal whose card fits — and, when none can, the cheapest card there is (the floor beats the ceiling)', () => {
    const pool = spare(d0);
    // Seven men $200 under the ceiling: the eighth seat is filled under it.
    const seven = near(pool.slice(20), 5300 / 7, 7);
    const roomy = setRoster(d0, ai, seven);
    const filled = fillRoster(roomy, ai);
    expect(rosterKeys(filled, ai)).toHaveLength(MIN_ROSTER);
    expect(aiSalaryOf(filled, ai)).toBeLessThanOrEqual(5500);
    // Seven men at the ceiling to within $20 — less than the cheapest card —
    // still take the floor, on the cheapest card in free agency or camp.
    const six = near(pool.slice(20), 4800 / 6, 6);
    const seventh = within(pool.slice(20).filter(k => !six.includes(k)), 5481 - sum(six), 5500 - sum(six));
    expect(seventh).toBeDefined();
    const topped = [...six, seventh];
    expect(sum(topped)).toBeGreaterThan(5480);
    expect(sum(topped)).toBeLessThanOrEqual(5500);
    const stuck = setRoster(d0, ai, topped);
    const cheapest = Math.min(...[...freeAgentKeys(stuck), ...spare(stuck)].map(salary));
    expect(cheapest).toBeGreaterThan(5500 - sum(topped));
    const floor = fillRoster(stuck, ai);
    expect(rosterKeys(floor, ai)).toHaveLength(MIN_ROSTER);
    expect(aiSalaryOf(floor, ai) - sum(topped)).toBe(cheapest);
  });

  it('trades: an AI side may not end past its ceiling — a coach may, and an AI team already past it only comes down', () => {
    const pool = spare(d0);
    const nine = near(pool, 5300 / 9, 9);
    const mine = pool.slice(-10);
    let x = setRoster(setRoster(d0, ai, nine.filter(k => !mine.includes(k))), HUMAN_ID, mine.filter(k => !nine.includes(k)));
    x = noAiTrades(x);
    const [myStar] = [...rosterKeys(x, HUMAN_ID)].sort((a, b) => salary(b) - salary(a));
    const theirCheap = [...rosterKeys(x, ai)].sort((a, b) => salary(a) - salary(b))[0];
    // Your star for their cheapest: their card salary would pass $5,500.
    const up = { from: HUMAN_ID, to: ai, give: [myStar], get: [theirCheap] };
    expect(aiSalaryOf(x, ai) + salary(myStar) - salary(theirCheap)).toBeGreaterThan(5500);
    expect(tradeProblems(x, up).join(' ')).toMatch(/card salary — past the AI's \$5500 ceiling/);
    expect(evaluateTrade(x, up).verdict).toBe('illegal');
    // The other way round your side takes salary on, far past $5,500, and that is yours to do.
    expect(aiSalaryOf(x, HUMAN_ID)).toBeGreaterThan(5500);
    const down = { from: HUMAN_ID, to: ai, give: [], get: [[...rosterKeys(x, ai)].sort((a, b) => salary(b) - salary(a))[0]] };
    expect(tradeProblems(x, down).filter(p => /card salary/.test(p))).toEqual([]);
    // An AI team over its ceiling (an older save): down is legal, up is not, even staying over.
    const over = setRoster(x, other, pool.slice(-20, -10));
    expect(aiSalaryOf(over, other)).toBeGreaterThan(5500);
    const theirs = [...rosterKeys(over, other)].sort((a, b) => salary(b) - salary(a));
    // Their dearest for nothing (your side waives its weakest to make room): they come down.
    const shed = { from: HUMAN_ID, to: other, give: [], get: [theirs[0]] };
    expect(tradeProblems(over, shed).filter(p => /card salary/.test(p))).toEqual([]);
    const add = { from: HUMAN_ID, to: other, give: [myStar], get: [theirs.at(-1)] };
    expect(salary(myStar)).toBeGreaterThan(salary(theirs.at(-1)));
    expect(tradeProblems(over, add).join(' ')).toMatch(/card salary/);
  });

  it("the AI's own offers never take an AI side past its ceiling", () => {
    const d = ownDynasty({ size: 6, seed: 5 });
    for (const offer of aiProposals(d)) {
      // The AI team sends `give`, takes `get`, and waives its relief man, if any.
      const cut = tradeRelief(d, offer)[offer.from] ?? [];
      const after = aiSalaryOf(d, offer.from) - sum(offer.give) - sum(cut) + sum(offer.get);
      expect(after).toBeLessThanOrEqual(Math.max(aiSalaryCap(d), aiSalaryOf(d, offer.from)));
    }
  });

  it('waiver claims: an AI team at its ceiling passes on a card it cannot pay for', () => {
    const pool = spare(d0);
    const nine = near(pool, 5300 / 9, 9);
    const man = within(pool.filter(k => !nine.includes(k)), 5501 - sum(nine), 6160 - sum(nine));
    expect(man).toBeDefined();
    let x = setRoster(d0, ai, nine);
    // The coach's man, on a bargain 1-DP deal, waived.
    const mine = rosterKeys(x, HUMAN_ID)[0];
    x = setRoster(x, HUMAN_ID, [...rosterKeys(x, HUMAN_ID).filter(k => k !== mine), man]);
    x = waive(x, HUMAN_ID, man);
    expect(onWaivers(x, man)).toBe(true);
    expect(claimProblem(x, ai, man)).toMatch(/salary ceiling/);
    expect(claimProblem(atRung(x, 'deity'), ai, man)).toBeNull();
    const y = resolveWaivers(x);
    expect(y.contracts[man]?.teamId).not.toBe(ai);
  });

  it('an older save over the ceiling adds nothing — and nobody is cut', () => {
    // An AI team dealt $10,000+ of cards (a league from before 2026-09-18),
    // holding a pick, with a bid standing on a free agent: through the rest
    // of free agency and the tip-off it keeps every man and adds no salary.
    const pool = spare(d0);
    const dear = pool.slice(-9);
    const pick = within(pool, 200, 400);
    const fa = within(pool.filter(k => k !== pick), 100, 199);
    let x = setRoster(d0, ai, dear);
    const before = aiSalaryOf(x, ai);
    expect(before).toBeGreaterThan(5500);
    x = {
      ...x, phase: DPHASE.freeAgency,
      rights: { ...x.rights, [pick]: { teamId: ai, kind: 'rookie', pick: 2 } },
      league: [...x.league, pick, fa], draftPool: x.draftPool.filter(k => k !== pick && k !== fa),
      fa: { day: 1, rivals: { [fa]: { teamId: ai, dp: 1, years: 1, ratio: 5 } } },
    };
    let y = noAiTrades(x);
    for (let g = 0; g < 10 && y.phase === DPHASE.freeAgency; g += 1) y = noAiTrades(nextFaDay(y, { rng: seeded(8) }));
    expect(y.phase).toBe(DPHASE.preseason);
    y = startSeason(fillRoster(y, HUMAN_ID), { rng: seeded(8) });
    expect(rosterKeys(y, ai).sort()).toEqual([...dear].sort());
    expect(aiSalaryOf(y, ai)).toBe(before);
  });
});

describe('a seeded league, year after year', () => {
  it('tips off with every AI team within its ceiling, two years running, at Prince and Deity', () => {
    for (const aiLevel of [null, 'deity']) {
      const rng = seeded(21);
      let d = createDynasty({ id: `yr-${aiLevel}`, size: 6, length: 'short', startMode: 'fantasy-full', rng: seeded(9), human: { name: 'Me' }, aiLevel });
      d = closeSigning(finishDraft(driveDraft(d, rng), { rng }), { rng });
      for (let g = 0; g < 10 && d.phase === DPHASE.freeAgency; g += 1) d = nextFaDay(d, { rng });
      d = startSeason(fillRoster(d, HUMAN_ID), { rng });
      const check = x => {
        for (const t of x.teams.filter(t => !t.human)) expect(aiSalaryOf(x, t.id), `${aiLevel} ${t.id} year ${x.year}`).toBeLessThanOrEqual(aiSalaryCap(x));
      };
      check(d);
      d = endSeason(finishSeason(d), { rng });
      d = closeResign(d, { rng });
      d = drawLottery(d, { rng });
      if (d.phase === DPHASE.rookieDraft) d = finishDraft(driveDraft(d, rng), { rng });
      if (d.phase === DPHASE.rookies) d = closeRookies(d, { rng });
      for (let g = 0; g < 10 && d.phase === DPHASE.freeAgency; g += 1) d = nextFaDay(d, { rng });
      d = startSeason(fillRoster(d, HUMAN_ID), { rng });
      expect(d.year).toBe(2);
      check(d);
    }
  });
});
