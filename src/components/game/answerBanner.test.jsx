// YOUR ANSWER WINDOW, ON THE BOARD (the user, 2026-10-11: "the CPU plays so
// fast that I can't play things like glass cleaner"). While you hold a card
// that answers the coach's last check or roll, the coach waits and a banner
// says so, with Continue to let play go on.
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
import { passAnswer } from '../../game/canPlay.js';
import { CARDS } from '../../game/cards.js';

/** The coach (B) has just missed a check; you (A) hold Glass Cleaner. */
const missed = () => {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(40, 50), null, null);
  const live = { ...g, phase: 'scoring', scoringTurn: 'A', checkSeq: 3 };
  live.teamA.starters = live.teamA.roster.slice(0, STARTERS);
  live.teamB.starters = live.teamB.roster.slice(0, STARTERS);
  live.teamA.hand = ['glass_cleaner', 'crowd_favorite'];
  live.teamB.hand = [];
  live.lastCheckMiss = { teamKey: 'B', type: 'paint', playerIdx: 0, claimed: false };
  return live;
};

const paint = (game, props = {}) => renderToStaticMarkup(
  <CourtBoard
    game={game}
    setGame={() => {}}
    onRoll={() => {}} onEndSection={() => {}} onExecCard={() => {}}
    onResolve={() => {}} onSpendAssist={() => {}} onSpendRebound={() => {}}
    coachTeam="B"
    {...props}
  />
);

describe('the answer banner', () => {
  it('says the coach is waiting, names your answer, and offers Continue', () => {
    const html = paint(missed());
    expect(html).toContain('data-answer-window="glass_cleaner"');
    expect(html).toContain('Glass Cleaner');
    expect(html).toMatch(/data-answer-continue[^>]*>Continue</);
  });

  it('is gone once you pass on that moment', () => {
    expect(paint(passAnswer(missed()))).not.toContain('data-answer-window');
  });

  it('is never shown at a hotseat game, where nobody is waiting on a coach', () => {
    expect(paint(missed(), { coachTeam: null })).not.toContain('data-answer-window');
  });
});
