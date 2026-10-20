// THE CLIMB'S STARTER KITS — the sixteen strategy cards a run begins with.
//
// A shared CORE of seven (the switching cards every deck carries: placement
// sets the matchups, and only these move a defender) plus nine SIGNATURE
// cards of the playbook chosen at Training Camp, one of them a crunch card.
//
// THE KITS GREW, 2026-10-19 (approved by the user: "Let's try the kits"). The
// user: "the base decks should have a clutch time card in each", and "There
// are basically no shot checks in user decks to start" — the Defense kit had
// none. Each kit gained a crunch card (all are rares; Unethical Hoops is a
// promo and stays out), and Defense traded a Close Out and Help Defender for
// two Transition Outlets. Coaches play these kits too. Drafted by hand from what
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
    second_closer: 1,
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
    ato_masterpiece: 1,
  }),
  // Contests, rim protection, wearing the other side down.
  defense: Object.freeze({
    close_out: 1,
    drop_coverage: 1,
    smothering_defense: 1,
    pick_up_full_court: 1,
    rim_protector: 1,
    cold_spell: 1,
    transition_outlet: 2,
    hack_a: 1,
  }),
});

export const PLAYBOOKS = Object.freeze(['speed', 'paint', 'defense']);

/** The playbook each fitted archetype (deckFit.js nearestArchetype) plays. */
export const PLAYBOOK_OF_ARCHETYPE = Object.freeze({ fast: 'speed', big: 'paint', stoppy: 'defense' });

/** A playbook's sixteen: the core plus its nine. */
export function kitDeck(playbook) {
  const deck = { ...CORE };
  for (const [id, n] of Object.entries(KITS[playbook] ?? {})) deck[id] = (deck[id] ?? 0) + n;
  return deck;
}

/**
 * Every card in the core or a kit. Since the kits grew (2026-10-19) this is no
 * longer the set with a "+": four kit cards have none yet, and Help Defender
 * keeps its approved "+" outside the kits. What can be practised is what has
 * a "+" (strats.js PLUS).
 */
export const KIT_CARD_IDS = new Set([
  ...Object.keys(CORE),
  ...PLAYBOOKS.flatMap(pb => Object.keys(KITS[pb])),
]);

/** The size of every kit (they are all the same): the Act I coach's deck. */
export const KIT_SIZE = Object.values(kitDeck(PLAYBOOKS[0])).reduce((t, n) => t + n, 0);

// Where the text rule below files a card in the wrong kit: a defensive card
// in the speed kit leans speed, and Close Out, in two kits, leans defense.
// Burned on the Switch is a core switching card and leans nowhere. Second
// Closer (no lean by its text) and Transition Outlet (paint by its text) lean
// to the kits they joined on 2026-10-19.
const LEAN_OVERRIDES = Object.freeze({
  burned_switch: null,
  second_closer: 'speed',
  transition_outlet: 'defense',
  close_out: 'defense',
  passing_lane: 'speed',
  box_out: 'paint',
  glass_cleaner: 'paint',
  // The Climb's wave two (2026-10-20), as the drafts placed them.
  get_stops: 'defense', talk_on_defense: 'defense', full_court_press: 'defense',
  ball_movement: 'speed', up_tempo: 'speed',
  wear_them_down: 'paint', crash_every_board: 'paint', play_through_contact: 'paint',
  film_session: null, signature_set: null, leave_it_all: null, ride_your_star: null, two_a_days: null,
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
 * THE COACH'S DECK at a stop: the kit of the playbook its roster sits nearest,
 * plus `extra` cards from that archetype's fitted fifty, drawn by its copies
 * and never past a card's limit. `singles` keeps one copy of each card (kit
 * and extras alike); `rares: false` draws no rare or legendary extra.
 */
export function coachDeck(roster, { extra = 0, singles = false, rares = true } = {}, rng = Math.random) {
  const near = nearestArchetype(roster);
  const kit = kitDeck(PLAYBOOK_OF_ARCHETYPE[near?.id] ?? PLAYBOOKS[0]);
  // ONE OF EACH (2026-10-20, Act I). The user: "On the first act, they
  // shouldn't just be dropping two instances of bully ball. They already have
  // a higher salary cap and better players, their strategy decks shouldn't be
  // so good right away either."
  const deck = singles ? Object.fromEntries(Object.keys(kit).map(id => [id, 1])) : kit;
  const fifty = ARCHETYPE_DECKS.find(a => a.id === near?.id)?.deck ?? {};
  const bag = [];
  for (const id of Object.keys(fifty).sort()) {
    if (!rares && ['rare', 'legendary'].includes(STRAT_MAP[id]?.rarity)) continue;
    const most = singles ? 1 : Math.min(fifty[id], STRAT_MAP[id]?.copies ?? fifty[id]);
    const room = most - (deck[id] ?? 0);
    for (let i = 0; i < room; i += 1) bag.push(id);
  }
  for (let n = 0; n < extra && bag.length; n += 1) {
    const [id] = bag.splice(Math.floor(rng() * bag.length), 1);
    deck[id] = (deck[id] ?? 0) + 1;
  }
  return deck;
}
