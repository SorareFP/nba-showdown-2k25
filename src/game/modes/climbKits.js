// THE CLIMB'S STARTER KITS — the fifteen strategy cards a run begins with.
//
// A shared CORE of seven (the switching cards every deck carries: placement
// sets the matchups, and only these move a defender) plus eight SIGNATURE
// cards of the playbook chosen at Training Camp. Drafted by hand from what
// each card asks for (docs/plans/2026-10-18-the-climb.md, Task 1): the spec
// meant to take them from the cards each fitted fifty in archetypeDecks.js
// uses more than the other two, but those fifties differ by at most one copy
// of any card, so the rule picked almost nothing. The user approves the kits
// with their "+" versions before the upgrades ship.
import { STRAT_MAP } from '../strats.js';
import { nearestArchetype } from '../deckFit.js';
import { ARCHETYPE_DECKS } from '../archetypeDecks.js';

export const CORE = Object.freeze({
  high_screen_roll: 2,
  switch_the_screen: 1,
  veer_switch: 1,
  go_under: 1,
  overhelp: 1,
  burned_switch: 1,
});

export const KITS = Object.freeze({
  // Threes off movement, drives, the faster man.
  speed: Object.freeze({
    catch_and_shoot: 2,
    first_step: 1,
    drive_the_lane: 1,
    spain_pick_roll: 1,
    ghost_screen: 1,
    close_out: 1,
    passing_lane: 1,
  }),
  // The paint, the post and the glass.
  paint: Object.freeze({
    bully_ball: 2,
    power_move: 1,
    back_to_basket: 1,
    offensive_board: 1,
    putback_specialist: 1,
    glass_cleaner: 1,
    box_out: 1,
  }),
  // Contests, rim protection, wearing the other side down.
  defense: Object.freeze({
    close_out: 2,
    drop_coverage: 1,
    smothering_defense: 1,
    pick_up_full_court: 1,
    rim_protector: 1,
    help_defender: 1,
    cold_spell: 1,
  }),
});

export const PLAYBOOKS = Object.freeze(['speed', 'paint', 'defense']);

/** The playbook each fitted archetype (deckFit.js nearestArchetype) plays. */
export const PLAYBOOK_OF_ARCHETYPE = Object.freeze({ fast: 'speed', big: 'paint', stoppy: 'defense' });

/** A playbook's fifteen: the core plus its eight. */
export function kitDeck(playbook) {
  const deck = { ...CORE };
  for (const [id, n] of Object.entries(KITS[playbook] ?? {})) deck[id] = (deck[id] ?? 0) + n;
  return deck;
}

/** Every card in the core or a kit — the ones with a "+" in piece 1. */
export const KIT_CARD_IDS = new Set([
  ...Object.keys(CORE),
  ...PLAYBOOKS.flatMap(pb => Object.keys(KITS[pb])),
]);

// Where the text rule below files a card in the wrong kit: a defensive card
// in the speed kit leans speed, and Close Out, in two kits, leans defense.
// Burned on the Switch is a core switching card and leans nowhere.
const LEAN_OVERRIDES = Object.freeze({
  burned_switch: null,
  close_out: 'defense',
  passing_lane: 'speed',
  box_out: 'paint',
  glass_cleaner: 'paint',
});

/**
 * The playbook a card leans to — what "two of three lean to your playbook"
 * draws from after a win. Overrides first; then a defensive card is defense,
 * a card that names Power, Paint or Rebound is paint, one that names Speed,
 * 3PT or Assist is speed; anything else leans nowhere.
 */
export function leanOf(id) {
  if (id in LEAN_OVERRIDES) return LEAN_OVERRIDES[id];
  const s = STRAT_MAP[id];
  if (!s) return null;
  if (s.side === 'def') return 'defense';
  if (/Power|Paint|Rebound/i.test(s.desc ?? '')) return 'paint';
  if (/Speed|3PT|Assist/i.test(s.desc ?? '')) return 'speed';
  return null;
}

/**
 * THE COACH'S DECK at a stop: the playbook its roster sits nearest, grown to
 * `size` (15 at the first floor, 25 for the boss) from that archetype's fitted
 * fifty, drawn by its copies and never past a card's limit.
 */
export function coachDeck(roster, size, rng = Math.random) {
  const near = nearestArchetype(roster);
  const deck = kitDeck(PLAYBOOK_OF_ARCHETYPE[near?.id] ?? PLAYBOOKS[0]);
  const fifty = ARCHETYPE_DECKS.find(a => a.id === near?.id)?.deck ?? {};
  const bag = [];
  for (const id of Object.keys(fifty).sort()) {
    const room = Math.min(fifty[id], STRAT_MAP[id]?.copies ?? fifty[id]) - (deck[id] ?? 0);
    for (let i = 0; i < room; i += 1) bag.push(id);
  }
  let count = Object.values(deck).reduce((t, n) => t + n, 0);
  while (count < size && bag.length) {
    const [id] = bag.splice(Math.floor(rng() * bag.length), 1);
    deck[id] = (deck[id] ?? 0) + 1;
    count += 1;
  }
  return deck;
}
