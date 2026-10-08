// THE TARGET SHOWN BEFORE A CHECK IS THE TARGET IT IS ROLLED AT (2026-10-05).
//
// The user: "I just rolled something that said 13+ and then it comped it
// against a 15 because of the -2 contest." The coach answered the check
// (Drop Coverage, −2) after the 13+ was shown and the die flew at once. The
// banner now prints checkNeedFor, and the roll is taken with checkTerms — one
// rule — so these pin the two against each other, answers and all.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { newGame, getTeam, checkNeed, spendAssist, spendReboundBonus, reboundCheckBonus } from './engine.js';
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

// TWIN TOWERS ON EVERY PAINT CHECK (2026-10-07). The card: "Your opponent takes
// every Paint Check at −2". The 5-assist and 5-rebound paint checks skipped it;
// the user asked for them too. The shown target carries it as well.
describe('Twin Towers on the spend paint checks', () => {
  const towersUp = () => {
    const A = [p('big', { paintBoost: 1 })];
    const B = [p('guard', { defBoost: 1 })];
    const g = game({ A, B });
    g.standing = [{ teamKey: 'B', cardId: 'twin_towers' }];
    return g;
  };

  it('the 5-assist paint check is two harder, and its button says so', () => {
    const g = towersUp();
    getTeam(g, 'A').assists = 6;
    const shown = checkNeed(g, 'A', 0, 'paint').need;
    const without = checkNeed({ ...g, standing: [] }, 'A', 0, 'paint').need;
    expect(shown - without).toBe(2);
    let rolled = null;
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const res = spendAssist(g, 'A', 'paint', 0);
    expect(res.ok).toBe(true);
    const line = res.game.log.at(-1).msg;
    expect(line).toContain('−2 Twin Towers');
    rolled = res.game.lastShotCheck.result;
    expect(rolledAt(rolled)).toBe(shown);
  });

  it('the 5-rebound paint check is two harder, and its button says so', () => {
    const g = towersUp();
    const t = getTeam(g, 'A');
    t.rebounds = 9; t.reboundsWon = 9;
    getTeam(g, 'B').reboundsWon = 0;
    g.reboundBonuses = { A: { paintCheck: true } };
    const shown = checkNeed(g, 'A', 0, 'paint', { extra: reboundCheckBonus(g, 'A'), banked: false }).need;
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const res = spendReboundBonus(g, 'A', 'paint_check', 0);
    expect(res.ok, res.msg).toBe(true);
    expect(res.game.log.some(l => l.msg.includes('−2 Twin Towers'))).toBe(true);
    expect(rolledAt(res.game.lastShotCheck.result)).toBe(shown);
  });

  it('a 3PT spend check and a team without the card standing are untouched', () => {
    const g = towersUp();
    expect(checkNeed(g, 'A', 0, '3pt').need).toBe(checkNeed({ ...g, standing: [] }, 'A', 0, '3pt').need);
    // Twin Towers is the OTHER side's: B's own paint checks are not touched by B's card.
    expect(checkNeed(g, 'B', 0, 'paint').need).toBe(checkNeed({ ...g, standing: [] }, 'B', 0, 'paint').need);
  });
});

// THE GLASS LEAD'S +2 ON A CARD'S PAINT CHECK (the user, 2026-10-08: every
// paint check, not only the 5-REB one). Shown in the target, rolled at it,
// and spent for the section once taken.
describe('the glass lead on a card-called paint check', () => {
  const leading = () => {
    const g = game({ A: [p('big', { paintBoost: 1 })] });
    getTeam(g, 'A').reboundsWon = 8; getTeam(g, 'B').reboundsWon = 5;
    return g;
  };

  it('the target and the roll both carry Glass +2, and it is spent for the section', () => {
    const g = leading();
    const psc = { teamKey: 'A', playerIdx: 0, type: 'paint', bonus: 0, cardLabel: 'test' };
    g.pendingShotCheck = psc;
    const shown = checkNeedFor(g, psc);
    expect(shown.parts).toEqual(expect.arrayContaining([{ label: 'Glass', n: 2 }]));
    const after = structuredClone(g);
    const r = applyShotCheck(after, psc);
    expect(rolledAt(r)).toBe(shown.need);
    expect(r.parts.map(x => x.label)).toContain('Glass');
    expect(checkTerms(after, psc).map(x => x.label)).not.toContain('Glass');
  });

  it('a 3PT check from the same card does not take it, so it is still there for the paint', () => {
    const g = leading();
    const psc = { teamKey: 'A', playerIdx: 0, type: '3pt', bonus: 0, cardLabel: 'test' };
    expect(checkTerms(g, psc).map(x => x.label)).not.toContain('Glass');
    applyShotCheck(g, psc);
    expect(checkTerms(g, { ...psc, type: 'paint' }).map(x => x.label)).toContain('Glass');
  });
});
