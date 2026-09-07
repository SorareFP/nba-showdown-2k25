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

describe('detectMilestones', () => {
  const game = (statsA, statsB = []) => ({ teamA: { stats: statsA }, teamB: { stats: statsB } });

  it('reads the box score of either team', () => {
    expect(detectMilestones(game([{ pts: 10, reb: 10, ast: 10 }])).milestoneIds).toContain('triple_double');
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
