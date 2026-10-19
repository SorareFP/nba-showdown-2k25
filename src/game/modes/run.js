// THE CLIMB — one run, from Training Camp to the boss, as pure seeded steps.
//
// docs/plans/2026-10-18-the-climb-design.md (the spec) and
// docs/plans/2026-10-18-the-climb.md (Task 5). A run is a document the
// browser keeps (users/{uid}/runs/{id}); every step here takes a run and
// returns the next one, and every draw comes from climbRng(run.seed, ...), so
// the same seed and the same choices give the same run. Nothing here pays:
// the pot is priced on the server from the stops it saw cleared (climbBank).
//
//   camp ─chooseCamp→ map ─chooseStop→ game ─recordResult→ reward ─pick/skip→ map
//                       │                          └→ lost | won
//                       ├─chooseStop(Rest Day)→ rest ─restDay→ map
//                       └─retire→ retired
import { generateMap, stopById, nextStops, potOf, climbRng, MAP_VERSION } from './climbMap.js';
import { PLAYBOOKS, PLAYBOOK_OF_ARCHETYPE, KIT_CARD_IDS, kitDeck, leanOf, coachDeck } from './climbKits.js';
import { buildAiRoster, buildClassicRoster, classicFranchises, franchisePool } from './aiTeams.js';
import { STRATS, STRAT_MAP, baseId, isPlus, plusId } from '../strats.js';
import { ALL_CARDS, DORMANT_KEYS, cardKey, getCardByKey } from '../cardSets.js';
import { isFeatCard } from '../recordBreakers.js';
import { capOf } from '../coinRewards.js';
import { nearestArchetype } from '../deckFit.js';
import { capSal } from '../teamRules.js';
import { TEAMS } from '../../cards/teams.js';

/**
 * THE NUMBERS — set by simulated runs (scripts/analysis/runClimbSim.js,
 * 2026-10-18, 400 runs a rung; the coach plays both sides and "you" draft
 * simply): about 80% of Games and 70% of Rivalries won, a third of runs reach
 * the boss. The spec's starting caps ($2,600 at floor 1) won a third of the
 * first games.
 *   floorCaps  the coach's cap at each floor: flat while your five has no
 *              bench (your median team is $2,100 to floor 3, $3,100 at 4-5,
 *              $4,000 at the boss), steeper once the rewards fill it
 *   bossCap    1.2 x the median team at the boss ($4,000): the bottom of the
 *              user's 1.2-1.4 (2026-10-18). Simulated drafters beat it 8-18%
 *              of the time, by franchise — a wall for a run that coasted.
 *   recovery   minutes off every tracker between games, by the win's margin
 *              (the user: "Maybe win margin helps recover things?"). 10 lets
 *              a full-quarter starter carry 2 minutes from a close win; at 8,
 *              floors 2-6 were coin flips.
 */
/*
 * ACT I EASED (the user, 2026-10-19: "losing in the second or third game so
 * often is tough ... in Slay, the early opponents are fairly easy and you just
 * need to be smart about how you navigate it"; the coaches had "ridiculous
 * strategy cards that the players don't have access to"). Floors 1-3: the
 * coach plays its own fifteen-card kit, nothing from its fifty (no rares, no
 * legendaries), on a cheaper roster. 300 runs at Prince: floors 1-3 won
 * 95/90/92% (were 83/71/72), 15% of runs over by floor 3 (were 46%), 54% reach
 * the boss (31%), which still holds at ~15%: 8% win the act (6%).
 */
export const FLOOR_CAPS = [1300, 1350, 1450, 2100, 2200, 2450, 2700];
/** The last floor whose coach plays only its kit. */
export const KIT_ONLY_FLOORS = 3;
export const CLIMB = {
  startCap: 2200,
  capPerFloor: 300,
  floorCap: f => FLOOR_CAPS[Math.min(FLOOR_CAPS.length, Math.max(1, f)) - 1],
  rivalryExtra: 250,
  bossCap: 4800,
  oppSize: [5, 5, 6, 6, 7, 7],
  bossSize: 8,
  coachDeckSize: f => (f <= KIT_ONLY_FLOORS ? 15 : 15 + Math.round((f - 1) * 10 / 7)),
  recovery: { base: 10, by10: 12, by20: 14 },
  rareChance: f => 0.05 + 0.2 * (f - 1) / 6,
  maxRoster: 10,
};

export const BOONS = ['extra_picks', 'cut_two', 'cap_400', 'rare_strat', 'free_rest'];

/** Minutes off every player's tracker between games, by the margin of the win. */
export function recoveryFor(margin) {
  const m = Number(margin) || 0;
  if (m >= 20) return CLIMB.recovery.by20;
  if (m >= 10) return CLIMB.recovery.by10;
  return CLIMB.recovery.base;
}

// The strategy cards a reward or a boon can offer: what a pack can deal, less
// the legendaries (piece 1 offers none).
const OFFERABLE = STRATS.filter(s => !s.promo && s.rarity !== 'legendary');
// The players a reward can offer: any live card in any set, never a feat card.
const PLAYER_POOL = ALL_CARDS.filter(c => !DORMANT_KEYS.has(cardKey(c)) && !isFeatCard(c));

const fail = msg => { throw new Error(msg); };
const pickFrom = (rng, list) => list[Math.floor(rng() * list.length)];
function shuffled(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const dollars = n => `$${n.toLocaleString('en-US')}`;

/** Copies of a card in a deck, plain and "+" together: the copy limit is the card's. */
const copiesOf = (deck, id) => (deck?.[id] ?? 0) + (deck?.[plusId(id)] ?? 0);
const atLimit = (deck, id) => copiesOf(deck, id) >= (STRAT_MAP[id]?.copies ?? Infinity);
function addCard(deck, id) {
  return { ...deck, [id]: (deck[id] ?? 0) + 1 };
}
function takeCard(deck, id) {
  if (!(deck[id] > 0)) fail(`The deck has no ${STRAT_MAP[baseId(id)]?.name ?? id}`);
  const out = { ...deck, [id]: deck[id] - 1 };
  if (out[id] === 0) delete out[id];
  return out;
}

/** The run's players, through the aliases; a key that no longer resolves is dropped, and under five blocks play. */
export function rosterCards(run) {
  const cards = [];
  const dropped = [];
  for (const key of run.roster ?? []) {
    const c = getCardByKey(key);
    if (c) cards.push(c); else dropped.push(key);
  }
  return { cards, dropped, blocked: cards.length < 5 ? 'roster' : null };
}

const fitsOf = cards => PLAYBOOK_OF_ARCHETYPE[nearestArchetype(cards)?.id] ?? PLAYBOOKS[0];

/** A new run: five owned players under the starting cap, at a rung. Opens on Training Camp. */
/**
 * A CLIMB FIVE — what a run starts with, and what My Teams saves ahead (the
 * user, 2026-10-19: "we definitely need to be able to pre-make eligible
 * lineups").
 */
export const CLIMB_FIVE = { cap: CLIMB.startCap, size: 5 };

/**
 * Why these keys cannot start a climb, or null when they can: five players,
 * every card still in the game and (given `ownedKeys`) still yours, one card a
 * player, at most the starting cap. One rule for the editor, the start screen
 * and newRun.
 */
export function fiveProblem(rosterKeys, ownedKeys = null) {
  const keys = rosterKeys ?? [];
  if (keys.length !== CLIMB_FIVE.size) return 'A climb starts with five players';
  const cards = keys.map(k => getCardByKey(k));
  const gone = keys.find((k, i) => !cards[i]);
  if (gone) return `${gone.split(':').pop().replace(/_/g, ' ')} no longer exists`;
  if (ownedKeys) {
    const lost = cards.find(c => !ownedKeys.has(cardKey(c)));
    if (lost) return `You no longer own ${lost.name}`;
  }
  if (new Set(cards.map(c => c.id)).size !== cards.length) return 'One card a player';
  const sal = capSal(cards);
  if (sal > CLIMB_FIVE.cap) return `${dollars(sal)}, over the ${dollars(CLIMB_FIVE.cap)} cap`;
  return null;
}

export function newRun({ id, seed, rung, rosterKeys, now = Date.now(), mapVersion = MAP_VERSION }) {
  const problem = fiveProblem(rosterKeys);
  if (problem) fail(problem);
  const cards = rosterKeys.map(k => getCardByKey(k));
  const rng = climbRng(seed, 'camp');
  return {
    id, seed, rung, createdAt: now, mapVersion,
    status: 'camp',
    map: generateMap(seed, mapVersion),
    cap: CLIMB.startCap,
    roster: cards.map(cardKey),
    deck: null,
    playbook: null,
    fatigue: {},
    cleared: [],
    at: null,
    restAt: null,
    gameWins: 0,
    extraPicks: 0,
    freeRest: 0,
    camp: { fits: fitsOf(cards), boons: shuffled(BOONS, rng).slice(0, 3) },
    game: null,
    offers: null,
  };
}

/** Training Camp: a playbook's fifteen and one boon of the three offered. */
export function chooseCamp(run, { playbook, boon, cuts = [] }) {
  if (run.status !== 'camp') fail('Training Camp is over');
  if (!PLAYBOOKS.includes(playbook)) fail(`No playbook ${playbook}`);
  if (!run.camp?.boons?.includes(boon)) fail('That boon was not offered');
  let deck = kitDeck(playbook);
  let { cap, extraPicks, freeRest } = run;
  if (boon === 'cut_two') {
    if (cuts.length !== 2) fail('Choose two cards to cut');
    for (const id of cuts) deck = takeCard(deck, id);
  } else if (boon === 'cap_400') {
    cap += 400;
  } else if (boon === 'rare_strat') {
    const rares = OFFERABLE.filter(s => s.rarity === 'rare' && !atLimit(deck, s.id));
    deck = addCard(deck, pickFrom(climbRng(run.seed, 'camp', 'rare'), rares).id);
  } else if (boon === 'free_rest') {
    freeRest += 1;
  } else if (boon === 'extra_picks') {
    extraPicks = 3;
  }
  return { ...run, status: 'map', playbook, boon, deck, cap, extraPicks, freeRest };
}

/** Where the run can go next. */
export function openStops(run) {
  if (run.status !== 'map') return [];
  return nextStops(run.map, run.at);
}

// ── Opponents ────────────────────────────────────────────────────────────────

/** The boss's franchise: one that can field a classic team at the boss's cap. */
function bossFranchise(run) {
  const list = classicFranchises({ cap: Math.round(CLIMB.bossCap * capOf(run.rung)), size: CLIMB.bossSize });
  return pickFrom(climbRng(run.seed, 'boss'), list);
}

/** Who waits at the top of the map, known from the start as in StS: the boss's franchise and its logo. */
export function bossTeam(run) {
  const abbr = bossFranchise(run);
  const team = TEAMS[abbr] ?? {};
  return { abbr, name: team.name ?? abbr, city: team.city ?? '', logo: team.logo ?? null };
}

/** The franchises the run's fights meet, in order, never the boss's and never twice. */
function franchiseOrder(run) {
  const boss = bossFranchise(run);
  const list = franchisePool().map(f => f.abbr).filter(a => a !== boss).sort();
  return shuffled(list, climbRng(run.seed, 'franchises'));
}

/** The fight at a stop: the coach's team and deck, and the key its game is saved and claimed under. */
export function gameSetup(run, stopId) {
  const stop = stopById(run.map, stopId);
  if (!stop || stop.kind === 'rest') fail('No game there');
  const boss = stop.kind === 'boss';
  const mult = capOf(run.rung);
  const rng = climbRng(run.seed, 'roster', stopId);
  let abbr;
  let cap;
  let roster;
  if (boss) {
    abbr = bossFranchise(run);
    cap = Math.round(CLIMB.bossCap * mult);
    roster = buildClassicRoster(abbr, { cap, size: CLIMB.bossSize, rng });
  } else {
    const order = franchiseOrder(run);
    abbr = order[run.cleared.length % order.length];
    cap = Math.round((CLIMB.floorCap(stop.floor) + (stop.kind === 'rivalry' ? CLIMB.rivalryExtra : 0)) * mult);
    roster = buildAiRoster(abbr, { size: CLIMB.oppSize[stop.floor - 1] ?? CLIMB.bossSize, cap, rng });
  }
  const team = TEAMS[abbr] ?? {};
  return {
    key: `climb:${run.id}:${stopId}`,
    stopId, kind: stop.kind, floor: stop.floor,
    rosterB: roster.map(cardKey),
    deckB: coachDeck(roster, CLIMB.coachDeckSize(stop.floor), climbRng(run.seed, 'deck', stopId)),
    aiLevel: run.rung,
    cap,
    opponent: { abbr, name: team.name ?? abbr, city: team.city ?? '', classic: boss },
  };
}

/** Go to a stop: a Rest Day, or a fight set up once and stored, so a resumed game is the same game. */
export function chooseStop(run, stopId) {
  if (rosterCards(run).blocked) fail('Fewer than five of your players are left; retire to bank the pot');
  if (!openStops(run).some(s => s.id === stopId)) fail('That stop is not open');
  const stop = stopById(run.map, stopId);
  if (stop.kind === 'rest') return { ...run, status: 'rest', restAt: stopId };
  return { ...run, status: 'game', game: gameSetup(run, stopId) };
}

/** What the Play tab deals for the run's game. */
export function presetFor(run) {
  const g = run.game;
  if (run.status !== 'game' || !g) fail('No game to play');
  return {
    key: g.key,
    rosterA: rosterCards(run).cards,
    rosterB: g.rosterB.map(k => getCardByKey(k)).filter(Boolean),
    deckA: { ...run.deck },
    deckB: { ...g.deckB },
    aiLevel: run.rung,
    returnTab: 'climb',
    gameOpts: { startQuarter: 4, fatigue: { A: { ...run.fatigue } } },
    climb: { runId: run.id, stopId: g.stopId, kind: g.kind, floor: g.floor, rung: run.rung },
  };
}

// ── Rewards ──────────────────────────────────────────────────────────────────

/**
 * Three strategy cards: two that lean to the playbook, one from anywhere.
 * Each is rare with the floor's chance; a Rivalry's third always is. Never a
 * card the deck holds at its limit, never one twice.
 */
export function stratOffer(run, stop, rng) {
  const chosen = [];
  [run.playbook, run.playbook, null].forEach((lean, slot) => {
    const rare = (stop.kind === 'rivalry' && slot === 2) || rng() < CLIMB.rareChance(stop.floor);
    const pool = OFFERABLE.filter(s => (!lean || leanOf(s.id) === lean) && !chosen.includes(s.id) && !atLimit(run.deck, s.id));
    const want = pool.filter(s => (s.rarity === 'rare') === rare);
    const from = want.length ? want : pool;
    if (from.length) chosen.push(pickFrom(rng, from).id);
  });
  return chosen;
}

/** Three players that fit under the cap, from the forty priciest that do; none when the roster is full. */
function playerOffer(run, rng) {
  const { cards } = rosterCards(run);
  if (cards.length >= CLIMB.maxRoster) return [];
  const room = run.cap - capSal(cards);
  const on = new Set(cards.map(c => c.id));
  const fits = PLAYER_POOL
    .filter(c => (c.salary ?? 0) <= room && !on.has(c.id))
    .sort((a, b) => (b.salary ?? 0) - (a.salary ?? 0) || cardKey(a).localeCompare(cardKey(b)));
  const seen = new Set();
  const top = [];
  for (const c of fits) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    top.push(c);
    if (top.length >= 40) break;
  }
  const out = [];
  while (out.length < 3 && top.length) out.push(cardKey(top.splice(Math.floor(rng() * top.length), 1)[0]));
  return out;
}

/**
 * The game's result. A loss — a tie after the last overtime too — ends the
 * run. A win clears the stop and the floor: the cap rises, every tracker
 * comes down by the recovery, and the offers are dealt.
 */
export function recordResult(run, { stopId, won, margin = 0, endMinutes = {} }) {
  if (run.status !== 'game' || run.game?.stopId !== stopId) return run;
  if (!won) return { ...run, status: 'lost', lostAt: stopId, game: null };
  const stop = stopById(run.map, stopId);
  const cleared = [...run.cleared, stopId];
  if (stop.kind === 'boss') return { ...run, status: 'won', at: stopId, cleared, game: null };
  const rec = recoveryFor(margin);
  const fatigue = {};
  for (const c of rosterCards(run).cards) {
    const left = Math.max(0, (endMinutes[c.id] ?? 0) - rec);
    if (left > 0) fatigue[c.id] = left;
  }
  const gameWins = run.gameWins + (stop.kind === 'game' ? 1 : 0);
  const next = { ...run, at: stopId, cleared, cap: run.cap + CLIMB.capPerFloor, fatigue, gameWins, game: null };
  const rng = climbRng(run.seed, 'offers', stopId);
  const players = stop.kind === 'rivalry' || (stop.kind === 'game' && gameWins % 2 === 0) ? playerOffer(next, rng) : [];
  const picks = 1 + (run.extraPicks > 0 ? 1 : 0);
  return {
    ...next,
    status: 'reward',
    extraPicks: Math.max(0, run.extraPicks - 1),
    offers: { stopId, strats: stratOffer(next, stop, rng), picks, players },
  };
}

/**
 * A WIN THE SERVER ALREADY HOLDS (final review, 2026-10-18): the game was
 * claimed, but its result never reached this run (the tab closed, another
 * device). Recorded as a win by nothing, with every player assumed to have
 * played the whole quarter — the box score is gone, and a guess should not
 * flatter the run.
 */
export function recordServerWin(run, stopId) {
  if (run.status !== 'game' || run.game?.stopId !== stopId) return run;
  const endMinutes = Object.fromEntries(rosterCards(run).cards.map(c => [c.id, (run.fatigue?.[c.id] ?? 0) + 12]));
  return recordResult(run, { stopId, won: true, margin: 0, endMinutes });
}

/**
 * GIVE THE RUN UP (final review, 2026-10-18) — the way out of a run that
 * disagrees with its ledger or whose bank keeps refusing. Its pot is gone.
 */
export function abandon(run) {
  if (run.status === 'lost' || run.banked) fail('That run is already over');
  return { ...run, status: 'lost', abandoned: true, game: null };
}

/** Back to the map once nothing is left to take. */
const settle = run => (run.offers && (run.offers.picks > 0 && run.offers.strats.length) || run.offers?.players?.length
  ? run
  : { ...run, status: 'map', offers: null });

export function pickStrat(run, id) {
  if (run.status !== 'reward' || !run.offers?.strats.includes(id) || !(run.offers.picks > 0)) fail('That card is not on offer');
  const picks = run.offers.picks - 1;
  return settle({
    ...run,
    deck: addCard(run.deck, id),
    offers: { ...run.offers, picks, strats: picks > 0 ? run.offers.strats.filter(x => x !== id) : [] },
  });
}

export function pickPlayer(run, key) {
  if (run.status !== 'reward' || !run.offers?.players.includes(key)) fail('That player is not on offer');
  return settle({ ...run, roster: [...run.roster, key], offers: { ...run.offers, players: [] } });
}

/** Skip the strats, the players, or (no part) everything still on offer. */
export function skipOffers(run, part = null) {
  if (run.status !== 'reward') fail('Nothing is on offer');
  if (part === 'strats') return settle({ ...run, offers: { ...run.offers, strats: [], picks: 0 } });
  if (part === 'players') return settle({ ...run, offers: { ...run.offers, players: [] } });
  return { ...run, status: 'map', offers: null };
}

// ── Rest ─────────────────────────────────────────────────────────────────────

function applyRest(run, { choice, cardId }) {
  if (choice === 'rest') return { ...run, fatigue: {} };
  if (choice !== 'practice') fail('Rest or Practice');
  if (isPlus(cardId)) fail('That copy is already upgraded');
  if (!KIT_CARD_IDS.has(cardId)) fail(`${STRAT_MAP[cardId]?.name ?? cardId}: no upgrade yet`);
  const deck = addCard(takeCard(run.deck, cardId), plusId(cardId));
  return { ...run, deck };
}

/** A Rest Day: rest everyone, or practice — upgrade one copy to its "+". Either clears the floor. */
export function restDay(run, choice) {
  if (run.status !== 'rest') fail('Not at a Rest Day');
  const done = applyRest(run, choice);
  return { ...done, status: 'map', at: run.restAt, restAt: null, cap: run.cap + CLIMB.capPerFloor };
}

/** Training Camp's free Rest Day, taken from the map without moving. */
export function takeFreeRest(run, choice) {
  if (run.status !== 'map' || !(run.freeRest > 0)) fail('No free Rest Day to use');
  return { ...applyRest(run, choice), freeRest: run.freeRest - 1 };
}

/** Bank the pot and end the run — between stops only. */
export function retire(run) {
  if (run.status !== 'map') fail('Retire between stops');
  return { ...run, status: 'retired' };
}

// ── What the screens show ────────────────────────────────────────────────────

/** The deck's size, how much of it leans to the playbook, and whether the roster fits the playbook. */
export function deckLine(run) {
  const entries = Object.entries(run.deck ?? {});
  return {
    size: entries.reduce((t, [, n]) => t + n, 0),
    playbook: run.playbook,
    leaning: entries.filter(([id]) => leanOf(baseId(id)) === run.playbook).reduce((t, [, n]) => t + n, 0),
    fits: fitsOf(rosterCards(run).cards) === run.playbook,
  };
}

/** The pot as it stands. The server prices the real one. */
export function potPreview(run) {
  return potOf(run.map, run.cleared, run.rung);
}

/** A finished run game as recordResult takes it: you are Team A (presetFor); a tie is not a win. */
export function resultFromGame(game, stopId) {
  const margin = (game?.teamA?.score ?? 0) - (game?.teamB?.score ?? 0);
  return {
    stopId,
    won: margin > 0,
    margin,
    endMinutes: Object.fromEntries((game?.teamA?.stats ?? []).map(s => [s.id, s.minutes ?? 0])),
  };
}
