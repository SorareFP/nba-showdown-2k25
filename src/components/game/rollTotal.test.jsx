// THE WHOLE ROLL ON THE TILE. The user (2026-10-19): "During matchups, please
// show what roll bonuses look like with ALL factors folded in, like hot
// markers, fatigue, etc". The tile's "Roll" is scoringRollModifier's total —
// the sum the die will carry — and the parts beyond the matchup are spelled out.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../ui/dialogs.jsx', () => ({ useDialogs: () => ({ toast: () => {}, ask: async () => true }) }));
vi.mock('../CardLightbox.jsx', () => ({
  useLightbox: () => ({ open: () => {} }),
  // eslint-disable-next-line no-unused-vars
  ZoomImg: ({ player, strat, ...img }) => <img alt="" {...img} />,
}));
import CourtBoard from './CourtBoard.jsx';
import { rollGate, getTeam, getPS, scoringRollModifier } from '../../game/engine.js';
import { tutorialStart, openRolling } from '../../game/tutorialWalk.testkit.js';

const noop = () => {};
const board = g => renderToStaticMarkup(
  <CourtBoard
    game={g} setGame={noop} rollGate={rollGate(g)}
    onRoll={noop} onEndSection={noop} onExecCard={noop} onResolve={noop}
    onSpendAssist={noop} onSpendRebound={noop}
  />,
);

describe("the tile's Roll", () => {
  it('is the whole modifier the die carries, the parts only in its tooltip', () => {
    const g = openRolling(tutorialStart());
    const p = getTeam(g, 'A').starters[0];
    const ps = getPS(g, 'A', p.id);
    ps.hot = 1;
    ps.minutes = 20;
    const mod = scoringRollModifier(g, 'A', 0);
    expect(mod.markers).toBe(2);
    expect(mod.fatigue).toBeLessThan(0);
    const html = board(g);
    expect(html).toContain(`data-roll-total="${mod.total}"`);
    expect(html).toContain('hot +2');
    expect(html).toMatch(/tired −?-?\d/);
    expect(html).toContain(`matchup ${mod.matchup > 0 ? '+' : ''}${mod.matchup}`);
    expect(html).not.toContain('advParts');   // no visible breakdown ("I don't need to see why")
  });

  it('says nothing more than the matchup when nothing else rides on it', () => {
    const g = openRolling(tutorialStart());
    for (const k of ['A', 'B']) for (const pl of getTeam(g, k).starters) Object.assign(getPS(g, k, pl.id), { hot: 0, cold: 0, minutes: 0 });
    const html = board(g);
    expect(html).not.toContain('hot +');
    expect(html).not.toContain('tired ');
    const mod = scoringRollModifier(g, 'A', 0);
    expect(mod.total).toBe(mod.matchup + mod.card);
  });
});

// THE PLACEMENT POPOVER, FULLY FACTORED (the user, 2026-10-19: "I meant here
// during the matchup strategy phase. I don't need to see why, I just need them
// to be fully factored in here"). placementRolls places him on a copy and reads
// the same sum the tile and the die will carry.
import { placementRolls } from '../../game/engine.js';
describe('the placement popover\'s rolls', () => {
  it('are the whole roll both ways: markers, fatigue and a card bonus on the slot', () => {
    const g = openRolling(tutorialStart());
    const me = getTeam(g, 'A').starters[2];
    const them = getTeam(g, 'B').starters[2];
    Object.assign(getPS(g, 'A', me.id), { hot: 1, minutes: 20 });
    Object.assign(getPS(g, 'B', them.id), { cold: 1 });
    g.tempEff = { ...(g.tempEff || {}), A: { ...(g.tempEff?.A || {}), r2: 3 } };
    const pr = placementRolls(g, 'A', 2, me);
    expect(pr.mine).toBe(scoringRollModifier(g, 'A', 2).total);
    expect(pr.theirs).toBe(scoringRollModifier(g, 'B', 2).total);
    const plain = scoringRollModifier(g, 'A', 2);
    expect(plain.card).toBe(3);
    expect(plain.markers).toBe(2);
    expect(plain.fatigue).toBeLessThan(0);
  });

  it('never changes the game it reads', () => {
    const g = openRolling(tutorialStart());
    const before = JSON.stringify(g);
    const bench = (getTeam(g, 'A').roster || []).find(p => !getTeam(g, 'A').starters.some(s => s?.id === p.id));
    placementRolls(g, 'A', 1, bench ?? getTeam(g, 'A').starters[1]);
    expect(JSON.stringify(g)).toBe(before);
  });
});
