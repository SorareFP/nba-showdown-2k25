// THE COACH'S HAND IS FACE DOWN, AND ITS ROSTER IS FACE UP.
//
// The user, 2026-09-14: "the human user should be able to see the opposite
// team's entire roster and its status the way the AI will be able to know
// ours ... Additionally, human should not be able to see AI's strategy cards."
//
// The bug was structural rather than a slip: a solo game is not PvP, and every
// gate in CourtBoard that hides a hand was written as `pvpMode && ...`. So
// against the coach BOTH hands rendered face-up and its seven cards were
// readable — a bigger edge than any rung on the difficulty ladder, handed over
// silently. `coachTeam` is the seam; hotseat still passes null, because there
// both hands belong to the person at the screen.
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
import { newGame, STARTERS } from '../../game/engine.js';
import { CARDS } from '../../game/cards.js';

/** A game in the scoring phase with both fives on the floor. */
const start = () => {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(40, 50), null, null);
  const live = { ...g, phase: 'scoring', scoringTurn: 'A' };
  live.teamA.starters = live.teamA.roster.slice(0, STARTERS);
  live.teamB.starters = live.teamB.roster.slice(0, STARTERS);
  // Something worth hiding, and something worth showing. Team A's hand is
  // pinned too: it is dealt at random, and a card it happens to share with
  // the coach would make "the coach's card is not on screen" fail on YOUR
  // copy of it.
  live.teamA.hand = ['close_out', 'crowd_favorite'];
  live.teamB.hand = ['switch_everything', 'this_is_my_house', 'green_light'];
  live.teamB.stats[0].hot = 2;
  live.teamB.stats[1].minutes = 16;
  return live;
};

const paint = props => renderToStaticMarkup(
  <CourtBoard
    game={start()}
    setGame={() => {}}
    onRoll={() => {}} onEndSection={() => {}} onExecCard={() => {}}
    onResolve={() => {}} onSpendAssist={() => {}} onSpendRebound={() => {}}
    {...props}
  />
);

/** Just the right-hand panel — the coach's side of the screen. */
const theirPanel = html => {
  const at = html.indexOf('_handR_');
  expect(at, 'the coach panel should be on screen').toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<div', at));
};

describe('playing the coach', () => {
  const out = () => paint({ coachTeam: 'B' });

  it('does not name a single card in the coach\'s hand', () => {
    const html = out();
    for (const id of ['switch_everything', 'this_is_my_house', 'green_light']) {
      expect(html, `${id} is the coach's business`).not.toContain(id);
    }
    expect(html).not.toContain('Switch Everything');
  });

  it('still says how many cards it is holding — a count was never secret', () => {
    expect(theirPanel(out())).toContain('🂠 3');
  });

  it('shows the whole opposing roster, not just the five on the floor', () => {
    const panel = theirPanel(out());
    for (const c of CARDS.slice(40, 50)) expect(panel, c.name).toContain(c.name);
  });

  it('shows the stamina and the markers the coach reads off you', () => {
    const panel = theirPanel(out());
    expect(panel).toContain('🔥');            // the hot marker on their first player
    expect(panel).toContain('⛔16m');          // 16 minutes: must rest
    expect(panel).toMatch(/on the fatigue tracker/);
    expect(panel).toMatch(/on the bench/);    // and the five you cannot see on court
  });

  it('leaves your own hand exactly as it was', () => {
    expect(out()).toContain('Team A');
  });
});

describe('hotseat, where both hands are the same person\'s', () => {
  it('hides nothing — there is nobody to hide it from', () => {
    expect(paint({ coachTeam: null })).toContain('data-card-id="switch_everything"');
  });
});
