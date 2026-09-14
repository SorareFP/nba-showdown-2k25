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
// Two properties hold this together and are the ones worth pinning:
//
//   NOTHING PAYS MORE THAN DEITY. The economy — pack prices, collection
//   timelines, the "~110 games for the hardest collection" figure — was tuned
//   at the Deity rate, which is also the default. A penalty ladder leaves that
//   ceiling untouched. It is also why an unverifiable claim is harmless: the
//   best a lying client can name is the rate it already gets.
//
//   MILESTONES ARE NOT SCALED. They come out of a daily cap, and scaling them
//   would quietly move the cap.
import { describe, it, expect } from 'vitest';
import {
  settleGameReward, AI_PAY, payFactorOf, DAILY_MILESTONE_CAP, MILESTONES, REWARD,
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

  it('never pays more than the Deity rate the economy was tuned at', () => {
    for (const l of AI_LEVELS) expect(payOf(l.id), l.id).toBeLessThanOrEqual(1);
    expect(payOf(DEFAULT_AI_LEVEL)).toBe(1);
  });

  it('rises with the rung, so a harder coach is never worth less', () => {
    for (let i = 1; i < AI_LEVELS.length; i += 1) {
      expect(payOf(AI_LEVELS[i].id), AI_LEVELS[i].id)
        .toBeGreaterThan(payOf(AI_LEVELS[i - 1].id));
    }
  });

  it('moves the same way the coach does — the pay column tracks the iq column', () => {
    for (let i = 1; i < AI_LEVELS.length; i += 1) {
      expect(iqOf(AI_LEVELS[i].id)).toBeGreaterThan(iqOf(AI_LEVELS[i - 1].id));
    }
  });

  it('pays full for a rung it does not know, and for no rung at all', () => {
    expect(payFactorOf(null)).toBe(1);
    expect(payFactorOf('grandmaster')).toBe(1);
    expect(payFactorOf(undefined)).toBe(1);
  });
});

describe('what a finished game is worth', () => {
  it('pays a Settler game half what the same game against Deity pays', () => {
    expect(pay('settler')).toBe(Math.round(pay('deity') * 0.5));
  });

  it('leaves a Deity game exactly where it was before the table existed', () => {
    expect(pay('deity')).toBe(pay(null));
  });

  it('names the rung and the rate in the breakdown', () => {
    const r = settleGameReward({ won: true, margin: 20, aiLevel: 'warlord' }, spent, TODAY);
    const line = r.breakdown.find(b => b.coins < 0);
    expect(line.label).toBe('Warlord · 80% rate');
    // The line is the whole of the difference, so the screen adds up.
    expect(r.breakdown.reduce((t, b) => t + b.coins, 0)).toBe(r.coins);
  });

  it('shows no line at all at the full rate', () => {
    const r = settleGameReward({ won: true, margin: 20, aiLevel: 'deity' }, spent, TODAY);
    expect(r.breakdown.some(b => b.coins < 0)).toBe(false);
  });

  it('does not scale the capped milestone coins', () => {
    const fresh = { date: TODAY, coins: 0, firstWin: true };
    const all = MILESTONES.map(m => m.id);
    const easy = settleGameReward({ won: false, milestoneIds: all, aiLevel: 'settler' }, fresh, TODAY);
    const hard = settleGameReward({ won: false, milestoneIds: all, aiLevel: 'deity' }, fresh, TODAY);
    expect(easy.milestoneCoins).toBe(hard.milestoneCoins);
    // Only the completion money differs — the part the game earned for being played.
    expect(hard.coins - easy.coins).toBe(REWARD.complete - Math.round(REWARD.complete * 0.5));
  });

  it('takes the rung off first, then pays the dynasty rate on what is left', () => {
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
