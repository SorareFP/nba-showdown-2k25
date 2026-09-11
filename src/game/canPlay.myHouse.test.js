// This Is My House: the card is playable exactly when the picker would have
// something to offer, and what it offers is exactly what the engine accepts.
//
// The bug this pins: the picker listed every opponent who had not rolled, the
// player picked one, and execCard refused it with a pop-up because the guard
// on that slot was not faster AND stronger. Playability and the picker now
// read one list.
import { describe, it, expect } from 'vitest';
import { newGame, getTeam } from './engine.js';
import { CARDS } from './cards.js';
import { canPlayCard, myHouseTargets, myHouseHolds } from './canPlay.js';

/** A game in the scoring phase with hand-set starters, so the matchups are known. */
function scoringGame(mine, theirs) {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  getTeam(g, 'A').starters = mine.map((o, i) => ({ ...CARDS[i], ...o }));
  getTeam(g, 'B').starters = theirs.map((o, i) => ({ ...CARDS[10 + i], ...o }));
  g.phase = 'scoring';
  g.scoringTurn = 'A';
  g.rollResults = { A: [], B: [] };
  // A's starter i guards B's attacker i.
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  return g;
}

const five = (speed, power) => Array.from({ length: 5 }, () => ({ speed, power }));

describe('This Is My House', () => {
  it('is playable when a defender out-speeds AND out-powers an opponent who has not rolled', () => {
    const g = scoringGame(five(18, 18), five(12, 12));
    expect(canPlayCard(g, 'A', 'this_is_my_house').canPlay).toBe(true);
    expect(myHouseTargets(g, 'A')).toHaveLength(5);
  });

  it('offers only the slots that qualify, not every un-rolled opponent', () => {
    const mine = [{ speed: 18, power: 18 }, { speed: 10, power: 18 }, { speed: 18, power: 10 },
                  { speed: 18, power: 18 }, { speed: 12, power: 12 }];
    const g = scoringGame(mine, five(12, 12));
    const slots = myHouseTargets(g, 'A').map(t => t.offSlot);
    // Slot 1 loses on speed, slot 2 on power, slot 4 ties both — strict rule.
    expect(slots).toEqual([0, 3]);
  });

  it('drops an opponent who has already rolled', () => {
    const g = scoringGame(five(18, 18), five(12, 12));
    g.rollResults.B = [{ die: 14 }, undefined, undefined, undefined, undefined];
    expect(myHouseTargets(g, 'A').map(t => t.offSlot)).toEqual([1, 2, 3, 4]);
  });

  it('is NOT playable when nobody qualifies, so the hand greys it instead of a pop-up', () => {
    const g = scoringGame(five(12, 12), five(12, 12));
    const play = canPlayCard(g, 'A', 'this_is_my_house');
    expect(play.canPlay).toBe(false);
    expect(play.reason).toMatch(/out-speeds AND out-powers/);
  });

  it('follows the matchup table, not the slot number', () => {
    // Only A's starter 4 is strong; it guards B's attacker 0.
    const mine = [...five(12, 12).slice(0, 4), { speed: 19, power: 19 }];
    const g = scoringGame(mine, five(12, 12));
    g.offMatchups.B = [4, 1, 2, 3, 0];
    expect(myHouseTargets(g, 'A').map(t => t.offSlot)).toEqual([0]);
  });
});

// Slot 0 is the matchup under test; everyone else is hopeless, so the lists
// below can only ever contain slot 0.
const onlySlot0 = (def, off) => scoringGame(
  [{ defBoost: 0, ...def }, ...five(1, 1).slice(1)],
  [{ defBoost: 0, ...off }, ...five(19, 19).slice(1)],
);

describe('This Is My House counts Defense and card effects', () => {
  it('refuses Kyrie Irving on Isaiah Joe: Defense -1 leaves their Power level (the user, 2026-09-10)', () => {
    const g = onlySlot0({ speed: 16, power: 5, defBoost: -1 }, { speed: 13, power: 4 });
    expect(myHouseHolds(g, 'A', 0)).toBeNull();
    expect(myHouseTargets(g, 'A')).toEqual([]);
    expect(canPlayCard(g, 'A', 'this_is_my_house').canPlay).toBe(false);
  });

  it('lets the same Irving shut out a smaller attacker, guarding at S15/P4', () => {
    const g = onlySlot0({ speed: 16, power: 5, defBoost: -1 }, { speed: 13, power: 3 });
    expect(myHouseHolds(g, 'A', 0)).toMatchObject({ offSlot: 0, defIdx: 0, defSpeed: 15, defPower: 4 });
  });

  it('does not count a POSITIVE Defense as extra size: a tie stays a tie', () => {
    const g = onlySlot0({ speed: 16, power: 4, defBoost: 3 }, { speed: 13, power: 4 });
    expect(myHouseHolds(g, 'A', 0)).toBeNull();
  });

  it('counts a card effect on the defender, as the roll does (Defensive Stopper)', () => {
    const g = onlySlot0({ speed: 13, power: 4 }, { speed: 13, power: 4 });
    expect(myHouseHolds(g, 'A', 0)).toBeNull();
    g.tempDefEff = { A: { 0: { speedBoost: 5, powerBoost: 5 } } };
    expect(myHouseHolds(g, 'A', 0)).toMatchObject({ defSpeed: 18, defPower: 9 });
  });
});
