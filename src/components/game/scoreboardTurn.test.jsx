// THE SCOREBOARD'S TURN LINE SAYS TODAY'S RULES (2026-09-18). It printed
// "Pick 1/10 · Team A's pick" off `draft.step` over the secret-lineup screen,
// and "All players may roll" while the board enforced the a-b-a-b roll, right
// under tutorial lessons that said otherwise.
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Scoreboard from './Scoreboard.jsx';
import { rollGate, doRoll } from '../../game/engine.js';
import { tutorialStart, openRolling } from '../../game/tutorialWalk.testkit.js';

const line = (g, props = {}) => renderToStaticMarkup(<Scoreboard game={g} {...props} />);

describe('the scoreboard turn line', () => {
  it('asks for five at the secret-lineup screen, not a snake pick', () => {
    const g = tutorialStart();
    expect(g.phase).toBe('draft');
    expect(line(g)).toContain('Pick your five');
    expect(line(g)).not.toMatch(/Pick \d+\/10/);
    const ready = { ...g, draft: { ...g.draft, aReady: true } };
    expect(line(ready, { pvpMode: true, myTeamKey: 'A' })).toContain('Lineup locked · waiting for opponent');
  });

  it('says whose die it is where the roll alternates, and keeps the old line where it does not', () => {
    let g = openRolling(tutorialStart());
    expect(line(g, { rollGate: rollGate(g) })).toContain('Your roll');
    g = doRoll(g, 'A', 0);
    expect(line(g, { rollGate: rollGate(g) })).toContain('Coach&#x27;s roll');
    // Hotseat and PvP pass no gate: anyone may roll there.
    expect(line(g)).toContain('All players may roll');
  });
});
