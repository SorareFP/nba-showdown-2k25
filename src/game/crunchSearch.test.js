// THE TIMEOUT SEARCH replaces the crunch tutor. The user (2026-09-09): "I
// don't think every crunch-time card should go to the player's hand in
// crunch-time. I think maybe Timeouts allow you to search for one CT card
// (then shuffle your undrawn deck)." So: crunch arms and the deck stays as
// it is; a called timeout lets that team take ONE crunch-only card from its
// deck into hand, and the deck is shuffled behind it.
import { describe, it, expect, vi } from 'vitest';
import { newGame, endSection, spendTimeout, searchCrunchCard, crunchSearchOptions, CRUNCH_MARGIN } from './engine.js';
import { STRATS, CRUNCH_CARDS } from './strats.js';
import { aiCrunchSearch, aiCrunchDecision } from './ai.js';
import { simulateGame } from './modes/simulate.js';
import { CARDS } from './cards.js';

const mk = (id) => ({
  id, name: id, team: 'TST', pos: 'PG', speed: 10, power: 10, defBoost: 0, salary: 500,
  shotLine: 14, paintBoost: 1, threePtBoost: 1, chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
});
const roster = prefix => Array.from({ length: 10 }, (_, i) => mk(`${prefix}${i}`));
const filler = STRATS.find(s => !CRUNCH_CARDS.includes(s.id)).id;

function lateGame(margin = 4) {
  const g = newGame(roster('a'), roster('b'));
  g.quarter = 4; g.section = 2; g.phase = 'scoring';
  g.teamA.starters = g.teamA.roster.slice(0, 5);
  g.teamB.starters = g.teamB.roster.slice(0, 5);
  g.teamA.score = 80; g.teamB.score = 80 + margin;
  return g;
}
/** Inside crunch, rolling open, A's deck holding two crunch cards under fillers. */
function crunch() {
  const g = lateGame();
  g.section = 3;
  g.crunch = { active: true, margin: 4, used: {}, extra: {}, timeoutUsed: {} };
  g.scoringPasses = 99;
  g.teamA.hand = [filler, filler];
  g.teamA.deck = ['fresh_legs', filler, filler, 'ato_masterpiece', filler, 'unethical_hoops', filler];
  g.teamB.hand = [filler];
  g.teamB.deck = [filler, 'second_closer'];
  return g;
}

describe('crunch arming', () => {
  it('leaves the deck alone — no card comes to hand on its own', () => {
    const g = lateGame(CRUNCH_MARGIN);
    g.teamA.hand = Array(7).fill(filler);
    g.teamA.deck = [filler, 'fresh_legs', filler, 'reset', 'unethical_hoops', filler];
    const ng = endSection(g);
    expect(ng.crunch.active).toBe(true);
    expect(ng.teamA.hand.filter(id => CRUNCH_CARDS.includes(id))).toHaveLength(0);
    expect(ng.teamA.deck.filter(id => CRUNCH_CARDS.includes(id))).toHaveLength(3);
    expect(ng.log.some(l => /draws .* from the deck/.test(l.msg))).toBe(false);
  });
});

describe('the timeout search', () => {
  it('lists the crunch cards in the deck, once each, during your own timeout only', () => {
    const g = crunch();
    g.teamA.deck.push('fresh_legs');
    expect(crunchSearchOptions(g, 'A')).toEqual([]);                          // no timeout yet
    const to = spendTimeout(g, 'A').game;
    expect(crunchSearchOptions(to, 'A').sort()).toEqual(['ato_masterpiece', 'fresh_legs', 'unethical_hoops']);
    expect(crunchSearchOptions(to, 'B')).toEqual([]);                         // A's timeout, not B's
    expect(crunchSearchOptions(spendTimeout(g, 'B').game, 'B')).toEqual(['second_closer']);
  });

  it('needs your own timeout, takes one card to hand, shuffles the rest, and is once per timeout', () => {
    const g = crunch();
    expect(searchCrunchCard(g, 'A', 'fresh_legs').ok).toBe(false);          // no timeout yet
    const to = spendTimeout(g, 'A');
    expect(to.ok).toBe(true);
    expect(searchCrunchCard(to.game, 'B', 'second_closer').ok).toBe(false); // not B's timeout
    expect(searchCrunchCard(to.game, 'A', filler).ok).toBe(false);          // not a crunch card
    expect(searchCrunchCard(to.game, 'A', 'reset').ok).toBe(false);         // not in the deck
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.42);
    const r = searchCrunchCard(to.game, 'A', 'ato_masterpiece');
    spy.mockRestore();
    expect(r.ok).toBe(true);
    expect(r.game.teamA.hand).toContain('ato_masterpiece');
    expect(r.game.teamA.hand).toHaveLength(3);
    // The deck lost exactly that card and nothing else.
    const before = [...to.game.teamA.deck].sort();
    before.splice(before.indexOf('ato_masterpiece'), 1);
    expect([...r.game.teamA.deck].sort()).toEqual(before);
    expect(r.game.log.some(l => /searched the deck for ATO Masterpiece — deck shuffled/.test(l.msg))).toBe(true);
    // One search per timeout.
    expect(searchCrunchCard(r.game, 'A', 'fresh_legs').ok).toBe(false);
    expect(crunchSearchOptions(r.game, 'A')).toEqual([]);
  });

  it('is worth a timeout to the AI, which takes the card the window values most and plays it', () => {
    const g = crunch();
    g.teamA.score = 84; g.teamB.score = 80;          // A leads: the old brain would not have called it
    expect(aiCrunchDecision(g, 'A')).toEqual({ type: 'timeout' });
    const to = spendTimeout(g, 'A').game;
    const pick = aiCrunchSearch(to, 'A');
    expect(['ato_masterpiece', 'fresh_legs', 'unethical_hoops']).toContain(pick);
    expect(aiCrunchSearch(spendTimeout(crunch(), 'B').game, 'A')).toBeNull();   // not A's timeout
    // Nothing to search for, nothing else to do: no timeout.
    const bare = crunch();
    bare.teamA.deck = [filler, filler]; bare.teamA.score = 84;
    expect(aiCrunchDecision(bare, 'A')).toBeNull();
  });

  it('the simulator plays whole games under the rule', () => {
    const seeded = (s = 77) => () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const r = simulateGame(CARDS.slice(0, 10), CARDS.slice(10, 20), { rng: seeded(), keepGame: true });
    expect(r.scoreA + r.scoreB).toBeGreaterThan(0);
    expect(r.game.done).toBe(true);
  });
});
