// TIRED LEGS MISS SHOTS TOO (2026-09-16, a trial the user asked for): the
// fatigue tracker's penalty rides on a 3PT or paint check as it rides on the
// scoring roll. The rules pages had said "rolls and checks alike" since
// 2026-09-07; the dice had not. Free throws are exempt, and the coach's
// estimate of a check (checkNeed) carries the same term, so its judgement of
// a tired shooter's check matches what the die will face.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam, getPS, shotCheck, checkNeed } from './engine.js';
import { CARDS } from './cards.js';

function board() {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20));
  getTeam(g, 'A').starters = getTeam(g, 'A').roster.slice(0, 5);
  getTeam(g, 'B').starters = getTeam(g, 'B').roster.slice(0, 5);
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  return g;
}

describe('tired legs miss shots too', () => {
  it('rides the tracker penalty on a 3PT or paint check, labelled, and leaves free throws alone', () => {
    const g = board();
    const p = getTeam(g, 'A').starters[0];
    const ps = { ...getPS(g, 'A', p.id), minutes: 12, hot: 0, cold: 0 };
    const r = shotCheck(p, '3pt', 0, ps);
    expect(r.parts.find(x => x.label === 'FAT')?.n).toBe(-6);
    expect(r.bonus).toBe((p.threePtBoost || 0) - 6);
    expect(shotCheck(p, 'paint', 0, ps).parts.find(x => x.label === 'FAT')?.n).toBe(-6);
    expect(shotCheck(p, 'ft', 0, ps).parts.some(x => x.label === 'FAT')).toBe(false);
    // Under eight minutes there is no penalty to carry.
    expect(shotCheck(p, '3pt', 0, { ...ps, minutes: 4 }).parts.some(x => x.label === 'FAT')).toBe(false);
    // A caller with the game passes getFatigue — Second Wind's exemption arrives as 0 and wins.
    expect(shotCheck(p, '3pt', 0, ps, 0).parts.some(x => x.label === 'FAT')).toBe(false);
  });

  it('and the coach sees the number the die will face (checkNeed), Second Wind included', () => {
    const g = board();
    const p = getTeam(g, 'A').starters[0];
    const fresh3 = checkNeed(g, 'A', 0, '3pt');
    const freshP = checkNeed(g, 'A', 0, 'paint');
    getPS(g, 'A', p.id).minutes = 12;
    expect(checkNeed(g, 'A', 0, '3pt')).toMatchObject({ need: fresh3.need + 6, bonus: fresh3.bonus - 6 });
    expect(checkNeed(g, 'A', 0, 'paint')).toMatchObject({ need: freshP.need + 6, bonus: freshP.bonus - 6 });
    g.ignFatigue = { A_0: true };                       // Second Wind on him this segment
    expect(checkNeed(g, 'A', 0, '3pt')).toMatchObject({ need: fresh3.need, bonus: fresh3.bonus });
  });
});
