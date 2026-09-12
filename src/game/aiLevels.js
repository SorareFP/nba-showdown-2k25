// COACH DIFFICULTY — Civilization's ladder, from Settler to Deity.
//
// The user (2026-09-09): "scaling the matchup IQ from the AI is the first
// step in the difficulty level difference. 'Settler' difficulty could be
// random matchup IQ, and then we scale it up to 'perfect'." So the first
// lever is `iq`: the chance, at each placement in the snake, that the coach
// plays the search's best answer rather than a random one. Deity is the
// full search every time; Settler is a coin with no memory.
//
// 2026-09-12: the same dial now runs four judgements, all through
// `misplays(iq)` in ai.js — the placement snake, WHICH CARD it plays from
// the hand, whether it ANSWERS an announced shot check, and how it spends
// assists. A level is one number because a coach who reads the floor also
// reads its hand; splitting them would be six sliders nobody wants to set.
export const AI_LEVELS = [
  { id: 'settler',   label: 'Settler',   iq: 0,    blurb: 'places at random, plays any card, answers nothing' },
  { id: 'chieftain', label: 'Chieftain', iq: 0.25, blurb: 'gets it right one time in four' },
  { id: 'warlord',   label: 'Warlord',   iq: 0.5,  blurb: 'half the time' },
  { id: 'prince',    label: 'Prince',    iq: 0.75, blurb: 'three times in four' },
  { id: 'king',      label: 'King',      iq: 0.9,  blurb: 'nearly always' },
  { id: 'deity',     label: 'Deity',     iq: 1,    blurb: 'the full search, every time' },
];

// THE LADDER IS MEASURED, and the even spacing holds. 2,500 games a rung
// (2026-09-12, simulate.js with the level swapped into both brains, ±2% at
// 95%): Deity beats Settler 58.9% at +4.70 a game, Chieftain 56.9%/+3.39,
// Warlord 54.2%/+2.08, Prince 53.3%/+1.39, King 51.4%/+0.53 — monotonic on
// both columns, about a point of margin a rung — with the Deity-vs-Deity
// control at 50.1%/+0.04.
//
// MEASURE THIS WITH ENOUGH GAMES OR NOT AT ALL. At 600 a rung the interval is
// ±4 and the control drifted 48% to 51.7% between two runs of identical code;
// tuned on that noise, the rungs looked broken and a re-spacing looked
// justified. It was not. One game's dice are worth more than the whole ladder,
// so nothing under a couple of thousand games a rung says anything.
export const DEFAULT_AI_LEVEL = 'deity';
const KEY = 'showdown.aiLevel';

export function levelById(id) {
  return AI_LEVELS.find(l => l.id === id) ?? AI_LEVELS.find(l => l.id === DEFAULT_AI_LEVEL);
}

/** The matchup IQ for a level id — 0 to 1. */
export function iqOf(id) {
  return levelById(id).iq;
}

/** This browser's chosen level, or the default. Storage may be absent; that is fine. */
export function loadAiLevel() {
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    return AI_LEVELS.some(l => l.id === v) ? v : DEFAULT_AI_LEVEL;
  } catch {
    return DEFAULT_AI_LEVEL;
  }
}

export function saveAiLevel(id) {
  try { globalThis.localStorage?.setItem(KEY, levelById(id).id); } catch { /* per-device convenience only */ }
}
