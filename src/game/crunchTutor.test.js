// The crunch tutor, the sign-up card, and Crowd Favorite's payout — the three
// 2026-09-07 rules, asserted at the engine seams the way crunch.test.js does.
import { describe, it, expect, vi } from 'vitest';
import { newGame, endSection, getPS, CRUNCH_MARGIN, CROWD_FAVORITE_PTS } from './engine.js';
import { canPlayCard } from './canPlay.js';
import { execCard } from './execCard.js';
import { STRATS, CRUNCH_CARDS } from './strats.js';

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed: 10, power: 10,
  shotLine: 14, paintBoost: 1, threePtBoost: 1, defBoost: 0, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...over,
});
const roster = prefix => Array.from({ length: 10 }, (_, i) => mk(`${prefix}${i}`));
// Any card that is not a crunch card, to pad hands and decks with.
const filler = STRATS.find(s => !CRUNCH_CARDS.includes(s.id)).id;

/** Q4S2, scoring phase, B ahead by `margin`; endSection from here arms (or not). */
function lateGame(margin) {
  const g = newGame(roster('a'), roster('b'));
  g.quarter = 4; g.section = 2; g.phase = 'scoring';
  g.teamA.starters = g.teamA.roster.slice(0, 5);
  g.teamB.starters = g.teamB.roster.slice(0, 5);
  g.teamA.score = 80; g.teamB.score = 80 + margin;
  return g;
}

/** Already inside crunch time. */
function crunchGame(margin = 4) {
  const g = lateGame(margin);
  g.section = 3;
  g.crunch = { active: margin <= CRUNCH_MARGIN, margin, used: {}, extra: {}, timeoutUsed: {} };
  return g;
}

describe('the crunch tutor', () => {
  it('pulls every crunch card from the deck to the hand when crunch arms, over the draw cap', () => {
    const g = lateGame(CRUNCH_MARGIN);
    g.teamA.hand = Array(7).fill(filler);   // a full hand
    g.teamA.deck = [filler, 'fresh_legs', filler, 'reset', 'unethical_hoops', filler];
    g.teamB.hand = [];
    g.teamB.deck = ['second_closer', filler];

    const ng = endSection(g);
    expect(ng.crunch.active).toBe(true);
    expect(ng.teamA.hand).toEqual(expect.arrayContaining(['fresh_legs', 'reset', 'unethical_hoops']));
    expect(ng.teamA.hand.filter(id => CRUNCH_CARDS.includes(id))).toHaveLength(3);
    expect(ng.teamA.deck.some(id => CRUNCH_CARDS.includes(id))).toBe(false);
    expect(ng.teamB.hand).toContain('second_closer');
    expect(ng.log.some(l => l.team === 'A' && /Crunch Time: .* draws .*fresh legs/.test(l.msg))).toBe(true);
  });

  it('leaves them in the deck on a blowout', () => {
    const g = lateGame(CRUNCH_MARGIN + 1);
    g.teamA.hand = [filler];
    // The section's ordinary draw-to-seven pops from the END of the deck, so
    // the crunch cards sit at the front where only the tutor could reach them.
    g.teamA.deck = ['fresh_legs', 'reset', ...Array(10).fill(filler)];
    const ng = endSection(g);
    expect(ng.crunch.active).toBe(false);
    expect(ng.teamA.deck).toEqual(expect.arrayContaining(['fresh_legs', 'reset']));
    expect(ng.teamA.hand).not.toContain('fresh_legs');
    expect(ng.teamA.hand).not.toContain('reset');
  });

  it('is the one list every reader shares', () => {
    expect(CRUNCH_CARDS).toContain('unethical_hoops');
    for (const id of CRUNCH_CARDS) expect(STRATS.some(s => s.id === id)).toBe(true);
  });
});

describe('Unethical Hoops', () => {
  it('is crunch-only and needs a Speed or Power advantage', () => {
    const g = crunchGame();
    // Identity matchups, everyone 10/10: no edge anywhere.
    expect(canPlayCard(g, 'A', 'unethical_hoops').canPlay).toBe(false);
    g.teamA.starters[0].speed = 13;
    expect(canPlayCard(g, 'A', 'unethical_hoops').canPlay).toBe(true);
    g.crunch.active = false;
    expect(canPlayCard(g, 'A', 'unethical_hoops').canPlay).toBe(false);
  });

  it('is two free throws at +4 for the chosen player, and they reach the box score', () => {
    const g = crunchGame();
    g.teamA.starters[0].speed = 13;
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.99); // a 20, twice
    const { game: g2, ok } = execCard(g, 'A', 'unethical_hoops', { playerIdx: 0 });
    spy.mockRestore();
    expect(ok).toBe(true);
    expect(g2.teamA.score - g.teamA.score).toBe(2);
    expect(getPS(g2, 'A', 'a0').pts).toBe(2);
    const lines = g2.log.filter(l => /Unethical Hoops/.test(l.msg));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.some(l => /second free throw/.test(l.msg))).toBe(true);
    expect(lines.some(l => /\+4/.test(l.msg))).toBe(true);
  });

  it('refuses a player with no edge', () => {
    const g = crunchGame();
    g.teamA.starters[1].power = 13;   // the edge is on slot 1, not slot 0
    expect(execCard(g, 'A', 'unethical_hoops', { playerIdx: 0 }).ok).toBe(false);
    expect(execCard(g, 'A', 'unethical_hoops', { playerIdx: 1 }).ok).toBe(true);
  });

  it('is a promo: in the registry, in no pack pool', () => {
    const card = STRATS.find(s => s.id === 'unethical_hoops');
    expect(card.promo).toBe(true);
  });
});

describe('Crowd Favorite', () => {
  function midGame() {
    const g = newGame(roster('a'), roster('b'));
    g.quarter = 2; g.section = 1; g.phase = 'scoring';
    g.teamA.starters = g.teamA.roster.slice(0, 5);
    g.teamB.starters = g.teamB.roster.slice(0, 5);
    g.teamA.starters[0].salary = 300;
    return g;
  }

  it('pays a hot marker at the bar, counting only points since it was played', () => {
    const g = midGame();
    getPS(g, 'A', 'a0').pts = 9;   // earlier points do not count
    const { game: g2, ok } = execCard(g, 'A', 'crowd_favorite', { playerIdx: 0 });
    expect(ok).toBe(true);
    expect(g2.tempEff.A.crowd_0).toEqual({ at: 9 });
    // A roll or a shot check — both land in ps.pts.
    getPS(g2, 'A', 'a0').pts += CROWD_FAVORITE_PTS;
    const ng = endSection(g2);
    expect(getPS(ng, 'A', 'a0').hot).toBe(1);
    expect(ng.log.some(l => /Crowd Favorite: a0 scored 2 this section → hot marker/.test(l.msg))).toBe(true);
    expect(ng.tempEff.A?.crowd_0).toBeUndefined();   // cleared with the section
  });

  it('pays nothing under the bar', () => {
    const g = midGame();
    const { game: g2 } = execCard(g, 'A', 'crowd_favorite', { playerIdx: 0 });
    getPS(g2, 'A', 'a0').pts += CROWD_FAVORITE_PTS - 1;
    const ng = endSection(g2);
    expect(getPS(ng, 'A', 'a0').hot || 0).toBe(0);
    expect(ng.log.some(l => /Crowd Favorite: a0 scored 1 this section — no marker/.test(l.msg))).toBe(true);
  });
});
