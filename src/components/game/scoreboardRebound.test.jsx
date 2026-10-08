// THE SCOREBOARD'S REBOUND BAR IS THE TRACK (2026-09-24). It printed
// "+3: Paint Check" at any lead of 3 — the gated rule from before 2026-09-23 —
// and the user quoted the stale number back: "I should only be able to make a
// paint shot check if I'm +3, or whatever we decided on". The same day the
// track and the bank split: the bar and its totals are rebounds WON, which a
// spend never moves, and the check is bought from the bank, so the bar marks
// only the glass winner's +2.
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Scoreboard from './Scoreboard.jsx';
import { gainRebounds } from '../../game/engine.js';
import { tutorialStart, openRolling } from '../../game/tutorialWalk.testkit.js';

function board(a, b, { bankA, used } = {}) {
  const g = openRolling(tutorialStart());
  gainRebounds(g.teamA, a); gainRebounds(g.teamB, b);
  if (bankA != null) g.teamA.rebounds = bankA;
  if (used) g.glassUsed = { A: true };
  return renderToStaticMarkup(<Scoreboard game={g} />);
}

describe('the scoreboard rebound bar', () => {
  it('shows rebounds won, however much has been spent', () => {
    const html = board(12, 12, { bankA: 2 });
    expect(html).toContain('EVEN');
    expect(html).toMatch(/title="Rebounds won this game">12</);
    expect(html).not.toContain('+10');
  });

  it('never says Paint Check (the bank buys it), and marks the glass winner\'s +2', () => {
    for (const lead of [0, 1, 3, 5, 8]) expect(board(10 + lead, 10)).not.toContain('Paint Check');
    // Live since 2026-10-08: the marker is the bonus the leader holds now.
    expect(board(13, 10)).toContain('+3: next paint check +2');
    expect(board(11, 10)).not.toContain('next paint check');
    expect(board(13, 10, { used: true })).toContain('+2 used this section');
    expect(board(13, 10, { used: true })).not.toContain('next paint check');
  });
});
