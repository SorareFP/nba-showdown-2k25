// EVERY TUTORIAL HIGHLIGHT LANDS ON SOMETHING THE BOARD DRAWS (2026-09-18).
//
// A lesson's `highlight` is a CSS selector the overlay looks up in the page;
// if the board stops drawing that attribute, or draws it only in a state the
// lesson is never live in, the lesson glows nothing and no test noticed —
// the lesson tests compared the selector string with itself. This plays the
// tutorial (tutorialWalk.testkit.js), takes a state in which each
// highlighted lesson is live, renders the board with TutorialGame's props,
// and asks that the markup carries the attribute.
//
// And that it lights YOUR card only (2026-09-18): the tutorial deals the
// coach's hand face up, and a `[data-card-id]` selector lit the coach's copy
// of the same card as well. A card highlight must match exactly as many
// elements as you hold copies.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../CardLightbox.jsx', () => ({
  useLightbox: () => ({ open: () => {} }),
  // eslint-disable-next-line no-unused-vars
  ZoomImg: ({ player, strat, ...img }) => <img alt="" {...img} />,
}));

import CourtBoard from './CourtBoard.jsx';
import { rollGate, getTeam, doRoll } from '../../game/engine.js';
import { TUTORIAL_TOOLTIPS, TUTORIAL_ROSTER_A_IDS, TUTORIAL_ROSTER_B_IDS } from '../../game/tutorialData.js';
import { tutorialReducer } from '../../game/tutorialFlow.js';
import {
  seeded, tutorialStart, walkTutorial, lockLineups, runSnake, openRolling, FIRST_FIVE_A,
} from '../../game/tutorialWalk.testkit.js';

const rollAll = g => { let ng = g; for (let i = 0; i < 5; i += 1) { ng = doRoll(ng, 'A', i); ng = doRoll(ng, 'B', i); } return ng; };

const live = (t, g) => (!t.trigger.phase || t.trigger.phase === g.phase) && t.trigger.condition(g);

function walkStates(seed, opts = {}) {
  vi.spyOn(Math, 'random').mockImplementation(seeded(seed));
  const states = [];
  try { walkTutorial(tutorialStart(), { ...opts, onState: g => states.push(g) }); } finally { vi.restoreAllMocks(); }
  return states;
}

const noop = () => {};
/** The board as TutorialGame mounts it. */
const board = (g, extra = {}) => renderToStaticMarkup(
  <CourtBoard
    game={g} setGame={noop} rollGate={rollGate(g)}
    onRoll={noop} onEndSection={noop} onExecCard={noop} onResolve={noop}
    onSpendAssist={noop} onSpendRebound={noop}
    onTimeout={noop} onEndTimeout={noop} onSearchCrunch={noop}
    coachTips watchOnlyTeam="B"
    {...extra}
  />,
);

/** The attribute selectors in a comma-separated highlight. */
const parts = selector => selector.split(',').map(s => s.trim()).map(s => {
  const m = s.match(/^\[([\w-]+)="([^"]+)"\]$/);
  if (!m) throw new Error(`unreadable highlight selector: ${s}`);
  return { attr: m[1], value: m[2] };
});
/** How many elements the selector matches in the markup — what the overlay's querySelectorAll lights. */
const matches = (markup, selector) => parts(selector).reduce((n, p) => n + markup.split(`${p.attr}="${p.value}"`).length - 1, 0);
const carries = (markup, selector) => matches(markup, selector) > 0;
/** For a hand-card highlight, the copies of those cards in YOUR hand; null for any other highlight. */
function myCopies(g, selector) {
  const ids = parts(selector).map(p => p.value.match(/^card-A-(.+)$/)?.[1]).filter(Boolean);
  if (!ids.length) return null;
  return getTeam(g, 'A').hand.filter(id => ids.includes(id)).length;
}

describe('the tutorial highlights', () => {
  // One walk that takes the clutch, one that never does (the lesson must go
  // when the button goes), one that reaches overtime.
  const states = [...walkStates(1001), ...walkStates(1003, { noClutch: true }), ...walkStates(1004, { tieAtEnd: true })];
  const highlighted = TUTORIAL_TOOLTIPS.filter(t => t.highlight);

  it('there are highlighted lessons to check', () => {
    expect(highlighted.length).toBeGreaterThan(5);
  });

  for (const t of highlighted) {
    it(`${t.id} glows something the board draws`, () => {
      const at = states.filter(g => live(t, g));
      expect(at.length).toBeGreaterThan(0);
      // The placement Undo lives in the board's own React state in solo (the
      // snapshot taken when YOU place), which a static render cannot hold;
      // the same PhaseBar button is drawn from the props PvP passes.
      const extra = t.id === 's2_place_undo' ? { pvpMode: true, myTeamKey: 'A', isMyTurn: true, onUndoPlace: noop, undoPlaceName: 'Somebody' } : {};
      // In EVERY state the lesson is live in: a lesson that outlives the
      // thing it points at glows nothing (s1_matchup_window did, after the
      // switch was played; s4_clutch did, after the last roll).
      const where = (g, i) => `${i}: Q${g.quarter}S${g.section} ${g.phase} step${g.placementStep} mt${g.matchupTurn}/${g.matchupPasses} sp${g.scoringPasses} to${g.timeoutActive}`;
      const misses = [];
      at.forEach((g, i) => {
        const markup = board(g, extra);
        if (!carries(markup, t.highlight)) { misses.push(`${where(g, i)} glows nothing`); return; }
        // A hand card: your copies, and not one of the coach's.
        const mine = myCopies(g, t.highlight);
        if (mine != null && matches(markup, t.highlight) !== mine) misses.push(`${where(g, i)} lights ${matches(markup, t.highlight)} for your ${mine}`);
      });
      expect(misses).toEqual([]);
    });
  }

  it('glows the minutes tag for the limit lesson when you rotated your fives and nobody is near it', () => {
    // The limit lesson fires for everyone at the S3 lineup now (2026-09-18);
    // with the fives rotated the only tags drawn are the S2 five's minutes.
    const other = TUTORIAL_ROSTER_A_IDS.slice(5);
    const bIds = TUTORIAL_ROSTER_B_IDS.slice(0, 5);
    const section = (g, aIds) => tutorialReducer(rollAll(openRolling(g, aIds, bIds)), { type: 'END_SECTION' });
    const g = section(section(tutorialStart(), FIRST_FIVE_A), other);
    expect([g.quarter, g.section, g.phase]).toEqual([1, 3, 'draft']);
    const t = TUTORIAL_TOOLTIPS.find(x => x.id === 's3_twelve_limit');
    expect(live(t, g)).toBe(true);
    const markup = board(g);
    expect(markup).not.toContain('data-tutorial="must-rest"');
    expect(matches(markup, t.highlight)).toBe(other.length);
  });

  it("lights your card and not the coach's copy, when both hands hold one", () => {
    const g = runSnake(lockLineups(tutorialStart(), FIRST_FIVE_A, TUTORIAL_ROSTER_B_IDS.slice(0, 5)), { coachPicks: false });
    g.teamA.hand = ['high_screen_roll', ...g.teamA.hand.filter(id => id !== 'high_screen_roll').slice(0, 6)];
    g.teamB.hand = ['high_screen_roll', 'green_light', ...g.teamB.hand.filter(id => id !== 'high_screen_roll' && id !== 'green_light').slice(0, 5)];
    const t = TUTORIAL_TOOLTIPS.find(x => x.id === 's1_matchup_window');
    expect(live(t, g)).toBe(true);
    const markup = board(g);
    // The coach's copy IS on the board, face up —
    expect(markup.split('data-card-id="high_screen_roll"').length - 1).toBe(2);
    // — and the lesson lights one card: yours.
    expect(matches(markup, t.highlight)).toBe(1);
    // The forfeit family the same: the coach's Green Light is not lit.
    const f = TUTORIAL_TOOLTIPS.find(x => x.id === 's3_forfeit_tip');
    expect(markup).toContain('data-card-id="green_light"');
    expect(matches(markup, f.highlight)).toBe(getTeam(g, 'A').hand.filter(id => f.highlight.includes(`card-A-${id}"`)).length);
  });
});
