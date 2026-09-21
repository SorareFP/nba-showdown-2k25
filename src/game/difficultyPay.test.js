// WHAT THE RUNG IS WORTH.
//
// The user, 2026-09-14: "Let's just wire in the difficulty differences now and
// make sure we're scaling coin earnings based on difficulty too."
//
// The reason this is a correction and not a garnish: the win bonus already
// scales with the MARGIN, and an easier coach loses by more, so before the
// AI_PAY table the ladder paid BACKWARDS — measured at 1.11x for Settler over
// Deity across 1,200 mirror matches a rung (runDifficultyPay.js).
//
// Reshaped 2026-09-16 (the user: "the midpoint should be the 1x payout, with
// Deity being the 1.5x"). The properties worth pinning now:
//
//   THE FAIR RUNG IS 1x AND IT IS THE DEFAULT. The economy was tuned at 1x,
//   so Prince — the full search on an even roster — pays exactly what a game
//   paid before any table existed, and it is what a new device plays at.
//
//   BELOW IT PAYS LESS, ABOVE IT PAYS MORE, capped at PAY_MAX. A rung above
//   Prince earns its premium by fielding a better team (aiLevels.js `cap`).
//
//   MILESTONES ARE NOT SCALED. They come out of a daily cap, and scaling them
//   would quietly move the cap.
//
//   2026-09-18: THE PREMIUM IS A WIN'S, against a team the coach drew. A loss
//   pays at most 1x at any rung, and a coach handed a team it did not draw at
//   its rung pays at most 1x (coinRewards.js gamePayFactor; the user's words
//   and the farm they close are in coinFixes.test.js). The claims below are
//   wins with no `rungDraw`, which the table prices as drawn.
import { describe, it, expect } from 'vitest';
import {
  settleGameReward, AI_PAY, payFactorOf, payFloorOf, PAY_MAX, DAILY_MILESTONE_CAP, MILESTONES, REWARD,
} from './coinRewards.js';
import { AI_LEVELS, iqOf, payOf, DEFAULT_AI_LEVEL } from './aiLevels.js';

const TODAY = '2026-09-14';
/** A player who has already won today and spent the milestone cap. */
const spent = { date: TODAY, coins: DAILY_MILESTONE_CAP, firstWin: true };
const pay = (level, extra = {}) => settleGameReward(
  { won: true, margin: 20, aiLevel: level, ...extra }, spent, TODAY,
).coins;

describe('the pay ladder', () => {
  it('has a factor for every rung on the difficulty ladder, and no others', () => {
    expect(Object.keys(AI_PAY)).toEqual(AI_LEVELS.map(l => l.id));
  });

  it('pays exactly the fair rate at the default rung, and never more than PAY_MAX', () => {
    expect(payOf(DEFAULT_AI_LEVEL)).toBe(1);
    expect(payOf('prince')).toBe(1);
    for (const l of AI_LEVELS) expect(payOf(l.id), l.id).toBeLessThanOrEqual(PAY_MAX);
    expect(payOf('deity')).toBe(PAY_MAX);
    // Below the fair rung pays less; above it pays more.
    for (const id of ['settler', 'chieftain', 'warlord']) expect(payOf(id), id).toBeLessThan(1);
    for (const id of ['king', 'deity']) expect(payOf(id), id).toBeGreaterThan(1);
  });

  it('holds a league game to the lower of the rung it was built at and the rung it was played at', () => {
    // A season builds its AI rosters once, to its rung's cap. Being paid for
    // a Deity game inside a Prince league would be paid for opponents that
    // were never on the floor — so the pay floor is the lower rung, either way.
    expect(payFloorOf('prince', 'deity')).toBe(1);
    expect(payFloorOf('deity', 'prince')).toBe(1);
    expect(payFloorOf('deity', 'deity')).toBe(PAY_MAX);
    expect(payFloorOf('king', 'settler')).toBe(payOf('settler'));
  });

  it('rises with the rung, so a harder coach is never worth less', () => {
    for (let i = 1; i < AI_LEVELS.length; i += 1) {
      expect(payOf(AI_LEVELS[i].id), AI_LEVELS[i].id)
        .toBeGreaterThan(payOf(AI_LEVELS[i - 1].id));
    }
  });

  it('never asks more of the coach at a lower rung than at a higher one', () => {
    for (let i = 1; i < AI_LEVELS.length; i += 1) {
      expect(iqOf(AI_LEVELS[i].id)).toBeGreaterThanOrEqual(iqOf(AI_LEVELS[i - 1].id));
    }
  });

  it('pays the fair rate for a rung it does not know, and for no rung at all — hotseat', () => {
    expect(payFactorOf(null)).toBe(1);
    expect(payFactorOf('grandmaster')).toBe(1);
    expect(payFactorOf(undefined)).toBe(1);
  });

  it('pays a PvP game the top rate — what Deity pays — to reward playing people', () => {
    // The user, 2026-09-16: "I'm honestly fine with it being max to encourage
    // PvP play." A PvP claim carries no rung; the pvp flag takes PAY_MAX.
    const pvp = settleGameReward({ won: true, margin: 20, pvp: true }, spent, TODAY);
    const deity = settleGameReward({ won: true, margin: 20, aiLevel: 'deity' }, spent, TODAY);
    expect(pvp.coins).toBe(deity.coins);
    expect(pvp.breakdown.find(b => /PvP · 150% rate/.test(b.label))).toBeTruthy();
  });
});

describe('what a finished game is worth', () => {
  it('pays a Settler game half, and a Deity game half again, what the fair game pays', () => {
    expect(pay('settler')).toBe(Math.round(pay('prince') * 0.5));
    expect(pay('deity')).toBe(Math.round(pay('prince') * 1.5));
  });

  it('leaves a fair game exactly where it was before the table existed', () => {
    expect(pay('prince')).toBe(pay(null));
  });

  it('names the rung and the rate in the breakdown, below and above', () => {
    const cut = settleGameReward({ won: true, margin: 20, aiLevel: 'warlord' }, spent, TODAY);
    const cutLine = cut.breakdown.find(b => b.coins < 0);
    expect(cutLine.label).toBe('Warlord · 85% rate');
    expect(cut.breakdown.reduce((t, b) => t + b.coins, 0)).toBe(cut.coins);
    const bonus = settleGameReward({ won: true, margin: 20, aiLevel: 'deity' }, spent, TODAY);
    const bonusLine = bonus.breakdown.find(b => /Deity/.test(b.label));
    expect(bonusLine.coins).toBeGreaterThan(0);
    expect(bonusLine.label).toBe('Deity · 150% rate');
    expect(bonus.breakdown.reduce((t, b) => t + b.coins, 0)).toBe(bonus.coins);
  });

  it('shows no line at all at the fair rate', () => {
    const r = settleGameReward({ won: true, margin: 20, aiLevel: 'prince' }, spent, TODAY);
    expect(r.breakdown.some(b => /rate/.test(b.label))).toBe(false);
  });

  it('does not scale the capped milestone coins', () => {
    const fresh = { date: TODAY, coins: 0, firstWin: true };
    const all = MILESTONES.map(m => m.id);
    const easy = settleGameReward({ won: false, milestoneIds: all, aiLevel: 'settler' }, fresh, TODAY);
    const hard = settleGameReward({ won: false, milestoneIds: all, aiLevel: 'deity' }, fresh, TODAY);
    expect(easy.milestoneCoins).toBe(hard.milestoneCoins);
    // Only the completion money differs — the part the game earned for being
    // played. A LOSS, so since 2026-09-18 Deity pays it at the fair rate (the
    // user: "only a win takes the rung's multiplier") and Settler keeps its cut.
    expect(hard.coins - easy.coins).toBe(REWARD.complete - Math.round(REWARD.complete * 0.5));
  });

  it('applies the rung first, then pays the dynasty rate on what is left', () => {
    const r = settleGameReward({ won: true, margin: 20, aiLevel: 'settler', dynasty: true }, spent, TODAY);
    const plain = settleGameReward({ won: true, margin: 20, aiLevel: 'settler' }, spent, TODAY);
    expect(r.coins).toBe(plain.coins + Math.floor(plain.coins * 0.15));
    // A cheap dynasty game is still worth less than a dear one.
    const deity = settleGameReward({ won: true, margin: 20, aiLevel: 'deity', dynasty: true }, spent, TODAY);
    expect(r.coins).toBeLessThan(deity.coins);
  });
});

describe('the inversion it was built to correct', () => {
  // A 45-point win over Settler against a 10-point win over Deity: before the
  // table the blowout paid 2.6x as much, which made the easiest rung the most
  // profitable one to grind.
  const blowout = m => settleGameReward({ won: true, margin: 45, aiLevel: m }, spent, TODAY).coins;
  const grind = m => settleGameReward({ won: true, margin: 10, aiLevel: m }, spent, TODAY).coins;

  it('used to make the easy blowout worth far more than the hard win', () => {
    expect(blowout(null) / grind(null)).toBeGreaterThan(1.5);
  });

  it('now leaves them close enough that the rung is a real choice', () => {
    expect(blowout('settler')).toBeLessThan(grind('deity') * 1.1);
  });
});
