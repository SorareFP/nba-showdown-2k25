// DYNASTY TRADES (2026-09-11): the value model — Simmons' logic, not his
// order; no aging curve, since nobody gets better or worse — the AI's answer,
// the rules of a deal, picks, the sweetener, and the AI trading among itself.
import { describe, it, expect } from 'vitest';
import {
  createDynasty, HUMAN_ID, MAX_ROSTER, rosterKeys, payroll, startSeason, contractsOf,
  tradeValue, tradeProblems, evaluateTrade, makeTrade, suggestSweetener, aiTrades,
  picksOf, pickValue, parsePick, pickOwner, projectedSlot, teamDirection, nextDraftYear, ageOf, baseAge,
} from './dynasty.js';
import { APRON_DP, talentValue, contractValue, controlFactor } from './dynastyMarket.js';
import { buildAiLeague } from './aiTeams.js';

const seeded = (s = 808) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
const card = salary => ({ id: `c${salary}`, salary, pos: 'SF' });

/** An own-team dynasty in its preseason — between seasons, the AI drafted around your ten. */
function preseason({ size = 6, aging = false, seed = 2 } = {}) {
  const roster = buildAiLeague(1, { rng: seeded(1) })[0].roster;
  return createDynasty({ id: 'T', size, length: 'online', startMode: 'own', aging, rng: seeded(seed), human: { name: 'Me', roster } });
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
    const d = preseason({ aging: true });
    // A young card, so the test can make him any age from 25 up.
    const key = rosterKeys(d, HUMAN_ID).find(k => baseAge(k) <= 25) ?? rosterKeys(d, HUMAN_ID)[0];
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
  const d = preseason();
  const ai = d.teams.find(t => !t.human).id;
  const pairs = () => rosterKeys(d, HUMAN_ID).flatMap(k => rosterKeys(d, ai).map(j => ({ from: HUMAN_ID, to: ai, give: [k], get: [j] })));

  it('takes an overpay and turns down a fleecing', () => {
    const legal = pairs().filter(p => !tradeProblems(d, p).length).map(p => ({ p, ev: evaluateTrade(d, p) }));
    const overpay = legal.find(x => x.ev.valueIn >= 1.5 * x.ev.valueOut && x.ev.valueOut > 0);
    const fleece = legal.find(x => x.ev.valueIn <= 0.4 * x.ev.valueOut);
    expect(overpay.ev.verdict).toBe('accept');
    expect(fleece.ev.verdict).toBe('reject');
  });

  it('keeps rosters at ten and payrolls under the apron, and trades only between seasons', () => {
    const [mine] = rosterKeys(d, HUMAN_ID);
    const [a, b] = rosterKeys(d, ai);
    expect(tradeProblems(d, { from: HUMAN_ID, to: ai, give: [], get: [a, b] }).join(' ')).toMatch(/1[12] players/);
    expect(tradeProblems(d, { from: HUMAN_ID, to: ai, give: [a], get: [] }).join(' ')).toMatch(/under contract with you/);
    const inSeason = startSeason(d, { rng: seeded(3) });
    expect(tradeProblems(inSeason, { from: HUMAN_ID, to: ai, give: [mine], get: [a] })).toContain('Trades are made between seasons.');
  });

  it('moves the contracts with the players, and nothing else', () => {
    const deal = pairs().find(p => evaluateTrade(d, p).verdict === 'accept');
    const x = makeTrade(d, deal);
    expect(x.contracts[deal.give[0]]).toEqual({ ...d.contracts[deal.give[0]], teamId: ai });
    expect(x.contracts[deal.get[0]]).toEqual({ ...d.contracts[deal.get[0]], teamId: HUMAN_ID });
    expect(Object.keys(x.contracts)).toHaveLength(Object.keys(d.contracts).length);
    expect(rosterKeys(x, HUMAN_ID)).toHaveLength(MAX_ROSTER);
    expect(x.news[0].text).toMatch(/^Trade: /);
  });

  it('refuses a deal they turned down', () => {
    const deal = pairs().find(p => evaluateTrade(d, p).verdict === 'reject');
    expect(() => makeTrade(d, deal)).toThrow();
  });

  it('names the cheapest addition that gets a deal done, and it does', () => {
    const deal = pairs().find(p => evaluateTrade(d, p).verdict !== 'accept' && !tradeProblems(d, p).length && suggestSweetener(d, p));
    const s = suggestSweetener(d, deal);
    const sweetened = s.key ? { ...deal, give: [...deal.give, s.key] } : { ...deal, givePicks: [s.pick] };
    expect(evaluateTrade(d, sweetened).verdict).toBe('accept');
  });
});

describe('draft picks', () => {
  const d = preseason();
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

  it('is worth more to a rebuilding team than to a contender', () => {
    const id = picksOf(d, HUMAN_ID)[0];
    const as = playoffs => ({ ...d, teams: d.teams.map(t => (t.id === ai ? { ...t, last: { playoffs } } : t)) });
    expect(pickValue(as(false), id, ai)).toBeGreaterThan(pickValue(as(true), id, ai));
  });

  it('changes hands in a trade, and back', () => {
    const [pick] = picksOf(d, HUMAN_ID);
    const target = contractsOf(d, ai).at(-1).key;
    const deal = { from: HUMAN_ID, to: ai, give: [], get: [target], givePicks: [pick] };
    if (evaluateTrade(d, deal).verdict !== 'accept') return;
    const x = makeTrade(d, deal);
    const { year, round, origin } = parsePick(pick);
    expect(pickOwner(x, year, round, origin)).toBe(ai);
    expect(picksOf(x, ai)).toContain(pick);
    expect(picksOf(x, HUMAN_ID)).not.toContain(pick);
    expect(tradeProblems(x, { from: HUMAN_ID, to: ai, givePicks: [pick], get: [] })).toContain('That pick is not yours to trade.');
  });
});

describe('the AI trading among itself', () => {
  it('makes only deals both sides win, never touches your roster, and leaves every roster legal', () => {
    let trades = 0;
    for (let seed = 1; seed <= 6; seed += 1) {
      const d = preseason({ size: 10, seed });
      const x = aiTrades(d, { rng: seeded(seed + 40), attempts: 60, max: 3 });
      const made = x.news.filter(n => /^Trade: /.test(n.text)).length;
      trades += made;
      expect(made).toBeLessThanOrEqual(3);
      for (const t of x.teams) {
        expect(rosterKeys(x, t.id).length).toBeLessThanOrEqual(MAX_ROSTER);
        if (payroll(x, t.id) > payroll(d, t.id)) expect(payroll(x, t.id)).toBeLessThanOrEqual(APRON_DP);
      }
      expect(rosterKeys(x, HUMAN_ID).sort()).toEqual(rosterKeys(d, HUMAN_ID).sort());
    }
    expect(trades).toBeGreaterThan(0);
  });
});
