// src/game/tutorialData.js
// Tutorial tooltip content — data-driven for easy editing
// Each tooltip has: id, text, detail, section (1-3), trigger, priority

import { getTeam } from './engine.js';

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

  // Matchup
  {
    id: 's1_matchup_intro',
    text: "Placement! You and the coach take turns placing your five in the snake A-B-B-A-A-B-B-A-A-B. The row a player lands in is their matchup: the two players in a row guard each other all section. Then the matchup card window: play a card or pass, and two passes in a row close it.",
    detail: "Lead a row with a player who does fine against anyone; keep your best scorer to counter-pick a row the coach has already filled. Green numbers mean your player has the edge, red means the defender does. Only a switching card (High Screen & Roll, Veer Switch, Switch Everything) can move a defender afterwards.",
    section: 1,
    priority: 100,
    trigger: { phase: 'matchup_strats', condition: (g) => g.quarter === 1 && g.section === 1 && g.matchupPasses === 0 },
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
  {
    id: 's2_assists_intro',
    text: "Did you notice your assist and rebound tracks? You can spend assists for bonus shot checks! Check the buttons below each player.",
    detail: "1 AST = +1 to a shot check. 5 AST = a 3PT check (needs a 3PT Bonus) or a Paint check (needs a Paint Bonus). The first time you reach 5 assists you draw a bonus card!",
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
    detail: "Fatigue thresholds: 8 min = -2, 12 min = -6, 16 min = -12. A section on the bench takes 4 minutes off and clears hot and cold markers. At halftime (Q3), all fatigue resets.",
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
