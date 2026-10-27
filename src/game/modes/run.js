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
import { generateMap, stopById, nextStops, nextFloorStops, potOfRun, climbRng, MAP_VERSION, ACTS, FLOORS, bossIdOf } from './climbMap.js';
import { PLAYBOOKS, PLAYBOOK_OF_ARCHETYPE, kitDeck, leanOf, coachDeck } from './climbKits.js';
import { PERKS, perkOffer, perkProblem, boostsOf, boostedCard, hasPerk, GAME_PERKS, TRAVEL_DAYS, WIN_NOW_CAP } from './climbPerks.js';
import { styleAt, styledCard, engineFx } from './climbStyles.js';
import { EVENTS, EVENT_IDS, MAKEUP, eventText } from './climbEvents.js';
import AGES from '../../../card-data/generated/dynasty-ages.json' with { type: 'json' };
import { CARDS } from '../cards.js';
import { buildAiRoster, buildClassicRoster, classicFranchises, franchisePool } from './aiTeams.js';
import { STRATS, STRAT_MAP, PLUS, baseId, isPlus, plusId, buffNumber } from '../strats.js';
import { ALL_CARDS, DORMANT_KEYS, cardKey, getCardByKey } from '../cardSets.js';
import { isFeatCard } from '../recordBreakers.js';
import { capOf } from '../coinRewards.js';
import { nearestArchetype } from '../deckFit.js';
import { capSal, samePlayer } from '../teamRules.js';
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
 * legendaries), on a cheaper roster. Re-tuned the same day for the sixteen-card
 * kits (a crunch card in each made close games swingier, which costs the
 * favourite): Act I $1,200-1,350 and $100 off floors 4-6. 300 runs at Prince:
 * floors 1-3 won 95/93/93% (were 83/71/72), 14% of runs over by floor 3 (were
 * 46%), floors 4-6 80-85%, 55% reach the boss (31%), which still holds at
 * ~15%: 8% win the act (6%).
 */
export const FLOOR_CAPS = [1200, 1250, 1350, 2000, 2100, 2350, 2700];
/**
 * ACTS II AND III (2026-10-20, docs/plans/2026-10-20-the-climb-three-acts.md):
 * harder by act — Game caps picking up where the last act's boss stood,
 * bigger rosters, coaches with their doubles and rares, a bigger classic boss.
 * Act I's own dials (FLOOR_CAPS, CLIMB.bossCap, ...) are unchanged, and the
 * sim's overrides still reach them. Set by runClimbSim's three-act runs.
 */
//
// SET AGAINST WHAT YOU CAN FIELD (the user, 2026-10-21: "As long as this
// scaling is in line with the user's ability to scale (not necessarily what
// they choose, but what they CAN choose)"). An act's opponents are SHARES of
// maxCapAt — the starting cap and a floor's raise for every stop before this
// one, boons aside — so a change to the cap's growth moves them with it.
// Act I's Games run about half of it and its boss 90%; Act II's Games about
// two-thirds and its boss a little over; Act III's seven-eighths and 112%.
export const ACT_DIALS = {
  2: {
    gameShare: [0.67, 0.67, 0.67, 0.69, 0.70, 0.71, 0.71], rivalryExtra: 400,
    oppSize: [6, 7, 7, 8, 8, 8], bossShare: 1.07, bossSize: 9,
    coachExtra: [4, 5, 6, 7, 8, 9], coachSingles: false, coachRares: true,
    bossExtra: 6, bossRares: true, rare: [0.45, 0.65],
  },
  3: {
    // ACT III IS PLAYED AGAINST LEGENDS (2026-10-21): a franchise's current
    // cards top out near $7,000 at nine deep, under a run's payroll by then,
    // so its Games are classic teams too (classicGames), as its boss is.
    gameShare: [0.85, 0.85, 0.85, 0.87, 0.88, 0.88, 0.88], rivalryExtra: 500, classicGames: true,
    oppSize: [8, 8, 9, 9, 9, 10], bossShare: 1.12, bossSize: 11,
    coachExtra: [8, 9, 10, 11, 12, 12], coachSingles: false, coachRares: true,
    bossExtra: 9, bossRares: true, rare: [0.65, 0.85],
  },
};
/** The last floor whose coach plays only its kit. */
export const KIT_ONLY_FLOORS = 3;
export const CLIMB = {
  startCap: 2200,
  // THE RUN GROWS FASTER (2026-10-19; the user: "the key here is to
  // find/allow some more variance and also the ability to really scale a deck.
  // Each move up the ladder should feel like a big step", and "I *like* the
  // difficulty, it just might be slightly too hard"). Measured with the coach
  // at its rung (300 runs each): Prince wins the act 23% (was 8.7%), Deity
  // 8.7% (was 2.3%); the median team at the boss $4,820 (was $3,990).
  capPerFloor: 450,
  floorCap: f => FLOOR_CAPS[Math.min(FLOOR_CAPS.length, Math.max(1, f)) - 1],
  rivalryExtra: 250,
  bossCap: 4800,
  oppSize: [5, 5, 6, 6, 7, 7],
  bossSize: 8,
  // THE COACH'S DECK (2026-10-20): its kit, plus coachDeckExtra(floor) cards
  // from its archetype's fifty (floors 4-6: 3, 5, 6, as the old 19/21/22).
  // Act I coaches play ONE COPY of each card (coachSingles), and the boss adds
  // only bossDeckExtra cards and no rare (it was 25 cards, rares and two Bully
  // Balls). The user: "They already have a higher salary cap and better
  // players, their strategy decks shouldn't be so good right away either."
  coachSingles: true,
  coachDeckExtra: f => (f <= KIT_ONLY_FLOORS ? 0 : Math.round((f - 1) * 10 / 7) - 1),
  bossDeckExtra: 3,
  bossDeckRares: false,
  // HOME COURT (2026-10-20). The user: "you're ALWAYS the away team, so the
  // other team has the matchup advantage of going 2nd." The home side answers
  // in the placement snake; a Game is at home, a Rivalry and the boss on the
  // road.
  homeKinds: ['game'],
  recovery: { base: 10, by10: 12, by20: 14 },
  rareChance: f => 0.1 + 0.35 * (f - 1) / 6,   // 10% at floor 1 to 45% at floor 7 (was 5% to 25%)
  // A player offer's three prices, as shares of the room left (2026-10-19),
  // and how many of each band's priciest it draws from.
  offerBands: [[0, 0.35], [0.35, 0.7], [0.7, 1]],
  offerBest: 12,
  rivalryPicks: 1,
  climbOnlyChance: 0.5,   // the reward's "anywhere" slot, while a Climb-only card is left (2026-10-19; was 0.35)
  // THE DROPS (the user, 2026-10-19: "percent chances of games dropping
  // certain thing. Like all games drop strategy cards, rivalries *could* drop
  // a perk"). Strategy cards come with every win; a player offer and a perk
  // are chances by the stop's kind, smoothed the way Slay the Spire's potions
  // are: a miss raises the next chance by the step, a drop lowers it.
  drops: { game: { player: 0.5, perk: 0.1 }, rivalry: { player: 0.75, perk: 0.7 } },   // was 0.4/0.05 and 0.75/0.5
  dropStep: { player: 0.1, perk: 0.05 },
  // A RIVALRY ALWAYS OFFERS A PLAYER (2026-10-20, the user, of a Rivalry won
  // with no player: "no card reward for a rivalry game is insane ... It's
  // impossible to win without it"). The riskier stop pays the run's real
  // currency every time; the smoothing still runs for Games.
  surePlayer: ['rivalry'],
  maxRoster: 10,
  // IN SYSTEM (2026-10-20, systemFit.js): the run's playbook pays the players who fit it.
  system: true,
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

/**
 * The run's players, through the aliases; a key that no longer resolves is
 * dropped, and under five blocks play. A salary an event moved (Veteran
 * Minimum's half, Contract Year's raise, 2026-10-25) is on the copy, so every
 * cap reader sees it.
 */
export function rosterCards(run) {
  const cards = [];
  const dropped = [];
  for (const key of run.roster ?? []) {
    const c = getCardByKey(key);
    if (!c) { dropped.push(key); continue; }
    const half = run.discounts?.[key];
    const raise = run.salaryBumps?.[key] ?? 0;
    cards.push(half || raise ? { ...c, salary: Math.round((c.salary ?? 0) * (half || 1)) + raise } : c);
  }
  return { cards, dropped, blocked: cards.length < 5 ? 'roster' : null };
}

/** The two-way player an event signed (2026-10-25), or null: off the cap and the roster, for a few games. */
export const twoWayCard = run => (run?.twoWay?.key && run.twoWay.games > 0 ? getCardByKey(run.twoWay.key) : null);

const fitsOf = cards => PLAYBOOK_OF_ARCHETYPE[nearestArchetype(cards)?.id] ?? PLAYBOOKS[0];

/** A new run: five owned players under the starting cap, at a rung. Opens on Training Camp. */
/**
 * A CLIMB TEAM — what a run starts with, and what My Teams saves ahead (the
 * user, 2026-10-19: "we definitely need to be able to pre-make eligible
 * lineups"). Five players, or six (the user, 2026-10-25: "we do need in the
 * climb is the ability to start with a sixth player"): the same cap, so a
 * sixth is a bench bought with a cheaper five. `size` is the fewest, `max`
 * the most.
 */
export const CLIMB_FIVE = { cap: CLIMB.startCap, size: 5, max: 6 };

/**
 * Why these keys cannot start a climb, or null when they can: five players,
 * every card still in the game and (given `ownedKeys`) still yours, one card a
 * player, at most the starting cap. One rule for the editor, the start screen
 * and newRun.
 */
export function fiveProblem(rosterKeys, ownedKeys = null) {
  const keys = rosterKeys ?? [];
  if (keys.length < CLIMB_FIVE.size || keys.length > CLIMB_FIVE.max) return 'A climb starts with five or six players';
  const cards = keys.map(k => getCardByKey(k));
  const gone = keys.find((k, i) => !cards[i]);
  if (gone) return `${gone.split(':').pop().replace(/_/g, ' ')} no longer exists`;
  if (ownedKeys) {
    const lost = cards.find(c => !ownedKeys.has(cardKey(c)));
    if (lost) return `You no longer own ${lost.name}`;
  }
  if (cards.some((c, i) => cards.some((d, j) => j > i && samePlayer(c, d)))) return 'One card a player';
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
    act: 1,
    offerRules: OFFER_RULES,
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
    // Two-a-Days' practices waiting on the map, and Signature Set's growth (2026-10-20).
    freePractice: 0,
    signature: 0,
    perks: [],
    dropOdds: { player: 0, perk: 0 },
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

/**
 * Where the run can go next: the stops linked to where it stands, and while
 * Travel Day has uses left (2026-10-22) every other stop on the next floor.
 */
export function openStops(run) {
  if (run.status !== 'map') return [];
  const linked = nextStops(run.map, run.at);
  if (!(run.travel > 0)) return linked;
  const ids = new Set(linked.map(s => s.id));
  return [...linked, ...nextFloorStops(run.map, run.at).filter(s => !ids.has(s.id))];
}

/** Is going to `stopId` a Travel Day: open, but not linked to where the run stands? */
export function isTravel(run, stopId) {
  return !nextStops(run.map, run.at).some(s => s.id === stopId) && openStops(run).some(s => s.id === stopId);
}

/** The kind a stop shows on the map: a Makeup Game is a ❓ until it is played (climbMap.js MAKEUP_CHANCE). */
export const shownKind = stop => (stop?.makeup ? 'event' : stop?.kind);

// ── Opponents ────────────────────────────────────────────────────────────────

/** The act a run is in (a run drawn before acts is in Act I). */
export const actOfRun = run => run?.act ?? 1;

/**
 * The most a run can field at a floor of an act (the boss is floor 8): the
 * starting cap and CLIMB.capPerFloor for every stop before it — seven floors
 * and the move to the next act make eight an act. Boons aside: a +$400 boon
 * is the player's edge, not the opponents'.
 */
export function maxCapAt(act, floor) {
  return CLIMB.startCap + CLIMB.capPerFloor * (8 * (act - 1) + (floor - 1));
}
const to50 = n => Math.round(n / 50) * 50;

// One reader per dial, by act: Act I's are CLIMB's own (the sim tunes them).
const bossCapOf = act => (act > 1 ? to50(ACT_DIALS[act].bossShare * maxCapAt(act, FLOORS + 1)) : CLIMB.bossCap);
const bossSizeOf = act => (act > 1 ? ACT_DIALS[act].bossSize : CLIMB.bossSize);
const oppSizeOf = (act, floor) => (act > 1 ? ACT_DIALS[act].oppSize : CLIMB.oppSize)[floor - 1] ?? bossSizeOf(act);
const coachDeckOf = (act, floor) => (act > 1
  ? { extra: ACT_DIALS[act].coachExtra[floor - 1] ?? 0, singles: ACT_DIALS[act].coachSingles, rares: ACT_DIALS[act].coachRares }
  : { extra: CLIMB.coachDeckExtra(floor), singles: CLIMB.coachSingles });
const bossDeckOf = act => (act > 1
  ? { extra: ACT_DIALS[act].bossExtra, singles: false, rares: ACT_DIALS[act].bossRares }
  : { extra: CLIMB.bossDeckExtra, singles: CLIMB.coachSingles, rares: CLIMB.bossDeckRares });
/** The rare chance of a reward slot on a floor of an act. */
export function rareChanceOf(floor, act = 1) {
  if (act <= 1) return CLIMB.rareChance(floor);
  const [lo, hi] = ACT_DIALS[act].rare;
  return lo + (hi - lo) * (Math.min(FLOORS, Math.max(1, floor)) - 1) / (FLOORS - 1);
}

/** The coach's cap at a stop (the rung's multiple on), or null for a Rest Day — the game and the map read it. */
export function stopCap(run, stop) {
  // No game at a Rest Day or a ? stop, so no coach's cap.
  if (!stop || stop.kind === 'rest' || stop.kind === 'event') return null;
  const act = actOfRun(run);
  const mult = capOf(run.rung);
  if (stop.kind === 'boss') return Math.round(bossCapOf(act) * mult);
  const base = act > 1 ? to50(ACT_DIALS[act].gameShare[stop.floor - 1] * maxCapAt(act, stop.floor)) : CLIMB.floorCap(stop.floor);
  const rivalry = stop.kind === 'rivalry' ? (act > 1 ? ACT_DIALS[act].rivalryExtra : CLIMB.rivalryExtra) : 0;
  return Math.round((base + rivalry) * mult);
}

/**
 * The boss's franchise: one that can field a classic team at the boss's cap.
 * Act I's is drawn as it always was; a later act's never repeats an earlier one.
 */
function bossFranchise(run, act = actOfRun(run)) {
  const list = classicFranchises({ cap: Math.round(bossCapOf(act) * capOf(run.rung)), size: bossSizeOf(act) });
  if (act <= 1) return pickFrom(climbRng(run.seed, 'boss'), list);
  const earlier = Array.from({ length: act - 1 }, (_, i) => bossFranchise(run, i + 1));
  const fresh = list.filter(abbr => !earlier.includes(abbr));
  return pickFrom(climbRng(run.seed, 'boss', act), fresh.length ? fresh : list);
}

/** Who waits at the top of the map, known from the start as in StS: the boss's franchise and its logo. */
export function bossTeam(run) {
  const abbr = bossFranchise(run);
  const team = TEAMS[abbr] ?? {};
  return { abbr, name: team.name ?? abbr, city: team.city ?? '', logo: team.logo ?? null };
}

/**
 * THE SCOUTING REPORT (2026-10-19; the user: skill is "roster building and deck
 * scaling", so the boss you are building to beat is shown from floor 1, as Slay
 * the Spire shows its act boss). The boss game's own setup — the same seeded
 * roster and deck it will deal — with its players by salary and its playbook.
 */
export function bossScout(run) {
  const setup = gameSetup(run, bossIdOf(actOfRun(run)));
  const players = setup.rosterB.map(k => getCardByKey(k)).filter(Boolean).sort((a, b) => (b.salary ?? 0) - (a.salary ?? 0));
  const near = nearestArchetype(players);
  const playbook = PLAYBOOK_OF_ARCHETYPE[near?.id] ?? null;
  const rares = Object.keys(setup.deckB).filter(id => ['rare', 'legendary'].includes(STRAT_MAP[baseId(id)]?.rarity));
  return { opponent: setup.opponent, cap: setup.cap, players, playbook, rares, deckSize: Object.values(setup.deckB).reduce((t, n) => t + n, 0) };
}

/** The franchises the run's fights meet, in order, never the boss's and never twice. */
function franchiseOrder(run) {
  const boss = bossFranchise(run);
  const list = franchisePool().map(f => f.abbr).filter(a => a !== boss).sort();
  return shuffled(list, climbRng(run.seed, 'franchises'));
}

/**
 * WHO PLAYS AT A STOP (2026-10-25): each stop its own franchise, by its place
 * on the act's map, so the coach's style can be read off the map and a route
 * is a choice of opponent (climbStyles.js). It used to be the next franchise
 * in the run's order, the same for every open stop.
 */
function stopFranchise(run, stop) {
  const order = franchiseOrder(run);
  const at = 21 * (actOfRun(run) - 1) + 3 * ((stop.floor ?? 1) - 1) + (stop.lane ?? 0);
  return order[at % order.length];
}

/** Who a stop's game is against, as the map shows it: { abbr, name, city, style }, or null for a Rest Day. */
export function stopOpponent(run, stop, { full = false } = {}) {
  if (!stop || stop.kind === 'rest' || stop.kind === 'event') return null;
  const act = actOfRun(run);
  const abbr = stop.kind === 'boss' ? bossFranchise(run, act) : stopFranchise(run, stop);
  const team = TEAMS[abbr] ?? {};
  return { abbr, name: team.name ?? abbr, city: team.city ?? '', style: styleAt(abbr, { act, kind: stop.kind, full }) };
}

/** May the boss of this act be taken at Full Strength? Acts I and II, whose reward it grows. */
export const fullStrengthOffered = (run, stop) => stop?.kind === 'boss' && actOfRun(run) < ACTS;

/**
 * The fight at a stop: the coach's team and deck, and the key its game is
 * saved and claimed under. `full`: a boss taken at Full Strength (its style's
 * strength doubled, fullStrengthOffered).
 */
export function gameSetup(run, stopId, { full = false } = {}) {
  const stop = stopById(run.map, stopId);
  if (!stop || stop.kind === 'rest') fail('No game there');
  const boss = stop.kind === 'boss';
  const act = actOfRun(run);
  const rng = climbRng(run.seed, 'roster', stopId);
  const cap = stopCap(run, stop);
  let abbr;
  let roster;
  let classic = boss;
  if (boss) {
    abbr = bossFranchise(run, act);
    roster = buildClassicRoster(abbr, { cap, size: bossSizeOf(act), rng });
  } else {
    abbr = stopFranchise(run, stop);
    const size = oppSizeOf(act, stop.floor);
    // A classic team where the act asks for one and the franchise can field it.
    classic = Boolean(act > 1 && ACT_DIALS[act].classicGames && classicFranchises({ cap, size }).includes(abbr));
    roster = classic ? buildClassicRoster(abbr, { cap, size, rng }) : buildAiRoster(abbr, { size, cap, rng });
  }
  const team = TEAMS[abbr] ?? {};
  return {
    key: `climb:${run.id}:${stopId}`,
    stopId, kind: stop.kind, floor: stop.floor,
    rosterB: roster.map(cardKey),
    deckB: coachDeck(roster, boss ? bossDeckOf(act) : coachDeckOf(act, stop.floor), climbRng(run.seed, 'deck', stopId)),
    home: CLIMB.homeKinds.includes(stop.kind),
    aiLevel: run.rung,
    cap,
    opponent: { abbr, name: team.name ?? abbr, city: team.city ?? '', classic },
    act,
    // The coach's style (climbStyles.js), and a boss taken at Full Strength.
    style: styleAt(abbr, { act, kind: stop.kind, full: boss && full }),
    ...(boss && full ? { fullStrength: true } : {}),
    ...(stop.makeup ? { makeup: true } : {}),
  };
}

/**
 * Go to a stop: a Rest Day, or a fight set up once and stored, so a resumed
 * game is the same game. `fullStrength`: take this act's boss at Full
 * Strength (Acts I and II).
 */
export function chooseStop(run, stopId, { fullStrength = false } = {}) {
  if (rosterCards(run).blocked) fail('Fewer than five of your players are left; retire to bank the pot');
  if (!openStops(run).some(s => s.id === stopId)) fail('That stop is not open');
  const stop = stopById(run.map, stopId);
  // A stop that is not linked spends a Travel Day (the server counts its own).
  const moved = isTravel(run, stopId) ? { ...run, travel: run.travel - 1 } : run;
  if (stop.kind === 'rest') return { ...moved, status: 'rest', restAt: stopId };
  if (stop.kind === 'event') return { ...moved, status: 'event', event: drawEvent(moved, stopId) };
  // A Makeup Game shows its scene, and Play it opens the game (chooseEvent).
  if (stop.makeup) return { ...moved, status: 'event', event: { id: MAKEUP, stopId, target: null } };
  return { ...moved, status: 'game', game: gameSetup(run, stopId, { full: fullStrength && fullStrengthOffered(run, stop) }) };
}

/** What the Play tab deals for the run's game. */
/**
 * THE RUN AS THE BOARD SEES IT (the user, 2026-10-20: "You need to be able to
 * look at your current map, deck, and player cards at all times in The Climb,
 * no matter the screen"). A game's preset carries the run without its map —
 * Firestore refuses the map's array of arrays, and the seed rebuilds it — so
 * the Climb bar shows on the Play board too, and survives a reload inside the
 * game's own save.
 */
export function runView(run) {
  const { map, ...rest } = run;
  return JSON.parse(JSON.stringify(rest));
}

/** A run back from runView, its map rebuilt from the seed (unstamped = version 1, as the server reads it). */
export function runFromView(view) {
  return view ? { ...view, map: generateMap(view.seed, view.mapVersion ?? 1, view.act ?? 1) } : null;
}

/** The run's game-long perks, for the engine (climbPerks.js `game`). */
export const gamePerksOf = run => GAME_PERKS.filter(id => hasPerk(run, id));
/** Will a loss now be replayed (Second Chance, once a run)? */
export const canReplay = run => hasPerk(run, 'second_chance') && !run.secondChanceUsed;

export function presetFor(run) {
  const g = run.game;
  if (run.status !== 'game' || !g) fail('No game to play');
  const perks = gamePerksOf(run);
  // What a win here adds to the pot, the run's perks on (the results screen's preview).
  const potAdd = potOfRun({ ...run, cleared: [...run.cleared, g.stopId] }).coins - potOfRun(run).coins;
  // WHAT AN EVENT SET FOR THIS GAME (2026-10-25, run.nextGame): a player
  // sitting it, a Power boost, hot markers; and a two-way player on top.
  const next = run.nextGame ?? {};
  const boosts = boostsOf(run);
  let mine = rosterCards(run).cards.map(c => boostedCard(c, boosts[c.id]));
  // Who sits (an event's next game, a Holdout's games): never fewer than
  // five left, the first named sitting first.
  const sit = [...new Set([...(next.sit ?? []), ...Object.keys(run.sitOut ?? {})])]
    .filter(id => mine.some(c => c.id === id))
    .slice(0, Math.max(0, mine.length - 5));
  if (sit.length) mine = mine.filter(c => !sit.includes(c.id));
  const twoWay = twoWayCard(run);
  if (twoWay && !mine.some(c => c.id === twoWay.id)) mine = [...mine, twoWay];
  if (next.power) mine = mine.map(c => ({ ...c, power: (c.power ?? 0) + next.power }));
  if (next.speed) mine = mine.map(c => ({ ...c, speed: (c.speed ?? 0) + next.speed }));
  const hot = { ...(run.carryHot ?? {}), ...(next.hot ?? {}) };
  return {
    key: g.key,
    // A perk's boosts ride on copies of the cards (climbPerks.js, 2026-10-19).
    rosterA: mine,
    // The coach's cards with its style's stat moves on them (styledCard).
    rosterB: g.rosterB.map(k => getCardByKey(k)).filter(Boolean).map(c => styledCard(c, g.style?.fx)),
    deckA: { ...run.deck },
    deckB: { ...g.deckB },
    aiLevel: run.rung,
    returnTab: 'climb',
    // At home the coach places first and you answer (CLIMB.homeKinds).
    humanIsHome: Boolean(g.home),
    gameOpts: {
      startQuarter: 4, fatigue: { A: { ...run.fatigue } },
      placementFirst: g.home ? 'B' : 'A',
      ...(Object.keys(hot).length ? { hot: { A: hot } } : {}),
      ...(next.cold ? { cold: { A: { ...next.cold } } } : {}),
      ...(run.conditioned ? { buffs: { A: { conditioning_carry: true } } } : {}),
      ...(run.signature ? { signatureBonus: { A: Math.min(SIGNATURE_MAX, 2 + run.signature) } } : {}),
      ...(CLIMB.system && run.playbook ? { system: { A: run.playbook } } : {}),
      ...(perks.length ? { perks: { A: perks } } : {}),
      ...(engineFx(g.style?.fx) ? { style: { B: engineFx(g.style.fx) } } : {}),
    },
    climb: { runId: run.id, stopId: g.stopId, kind: g.kind, floor: g.floor, rung: run.rung, act: actOfRun(run), mapVersion: run.mapVersion ?? 1, potAdd, secondChance: canReplay(run) },
    climbView: runView(run),
  };
}

// ── Rewards ──────────────────────────────────────────────────────────────────

/**
 * Three strategy cards: two that lean to the playbook, one from anywhere.
 * Each is rare with the floor's chance; a Rivalry's third always is. Never a
 * card the deck holds at its limit, never one twice.
 */
// ADVANCE SCOUT (a perk, 2026-10-22): a fourth card, from anywhere, drawn
// after the three so their draw is the same as without it.
export function stratOffer(run, stop, rng, rngClimb = null) {
  const chosen = [];
  const lanes = [run.playbook, run.playbook, null, ...(hasPerk(run, 'advance_scout') ? [null] : [])];
  lanes.forEach((lean, slot) => {
    // THE CLIMB'S OWN CARDS (2026-10-19, strats.js `climbOnly`): the slot from
    // anywhere offers one CLIMB.climbOnlyChance of the time while one is left
    // to take. Its own seeded stream, so the other offers do not shift.
    if (!lean && rngClimb) {
      // Your playbook's own, or one for any playbook: a character's cards (2026-10-19).
      const own = OFFERABLE.filter(s => s.climbOnly && (leanOf(s.id) == null || leanOf(s.id) === run.playbook) && !chosen.includes(s.id) && !atLimit(run.deck, s.id));
      if (own.length && rngClimb() < CLIMB.climbOnlyChance) { chosen.push(pickFrom(rngClimb, own).id); return; }
    }
    const rare = (stop.kind === 'rivalry' && slot === 2) || rng() < rareChanceOf(stop.floor, actOfRun(run));
    const pool = OFFERABLE.filter(s => !s.climbOnly && (!lean || leanOf(s.id) === lean) && !chosen.includes(s.id) && !atLimit(run.deck, s.id));
    const want = pool.filter(s => (s.rarity === 'rare') === rare);
    const from = want.length ? want : pool;
    if (from.length) chosen.push(pickFrom(rng, from).id);
  });
  return chosen;
}

/**
 * THREE PLAYERS AT THREE PRICES (the user, 2026-10-19: "there should be
 * different ranges of player offers so that you're not immediately up against
 * the cap every time you take a player"): one from each band of the room left
 * (CLIMB.offerBands: up to 35%, 35-70%, 70-100%), cheapest first, each drawn
 * from the best of its band (the priciest, one card a player). An empty band
 * borrows from the rest. None when the roster is full.
 */
function playerOffer(run, rng) {
  const { cards } = rosterCards(run);
  const room = run.cap - capSal(cards);
  // Never a player already on the roster, in any season's card (samePlayer).
  const open = PLAYER_POOL.filter(c => !cards.some(r => samePlayer(r, c)));
  // A FULL ROSTER STILL GETS AN OFFER (2026-10-21; the user, of an Act II
  // Rivalry with no player: "Rivalry games should always give card rewards").
  // At ten players — 23 of 28 Act II Rivalry wins in the sim — or with no one
  // under the room, the offer is priced against the room a release would make
  // (your priciest player's salary on top), and signing one releases a player
  // of yours (pickPlayer).
  const swap = cards.length >= CLIMB.maxRoster || !open.some(c => (c.salary ?? 0) <= room);
  const budget = swap ? room + Math.max(0, ...cards.map(c => c.salary ?? 0)) : room;
  if (!(budget > 0)) return [];
  const fits = open
    .filter(c => (c.salary ?? 0) <= budget)
    .sort((a, b) => (b.salary ?? 0) - (a.salary ?? 0) || cardKey(a).localeCompare(cardKey(b)));
  // Three different players, each once in a band's draw.
  const taken = [];
  const bestOf = list => {
    const out = [];
    for (const c of list) {
      if (taken.some(t => samePlayer(t, c)) || out.some(o => samePlayer(o, c))) continue;
      out.push(c);
      if (out.length >= CLIMB.offerBest) break;
    }
    return out;
  };
  const out = [];
  for (const [lo, hi] of CLIMB.offerBands) {
    let pool = bestOf(fits.filter(c => { const f = (c.salary ?? 0) / budget; return f > lo && f <= hi; }));
    if (!pool.length) pool = bestOf(fits);
    if (!pool.length) break;
    const c = pool[Math.floor(rng() * pool.length)];
    taken.push(c);
    out.push(cardKey(c));
  }
  return out;
}

/**
 * The game's result. A loss — a tie after the last overtime too — ends the
 * run. A win clears the stop and the floor: the cap rises, every tracker
 * comes down by the recovery, and the offers are dealt.
 */
/** Signature Set's ceiling: +2 grown to +6 (2026-10-20). */
export const SIGNATURE_MAX = 6;

export function recordResult(run, { stopId, won, margin = 0, endMinutes = {}, carryHot = null, iceBath = null, conditioned = false, leaves = [], twoADays = 0, signatureStep = 0 }) {
  if (run.status !== 'game' || run.game?.stopId !== stopId) return run;
  if (!won) {
    // SECOND CHANCE (a boss's perk, 2026-10-22): the game is played again,
    // once a run, under a key of its own (the server took the first one's
    // claim); the run stands as it did before it, the pot with it.
    if (canReplay(run)) return { ...run, secondChanceUsed: true, game: { ...run.game, key: `${run.game.key}:2`, replay: true } };
    return { ...run, status: 'lost', lostAt: stopId, game: null };
  }
  // The game an event set up is played (run.nextGame), and a two-way deal
  // has one game fewer to run.
  const surePerk = Boolean(run.nextGame?.surePerk);
  const twoWay = run.twoWay?.games > 1 ? { ...run.twoWay, games: run.twoWay.games - 1 } : null;
  const sitOut = Object.fromEntries(Object.entries(run.sitOut ?? {}).map(([id, n]) => [id, n - 1]).filter(([, n]) => n > 0));
  run = { ...run, nextGame: null, twoWay, sitOut };
  const stop = stopById(run.map, stopId);
  const cleared = [...run.cleared, stopId];
  // A boss beaten at Full Strength grows the act's reward (continueClimb).
  if (stop.kind === 'boss') {
    const full = run.game?.fullStrength ? { fullStrengthWon: { ...(run.fullStrengthWon ?? {}), [actOfRun(run)]: true } } : {};
    return { ...run, ...full, status: 'won', at: stopId, cleared, game: null };
  }
  // Training Staff (a perk, 2026-10-22): two minutes more off every tracker.
  const rec = recoveryFor(margin) + (hasPerk(run, 'training_staff') ? 2 : 0);
  const fatigue = {};
  for (const c of [...rosterCards(run).cards, ...(twoWayCard(run) ? [twoWayCard(run)] : [])]) {
    const left = Math.max(0, (endMinutes[c.id] ?? 0) - rec);
    if (left > 0) fatigue[c.id] = left;
  }
  const gameWins = run.gameWins + (stop.kind === 'game' ? 1 : 0);
  // Ice Bath clears the trackers and leaves the deck (Ice Bath+ stays);
  // Stay Hot's markers and Conditioning+ ride into the next game only
  // (2026-10-19, the "+" cards 2026-10-20).
  const iced = iceBath && (run.deck?.[iceBath] ?? 0) > 0;
  // The one-shots of wave two (Leave It All Out There, Two-a-Days) leave the
  // deck like Ice Bath; Two-a-Days' extra session lands after any Ice Bath, as
  // minutes on every tracker and a practice to take from the map.
  let deck = iced && !isPlus(iceBath) ? takeCard(run.deck, iceBath) : run.deck;
  for (const id of leaves ?? []) if ((deck?.[id] ?? 0) > 0) deck = takeCard(deck, id);
  const rested = iced ? {} : fatigue;
  const tired = twoADays > 0
    ? { ...rested, ...Object.fromEntries(rosterCards(run).cards.map(c => [c.id, (rested[c.id] ?? 0) + twoADays])) }
    : rested;
  const next = {
    ...run, at: stopId, cleared, cap: run.cap + CLIMB.capPerFloor, gameWins, game: null,
    fatigue: tired,
    deck,
    carryHot: carryHot && Object.keys(carryHot).length ? carryHot : null,
    conditioned: Boolean(conditioned),
    freePractice: (run.freePractice ?? 0) + (twoADays > 0 ? 1 : 0),
    signature: Math.min(SIGNATURE_MAX - 2, (run.signature ?? 0) + (signatureStep || 0)),
  };
  const rng = climbRng(run.seed, 'offers', stopId);
  // The player offer is always drawn, so the cards' draw after it is the same
  // as before the drops were chances; the drop roll has its own stream.
  const playerPool = playerOffer(next, rng);
  const perkPool = perkOffer(next, climbRng(run.seed, 'perks', stopId), rosterCards(next).cards.map(c => c.id));
  const drops = rollDrops(run, stop, stopId, playerPool, perkPool);
  const { players, dropOdds } = drops;
  // Back-to-Back's promise (an event, 2026-10-25): a win there pays a perk.
  const perks = surePerk && perkPool.length ? perkPool : drops.perks;
  // A Rivalry's win takes CLIMB.rivalryPicks cards (2026-10-19: riskier, richer Rivalries).
  const picks = (stop.kind === 'rivalry' ? CLIMB.rivalryPicks : 1) + (run.extraPicks > 0 ? 1 : 0);
  return {
    ...next,
    dropOdds,
    status: 'reward',
    extraPicks: Math.max(0, run.extraPicks - 1),
    offers: { stopId, strats: stratOffer(next, stop, rng, climbRng(run.seed, 'climb-only', stopId)), picks, players, perks },
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

/**
 * Did this win drop a player offer and a perk (CLIMB.drops)? A chance by the
 * stop's kind plus the run's smoothing (`dropOdds`): each miss raises the next
 * chance by CLIMB.dropStep, each drop lowers it, kept within -0.4..+0.6. An
 * offer with nothing in it (a full roster, no room) counts as a miss.
 */
export function rollDrops(run, stop, stopId, playerPool, perkPool) {
  const odds = { player: 0, perk: 0, ...(run.dropOdds ?? {}) };
  const base = CLIMB.drops[stop.kind] ?? { player: 0, perk: 0 };
  const roll = climbRng(run.seed, 'drops', stopId);
  const hit = what => roll() < Math.min(1, Math.max(0, base[what] + odds[what]));
  // The player die is still thrown on a sure stop, so the perk's die after it is the same.
  const playerDie = hit('player');
  // Scouting Network (a perk, 2026-10-22): every Game's player is sure too.
  const sure = CLIMB.surePlayer.includes(stop.kind) || (stop.kind === 'game' && hasPerk(run, 'scouting_network'));
  const gotPlayer = (sure || playerDie) && playerPool.length > 0;
  const gotPerk = hit('perk') && perkPool.length > 0;
  const nudge = (what, got) => Math.min(0.6, Math.max(-0.4, odds[what] + (got ? -1 : 1) * CLIMB.dropStep[what]));
  return {
    players: gotPlayer ? playerPool : [],
    perks: gotPerk ? perkPool : [],
    // A sure drop leaves the smoothing where it was: it is not luck to even out.
    dropOdds: { player: sure ? odds.player : nudge('player', gotPlayer), perk: nudge('perk', gotPerk) },
  };
}

/** Back to the map once nothing is left to take. */
const settle = run => (run.offers && (run.offers.picks > 0 && run.offers.strats.length) || run.offers?.players?.length || run.offers?.perks?.length
  ? run
  : { ...run, status: 'map', offers: null });

/**
 * Take a perk (climbPerks.js). `target` is a player's id for a player perk,
 * a card id in the deck for Film Study, which upgrades one copy at once, and
 * nothing for a team perk. `at` is how many stops were cleared when it was
 * taken: the pot's perks pay or cost from there (potOfRun). A perk the
 * server keeps too (`ledger`) is recorded there first (ClimbTab, climbPerk).
 */
export function pickPerk(run, id, target = null) {
  if (run.status !== 'reward' || !run.offers?.perks?.includes(id)) fail('That perk is not on offer');
  const def = PERKS[id];
  const problem = perkProblem(run, id, target, rosterCards(run).cards.map(c => c.id));
  if (problem) fail(problem);
  const deck = def.target === 'card' ? addCard(takeCard(run.deck, target), plusId(target)) : run.deck;
  // What a team perk does the moment it is taken.
  const now = {
    ...(id === 'win_now_trade' ? { cap: run.cap + WIN_NOW_CAP } : {}),
    ...(id === 'front_office' ? { freePractice: (run.freePractice ?? 0) + 2, freeCut: (run.freeCut ?? 0) + 2 } : {}),
    ...(id === 'travel_day' ? { travel: (run.travel ?? 0) + TRAVEL_DAYS } : {}),
  };
  const taken = { id, target: def.target === 'team' ? null : target, at: (run.cleared ?? []).length };
  return settle({ ...run, ...now, deck, perks: [...(run.perks ?? []), taken], offers: { ...run.offers, perks: [] } });
}

export function pickStrat(run, id) {
  if (run.status !== 'reward' || !run.offers?.strats.includes(id) || !(run.offers.picks > 0)) fail('That card is not on offer');
  const picks = run.offers.picks - 1;
  return settle({
    ...run,
    deck: addCard(run.deck, id),
    offers: { ...run.offers, picks, strats: picks > 0 ? run.offers.strats.filter(x => x !== id) : [] },
  });
}

/**
 * THE PLAYER A FULL ROSTER WAS OWED (2026-10-22). The user, after a win at ten
 * players with no player offered: "Can you make sure that option is there?
 * And can you make sure that if I reload my current climb, I'll get the
 * opportunity to add a player?" A reward is dealt once, when the win is
 * recorded, and saved with the run — so one dealt by a tab still running the
 * code from before sign-and-release (864bff98) kept its empty player row
 * through every reload. `offerRules` marks a run dealt under today's rule; a
 * run without it, at a full roster after a win, is made good once: its reward
 * gets the offer it missed, or the map a player to sign (`freeSign`).
 */
export const OFFER_RULES = 2;

export function owedPlayer(run) {
  if (!run || (run.offerRules ?? 1) >= OFFER_RULES) return run;
  const next = { ...run, offerRules: OFFER_RULES };
  const last = (run.cleared ?? []).at(-1);
  const full = rosterCards(run).cards.length >= CLIMB.maxRoster;
  if (!last || !full || ['camp', 'lost', 'retired'].includes(run.status) || run.banked) return next;
  if (run.status === 'reward' && run.offers && !(run.offers.players?.length)) {
    return { ...next, offers: { ...run.offers, players: playerOffer(next, climbRng(run.seed, 'owed', last)) } };
  }
  if (run.status === 'reward') return next;
  return { ...next, freeSign: (run.freeSign ?? 0) + 1 };
}

/** Sign the owed player, from the map: a player offer, as a reward is (settle returns to the map). */
export function openOwedSign(run) {
  if (run.status !== 'map' || !(run.freeSign > 0)) fail('No player is owed');
  const players = playerOffer(run, climbRng(run.seed, 'owed-sign', run.freeSign, (run.cleared ?? []).length));
  return settle({ ...run, status: 'reward', freeSign: run.freeSign - 1, offers: { stopId: 'owed', strats: [], picks: 0, players, perks: [] } });
}

/** Does signing this player need a release: a full roster, or over the cap? */
export function needsRelease(run, key) {
  // An event's two-way deal is off the roster, and a trade sends its own player back.
  if (run.offers?.twoWay || run.offers?.tradeFor) return false;
  const { cards } = rosterCards(run);
  return cards.length >= CLIMB.maxRoster || capSal([...cards, signedCard(run, key)].filter(Boolean)) > run.cap;
}

/** `key` as signing them puts them on the cap: a Veteran Minimum offer counts half (2026-10-25). */
const signedCard = (run, key) => rosterCards({ roster: [key], discounts: run.offers?.discount ? { [key]: run.offers.discount } : null }).cards[0] ?? null;

/** The players of yours (roster keys) whose release makes room to sign `key`, cheapest first. */
export function releaseOptions(run, key) {
  const card = signedCard(run, key);
  if (!card) return [];
  const keys = run.roster ?? [];
  const pay = k => rosterCards({ ...run, roster: [k] }).cards[0]?.salary ?? 0;
  return keys
    .filter(k => {
      const rest = rosterCards({ ...run, roster: keys.filter(x => x !== k) }).cards;
      return rest.length + 1 <= CLIMB.maxRoster && capSal([...rest, card]) <= run.cap;
    })
    .sort((a, b) => pay(a) - pay(b));
}

/**
 * Sign an offered player. When the roster is full or the cap is short
 * (needsRelease), `release` names the player of yours who makes room: they
 * leave the run, with their perks and their fatigue (2026-10-21).
 */
export function pickPlayer(run, key, release = null) {
  if (run.status !== 'reward' || !run.offers?.players.includes(key)) fail('That player is not on offer');
  // AN EVENT'S OFFER (2026-10-25): a two-way deal signs off the roster; a
  // trade sends the named player back; a veteran's half salary is noted.
  if (run.offers.twoWay) {
    return settle({ ...run, twoWay: { key, games: run.offers.twoWay }, offers: { ...run.offers, players: [] } });
  }
  if (run.offers.tradeFor) release = run.offers.tradeFor;
  if (run.offers.discount) run = { ...run, discounts: { ...(run.discounts ?? {}), [key]: run.offers.discount } };
  let roster = [...(run.roster ?? [])];
  let perks = run.perks ?? [];
  let fatigue = run.fatigue ?? {};
  if (release != null) {
    if (!run.offers.tradeFor && !releaseOptions(run, key).includes(release)) fail('Releasing that player does not make room');
    const gone = getCardByKey(release);
    roster = roster.filter(k => k !== release);
    // Their perks go with them; one the pot reads (Max Contract) stays on the
    // run without a player, as it stays on the server's ledger.
    perks = perks
      .filter(p => p.target !== gone?.id || PERKS[p.id]?.ledger)
      .map(p => (p.target === gone?.id ? { ...p, target: null } : p));
    fatigue = Object.fromEntries(Object.entries(fatigue).filter(([id]) => id !== gone?.id));
    // A half salary or a raise was this contract's; it leaves with the player.
    const { [release]: _d, ...discounts } = run.discounts ?? {};
    const { [release]: _b, ...salaryBumps } = run.salaryBumps ?? {};
    const { [gone?.id]: _s, ...sitOut } = run.sitOut ?? {};
    run = { ...run, discounts, salaryBumps, sitOut };
  } else if (needsRelease(run, key)) {
    fail(`Release a player of yours to sign ${getCardByKey(key)?.name ?? 'them'}`);
  }
  return settle({ ...run, roster: [...roster, key], perks, fatigue, offers: { ...run.offers, players: [] } });
}

/** Skip the strats, the players, or (no part) everything still on offer. */
export function skipOffers(run, part = null) {
  if (run.status !== 'reward') fail('Nothing is on offer');
  if (part === 'strats') return settle({ ...run, offers: { ...run.offers, strats: [], picks: 0 } });
  if (part === 'players') return settle({ ...run, offers: { ...run.offers, players: [] } });
  if (part === 'perks') return settle({ ...run, offers: { ...run.offers, perks: [] } });
  return { ...run, status: 'map', offers: null };
}

// ── Events (? stops) ─────────────────────────────────────────────────────────
//
// THE CLIMB'S ? STOPS (2026-10-25, climbEvents.js; the user: "Those work").
// A scene with two choices; like a Rest Day it is no game, clears the floor and
// raises the cap. Each scene comes once a run, drawn from the run's seed among
// the ones that can be played as the run stands. A Makeup Game (map version 3)
// is the exception: a Game behind the ?, whose one choice opens it.

const salaryOf = c => c?.salary ?? 0;
const byPay = cards => [...cards].sort((a, b) => salaryOf(a) - salaryOf(b) || a.id.localeCompare(b.id));
/** Players not on the run's roster (any season's card), from a pool. */
const offRoster = (run, pool) => {
  const { cards } = rosterCards(run);
  const tw = twoWayCard(run);
  return pool.filter(c => !cards.some(r => samePlayer(r, c)) && !(tw && samePlayer(tw, c)));
};
/** Three of the best `list` has, distinct players, seeded. */
function threeOf(list, rng) {
  const best = [];
  for (const c of [...list].sort((a, b) => salaryOf(b) - salaryOf(a) || cardKey(a).localeCompare(cardKey(b)))) {
    if (best.some(b => samePlayer(b, c))) continue;
    best.push(c);
    if (best.length >= CLIMB.offerBest) break;
  }
  const out = [];
  while (out.length < 3 && best.length) out.push(best.splice(Math.floor(rng() * best.length), 1)[0]);
  return out.map(cardKey);
}
/**
 * The trade's three: players better than {name} (paid more than their card,
 * not their cap hit: a veteran on the minimum is no $205 player), whom the cap
 * can take in their place.
 */
function tradeOffer(run, rng) {
  const { cards } = rosterCards(run);
  const low = byPay(cards)[0];
  if (!low) return [];
  const worth = salaryOf(getCardByKey(run.roster.find(k => getCardByKey(k)?.id === low.id)));
  const room = run.cap - capSal(cards) + salaryOf(low);
  return threeOf(offRoster(run, PLAYER_POOL).filter(c => salaryOf(c) > worth && salaryOf(c) <= room), rng);
}
const TWO_WAY_MAX = 250;
const VETERAN_AGE = 32;
const VETERAN_MAX = 600;
const veterans = run => offRoster(run, CARDS.filter(c => (AGES[c.id] ?? 0) >= VETERAN_AGE && salaryOf(c) <= VETERAN_MAX));

/** The player a scene is about: who it names, by its own rule. */
function eventTarget(run, id, rng) {
  const cards = byPay(rosterCards(run).cards);
  if (!cards.length) return null;
  if (id === 'trade_call') return cards[0].id;
  if (id === 'locker_room') return cards[cards.length - 1].id;
  if (id === 'injury_scare' || id === 'contract_year' || id === 'flu_bug') return cards[Math.floor(rng() * cards.length)].id;
  // A star holds out: one of the three highest-paid.
  if (id === 'holdout') { const top = cards.slice(-3); return top[Math.floor(rng() * top.length)].id; }
  return null;
}

/** Why a scene cannot come up for this run now, or null. */
function eventProblem(run, id) {
  const n = rosterCards(run).cards.length;
  if ((run.eventsSeen ?? []).includes(id)) return 'seen';
  if ((id === 'locker_room' || id === 'injury_scare' || id === 'holdout') && n < 6) return 'needs a sixth player to sit one';
  if (id === 'veteran_min' && (n >= CLIMB.maxRoster || !veterans(run).length)) return 'no room';
  if (id === 'two_way' && run.twoWay) return 'already a two-way player';
  return null;
}

/** The scene at a ? stop: { id, stopId, target }. */
export function drawEvent(run, stopId) {
  const rng = climbRng(run.seed, 'event', stopId);
  const can = EVENT_IDS.filter(id => !eventProblem(run, id));
  const pool = can.length ? can : EVENT_IDS.filter(id => id === 'film_room' || id === 'team_meeting');
  const id = pool[Math.floor(rng() * pool.length)];
  return { id, stopId, target: eventTarget(run, id, rng) };
}

/** The scene as the screen shows it: title, text, and each choice with why it cannot be taken. */
export function eventView(run) {
  const e = run.event;
  const def = EVENTS[e?.id];
  if (!def) return null;
  const name = rosterCards(run).cards.find(c => c.id === e.target)?.name ?? null;
  return {
    id: e.id, title: def.title, text: eventText(def.text, name),
    choices: Object.entries(def.choices).map(([choice, label]) => ({ id: choice, label: eventText(label, name), problem: choiceProblem(run, choice) })),
  };
}

/** The rares Summer-League Tape can deal: any the deck is not at its limit of. */
const tapeRares = run => OFFERABLE.filter(s => s.rarity === 'rare' && !s.climbOnly && !atLimit(run.deck, s.id));

/** The copies Budget Cuts can sell: every rare and every "+" in the deck, one entry a copy. */
const prizedCopies = run => Object.entries(run.deck ?? {})
  .filter(([id, n]) => n > 0 && !STRAT_MAP[baseId(id)]?.dead && (isPlus(id) || ['rare', 'legendary'].includes(STRAT_MAP[baseId(id)]?.rarity)))
  .flatMap(([id, n]) => Array(n).fill(id))
  .sort();

/** Why a choice of the run's scene cannot be taken, or null. */
function choiceProblem(run, choice) {
  const e = run.event;
  const deck = Object.values(run.deck ?? {}).reduce((t, n) => t + n, 0);
  const n = rosterCards(run).cards.length;
  if (((e.id === 'back_to_back' && choice === 'rest') || (e.id === 'flu_bug' && choice === 'quarantine')) && n < 6) return 'Needs a sixth player to sit one';
  if (e.id === 'holdout' && choice === 'pay' && capSal(rosterCards(run).cards) + 200 > run.cap) return 'The raise does not fit under the cap';
  if (e.id === 'budget_cuts' && choice === 'card') {
    if (!prizedCopies(run).length) return 'No rare or "+" card in your deck';
    if (deck - 1 < MIN_DECK) return `A deck keeps at least ${MIN_DECK} cards`;
  }
  if (e.id === 'trade_call' && choice === 'take' && !tradeOffer(run, climbRng(run.seed, 'event-offer', e.stopId)).length) return 'No one better fits under the cap';
  if (e.id === 'film_room' && choice === 'cut' && deck - 2 < MIN_DECK) return `A deck keeps at least ${MIN_DECK} cards`;
  if (e.id === 'summer_tape' && choice === 'take' && !tapeRares(run).length) return 'No rare card your deck can take';
  if (e.id === 'film_room' && choice === 'upgrade' && !Object.keys(run.deck ?? {}).some(id => !isPlus(id) && PLUS[id])) return 'No card to practise';
  if (e.id === 'contract_year' && choice === 'pay') {
    const { cards } = rosterCards(run);
    if (capSal(cards) + 150 > run.cap) return 'The raise does not fit under the cap';
  }
  return null;
}

/** Leave the ? stop: the floor cleared, the cap up a floor's worth, the scene seen. */
const leaveEvent = run => ({
  ...run, status: 'map', at: run.event.stopId, event: null, eventNote: null,
  eventsSeen: [...(run.eventsSeen ?? []), run.event.id], cap: run.cap + CLIMB.capPerFloor,
});
/** An offer an event makes, on the reward screen (`title` names it there). */
const eventOffer = (run, title, players, extra = {}) => settle({
  ...leaveEvent(run), status: 'reward',
  offers: { stopId: run.event.stopId, title, strats: [], picks: 0, players, perks: [], ...extra },
});

/** Take a choice of the scene at a ? stop (eventView names them). */
export function chooseEvent(run, choice) {
  if (run.status !== 'event' || !run.event) fail('No event here');
  const e = run.event;
  if (!EVENTS[e.id]?.choices?.[choice]) fail('No such choice');
  const problem = choiceProblem(run, choice);
  if (problem) fail(problem);
  const rng = climbRng(run.seed, 'event-offer', e.stopId);
  const { cards } = rosterCards(run);
  const target = cards.find(c => c.id === e.target);
  const targetKey = target ? run.roster.find(k => getCardByKey(k)?.id === target.id) : null;
  const allTired = add => Object.fromEntries(cards.map(c => [c.id, (run.fatigue?.[c.id] ?? 0) + add]));
  const next = run.nextGame ?? {};
  // A number on every player next game, on top of any an earlier scene set.
  const shift = (power, speed) => ({ ...next, power: (next.power ?? 0) + power, speed: (next.speed ?? 0) + speed });
  const top = byPay(cards).at(-1);
  // How a coin flip or a draw came out, for the screen to say (ClimbTab).
  const noted = (r, eventNote) => ({ ...r, eventNote });
  switch (`${e.id}:${choice}`) {
    case 'makeup_game:play':
      return { ...run, status: 'game', event: null, game: gameSetup(run, e.stopId) };
    case 'trade_call:take':
      return eventOffer(run, `Trade ${target?.name ?? 'your lowest-paid player'} for one of three`, tradeOffer(run, rng), { tradeFor: targetKey });
    case 'locker_room:sit':
      return leaveEvent({ ...run, nextGame: { ...next, sit: [...(next.sit ?? []), e.target] } });
    case 'locker_room:grind':
    case 'back_to_back:play':
      return leaveEvent({ ...run, fatigue: allTired(4), ...(e.id === 'back_to_back' ? { nextGame: { ...(run.nextGame ?? {}), surePerk: true } } : {}) });
    case 'film_room:upgrade':
    case 'team_meeting:upgrade':
      return leaveEvent({ ...run, freePractice: (run.freePractice ?? 0) + 1 });
    case 'film_room:cut':
      return leaveEvent({ ...run, freeCut: (run.freeCut ?? 0) + 2 });
    case 'two_way:sign':
      return eventOffer(run, 'A two-way contract: free, for three games', threeOf(offRoster(run, PLAYER_POOL).filter(c => salaryOf(c) <= TWO_WAY_MAX), rng), { twoWay: 3 });
    case 'summer_tape:take': {
      const deck = addCard(addCard(run.deck, pickFrom(rng, tapeRares(run)).id), 'bad_contract');
      return leaveEvent({ ...run, deck });
    }
    case 'injury_scare:gamble': {
      const out = rng() < 0.5;
      return noted(leaveEvent({ ...run, nextGame: { ...next, ...(out ? { sit: [...(next.sit ?? []), e.target] } : { hot: { ...(next.hot ?? {}), [e.target]: 2 } }) } }),
        out ? `Bad news: ${target?.name} misses the next game.` : `Good news: ${target?.name} starts the next game with 2 hot markers.`);
    }
    case 'injury_scare:rest': {
      const fatigue = { ...(run.fatigue ?? {}) };
      delete fatigue[e.target];
      return leaveEvent({ ...run, fatigue, nextGame: { ...next, sit: [...(next.sit ?? []), e.target] } });
    }
    case 'veteran_min:sign':
      return eventOffer(run, 'A veteran on the minimum: half their salary counts', threeOf(veterans(run), rng), { discount: 0.5 });
    case 'team_meeting:rest':
      return leaveEvent({ ...run, fatigue: {} });
    case 'back_to_back:rest':
      return leaveEvent({ ...run, fatigue: {}, nextGame: { ...next, sit: [...(next.sit ?? []), top.id] } });
    case 'front_office_leak:scout': {
      const floor = stopById(run.map, e.stopId)?.floor ?? 0;
      const ids = run.map.floors.flat().filter(s => s.floor > floor && s.floor <= floor + 2 && !PASS.has(s.kind)).map(s => s.id);
      return leaveEvent({ ...run, scouted: [...(run.scouted ?? []), ...ids] });
    }
    case 'front_office_leak:cap':
      return leaveEvent({ ...run, cap: run.cap + 200 });
    case 'hot_streak:hot': {
      const two = byPay(cards).slice(-2);
      const names = two.map(c => c.name).join(' and ');
      return rng() < 0.5
        ? noted(leaveEvent({ ...run, nextGame: { ...next, hot: { ...(next.hot ?? {}), ...Object.fromEntries(two.map(c => [c.id, 2])) } } }), `It broke your way: ${names} start the next game with 2 hot markers each.`)
        : noted(leaveEvent({ ...run, nextGame: { ...next, cold: { ...(next.cold ?? {}), ...Object.fromEntries(two.map(c => [c.id, 1])) } } }), `It broke the wrong way: ${names} start the next game with a cold marker each.`);
    }
    case 'hot_streak:power':
      return leaveEvent({ ...run, nextGame: shift(1, -1) });
    case 'holdout:pay':
      return leaveEvent({ ...run, salaryBumps: { ...(run.salaryBumps ?? {}), [targetKey]: (run.salaryBumps?.[targetKey] ?? 0) + 200 } });
    case 'holdout:sit':
      return leaveEvent({ ...run, sitOut: { ...(run.sitOut ?? {}), [e.target]: 2 } });
    case 'flu_bug:quarantine':
      return leaveEvent({ ...run, nextGame: { ...next, sit: [...(next.sit ?? []), e.target] } });
    case 'flu_bug:play':
      return leaveEvent({ ...run, nextGame: shift(-1, -1) });
    case 'budget_cuts:cap':
      return leaveEvent({ ...run, cap: run.cap - 300 });
    case 'budget_cuts:card': {
      const sold = pickFrom(rng, prizedCopies(run));
      return noted(leaveEvent({ ...run, deck: takeCard(run.deck, sold) }), `${STRAT_MAP[baseId(sold)]?.name ?? sold}${isPlus(sold) ? '+' : ''} left your deck.`);
    }
    case 'contract_year:pay':
      return leaveEvent({
        ...run,
        perks: [...(run.perks ?? []), { id: 'contract_year', target: e.target, at: (run.cleared ?? []).length }],
        salaryBumps: { ...(run.salaryBumps ?? {}), [targetKey]: (run.salaryBumps?.[targetKey] ?? 0) + 150 },
      });
    default:
      // Hang up, pass, not now.
      return leaveEvent(run);
  }
}
const PASS = new Set(['rest', 'event']);

// ── Rest ─────────────────────────────────────────────────────────────────────

/**
 * The fewest cards a deck can be cut to: a full hand. CUTTING (the user,
 * 2026-10-19: "Go for both"): skill in a run is roster building and deck
 * scaling, and a thin deck that draws its best cards every game is Slay the
 * Spire's biggest skill lever; a Rest Day's third choice cuts one copy for good.
 */
export const MIN_DECK = 7;
const deckSize = deck => Object.values(deck ?? {}).reduce((t, n) => t + n, 0);

function applyRest(run, { choice, cardId }) {
  if (choice === 'rest') {
    // Win-Now Trade (a boss's perk, 2026-10-22): no more rest; Shootaround: a practice with it.
    if (hasPerk(run, 'win_now_trade')) fail('Win-Now Trade: a Rest Day cannot rest now. Practise or cut.');
    return { ...run, fatigue: {}, ...(hasPerk(run, 'shootaround') ? { freePractice: (run.freePractice ?? 0) + 1 } : {}) };
  }
  if (choice === 'cut') {
    if (deckSize(run.deck) <= MIN_DECK) fail(`A deck keeps at least ${MIN_DECK} cards`);
    return { ...run, deck: takeCard(run.deck, cardId) };
  }
  if (choice !== 'practice') fail('Rest, Practice or Cut');
  if (isPlus(cardId)) fail('That copy is already upgraded');
  if (!PLUS[cardId]) fail(`${STRAT_MAP[cardId]?.name ?? cardId}: no upgrade yet`);
  const deck = addCard(takeCard(run.deck, cardId), plusId(cardId));
  return { ...run, deck };
}

/** A Rest Day: rest everyone, practice (one copy to its "+"), or cut one copy. Any of the three clears the floor. */
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

/** A practice taken from the map (Two-a-Days, Shootaround, Front Office): one copy to its "+" (2026-10-20). */
export function takeFreePractice(run, cardId) {
  if (run.status !== 'map' || !(run.freePractice > 0)) fail('No practice to take');
  return { ...applyRest(run, { choice: 'practice', cardId }), freePractice: run.freePractice - 1 };
}

/** Front Office Shake-Up's cut, taken from the map: one copy out for good (2026-10-22). */
export function takeFreeCut(run, cardId) {
  if (run.status !== 'map' || !(run.freeCut > 0)) fail('No cut to take');
  return { ...applyRest(run, { choice: 'cut', cardId }), freeCut: run.freeCut - 1 };
}

/**
 * KEEP CLIMBING (2026-10-20; the user: "'take what you've earned and quit,'
 * or 'keep going and adding to the pot'"). After an act's boss, the next act:
 * its map, the trackers fresh (Slay the Spire's act break), the cap up a
 * floor, and the boss's reward — three strategy cards with a rare among them,
 * a player and a perk, each sure. The pot rides on: a loss loses all of it.
 * The server's ledger moves first (climbContinue), so the server knows the act.
 */
export function continueClimb(run) {
  if (run.status !== 'won' || run.banked) fail('Beat the boss first');
  const act = actOfRun(run);
  if (act >= ACTS) fail('The climb is complete: bank the pot');
  const bossId = bossIdOf(act);
  const nextAct = act + 1;
  const next = {
    ...run, act: nextAct, map: generateMap(run.seed, run.mapVersion ?? 1, nextAct),
    at: null, restAt: null, game: null, fatigue: {}, cap: run.cap + CLIMB.capPerFloor,
  };
  const rng = climbRng(run.seed, 'offers', bossId);
  const players = playerOffer(next, rng);
  // FULL STRENGTH (2026-10-25): a boss beaten with its style doubled pays one
  // more card pick and a boss's perk from four.
  const full = Boolean(run.fullStrengthWon?.[act]);
  // The boss's own pool (climbPerks.js `boss`, 2026-10-22).
  const perks = perkOffer(next, climbRng(run.seed, 'perks', bossId), rosterCards(next).cards.map(c => c.id), 'boss', full ? 4 : 3);
  // Offered as a Rivalry's are (its third card always rare), at the act's last floor.
  const strats = stratOffer(next, { kind: 'rivalry', floor: FLOORS }, rng, climbRng(run.seed, 'climb-only', bossId));
  return settle({
    ...next,
    status: 'reward',
    extraPicks: Math.max(0, (run.extraPicks ?? 0) - 1),
    offers: { stopId: bossId, strats, picks: 1 + ((run.extraPicks ?? 0) > 0 ? 1 : 0) + (full ? 1 : 0), players, perks },
  });
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
  return potOfRun(run);
}

/** A finished run game as recordResult takes it: you are Team A (presetFor); a tie is not a win. */
export function resultFromGame(game, stopId) {
  const margin = (game?.teamA?.score ?? 0) - (game?.teamB?.score ?? 0);
  const buffs = game?.buffs?.A ?? {};
  return {
    stopId,
    won: margin > 0,
    margin,
    endMinutes: Object.fromEntries((game?.teamA?.stats ?? []).map(s => [s.id, s.minutes ?? 0])),
    // Stay Hot: the hot markers your players end on, two at most (three for
    // Stay Hot+; 2026-10-19).
    ...(buffs.stay_hot ? { carryHot: Object.fromEntries((game?.teamA?.stats ?? []).filter(s => (s.hot ?? 0) > 0).map(s => [s.id, Math.min(buffNumber(buffs.stay_hot, 2), s.hot)])) } : {}),
    // Conditioning+: the next game's fatigue costs nothing too.
    ...(buffNumber(buffs.conditioning, 0) >= 2 ? { conditioned: true } : {}),
    // Wave two (2026-10-20): the one-shots played, Two-a-Days' minutes, Signature Set's growth.
    ...(['leave_it_all', 'two_a_days'].some(id => typeof buffs[id] === 'string') ? { leaves: ['leave_it_all', 'two_a_days'].map(id => buffs[id]).filter(v => typeof v === 'string') } : {}),
    ...(typeof buffs.two_a_days === 'string' ? { twoADays: isPlus(buffs.two_a_days) ? 2 : 4 } : {}),
    ...(buffNumber(buffs.signature_set, 0) > 0 ? { signatureStep: buffNumber(buffs.signature_set, 0) } : {}),
    // Ice Bath: the copy played, which leaves the deck once the fatigue goes.
    ...(buffs.ice_bath ? { iceBath: typeof buffs.ice_bath === 'string' ? buffs.ice_bath : 'ice_bath' } : {}),
  };
}
