// THE CLIMB'S PERKS — its relics. The user (2026-10-19): run-long things
// "would have to be similar to relics dropped by rivalries and bosses", while
// the cards are what lasts a game. A Rivalry win offers one perk of three, or
// skip; a boss will when there are acts after it (piece 4).
//
// The first four are "Build a player" from the scaling draft
// (docs/plans/2026-10-19-the-climb-scaling-draft.md), approved "Go for it":
// one player on your team becomes the run's monster card. A player perk moves
// one number on one player for the rest of the run; the run keeps it as
// { id, target } and applies it when a game is set up (run.js presetFor), so
// the card itself never changes.
import { PLUS, isPlus, STRAT_MAP } from '../strats.js';

/** No one number on one player moves more than this over a run. */
export const PERK_CAP = 3;

export const PERKS = Object.freeze({
  gym_rat: Object.freeze({
    name: 'Gym Rat', icon: '🏋️', target: 'player', stat: 'power', step: 1,
    text: 'Choose one of your players: +1 Power for the rest of the run.',
  }),
  extra_reps: Object.freeze({
    name: 'Extra Reps', icon: '🎯', target: 'player', stat: 'shotLine', step: -1,
    text: 'Choose one of your players: his Shot Line improves by 1 for the rest of the run.',
  }),
  signature_move: Object.freeze({
    name: 'Signature Move', icon: '✍️', target: 'player', stat: 'threePtBoost', step: 1,
    text: 'Choose one of your players: +1 3PT Bonus for the rest of the run.',
  }),
  film_study: Object.freeze({
    name: 'Film Study', icon: '🎞️', target: 'card',
    text: 'Choose a card in your deck: one copy becomes its "+" now, as Practice does.',
  }),
});
export const PERK_IDS = Object.freeze(Object.keys(PERKS));

/** How far each player's numbers have moved: { [cardKey]: { power: 1, shotLine: -1, ... } }. */
export function boostsOf(run) {
  const out = {};
  for (const p of run?.perks ?? []) {
    const def = PERKS[p.id];
    if (!def || def.target !== 'player' || !p.target) continue;
    const b = (out[p.target] ??= {});
    b[def.stat] = (b[def.stat] ?? 0) + def.step;
  }
  return out;
}

/** A card with its run's boosts on it — a copy, never the card itself. */
export function boostedCard(card, boost) {
  if (!card || !boost) return card;
  const out = { ...card };
  for (const [stat, d] of Object.entries(boost)) out[stat] = (out[stat] ?? 0) + d;
  return out;
}

/** The deck's copies Film Study (or Practice) can upgrade: an approved "+", not one already. */
export const practicable = deck => Object.keys(deck ?? {}).filter(id => deck[id] > 0 && !isPlus(id) && PLUS[id] && STRAT_MAP[id]);

/** Why `target` cannot take perk `id` on this run, or null. */
export function perkProblem(run, id, target, rosterKeys) {
  const def = PERKS[id];
  if (!def) return 'No such perk';
  if (def.target === 'card') return practicable(run.deck).includes(target) ? null : 'Choose a card in your deck that has a "+"';
  if (!rosterKeys.includes(target)) return 'Choose one of your players';
  const moved = Math.abs(boostsOf(run)[target]?.[def.stat] ?? 0);
  return moved >= PERK_CAP ? `Already moved ${PERK_CAP} on that number` : null;
}

/** Three perks to choose from (fewer if fewer can be taken), seeded. */
export function perkOffer(run, rng, rosterKeys) {
  const can = PERK_IDS.filter(id => (PERKS[id].target === 'card'
    ? practicable(run.deck).length > 0
    : rosterKeys.some(k => !perkProblem(run, id, k, rosterKeys))));
  const out = [];
  while (out.length < 3 && can.length) out.push(can.splice(Math.floor(rng() * can.length), 1)[0]);
  return out;
}
