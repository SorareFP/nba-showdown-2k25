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
