// Placement and its undo (placement.js). The user, 2026-09-10: "Against the
// AI, you can undo the last player you place down until you place another
// player down. In PvP, you can only undo until the opponent places someone
// down."
import { describe, it, expect } from 'vitest';
import { newGame } from './engine.js';
import { CARDS } from './cards.js';
import { aiPlacementPick } from './ai.js';
import { placePlayer, placingTeam, placementSnapshot, canUndoPlacement, undoPlacement, takenBackName } from './placement.js';

/** A game at the first placement, as the lineup lock leaves it. */
function atPlacement(first = 'A') {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, { placementFirst: first });
  g.draft = { ...(g.draft ?? {}), aPicks: g.teamA.roster.slice(0, 5).map(p => p.id), bPicks: g.teamB.roster.slice(0, 5).map(p => p.id) };
  g.teamA.starters = [];
  g.teamB.starters = [];
  g.placementStep = 0;
  g.phase = 'matchup_strats';
  return g;
}
const nextPick = (g, k) => {
  const picks = k === 'A' ? g.draft.aPicks : g.draft.bPicks;
  const down = new Set((k === 'A' ? g.teamA : g.teamB).starters.map(p => p.id));
  return picks.find(id => !down.has(id));
};
const coach = g => placePlayer(g, aiPlacementPick(g, 'B', { iq: 1 }).playerId);
/** You (A) place, and the coach answers until it is your turn again. */
function youPlace(g, id = nextPick(g, 'A')) {
  const snap = placementSnapshot(g);
  let next = placePlayer(g, id);
  while (placingTeam(next) === 'B') next = coach(next);
  return { game: next, snap };
}

describe('placePlayer', () => {
  it('puts the placing side\'s pick in its next row and moves the snake on', () => {
    const g = atPlacement();
    const id = g.draft.aPicks[2];
    const next = placePlayer(g, id);
    expect(next.teamA.starters.map(p => p.id)).toEqual([id]);
    expect(next.placementStep).toBe(1);
    expect(placingTeam(next)).toBe('B');
    expect(next.log.at(-1).msg).toMatch(/takes the floor\.$/);
    expect(g.teamA.starters).toHaveLength(0);                    // the original is untouched
  });

  it('refuses a player who is not a pick, one already down, and anything after the tenth', () => {
    const g = atPlacement();
    expect(placePlayer(g, g.teamA.roster[7].id)).toBeNull();   // on the roster, not picked
    expect(placePlayer(g, g.draft.bPicks[0])).toBeNull();       // the other side's pick
    let full = g;
    for (let i = 0; i < 10; i += 1) full = placePlayer(full, nextPick(full, placingTeam(full)));
    expect(full.placementStep).toBe(10);
    expect(full.matchupTurn).toBe('A');
    expect(full.log.at(-1).msg).toMatch(/^Placement complete/);
    expect(placePlayer(full, g.draft.aPicks[0])).toBeNull();
  });
});

describe('undo against the coach', () => {
  it('takes back your pick and the coach\'s reply, and hands the pick back to you', () => {
    const { game, snap } = youPlace(atPlacement());
    expect(game.placementStep).toBe(3);                         // you, then the coach twice
    expect(canUndoPlacement(game, snap)).toBe(true);
    const name = game.teamA.starters[0].name;
    expect(takenBackName(game, snap)).toBe(name);
    const undone = undoPlacement(game, snap);
    expect(undone.placementStep).toBe(0);
    expect(undone.teamA.starters).toHaveLength(0);
    expect(undone.teamB.starters).toHaveLength(0);
    expect(placingTeam(undone)).toBe('A');
    expect(undone.log.at(-1)).toEqual({ team: 'A', msg: `↩ ${name} taken back.` });
  });

  it('lets the corrected pick be made and the coach answer it', () => {
    const g0 = atPlacement();
    const { game, snap } = youPlace(g0, g0.draft.aPicks[0]);
    const { game: again } = youPlace(undoPlacement(game, snap), g0.draft.aPicks[4]);
    expect(again.teamA.starters[0].id).toBe(g0.draft.aPicks[4]);
    expect(again.teamB.starters).toHaveLength(2);
  });

  it('is gone once you place another player; that one has its own undo', () => {
    const first = youPlace(atPlacement());
    const second = youPlace(first.game);
    expect(canUndoPlacement(second.game, first.snap)).toBe(false);
    expect(canUndoPlacement(second.game, second.snap)).toBe(true);
    expect(undoPlacement(second.game, second.snap).placementStep).toBe(3);
  });

  it('is gone once anything but a placement happens', () => {
    const { game, snap } = youPlace(atPlacement());
    const carded = { ...game, log: [...game.log, { team: 'A', msg: 'Team A plays High Screen & Roll.' }] };
    expect(canUndoPlacement(carded, snap)).toBe(false);
    const moved = JSON.parse(JSON.stringify(game));
    moved.teamB.starters.reverse();                               // a starter moved by something else
    expect(canUndoPlacement(moved, snap)).toBe(false);
  });

  it('covers the last placement too, while the matchup window has not been touched', () => {
    let g = atPlacement();
    let snap = null;
    while (placingTeam(g)) {
      if (placingTeam(g) === 'A') ({ game: g, snap } = youPlace(g));
      else g = coach(g);
    }
    expect(g.placementStep).toBe(10);                             // the coach placed the tenth
    expect(canUndoPlacement(g, snap)).toBe(true);
    expect(undoPlacement(g, snap).placementStep).toBe(8);
    const passed = { ...g, log: [...g.log, { team: 'A', msg: 'Team A passes.' }] };
    expect(canUndoPlacement(passed, snap)).toBe(false);
  });

  it('does nothing for a snapshot from another section, or once already undone', () => {
    const { game, snap } = youPlace(atPlacement());
    expect(canUndoPlacement({ ...game, section: game.section + 1 }, snap)).toBe(false);
    expect(canUndoPlacement(undoPlacement(game, snap), snap)).toBe(false);
    expect(placementSnapshot({ ...game, placementStep: 10 })).toBeNull();
  });
});

describe('undo in PvP', () => {
  it('holds until the opponent places', () => {
    const g = atPlacement();
    const snap = placementSnapshot(g);
    const mine = placePlayer(g, nextPick(g, 'A'));
    expect(canUndoPlacement(mine, snap, { pvp: true })).toBe(true);
    const theirs = placePlayer(mine, nextPick(mine, 'B'));
    expect(canUndoPlacement(theirs, snap, { pvp: true })).toBe(false);
  });

  it('means the second of two picks in a row, and only that one', () => {
    let g = placePlayer(atPlacement(), nextPick(atPlacement(), 'A'));   // A leads; B has the next two
    const s1 = placementSnapshot(g);
    g = placePlayer(g, nextPick(g, 'B'));
    const s2 = placementSnapshot(g);
    g = placePlayer(g, nextPick(g, 'B'));
    expect(canUndoPlacement(g, s2, { pvp: true })).toBe(true);
    expect(canUndoPlacement(g, s1, { pvp: true })).toBe(false);
    expect(undoPlacement(g, s2).teamB.starters).toHaveLength(1);
  });
});
