// src/game/tutorialData.js
// Tutorial tooltip content — data-driven for easy editing
// Each tooltip has: id, text, detail, section (1-3), trigger, priority

import { getTeam, calcAdv } from './engine.js';
import { pairValue } from './ai.js';

// ── Lessons that read the board ──────────────────────────────────────────────
//
// The user (2026-09-08): "show why the AI chose the defender to matchup with
// the first player the user puts down", then "explain the matchup indicators",
// then "highlight that high screen & roll, and explain why you'd do it". Each
// of these is computed from the game with the SAME arithmetic the AI and the
// board use — aiPlacementPick's score, the placement picker's ⚔/🛡, and the
// High Screen & Roll pair search — so the lesson never disagrees with what the
// player sees.
const sgn = n => (n > 0 ? '+' : '') + n;
const who = p => `${p.name} (S${p.speed} P${p.power}${p.defBoost ? ` Def${sgn(p.defBoost)}` : ''})`;
const step = g => g.placementStep ?? 10;

/** Why the coach's row-1 answer was that player: aiPlacementPick's score, said out loud. */
function placementAnswer(g) {
  const a0 = getTeam(g, 'A').starters[0];
  const b0 = getTeam(g, 'B').starters[0];
  if (!a0 || !b0) return 'The coach answers every row you lead.';
  const mine = calcAdv(a0, b0, {}, 0);    // my roll against them
  const theirs = calcAdv(b0, a0, {}, 0);  // their roll against me
  const soaked = (b0.defBoost || 0) > 0 && (mine.rawSpeedDiff > 0 || mine.rawPowerDiff > 0) && mine.rollBonus < Math.max(mine.rawSpeedDiff, mine.rawPowerDiff);
  return `The coach answered your ${who(a0)} with ${who(b0)}. Against them your roll is ${sgn(mine.rollBonus)}${soaked ? ' — the Def Boost soaks part of your edge' : ''}, and theirs against you is ${sgn(theirs.rollBonus)}. The coach reads each pairing as points — what its player's chart pays at that bonus, less what yours pays — and plays the rest of the snake out in its head before it answers, so a good defender is not spent on a player who did not need one.`;
}

/** A's best remaining answer to the row the coach just led, by the coach's own score. */
function bestAnswer(g) {
  const A = getTeam(g, 'A');
  const B = getTeam(g, 'B');
  const opp = B.starters[A.starters.length];
  if (!opp) return null;
  const placed = new Set(A.starters.map(p => p.id));
  const picks = (g.draft?.aPicks ?? []).filter(id => !placed.has(id)).map(id => (A.roster || []).find(r => r.id === id)).filter(Boolean);
  let best = null;
  for (const c of picks) {
    const mine = calcAdv(c, opp, {}, 0);
    const theirs = calcAdv(opp, c, {}, 0);
    // The coach's own reading: the row in points, both charts.
    const score = pairValue(g, 'A', c, opp);
    if (!best || score > best.score) best = { c, mine, theirs, score };
  }
  return { opp, row: A.starters.length + 1, ...best };
}

function placementIndicators(g) {
  const r = bestAnswer(g);
  if (!r) return 'Now you answer a row the coach led. Open the picker and read the pairing both ways before you choose.';
  return `Now you answer row ${r.row}, where the coach led with ${who(r.opp)}. In the picker every one of your players shows the pairing both ways: ⚔ is your roll bonus attacking them, 🛡 is theirs attacking you. Green is good for you, red is bad, ⚠ marks a penalty.`;
}
function placementIndicatorsDetail(g) {
  const r = bestAnswer(g);
  if (!r?.c) return 'S and P are the raw Speed and Power differences; the roll bonus is the larger one after Def Boost.';
  return `S and P are the raw Speed and Power differences; the roll bonus is the larger one after Def Boost. Best answer right now, read as points on both charts: ${r.c.name} — ⚔ ${sgn(r.mine.rollBonus)}, 🛡 ${sgn(r.theirs.rollBonus)}.`;
}

/** The swap of two defenders that gains the most roll bonus — the AI's own search. */
function bestSwap(g) {
  const A = getTeam(g, 'A');
  const B = getTeam(g, 'B');
  const mu = g.offMatchups?.A || [0, 1, 2, 3, 4];
  const bonus = (i, d) => { const p = A.starters[i]; const dp = B.starters[d]; return p && dp ? calcAdv(p, dp, {}, i).rollBonus : 0; };
  let best = null;
  for (let i = 0; i < A.starters.length; i += 1) {
    for (let j = i + 1; j < A.starters.length; j += 1) {
      const di = mu[i] ?? i, dj = mu[j] ?? j;
      const now = bonus(i, di) + bonus(j, dj);
      const swapped = bonus(i, dj) + bonus(j, di);
      const gain = swapped - now;
      if (!best || gain > best.gain) best = { i, j, gain, ai: bonus(i, di), aj: bonus(j, dj), bi: bonus(i, dj), bj: bonus(j, di) };
    }
  }
  return best;
}
// ── The log, read from this section's start ──────────────────────────────────
// The board logs "Lineups locked — begin placement." every section, which is
// the anchor: a lesson about THIS section's switch must not fire off last
// section's line.
function sectionLog(g) {
  const log = g.log || [];
  let start = 0;
  for (let i = log.length - 1; i >= 0; i -= 1) if (/Lineups locked/.test(log[i].msg)) { start = i; break; }
  return log.slice(start);
}
const lastIn = (entries, re) => { for (let i = entries.length - 1; i >= 0; i -= 1) if (re.test(entries[i].msg)) return entries[i]; return null; };
const mySwitch = g => { const e = lastIn(sectionLog(g), /^High Screen & Roll: /); return e && e.team === 'A' ? e : null; };
const theirCancel = g => lastIn(sectionLog(g), /canceled HSR/);

/** The coach's move after my switch this section: a pass, a card, or nothing yet. */
function coachReply(g) {
  const entries = sectionLog(g);
  const at = entries.indexOf(mySwitch(g));
  if (at < 0) return null;
  const reply = entries.slice(at + 1).find(e => e.team === 'B');
  if (!reply) return null;
  if (/^Passed/.test(reply.msg)) return { kind: 'pass' };
  return { kind: 'card', name: reply.msg.split(':')[0] };
}
function switchLandedText(g) {
  const e = mySwitch(g);
  const what = e ? e.msg.replace(/^High Screen & Roll: /, '') : 'the two defenders traded places';
  const r = coachReply(g);
  const coach = r?.kind === 'card'
    ? `The coach played ${r.name} instead of answering it — it holds no canceller.`
    : 'The coach passed: it had nothing in hand to answer with.';
  return `Your switch went through — ${what}. ${coach}`;
}
function switchCancelledText(g) {
  const e = theirCancel(g);
  if (!e) return 'The coach cancelled your switch.';
  const [card, rest] = e.msg.split(': canceled HSR — ');
  const lead = `The coach answered with ${card}: your switch is cancelled and the pairings stay as they were placed.`;
  if (card === 'Go Under') return `${lead} Go Under's price is yours to spend: pick which of the two players takes a 3PT check at +2 — the banner shows the die each one needs. (${rest}.)`;
  if (card === 'Fight Over') return `${lead} Fight Over's price: ${rest}.`;
  return `${lead} Veer Switch's twist: the coach chose the new assignments itself — ${rest}.`;
}

function screenRollText(g) {
  const A = getTeam(g, 'A');
  const lead = 'Your High Screen & Roll is lit. It swaps the defenders of two of your players, so the pairings the placement handed you are not final.';
  const s = bestSwap(g);
  if (!s || s.gain <= 0) return `${lead} Right now no swap gains anything — hold it for a section where the placement goes against you.`;
  const x = A.starters[s.i], y = A.starters[s.j];
  return `${lead} Best swap now: ${x.name} and ${y.name} trade defenders — ${x.name}'s roll goes from ${sgn(s.ai)} to ${sgn(s.bi)}, ${y.name}'s from ${sgn(s.aj)} to ${sgn(s.bj)} (net ${sgn(s.gain)}).`;
}

export const TUTORIAL_TOOLTIPS = [
  // ── Section 1: Learn the Basics ──────────────────────────────────────────

  // Draft
  {
    id: 's1_draft_intro',
    text: "Welcome! First, pick your five starters from the ten on your roster and lock them in. The coach picks its five at the same time, and neither side sees the other's until both have locked.",
    detail: "Look at each player's Speed, Power, and Shot Line. High Speed excels at perimeter play; high Power dominates inside. Low Shot Lines mean better shooters. Five sit out every section, so think about who rests.",
    section: 1,
    priority: 100,
    trigger: { phase: 'draft', condition: (g) => g.quarter === 1 && g.section === 1 && g.draft.step === 0 },
  },
  {
    id: 's1_draft_pick1',
    text: "Balance the five. Players with a Defensive Boost neutralise an opponent's edge without a card, and cheaper legs now keep your stars fresh for later.",
    detail: "Tip: Balance your lineup. Players with Defensive Boosts are valuable because they can neutralize opponent advantages without strategy cards. Budget players keep your stars rested for later.",
    section: 1,
    priority: 90,
    trigger: { phase: 'draft', condition: (g) => g.quarter === 1 && g.section === 1 && g.draft.step <= 1 },
  },

  // Placement — the snake, then the coach's answer, then reading the picker
  {
    id: 's1_place_intro',
    text: "Placement! You and the coach take turns placing your five in the snake A-B-B-A-A-B-B-A-A-B. The row a player lands in is their matchup: the two players in a row guard each other all section.",
    detail: "Lead a row with a player who does fine against anyone; keep your best scorer to counter-pick a row the coach has already filled. Nothing re-deals the pairings afterwards except a switching card.",
    section: 1,
    priority: 100,
    trigger: { phase: 'matchup_strats', condition: (g) => g.quarter === 1 && g.section === 1 && step(g) === 0 },
  },
  {
    id: 's1_place_answer',
    text: placementAnswer,
    detail: null,
    section: 1,
    priority: 100,
    trigger: { phase: 'matchup_strats', condition: (g) => g.quarter === 1 && g.section === 1 && step(g) === 3 },
  },
  {
    id: 's1_place_indicators',
    text: placementIndicators,
    detail: placementIndicatorsDetail,
    section: 1,
    priority: 90,
    // A's answering turns: step 3 (row 2) and step 7 (row 4).
    trigger: { phase: 'matchup_strats', condition: (g) => g.quarter === 1 && g.section === 1 && (step(g) === 3 || step(g) === 7) },
  },

  // Section 1's switch LANDS — the coach was dealt no canceller (tutorialHands.js)
  {
    id: 's1_switch_landed',
    text: switchLandedText,
    detail: "A defence holding Go Under, Fight Over or Veer Switch can cancel a switch, each at a price — and a coach spends one only when the switch cost it something. Next section the coach will be holding one — watch what it does.",
    section: 1,
    priority: 95,
    // Fires once the coach has replied to the switch — by passing or by playing
    // any card that is not a canceller — and the turn is back with the player.
    trigger: { phase: 'matchup_strats', condition: (g) => g.quarter === 1 && g.section === 1 && step(g) >= 10 && Boolean(mySwitch(g)) && !theirCancel(g) && Boolean(coachReply(g)) && g.matchupTurn === 'A' },
  },

  // Matchup card window — the switch, and why
  {
    id: 's1_matchup_window',
    text: screenRollText,
    detail: "Play it with ▶ on the card, then pick the two players. The coach can answer with Go Under, Fight Over or Veer Switch — each cancels the switch for a price. Playing a card hands the turn over; two passes in a row close the window.",
    highlight: '[data-card-id="high_screen_roll"]',
    section: 1,
    priority: 100,
    trigger: { phase: 'matchup_strats', condition: (g) => g.quarter === 1 && g.section === 1 && step(g) >= 10 && (g.matchupPasses || 0) === 0 },
  },

  // Scoring
  {
    id: 's1_scoring_intro',
    text: "Scoring card window! Same rule: play a card or pass, and two passes in a row open rolling. Each player then rolls a D20 plus their matchup bonus to score.",
    detail: "Your roll is modified by matchup advantage, fatigue (none yet!), and hot/cold markers. The result is looked up on the player's scoring chart for points, rebounds, and assists.",
    section: 1,
    priority: 100,
    trigger: { phase: 'scoring', condition: (g) => g.quarter === 1 && g.section === 1 && g.scoringPasses === 0 },
  },
  {
    id: 's1_first_card',
    text: "Look at your hand on the left. Cards with a green border are playable right now. Hover over a card to see what it does, then click to play it!",
    detail: "Each card has a phase (when it can be played) and requirements. If a card is grayed out, check its tooltip for why.",
    section: 1,
    priority: 80,
    trigger: { phase: 'scoring', condition: (g) => g.quarter === 1 && g.section === 1 && g.scoringPasses < 2 },
  },
  {
    id: 's1_rolling_open',
    text: "Rolling is open! You roll first, then the coach, taking turns. Click one of your players to roll their D20; the modified roll is read off their scoring chart.",
    detail: "Natural 19-20 = Hot marker (+2 to future rolls). Natural 1-2 = Cold marker (-2). Watch for these!",
    section: 1,
    priority: 90,
    trigger: { phase: 'scoring', condition: (g) => g.quarter === 1 && g.section === 1 && g.scoringPasses >= 99 },
  },
  {
    id: 's1_end_section',
    text: "All players have rolled! Review the section results. The team winning the rebound track gets +1 assist. Click 'End Section' to move on.",
    detail: "At the end of each section, temporary effects clear, starters add 4 minutes of fatigue, benched players shed 4, and both teams draw back up to 7 cards.",
    section: 1,
    priority: 100,
    trigger: {
      phase: 'scoring',
      condition: (g) => {
        if (g.quarter !== 1 || g.section !== 1) return false;
        const rA = g.rollResults?.A || [], rB = g.rollResults?.B || [];
        return [0,1,2,3,4].every(i => rA[i] != null) && [0,1,2,3,4].every(i => rB[i] != null);
      },
    },
  },

  // ── Section 2: Deeper Strategy ───────────────────────────────────────────

  {
    id: 's2_draft_reminder',
    text: "Section 2 draft. Your starters from last section now have 4 minutes of fatigue \u2014 they're still fine, but after another section they'll start to slow down.",
    section: 2,
    priority: 80,
    trigger: { phase: 'draft', condition: (g) => g.quarter === 1 && g.section === 2 && g.draft.step === 0 },
  },
  // Section 2: the same switch, and the coach's answer to it
  {
    id: 's2_switch_again',
    text: "Play your High Screen & Roll again. This time the coach is holding a canceller — see what it does with it.",
    detail: null,
    highlight: '[data-card-id="high_screen_roll"]',
    section: 2,
    priority: 100,
    trigger: { phase: 'matchup_strats', condition: (g) => g.quarter === 1 && g.section === 2 && step(g) >= 10 && !mySwitch(g) && getTeam(g, 'A').hand.includes('high_screen_roll') },
  },
  {
    id: 's2_switch_cancelled',
    text: switchCancelledText,
    detail: "One canceller per switch. When you hold Go Under, Fight Over or Veer Switch yourself, they light up the moment the coach switches.",
    section: 2,
    priority: 100,
    trigger: { condition: (g) => g.quarter === 1 && g.section === 2 && Boolean(theirCancel(g)) },
  },
  {
    id: 's2_assists_intro',
    text: "Did you notice your assist and rebound tracks? You can spend assists for bonus shot checks! Check the buttons below each player.",
    detail: "1 AST = +1 to a shot check. 5 AST = a 3PT check or a Paint check for any player — his bonus rides on the die, and the button shows the roll he needs. The first time you reach 5 assists you draw a bonus card!",
    section: 2,
    priority: 70,
    trigger: { phase: 'scoring', condition: (g) => g.quarter === 1 && g.section === 2 && g.scoringPasses >= 99 },
  },
  {
    id: 's2_reaction_cards',
    text: "Keep an eye on your reaction cards \u2014 Close Out takes 3 off an opponent's announced 3PT check, and Cold Spell punishes a natural 1 or 2. The game asks you when one can be played.",
    section: 2,
    priority: 60,
    trigger: { phase: 'scoring', condition: (g) => g.quarter === 1 && g.section === 2 && g.scoringPasses < 2 },
  },

  // ── Section 3: Fatigue & Substitutions ───────────────────────────────────

  {
    id: 's3_fatigue_warning',
    text: "Section 3 \u2014 check your players' fatigue! Anyone with 8+ minutes now has a -2 penalty to all rolls. Consider resting tired players this section.",
    detail: "Fatigue thresholds: 8 min = -2, 12 min = -6, 16 min = -12, and -6 more for every section after that. A section on the bench takes 4 minutes off and clears hot and cold markers. At halftime (Q3), all fatigue resets.",
    section: 3,
    priority: 100,
    trigger: {
      phase: 'draft',
      condition: (g) => {
        if (g.quarter !== 1 || g.section !== 3) return false;
        if (g.draft.step !== 0) return false;
        // Check if any player is fatigued
        const team = getTeam(g, 'A');
        return team.stats.some(ps => (ps.minutes || 0) >= 8);
      },
    },
  },
  {
    id: 's3_sub_strategy',
    text: "Smart substitution: place a fresh bench player instead of your tired star. They'll perform better this section, and your star sheds 4 minutes and any cold markers for next time.",
    section: 3,
    priority: 90,
    trigger: {
      phase: 'draft',
      condition: (g) => g.quarter === 1 && g.section === 3 && g.draft.step >= 1 && g.draft.step <= 3,
    },
  },
  {
    id: 's3_quarter_end',
    text: "Great work! You've completed your first quarter of NBA Showdown. The game has 4 quarters (12 total sections). You now understand drafting, matchups, scoring, cards, and fatigue management!",
    detail: "Continue playing to explore deeper strategy, or head to How to Play for the full rules reference. Good luck!",
    section: 3,
    priority: 100,
    trigger: {
      phase: 'draft',
      condition: (g) => g.quarter === 2 && g.section === 1 && g.draft.step === 0,
    },
  },
];

// ── Pre-set Tutorial Rosters ─────────────────────────────────────────────────
// Hand-picked balanced rosters that showcase diverse mechanics.
// These IDs match entries in CARD_MAP (FirstName_LastName format).
// Roster A: player-controlled, balanced mix of speed, power, shooting
// Roster B: AI-controlled opponent
export const TUTORIAL_ROSTER_A_IDS = [
  'Jayson_Tatum',         // Elite all-around
  'Anthony_Edwards',      // Speed star
  'Bam_Adebayo',          // Power/defense
  'Tyrese_Haliburton',    // Playmaker
  'Mikal_Bridges',        // 3&D role player
  'Jalen_Brunson',        // Mid-salary guard
  'Evan_Mobley',           // Defensive big
  'Desmond_Bane',          // Shooter
  'Derrick_Jones_Jr',      // Budget defender
  'Ayo_Dosunmu',           // Budget guard
];

export const TUTORIAL_ROSTER_B_IDS = [
  'Luka_Doncic',                 // Elite playmaker
  'Shai_Gilgeous_Alexander',     // Speed/scoring
  'Giannis_Antetokounmpo',       // Power monster
  'Damian_Lillard',              // Deep threat
  'Scottie_Barnes',              // Versatile
  'Darius_Garland',              // Mid guard
  'Jaren_Jackson_Jr',            // Rim protector
  'Tyler_Herro',                 // Shooter
  'Jose_Alvarado',               // Budget guard
  'Tari_Eason',                  // Budget forward
];
