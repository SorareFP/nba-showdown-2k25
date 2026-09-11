// THE PUT-BACK UNDO ON THE BOARD (2026-09-11). The user: "Need an undo for
// strategy card usage. Just accidentally went to play a card and sent it to
// the bottom of my deck." The rule is engine.js's (undoReturnCard); this is
// the hand's header showing the button exactly when the rule allows it.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../CardLightbox.jsx', () => ({
  useLightbox: () => ({ open: () => {} }),
  // eslint-disable-next-line no-unused-vars
  ZoomImg: ({ player, strat, ...img }) => <img alt="" {...img} />,
}));

import { HandPanel } from './CourtBoard.jsx';
import { newGame, getTeam, returnCardToDeck, undoReturnCard } from '../../game/engine.js';
import { CARDS } from '../../game/cards.js';

function scoring() {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20), null, null, {});
  g.phase = 'scoring';
  g.scoringTurn = 'A';
  return g;
}
const hand = (g, props = {}) => renderToStaticMarkup(
  <HandPanel game={g} teamKey="A" onExecCard={() => {}} onReturnCard={() => {}} onUndoReturn={() => {}} {...props} />,
);

describe('the put-back undo in the hand', () => {
  it('shows nothing to undo until a card goes back', () => {
    expect(hand(scoring())).not.toContain('↩ Undo');
  });

  it('offers the undo once a card is put back, naming it, and drops it once taken back', () => {
    const g = scoring();
    const card = getTeam(g, 'A').hand[0];
    const back = returnCardToDeck(g, 'A', 0);
    const out = hand(back);
    expect(out).toContain('↩ Undo');
    expect(out).toMatch(/Take .* back from the bottom of your deck/);
    const again = undoReturnCard(back, 'A');
    expect(getTeam(again, 'A').hand).toContain(card);
    expect(hand(again)).not.toContain('↩ Undo');
  });

  it('keeps it off the other side of a PvP game while it is not their turn', () => {
    const back = returnCardToDeck(scoring(), 'A', 0);
    expect(hand(back, { pvpMode: true, isMyTurn: false })).not.toContain('↩ Undo');
    expect(hand(back, { pvpMode: true, isMyTurn: true })).toContain('↩ Undo');
  });
});
