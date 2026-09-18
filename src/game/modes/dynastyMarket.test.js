import { describe, it, expect } from 'vitest';
import {
  CAP_DP, MIN_DP, FA_DAYS, LEFTOVER_DAY, PERSONALITIES,
  fairDp, dealPersonality, yearFactor, teamFactor, dayFactor, floorFor, openingAsk, askFor,
  newTalk, judgeOffer, toBeat, rookieScale, ageFactor,
} from './dynastyMarket.js';

const card = salary => ({ id: `c${salary}`, name: `Card ${salary}`, salary });

function seeded(seed = 7) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('fair value', () => {
  it('turns the printed cap into 100 DP', () => {
    expect(fairDp(card(10))).toBe(1);
    expect(fairDp(card(560))).toBe(10);
    expect(fairDp(card(1840))).toBe(33);
    expect(fairDp(card(5500))).toBe(CAP_DP);
  });
});

describe('personalities', () => {
  it('a ten-salary card is just happy to be on the team', () => {
    expect(dealPersonality(card(10), () => 0.99)).toBe('happy');
    expect(floorFor(card(10), 'happy', {}, 4)).toBe(MIN_DP);
    expect(judgeOffer({ card: card(10), pid: 'happy', ctx: {}, offer: { dp: 1, years: 3 } }).accepted).toBe(true);
  });

  it('deals every kind above the happy line, and never Happy to a real salary', () => {
    const rng = seeded(3);
    const seen = new Set();
    for (let i = 0; i < 400; i += 1) seen.add(dealPersonality(card(600), rng));
    expect([...seen].sort()).toEqual(['bet', 'easy', 'loyal', 'money', 'ring', 'security']);
  });

  it('prices the length each one wants', () => {
    expect(yearFactor('security', 5)).toBe(1);
    expect(yearFactor('security', 1)).toBeCloseTo(1.48);
    expect(yearFactor('security', 5)).toBeLessThan(yearFactor('security', 2));
    expect(yearFactor('bet', 1)).toBe(1);
    expect(yearFactor('bet', 3)).toBeCloseTo(1.24);
    expect(yearFactor('money', 4)).toBeCloseTo(1.04);
  });

  it('Loyal gives his own team a break, and only his own team', () => {
    expect(teamFactor('loyal', { teamId: 'you', lastTeamId: 'you' })).toBe(0.8);
    expect(teamFactor('loyal', { teamId: 'ai:BOS', lastTeamId: 'you' })).toBe(1);
  });

  it('asks more from the team that just let him go, and only from that team', () => {
    expect(teamFactor('easy', { teamId: 'you', spurnedBy: 'you' })).toBe(1.25);
    expect(teamFactor('easy', { teamId: 'ai:BOS', spurnedBy: 'you' })).toBe(1);
    expect(teamFactor('loyal', { teamId: 'you', lastTeamId: 'you', spurnedBy: 'you' })).toBeCloseTo(1);
  });

  it('a Ring Chaser is cheaper for a champion and dearer for a lottery team', () => {
    const f = standing => teamFactor('ring', { standing });
    expect(f({ title: true, playoffs: true })).toBeLessThan(f({ title: false, playoffs: true }));
    expect(f({ title: false, playoffs: true })).toBeLessThan(f(null));
    expect(f({ title: false, playoffs: false })).toBeGreaterThan(1);
  });
});

describe('the market', () => {
  it('cools ten percent a day, and the leftovers go at the last price', () => {
    expect(dayFactor(1)).toBe(1);
    expect(dayFactor(FA_DAYS)).toBeCloseTo(0.8);
    expect(dayFactor(LEFTOVER_DAY)).toBeCloseTo(0.7);
    expect(floorFor(card(1100), 'easy', {}, 2, FA_DAYS)).toBeLessThan(floorFor(card(1100), 'easy', {}, 2, 1));
  });

  it('opens above the floor and comes down to it as the talks go', () => {
    const c = card(1100);
    const floor = floorFor(c, 'loyal', {}, 3);
    const open = openingAsk(c, 'loyal', {}, 3);
    expect(open).toBeGreaterThan(floor);
    expect(askFor(c, 'loyal', {}, 3, { progress: 0 })).toBe(open);
    expect(askFor(c, 'loyal', {}, 3, { progress: 1 })).toBe(floor);
    expect(askFor(c, 'loyal', {}, 3, { progress: 0.5 })).toBeLessThan(open);
  });
});

describe('an offer', () => {
  const c = card(1100); // 20 DP of value
  const pid = 'loyal';

  it('signs at or over the floor', () => {
    const floor = floorFor(c, pid, {}, 3);
    expect(judgeOffer({ card: c, pid, ctx: {}, offer: { dp: floor, years: 3 } }).accepted).toBe(true);
    expect(judgeOffer({ card: c, pid, ctx: {}, offer: { dp: floor - 1, years: 3 } }).accepted).toBe(false);
  });

  it('says how far apart you are, and an insult costs double', () => {
    const floor = floorFor(c, pid, {}, 3);
    const close = judgeOffer({ card: c, pid, ctx: {}, offer: { dp: floor - 1, years: 3 } });
    expect(close.mood).toBe('close');
    expect(close.talk.patience).toBe(PERSONALITIES.loyal.patience - 1);
    expect(close.talk.progress).toBe(0.5);
    const insult = judgeOffer({ card: c, pid, ctx: {}, offer: { dp: 1, years: 3 } });
    expect(insult.mood).toBe('insulted');
    expect(insult.talk.patience).toBe(PERSONALITIES.loyal.patience - 2);
    expect(insult.talk.progress).toBe(0);
  });

  it('walks when his patience runs out, and then nothing signs him', () => {
    let talk = newTalk('money');
    for (let i = 0; i < 2; i += 1) talk = judgeOffer({ card: c, pid: 'money', ctx: {}, offer: { dp: 12, years: 2 }, talk }).talk;
    expect(talk.walked).toBe(true);
    const after = judgeOffer({ card: c, pid: 'money', ctx: {}, offer: { dp: 35, years: 2 }, talk });
    expect(after.accepted).toBe(false);
    expect(after.mood).toBe('walked');
  });

  it('has to beat a rival as well as the floor', () => {
    const floor = floorFor(c, pid, {}, 3);
    const rivalRatio = (floor + 2) / floor;
    const tied = judgeOffer({ card: c, pid, ctx: {}, offer: { dp: floor + 2, years: 3 }, rivalRatio });
    expect(tied.mood).toBe('outbid');
    const beat = toBeat(c, pid, {}, 3, 1, rivalRatio);
    expect(judgeOffer({ card: c, pid, ctx: {}, offer: { dp: beat, years: 3 }, rivalRatio }).accepted).toBe(true);
  });

  it('refuses an offer that is not a contract', () => {
    expect(() => judgeOffer({ card: c, pid, ctx: {}, offer: { dp: 0, years: 2 } })).toThrow();
    expect(() => judgeOffer({ card: c, pid, ctx: {}, offer: { dp: 5, years: 6 } })).toThrow();
    expect(() => judgeOffer({ card: c, pid, ctx: {}, offer: { dp: 36, years: 2 } })).toThrow();
  });

  it('never asks past a max deal: the stars all ask the max', () => {
    const star = card(1840); // 33 DP of value
    expect(floorFor(star, 'money', {}, 2)).toBe(35);
    expect(openingAsk(star, 'money', {}, 2)).toBe(35);
    expect(judgeOffer({ card: star, pid: 'money', ctx: {}, offer: { dp: 35, years: 5 } }).accepted).toBe(true);
  });
});

describe('age (aging dynasties)', () => {
  it('leaves a player alone to 31, then takes 7% a year, never past 40%', () => {
    expect(ageFactor(null)).toBe(1);
    expect(ageFactor(31)).toBe(1);
    expect(ageFactor(35)).toBeCloseTo(0.72);
    expect(ageFactor(50)).toBe(0.4);
    expect(floorFor(card(1100), 'easy', { age: 36 }, 2)).toBeLessThan(floorFor(card(1100), 'easy', { age: 26 }, 2));
  });
});

// THE SLOT PRICES THE PICK (the user, 2026-09-17): round one 10 → 5, round
// two 3 → 2, three years; the card's salary has nothing to do with it.
describe('the rookie scale', () => {
  it('slides from 10 at the first pick to 5 at the last of round one, 3 to 2 in round two, three years', () => {
    expect(rookieScale(1, 8)).toEqual({ dp: 10, years: 3, round: 1, slot: 1 });
    expect(rookieScale(8, 8)).toEqual({ dp: 5, years: 3, round: 1, slot: 8 });
    expect(rookieScale(9, 8)).toEqual({ dp: 3, years: 3, round: 2, slot: 1 });
    expect(rookieScale(16, 8)).toEqual({ dp: 2, years: 3, round: 2, slot: 8 });
    // Linear and rounded between: an eight-team round one is 10 9 9 8 7 6 6 5.
    expect(Array.from({ length: 8 }, (_, i) => rookieScale(i + 1, 8).dp)).toEqual([10, 9, 9, 8, 7, 6, 6, 5]);
    expect(Array.from({ length: 8 }, (_, i) => rookieScale(9 + i, 8).dp)).toEqual([3, 3, 3, 3, 2, 2, 2, 2]);
  });

  it('is the same at a slot whatever the league size, and never below the minimum', () => {
    expect(rookieScale(1, 4).dp).toBe(10);
    expect(rookieScale(4, 4).dp).toBe(5);
    expect(rookieScale(1, 30).dp).toBe(10);
    expect(rookieScale(30, 30).dp).toBe(5);
    expect(rookieScale(60, 30).dp).toBe(2);
    // A pick past round two is priced as the last of round two; a bad number is the first pick.
    expect(rookieScale(99, 8).dp).toBe(2);
    expect(rookieScale(0, 8).dp).toBe(10);
  });
});
