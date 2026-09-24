// THE SCOREBOARD'S REBOUND MARKER SAYS TODAY'S RULE (2026-09-24). It printed
// "+3: Paint Check" at any lead of 3 — the gated rule from before 2026-09-23 —
// while the check needed a lead of 5 (REBOUND_RULES.leadToSpend). The user
// quoted the stale number back: "I should only be able to make a paint shot
// check if I'm +3, or whatever we decided on".
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Scoreboard from './Scoreboard.jsx';
import { reboundCheckOpen, SPEND_COSTS } from '../../game/engine.js';
import { tutorialStart, openRolling } from '../../game/tutorialWalk.testkit.js';

function board(a, b) {
  const g = openRolling(tutorialStart());
  g.teamA.rebounds = a; g.teamB.rebounds = b;
  return { g, html: renderToStaticMarkup(<Scoreboard game={g} />) };
}

describe('the scoreboard rebound marker', () => {
  it('says Paint Check exactly when the leader may buy one', () => {
    const cost = SPEND_COSTS.reboundPaint;
    for (const lead of [0, 1, 3, cost - 1, cost, cost + 2]) {
      const { g, html } = board(10 + lead, 10);
      expect(html.includes(`+${cost}: Paint Check`), `lead ${lead}`).toBe(reboundCheckOpen(g, 'A'));
      expect(html).not.toContain('+3: Paint Check');
    }
  });

  it('shows the glass winner\'s +2 short of the price', () => {
    expect(board(13, 10).html).toContain('+3: next check +2');
    expect(board(11, 10).html).not.toContain('next check');
  });
});
