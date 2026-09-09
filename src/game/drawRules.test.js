// Two draw rules from the 2026-09-09 play-test, and a bug they uncovered:
//   - a card that says "draw" draws past the seven-card cap (Turnover at a
//     full hand drew nothing and logged "drew 2")
//   - a crunch-only card drawn outside Crunch Time goes to the bottom of the
//     deck and the draw continues
//   - four card draws never wrote the deck back, so the drawn cards stayed
//     in the deck too
import { describe, it, expect } from 'vitest';
import { newGame, drawCards, endSection, getPS, getTeam } from './engine.js';
import { execCard } from './execCard.js';
import { STRATS, CRUNCH_CARDS } from './strats.js';

const mk = (id) => ({
  id, name: id, team: 'TST', pos: 'PG', speed: 10, power: 10, defBoost: 0, salary: 500,
  shotLine: 14, paintBoost: 1, threePtBoost: 1, chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
});
const roster = prefix => Array.from({ length: 10 }, (_, i) => mk(`${prefix}${i}`));
const fillers = STRATS.filter(s => !CRUNCH_CARDS.includes(s.id)).map(s => s.id);
const f = i => fillers[i % fillers.length];

describe('drawCards', () => {
  it('the refill stops at seven; a card draw goes past it', () => {
    const hand = [f(0), f(1), f(2), f(3), f(4), f(5), f(6)];
    const deck = [f(7), f(8)];
    expect(drawCards(hand, deck, 1).hand).toHaveLength(7);
    const over = drawCards(hand, deck, 2, { overCap: true });
    expect(over.hand).toHaveLength(9);
    expect(over.deck).toEqual([]);
    expect(over.drawn).toEqual([f(8), f(7)]);
  });

  it('sends a crunch card under outside Crunch Time and keeps drawing; keeps it in crunch', () => {
    const deck = [f(0), 'second_closer', f(1)];          // f(1) is next, then Second Closer, then f(0)
    const out = drawCards([], deck, 2, { crunchActive: false });
    expect(out.hand).toEqual([f(1), f(0)]);
    expect(out.deck).toEqual(['second_closer']);         // at the bottom
    expect(out.bottomed).toEqual(['second_closer']);
    const inCrunch = drawCards([], deck, 2, { crunchActive: true });
    expect(inCrunch.hand).toEqual([f(1), 'second_closer']);
    const unknown = drawCards([], deck, 2);              // no crunch flag: as before
    expect(unknown.hand).toEqual([f(1), 'second_closer']);
  });

  it('does not spin on a deck that is nothing but crunch cards', () => {
    const out = drawCards([], ['reset', 'fresh_legs'], 3, { crunchActive: false });
    expect(out.hand).toEqual([]);
    expect(out.deck.sort()).toEqual(['fresh_legs', 'reset']);
  });
});

describe('the opening deal and the section refill', () => {
  it('never open with a crunch card in hand', () => {
    for (let k = 0; k < 20; k += 1) {
      const g = newGame(roster('a'), roster('b'));
      for (const t of [g.teamA, g.teamB]) expect(t.hand.some(id => CRUNCH_CARDS.includes(id))).toBe(false);
    }
  });

  it('bottom a crunch card drawn into an ordinary section, and say so', () => {
    const g = newGame(roster('a'), roster('b'));
    g.phase = 'scoring';
    g.teamA.starters = g.teamA.roster.slice(0, 5); g.teamB.starters = g.teamB.roster.slice(0, 5);
    g.teamA.hand = [f(0)];
    g.teamA.deck = [f(1), f(2), 'ato_masterpiece', f(3)];   // f(3) next, then ATO, then f(2)...
    const ng = endSection(g);
    expect(ng.teamA.hand).not.toContain('ato_masterpiece');
    expect(ng.teamA.deck[0]).toBe('ato_masterpiece');
    expect(ng.log.some(l => /ATO Masterpiece outside Crunch Time — to the bottom of the deck/.test(l.msg))).toBe(true);
  });
});

describe('a card that draws', () => {
  function turnoverGame() {
    const g = newGame(roster('a'), roster('b'));
    g.phase = 'scoring'; g.scoringTurn = 'A';
    g.teamA.starters = g.teamA.roster.slice(0, 5); g.teamB.starters = g.teamB.roster.slice(0, 5);
    getPS(g, 'B', 'b0').cold = 1;
    g.teamA.hand = ['turnover', f(0), f(1), f(2), f(3), f(4), f(5)];   // seven, full
    g.teamA.deck = [f(6), f(7), f(8)];
    return g;
  }

  it('Turnover draws two past a full hand, takes them OUT of the deck, and logs the truth', () => {
    const g = turnoverGame();
    const r = execCard(g, 'A', 'turnover', {});
    expect(r.ok).toBe(true);
    const t = getTeam(r.game, 'A');
    expect(t.hand).toHaveLength(8);           // seven minus the played card, plus two
    expect(t.hand).toContain(f(8));
    expect(t.hand).toContain(f(7));
    expect(t.deck).toEqual([f(6)]);           // written back — no duplicates
    expect(r.game.log.some(l => l.msg === 'Turnover: drew 2 strategy cards')).toBe(true);
  });

  it('Turnover on a one-card deck says it drew one', () => {
    const g = turnoverGame();
    g.teamA.deck = [f(6)];
    const r = execCard(g, 'A', 'turnover', {});
    expect(r.ok).toBe(true);
    expect(r.game.log.some(l => /Turnover: drew 1 strategy card — the deck ran out/.test(l.msg))).toBe(true);
  });

  it('a card draw outside Crunch Time sends a crunch card under too', () => {
    const g = turnoverGame();
    g.teamA.deck = [f(6), 'unethical_hoops', f(7)];
    const r = execCard(g, 'A', 'turnover', {});
    const t = getTeam(r.game, 'A');
    expect(t.hand).not.toContain('unethical_hoops');
    expect(t.deck).toEqual(['unethical_hoops']);
    expect(r.game.log.some(l => /Unethical Hoops outside Crunch Time/.test(l.msg))).toBe(true);
  });
});
