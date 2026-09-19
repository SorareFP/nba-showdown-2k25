// THE TUTORIAL'S HANDS ARE SHAPED, so the lesson has its props.
//
// Section 1: the player holds High Screen & Roll and the coach holds NO
// canceller, so the switch lands and the player sees what a switch does.
// Section 2: the player holds it again and the coach holds Go Under (and no
// other canceller), so the switch is cancelled and the player sees what a
// canceller does — one lesson, then its counter. The user, 2026-09-08:
// "not give the AI a switch reaction card in the first matchup phase, but
// introduce it in the second phase and show that the opposing coach
// canceled it."
//
// Section 3 (2026-09-18): the player holds a card from the forfeit family
// (Green Light, You Stand Over There, Five-Out, Cross-Court Dime) if one is
// still in the deck, so the coach tip that prices it has a card to price —
// the board prints forfeitNet per player in the tutorial, and the lesson
// reads the same number. Never created: when none is left in the deck the
// hand is left alone and the lesson simply does not fire.
//
// Pure: takes a game, returns a game. No card is created or lost — a card
// pulled into a hand comes off the deck, a card pushed out goes to the deck.
// `drawCards` pops from the END of the deck, so "next to be drawn" is the end
// and "the bottom" is index 0.

import { FORFEIT_CARDS } from './ai.js';

export const TEACHING_CARD = 'high_screen_roll';
/** The cards that replace a roll with shot checks — ai.js prices them (forfeitNet). */
export const FORFEIT_LESSON_CARDS = Object.keys(FORFEIT_CARDS);
export const CANCELLERS = ['go_under', 'fight_over', 'veer_switch'];
export const LESSON_CANCELLER = 'go_under';
const HAND = 7;

/** `id` in the hand, from the deck if it is there, displacing the last card to the bottom. */
function ensureInHand(team, id) {
  if (team.hand.includes(id)) return team;
  const deck = [...team.deck];
  const at = deck.indexOf(id);
  if (at >= 0) deck.splice(at, 1);
  const hand = [...team.hand];
  const displaced = hand.length >= HAND ? hand.pop() : null;
  hand.push(id);
  if (displaced) deck.unshift(displaced);
  return { ...team, hand, deck };
}

/**
 * None of `ids` in the hand: they go to the END of the deck (drawn back
 * soonest), and the hand refills to seven from the deck, skipping any of
 * `ids` it meets on the way (those go to the bottom).
 */
function withoutInHand(team, ids) {
  const out = new Set(ids);
  const removed = team.hand.filter(id => out.has(id));
  if (!removed.length) return team;
  const hand = team.hand.filter(id => !out.has(id));
  const deck = [...team.deck];
  while (hand.length < HAND && deck.length) {
    const next = deck.pop();
    if (out.has(next)) deck.unshift(next);
    else hand.push(next);
    if (deck.length && deck.every(id => out.has(id))) break;
  }
  deck.push(...removed);
  return { ...team, hand, deck };
}

/** One of `ids` in the hand: already there, or the first the deck holds; otherwise the team untouched. */
function oneOfInHand(team, ids) {
  if (team.hand.some(id => ids.includes(id))) return team;
  const found = [...team.deck].reverse().find(id => ids.includes(id));
  return found ? ensureInHand(team, found) : team;
}

/** The shaped game for Q1 sections 1 to 3; any other section unchanged. */
export function teachingHands(g) {
  if (!g || g.quarter !== 1 || ![1, 2, 3].includes(g.section)) return g;
  if (g.section === 3) {
    const teamA = oneOfInHand(g.teamA, FORFEIT_LESSON_CARDS);
    return teamA === g.teamA ? g : { ...g, teamA };
  }
  let teamA = ensureInHand(g.teamA, TEACHING_CARD);
  let teamB = g.teamB;
  if (g.section === 1) {
    teamB = withoutInHand(teamB, CANCELLERS);
  } else {
    teamB = withoutInHand(teamB, CANCELLERS.filter(c => c !== LESSON_CANCELLER));
    teamB = ensureInHand(teamB, LESSON_CANCELLER);
  }
  return { ...g, teamA, teamB };
}
