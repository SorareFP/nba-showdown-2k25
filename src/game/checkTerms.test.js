// THE TARGET SHOWN BEFORE A CHECK IS THE TARGET IT IS ROLLED AT (2026-10-05).
//
// The user: "I just rolled something that said 13+ and then it comped it
// against a 15 because of the -2 contest." The coach answered the check
// (Drop Coverage, −2) after the 13+ was shown and the die flew at once. The
// banner now prints checkNeedFor, and the roll is taken with checkTerms — one
// rule — so these pin the two against each other, answers and all.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { newGame, getTeam } from './engine.js';
import { CARDS } from './cards.js';
import { execCard, applyShotCheck } from './execCard.js';
import { checkTerms, checkNeedFor } from './checkTerms.js';

const p = (name, over = {}) => ({
  ...CARDS[0], id: name, name, speed: 10, power: 10, defBoost: 0, salary: 500,
  threePtBoost: 0, paintBoost: 0, shotLine: 15, pos: 'F', ...over,
});
function game({ A = [], B = [] } = {}) {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  getTeam(g, 'A').starters = [0, 1, 2, 3, 4].map(i => A[i] ?? p(`a${i}`));
  getTeam(g, 'B').starters = [0, 1, 2, 3, 4].map(i => B[i] ?? p(`b${i}`));
  for (const k of ['A', 'B']) {
    for (const s of getTeam(g, k).starters) getTeam(g, k).stats.push({ id: s.id, pts: 0, reb: 0, ast: 0, minutes: 0 });
    getTeam(g, k).hand = [];
  }
  g.phase = 'scoring';
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.rollResults = { A: [], B: [] };
  g.tempEff = {}; g.tempDefEff = {};
  return g;
}
/** The target the roll was actually taken at: the line less every term shotCheck summed. */
const rolledAt = r => r.line - (r.total - r.die);
afterEach(() => vi.restoreAllMocks());

describe('the shown target is the rolled target', () => {
  it('the user\'s case: a +2 Paint shooter on line 15 needs 13+, and 15+ once Drop Coverage answers', () => {
    const A = [p('shooter', { paintBoost: 2 })];
    const B = [p('drop', { defBoost: 1 })];
    const g = game({ A, B });
    g.pendingShotCheck = { teamKey: 'A', playerIdx: 0, type: 'paint', bonus: 1, cardLabel: 'Test' };
    // Before the answer: card +1, Paint +2, the defender's own contest −1.
    expect(checkNeedFor(g, g.pendingShotCheck).need).toBe(13);
    getTeam(g, 'B').hand = ['drop_coverage'];
    const answered = execCard(g, 'B', 'drop_coverage', {});
    expect(answered.ok).toBe(true);
    const psc = answered.game.pendingShotCheck;
    expect(checkNeedFor(answered.game, psc).need).toBe(15);
    const r = applyShotCheck(structuredClone(answered.game), psc);
    expect(rolledAt(r)).toBe(15);
    // The log names what moved it, not one lumped "card" number.
    expect(r.parts.map(x => x.label)).toEqual(expect.arrayContaining(['card', 'Drop Coverage', 'contest (drop)', 'Paint']));
  });

  it('agrees term for term over every answer and standing card that moves a check', () => {
    const cases = [
      { label: 'plain 3PT', psc: { type: '3pt', bonus: 2 } },
      { label: 'Close Out', psc: { type: '3pt', bonus: 2, closeOutBonus: -3, reacted: 'B' } },
      { label: 'Smothering Defense', psc: { type: '3pt', bonus: 2, smother: 3, reacted: 'B' } },
      { label: 'Rim Protector', psc: { type: 'paint', bonus: 1, contest: -4, contestBy: 'Rim Protector', reacted: 'B' } },
      { label: 'Hustle Play', psc: { type: '3pt', bonus: 0, contest: -2, contestBy: 'Hustle Play (x)', reacted: 'B' } },
      { label: 'Denial, no assists to pay', psc: { type: 'paint', bonus: 2, denial: true, reacted: 'B' }, assists: 0 },
      { label: 'Denial, assists paid', psc: { type: 'paint', bonus: 2, denial: true, reacted: 'B' }, assists: 4 },
      { label: 'Twin Towers', psc: { type: 'paint', bonus: 0 }, towers: true },
      { label: 'a free throw', psc: { type: 'ft', bonus: 0 } },
    ];
    for (const c of cases) {
      const A = [p('shooter', { threePtBoost: 1, paintBoost: -1 })];
      const B = [p('guard', { defBoost: 2 })];
      const g = game({ A, B });
      getTeam(g, 'A').assists = c.assists ?? 0;
      if (c.towers) g.standing = [{ teamKey: 'B', cardId: 'twin_towers' }];
      const psc = { teamKey: 'A', playerIdx: 0, cardLabel: c.label, ...c.psc };
      g.pendingShotCheck = psc;
      const shown = checkNeedFor(g, psc).need;
      const r = applyShotCheck(structuredClone(g), psc);
      expect(rolledAt(r), c.label).toBe(shown);
    }
  });

  it('a Blitz asks the same question of each other shooter: his own defender, his own bonus', () => {
    const A = [p('a0'), p('sniper', { threePtBoost: 3 })];
    const B = [p('b0'), p('wall', { defBoost: 3 })];
    const g = game({ A, B });
    const psc = { teamKey: 'A', playerIdx: 0, type: '3pt', bonus: 2, cardLabel: 'Test' };
    // Slot 1: card +2, 3PT +3, the wall's contest −3: 15 - 2 = 13.
    expect(checkNeedFor(g, psc, 1).need).toBe(13);
    expect(checkTerms(g, psc, 1).find(t => t.label.startsWith('contest'))).toMatchObject({ n: -3 });
  });
});
