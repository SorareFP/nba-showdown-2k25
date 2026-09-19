// The tutorial lessons that read the board, checked against a board built by
// hand — the coach's counter-pick reasoning, the placement indicators, and the
// High Screen & Roll suggestion. Each text is computed from calcAdv, so the
// numbers here are the game's numbers.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getTeam, endSection, doRoll, matchupAdv, getPS, restMinutes, getFatigue, checkNeed, rollGate, CRUNCH_MARGIN, passTurn,
  crunchSearchOptions, clutchAvailable, clutchDiceFor, returnCardToDeck, undoReturnCard, lastReturnedCard,
  fatigueForMinutes, MAX_STRAIGHT_MINUTES, REST_CLEARS_AT, REST_RECOVERY, newGame, pendingRolls, canRollSlot,
} from './engine.js';
import {
  TUTORIAL_TOOLTIPS, TUTORIAL_ROSTER_A_IDS, TUTORIAL_ROSTER_B_IDS, restRuleText, SECTION_MINUTES, HOT_FROM, COLD_TO,
  markerStep, whatsNext, REB_LEAD_FOR_PAINT, HAND_SIZE, crunchContestBump, firstTiredMinutes, clutchGateMinutes,
} from './tutorialData.js';
import { CARD_MAP } from './cards.js';
import { forfeitNet, FORFEIT_CARDS, aiBuildCardOpts } from './ai.js';
import { execCard, resolveGoUnder } from './execCard.js';
import { myHouseTargets, canPlayCard } from './canPlay.js';
import { getStrat, TIMEOUT_RIDERS, CRUNCH_CARDS } from './strats.js';
import { AI_PAY } from './coinRewards.js';
import { DEFAULT_AI_LEVEL } from './aiLevels.js';
import { STRAT_COPY_CAPS } from './rarity.js';
import { placePlayer, placementSnapshot, canUndoPlacement, LINEUPS_LOCKED, DEFAULT_ORDER } from './placement.js';
import {
  tutorialReducer, tutorialEndSection, coachMayRoll, tutorialCoachStep, TUTORIAL_CRUNCH_LEAD, TUTORIAL_CLOSE_OVER,
} from './tutorialFlow.js';
import {
  seeded, tutorialStart, walkTutorial, lockLineups, runSnake, passToRolling, openRolling, FIRST_FIVE_A,
} from './tutorialWalk.testkit.js';

const mk = (id, speed, power, defBoost = 0) => ({
  id, name: id.replace(/_/g, ' '), team: 'TST', pos: 'PG', speed, power, defBoost,
  shotLine: 14, paintBoost: 1, threePtBoost: 1, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
});
const tip = id => TUTORIAL_TOOLTIPS.find(t => t.id === id);
const text = (id, g) => { const t = tip(id); return typeof t.text === 'function' ? t.text(g) : t.text; };
const detail = (id, g) => { const t = tip(id); return typeof t.detail === 'function' ? t.detail(g) : t.detail; };

/** Q1S1, placement under way: A led row 1 with Tatum, B answered with Mobley and led row 2 with Giannis. */
function midPlacement() {
  const A = [mk('Tatum', 12, 14), mk('Edwards', 12, 7), mk('Adebayo', 9, 16, 2), mk('Haliburton', 17, 5), mk('Bridges', 12, 11, 1)];
  const B = [mk('Mobley', 10, 14, 1), mk('Giannis', 12, 18), mk('Luka', 11, 10), mk('Shai', 15, 8), mk('Gobert', 6, 15, 3)];
  const g = newGame([...A, ...Array(5).fill(0).map((_, i) => mk(`a${i}`, 8, 8))], [...B, ...Array(5).fill(0).map((_, i) => mk(`b${i}`, 8, 8))]);
  g.phase = 'matchup_strats';
  g.draft = { ...(g.draft || {}), aPicks: A.map(p => p.id), bPicks: B.map(p => p.id) };
  getTeam(g, 'A').starters = [A[0]];
  getTeam(g, 'B').starters = [B[0], B[1]];
  g.placementStep = 3;
  g.matchupPasses = 0;
  return g;
}

describe('the placement lessons', () => {
  it('fire at the coach-answered step, in the order answer then indicators', () => {
    const g = midPlacement();
    const live = TUTORIAL_TOOLTIPS.filter(t => t.trigger.phase === g.phase && t.trigger.condition(g)).sort((a, b) => b.priority - a.priority).map(t => t.id);
    expect(live.slice(0, 2)).toEqual(['s1_place_answer', 's1_place_indicators']);
    g.placementStep = 0;
    expect(TUTORIAL_TOOLTIPS.filter(t => t.trigger.phase === g.phase && t.trigger.condition(g)).map(t => t.id)).toEqual(['s1_place_intro']);
  });

  it('explains the coach\'s answer with both directions of the pairing', () => {
    const g = midPlacement();
    const t = text('s1_place_answer', g);
    // Tatum S12 P14 vs Mobley S10 P14 Def+1: Tatum's Speed +2 soaks to +1; Mobley attacking Tatum is S−2 P0 → roll 0.
    expect(t).toContain('answered your Tatum (S12 P14) with Mobley (S10 P14 Def+1)');
    expect(t).toContain('your roll is +1');
    expect(t).toContain('the Def Boost soaks part of your edge');
    expect(t).toContain('theirs against you is 0');
  });

  it('reads the indicators for the row the coach led, and names the best answer by the coach\'s own score', () => {
    const g = midPlacement();
    const t = text('s1_place_indicators', g);
    expect(t).toContain('Now you answer row 2, where the coach led with Giannis (S12 P18)');
    expect(t).toContain('⚔ is your roll bonus attacking them, 🛡 is theirs attacking you');
    const d = detail('s1_place_indicators', g);
    // Adebayo (S9 P16 Def+2): Giannis S+3 P+2 → soaked by Def+2 to +1; Bam attacks Giannis at S−3 P−2 → −2 penalty. score −2−1+2 = −1.
    // Haliburton (S17 P5): attacks Giannis S+5 → +5; Giannis attacks him P+13 → 13. score −8.
    // Bridges (S12 P11 Def+1): Giannis S0 P+7 → +6; Bridges attacks S0 P−7 → penalty −7. score −13+1... the best is Adebayo.
    expect(d).toContain('Best answer right now, read as points on both charts: Adebayo');
  });
});

describe('the High Screen & Roll lesson', () => {
  it('names the swap that gains the most, with before-and-after numbers', () => {
    const g = midPlacement();
    // Everyone placed, identity rows: Tatum/Mobley, Edwards/Giannis, Adebayo/Luka, Haliburton/Shai, Bridges/Gobert.
    const A = getTeam(g, 'A'); const B = getTeam(g, 'B');
    A.starters = g.draft.aPicks.map(id => A.roster.find(r => r.id === id));
    B.starters = g.draft.bPicks.map(id => B.roster.find(r => r.id === id));
    g.placementStep = 10; g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
    A.hand = ['high_screen_roll', ...A.hand.filter(id => id !== 'high_screen_roll').slice(0, 6)];
    const live = TUTORIAL_TOOLTIPS.filter(t => t.trigger.phase === g.phase && t.trigger.condition(g)).map(t => t.id);
    expect(live).toContain('s1_matchup_window');
    const t = text('s1_matchup_window', g);
    expect(t).toMatch(/Your High Screen & Roll is lit/);
    expect(t).toMatch(/Best swap now: .+ and .+ trade defenders — .+'s roll goes from [+−-]?\d+ to [+−-]?\d+/);
    // Your copy only: the coach's hand is dealt face up in the tutorial.
    expect(tip('s1_matchup_window').highlight).toBe('[data-tutorial="card-A-high_screen_roll"]');
  });

  it('narrates the switch that landed, and the switch that was cancelled, from this section\'s log only', () => {
    const g = midPlacement();
    g.placementStep = 10; g.matchupTurn = 'A'; g.matchupPasses = 1;
    g.log = [
      { team: null, msg: 'Lineups locked — begin placement.' },
      { team: 'A', msg: 'High Screen & Roll: Tatum now guarded by Giannis, Edwards now guarded by Mobley' },
      { team: 'B', msg: 'Passed.' },
    ];
    const live = () => TUTORIAL_TOOLTIPS.filter(t => (!t.trigger.phase || t.trigger.phase === g.phase) && t.trigger.condition(g)).map(t => t.id);
    expect(live()).toContain('s1_switch_landed');
    expect(text('s1_switch_landed', g)).toBe('Your switch went through — Tatum now guarded by Giannis, Edwards now guarded by Mobley. The coach passed: it had nothing in hand to answer with.');

    // The coach may answer with some other card instead of passing — still landed.
    g.log[2] = { team: 'B', msg: 'Stagger Action: Shai & Luka screen for each other' };
    g.matchupPasses = 0;
    expect(live()).toContain('s1_switch_landed');
    expect(text('s1_switch_landed', g)).toMatch(/The coach played Stagger Action instead of answering it — it holds no canceller\.$/);
    // Before the coach has replied at all, nothing yet.
    g.log.pop();
    expect(live()).not.toContain('s1_switch_landed');

    // Section 2: last section's switch line must not count; the cancel must.
    g.section = 2; g.matchupPasses = 0;
    g.log.push({ team: null, msg: 'Lineups locked — begin placement.' });
    getTeam(g, 'A').hand = ['high_screen_roll', 'extra_pass'];
    expect(live()).toContain('s2_switch_again');
    expect(live()).not.toContain('s2_switch_cancelled');
    g.log.push({ team: 'A', msg: 'High Screen & Roll: Tatum now guarded by Giannis, Edwards now guarded by Mobley' });
    g.log.push({ team: 'B', msg: 'Go Under: canceled HSR — Team A chooses which of Tatum / Edwards takes a 3PT check at +2 · Tatum guarded again by Mobley, Edwards by Giannis' });
    // The choice is waiting on you, as execCard leaves it.
    g.pendingChoice = { kind: 'go_under', teamKey: 'A', slots: [0, 1], extra: 2, by: 'B' };
    expect(live()).not.toContain('s2_switch_again');
    expect(live()).toContain('s2_switch_cancelled');
    expect(text('s2_switch_cancelled', g)).toBe("The coach answered with Go Under: your switch is cancelled and the pairings stay as they were placed. Go Under's price is yours to spend: pick which of the two players takes a 3PT check at +2 — the banner shows the die each one needs. (Team A chooses which of Tatum / Edwards takes a 3PT check at +2 · Tatum guarded again by Mobley, Edwards by Giannis.)");
  });

  it('says to hold it when no swap gains', () => {
    const g = midPlacement();
    const A = getTeam(g, 'A'); const B = getTeam(g, 'B');
    // Five identical pairings: no swap can change anything.
    A.starters = Array.from({ length: 5 }, (_, i) => mk(`x${i}`, 10, 10));
    B.starters = Array.from({ length: 5 }, (_, i) => mk(`y${i}`, 10, 10));
    g.placementStep = 10; g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
    expect(text('s1_matchup_window', g)).toMatch(/no swap gains anything/);
  });
});

// ── 2026-09-18: the tutorial, up to today's rules ────────────────────────────
//
// Every lineup lesson keyed on `draft.step`, which the engine stopped writing,
// and none of them fired for weeks without a test noticing — because the tests
// wrote the field themselves. These reach every state through the real steps
// (tutorialWalk.testkit.js: the lineup submit, placePlayer, passTurn, doRoll,
// the tutorial's own reducer) and never write `phase` or `scoringPasses`, so a
// trigger keyed to a field the engine stops writing fails here too.

afterEach(() => { vi.restoreAllMocks(); });

const liveIds = g => TUTORIAL_TOOLTIPS
  .filter(t => (!t.trigger.phase || t.trigger.phase === g.phase) && t.trigger.condition(g))
  .sort((a, b) => b.priority - a.priority)
  .map(t => t.id);

const tutorialGame = () => tutorialStart();
const FIRST_FIVE_B = TUTORIAL_ROSTER_B_IDS.slice(0, 5);

/** The lineup submit, the snake and both card windows passed: open rolling, through the real steps. */
const toRolling = (g, aIds = FIRST_FIVE_A, bIds = FIRST_FIVE_B) => openRolling(g, aIds, bIds);
function rollEveryone(g) {
  let ng = g;
  for (let i = 0; i < 5; i += 1) { ng = doRoll(ng, 'A', i); ng = doRoll(ng, 'B', i); }
  return ng;
}
/** Play the current section with the given fives and end it through the tutorial's reducer. */
const playSection = (g, aIds, bIds) => tutorialReducer(rollEveryone(toRolling(g, aIds, bIds)), { type: 'END_SECTION' });

describe('the walk reaches every state through the real steps', () => {
  it('opens rolling by passing, as the buttons do', () => {
    const g = toRolling(tutorialGame());
    expect(g.phase).toBe('scoring');
    expect(g.scoringPasses).toBe(99);
    expect(g.log.some(e => /Both passed — rolling begins!/.test(e.msg))).toBe(true);
  });
});

describe('the lineup lessons are alive', () => {
  it('a fresh tutorial game at the lineup screen has a live lesson, intro first', () => {
    const g = tutorialGame();
    expect(g.phase).toBe('draft');
    const live = liveIds(g);
    expect(live[0]).toBe('s1_draft_intro');
    expect(live).toContain('s1_draft_pick1');
  });

  it('every lineup screen of the tutorial has its lesson, through to the skip', () => {
    let g = tutorialGame();
    g = playSection(g);
    expect([g.quarter, g.section, g.phase]).toEqual([1, 2, 'draft']);
    expect(liveIds(g)).toContain('s2_draft_reminder');
    expect(liveIds(g)).not.toContain('s1_draft_intro');
    expect(text('s2_draft_reminder', g)).toContain(`have ${SECTION_MINUTES} minutes on the fatigue tracker`);

    g = playSection(g);
    expect([g.quarter, g.section, g.phase]).toEqual([1, 3, 'draft']);
    const s3 = liveIds(g);
    expect(s3.slice(0, 3)).toEqual(['s3_fatigue_warning', 's3_twelve_limit', 's3_sub_strategy']);

    g = playSection(g);
    expect([g.quarter, g.section, g.phase]).toEqual([4, 3, 'draft']);
    expect(liveIds(g).slice(0, 2)).toEqual(['s3_quarter_end', 's4_crunch_intro']);
  });

  it('the section-2 reminder quotes each player\'s own minutes when one of them was hounded', () => {
    // The coach's Pick Up Full Court puts +4 on one starter; the other four
    // are still at one section. The lesson used to quote the first name's
    // minutes for all five.
    let g = runSnake(lockLineups(tutorialGame(), FIRST_FIVE_A, FIRST_FIVE_B), { coachPicks: false });
    g = passTurn(g, 'A');
    g.teamB.hand = ['pick_up_full_court', ...g.teamB.hand.slice(1)];
    const res = execCard(g, 'B', 'pick_up_full_court', { targetIdx: 0 });
    expect(res.ok).toBe(true);
    g = tutorialReducer(rollEveryone(passToRolling(res.game)), { type: 'END_SECTION' });
    const hounded = g.teamA.roster.find(p => getPS(g, 'A', p.id).minutes === 2 * SECTION_MINUTES);
    expect(hounded).toBeTruthy();
    const t = text('s2_draft_reminder', g);
    expect(t).toContain(`${hounded.name} has ${2 * SECTION_MINUTES} minutes on the fatigue tracker — ${fatigueForMinutes(2 * SECTION_MINUTES)} already`);
    expect(t).toMatch(new RegExp(`have ${SECTION_MINUTES} minutes on the fatigue tracker — no penalty yet\\. Start them again and they reach ${2 * SECTION_MINUTES}: ${fatigueForMinutes(2 * SECTION_MINUTES)}`));
    // And it says WHY he has two sections' minutes after one.
    expect(t).toContain(`The coach's Pick Up Full Court put the extra ${SECTION_MINUTES} on ${hounded.name}.`);
    // One more section puts him AT the limit: the next is a MUST REST, not a
    // penalty he plays through (2026-09-18) — said from mustRest.
    const next = 3 * SECTION_MINUTES;
    if (next >= MAX_STRAIGHT_MINUTES) {
      expect(t).toContain(`Start him again and he reaches ${next}, the ${MAX_STRAIGHT_MINUTES}-minute limit: he must sit the section after.`);
      expect(t).not.toContain(`reaches ${next}: ${fatigueForMinutes(next)}`);
    } else {
      expect(t).toContain(`Start him again and he reaches ${next}: ${fatigueForMinutes(next)}`);
    }
    // The S3 lessons wait for S3: at S2 three lessons in a row repeated his
    // 8 minutes and spent the forward limit lesson before its screen.
    expect(liveIds(g)).not.toContain('s3_fatigue_warning');
    expect(liveIds(g)).not.toContain('s3_twelve_limit');
    expect(liveIds(g)).toEqual(['s2_draft_reminder']);
    // The S3 fatigue lesson agrees with it: only he is tired.
    expect(text('s3_fatigue_warning', g)).toContain(`${hounded.name} (${2 * SECTION_MINUTES} min`);
    for (const id of FIRST_FIVE_A) {
      const p = CARD_MAP[id];
      if (p.name !== hounded.name) expect(text('s3_fatigue_warning', g)).not.toContain(p.name);
    }
    // At S3 the limit lesson is still there to be read.
    g = playSection(g);
    expect([g.quarter, g.section, g.phase]).toEqual([1, 3, 'draft']);
    expect(liveIds(g)).toContain('s3_twelve_limit');
    expect(liveIds(g)).toContain('s3_fatigue_warning');
  });

  it('the section-2 reminder names no reason when nobody carries extra minutes', () => {
    const g = playSection(tutorialGame());
    expect(text('s2_draft_reminder', g)).not.toMatch(/Pick Up Full Court|more than one section puts on/);
  });

  it('the pick-one lesson adds something its text does not say, from the engine', () => {
    const g = tutorialGame();
    const d = detail('s1_draft_pick1', g);
    expect(d).toContain(`adds ${SECTION_MINUTES} minutes`);
    expect(d).toContain(`at ${firstTiredMinutes()} a player is ${fatigueForMinutes(firstTiredMinutes())}`);
    expect(fatigueForMinutes(firstTiredMinutes())).toBeLessThan(0);
    expect(fatigueForMinutes(firstTiredMinutes() - SECTION_MINUTES)).toBe(0);
    expect(`${text('s1_draft_pick1', g)} ${d}`).not.toMatch(/neutralize/);
  });
});

describe('the rest rule, computed', () => {
  it('matches what a section on the bench does to 4, 8, 12 and 16 minutes', () => {
    for (const m of [4, 8, 12, 16]) {
      const g = toRolling(tutorialGame());
      const benched = g.teamA.roster.find(p => !FIRST_FIVE_A.includes(p.id));
      getPS(g, 'A', benched.id).minutes = m;
      const after = getPS(endSection(g), 'A', benched.id).minutes;
      expect(after).toBe(restMinutes(m));
      expect(restRuleText()).toContain(`${m} rests to ${after}`);
    }
  });

  it('is the one rest text in the tutorial, and "sheds 4" is gone', () => {
    const g = tutorialGame();
    for (const t of TUTORIAL_TOOLTIPS) {
      for (const v of [t.text, t.detail]) {
        const s = typeof v === 'function' ? (() => { try { return v(g); } catch { return ''; } })() : (v || '');
        expect(s).not.toMatch(/sheds? 4|takes 4 minutes off/);
      }
    }
    expect(detail('s1_end_section', g)).toContain(restRuleText());
    expect(detail('s2_draft_reminder', g)).toContain(restRuleText());
  });

  it('the REB paint check opens at the rebound lead the lessons quote', () => {
    const at = lead => { const g = toRolling(tutorialGame()); g.teamA.rebounds = 10 + lead; g.teamB.rebounds = 10; return Boolean(endSection(g).reboundBonuses?.A?.paintCheck); };
    expect(at(REB_LEAD_FOR_PAINT)).toBe(true);
    expect(at(REB_LEAD_FOR_PAINT - 1)).toBe(false);
  });

  it('a section on the floor adds SECTION_MINUTES, as the lessons say', () => {
    const g = endSection(rollEveryone(toRolling(tutorialGame())));
    expect(getPS(g, 'A', FIRST_FIVE_A[0]).minutes).toBe(SECTION_MINUTES);
  });

  it('a hand is HAND_SIZE, dealt and drawn back to, as the lessons say', () => {
    const g = tutorialGame();
    expect(g.teamA.hand.length).toBe(HAND_SIZE);
    const played = toRolling(g);
    played.teamA.hand = played.teamA.hand.slice(2);
    expect(endSection(rollEveryone(played)).teamA.hand.length).toBe(HAND_SIZE);
  });

  it('no lesson spells a rule number in words where the constant belongs', () => {
    const g = tutorialGame();
    for (const t of TUTORIAL_TOOLTIPS) {
      for (const v of [t.text, t.detail]) {
        const s = typeof v === 'function' ? (() => { try { return v(g); } catch { return ''; } })() : (v || '');
        expect(s).not.toMatch(/[Tt]welve|seven-card/);
      }
    }
    expect(whatsNext().join(' ')).not.toMatch(/[Tt]welve/);
  });
});

describe('the twelve-straight limit', () => {
  it('is taught at the S3 lineup, to the starters one section from the limit, and not before', () => {
    let g = tutorialGame();
    g = playSection(g);
    expect(liveIds(g)).not.toContain('s3_twelve_limit');
    g = playSection(g);
    const t = text('s3_twelve_limit', g);
    expect(t).toContain(`${MAX_STRAIGHT_MINUTES} straight minutes is the limit`);
    expect(t).toContain(`Your five at ${2 * SECTION_MINUTES} minutes are one section from ${MAX_STRAIGHT_MINUTES}`);
    // Not the names again: s3_fatigue_warning, on the same screen, has just said them.
    expect(t).not.toContain(CARD_MAP[FIRST_FIVE_A[0]].name);
    // The tutorial's next section is Q4's last, where the rule is lifted — the lesson says so.
    expect(t).toMatch(/skips to the fourth quarter next, where the limit is lifted/);
    expect(tip('s3_twelve_limit').highlight).toContain('[data-tutorial="must-rest"]');
    // Somebody already at the limit is named as there now.
    getPS(g, 'A', FIRST_FIVE_A[0]).minutes = MAX_STRAIGHT_MINUTES;
    expect(text('s3_twelve_limit', g)).toContain(`${CARD_MAP[FIRST_FIVE_A[0]].name} is there now`);
  });

  it('is not taught where the rule is lifted — Q4 and overtime', () => {
    let g = tutorialGame();
    g = playSection(g); g = playSection(g); g = playSection(g);
    expect(g.quarter).toBe(4);
    getPS(g, 'A', FIRST_FIVE_A[0]).minutes = 2 * SECTION_MINUTES;
    expect(liveIds(g)).not.toContain('s3_twelve_limit');
  });
});

describe('fatigue on checks, and markers', () => {
  it('teaches fatigue on 3PT and paint checks with the die checkNeed prices', () => {
    const g = toRolling(tutorialGame());
    expect(liveIds(g)).not.toContain('s3_fatigue_checks');
    getPS(g, 'A', FIRST_FIVE_A[1]).minutes = 2 * SECTION_MINUTES;
    expect(liveIds(g)).toContain('s3_fatigue_checks');
    const t = text('s3_fatigue_checks', g);
    expect(t).toContain(`${CARD_MAP[FIRST_FIVE_A[1]].name} is carrying ${getFatigue(g, 'A', 1)}`);
    const need = checkNeed(g, 'A', 1, '3pt').need;
    if (need >= 2 && need <= 20) expect(t).toContain(`a 3PT check needs ${[8, 11, 18].includes(need) ? 'an' : 'a'} ${need}+`);
    expect(t).toContain('Free throws are exempt');
  });

  it('teaches markers when one of yours carries one, at the step shotCheck adds', () => {
    const g = toRolling(tutorialGame());
    expect(liveIds(g)).not.toContain('s1_markers');
    getPS(g, 'A', FIRST_FIVE_A[0]).hot = 1;
    expect(liveIds(g)).toContain('s1_markers');
    expect(text('s1_markers', g)).toContain(`+${markerStep()} on his scoring rolls AND his 3PT and paint checks`);
    expect(markerStep()).toBeGreaterThan(0);
    // A hot and a cold on one man cancel, and the lesson says so instead of "+0".
    getPS(g, 'A', FIRST_FIVE_A[0]).cold = 1;
    expect(text('s1_markers', g)).toContain('they cancel out');
    expect(text('s1_markers', g)).not.toMatch(/\+0/);
    // A holder whose markers do not cancel is preferred.
    getPS(g, 'A', FIRST_FIVE_A[1]).cold = 1;
    expect(text('s1_markers', g)).toContain(`${CARD_MAP[FIRST_FIVE_A[1]].name} is carrying 1 cold — -${markerStep()}`);
  });

  it('names only a player on the floor as the marker holder', () => {
    // A man who went hot in S2 and sits S3 keeps the marker until that
    // section ends; the lesson told him "+2 on his scoring rolls".
    const g = toRolling(tutorialGame());
    const benched = g.teamA.roster.find(p => !FIRST_FIVE_A.includes(p.id));
    getPS(g, 'A', benched.id).hot = 2;
    expect(liveIds(g)).not.toContain('s1_markers');
    getPS(g, 'A', FIRST_FIVE_A[2]).cold = 1;
    expect(liveIds(g)).toContain('s1_markers');
    expect(text('s1_markers', g)).not.toContain(benched.name);
    expect(text('s1_markers', g)).toContain(`${CARD_MAP[FIRST_FIVE_A[2]].name} is carrying 1 cold`);
  });

  it('quotes the marker dice doRoll actually uses', () => {
    const one = die => {
      vi.spyOn(Math, 'random').mockReturnValue((die - 1) / 20 + 0.001);
      const g = doRoll(toRolling(tutorialGame()), 'A', 0);
      vi.restoreAllMocks();
      return getPS(g, 'A', FIRST_FIVE_A[0]);
    };
    expect(one(HOT_FROM).hot).toBe(1);
    expect(one(HOT_FROM - 1).hot || 0).toBe(0);
    expect(one(COLD_TO).cold).toBe(1);
    expect(one(COLD_TO + 1).cold || 0).toBe(0);
  });
});

describe('the forfeit-family coach tip', () => {
  const s3Rolling = () => { let g = tutorialGame(); g = playSection(g); g = playSection(g); return toRolling(g); };

  it('fires when your hand holds one, pricing it with forfeitNet in expected points', () => {
    const g = s3Rolling();
    expect([g.quarter, g.section]).toEqual([1, 3]);
    getTeam(g, 'A').hand = ['high_screen_roll'];
    expect(liveIds(g)).not.toContain('s3_forfeit_tip');
    getTeam(g, 'A').hand = ['green_light'];
    expect(liveIds(g)).toContain('s3_forfeit_tip');
    const rows = [0, 1, 2, 3, 4].map(i => forfeitNet(g, 'A', i, 'green_light')).filter(Boolean).sort((a, b) => b.net - a.net);
    const best = rows[0];
    const t = text('s3_forfeit_tip', g);
    expect(t).toContain(`best now is ${best.player.name} at ${best.net >= 0 ? '+' : ''}${best.net.toFixed(1)}`);
    expect(t).toContain('expected points');
    expect(t).not.toContain('assists');
    expect(tip('s3_forfeit_tip').highlight).toContain('[data-tutorial="card-A-green_light"]');
    expect(tip('s3_forfeit_tip').highlight).not.toContain('card-B-');
  });

  it('names Cross-Court Dime\'s assist cost, which the net takes off', () => {
    const g = s3Rolling();
    getTeam(g, 'A').hand = ['cross_court_dime'];
    g.teamA.assists = 5;
    const t = text('s3_forfeit_tip', g);
    expect(t).toContain(`plus ${FORFEIT_CARDS.cross_court_dime.assists} assists`);
    const best = [0, 1, 2, 3, 4].map(i => forfeitNet(g, 'A', i, 'cross_court_dime')).filter(Boolean).sort((a, b) => b.net - a.net)[0];
    expect(t).toContain(`less ${best.cost.toFixed(1)} for the assists`);
  });

  it('is not taught in the first section, which has lessons enough', () => {
    const g = toRolling(tutorialGame());
    getTeam(g, 'A').hand = ['green_light'];
    expect(liveIds(g)).not.toContain('s3_forfeit_tip');
  });
});

describe('undo: a placement, and a card put back', () => {
  it('teaches placement undo exactly while the board can undo it', () => {
    let g = lockLineups(playSection(tutorialGame()), FIRST_FIVE_A, FIRST_FIVE_B);
    const snap = placementSnapshot(g);
    g = placePlayer(g, FIRST_FIVE_A[0]);
    g = placePlayer(g, FIRST_FIVE_B[0]);
    expect(liveIds(g)).not.toContain('s2_place_undo');
    g = placePlayer(g, FIRST_FIVE_B[1]);
    expect(g.placementStep).toBe(3);
    expect(canUndoPlacement(g, snap)).toBe(true);
    expect(liveIds(g)).toContain('s2_place_undo');
    expect(text('s2_place_undo', g)).toContain(`takes ${CARD_MAP[FIRST_FIVE_A[0]].name} back off the floor`);
    // A card played ends the undo, and the lesson with it.
    g.teamA.hand = ['stagger_action', ...g.teamA.hand.slice(1)];
    const res = execCard(g, 'A', 'stagger_action', aiBuildCardOpts(g, 'A', 'stagger_action'));
    if (res.ok) {
      expect(canUndoPlacement(res.game, snap)).toBe(false);
      expect(liveIds(res.game)).not.toContain('s2_place_undo');
    }
    g.log = [...g.log, { team: 'A', msg: 'Stagger Action: two screens' }];
    expect(canUndoPlacement(g, snap)).toBe(false);
    expect(liveIds(g)).not.toContain('s2_place_undo');
  });

  it('teaches the put-back undo while lastReturnedCard offers it', () => {
    const g = toRolling(tutorialGame());
    const back = returnCardToDeck(g, 'A', 0);
    expect(liveIds(back)).toContain('s1_putback_undo');
    expect(tip('s1_putback_undo').highlight).toBe('[data-tutorial="hand-undo"]');
    expect(text('s1_putback_undo', back)).toContain(lastReturnedCard(back, 'A').name);
    expect(liveIds(undoReturnCard(back, 'A'))).not.toContain('s1_putback_undo');
    expect(text('s1_first_card', g)).not.toMatch(/[Hh]over/);
  });
});

describe('the section-1 card windows', () => {
  /** Q1 S1, the snake run, the matchup window open on your turn. */
  const window1 = () => runSnake(lockLineups(tutorialGame(), FIRST_FIVE_A, FIRST_FIVE_B), { coachPicks: false });
  const hsr = (g, k) => {
    getTeam(g, k).hand = ['high_screen_roll', ...getTeam(g, k).hand.filter(id => id !== 'high_screen_roll').slice(0, 6)];
    return execCard(g, k, 'high_screen_roll', aiBuildCardOpts(g, k, 'high_screen_roll'));
  };

  it('teaches the pass-count reset and Lock once a card has been played and answered', () => {
    let g = window1();
    const mine = hsr(g, 'A');
    expect(mine.ok).toBe(true);
    g = passTurn(mine.game, 'B');
    expect(g.matchupTurn).toBe('A');
    expect(liveIds(g)).toContain('s1_priority_reset');
    expect(liveIds(g)).toContain('s1_switch_landed');
    expect(text('s1_priority_reset', g)).toMatch(/resets the pass count to 0.*count reads 1\/2 — pass now and the window closes/);
    expect(tip('s1_priority_reset').highlight).toBe('[data-tutorial="lock-scoring"]');
  });

  it('still teaches them when the coach answers your switch with a switch of its own', () => {
    let g = window1();
    const mine = hsr(g, 'A');
    expect(mine.ok).toBe(true);
    const theirs = hsr(mine.game, 'B');
    expect(theirs.ok).toBe(true);
    g = theirs.game;
    expect(g.matchupTurn).toBe('A');
    expect(g.matchupPasses).toBe(0);
    const live = liveIds(g);
    expect(live).toContain('s1_switch_landed');
    expect(live).toContain('s1_priority_reset');
    expect(text('s1_switch_landed', g)).toContain('The coach answered with a switch of its own');
    expect(text('s1_priority_reset', g)).toContain('reset it again: 0/2');
  });

  // 2026-09-18: High Screen & Roll is playable during placement, and the
  // coach's next team-B line was then its placement ("X takes the floor."),
  // narrated as a card it played; the window opening at 0/2 read as a card too.
  it('waits for the coach\'s WINDOW move when your switch came during placement', () => {
    let g = lockLineups(tutorialGame(), FIRST_FIVE_A, FIRST_FIVE_B);
    while ((g.placementStep ?? 10) < 4) {
      const k = g.placementOrder[g.placementStep];
      const picks = k === 'A' ? g.draft.aPicks : g.draft.bPicks;
      g = placePlayer(g, picks.find(id => !getTeam(g, k).starters.some(p => p.id === id)));
    }
    expect(getTeam(g, 'A').starters.length).toBeGreaterThanOrEqual(2);
    const mine = hsr(g, 'A');
    expect(mine.ok).toBe(true);
    g = runSnake(mine.game);
    expect(g.placementStep).toBe(10);
    expect(g.matchupTurn).toBe('A');
    expect(g.matchupPasses).toBe(0);
    // The coach placed after your switch but has not moved in the window.
    expect(g.log.some(e => e.team === 'B' && /takes the floor\.$/.test(e.msg))).toBe(true);
    let live = liveIds(g);
    expect(live).not.toContain('s1_switch_landed');
    expect(live).not.toContain('s1_priority_reset');
    expect(text('s1_priority_reset', g)).toContain('The window has just opened and the coach has not moved yet: 0/2.');
    expect(text('s1_priority_reset', g)).not.toMatch(/last move was a card/);

    // You pass; the coach answers with a switch of its own: THAT is its reply.
    g = passTurn(g, 'A');
    const theirs = hsr(g, 'B');
    expect(theirs.ok).toBe(true);
    g = theirs.game;
    expect(g.matchupTurn).toBe('A');
    live = liveIds(g);
    expect(live).toContain('s1_switch_landed');
    expect(live).toContain('s1_priority_reset');
    for (const id of ['s1_switch_landed', 's1_priority_reset']) {
      expect(text(id, g)).not.toMatch(/takes the floor/);
      expect(text(id, g)).not.toMatch(/played .* takes the floor/);
    }
    expect(text('s1_switch_landed', g)).toContain('The coach answered with a switch of its own');
    expect(text('s1_priority_reset', g)).toContain('reset it again: 0/2');
  });

  it('keeps the scoring-window lesson up when the coach passes first', () => {
    let g = passTurn(passTurn(window1(), 'A'), 'B');
    expect(g.phase).toBe('scoring');
    expect(liveIds(g)[0]).toBe('s1_scoring_intro');
    g = passTurn(g, g.scoringTurn);
    expect(g.scoringPasses).toBe(1);
    expect(liveIds(g)[0]).toBe('s1_scoring_intro');
    g = passTurn(g, g.scoringTurn);
    expect(liveIds(g)).not.toContain('s1_scoring_intro');
  });

  it('shows the section-end lesson when a roll was shut out, as the End Section button does', () => {
    // Find a pairing where one of the coach's five out-speeds AND out-powers
    // the man he guards, so This Is My House has a target.
    let found = null;
    for (const d of TUTORIAL_ROSTER_B_IDS) {
      for (let row = 0; row < 5 && !found; row += 1) {
        const bIds = FIRST_FIVE_B.filter(id => id !== d).slice(0, 4);
        bIds.splice(row, 0, d);
        const g = passTurn(passTurn(runSnake(lockLineups(tutorialGame(), FIRST_FIVE_A, bIds), { coachPicks: false }), 'A'), 'B');
        if (myHouseTargets(g, 'B').length) found = g;
      }
      if (found) break;
    }
    expect(found).toBeTruthy();
    let g = found;
    if (g.scoringTurn === 'A') g = passTurn(g, 'A');
    g.teamB.hand = ['this_is_my_house', ...g.teamB.hand.slice(1)];
    const res = execCard(g, 'B', 'this_is_my_house', aiBuildCardOpts(g, 'B', 'this_is_my_house'));
    expect(res.ok).toBe(true);
    g = passToRolling(res.game);
    for (let i = 0; i < 5; i += 1) {
      if (!g.blockedRolls?.A?.[i]) g = doRoll(g, 'A', i);
      if (!g.blockedRolls?.B?.[i]) g = doRoll(g, 'B', i);
    }
    expect(Object.keys(g.blockedRolls.A)).toHaveLength(1);
    expect(liveIds(g)).toContain('s1_end_section');
  });
});

describe('the a-b-a-b roll on the tutorial board', () => {
  it('lets the coach roll only when rollGate says so', () => {
    let g = toRolling(tutorialGame());
    expect(rollGate(g)).toEqual({ A: true, B: false });
    expect(coachMayRoll(g)).toBe(false);           // you lead
    g = doRoll(g, 'A', 0);
    expect(coachMayRoll(g)).toBe(true);            // the coach follows
    g = doRoll(g, 'B', 0);
    expect(coachMayRoll(g)).toBe(false);
    for (let i = 1; i < 5; i += 1) g = doRoll(g, 'A', i);
    expect(coachMayRoll(g)).toBe(true);            // you are done: it finishes
  });

  it('does not let the coach roll before rolling opens', () => {
    const g = passTurn(passTurn(runSnake(lockLineups(tutorialGame(), FIRST_FIVE_A, FIRST_FIVE_B), { coachPicks: false }), 'A'), 'B');
    expect(g.phase).toBe('scoring');
    expect(coachMayRoll(g)).toBe(false);
  });
});

describe('the section-1 wording', () => {
  it('puts the reaction window after the coach\'s die, the hand in the Team A panel, and does not promise a coach that weighs its cancel', () => {
    const g = toRolling(tutorialGame());
    const roll = text('s1_rolling_open', g);
    expect(roll).toContain('the turn comes back to you. That is when a reaction to its die');
    expect(roll).not.toMatch(/that is your moment to play a reaction/);
    expect(text('s1_first_card', g)).toContain('Your hand (the Team A panel)');
    expect(text('s1_first_card', g)).not.toMatch(/on the left/);
    expect(detail('s1_switch_landed', g)).toContain('in the tutorial it always answers');
    expect(detail('s1_switch_landed', g)).not.toMatch(/only when the switch cost it/);
  });
});

describe('the tutorial coach (tutorialCoachStep, what TutorialGame dispatches)', () => {
  const ROLLISH = new Set(['ROLL', 'TIMEOUT', 'SEARCH_CRUNCH', 'END_TIMEOUT']);

  it('never rolls, calls a timeout or searches while rollGate says it is your die', () => {
    // Every state of two whole tutorials, crunch included.
    const states = [];
    for (const seed of [11, 12]) {
      vi.spyOn(Math, 'random').mockImplementation(seeded(seed));
      try { walkTutorial(tutorialStart(), { onState: x => states.push(x) }); } finally { vi.restoreAllMocks(); }
    }
    let gated = 0;
    for (const g of states) {
      if (g.phase !== 'scoring' || g.scoringPasses < 99 || rollGate(g).B) continue;
      gated += 1;
      const a = tutorialCoachStep(g);
      expect(a && ROLLISH.has(a.type) ? `${a.type} at Q${g.quarter}S${g.section}` : null).toBe(null);
    }
    expect(gated).toBeGreaterThan(20);
  });

  it('waits while your timeout is on', () => {
    let g = tutorialGame();
    g = playSection(g); g = playSection(g); g = playSection(g);
    g = tutorialReducer(toRolling(g), { type: 'TIMEOUT', teamKey: 'A' });
    expect(g.timeoutActive).toBe('A');
    // Even with the coach behind on rolls, it does nothing.
    g = doRoll(g, 'A', 0);
    expect(g.timeoutActive).toBe('A');
    expect(tutorialCoachStep(g)).toBe(null);
  });

  it('rolls on its die, and answers your switch with its canceller (demo)', () => {
    const g = doRoll(toRolling(tutorialGame()), 'A', 0);
    expect(tutorialCoachStep(g)).toMatchObject({ type: 'ROLL', teamKey: 'B' });
    expect(tutorialCoachStep(doRoll(g, 'B', 0))).toBe(null);
  });

  /** A card that announces a 3PT check, played for real by `k` in open rolling while the other side holds Close Out. */
  function announced(k) {
    const other = k === 'A' ? 'B' : 'A';
    for (const cardId of ['green_light', 'from_way_downtown', 'catch_and_shoot']) {
      let g = toRolling(tutorialGame());
      if (k === 'B') g = doRoll(g, 'A', 0);
      getTeam(g, k).hand = [cardId, ...getTeam(g, k).hand.slice(1)];
      getTeam(g, other).hand = ['close_out', ...getTeam(g, other).hand.slice(1)];
      g[`team${k}`].assists = 10;
      const res = execCard(g, k, cardId, aiBuildCardOpts(g, k, cardId));
      if (res.ok && res.game.pendingShotCheck?.teamKey === k) return res.game;
    }
    return null;
  }

  it("leaves the coach's own announced checks for YOUR ▶ Resolve, as PlayTab does", () => {
    const g = announced('B');
    expect(g).toBeTruthy();
    expect(tutorialCoachStep(g)).toBe(null);
  });

  it('answers a check on your shooter with its reaction, then lets the die fly', () => {
    const g = announced('A');
    expect(g).toBeTruthy();
    const first = tutorialCoachStep(g);
    expect(first.type).toBe('UPDATE');
    expect(first.game.pendingShotCheck?.reacted).toBeTruthy();
    expect(tutorialCoachStep(first.game)).toEqual({ type: 'RESOLVE_CHECK' });
  });

  it('is the only coach TutorialGame runs', async () => {
    // The component used to carry its own copy of these decisions, which no
    // test reached. It must dispatch tutorialCoachStep and make none itself.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../components/TutorialGame.jsx', import.meta.url), 'utf8');
    expect(src).toMatch(/tutorialCoachStep\(game\)/);
    expect(src).not.toMatch(/from '\.\.\/game\/ai\.js'/);
    expect(src).toMatch(/rollGate=\{rollGate\(game\)\}/);
  });
});

describe('the fourth section: Crunch Time', () => {
  const toQ4 = () => { let g = tutorialGame(); g = playSection(g); g = playSection(g); return rollEveryone(toRolling(g)); };

  it('skips from Q1 to Q4 section 3 with Crunch Time armed by the engine', () => {
    const g = tutorialReducer(toQ4(), { type: 'END_SECTION' });
    expect([g.quarter, g.section, g.phase, g.overtime || 0]).toEqual([4, 3, 'draft', 0]);
    expect(g.crunch.active).toBe(true);
    expect(g.crunch.margin).toBeLessThanOrEqual(TUTORIAL_CLOSE_OVER);
    expect(g.log.some(e => /CRUNCH TIME — final section/.test(e.msg))).toBe(true);
    // Halftime wiped the tracker: only the five who played Q1's last section carry it.
    for (const ps of g.teamA.stats) expect(ps.minutes).toBeLessThanOrEqual(SECTION_MINUTES);
    expect(text('s4_crunch_intro', g)).toContain(`the margin is ${g.crunch.margin}, inside ${CRUNCH_MARGIN}`);
    // The contest is explained before it is bumped, under the name every lesson uses.
    expect(text('s4_crunch_intro', g)).toContain(`Def Boost is always taken off the 3PT and paint checks of the man he guards — his contest; in Crunch Time he takes ${crunchContestBump()} more`);
    for (const t of TUTORIAL_TOOLTIPS) {
      for (const v of [t.text, t.detail]) {
        const s = typeof v === 'function' ? (() => { try { return v(g); } catch { return ''; } })() : (v || '');
        expect(s).not.toMatch(/Defensive (Boost|Bonus)/);
      }
    }
  });

  it('closes a wide first quarter to within the tutorial lead, says so, and keeps it off the on-floor stats', () => {
    const q1 = toQ4();
    const onfBefore = Object.fromEntries(q1.teamA.stats.map(ps => [ps.id, ps.onf || 0]));
    const secA = q1.teamA.score - q1.secStart.A;
    q1.teamA.score = q1.secStart.A + secA;
    q1.teamB.score = q1.teamA.score + TUTORIAL_CLOSE_OVER + 5;
    q1.secStart = { ...q1.secStart, B: q1.teamB.score - 3 };
    const from = { A: q1.teamA.score, B: q1.teamB.score };
    const g = tutorialEndSection(q1);
    expect(g.crunch.active).toBe(true);
    expect(g.teamB.score - g.teamA.score).toBe(TUTORIAL_CRUNCH_LEAD);
    expect(g.log.some(e => /brought to within/.test(e.msg))).toBe(true);
    // The raised points are nobody's: A's five get this section's own points, not the gift.
    for (const id of FIRST_FIVE_A) {
      const ps = g.teamA.stats.find(s => s.id === id);
      expect((ps.onf || 0) - onfBefore[id]).toBe(Math.max(0, secA));
    }
    expect(text('s3_quarter_end', g)).toContain(`(The first quarter ended ${from.A}–${from.B}; the tutorial brought ${g.teamA.name} to within ${TUTORIAL_CRUNCH_LEAD} so the finish is close.)`);
  });

  it('leaves a first quarter already close enough alone', () => {
    const q1 = toQ4();
    q1.teamB.score = q1.teamA.score + TUTORIAL_CLOSE_OVER;
    const g = tutorialEndSection(q1);
    expect(g.teamB.score - g.teamA.score).toBe(TUTORIAL_CLOSE_OVER);
    expect(g.tutorialStaged).toBeFalsy();
    expect(text('s3_quarter_end', g)).not.toContain('the tutorial brought');
  });

  it('offers the timeout, the search and the clutch possession, through the tutorial reducer', () => {
    let g = tutorialGame();
    g = playSection(g); g = playSection(g); g = playSection(g);
    g = toRolling(g);
    expect(liveIds(g)[0]).toBe('s4_timeout');
    expect(tip('s4_timeout').highlight).toBe('[data-tutorial="timeout"]');
    expect(text('s4_timeout', g)).toContain('one per team in Crunch Time (an overtime brings a fresh one)');
    if (!g.teamA.deck.includes('reset')) g.teamA.deck = ['reset', ...g.teamA.deck];
    g = tutorialReducer(g, { type: 'TIMEOUT', teamKey: 'A' });
    expect(g.timeoutActive).toBe('A');
    expect(liveIds(g)).toContain('s4_timeout_search');
    expect(liveIds(g)).not.toContain('s4_timeout');
    expect(text('s4_timeout_search', g)).toContain(`over the ${HAND_SIZE}-card limit`);
    const card = crunchSearchOptions(g, 'A')[0];
    g = tutorialReducer(g, { type: 'SEARCH_CRUNCH', teamKey: 'A', cardId: card });
    expect(g.teamA.hand).toContain(card);
    expect(liveIds(g)[0]).toBe('s4_timeout_resume');
    expect(text('s4_timeout_resume', g)).toContain('spent for this section');
    g = tutorialReducer(g, { type: 'END_TIMEOUT' });
    expect(g.timeoutActive).toBe(null);
    expect(clutchAvailable(g, 'A')).toBe(1);
    expect(liveIds(g)).toContain('s4_clutch');
    // The coach's award winners are labelled as the coach's.
    const t = text('s4_clutch', g);
    expect(t).not.toMatch(/CPOY/);
    for (const p of g.teamB.starters) if (clutchDiceFor(g, p) > clutchDiceFor(g, {})) expect(t).toContain(`the coach's ${p.name} rolls`);
    const before = g.crunch.used?.A || 0;
    g = tutorialReducer(g, { type: 'ROLL', teamKey: 'A', idx: 0, opts: { clutch: true } });
    expect(g.crunch.used.A).toBe(before + 1);
    expect(liveIds(g)).not.toContain('s4_clutch');
  });

  it('shows the clutch lesson only on your die, where the ⭐ Clutch button is', () => {
    let g = tutorialGame();
    g = playSection(g); g = playSection(g); g = playSection(g);
    g = toRolling(g);
    g = tutorialReducer(g, { type: 'TIMEOUT', teamKey: 'A' });
    g = tutorialReducer(g, { type: 'END_TIMEOUT' });
    expect(liveIds(g)).toContain('s4_clutch');
    g = doRoll(g, 'A', 1);
    expect(rollGate(g).A).toBe(false);
    expect(liveIds(g)).not.toContain('s4_clutch');
  });

  it('drops the clutch lesson with the button: once your rolls are in, and when nobody left to roll is fresh enough', () => {
    // A human who never presses ⭐ Clutch: rollGate reads A:true once every
    // roll is in, and the lesson stayed up over a board with no button.
    vi.spyOn(Math, 'random').mockImplementation(seeded(7));
    const states = [];
    try { walkTutorial(tutorialStart(), { noClutch: true, onState: x => states.push(x) }); } finally { vi.restoreAllMocks(); }
    const crunchRolling = states.filter(x => x.crunch?.active && x.phase === 'scoring' && x.scoringPasses >= 99 && !x.timeoutActive);
    expect(crunchRolling.some(x => liveIds(x).includes('s4_clutch'))).toBe(true);
    const allIn = crunchRolling.filter(x => pendingRolls(x, 'A') === 0);
    expect(allIn.length).toBeGreaterThan(0);
    for (const x of allIn) expect(liveIds(x)).not.toContain('s4_clutch');

    // Every slot still to roll belongs to a player too tired to go clutch.
    let g = tutorialGame();
    g = playSection(g); g = playSection(g); g = playSection(g);
    g = tutorialReducer(tutorialReducer(toRolling(g), { type: 'TIMEOUT', teamKey: 'A' }), { type: 'END_TIMEOUT' });
    expect(liveIds(g)).toContain('s4_clutch');
    for (const p of g.teamA.starters) getPS(g, 'A', p.id).minutes = clutchGateMinutes();
    expect([0, 1, 2, 3, 4].some(i => canRollSlot(g, 'A', i))).toBe(true);
    expect(rollGate(g).A).toBe(true);
    expect(liveIds(g)).not.toContain('s4_clutch');
  });

  it('says what the skip left on the tracker, and the timeout detail does not repeat its text', () => {
    const g = tutorialReducer(toQ4(), { type: 'END_SECTION' });
    expect(text('s3_quarter_end', g)).toContain(`the five who just played carry that one section (${SECTION_MINUTES} minutes)`);
    const played = g.teamA.stats.filter(ps => ps.minutes > 0);
    for (const ps of played) expect(ps.minutes).toBe(SECTION_MINUTES);
    expect(detail('s4_timeout', g)).toBe('An unused timeout does not carry over.');
    expect(text('s4_timeout', g)).toContain('an overtime brings a fresh one');
  });

  it('a tie at the end of the section goes to overtime, and the lesson follows', () => {
    let g = tutorialGame();
    g = playSection(g); g = playSection(g); g = playSection(g);
    g = rollEveryone(toRolling(g));
    g.teamB.score = g.teamA.score;
    g = tutorialReducer(g, { type: 'END_SECTION' });
    expect(g.overtime).toBe(1);
    expect(g.crunch.active).toBe(true);
    expect(liveIds(g)[0]).toBe('s4_overtime');
    expect(liveIds(g)).not.toContain('s3_quarter_end');
    // Not tied: the game ends, which is the tutorial's completion.
    let h = tutorialGame();
    h = playSection(h); h = playSection(h); h = playSection(h);
    h = rollEveryone(toRolling(h));
    h.teamB.score = h.teamA.score + 1;
    expect(tutorialReducer(h, { type: 'END_SECTION' }).done).toBe(true);
  });
});

describe('the whole tutorial, played', () => {
  // Two seeded walks, one levelled at the final buzzer so it reaches
  // overtime. Every lesson must be live somewhere in them: a new lesson, or a
  // renamed engine field under an old one, that no real game state can reach
  // fails here instead of shipping dead.
  const walk = (seed, tieAtEnd) => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(seed));
    const states = [];
    try { walkTutorial(tutorialStart(), { tieAtEnd, onState: g => states.push(g) }); } finally { vi.restoreAllMocks(); }
    return states;
  };
  const states = [...walk(1001, false), ...walk(1002, true)];

  it('every lesson is live at least once', () => {
    const seen = new Set();
    for (const g of states) for (const id of liveIds(g)) seen.add(id);
    expect(TUTORIAL_TOOLTIPS.map(t => t.id).filter(id => !seen.has(id))).toEqual([]);
  });

  it('no two lessons live at the same moment share a priority', () => {
    // The overlay orders live lessons by priority alone; a tie is left to
    // the array's order, which nobody chose.
    const clashes = new Set();
    for (const g of states) {
      const live = TUTORIAL_TOOLTIPS.filter(t => (!t.trigger.phase || t.trigger.phase === g.phase) && t.trigger.condition(g));
      for (const a of live) for (const b of live) if (a.id < b.id && a.priority === b.priority) clashes.add(`${a.id}+${b.id}`);
    }
    expect([...clashes]).toEqual([]);
  });

  it('every lesson reads the board without failing, prints no hole, and spells no rule number in words', () => {
    for (const g of states) {
      for (const t of TUTORIAL_TOOLTIPS) {
        if (!((!t.trigger.phase || t.trigger.phase === g.phase) && t.trigger.condition(g))) continue;
        for (const v of [t.text, t.detail]) {
          const s = typeof v === 'function' ? v(g) : (v || '');
          expect(s).not.toMatch(/undefined|NaN|\bnull\b/);
          // A word beside a computed constant drifts when the constant moves;
          // one name per stat (Def Boost); awards spelled out; the timeout is
          // per Crunch-Time section, not per game.
          expect(s).not.toMatch(/[Tt]welve|seven-card|Defensive (Boost|Bonus)|CPOY|per game|for this game/);
        }
      }
    }
  });
});

describe('the completion screen', () => {
  it('lists what comes next from the tables the game reads, briefly', () => {
    const lines = whatsNext().join('\n');
    // The default rung is aiLevels' DEFAULT_AI_LEVEL, not a name typed here.
    const fair = AI_PAY[DEFAULT_AI_LEVEL];
    expect(lines).toContain(`${fair.label} is the fair default and pays the standard rate (${fair.pay}×)`);
    expect(lines).toContain(`${AI_PAY.king.label} ${AI_PAY.king.pay}×`);
    expect(lines).toContain(`${AI_PAY.deity.label} ${AI_PAY.deity.pay}×`);
    expect(lines).toContain(`at most ${STRAT_COPY_CAPS.common} copies of a common, ${STRAT_COPY_CAPS.uncommon} of an uncommon, ${STRAT_COPY_CAPS.rare} of a rare and ${STRAT_COPY_CAPS.legendary} of a legendary`);
    expect(lines).toContain('A deck is 50 strategy cards');
    expect(lines).toContain(`A section on the bench clears a tracker at ${REST_CLEARS_AT} minutes or less and takes ${REST_RECOVERY} off above that`);
    expect(restMinutes(REST_CLEARS_AT)).toBe(0);
    expect(restMinutes(REST_CLEARS_AT + SECTION_MINUTES)).toBe(REST_CLEARS_AT + SECTION_MINUTES - REST_RECOVERY);
    expect(lines).toMatch(/overtime/);
  });
});

// ── 2026-09-18, the verifiers' second round ─────────────────────────────────

describe("the coach's cancel is the coach's", () => {
  const window1 = () => runSnake(lockLineups(tutorialGame(), FIRST_FIVE_A, FIRST_FIVE_B), { coachPicks: false });
  /** `k` plays `id` for real, dealt into its hand first. */
  const play = (g, k, id) => {
    getTeam(g, k).hand = [id, ...getTeam(g, k).hand.filter(x => x !== id).slice(0, 6)];
    const res = execCard(g, k, id, aiBuildCardOpts(g, k, id));
    expect(res.ok, `${k} ${id}: ${res.msg}`).toBe(true);
    return res.game;
  };

  it('your cancel of its switch is narrated neither on the next lineup screen nor over its real cancel', () => {
    // S1: your switch, the coach's switch back, and YOUR Veer Switch on it.
    let g = window1();
    g = play(g, 'A', 'high_screen_roll');
    g = play(g, 'B', 'high_screen_roll');
    g = play(g, 'A', 'veer_switch');
    expect(g.log.some(e => e.team === 'A' && /canceled HSR/.test(e.msg))).toBe(true);
    g = tutorialReducer(rollEveryone(passToRolling(g)), { type: 'END_SECTION' });
    expect([g.quarter, g.section, g.phase]).toEqual([1, 2, 'draft']);
    // The S2 lineup screen: the reminder alone, not "the coach answered with Veer Switch".
    expect(liveIds(g)).toEqual(['s2_draft_reminder']);

    // S2: your switch, the coach's Fight Over — the lesson it is written for.
    g = runSnake(lockLineups(g, FIRST_FIVE_A, FIRST_FIVE_B), { coachPicks: false });
    expect(liveIds(g)).not.toContain('s2_switch_cancelled');
    g = play(g, 'A', 'high_screen_roll');
    g = play(g, 'B', 'fight_over');
    expect(liveIds(g)).toContain('s2_switch_cancelled');
    const told = text('s2_switch_cancelled', g);
    expect(told).toMatch(/^The coach answered with Fight Over: your switch is cancelled/);
    // Then the coach switches and you cancel THAT: the narration stays the coach's Fight Over.
    g = passTurn(g, 'A');
    g = play(g, 'B', 'high_screen_roll');
    g = play(g, 'A', 'veer_switch');
    expect(text('s2_switch_cancelled', g)).toBe(told);
  });

  it('the S2 lineup screen shows the reminder alone in every walk, the human cancelling where it can', () => {
    let cancelled = 0;
    for (const seed of [31, 32, 33, 34]) {
      vi.spyOn(Math, 'random').mockImplementation(seeded(seed));
      let end;
      try {
        end = walkTutorial(tutorialStart(), {
          onState: g => {
            if (g.phase === 'draft' && g.quarter === 1 && g.section === 2) expect(liveIds(g)).toEqual(['s2_draft_reminder']);
          },
        });
      } finally { vi.restoreAllMocks(); }
      if (end.log.some(e => e.team === 'A' && /canceled HSR/.test(e.msg))) cancelled += 1;
    }
    // The walk's human answers the coach's switch with a canceller when one
    // is lit — the path the kit never took before (2026-09-18).
    expect(cancelled).toBeGreaterThan(0);
  });
});

describe('the limit and Lock reach a player who does not play the kit\'s way', () => {
  const OTHER_FIVE_A = TUTORIAL_ROSTER_A_IDS.slice(5);

  it('teaches the twelve-straight limit to a player who rotated his fives', () => {
    let g = playSection(tutorialGame(), FIRST_FIVE_A);
    g = playSection(g, OTHER_FIVE_A);
    expect([g.quarter, g.section, g.phase]).toEqual([1, 3, 'draft']);
    // Nobody is one section from the limit: the old trigger said nothing here.
    expect(g.teamA.stats.every(ps => ps.minutes + SECTION_MINUTES < MAX_STRAIGHT_MINUTES)).toBe(true);
    expect(liveIds(g)).toContain('s3_twelve_limit');
    const t = text('s3_twelve_limit', g);
    expect(t).toContain(`${MAX_STRAIGHT_MINUTES} straight minutes is the limit`);
    expect(t).toContain(`Nobody of yours is one section from it yet: a player who starts ${MAX_STRAIGHT_MINUTES / SECTION_MINUTES} sections in a row gets there.`);
    expect(t).not.toMatch(/at \d+ minutes (is|are) one section from/);
    expect(t).toContain("(In a full game the next section is the second quarter's first; the tutorial skips to the fourth quarter next, where the limit is lifted.)");
  });

  it('teaches Lock → Scoring to a player who never plays a card', () => {
    const said = new Set();
    const lessons = new Set();
    vi.spyOn(Math, 'random').mockImplementation(seeded(21));
    try {
      walkTutorial(tutorialStart(), {
        noCards: true,
        onState: g => {
          for (const id of liveIds(g)) { lessons.add(id); said.add(`${text(id, g)} ${detail(id, g) ?? ''}`); }
        },
      });
    } finally { vi.restoreAllMocks(); }
    // The lesson that needs your switch never came —
    expect(lessons.has('s1_priority_reset')).toBe(false);
    // — and Lock was taught anyway.
    expect([...said].some(s => s.includes('Lock → Scoring'))).toBe(true);
  });
});

describe('the lineup submit is one function', () => {
  it('the board, PvP and the walk all lock lineups through placement.js, and the lessons read what it writes', async () => {
    const { readFileSync } = await import('node:fs');
    const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
    const board = read('../components/game/CourtBoard.jsx');
    const pvp = read('../components/PvpGame.jsx');
    const kit = read('./tutorialWalk.testkit.js');
    const data = read('./tutorialData.js');
    expect(board).toMatch(/submitSoloLineup\(game, selected/);
    expect(pvp).toMatch(/beginPlacement\(/);
    expect(kit).toMatch(/submitSoloLineup\(game, wanted/);
    // Nobody retypes the anchor or writes the pick lists by hand.
    for (const src of [board, pvp, kit, data]) {
      expect(src).not.toContain(LINEUPS_LOCKED);
      expect(src).not.toMatch(/draft\.aPicks\s*=/);
    }
    expect(data).toMatch(/import \{ LINEUPS_LOCKED[,} ][^;]*from '\.\/placement\.js'/);
    // What it writes is what the lessons key on.
    const g = lockLineups(tutorialGame(), FIRST_FIVE_A);
    expect(g.log[g.log.length - 1]).toEqual({ team: null, msg: LINEUPS_LOCKED });
    expect(g.draft.aPicks).toEqual(FIRST_FIVE_A);
    expect(g.draft.bPicks).toHaveLength(5);
    expect(g.phase).toBe('matchup_strats');
    expect(liveIds(g)).toContain('s1_place_intro');
  });
});

// ── 2026-09-18, the verifiers' fourth round ─────────────────────────────────

describe("Go Under's price is an instruction only while the choice is yours", () => {
  /** `k` plays `id` for real, dealt into its hand first. */
  const play = (g, k, id) => {
    getTeam(g, k).hand = [id, ...getTeam(g, k).hand.filter(x => x !== id).slice(0, 6)];
    const res = execCard(g, k, id, aiBuildCardOpts(g, k, id));
    expect(res.ok, `${k} ${id}: ${res.msg}`).toBe(true);
    return res.game;
  };
  const PICK = "Go Under's price is yours to spend: pick which";

  it('the coach cancels your switch, you pick, the coach switches, and you cancel with Go Under', () => {
    let g = runSnake(lockLineups(playSection(tutorialGame()), FIRST_FIVE_A, FIRST_FIVE_B), { coachPicks: false });
    expect([g.quarter, g.section]).toEqual([1, 2]);
    g = play(g, 'A', 'high_screen_roll');
    g = play(g, 'B', 'go_under');
    // Waiting on you: the instruction.
    expect(g.pendingChoice).toMatchObject({ kind: 'go_under', teamKey: 'A' });
    expect(liveIds(g)).toContain('s2_switch_cancelled');
    expect(text('s2_switch_cancelled', g)).toContain(PICK);
    // Taken: the past tense, naming your shooter.
    const shooterSlot = g.pendingChoice.slots[0];
    const shooter = g.teamA.starters[shooterSlot].name;
    const r = resolveGoUnder(g, shooterSlot);
    expect(r.ok).toBe(true);
    g = r.game;
    expect(g.pendingChoice).toBe(null);
    const after = text('s2_switch_cancelled', g);
    expect(after).not.toContain(PICK);
    expect(after).toContain(`Its price was yours: you chose ${shooter} for the 3PT check at +2, and he ${g.log.at(-1).msg.includes('MISS') ? 'missed' : 'hit'}`);
    // The coach switches and YOU cancel with Go Under: the choice is now the coach's.
    if (g.matchupTurn === 'A') g = passTurn(g, 'A');
    g = play(g, 'B', 'high_screen_roll');
    g = play(g, 'A', 'go_under');
    expect(g.pendingChoice).toMatchObject({ kind: 'go_under', teamKey: 'B' });
    const now = text('s2_switch_cancelled', g);
    expect(now).not.toContain(PICK);
    expect(now).toBe(after);
  });
});

describe('overtime says which period ended tied', () => {
  it('"after regulation" at the first overtime, "after the first overtime" at the second', () => {
    let g = tutorialGame();
    g = playSection(g); g = playSection(g); g = playSection(g);
    g = rollEveryone(toRolling(g));
    g.teamB.score = g.teamA.score;
    const reg = g.teamA.score;
    g = tutorialReducer(g, { type: 'END_SECTION' });
    expect(g.overtime).toBe(1);
    expect(text('s4_overtime', g)).toMatch(new RegExp(`^Tied at ${reg} after regulation: OT\\.`));
    g = rollEveryone(toRolling(g));
    g.teamB.score = g.teamA.score;
    const ot1 = g.teamA.score;
    g = tutorialReducer(g, { type: 'END_SECTION' });
    expect(g.overtime).toBe(2);
    expect(liveIds(g)[0]).toBe('s4_overtime');
    expect(text('s4_overtime', g)).toMatch(new RegExp(`^Tied at ${ot1} after the first overtime: 2OT\\.`));
    expect(text('s4_overtime', g)).not.toContain('after regulation');
  });

  it('the put-back lesson is not on the overtime lineup screen, which draws no hand', () => {
    let g = tutorialGame();
    g = playSection(g); g = playSection(g); g = playSection(g);
    g = rollEveryone(toRolling(g));
    g = returnCardToDeck(g, 'A', 0);
    expect(liveIds(g)).toContain('s1_putback_undo');
    g.teamB.score = g.teamA.score;
    g = tutorialReducer(g, { type: 'END_SECTION' });
    expect([g.phase, g.overtime]).toEqual(['draft', 1]);
    expect(liveIds(g)).not.toContain('s1_putback_undo');
    // Nor once overtime is rolling (2026-09-18): overtime is a new section for
    // the undo, so regulation's put-back is gone from the board and the lesson.
    g = toRolling(g);
    expect(lastReturnedCard(g, 'A')).toBeNull();
    expect(liveIds(g)).not.toContain('s1_putback_undo');
    g = returnCardToDeck(g, 'A', 0);                  // one put back inside overtime is undoable there
    expect(lastReturnedCard(g, 'A')).not.toBeNull();
    expect(liveIds(g)).toContain('s1_putback_undo');
  });
});

describe("the High Screen & Roll numbers are the board's", () => {
  const window1 = () => runSnake(lockLineups(tutorialGame(), FIRST_FIVE_A, FIRST_FIVE_B), { coachPicks: false });
  const SWAP = /Best swap now: (.+) and (.+) trade defenders — .+'s roll goes from ([+-]?\d+) to ([+-]?\d+), .+'s from ([+-]?\d+) to ([+-]?\d+)/;

  it('after a Stagger Action, quotes what matchupAdv shows before and after the swap, and only on your turn', () => {
    let g = window1();
    g.teamA.hand = ['stagger_action', 'high_screen_roll', ...g.teamA.hand.filter(id => id !== 'stagger_action' && id !== 'high_screen_roll').slice(0, 5)];
    const st = execCard(g, 'A', 'stagger_action', aiBuildCardOpts(g, 'A', 'stagger_action'));
    expect(st.ok, st.msg).toBe(true);
    g = st.game;
    expect(Object.keys(g.tempEff.A || {}).length).toBeGreaterThan(0);
    // The coach's turn: the card is dimmed, so no lesson calls it lit.
    expect(g.matchupTurn).toBe('B');
    expect(g.matchupPasses || 0).toBe(0);
    expect(liveIds(g)).not.toContain('s1_matchup_window');
    // Your turn again after a coach's card (passes back to 0): live.
    g = { ...g, matchupTurn: 'A' };
    expect(liveIds(g)).toContain('s1_matchup_window');
    const m = text('s1_matchup_window', g).match(SWAP);
    expect(m).toBeTruthy();
    const names = g.teamA.starters.map(p => p.name);
    const i = names.indexOf(m[1]); const j = names.indexOf(m[2]);
    expect(Number(m[3])).toBe(matchupAdv(g, 'A', i).rollBonus);
    expect(Number(m[5])).toBe(matchupAdv(g, 'A', j).rollBonus);
    // Play that very swap: the board then reads the "to" numbers.
    const sw = execCard(g, 'A', 'high_screen_roll', { swapSlot1: i, swapSlot2: j });
    expect(sw.ok, sw.msg).toBe(true);
    expect(Number(m[4])).toBe(matchupAdv(sw.game, 'A', i).rollBonus);
    expect(Number(m[6])).toBe(matchupAdv(sw.game, 'A', j).rollBonus);
  });
});

describe('placement undo after a card put back before your first pick', () => {
  it('is taught while the board offers ↩ Undo', () => {
    let g = lockLineups(playSection(tutorialGame()), FIRST_FIVE_A, FIRST_FIVE_B);
    g = returnCardToDeck(g, 'A', 0);
    expect(g.log.at(-1).msg).toMatch(/bottom of the deck/);
    const snap = placementSnapshot(g);
    g = placePlayer(g, FIRST_FIVE_A[0]);
    g = placePlayer(g, FIRST_FIVE_B[0]);
    g = placePlayer(g, FIRST_FIVE_B[1]);
    expect(canUndoPlacement(g, snap)).toBe(true);
    expect(liveIds(g)).toContain('s2_place_undo');
  });
});

describe('the forfeit tip waits for section 3', () => {
  it('is not live in Q1 S2 with Green Light in hand, and the S3 deal makes it live', () => {
    const s2 = toRolling(playSection(tutorialGame()));
    expect([s2.quarter, s2.section]).toEqual([1, 2]);
    getTeam(s2, 'A').hand = ['green_light', ...getTeam(s2, 'A').hand.slice(1)];
    expect(liveIds(s2)).not.toContain('s3_forfeit_tip');
    // The S2 scoring window too, before rolling opens.
    const win = passTurn(passTurn(runSnake(lockLineups(playSection(tutorialGame()), FIRST_FIVE_A, FIRST_FIVE_B), { coachPicks: false }), 'A'), 'B');
    expect(win.phase).toBe('scoring');
    getTeam(win, 'A').hand = ['green_light', ...getTeam(win, 'A').hand.slice(1)];
    expect(liveIds(win)).not.toContain('s3_forfeit_tip');
    // Section 3 as dealt by teachingHands.
    const s3 = toRolling(playSection(playSection(tutorialGame())));
    expect([s3.quarter, s3.section]).toEqual([1, 3]);
    expect(Object.keys(FORFEIT_CARDS).some(id => s3.teamA.hand.includes(id))).toBe(true);
    expect(liveIds(s3)).toContain('s3_forfeit_tip');
  });
});

describe('the timeout riders are named, from the list canPlay gates on', () => {
  const crunchRolling = () => { let g = tutorialGame(); g = playSection(g); g = playSection(g); g = playSection(g); return toRolling(g); };
  const riderNames = TIMEOUT_RIDERS.map(id => getStrat(id).name);
  const why = (g, id) => { const r = canPlayCard(g, 'A', id); return r.reason ?? r.msg ?? JSON.stringify(r); };

  it('canPlay holds exactly the riders for your own timeout', () => {
    const g = crunchRolling();
    expect(g.crunch.active).toBe(true);
    for (const id of CRUNCH_CARDS) expect(/Play during your Timeout/.test(why(g, id)), id).toBe(TIMEOUT_RIDERS.includes(id));
  });

  it('the timeout, the search and the resume lessons say which cards they are', () => {
    let g = crunchRolling();
    for (const n of riderNames) expect(text('s4_timeout', g)).toContain(n);
    expect(text('s4_timeout', g)).not.toMatch(/timeout cards/);
    g.teamA.deck = ['reset', 'second_closer', ...g.teamA.deck.filter(id => id !== 'reset' && id !== 'second_closer')];
    g.teamA.hand = g.teamA.hand.filter(id => !TIMEOUT_RIDERS.includes(id));
    g = tutorialReducer(g, { type: 'TIMEOUT', teamKey: 'A' });
    const search = text('s4_timeout_search', g);
    const inDeck = crunchSearchOptions(g, 'A').filter(id => TIMEOUT_RIDERS.includes(id)).map(id => getStrat(id).name);
    expect(inDeck.length).toBeGreaterThan(0);
    for (const n of inDeck) expect(search).toMatch(new RegExp(`Of these, .*${n}.* only in your own timeout`));
    // Take a non-rider: the resume lesson says you hold none.
    g = tutorialReducer(g, { type: 'SEARCH_CRUNCH', teamKey: 'A', cardId: 'second_closer' });
    expect(text('s4_timeout_resume', g)).toMatch(/^You hold none of the cards that play in a timeout/);
    // A rider in hand is named, as the card to play now when canPlay lights it.
    const held = { ...g, teamA: { ...g.teamA, hand: [...g.teamA.hand, 'fresh_legs'] } };
    const said = text('s4_timeout_resume', held);
    expect(said).toContain('Fresh Legs');
    if (canPlayCard(held, 'A', 'fresh_legs').canPlay) expect(said).toMatch(/^Play Fresh Legs now/);
  });
});

describe('the placement lesson reads the snake off the game', () => {
  it("prints the game's order and says A is you", () => {
    const g = lockLineups(tutorialGame(), FIRST_FIVE_A, FIRST_FIVE_B);
    expect(text('s1_place_intro', g)).toContain(`snake ${DEFAULT_ORDER.join('-')} (A is you)`);
    const visitorFirst = { ...g, placementOrder: ['B', 'A', 'A', 'B', 'B', 'A', 'A', 'B', 'B', 'A'] };
    expect(text('s1_place_intro', visitorFirst)).toContain('snake B-A-A-B-B-A-A-B-B-A (A is you)');
  });
});

describe('fatigue wording, the waived limit and halftime', () => {
  it('says scoring rolls and 3PT or paint checks, and states the waiver and halftime as the engine does', () => {
    const d = detail('s1_draft_pick1', tutorialGame());
    expect(d).toContain('on every scoring roll and every 3PT or paint check (free throws are exempt)');
    const s2 = playSection(tutorialGame());
    expect(text('s2_draft_reminder', s2)).toContain('on every scoring roll and every 3PT or paint check');
    const s3 = playSection(s2);
    expect(detail('s3_twelve_limit', s3)).toContain('the limit is waived for that section and anyone may play');
    expect(detail('s3_fatigue_warning', s3)).toContain('Halftime wipes the tracker and every marker.');
    for (const t of TUTORIAL_TOOLTIPS) {
      for (const v of [t.text, t.detail]) {
        const out = typeof v === 'function' ? (() => { try { return v(s3); } catch { return ''; } })() : (v || '');
        expect(out).not.toMatch(/every roll and check|resets everything|the least tired may play/);
      }
    }
  });
});
