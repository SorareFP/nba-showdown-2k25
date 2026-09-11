// settleGameReward is the one function that prices a finished game, and it runs
// on BOTH sides — in the browser for the results screen, in the Cloud Function
// for the payout. What is tested is the part the server relies on: that a claim
// cannot be worth more than the table says, more than the daily cap allows, or
// the first-win bonus twice.
import { describe, it, expect } from 'vitest';
import {
  settleGameReward,
  detectMilestones,
  REWARD,
  DAILY_MILESTONE_CAP,
  MILESTONES,
  todayKey,
  winBonus,
  WIN_BY_MARGIN,
  CLOSE_LOSS,
} from './coinRewards.js';

const TODAY = '2026-09-05';
const fresh = { date: '', coins: 0, firstWin: false };

describe('settleGameReward', () => {
  it('pays completion, the win bonus and the first win of the day', () => {
    const r = settleGameReward({ won: true, pvp: false, milestoneIds: [], bam: false }, fresh, TODAY);
    expect(r.coins).toBe(REWARD.complete + REWARD.win + REWARD.dailyFirstWin);
    expect(r.firstWin).toBe(true);
    expect(r.daily).toEqual({ date: TODAY, coins: 0, firstWin: true });
  });

  it('pays a PvP win more, and a loss only the completion', () => {
    const win = settleGameReward({ won: true, pvp: true, milestoneIds: [] }, { ...fresh, firstWin: true, date: TODAY }, TODAY);
    expect(win.coins).toBe(REWARD.complete + REWARD.pvpWin);
    const loss = settleGameReward({ won: false, pvp: true, milestoneIds: [] }, fresh, TODAY);
    expect(loss.coins).toBe(REWARD.complete);
    expect(loss.firstWin).toBe(false);
  });

  it('gives the first-win bonus once a day, however many wins are claimed', () => {
    const first = settleGameReward({ won: true, milestoneIds: [] }, fresh, TODAY);
    const second = settleGameReward({ won: true, milestoneIds: [] }, first.daily, TODAY);
    expect(first.firstWin).toBe(true);
    expect(second.firstWin).toBe(false);
    expect(second.coins).toBe(REWARD.complete + REWARD.win);
  });

  it('resets the daily counters when the date changes', () => {
    const yesterday = { date: '2026-09-04', coins: DAILY_MILESTONE_CAP, firstWin: true };
    const r = settleGameReward({ won: true, milestoneIds: ['triple_double'] }, yesterday, TODAY);
    expect(r.firstWin).toBe(true);
    expect(r.milestoneCoins).toBe(MILESTONES.find(m => m.id === 'triple_double').coins);
  });

  it('caps milestone coins per day, carrying the running total in `daily`', () => {
    // Every milestone at once is worth more than the cap; the cap wins, and the
    // counters it returns are what the next claim is settled against.
    const all = MILESTONES.map(m => m.id);
    const a = settleGameReward({ won: false, milestoneIds: all }, fresh, TODAY);
    expect(a.milestoneCoins).toBe(DAILY_MILESTONE_CAP);
    expect(a.daily.coins).toBe(DAILY_MILESTONE_CAP);
    const b = settleGameReward({ won: false, milestoneIds: all }, a.daily, TODAY);
    expect(b.milestoneCoins).toBe(0);
    expect(b.coins).toBe(REWARD.complete);
  });

  it('ignores milestone ids it does not know, and counts a repeated one once', () => {
    // THE SERVER-SIDE PROPERTY. A claim is client-authored; an invented id or
    // the same id ten times must not be worth anything extra.
    const one = settleGameReward({ won: false, milestoneIds: ['fifty_pts'] }, fresh, TODAY);
    const padded = settleGameReward(
      { won: false, milestoneIds: ['fifty_pts', 'fifty_pts', 'bogus', 'jackpot', 'fifty_pts'] },
      fresh,
      TODAY
    );
    expect(padded.coins).toBe(one.coins);
  });

  it('treats a malformed claim as an empty one rather than throwing', () => {
    const r = settleGameReward({ milestoneIds: 'triple_double' }, undefined, TODAY);
    expect(r.coins).toBe(REWARD.complete);
    expect(r.milestoneCoins).toBe(0);
  });

  it('names the Bam card when the Bam milestone is claimed', () => {
    const r = settleGameReward({ won: false, milestoneIds: [], bam: true }, fresh, TODAY);
    expect(r.bam).toBe(true);
    expect(r.bamCardId).toBe('Bam_Adebayo');
    expect(r.breakdown.some(b => b.special)).toBe(true);
  });
});

describe('the win bonus by the margin (2026-09-11)', () => {
  // THE TUNING SAMPLE: the absolute margins of 100 simulated games between
  // AI-built franchise rosters (simulate.js, seeded). Median 17; a quarter by
  // 30 or more. The curve is tuned so the average win over it still pays ~50.
  const SAMPLE = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 5, 5, 6, 6, 6, 6, 6, 6, 6, 7, 7, 8, 9, 9, 9, 10, 11, 11, 11, 11, 12, 12, 12, 13, 13, 13, 14, 14, 15, 15, 15, 15, 16, 16, 17, 17, 17, 19, 19, 20, 20, 20, 20, 20, 21, 22, 22, 23, 23, 24, 24, 24, 25, 26, 26, 27, 27, 27, 28, 28, 28, 29, 29, 30, 31, 31, 32, 32, 33, 34, 35, 36, 36, 37, 37, 40, 40, 42, 42, 44, 45, 46, 47, 54, 57, 68];
  const settle = claim => settleGameReward({ milestoneIds: [], ...claim }, { date: TODAY, coins: 0, firstWin: true }, TODAY);

  it('pays a squeaker little and a blowout the most, rising in between', () => {
    expect(winBonus(1)).toBe(WIN_BY_MARGIN.min);
    expect(winBonus(WIN_BY_MARGIN.fullAt)).toBe(WIN_BY_MARGIN.max);
    expect(winBonus(90)).toBe(WIN_BY_MARGIN.max);
    for (let m = 1; m < 60; m += 1) expect(winBonus(m + 1)).toBeGreaterThanOrEqual(winBonus(m));
  });

  it('keeps the average win where it was, on the simulated spread of margins', () => {
    const mean = SAMPLE.reduce((t, m) => t + winBonus(m), 0) / SAMPLE.length;
    expect(mean).toBeGreaterThan(REWARD.win - 2);
    expect(mean).toBeLessThan(REWARD.win + 2);
  });

  it('pays PvP half again on the same curve', () => {
    expect(winBonus(17, true)).toBe(Math.round(winBonus(17) * REWARD.pvpWin / REWARD.win));
    expect(settle({ won: true, pvp: true, margin: 50 }).coins).toBe(REWARD.complete + 150);
  });

  it('pays a client that sends no margin the flat bonus it always did', () => {
    expect(settle({ won: true }).coins).toBe(REWARD.complete + REWARD.win);
    expect(settle({ won: true, margin: 'lots' }).coins).toBe(REWARD.complete + REWARD.win);
  });

  it('pays a close loss or a tie a consolation, and nothing for a real loss or a hotseat game', () => {
    expect(settle({ won: false, margin: -3 }).coins).toBe(REWARD.complete + CLOSE_LOSS.coins);
    expect(settle({ won: false, margin: 0 }).breakdown.map(b => b.label)).toContain('Tie Game');
    expect(settle({ won: false, margin: -6 }).coins).toBe(REWARD.complete);
    expect(settle({ won: false, margin: null }).coins).toBe(REWARD.complete);
  });

  it('never pays more than the top of the curve, whatever margin is claimed', () => {
    expect(settle({ won: true, margin: 1e9 }).coins).toBe(REWARD.complete + WIN_BY_MARGIN.max);
    // A "win" claimed with no lead is a one-point win, not a negative bonus.
    expect(settle({ won: true, margin: -40 }).coins).toBe(REWARD.complete + WIN_BY_MARGIN.min);
  });
});

describe('detectMilestones', () => {
  const game = (statsA, statsB = []) => ({ teamA: { stats: statsA }, teamB: { stats: statsB } });

  it("reads only MY team's box score — the coach's triple-double is not my bonus", () => {
    // The user, 2026-09-09: "I got coins for giving up a triple double haha".
    const g = game([{ pts: 20, reb: 4, ast: 3 }], [{ pts: 10, reb: 10, ast: 10 }]);
    expect(detectMilestones(g, 'A').milestoneIds).toEqual([]);
    expect(detectMilestones(g, 'B').milestoneIds).toContain('triple_double');
    expect(detectMilestones(game([{ pts: 10, reb: 10, ast: 10 }]), 'A').milestoneIds).toContain('triple_double');
    expect(detectMilestones(game([{ pts: 83 }], []), 'B').bam).toBe(false);
  });

  it('reads both benches in hotseat, where nobody is "you"', () => {
    expect(detectMilestones(game([{ pts: 10, reb: 10, ast: 10 }]), null).milestoneIds).toContain('triple_double');
    expect(detectMilestones(game([], [{ pts: 50 }])).milestoneIds).toContain('fifty_pts');
  });

  it('finds the Bam milestone separately from the coin ones', () => {
    const r = detectMilestones(game([{ pts: 83 }]));
    expect(r.bam).toBe(true);
    expect(r.milestoneIds).toContain('fifty_pts');
  });

  it('finds nothing in a quiet game', () => {
    expect(detectMilestones(game([{ pts: 20, reb: 4, ast: 3 }]))).toEqual({ milestoneIds: [], bam: false });
  });
});

describe('todayKey', () => {
  it('is the ISO date, which is how the counters have always been keyed', () => {
    expect(todayKey(new Date('2026-09-05T23:59:00Z'))).toBe('2026-09-05');
  });
});
