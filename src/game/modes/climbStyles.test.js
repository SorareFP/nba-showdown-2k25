// THE COACHES' STYLES (2026-10-25, docs/plans/2026-10-25-the-climb-events-and-
// styles-draft.md; the user: "Those work"). A strength and a hole each, on
// every franchise, shown on the map; Act I's Games play the hole only; a boss
// at Full Strength doubles the strength and grows the act's reward.
import { describe, it, expect } from 'vitest';
import { STYLES, STYLE_IDS, FRANCHISE_STYLE, styleAt, styledCard, engineFx, styleLine } from './climbStyles.js';
import { franchisePool, classicFranchises } from './aiTeams.js';
import { newRun, chooseCamp, chooseStop, presetFor, recordResult, continueClimb, stopOpponent, fullStrengthOffered, gameSetup } from './run.js';
import { newGame, getTeam, getPS, doRoll, endSection, scoringRollModifier, styleRollBonus, climbCheckParts } from '../engine.js';
import { CARDS } from '../cards.js';
import { cardKey, getCardByKey } from '../cardSets.js';
import { generateMap } from './climbMap.js';

const FIVE = [...CARDS].sort((a, b) => a.salary - b.salary || a.id.localeCompare(b.id)).slice(100, 105);
function camped() {
  const r = newRun({ id: 'r1', seed: 42, rung: 'prince', rosterKeys: FIVE.map(cardKey), now: 1 });
  return { ...chooseCamp(r, { playbook: 'speed', boon: r.camp.boons.find(b => b !== 'cut_two') }), dropOdds: { player: -1, perk: -1 } };
}

describe('the styles', () => {
  it('give every franchise in play one, three to a style, each a strength and a hole', () => {
    for (const f of franchisePool()) expect(FRANCHISE_STYLE[f.abbr], f.abbr).toBeTruthy();
    for (const abbr of classicFranchises({ cap: 4800, size: 8 })) expect(FRANCHISE_STYLE[abbr], abbr).toBeTruthy();
    expect(STYLE_IDS).toHaveLength(10);
    for (const id of STYLE_IDS) {
      expect(Object.values(FRANCHISE_STYLE).filter(s => s === id), id).toHaveLength(3);
      expect(Object.keys(STYLES[id].fx.strength).length, id).toBeGreaterThan(0);
      expect(Object.keys(STYLES[id].fx.hole).length, id).toBeGreaterThan(0);
    }
  });

  it('play the hole only in an Act I Game, both halves elsewhere, the strength doubled at Full Strength', () => {
    expect(styleAt('PHX', { act: 1, kind: 'game' })).toEqual({ id: 'seven_seconds', level: 'hole', fx: { minutes: 1 } });
    expect(styleAt('PHX', { act: 1, kind: 'rivalry' }).fx).toEqual({ minutes: 1, firstRoll: 1 });
    expect(styleAt('PHX', { act: 2, kind: 'game' }).fx).toEqual({ minutes: 1, firstRoll: 1 });
    expect(styleAt('CHI', { act: 1, kind: 'boss', full: true })).toEqual({ id: 'closers', level: 'full', fx: { firstRoll: -1, crunchRoll: 2 } });
    expect(styleAt('TOR', { act: 2, kind: 'game', full: true }).fx.fullRest).toBe(true);
    expect(styleAt('XXX')).toBeNull();
    expect(styleLine(styleAt('PHX', { act: 1, kind: 'game' }))).toMatch(/hole only/);
  });

  it('move the coach\'s cards on copies, and hand the engine the rest', () => {
    const card = { id: 'x', speed: 10, power: 0, defBoost: 1 };
    const fx = styleAt('CHA', { act: 2 }).fx;
    expect(styledCard(card, fx)).toMatchObject({ speed: 11, power: 0 });   // never below 0
    expect(card.speed).toBe(10);
    expect(engineFx(fx)).toBeNull();
    expect(engineFx({ speed: 1, threes: 1 })).toEqual({ threes: 1 });
  });
});

const mk = (id, over = {}) => ({ id, name: id, team: 'TST', pos: 'PG', speed: 10, power: 10, defBoost: 0, salary: 500, shotLine: 14, paintBoost: 1, threePtBoost: 1, chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }], ...over });
const roster = p => Array.from({ length: 10 }, (_, i) => mk(`${p}${i}`, i === 2 ? { salary: 900 } : {}));
function scoring(style) {
  const g = newGame(roster('a'), roster('b'), undefined, undefined, { startQuarter: 4, style: { B: style } });
  for (const k of ['A', 'B']) getTeam(g, k).starters = getTeam(g, k).roster.slice(0, 5);
  g.phase = 'scoring'; g.scoringTurn = 'B'; g.placementStep = 10;
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.tempEff = { A: {}, B: {} }; g.rollResults = { A: [], B: [] };
  return g;
}

describe('a style in the game', () => {
  it('moves the rolls: the first section, Crunch Time, the star and the rest', () => {
    expect(styleRollBonus(scoring({ firstRoll: 1 }), 'B', 0)).toBe(1);
    expect(styleRollBonus({ ...scoring({ firstRoll: 1 }), section: 2 }, 'B', 0)).toBe(0);
    expect(styleRollBonus({ ...scoring({ crunchRoll: 2 }), crunch: { active: true } }, 'B', 0)).toBe(2);
    const helio = scoring({ star: 2, others: -1 });
    expect(styleRollBonus(helio, 'B', 2)).toBe(2);    // b2 is paid the most
    expect(styleRollBonus(helio, 'B', 0)).toBe(-1);
    expect(styleRollBonus(helio, 'A', 2)).toBe(0);    // never the other side
    expect(scoringRollModifier(helio, 'B', 2).style).toBe(2);
    expect(doRoll(helio, 'B', 2).rollResults.B[2].bonus - doRoll(scoring({}), 'B', 2).rollResults.B[2].bonus).toBe(2);
  });

  it('moves the checks: its own threes and paint, and the paint checks against it', () => {
    expect(climbCheckParts(scoring({ threes: 1 }), 'B', '3pt', 0)).toContainEqual({ label: 'Their style', n: 1 });
    expect(climbCheckParts(scoring({ paint: -1 }), 'B', 'paint', 0)).toContainEqual({ label: 'Their style', n: -1 });
    expect(climbCheckParts(scoring({ againstPaint: -1 }), 'A', 'paint', 0)).toContainEqual({ label: 'Their style', n: -1 });
    expect(climbCheckParts(scoring({ againstPaint: -1 }), 'A', '3pt', 0).some(p => p.label === 'Their style')).toBe(false);
  });

  it('tires, draws, rests, rebounds and deals as it says', () => {
    const g = scoring({ minutes: 1, draw: 1 });
    for (const k of ['A', 'B']) { getTeam(g, k).hand = []; getTeam(g, k).deck = Array.from({ length: 20 }, () => 'first_step'); }
    const next = endSection(g);
    expect(getPS(next, 'B', 'b0').minutes).toBe(5);
    expect(getPS(next, 'A', 'a0').minutes).toBe(4);
    expect(next.teamB.hand).toHaveLength(8);
    expect(next.teamA.hand).toHaveLength(7);
    // A scoreless roll is a board (the chart here scores 2 on every roll, so none).
    expect(doRoll(scoring({ rebOnMiss: 1 }), 'B', 0).rollResults.B[0].reb).toBe(1);
    const dry = scoring({ rebOnMiss: 1 });
    for (const p of getTeam(dry, 'B').starters) p.chart = [{ lo: 1, hi: 99, pts: 0, reb: 1, ast: 0 }];
    expect(doRoll(dry, 'B', 0).rollResults.B[0].reb).toBe(2);
    expect(newGame(roster('a'), roster('b'), undefined, undefined, { style: { B: { hand: -1 } } }).teamB.hand).toHaveLength(6);
  });
});

describe('a style in the run', () => {
  it('gives each stop of an act its own opponent, shown on the map, and plays it', () => {
    const run = camped();
    const stops = run.map.floors.flat().filter(s => !['rest', 'event'].includes(s.kind));
    const abbrs = stops.map(s => stopOpponent(run, s).abbr);
    expect(new Set(abbrs).size).toBe(abbrs.length);
    const g1 = run.map.floors[0][0];
    const opp = stopOpponent(run, g1);
    const game = chooseStop(run, g1.id).game;
    expect(game.opponent.abbr).toBe(opp.abbr);
    expect(game.style).toEqual(opp.style);
    expect(game.style.level).toBe('hole');            // an Act I Game
  });

  it('puts the stat moves on the coach\'s cards and the rest in the game options', () => {
    // Act II, on its own map, so both halves play: a stop whose style moves
    // stats, and one with engine effects.
    const base = camped();
    const r = { ...base, act: 2, map: generateMap(base.seed, base.mapVersion, 2), status: 'map', at: null };
    const fights = r.map.floors.flat().filter(st => !['rest', 'event'].includes(st.kind));
    const statStop = fights.find(st => { const fx = stopOpponent(r, st).style.fx; return fx.speed || fx.power || fx.defBoost; });
    const engineStop = fights.find(st => engineFx(stopOpponent(r, st).style.fx));
    expect(statStop && engineStop).toBeTruthy();
    const setup = gameSetup(r, statStop.id);
    const p = presetFor({ ...r, status: 'game', game: setup });
    const plain = setup.rosterB.map(k => getCardByKey(k));
    for (const [i, c] of p.rosterB.entries()) expect(c, plain[i].id).toEqual(styledCard(plain[i], setup.style.fx));
    expect(p.rosterB.some((c, i) => c.speed !== plain[i].speed || c.power !== plain[i].power || c.defBoost !== plain[i].defBoost)).toBe(true);
    const eSetup = gameSetup(r, engineStop.id);
    expect(presetFor({ ...r, status: 'game', game: eSetup }).gameOpts.style).toEqual({ B: engineFx(eSetup.style.fx) });
  });
});

describe('Full Strength', () => {
  const atBoss = () => ({ ...camped(), status: 'map', at: '7-0', cleared: ['1-0', '7-0'] });

  it('is offered for the Act I and II bosses, not Act III\'s', () => {
    const run = atBoss();
    expect(fullStrengthOffered(run, run.map.boss)).toBe(true);
    expect(fullStrengthOffered({ ...run, act: 3 }, run.map.boss)).toBe(false);
    expect(fullStrengthOffered(run, run.map.floors[0][0])).toBe(false);
  });

  it('doubles the boss\'s strength, and its win pays a card more and a perk from four', () => {
    const run = atBoss();
    const full = chooseStop(run, 'boss', { fullStrength: true });
    expect(full.game.fullStrength).toBe(true);
    expect(full.game.style.level).toBe('full');
    const usual = chooseStop(run, 'boss');
    expect(usual.game.fullStrength).toBeUndefined();
    const won = recordResult(full, { stopId: 'boss', won: true, margin: 5 });
    expect(won.fullStrengthWon).toEqual({ 1: true });
    const next = continueClimb(won);
    const plain = continueClimb(recordResult(usual, { stopId: 'boss', won: true, margin: 5 }));
    expect(next.offers.picks).toBe(plain.offers.picks + 1);
    expect(next.offers.perks).toHaveLength(4);
    expect(plain.offers.perks).toHaveLength(3);
  });
});
