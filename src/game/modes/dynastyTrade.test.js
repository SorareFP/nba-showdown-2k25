// DYNASTY TRADES (2026-09-11): the value model — Simmons' logic, not his
// order; no aging curve, since nobody gets better or worse — the AI's answer,
// the rules of a deal, picks, the sweetener, and the AI trading among itself.
import { describe, it, expect } from 'vitest';
import {
  createDynasty, HUMAN_ID, MAX_ROSTER, rosterKeys, payroll, startSeason, contractsOf,
  tradeValue, tradeProblems, evaluateTrade, makeTrade, suggestSweetener, aiTrades,
  picksOf, pickValue, parsePick, pickOwner, projectedSlot, teamDirection, nextDraftYear, ageOf, baseAge,
  tradeDeadlineRound, aiApronDp, classFor, classSize,
  tradeRelief, TRADE_RELIEF, onWaivers, deadMoney, seasonTurn, waive, AI_TRADES_PER_OFFSEASON,
  aiProposals, aiOfferTurn, answerOffer, offerValue, OFFER_FAIRNESS, AI_OFFERS_PER_TURN, DPHASE,
  offerProblems, trimOffers, OFFERS_KEPT, aiSalaryCap, aiSalaryOf,
} from './dynasty.js';
import { advancePhase, respondTrade } from './dynastyFriends.js';
import { cardKey, getCardByKey } from '../cardSets.js';
import { CARDS } from '../cards.js';
import { talentValue, contractValue, controlFactor, rookieScale, fairDp, MAX_DP } from './dynastyMarket.js';
import { buildAiLeague } from './aiTeams.js';

const seeded = (s = 808) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
const card = salary => ({ id: `c${salary}`, salary, pos: 'SF' });

/** An own-team dynasty in its preseason — between seasons, the AI drafted around your ten. */
function preseason({ size = 6, aging = false, seed = 2 } = {}) {
  const roster = buildAiLeague(1, { rng: seeded(1) })[0].roster;
  return createDynasty({ id: 'T', size, length: 'online', startMode: 'own', aging, rng: seeded(seed), human: { name: 'Me', roster } });
}

const talentOf = k => talentValue(getCardByKey(k));
const byTalent = keys => [...keys].sort((a, b) => talentOf(b) - talentOf(a));

/**
 * A TRADE CASE BUILT, NOT FOUND (2026-09-18). These tests used to search
 * every one-for-one between your ten and an AI team's for a pair that
 * happened to be an overpay, a fleecing or a near miss — and which pairs
 * exist is the card pool's doing: the user's Card Studio adds free agents to
 * the pool (cards-free-agents.json), every seeded draft after that deals
 * different rosters, and the overpay search came back empty with the verdict
 * logic untouched. So the books are set by hand. On both teams every
 * contract is 2 DP a season except:
 *   `star`  — the team's best card, on a 1-DP deal for four years (the
 *             column's cheap long deal: the most valuable thing in a trade);
 *   `scrub` — its weakest card, on the 35-DP max for three (the albatross);
 *   `mid`   — the one worth nearest 10 DP of the rest, at exactly his
 *             worth for two years.
 * Payrolls land well under the cap, so no deal below trips the cap, the
 * apron or salary matching, and a verdict is the value model's alone. The AI
 * team is one short of ten, so a two-for-one can reach it.
 */
function tradeCase(d = preseason()) {
  const ai = d.teams.find(t => !t.human).id;
  const salaryOf = k => getCardByKey(k).salary;
  // `room`: the most card salary the star may carry (below).
  const set = (contracts, teamId, room = Infinity) => {
    const keys = byTalent(rosterKeys(d, teamId));
    const star = keys.find(k => salaryOf(k) <= room) ?? keys[0];
    const scrub = keys.at(-1);
    const rest = keys.filter(k => k !== star && k !== scrub);
    const mid = rest.reduce((m, k) => (Math.abs(fairDp(getCardByKey(k)) - 10) < Math.abs(fairDp(getCardByKey(m)) - 10) ? k : m));
    for (const k of keys) contracts[k] = { ...contracts[k], dp: 2, years: 2 };
    contracts[star] = { ...contracts[star], dp: 1, years: 4 };
    contracts[mid] = { ...contracts[mid], dp: fairDp(getCardByKey(mid)), years: 2 };
    contracts[scrub] = { ...contracts[scrub], dp: MAX_DP, years: 3 };
    // Their spare is their dearest (it leaves, and makes the room below);
    // yours is your cheapest — a bench player to throw in.
    const others = rest.filter(k => k !== mid);
    return { star, mid, scrub, spare: teamId === ai ? others[0] : others.at(-1) };
  };
  const contracts = { ...d.contracts };
  const them = set(contracts, ai);
  delete contracts[them.spare];
  // THE AI'S CARD-SALARY CEILING (2026-09-18): the AI team arrives at it, so
  // your star is your best card the AI can take for its scrub and stay under
  // it — the overpay is judged on value, never refused for salary.
  const room = aiSalaryCap(d) - aiSalaryOf({ ...d, contracts }, ai) + salaryOf(them.scrub);
  const me = set(contracts, HUMAN_ID, room);
  const x = { ...d, contracts };
  // The case is what it says: the scrubs really are overpaid, the stars underpaid.
  for (const side of [me, them]) {
    expect(contractValue(getCardByKey(side.scrub), x.contracts[side.scrub])).toBeLessThan(0);
    expect(contractValue(getCardByKey(side.star), x.contracts[side.star])).toBeGreaterThan(0);
  }
  expect(rosterKeys(x, ai)).toHaveLength(rosterKeys(d, ai).length - 1);
  return {
    d: x, ai, me, them,
    overpay: { from: HUMAN_ID, to: ai, give: [me.star], get: [them.scrub] },
    fleece: { from: HUMAN_ID, to: ai, give: [me.scrub], get: [them.star] },
  };
}

/**
 * The next draft's class, set by hand (2026-09-18): the best card of each
 * DP value in the draft pool, one per value, dearest first — so every slot
 * down the board is a strictly better player than the one after it, and a
 * pick's value turns on the slot, never on which cards the seeded class drew.
 */
function withBoard(d) {
  const seen = new Set();
  const keys = byTalent(d.draftPool.filter(k => getCardByKey(k))).filter(k => {
    const v = fairDp(getCardByKey(k));
    if (seen.has(v)) return false;
    seen.add(v);
    return true;
  }).slice(0, classSize(d.teams.length));
  expect(keys).toHaveLength(classSize(d.teams.length));
  return { ...d, draftClass: { year: nextDraftYear(d), keys } };
}

describe('what a player is worth in a trade', () => {
  it('is convex in talent: a star is worth more than two halves of one', () => {
    expect(talentValue(card(1650))).toBeGreaterThan(2 * talentValue(card(825)));
  });

  it('pays for control: a rental is worth less than the same player for years', () => {
    expect(controlFactor(1)).toBeLessThan(controlFactor(3));
    expect(controlFactor(5)).toBe(controlFactor(4));
  });

  it('counts a cheap long deal as an asset and an overpaid one as a burden', () => {
    const c = card(1100); // 20 DP of value
    expect(contractValue(c, { dp: 15, years: 3 })).toBeGreaterThan(0);
    expect(contractValue(c, { dp: 25, years: 3 })).toBeLessThan(0);
    expect(contractValue(c, { dp: 15, years: 3 })).toBeGreaterThan(contractValue(c, { dp: 15, years: 1 }));
  });

  it('ignores age in a ten-year dynasty: 38 or 23, the same deal is the same player', () => {
    const d = preseason();
    const key = rosterKeys(d, HUMAN_ID)[0];
    const at = age => tradeValue({ ...d, joined: { ...d.joined, [key]: 1 - (age - baseAge(key)) } }, key, HUMAN_ID);
    expect(at(38)).toBe(at(23));
  });

  it('in an aging dynasty prices only the chance he retires before the deal is out — and a rebuilder minds it more', () => {
    const d0 = preseason({ aging: true });
    // A young card PUT on your roster (2026-09-18: it was looked for there,
    // and a roster with nobody 25 or under fell back to a card the ages
    // below cannot be set for), so the test can make him any age from 25 up.
    const key = CARDS.map(cardKey).find(k => baseAge(k) <= 25 && !d0.contracts[k]);
    const [out] = rosterKeys(d0, HUMAN_ID);
    const { [out]: _gone, ...kept } = d0.contracts;
    // At exactly his worth, so what the deal is worth is talent and years alone.
    const d = { ...d0, contracts: { ...kept, [key]: { ...d0.contracts[out], dp: fairDp(getCardByKey(key)) } }, joined: { ...d0.joined, [key]: 1 } };
    const withAge = (age, years = 3) => {
      const x = { ...d, contracts: { ...d.contracts, [key]: { ...d.contracts[key], years } }, joined: { ...d.joined, [key]: d.year - (age - baseAge(key)) } };
      expect(ageOf(x, key)).toBe(age);
      return x;
    };
    const young = tradeValue(withAge(25), key, HUMAN_ID);
    expect(tradeValue(withAge(32), key, HUMAN_ID)).toBe(young);   // a three-year deal from 32 ends at 34: no retirement risk inside it
    expect(tradeValue(withAge(37), key, HUMAN_ID)).toBeLessThan(young);
    // A one-year deal at 37 carries no risk: he plays the one season.
    expect(tradeValue(withAge(37, 1), key, HUMAN_ID)).toBe(tradeValue(withAge(25, 1), key, HUMAN_ID));
    const old = withAge(37);
    const contender = { ...old, teams: old.teams.map(t => (t.id === HUMAN_ID ? { ...t, last: { playoffs: true } } : t)) };
    const rebuilder = { ...old, teams: old.teams.map(t => (t.id === HUMAN_ID ? { ...t, last: { playoffs: false } } : t)) };
    expect(teamDirection(rebuilder, HUMAN_ID)).toBe('rebuild');
    expect(tradeValue(rebuilder, key, HUMAN_ID)).toBeLessThan(tradeValue(contender, key, HUMAN_ID));
  });
});

describe('a trade with the AI', () => {
  const { d, ai, me, them, overpay, fleece } = tradeCase();

  it('takes an overpay and turns down a fleecing', () => {
    // Guards evaluateTrade's verdict: your cheap long star for their max-deal
    // scrub is an overpay the AI takes; your scrub for their star is not.
    for (const deal of [overpay, fleece]) expect(tradeProblems(d, deal)).toEqual([]);
    const yes = evaluateTrade(d, overpay);
    const no = evaluateTrade(d, fleece);
    expect(yes.valueIn).toBeGreaterThan(yes.needed);
    expect(yes.verdict).toBe('accept');
    expect(no.valueIn).toBeLessThan(0.4 * no.valueOut);
    expect(no.verdict).toBe('reject');
    // The edge is real: their fairly paid man for nothing is not a deal.
    expect(evaluateTrade(d, { from: HUMAN_ID, to: ai, give: [], get: [them.mid] }).verdict).not.toBe('accept');
  });

  it("keeps rosters at ten and payrolls under each side's apron, and trades only between seasons", () => {
    const [mine] = rosterKeys(d, HUMAN_ID);
    const [a, b] = rosterKeys(d, ai);
    expect(tradeProblems(d, { from: HUMAN_ID, to: ai, give: [], get: [a, b] }).join(' ')).toMatch(/1[12] players/);
    expect(tradeProblems(d, { from: HUMAN_ID, to: ai, give: [a], get: [] }).join(' ')).toMatch(/under contract with you/);
    // In season until the deadline — 60% of the regular season, like the NBA's.
    const inSeason = startSeason(d, { rng: seeded(3) });
    expect(tradeProblems(inSeason, { from: HUMAN_ID, to: ai, give: [mine], get: [a] })).not.toContain('The trade deadline has passed.');
    const late = { ...inSeason, season: { ...inSeason.season, round: tradeDeadlineRound(inSeason.season) + 1 } };
    expect(tradeProblems(late, { from: HUMAN_ID, to: ai, give: [mine], get: [a] })).toContain('The trade deadline has passed.');
  });

  it('moves the contracts with the players, and nothing else', () => {
    const deal = overpay;
    const x = makeTrade(d, deal);
    expect(x.contracts[deal.give[0]]).toEqual({ ...d.contracts[deal.give[0]], teamId: ai });
    expect(x.contracts[deal.get[0]]).toEqual({ ...d.contracts[deal.get[0]], teamId: HUMAN_ID });
    expect(Object.keys(x.contracts)).toHaveLength(Object.keys(d.contracts).length);
    expect(rosterKeys(x, HUMAN_ID)).toHaveLength(MAX_ROSTER);
    expect(x.news[0].text).toMatch(/^Trade: /);
  });

  it('moves the live season\'s rosters when it happens mid-season', () => {
    // The AI-AI trade search at tip-off depends on the pool (2026-09-24: with
    // the 56 dormant Throwbacks gone it moved a man in this deal, and the deal
    // went illegal). Spend the budget: this test is about the human's trade.
    const s = startSeason({ ...d, aiDeals: { year: d.year, n: AI_TRADES_PER_OFFSEASON } }, { rng: seeded(3) });
    const deal = overpay;
    expect(evaluateTrade(s, deal).verdict).toBe('accept');
    const x = makeTrade(s, deal);
    const mineNow = x.season.teams.find(t => t.id === HUMAN_ID).roster.map(cardKey);
    const theirsNow = x.season.teams.find(t => t.id === ai).roster.map(cardKey);
    expect(mineNow).toContain(deal.get[0]);
    expect(mineNow).not.toContain(deal.give[0]);
    expect(theirsNow).toContain(deal.give[0]);
    expect(tradeDeadlineRound({ fixtures: [{ round: 10 }] })).toBe(6);
  });

  it('refuses a deal they turned down', () => {
    expect(() => makeTrade(d, fleece)).toThrow();
  });

  it('names the cheapest addition that gets a deal done, and it does', () => {
    // Their fairly paid man for nothing is short; your cheap long star alone
    // more than makes it up (the AI team has the seat for him), so at least
    // one addition works — and the suggestion is the cheapest one to you.
    const deal = { from: HUMAN_ID, to: ai, give: [], get: [them.mid] };
    expect(evaluateTrade(d, deal).verdict).not.toBe('accept');
    expect(evaluateTrade(d, { ...deal, give: [me.star] }).verdict).toBe('accept');
    const s = suggestSweetener(d, deal);
    expect(s).not.toBeNull();
    const sweetened = s.key ? { ...deal, give: [...deal.give, s.key] } : { ...deal, givePicks: [s.pick] };
    expect(evaluateTrade(d, sweetened).verdict).toBe('accept');
    const cost = s.key ? tradeValue(d, s.key, HUMAN_ID) : pickValue(d, s.pick, HUMAN_ID);
    expect(cost).toBeLessThanOrEqual(tradeValue(d, me.star, HUMAN_ID));
  });
});

describe('draft picks', () => {
  // The class set by hand (withBoard): a pick's worth turns on its slot.
  const d = withBoard(preseason());
  const ai = d.teams.find(t => !t.human).id;

  it('gives every team its own 1st and 2nd in the next two drafts', () => {
    const mine = picksOf(d, HUMAN_ID);
    expect(mine).toHaveLength(4);
    expect(mine.map(parsePick).every(p => p.origin === HUMAN_ID)).toBe(true);
    expect(new Set(mine.map(id => parsePick(id).year))).toEqual(new Set([nextDraftYear(d), nextDraftYear(d) + 1]));
  });

  it('values a bad team\'s pick above a good team\'s, a 1st above a 2nd, and a nearer draft above a later one', () => {
    const [worst, best] = [...d.teams].sort((a, b) => projectedSlot(d, a.id) - projectedSlot(d, b.id)).map(t => t.id).filter((_, i, all) => i === 0 || i === all.length - 1);
    const y = nextDraftYear(d);
    const v = (year, round, origin) => pickValue(d, `${year}-${round}-${origin}`, HUMAN_ID);
    expect(v(y, 1, worst)).toBeGreaterThan(v(y, 1, best));
    expect(v(y, 1, worst)).toBeGreaterThan(v(y, 2, worst));
    expect(v(y, 1, worst)).toBeGreaterThan(v(y + 1, 1, worst));
  });

  it('prices a pick on its SLOT\'s scale, not the card it lands (2026-09-17)', () => {
    const y = nextDraftYear(d);
    const board = [...classFor(d)].sort((a, b) => talentValue(getCardByKey(b)) - talentValue(getCardByKey(a)));
    for (const round of [1, 2]) {
      for (const t of d.teams) {
        const slot = (round - 1) * d.teams.length + projectedSlot(d, t.id);
        const card = getCardByKey(board[Math.min(slot, board.length) - 1]);
        const scale = rookieScale(slot, d.teams.length);
        const want = teamDirection(d, HUMAN_ID) === 'rebuild' ? 1.25 : 0.85;
        const v = Math.max(0, talentValue(card) * controlFactor(scale.years) + contractValue(card, scale)) * 0.9 * want;
        expect(pickValue(d, `${y}-${round}-${t.id}`, HUMAN_ID)).toBeCloseTo(v, 6);
      }
    }
  });

  it('is worth more to a rebuilding team than to a contender', () => {
    const id = picksOf(d, HUMAN_ID)[0];
    const as = playoffs => ({ ...d, teams: d.teams.map(t => (t.id === ai ? { ...t, last: { playoffs } } : t)) });
    // A first-rounder off the built board is worth something to anyone...
    expect(pickValue(as(true), id, ai)).toBeGreaterThan(0);
    expect(pickValue(as(false), id, ai)).toBeGreaterThan(pickValue(as(true), id, ai));
  });

  it('changes hands in a trade, and back', () => {
    // A pick and a 2-DP bench player for their max-deal scrub (tradeCase):
    // they are glad to be rid of him, so the deal is accepted whatever the
    // pick is worth. It used to `return` quietly when a searched-for target
    // said no — testing nothing.
    const { d: x0, ai: to, me, them } = tradeCase(d);
    const [pick] = picksOf(x0, HUMAN_ID);
    const deal = { from: HUMAN_ID, to, give: [me.spare], get: [them.scrub], givePicks: [pick] };
    expect(evaluateTrade(x0, deal).verdict).toBe('accept');
    const x = makeTrade(x0, deal);
    const { year, round, origin } = parsePick(pick);
    expect(pickOwner(x, year, round, origin)).toBe(to);
    expect(picksOf(x, to)).toContain(pick);
    expect(picksOf(x, HUMAN_ID)).not.toContain(pick);
    expect(tradeProblems(x, { from: HUMAN_ID, to, givePicks: [pick], get: [] })).toContain('That pick is not yours to trade.');
  });
});

describe('the AI trading among itself', () => {
  const expectLegal = (d, x) => {
    for (const t of x.teams) {
      expect(rosterKeys(x, t.id).length).toBeLessThanOrEqual(MAX_ROSTER);
      // An AI team's OWN apron (115 at Prince, 2026-09-17), not the human's 130.
      if (payroll(x, t.id) > payroll(d, t.id)) expect(payroll(x, t.id)).toBeLessThanOrEqual(aiApronDp(x));
    }
    expect(rosterKeys(x, HUMAN_ID).sort()).toEqual(rosterKeys(d, HUMAN_ID).sort());
  };

  it('makes a deal that both sides win when one is there to make — a guard for a centre between a team of guards and a team of centres', () => {
    // BUILT, NOT SEARCHED FOR (2026-09-18). This used to run seeded leagues
    // until one of them happened to trade, and every free agent the Card
    // Studio adds reshuffles those leagues: the search went to zero on
    // 2026-09-16 and again under a pool of four more cards. Here the deal is
    // there by construction: one AI team is ten guards and the other ten
    // centres, every man worth about 10 DP and paid exactly that, so a guard
    // for a centre fills a hole on both sides (needFactor) and both come out
    // ahead. If aiTrades stopped trading — or traded only one side's win —
    // this fails.
    const d0 = preseason({ size: 3 });
    const [a, b] = d0.teams.filter(t => !t.human).map(t => t.id);
    const mine = new Set(rosterKeys(d0, HUMAN_ID).map(k => getCardByKey(k).id));
    const nearTen = pos => CARDS.filter(c => pos.includes(c.pos) && !mine.has(c.id))
      .sort((x, y) => Math.abs(fairDp(x) - 10) - Math.abs(fairDp(y) - 10) || x.id.localeCompare(y.id))
      .slice(0, MAX_ROSTER).map(cardKey);
    const guards = nearTen(['PG', 'SG']);
    const centres = nearTen(['C']);
    const contracts = Object.fromEntries(Object.entries(d0.contracts).filter(([, c]) => c.teamId === HUMAN_ID));
    for (const [team, keys] of [[a, guards], [b, centres]]) {
      for (const k of keys) contracts[k] = { teamId: team, dp: fairDp(getCardByKey(k)), years: 2, since: 1, how: 'brought' };
    }
    const d = { ...d0, contracts };
    const x = aiTrades(d, { rng: seeded(41), attempts: 120, max: 3 });
    const made = x.news.filter(n => /^Trade: /.test(n.text)).length;
    expect(made).toBeGreaterThan(0);
    expect(made).toBeLessThanOrEqual(3);
    expectLegal(d, x);
    // Whatever moved between the two filled a need: centres to the guards, a guard to the centres.
    const moved = Object.keys(x.contracts).filter(k => d.contracts[k] && x.contracts[k].teamId !== d.contracts[k].teamId);
    for (const k of moved) expect(x.contracts[k].teamId).toBe(guards.includes(k) ? b : a);
  });

  it('never touches your roster and leaves every roster legal, in leagues drafted from the pool', () => {
    // The invariants, over drafted leagues — no count of deals is pinned
    // here, since how many a seeded league makes is the pool's doing.
    for (let seed = 1; seed <= 6; seed += 1) {
      const d = preseason({ size: 10, seed });
      const x = aiTrades(d, { rng: seeded(seed + 40), attempts: 120, max: 3 });
      expect(x.news.filter(n => /^Trade: /.test(n.text)).length).toBeLessThanOrEqual(3);
      expectLegal(d, x);
    }
  });
});

// ── PHASE 2 — TRADES (2026-09-18) ───────────────────────────────────────────

/**
 * Three teams built by position (the guards-and-centres case above): AI team
 * `a` is ten guards, AI team `b` ten forwards, and YOUR ten are centres —
 * every man worth about 10 DP and paid exactly that. Each AI team is short
 * of a centre and you are short of everything else, so a swap fills a hole
 * on both sides by construction, whatever the seeded pool dealt.
 */
function byPosition() {
  const d0 = preseason({ size: 3 });
  const [a, b] = d0.teams.filter(t => !t.human).map(t => t.id);
  const used = new Set();
  const nearTen = pos => CARDS.filter(c => pos.includes(c.pos) && !used.has(c.id))
    .sort((x, y) => Math.abs(fairDp(x) - 10) - Math.abs(fairDp(y) - 10) || x.id.localeCompare(y.id))
    .slice(0, MAX_ROSTER)
    .map(c => { used.add(c.id); return cardKey(c); });
  const teams = { [a]: nearTen(['PG', 'SG']), [b]: nearTen(['SF', 'PF']), [HUMAN_ID]: nearTen(['C']) };
  const contracts = {};
  for (const [team, keys] of Object.entries(teams)) {
    for (const k of keys) contracts[k] = { teamId: team, dp: fairDp(getCardByKey(k)), years: 2, since: 1, how: 'brought' };
  }
  // A fresh turn: the offers createDynasty made were for the rosters it dealt.
  return { d: { ...d0, contracts, offers: [], offerTurn: null, aiDeals: null }, a, b, teams };
}

const sig = o => JSON.stringify([o.from, o.to, o.give, o.get, o.givePicks ?? [], o.getPicks ?? []]);

describe('roster relief: a side over ten waives its weakest to make room', () => {
  const { d, ai, me, them } = tradeCase();
  // Two of theirs for your fairly paid man: you would end at eleven.
  const twoForOne = { from: HUMAN_ID, to: ai, give: [me.mid], get: [them.star, them.mid] };

  it("makes a two-for-one into a full roster legal, cutting that side's weakest — one man, never two", () => {
    expect(rosterKeys(d, HUMAN_ID)).toHaveLength(MAX_ROSTER);
    expect(tradeRelief(d, twoForOne)).toEqual({ [HUMAN_ID]: [me.scrub] });
    expect(tradeProblems(d, twoForOne)).toEqual([]);
    expect(TRADE_RELIEF).toBe(1);
    // Two for nothing would need two cuts: still too many players.
    expect(tradeProblems(d, { from: HUMAN_ID, to: ai, give: [], get: [them.star, them.mid] }).join(' ')).toMatch(/12 players/);
  });

  it("puts the man on waivers with his DP still on the books, so the payroll — and its apron check — is the trade's alone", () => {
    const x = makeTrade(d, twoForOne, { force: true });
    expect(rosterKeys(x, HUMAN_ID)).toHaveLength(MAX_ROSTER);
    expect(x.contracts[me.scrub]).toBeUndefined();
    expect(onWaivers(x, me.scrub)).toBe(true);
    expect(deadMoney(x, HUMAN_ID)).toBe(d.contracts[me.scrub].dp);
    const dp = k => d.contracts[k].dp;
    expect(payroll(x, HUMAN_ID)).toBe(payroll(d, HUMAN_ID) - dp(me.mid) + dp(them.star) + dp(them.mid));
    expect(x.news[0].text).toMatch(/^Trade: .*waive .* to make room/);
  });

  it("counts the AI side's cut as given up, so it takes such a deal only if it still wins without him", () => {
    // Their roster made full, and their weakest men cheap enough to be worth
    // keeping — every man tied with the scrub at the bottom too (a pool-swap
    // sweep, 2026-09-18: one card moving team tied Brook Lopez with Ryan
    // Rollins, and the tie goes to the worse contract, so the cut was the
    // other man).
    const floor = talentOf(them.scrub);
    const contracts = { ...d.contracts, [them.spare]: { teamId: ai, dp: 2, years: 2, since: 1, how: 'brought' } };
    for (const k of [...rosterKeys(d, ai), them.spare]) if (talentOf(k) === floor) contracts[k] = { ...contracts[k], dp: 1 };
    const full = { ...d, contracts };
    const deal = { from: HUMAN_ID, to: ai, give: [me.star, me.spare], get: [them.mid] };
    const ev = evaluateTrade(full, deal);
    expect(ev.relief[ai]).toHaveLength(1);
    const [cutMan] = ev.relief[ai];
    expect(talentOf(cutMan)).toBe(floor);
    const cut = tradeValue(full, cutMan, ai);
    expect(cut).toBeGreaterThan(0);
    expect(ev.valueOut).toBeCloseTo(tradeValue(full, them.mid, ai) + cut, 6);
  });

  it("works in season too: the cut waits on the wire for the round to turn, and the season's rosters move", () => {
    const s = { ...startSeason(d, { rng: seeded(3) }) };
    // Rebuild the case on the season's books: the AI may have traded at its own last point.
    const deal = { from: HUMAN_ID, to: ai, give: [me.mid].filter(k => s.contracts[k]?.teamId === HUMAN_ID), get: rosterKeys(s, ai).slice(0, 2) };
    expect(deal.give).toHaveLength(1);
    expect(rosterKeys(s, HUMAN_ID)).toHaveLength(MAX_ROSTER);
    expect(tradeProblems(s, deal)).toEqual([]);
    const cutMan = tradeRelief(s, deal)[HUMAN_ID][0];
    const x = makeTrade(s, deal, { force: true });
    expect(onWaivers(x, cutMan)).toBe(true);
    expect(x.season.teams.find(t => t.id === HUMAN_ID).roster.map(cardKey)).not.toContain(cutMan);
    const turned = seasonTurn(x, { ...x.season, round: x.season.round + 1 });
    expect(onWaivers(turned, cutMan)).toBe(false);
  });
});

describe('a side past its apron', () => {
  it('an AI team trades only down; a coach down or even (2026-09-18)', () => {
    const { d, ai, me, them } = tradeCase();
    // Both books pushed past their aprons by the max-deal scrubs, and the two
    // mids made the same DP, so a swap of them moves neither payroll.
    const push = (x, team, scrub, to) => ({ ...x, contracts: { ...x.contracts, [scrub]: { ...x.contracts[scrub], dp: x.contracts[scrub].dp + to - payroll(x, team) } } });
    let over = push(d, HUMAN_ID, me.scrub, 131);
    over = push(over, ai, them.scrub, aiApronDp(over) + 1);
    over = { ...over, contracts: { ...over.contracts, [them.mid]: { ...over.contracts[them.mid], dp: over.contracts[me.mid].dp } } };
    over = push(over, ai, them.scrub, aiApronDp(over) + 1);
    expect(payroll(over, HUMAN_ID)).toBe(131);
    expect(payroll(over, ai)).toBe(aiApronDp(over) + 1);
    const swap = tradeProblems(over, { from: HUMAN_ID, to: ai, give: [me.mid], get: [them.mid] });
    // Refused for the AI side, in the rule's own words: its payroll does not move.
    expect(swap.join(' ')).toContain(`already past their ${aiApronDp(over)} apron`);
    expect(swap.join(' ')).toMatch(/only trade down/);
    expect(swap.join(' ')).not.toMatch(/130 apron/);
    // A deal that moves no DP either way is never an apron's business.
    expect(tradeProblems(over, { from: HUMAN_ID, to: ai, givePicks: [picksOf(over, HUMAN_ID)[0]] }).join(' ')).not.toMatch(/apron/);
  });
});

describe('the AI trading among itself: a directed search', () => {
  it('finds the deal both sides win, the same every time, and makes at most three an offseason', () => {
    const { d, a, b } = byPosition();
    const x = aiTrades(d);
    const trades = x.news.filter(n => /^Trade: /.test(n.text));
    expect(trades.length).toBeGreaterThan(0);
    expect(x.aiDeals).toEqual({ year: d.year, n: trades.length });
    // No dice: the server and a dynasty alone make the same deals.
    expect(aiTrades(d)).toEqual(x);
    // Only between the AI teams.
    expect(rosterKeys(x, HUMAN_ID).sort()).toEqual(rosterKeys(d, HUMAN_ID).sort());
    const moved = Object.keys(x.contracts).filter(k => d.contracts[k] && x.contracts[k].teamId !== d.contracts[k].teamId);
    expect(moved.length).toBeGreaterThan(0);
    for (const k of moved) expect([a, b]).toContain(x.contracts[k].teamId);
    // The offseason's budget is shared by its three points; a new year starts a new one.
    const spent = { ...d, aiDeals: { year: d.year, n: AI_TRADES_PER_OFFSEASON } };
    expect(aiTrades(spent)).toBe(spent);
    expect(aiTrades({ ...d, aiDeals: { year: d.year - 1, n: AI_TRADES_PER_OFFSEASON } }).aiDeals.n).toBeGreaterThan(0);
  });
});

describe('the AI proposes trades to you', () => {
  it('an AI team with a need offers a legal deal it would take itself and that does not insult you', () => {
    const { d, a } = byPosition();
    const deals = aiProposals(d);
    expect(deals.length).toBeGreaterThan(0);
    expect(deals.length).toBeLessThanOrEqual(AI_OFFERS_PER_TURN);
    // One an AI team.
    expect(new Set(deals.map(o => o.from)).size).toBe(deals.length);
    const o = deals.find(x => x.from === a);
    expect(o).toBeTruthy();
    expect(o.to).toBe(HUMAN_ID);
    expect(tradeProblems(d, o)).toEqual([]);
    // Its own acceptance logic, from its side of the table...
    const back = { from: o.to, to: o.from, give: o.get, get: o.give, givePicks: o.getPicks, getPicks: o.givePicks };
    expect(evaluateTrade(d, back).verdict).toBe('accept');
    // ...and a fairness floor from yours.
    const v = offerValue(d, o);
    expect(v.valueIn).toBeGreaterThanOrEqual(OFFER_FAIRNESS * v.valueOut);
    // The guards' need: a centre comes back to them.
    expect(o.get.some(k => getCardByKey(k).pos === 'C')).toBe(true);
  });

  it('is posted as an offer with a line on the wire, lapses at the next turn, and is not made again once declined', () => {
    const { d } = byPosition();
    const x = aiOfferTurn(d);
    const open = x.offers.filter(o => o.ai && o.status === 'open');
    expect(open.length).toBeGreaterThan(0);
    expect(open.every(o => o.to === HUMAN_ID && o.year === d.year && o.phase === d.phase)).toBe(true);
    expect(x.news[0].text).toMatch(/ offer /);
    expect(aiOfferTurn(x)).toBe(x);   // the same turn posts once
    const next = startSeason(x, { rng: seeded(4) });
    for (const o of open) expect(next.offers.find(y => y.id === o.id).status).toBe('expired');
    const no = answerOffer(x, open[0].id, HUMAN_ID, false);
    expect(no.offers.find(o => o.id === open[0].id).status).toBe('declined');
    expect(aiProposals(no).map(sig)).not.toContain(sig(open[0]));
  });

  it('accepting makes the trade; a stale offer is refused — illegal now, or no longer one the AI wants', () => {
    const { d, a } = byPosition();
    const x = aiOfferTurn(d);
    const o = x.offers.find(y => y.ai && y.status === 'open');
    const y = answerOffer(x, o.id, HUMAN_ID, true);
    for (const k of o.give) expect(y.contracts[k].teamId).toBe(HUMAN_ID);
    for (const k of o.get) expect(y.contracts[k].teamId).toBe(o.from);
    expect(y.offers.find(z => z.id === o.id).status).toBe('accepted');
    expect(y.news[0].text).toMatch(/accepted/);
    expect(y.news[1].text).toMatch(/^Trade: /);
    expect(() => answerOffer(y, o.id, HUMAN_ID, true)).toThrow(/not open/);
    expect(() => answerOffer(x, o.id, o.from, true)).toThrow(/not yours to answer/);
    // Your man in it is gone since: illegal now, refused — and said from
    // your side of it (2026-09-18: it read "not under contract with them").
    const mineGone = waive(x, HUMAN_ID, o.get[0]);
    expect(offerProblems(mineGone, o)[0]).toMatch(/under contract with you/);
    expect(() => answerOffer(mineGone, o.id, HUMAN_ID, true)).toThrow(/under contract with you/);
    // Theirs gone: "not under contract with them".
    if (o.give.length) {
      const theirsGone = { ...x, contracts: Object.fromEntries(Object.entries(x.contracts).filter(([k]) => k !== o.give[0])) };
      expect(() => answerOffer(theirsGone, o.id, HUMAN_ID, true)).toThrow(/not under contract with them/);
    }
    // Legal, but not a deal the AI wants (its best guard and every pick it
    // holds for your weakest centre, as a stale offer could stand after the
    // league moved): refused.
    const best = [...rosterKeys(x, a)].sort((p, q) => tradeValue(x, q, a) - tradeValue(x, p, a)).slice(0, 1);
    const worst = [...rosterKeys(x, HUMAN_ID)].sort((p, q) => tradeValue(x, p, a) - tradeValue(x, q, a)).slice(0, 1);
    const picks = picksOf(x, a);
    const bad = { id: 'ai-stale', from: a, to: HUMAN_ID, give: best, get: worst, givePicks: picks, getPicks: [], status: 'open', ai: true, year: x.year, phase: x.phase };
    const staleX = { ...x, offers: [...x.offers, bad] };
    expect(tradeProblems(staleX, bad)).toEqual([]);
    const ev = evaluateTrade(staleX, { from: HUMAN_ID, to: a, give: worst, get: best, getPicks: picks });
    expect(ev.verdict).not.toBe('accept');
    expect(() => answerOffer(staleX, 'ai-stale', HUMAN_ID, true)).toThrow(/thought better/);
    expect(offerProblems(staleX, bad)[0]).toMatch(/thought better/);
  });

  it('a deal you turned down stays turned down all year, however many offers are trimmed since', () => {
    // A review (2026-09-18): the refusals were read off d.offers, which keeps
    // OFFERS_KEPT decided offers, and a year expires up to three a turn.
    const { d } = byPosition();
    const x = aiOfferTurn(d);
    const o = x.offers.find(y => y.ai && y.status === 'open');
    const no = answerOffer(x, o.id, HUMAN_ID, false);
    const filler = Array.from({ length: OFFERS_KEPT + 5 }, (_, i) => ({ id: `f${i}`, from: 'z', to: 'y', give: [], get: [], givePicks: [], getPicks: [], status: 'expired', ai: true, year: no.year, phase: no.phase }));
    const later = { ...no, offers: trimOffers([...no.offers, ...filler], no) };
    expect(later.offers.find(y => y.id === o.id)).toBeUndefined();
    expect(aiProposals(later).map(sig)).not.toContain(sig(o));
    // It is the kept refusal doing it — one kept for last year does not count.
    expect(later.offerRefusals.year).toBe(later.year);
    expect(aiProposals({ ...later, offerRefusals: { ...later.offerRefusals, year: later.year - 1 } }).map(sig)).toContain(sig(o));
  });

  it('no offer is ever illegal when it is posted', () => {
    for (let seed = 1; seed <= 3; seed += 1) {
      let x = preseason({ size: 8, seed });
      for (let turn = 0; turn < 2; turn += 1) {
        for (const o of (x.offers ?? []).filter(y => y.ai && y.status === 'open')) expect(tradeProblems(x, o)).toEqual([]);
        if (x.phase === DPHASE.preseason) x = startSeason(x, { rng: seeded(seed) });
      }
    }
  });

  it('the server and a dynasty alone post the same offers for the same state, and answer them the same', () => {
    const { d } = byPosition();
    const alone = startSeason(d, { rng: seeded(9) });
    const friends = advancePhase(d, { rng: seeded(9) });
    expect(friends.phase).toBe(DPHASE.season);
    expect(friends.offers).toEqual(alone.offers);
    expect(alone.offers.some(o => o.ai && o.status === 'open')).toBe(true);
    const o = alone.offers.find(y => y.ai && y.status === 'open');
    const a = answerOffer(alone, o.id, HUMAN_ID, true);
    const f = respondTrade(friends, o.id, HUMAN_ID, true, { now: 5 });
    expect(f.contracts).toEqual(a.contracts);
    expect(f.offers.find(y => y.id === o.id)).toMatchObject({ status: 'accepted', decidedAt: 5 });
  });
});
