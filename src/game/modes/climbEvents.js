// THE CLIMB'S ? STOPS — events (2026-10-25,
// docs/plans/2026-10-25-the-climb-events-and-styles-draft.md; the user: "Those
// work"). Slay the Spire's ? rooms: a short scene with two choices, usually a
// trade-off, each something a real team lives through. This file is the
// scenes' words; run.js (chooseEvent) is what each choice does, and
// eventChoices there says which can be taken.
//
// `{name}` in a text is the event's player (the run picks one where the scene
// is about someone: the lowest-paid for a trade, a random one for an injury).
//
// THE VARIANCE PASS (2026-10-27). The user: "It feels like all the question
// mark rooms in the climb are positive", then "I'm ok with there being a few
// instances of all good, I just want variance in the experience". Ten of the
// twelve had a choice that cost nothing. Now three are all good (Film Room,
// Team Meeting, Front-Office Leak), three a gain or nothing, two an optional
// risk, and seven cost something whichever way you go: Hot Streak and
// Back-to-Back were reworked, Holdout, Flu Bug and Budget Cuts are new. And a
// quarter of the ? stops on a new map are a Makeup Game (climbMap.js
// MAKEUP_CHANCE), a Game behind the ?.

export const EVENTS = Object.freeze({
  trade_call: {
    title: 'Trade Call',
    text: 'A front office calls about {name}. They will send one of three better players back, if the money works.',
    choices: { take: 'Take the call: trade {name} for one of three', pass: 'Hang up' },
  },
  locker_room: {
    title: 'Locker-Room Dispute',
    text: '{name} and the coaching staff are not speaking. It has to be settled before the next game.',
    choices: { sit: '{name} sits the next game', grind: 'Play through it: every player carries 4 more minutes into the next game' },
  },
  film_room: {
    title: 'Film Room',
    text: 'A long night with the tape. What it shows changes the playbook.',
    choices: { upgrade: 'Practise one card into its "+"', cut: 'Cut two cards from your deck' },
  },
  two_way: {
    title: 'Two-Way Contract',
    text: 'A G League call-up is available on a two-way deal: off the books, but only for three games.',
    choices: { sign: 'Sign one of three, free, for three games', pass: 'Pass' },
  },
  summer_tape: {
    title: 'Summer-League Tape',
    text: 'A scout swears by a set from summer league. It might be gold; it comes with a contract nobody wants.',
    choices: { take: 'Take a random rare card, and a Bad Contract (a dead card) with it', pass: 'Pass' },
  },
  injury_scare: {
    title: 'Injury Scare',
    text: '{name} came up limping at practice. The trainers are not sure.',
    choices: { gamble: 'Let them play it out: half the time they miss the next game, half the time they come back with 2 hot markers', rest: 'Rest them: they sit the next game and come back fresh' },
  },
  veteran_min: {
    title: 'Veteran Minimum',
    text: 'A few veterans would take the minimum to chase a ring.',
    choices: { sign: 'Sign one of three veterans; only half their salary counts against your cap', pass: 'Pass' },
  },
  team_meeting: {
    title: 'Team Meeting',
    text: 'The captains call a players-only meeting.',
    choices: { rest: 'Clear every tracker', upgrade: 'Practise one card into its "+"' },
  },
  front_office_leak: {
    title: 'Front-Office Leak',
    text: 'Someone in a front office talks too much.',
    choices: { scout: "See the rosters of the next two floors' teams", cap: '+$200 of cap room' },
  },
  hot_streak: {
    title: 'Hot Streak',
    text: 'Shootaround was streaky this week. Nobody can say which way it breaks.',
    choices: { hot: 'Ride your stars: a coin flip. Your two highest-paid players start the next game with 2 hot markers each, or with a cold marker each', power: 'Slow it down: every player of yours +1 Power and −1 Speed in the next game' },
  },
  contract_year: {
    title: 'Contract Year',
    text: '{name} is playing for a new deal, and wants it now.',
    choices: { pay: '{name} +1 Speed and +1 Power for the run; their salary rises $150', pass: 'Not now' },
  },
  back_to_back: {
    title: 'Back-to-Back',
    text: 'The schedule stacks two games on two nights.',
    choices: { play: 'Play it: every player carries 4 more minutes into the next game, and a win there pays a perk for sure', rest: 'Rest your star: your highest-paid player sits the next game, every tracker is cleared, no perk' },
  },
  holdout: {
    title: 'Holdout',
    text: '{name} wants a new deal and will not suit up without one.',
    choices: { pay: 'Pay them: $200 more on their salary for the run', sit: 'Call their bluff: they sit the next two games' },
  },
  flu_bug: {
    title: 'Flu Bug',
    text: 'Something is going around the locker room, and {name} has it worst.',
    choices: { quarantine: '{name} stays home: they sit the next game', play: 'Play through it: every player of yours −1 Speed and −1 Power in the next game' },
  },
  budget_cuts: {
    title: 'Budget Cuts',
    text: 'Ownership wants the payroll trimmed.',
    choices: { cap: 'Trim the budget: $300 less cap room', card: 'Sell a prized play: one of your rare or "+" cards, at random, leaves your deck' },
  },
  // Not drawn: a Makeup Game is a Game the map hides behind a ? (MAKEUP).
  makeup_game: {
    title: 'Makeup Game',
    text: 'A game postponed earlier in the season is back on the schedule, tonight. It plays and pays as a Game, and a loss ends the run.',
    choices: { play: 'Play it' },
  },
});
/** The ? stop that is a Game in disguise (climbMap.js MAKEUP_CHANCE). */
export const MAKEUP = 'makeup_game';
/** The scenes a ? stop draws from: every one but the Makeup Game, which the map places. */
export const EVENT_IDS = Object.freeze(Object.keys(EVENTS).filter(id => id !== MAKEUP));

/** An event's words with its player's name in. */
export const eventText = (text, name) => String(text ?? '').replaceAll('{name}', name ?? 'A player');
