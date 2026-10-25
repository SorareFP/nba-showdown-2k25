// THE CLIMB'S PERKS — its relics. The user (2026-10-19): run-long things
// "would have to be similar to relics dropped by rivalries and bosses", while
// the cards are what lasts a game. A win can offer one perk of three, or skip;
// a boss's reward always does (continueClimb), from the boss's own pool.
//
// The first four are "Build a player" from the scaling draft
// (docs/plans/2026-10-19-the-climb-scaling-draft.md), approved "Go for it":
// one player on your team becomes the run's monster card. A player perk moves
// a number on one player for the rest of the run; the run keeps it as
// { id, target, at } and applies it when a game is set up (run.js presetFor),
// so the card itself never changes.
//
// THE SECOND WAVE (2026-10-22, docs/plans/2026-10-22-the-climb-perks-draft.md;
// the user: "All these perks are awesome by the way!"), from Slay the Spire's
// relics. Three kinds of target:
//   player  a number (or two) on one of your players
//   card    one copy in your deck (Film Study)
//   team    the whole run, taken once: a game-long effect the engine reads
//           (`game`, presetFor sends them as gameOpts.perks), or one the run
//           reads between games
// `ledger`: the server keeps it too (climbPerk), because the pot or the
// ledger's own rules read it — Sponsorship, Max Contract, Second Chance,
// Travel Day. `boss`: only a boss's reward offers it. `shooting`: an offer
// never shows two of these.
import { PLUS, isPlus, STRAT_MAP } from '../strats.js';
import { LEDGER_PERK_KINDS, SPONSOR_SHARE, TRAVEL_DAYS } from './climbMap.js';

export { LEDGER_PERK_KINDS, SPONSOR_SHARE, TRAVEL_DAYS };

/** No one number on one player moves more than this over a run. */
export const PERK_CAP = 3;

export const PERKS = Object.freeze({
  gym_rat: Object.freeze({
    name: 'Gym Rat', icon: '🏋️', target: 'player', stat: 'power', step: 1,
    text: 'Choose one of your players: +1 Power for the rest of the run.',
  }),
  extra_reps: Object.freeze({
    name: 'Extra Reps', icon: '🎯', target: 'player', stat: 'shotLine', step: -1, shooting: true,
    text: 'Choose one of your players: their Shot Line improves by 1 for the rest of the run.',
  }),
  // +2 since 2026-10-22 (the user: "extra reps makes signature move kind of
  // redundant when they appear at the same time"): +1 on every check, or +2
  // on the one shot your shooter takes most.
  signature_move: Object.freeze({
    name: 'Signature Move', icon: '✍️', target: 'player', stat: 'threePtBoost', step: 2, shooting: true,
    text: 'Choose one of your players: +2 3PT Bonus for the rest of the run.',
  }),
  film_study: Object.freeze({
    name: 'Film Study', icon: '🎞️', target: 'card',
    text: 'Choose a card in your deck: one copy becomes its "+" now, as Practice does.',
  }),
  post_moves: Object.freeze({
    name: 'Post Moves', icon: '🪨', target: 'player', stat: 'paintBoost', step: 2, shooting: true,
    text: 'Choose one of your players: +2 Paint Bonus for the rest of the run.',
  }),
  track_work: Object.freeze({
    name: 'Track Work', icon: '👟', target: 'player', stat: 'speed', step: 1,
    text: 'Choose one of your players: +1 Speed for the rest of the run.',
  }),
  lockdown_drills: Object.freeze({
    name: 'Lockdown Drills', icon: '🔒', target: 'player', stat: 'defBoost', step: 1,
    text: 'Choose one of your players: +1 Defensive Bonus for the rest of the run.',
  }),
  scouting_report: Object.freeze({
    name: 'Scouting Report', icon: '📋', target: 'team', game: true,
    text: 'Every game, one more card in your opening hand.',
  }),
  fast_start: Object.freeze({
    name: 'Fast Start', icon: '🚀', target: 'team', game: true,
    text: "In each game's first section, your scoring rolls are +1.",
  }),
  closers: Object.freeze({
    name: 'Closers', icon: '⏱️', target: 'team', game: true,
    text: 'In Crunch Time, your scoring rolls are +1.',
  }),
  rim_deterrent: Object.freeze({
    name: 'Rim Deterrent', icon: '🖐️', target: 'team', game: true,
    text: 'Every game, the first Paint check taken against you is at −3.',
  }),
  ball_movement_culture: Object.freeze({
    name: 'Ball Movement Culture', icon: '🔁', target: 'team', game: true,
    text: 'Every fifth strategy card you play in a game draws a card.',
  }),
  training_staff: Object.freeze({
    name: 'Training Staff', icon: '🩺', target: 'team',
    text: 'After every win, each tracker comes down 2 more minutes.',
  }),
  shootaround: Object.freeze({
    name: 'Shootaround', icon: '🏀', target: 'team',
    text: 'When you Rest at a Rest Day, also practise one card.',
  }),
  advance_scout: Object.freeze({
    name: 'Advance Scout', icon: '🔭', target: 'team',
    text: 'Strategy-card rewards show four cards, not three.',
  }),
  scouting_network: Object.freeze({
    name: 'Scouting Network', icon: '🕸️', target: 'team',
    text: 'Every Game win offers a player, not about half of them.',
  }),
  sponsorship: Object.freeze({
    name: 'Sponsorship', icon: '💼', target: 'team', ledger: true,
    text: 'From here on, every win adds 20% more to the pot.',
  }),
  travel_day: Object.freeze({
    name: 'Travel Day', icon: '✈️', target: 'team', ledger: true,
    text: 'Three times this run, go to any stop on the next floor, linked or not.',
  }),
  // ── A boss's reward only: big upside, usually at a real cost ──
  second_chance: Object.freeze({
    name: 'Second Chance', icon: '🔄', target: 'team', boss: true, ledger: true,
    text: 'Once this run, a loss is replayed instead of ending the run. The pot stays.',
  }),
  win_now_trade: Object.freeze({
    name: 'Win-Now Trade', icon: '💰', target: 'team', boss: true,
    text: '+$900 of cap now. From here on, a Rest Day cannot rest: practise or cut only.',
  }),
  max_contract: Object.freeze({
    name: 'Max Contract', icon: '⭐', target: 'player', boost: Object.freeze({ speed: 2, power: 2 }), boss: true, ledger: true,
    text: 'Choose one of your players: +2 Speed and +2 Power. From here on, Games add nothing to the pot (Rivalries and bosses still do).',
  }),
  heavy_minutes: Object.freeze({
    name: 'Heavy Minutes', icon: '🔥', target: 'team', game: true, boss: true,
    text: 'Your scoring rolls are +1, and every starter adds a minute of fatigue each section.',
  }),
  short_rotation: Object.freeze({
    name: 'Short Rotation', icon: '✂️', target: 'team', game: true, boss: true,
    text: 'Draw one more card each section, and play at most two strategy cards a section.',
  }),
  // AN EVENT'S, NEVER OFFERED (`event`, 2026-10-25): Contract Year's raise
  // (climbEvents.js), kept with the perks so the boost rides the same way.
  contract_year: Object.freeze({
    name: 'Contract Year', icon: '📝', target: 'player', boost: Object.freeze({ speed: 1, power: 1 }), event: true,
    text: 'Playing for a new deal: +1 Speed and +1 Power for the run, and $150 more salary.',
  }),
  front_office: Object.freeze({
    name: 'Front Office Shake-Up', icon: '🏢', target: 'team', boss: true,
    text: 'Now: cut two cards from your deck and practise two.',
  }),
});
export const PERK_IDS = Object.freeze(Object.keys(PERKS));
/** The perks a game's engine reads (presetFor sends them as gameOpts.perks). */
export const GAME_PERKS = Object.freeze(PERK_IDS.filter(id => PERKS[id].game));
/** The perks the server's ledger keeps (climbPerk; climbMap.js LEDGER_PERK_KINDS is the server's copy). */
export const LEDGER_PERKS = Object.freeze(PERK_IDS.filter(id => PERKS[id].ledger));
/** Win-Now Trade's cap. */
export const WIN_NOW_CAP = 900;

/** Has the run taken this perk? */
export const hasPerk = (run, id) => (run?.perks ?? []).some(p => p.id === id);

/** What a player perk moves: { stat: step }. */
const movesOf = def => def.boost ?? { [def.stat]: def.step };

/** How far each player's numbers have moved: { [cardKey]: { power: 1, shotLine: -1, ... } }. */
export function boostsOf(run) {
  const out = {};
  for (const p of run?.perks ?? []) {
    const def = PERKS[p.id];
    if (!def || def.target !== 'player' || !p.target) continue;
    const b = (out[p.target] ??= {});
    for (const [stat, step] of Object.entries(movesOf(def))) b[stat] = (b[stat] ?? 0) + step;
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

/** Why `target` cannot take perk `id` on this run, or null. A team perk takes no target and is taken once. */
export function perkProblem(run, id, target, rosterKeys) {
  const def = PERKS[id];
  if (!def) return 'No such perk';
  if (def.target === 'team') return hasPerk(run, id) ? 'Already taken this run' : null;
  if (def.target === 'card') return practicable(run.deck).includes(target) ? null : 'Choose a card in your deck that has a "+"';
  if (!rosterKeys.includes(target)) return 'Choose one of your players';
  const moved = boostsOf(run)[target] ?? {};
  const over = Object.entries(movesOf(def)).some(([stat, step]) => Math.abs((moved[stat] ?? 0) + step) > PERK_CAP);
  return over ? `That would move a number past ${PERK_CAP}` : null;
}

/**
 * Three perks to choose from (fewer if fewer can be taken), seeded. `pool`:
 * 'game' for a Game's or Rivalry's drop, 'boss' for a boss's reward. Never
 * two shooting perks in one offer (the user, 2026-10-22).
 */
export function perkOffer(run, rng, rosterKeys, pool = 'game', count = 3) {
  const can = PERK_IDS.filter(id => !PERKS[id].event && Boolean(PERKS[id].boss) === (pool === 'boss') && (PERKS[id].target === 'card'
    ? practicable(run.deck).length > 0
    : PERKS[id].target === 'team'
      ? !perkProblem(run, id, null, rosterKeys)
      : rosterKeys.some(k => !perkProblem(run, id, k, rosterKeys))));
  const out = [];
  while (out.length < count && can.length) {
    const id = can.splice(Math.floor(rng() * can.length), 1)[0];
    out.push(id);
    if (PERKS[id].shooting) for (let i = can.length - 1; i >= 0; i -= 1) if (PERKS[can[i]].shooting) can.splice(i, 1);
  }
  return out;
}
