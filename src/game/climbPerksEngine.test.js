// THE CLIMB'S GAME-LONG PERKS IN THE ENGINE (2026-10-22, docs/plans/
// 2026-10-22-the-climb-perks-draft.md; the user: "All these perks are awesome
// by the way!"). A run sends them as gameOpts.perks; the engine reads them
// through hasGamePerk: Scouting Report and Short Rotation deal more cards,
// Fast Start, Closers and Heavy Minutes move the scoring roll, Heavy Minutes
// adds a minute a section, Short Rotation caps the cards a section, Ball
// Movement Culture draws on every fifth card, Rim Deterrent meets the first
// paint check.
import { describe, it, expect } from 'vitest';
import {
  newGame, getTeam, getPS, doRoll, endSection, scoringRollModifier, perkRollBonus, openingHand,
  playCapProblem, climbCheckParts, spendGlass, SHORT_ROTATION_PLAYS, RIM_DETERRENT_LABEL,
} from './engine.js';
import { canPlayCard } from './canPlay.js';
import { execCard } from './execCard.js';
import { checkNeedFor } from './checkTerms.js';

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed: 10, power: 10, defBoost: 0, salary: 500,
  shotLine: 14, paintBoost: 1, threePtBoost: 1,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...over,
});
const roster = p => Array.from({ length: 10 }, (_, i) => mk(`${p}${i}`));

/** A Climb game's scoring phase with Team A holding `perks`, in Q4's first section. */
function scoring(perks = [], { hand = [] } = {}) {
  const g = newGame(roster('a'), roster('b'), undefined, undefined, { startQuarter: 4, perks: { A: perks } });
  for (const k of ['A', 'B']) getTeam(g, k).starters = getTeam(g, k).roster.slice(0, 5);
  getTeam(g, 'A').hand = hand;
  g.phase = 'scoring'; g.scoringTurn = 'A'; g.scoringPasses = 0; g.placementStep = 10;
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.tempEff = { A: {}, B: {} };
  g.rollResults = { A: [], B: [] };
  return g;
}

describe('the opening hand', () => {
  it('is seven, eight with Scouting Report or Short Rotation, nine with both', () => {
    expect(openingHand([])).toBe(7);
    expect(openingHand(['scouting_report'])).toBe(8);
    expect(openingHand(['scouting_report', 'short_rotation'])).toBe(9);
    const g = newGame(roster('a'), roster('b'), undefined, undefined, { perks: { A: ['scouting_report'] } });
    expect(g.teamA.hand).toHaveLength(8);
    expect(g.teamB.hand).toHaveLength(7);
  });
});

describe('the scoring roll', () => {
  it('Fast Start is +1 in the game\'s first section only', () => {
    const g = scoring(['fast_start']);
    expect(perkRollBonus(g, 'A')).toBe(1);
    expect(perkRollBonus(g, 'B')).toBe(0);
    expect(perkRollBonus({ ...g, section: 2 }, 'A')).toBe(0);
  });

  it('Closers is +1 in Crunch Time only; Heavy Minutes always', () => {
    const g = scoring(['closers']);
    expect(perkRollBonus(g, 'A')).toBe(0);
    expect(perkRollBonus({ ...g, crunch: { active: true } }, 'A')).toBe(1);
    expect(perkRollBonus(scoring(['heavy_minutes']), 'A')).toBe(1);
  });

  it('rides on the die doRoll throws and on the modifier the board shows', () => {
    const g = scoring(['heavy_minutes', 'fast_start']);
    const plain = scoring([]);
    expect(scoringRollModifier(g, 'A', 0).perk).toBe(2);
    expect(scoringRollModifier(g, 'A', 0).total).toBe(scoringRollModifier(plain, 'A', 0).total + 2);
    const rolled = doRoll(g, 'A', 0);
    const base = doRoll(plain, 'A', 0);
    expect(rolled.rollResults.A[0].bonus).toBe(base.rollResults.A[0].bonus + 2);
  });
});

describe('the section\'s end', () => {
  it('Heavy Minutes adds a minute to every starter; Short Rotation draws one more', () => {
    const g = scoring(['heavy_minutes', 'short_rotation']);
    getTeam(g, 'A').hand = [];
    getTeam(g, 'A').deck = Array.from({ length: 20 }, () => 'first_step');
    getTeam(g, 'B').hand = [];
    getTeam(g, 'B').deck = Array.from({ length: 20 }, () => 'first_step');
    const next = endSection(g);
    expect(getPS(next, 'A', 'a0').minutes).toBe(5);
    expect(getPS(next, 'B', 'b0').minutes).toBe(4);
    expect(next.teamA.hand).toHaveLength(8);
    expect(next.teamB.hand).toHaveLength(7);
  });
});

describe('cards played', () => {
  const hot = g => { getPS(g, 'A', 'a0').hot = 1; return g; };

  it('Short Rotation: a third card in a section is refused, by the board and the engine', () => {
    const g = hot(scoring(['short_rotation'], { hand: ['feeling_it'] }));
    getTeam(g, 'A').deck = ['first_step', 'power_move', 'and_one'];
    expect(canPlayCard(g, 'A', 'feeling_it').canPlay).toBe(true);
    g.played = { A: SHORT_ROTATION_PLAYS };
    expect(playCapProblem(g, 'A')).toMatch(/Short Rotation/);
    expect(canPlayCard(g, 'A', 'feeling_it').canPlay).toBe(false);
    expect(execCard(g, 'A', 'feeling_it', {}).ok).toBe(false);
    // A new section clears the count.
    expect(endSection(g).played).toEqual({});
  });

  it('counts each play, and Ball Movement Culture draws on the fifth', () => {
    const g = hot(scoring(['ball_movement_culture'], { hand: ['feeling_it'] }));
    getTeam(g, 'A').deck = ['first_step', 'power_move', 'and_one', 'rimshaker'];
    g.playedGame = { A: 4 };
    const r = execCard(g, 'A', 'feeling_it', {});
    expect(r.ok, r.msg).toBe(true);
    expect(r.game.played.A).toBe(1);
    expect(r.game.playedGame.A).toBe(5);
    // Feeling It's two, and one for the fifth card.
    expect(getTeam(r.game, 'A').hand).toHaveLength(3);
    expect(r.game.log.some(l => /Ball Movement Culture/.test(l.msg))).toBe(true);
  });
});

describe('Rim Deterrent', () => {
  it('puts −3 on the first paint check against you each game, then is spent', () => {
    const g = scoring(['rim_deterrent']);
    expect(climbCheckParts(g, 'B', 'paint', 0)).toContainEqual({ label: RIM_DETERRENT_LABEL, n: -3 });
    expect(climbCheckParts(g, 'B', '3pt', 0).some(p => p.label === RIM_DETERRENT_LABEL)).toBe(false);
    expect(climbCheckParts(g, 'A', 'paint', 0).some(p => p.label === RIM_DETERRENT_LABEL)).toBe(false);
    // The banner's need reads the same term.
    const need = checkNeedFor(g, { teamKey: 'B', playerIdx: 0, type: 'paint', bonus: 0 });
    expect(need.parts).toContainEqual({ label: RIM_DETERRENT_LABEL, n: -3 });
    spendGlass(g, 'B', climbCheckParts(g, 'B', 'paint', 0));
    expect(g.rimDeterred).toEqual({ A: true });
    expect(climbCheckParts(g, 'B', 'paint', 0).some(p => p.label === RIM_DETERRENT_LABEL)).toBe(false);
  });
});
