// THE TUTORIAL'S BOARD, AS TUTORIALGAME MOUNTS IT (2026-09-18).
//
// Two things the tutorial board did that the real game does not:
//   - the coach's hand is dealt face up (its lessons name the coach's cards),
//     and with no coachTeam that panel was a full HandPanel — its ▶ and ↩
//     played or put back the COACH's cards. `watchOnlyTeam` keeps it face up
//     and inert. Since round five it defaults to coachTeam, so PlayTab's
//     coach board is watch-only on the coach's side too; hotseat and PvP
//     have no coach and are unchanged.
//   - the phase bar said "All players may roll" while rollGate locked the
//     side that was not up. It says whose die it is when a gate is passed,
//     as the Scoreboard does, and keeps the old line where none is (hotseat,
//     PvP).
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
import { rollGate, doRoll, getTeam, returnCardToDeck, lastReturnedCard } from '../../game/engine.js';
import { execCard } from '../../game/execCard.js';
import { aiBuildCardOpts } from '../../game/ai.js';
import { TUTORIAL_ROSTER_B_IDS } from '../../game/tutorialData.js';
import { tutorialStart, lockLineups, runSnake, openRolling, FIRST_FIVE_A } from '../../game/tutorialWalk.testkit.js';

const noop = () => {};
/** TutorialGame's props (the coach's hand view-only), or `extra` over them. */
const tutorialBoard = (g, extra = {}) => renderToStaticMarkup(
  <CourtBoard
    game={g} setGame={noop} rollGate={rollGate(g)}
    onRoll={noop} onEndSection={noop} onExecCard={noop} onResolve={noop}
    onSpendAssist={noop} onSpendRebound={noop}
    onTimeout={noop} onEndTimeout={noop} onSearchCrunch={noop}
    coachTips watchOnlyTeam="B"
    {...extra}
  />,
);
/** PlayTab's hotseat board: no coachTeam, no gate, no read-only hand. */
const hotseatBoard = g => renderToStaticMarkup(
  <CourtBoard
    game={g} setGame={noop}
    onRoll={noop} onEndSection={noop} onExecCard={noop} onResolve={noop}
    onSpendAssist={noop} onSpendRebound={noop}
  />,
);

/** The markup of one team's hand panel (data-tutorial="hand-<k>") up to the next panel. */
function panel(html, k) {
  const at = html.indexOf(`data-tutorial="hand-${k}"`);
  expect(at, `hand ${k} should be on screen`).toBeGreaterThan(-1);
  const other = html.indexOf(`data-tutorial="hand-${k === 'A' ? 'B' : 'A'}"`);
  return html.slice(at, other > at ? other : undefined);
}
const count = (s, needle) => s.split(needle).length - 1;
const PLAY = 'title="Play card"';
const PUT_BACK = 'title="Return this card to the bottom of your deck"';

/** Q1 S1's matchup window on the coach's turn, both sides holding a playable switch. */
function coachsWindow() {
  const g = runSnake(lockLineups(tutorialStart(), FIRST_FIVE_A, TUTORIAL_ROSTER_B_IDS.slice(0, 5)), { coachPicks: false });
  g.teamA.hand = ['high_screen_roll', ...g.teamA.hand.filter(id => id !== 'high_screen_roll').slice(0, 6)];
  g.teamB.hand = ['high_screen_roll', ...g.teamB.hand.filter(id => id !== 'high_screen_roll').slice(0, 6)];
  g.matchupTurn = 'B';
  return g;
}

describe("the tutorial coach's hand is face up and view-only", () => {
  it('has no ▶ and no ↩ on the tutorial board, where the hotseat board still has both', () => {
    const g = coachsWindow();
    const tut = panel(tutorialBoard(g), 'B');
    const hot = panel(hotseatBoard(g), 'B');
    // Face up: the coach's cards are named on screen, as the lessons need.
    expect(tut).toContain('data-card-id="high_screen_roll"');
    expect(tut).toContain('view only');
    // Inert on the tutorial board —
    expect(count(tut, PLAY)).toBe(0);
    expect(count(tut, PUT_BACK)).toBe(0);
    // — and unchanged everywhere else: the switch is playable on B's turn and every card can go back.
    expect(count(hot, PLAY)).toBeGreaterThan(0);
    expect(count(hot, PUT_BACK)).toBe(g.teamB.hand.length);
    expect(hot).not.toContain('view only');
  });

  it("leaves YOUR hand live on the tutorial board", () => {
    const g = coachsWindow();
    g.matchupTurn = 'A';
    const mine = panel(tutorialBoard(g), 'A');
    expect(count(mine, PLAY)).toBeGreaterThan(0);
    expect(count(mine, PUT_BACK)).toBe(g.teamA.hand.length);
  });

  it("offers no Close Out button for the coach's card on your announced check", () => {
    for (const cardId of ['green_light', 'from_way_downtown', 'catch_and_shoot']) {
      const g = openRolling(tutorialStart());
      getTeam(g, 'A').hand = [cardId, ...getTeam(g, 'A').hand.slice(1)];
      getTeam(g, 'B').hand = ['close_out', ...getTeam(g, 'B').hand.slice(1)];
      g.teamA.assists = 10;
      const res = execCard(g, 'A', cardId, aiBuildCardOpts(g, 'A', cardId));
      if (!(res.ok && res.game.pendingShotCheck?.teamKey === 'A')) continue;
      expect(hotseatBoard(res.game)).toContain('Close Out −3');
      expect(tutorialBoard(res.game)).not.toContain('Close Out −3');
      expect(tutorialBoard(res.game)).toContain('▶ Resolve');
      return;
    }
    throw new Error('no card announced a check for A');
  });

  it('is what TutorialGame passes', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../TutorialGame.jsx', import.meta.url), 'utf8');
    expect(src).toMatch(/watchOnlyTeam="B"/);
    // PlayTab passes coachTeam and lets the board derive the watched side
    // from it (round five, 2026-09-18) — no second prop to forget.
    const play = readFileSync(new URL('../PlayTab.jsx', import.meta.url), 'utf8');
    expect(play).not.toMatch(/watchOnlyTeam|readOnlyHand/);
    // `gameOpponent` since 2026-09-18: the opponent a game was dealt with,
    // from its saved terms, not the pre-game chooser's current value.
    expect(play).toMatch(/coachTeam=\{gameOpponent === 'ai' \? 'B' : null\}/);
  });
});

describe("the phase bar's rolling line", () => {
  it('says whose die it is where the roll alternates, and the old line where it does not', () => {
    let g = openRolling(tutorialStart());
    expect(tutorialBoard(g)).toContain('Your roll');
    expect(tutorialBoard(g)).not.toContain('All players may roll');
    g = doRoll(g, 'A', 0);
    expect(tutorialBoard(g)).toContain('Coach&#x27;s roll');
    // Hotseat and PvP pass no gate: anyone may roll there.
    expect(hotseatBoard(g)).toContain('All players may roll');
    for (let i = 0; i < 5; i += 1) { if (i) g = doRoll(g, 'A', i); g = doRoll(g, 'B', i); }
    expect(tutorialBoard(g)).toContain('All rolls in');
  });
});

// ── 2026-09-18, the verifiers' fourth round ─────────────────────────────────
//
// readOnlyHand (now watchOnlyTeam) made the coach's HAND view-only but never reached its player
// slots or the turn: the human could press the coach's Roll and ⭐ Clutch,
// spend its AST, and Pass on its turn, and the coach's slots read "Their
// roll" during YOUR die.

const buttons = (html, label) => [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].filter(m => m[2].startsWith(label));
const enabled = (html, label) => buttons(html, label).filter(m => !/\sdisabled=""/.test(m[1])).length;

/** Crunch-Time rolling, the coach holding 10 AST and none for you. */
function crunchRolling() {
  const g = openRolling(tutorialStart());
  g.crunch = { active: true, margin: 3, used: {}, extra: {}, timeoutUsed: {}, searched: {} };
  g.teamA.assists = 0;
  g.teamB.assists = 10;
  return g;
}

describe("the tutorial coach's slots and turn are inert", () => {
  it("on the coach's die: no spend, no ⭐ Clutch and no live Roll on its slots, where hotseat still has them", () => {
    const g = doRoll(crunchRolling(), 'A', 0);
    expect(rollGate(g)).toMatchObject({ A: false, B: true });
    const tut = tutorialBoard(g);
    const hot = hotseatBoard(g);
    expect(tut).not.toContain('3PT (5A)');
    expect(tut).not.toContain('data-tutorial="clutch-B"');
    expect(enabled(tut, '🎲 Roll')).toBe(0);
    expect(hot).toContain('3PT (5A)');
    expect(hot).toContain('data-tutorial="clutch-B"');
    expect(enabled(hot, '🎲 Roll')).toBeGreaterThan(0);
  });

  it("on your die: the coach's slots never read Their roll, and yours roll", () => {
    const g = crunchRolling();
    expect(rollGate(g).A).toBe(true);
    const tut = tutorialBoard(g);
    expect(tut).not.toContain('Their roll');
    expect(enabled(tut, '🎲 Roll')).toBe(5);
    expect(tut).toContain('data-tutorial="clutch-A"');
  });

  it("Pass and Lock are not yours to press on the coach's turn", () => {
    const g = coachsWindow();
    const tut = tutorialBoard(g);
    const hot = hotseatBoard(g);
    expect(enabled(tut, 'Pass →')).toBe(0);
    expect(enabled(tut, 'Lock → Scoring')).toBe(0);
    expect(enabled(hot, 'Pass →')).toBe(1);
    expect(enabled(hot, 'Lock → Scoring')).toBe(1);
    // Your own turn: both live on the tutorial board.
    const mine = tutorialBoard({ ...g, matchupTurn: 'A' });
    expect(enabled(mine, 'Pass →')).toBe(1);
    expect(enabled(mine, 'Lock → Scoring')).toBe(1);
    // And the scoring window's Pass on the coach's beat.
    const sc = openRolling(tutorialStart());
    const win = { ...sc, scoringPasses: 0, scoringTurn: 'B' };
    expect(enabled(tutorialBoard(win), 'Pass →')).toBe(0);
    expect(enabled(hotseatBoard(win), 'Pass →')).toBe(1);
  });
});

describe('one whose-die line', () => {
  it('the Scoreboard and the phase bar both print engine.js rollTurnLine', async () => {
    const { readFileSync } = await import('node:fs');
    const board = readFileSync(new URL('./CourtBoard.jsx', import.meta.url), 'utf8');
    const score = readFileSync(new URL('./Scoreboard.jsx', import.meta.url), 'utf8');
    for (const src of [board, score]) {
      expect(src).toMatch(/rollTurnLine\(game, rollGate\)/);
      expect(src).not.toMatch(/'All rolls in'|"Coach's roll"/);
    }
  });
});

// ── 2026-09-18, round five: EVERY board with a coach ───────────────────────
//
// watchOnlyTeam defaults to coachTeam, so PlayTab's board against the coach
// (coachTeam="B", a rollGate, no watchOnlyTeam) is watch-only on the coach's
// side as the tutorial's is: the human never gets a live Roll, ⭐ Clutch or
// spend on the coach's slots, nor Pass/Lock on its turn, nor its Close Out.
// Hotseat and PvP have no coach and keep every control they had.

/** PlayTab's board against the coach, with PlayTab's own props. */
const coachBoard = g => renderToStaticMarkup(
  <CourtBoard
    game={g} setGame={noop} rollGate={rollGate(g)}
    onRoll={noop} onEndSection={noop} onExecCard={noop} onResolve={noop}
    onSpendAssist={noop} onSpendRebound={noop}
    onTimeout={noop} onEndTimeout={noop} onSearchCrunch={noop}
    coachTeam="B"
  />,
);
/** PvpGame's board, seen from `me`. */
const pvpBoard = (g, me, isMyTurn = true) => renderToStaticMarkup(
  <CourtBoard
    game={g} setGame={noop}
    onRoll={noop} onEndSection={noop} onExecCard={noop} onResolve={noop}
    onSpendAssist={noop} onSpendRebound={noop}
    pvpMode myTeamKey={me} isMyTurn={isMyTurn}
  />,
);

describe("the coach's side is watch-only on PlayTab's board too", () => {
  it("on the coach's die: no spend, no ⭐ Clutch and no live Roll on its slots", () => {
    const g = doRoll(crunchRolling(), 'A', 0);
    expect(rollGate(g)).toMatchObject({ A: false, B: true });
    const html = coachBoard(g);
    expect(html).not.toContain('3PT (5A)');
    expect(html).not.toContain('data-tutorial="clutch-B"');
    expect(enabled(html, '🎲 Roll')).toBe(0);
  });

  it("on your die: your five roll, the coach's slots neither roll nor read Their roll", () => {
    const html = coachBoard(crunchRolling());
    expect(enabled(html, '🎲 Roll')).toBe(5);
    expect(html).toContain('data-tutorial="clutch-A"');
    expect(html).not.toContain('Their roll');
  });

  it("Pass and Lock are dead on the coach's turn and live on yours", () => {
    const g = coachsWindow();
    expect(enabled(coachBoard(g), 'Pass →')).toBe(0);
    expect(enabled(coachBoard(g), 'Lock → Scoring')).toBe(0);
    expect(enabled(coachBoard({ ...g, matchupTurn: 'A' }), 'Pass →')).toBe(1);
    expect(enabled(coachBoard({ ...g, matchupTurn: 'A' }), 'Lock → Scoring')).toBe(1);
    const win = { ...openRolling(tutorialStart()), scoringPasses: 0, scoringTurn: 'B' };
    expect(enabled(coachBoard(win), 'Pass →')).toBe(0);
    expect(enabled(coachBoard({ ...win, scoringTurn: 'A' }), 'Pass →')).toBe(1);
  });

  it("offers no Close Out button for the coach's card on your announced check", () => {
    for (const cardId of ['green_light', 'from_way_downtown', 'catch_and_shoot']) {
      const g = openRolling(tutorialStart());
      getTeam(g, 'A').hand = [cardId, ...getTeam(g, 'A').hand.slice(1)];
      getTeam(g, 'B').hand = ['close_out', ...getTeam(g, 'B').hand.slice(1)];
      g.teamA.assists = 10;
      const res = execCard(g, 'A', cardId, aiBuildCardOpts(g, 'A', cardId));
      if (!(res.ok && res.game.pendingShotCheck?.teamKey === 'A')) continue;
      expect(coachBoard(res.game)).not.toContain('Close Out −3');
      expect(coachBoard(res.game)).toContain('▶ Resolve');
      return;
    }
    throw new Error('no card announced a check for A');
  });

  it("keeps the coach's hand face down — the derived side changes no panel", () => {
    const html = coachBoard(coachsWindow());
    expect(html).not.toContain('data-tutorial="hand-B"');
    expect(html).not.toContain('view only');
    expect(html).toContain('data-tutorial="hand-A"');
  });
});

describe('hotseat and PvP keep every control (no coach, nothing watched)', () => {
  it("hotseat: both sides' Rolls, spends and Clutch, and Pass on B's turn", () => {
    const g = doRoll(crunchRolling(), 'A', 0);
    const html = hotseatBoard(g);
    expect(html).toContain('3PT (5A)');
    expect(html).toContain('data-tutorial="clutch-B"');
    expect(enabled(html, '🎲 Roll')).toBe(9);   // no gate: A's four left and B's five
    expect(enabled(hotseatBoard(coachsWindow()), 'Pass →')).toBe(1);
  });

  it("PvP as B: B's slots roll and spend, and Pass/Lock are live on B's turn", () => {
    const g = doRoll(crunchRolling(), 'A', 0);
    const asB = pvpBoard(g, 'B');
    expect(asB).toContain('3PT (5A)');
    expect(asB).toContain('data-tutorial="clutch-B"');
    expect(enabled(asB, '🎲 Roll')).toBe(5);
    const win = coachsWindow();   // B's matchup turn
    expect(enabled(pvpBoard(win, 'B'), 'Pass →')).toBe(1);
    expect(enabled(pvpBoard(win, 'B'), 'Lock → Scoring')).toBe(1);
    // As A it is not your turn — PvP's own isMyTurn gate, as before.
    expect(enabled(pvpBoard(win, 'A', false), 'Pass →')).toBe(0);
  });
});

// A REGULATION PUT-BACK IS GONE IN OVERTIME (round five, 2026-09-18): the
// hand's ↩ Undo reads lastReturnedCard, which now counts each overtime as a
// section of its own.
describe("the hand's ↩ Undo across the end of regulation", () => {
  it('is not offered in overtime for a Q4 S3 put-back, and is for one put back inside overtime', () => {
    const g = openRolling(tutorialStart());
    g.quarter = 4; g.section = 3;
    const back = returnCardToDeck(g, 'A', 0);
    expect(tutorialBoard(back)).toContain('data-tutorial="hand-undo"');
    const ot = { ...back, overtime: 1 };
    expect(lastReturnedCard(ot, 'A')).toBeNull();
    expect(tutorialBoard(ot)).not.toContain('data-tutorial="hand-undo"');
    expect(tutorialBoard(returnCardToDeck(ot, 'A', 0))).toContain('data-tutorial="hand-undo"');
  });
});
