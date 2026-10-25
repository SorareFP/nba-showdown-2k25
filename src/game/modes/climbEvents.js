// THE CLIMB'S ? STOPS — events (2026-10-25,
// docs/plans/2026-10-25-the-climb-events-and-styles-draft.md; the user: "Those
// work"). Slay the Spire's ? rooms: a short scene with two choices, usually a
// trade-off, each something a real team lives through. This file is the
// scenes' words; run.js (chooseEvent) is what each choice does, and
// eventChoices there says which can be taken.
//
// `{name}` in a text is the event's player (the run picks one where the scene
// is about someone: the lowest-paid for a trade, a random one for an injury).

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
    text: 'The shooting gym was on fire this week.',
    choices: { hot: 'Your two highest-paid players start the next game with a hot marker each', power: 'Every player of yours +1 Power in the next game' },
  },
  contract_year: {
    title: 'Contract Year',
    text: '{name} is playing for a new deal, and wants it now.',
    choices: { pay: '{name} +1 Speed and +1 Power for the run; their salary rises $150', pass: 'Not now' },
  },
  back_to_back: {
    title: 'Back-to-Back',
    text: 'The schedule stacks two games on two nights.',
    choices: { play: 'Play it: every player carries 4 more minutes into the next game, and a win there pays a perk for sure', rest: 'Rest the team instead: every tracker cleared, no perk' },
  },
});
export const EVENT_IDS = Object.freeze(Object.keys(EVENTS));

/** An event's words with its player's name in. */
export const eventText = (text, name) => String(text ?? '').replaceAll('{name}', name ?? 'A player');
