// THE ZIG-ZAG FLOOR (2026-09-24). On a big monitor each team's five are card
// tiles in the user's sketch — 1, 3, 5 above, 2 and 4 below — Team A's half
// on the left and Team B's on the right; everywhere else the five rows stay.
import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../ui/dialogs.jsx', () => ({ useDialogs: () => ({ toast: () => {}, ask: async () => true }) }));
vi.mock('../CardLightbox.jsx', () => ({
  useLightbox: () => ({ open: () => {} }),
  // eslint-disable-next-line no-unused-vars
  ZoomImg: ({ player, strat, ...img }) => <img alt="" {...img} />,
}));
import CourtBoard, { ZIGZAG_TOP } from './CourtBoard.jsx';
import { rollGate } from '../../game/engine.js';
import { WIDE_QUERY } from '../../ui/useIsWide.js';
import { tutorialStart, openRolling } from '../../game/tutorialWalk.testkit.js';

const noop = () => {};
const board = g => renderToStaticMarkup(
  <CourtBoard
    game={g} setGame={noop} rollGate={rollGate(g)}
    onRoll={noop} onEndSection={noop} onExecCard={noop} onResolve={noop}
    onSpendAssist={noop} onSpendRebound={noop}
  />,
);
const setWide = wide => {
  globalThis.matchMedia = q => ({ matches: wide && q === WIDE_QUERY, addEventListener() {}, removeEventListener() {} });
};
afterEach(() => { delete globalThis.matchMedia; });

describe('the court on a big monitor', () => {
  it('draws each team\'s five as zig-zag tiles, 1, 3 and 5 on the top row', () => {
    setWide(true);
    const html = board(openRolling(tutorialStart()));
    const slots = [...html.matchAll(/data-slot="([AB]\d)"/g)].map(m => m[1]);
    expect(slots).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'B5']);
    expect(ZIGZAG_TOP.map(i => i + 1)).toEqual([1, 3, 5]);
    // Every tile carries the same player card the rows draw, stood up.
    expect((html.match(/cardPortrait/g) ?? []).length).toBe(10);
    expect(html).not.toMatch(/matchupRow/);
  });

  it('keeps the five rows everywhere else', () => {
    setWide(false);
    const html = board(openRolling(tutorialStart()));
    expect(html).not.toMatch(/data-slot=/);
    expect((html.match(/_matchupRow_|matchupRow/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});
