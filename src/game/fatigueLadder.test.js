// Fatigue keeps climbing past sixteen minutes. It used to stop at −12, so a
// star at 20 minutes was no worse than at 16 and the AI's lookahead saw no
// cost in one more section — Giannis played a whole half (the user,
// 2026-09-09). Now every section past 16 is another −6, and the lineup pick
// sees it.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam, fatigueForMinutes, FATIGUE_STEP_PAST_16, getFatigue } from './engine.js';
import { lineupValue, aiDraftPick } from './ai.js';
import { CARDS } from './cards.js';

describe('the fatigue ladder', () => {
  it('is 0 / −2 / −6 / −12 to sixteen minutes, then −6 more per section without end', () => {
    expect([0, 4, 7].map(fatigueForMinutes)).toEqual([0, 0, 0]);
    expect([8, 11].map(fatigueForMinutes)).toEqual([-2, -2]);
    expect([12, 15].map(fatigueForMinutes)).toEqual([-6, -6]);
    expect(fatigueForMinutes(16)).toBe(-12);
    expect(fatigueForMinutes(20)).toBe(-12 - FATIGUE_STEP_PAST_16);
    expect(fatigueForMinutes(24)).toBe(-12 - 2 * FATIGUE_STEP_PAST_16);
    expect(fatigueForMinutes(28)).toBe(-12 - 3 * FATIGUE_STEP_PAST_16);
    for (let m = 16; m < 60; m += 4) expect(fatigueForMinutes(m + 4)).toBeLessThan(fatigueForMinutes(m));
  });

  it('the roll reads the same ladder', () => {
    const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20));
    getTeam(g, 'A').starters = getTeam(g, 'A').roster.slice(0, 5);
    const ps = getTeam(g, 'A').stats.find(s => s.id === getTeam(g, 'A').starters[0].id);
    ps.minutes = 20;
    expect(getFatigue(g, 'A', 0)).toBe(-18);
  });

  it('a star at twenty minutes is worth less to the lineup pick than he was at sixteen, and a fresh body can pass him', () => {
    // The steepest chart in the set, played into the ground.
    const star = [...CARDS].sort((a, b) => b.salary - a.salary)[0];
    const at = min => lineupValue(star, { minutes: min, hot: 0, cold: 0 });
    expect(at(20)).toBeLessThan(at(16));
    expect(at(24)).toBeLessThan(at(20));
    // A cheap fresh player: somewhere on the way down the star falls below him.
    const body = [...CARDS].sort((a, b) => a.salary - b.salary).find(c => c.salary >= 200);
    const freshBody = lineupValue(body, { minutes: 0, hot: 0, cold: 0 });
    expect([16, 20, 24, 28].some(m => at(m) < freshBody)).toBe(true);
  });

  it('the AI sits a player who has played the whole half', () => {
    const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20));
    // Everyone fresh except the best card, who has played 24 straight minutes.
    const best = [...getTeam(g, 'B').roster].sort((a, b) => b.salary - a.salary)[0];
    getTeam(g, 'B').stats.find(s => s.id === best.id).minutes = 24;
    g.phase = 'draft';
    const picks = [];
    for (let i = 0; i < 5; i += 1) {
      const a = aiDraftPick(g, 'B');
      picks.push(a.playerId);
      g.draft.bPool = g.draft.bPool.filter(p => p.id !== a.playerId);
    }
    expect(picks).not.toContain(best.id);
  });
});
