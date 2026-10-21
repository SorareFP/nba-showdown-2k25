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
import { generateMap, stopById, nextStops, potOfRun, climbRng, MAP_VERSION, ACTS, FLOORS, bossIdOf } from './climbMap.js';
import { PLAYBOOKS, PLAYBOOK_OF_ARCHETYPE, kitDeck, leanOf, coachDeck } from './climbKits.js';
import { PERKS, perkOffer, perkProblem, boostsOf, boostedCard } from './climbPerks.js';
import { buildAiRoster, buildClassicRoster, classicFranchises, franchisePool } from './aiTeams.js';
import { STRATS, STRAT_MAP, PLUS, baseId, isPlus, plusId, buffNumber } from '../strats.js';
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
    act: 1,
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

/** Where the run can go next. */
export function openStops(run) {
  if (run.status !== 'map') return [];
  return nextStops(run.map, run.at);
}

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
  if (!stop || stop.kind === 'rest') return null;
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

/** The fight at a stop: the coach's team and deck, and the key its game is saved and claimed under. */
export function gameSetup(run, stopId) {
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
    const order = franchiseOrder(run);
    abbr = order[run.cleared.length % order.length];
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

/** A run back from runView, its map rebuilt from the seed. */
export function runFromView(view) {
  return view ? { ...view, map: generateMap(view.seed, view.mapVersion ?? MAP_VERSION, view.act ?? 1) } : null;
}

export function presetFor(run) {
  const g = run.game;
  if (run.status !== 'game' || !g) fail('No game to play');
  return {
    key: g.key,
    // A perk's boosts ride on copies of the cards (climbPerks.js, 2026-10-19).
    rosterA: (() => { const b = boostsOf(run); return rosterCards(run).cards.map(c => boostedCard(c, b[c.id])); })(),
    rosterB: g.rosterB.map(k => getCardByKey(k)).filter(Boolean),
    deckA: { ...run.deck },
    deckB: { ...g.deckB },
    aiLevel: run.rung,
    returnTab: 'climb',
    // At home the coach places first and you answer (CLIMB.homeKinds).
    humanIsHome: Boolean(g.home),
    gameOpts: {
      startQuarter: 4, fatigue: { A: { ...run.fatigue } },
      placementFirst: g.home ? 'B' : 'A',
      ...(run.carryHot ? { hot: { A: { ...run.carryHot } } } : {}),
      ...(run.conditioned ? { buffs: { A: { conditioning_carry: true } } } : {}),
      ...(run.signature ? { signatureBonus: { A: Math.min(SIGNATURE_MAX, 2 + run.signature) } } : {}),
      ...(CLIMB.system && run.playbook ? { system: { A: run.playbook } } : {}),
    },
    climb: { runId: run.id, stopId: g.stopId, kind: g.kind, floor: g.floor, rung: run.rung, act: actOfRun(run) },
    climbView: runView(run),
  };
}

// ── Rewards ──────────────────────────────────────────────────────────────────

/**
 * Three strategy cards: two that lean to the playbook, one from anywhere.
 * Each is rare with the floor's chance; a Rivalry's third always is. Never a
 * card the deck holds at its limit, never one twice.
 */
export function stratOffer(run, stop, rng, rngClimb = null) {
  const chosen = [];
  [run.playbook, run.playbook, null].forEach((lean, slot) => {
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
  const on = new Set(cards.map(c => c.id));
  const open = PLAYER_POOL.filter(c => !on.has(c.id));
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
  const taken = new Set();
  const bestOf = list => {
    const seen = new Set();
    const out = [];
    for (const c of list) {
      if (taken.has(c.id) || seen.has(c.id)) continue;
      seen.add(c.id);
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
    taken.add(c.id);
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
  const { players, perks, dropOdds } = rollDrops(run, stop, stopId, playerPool, perkPool);
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
  const sure = CLIMB.surePlayer.includes(stop.kind);
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
 * a card id in the deck for Film Study, which upgrades one copy at once.
 */
export function pickPerk(run, id, target) {
  if (run.status !== 'reward' || !run.offers?.perks?.includes(id)) fail('That perk is not on offer');
  const problem = perkProblem(run, id, target, rosterCards(run).cards.map(c => c.id));
  if (problem) fail(problem);
  const deck = PERKS[id].target === 'card' ? addCard(takeCard(run.deck, target), plusId(target)) : run.deck;
  return settle({ ...run, deck, perks: [...(run.perks ?? []), { id, target }], offers: { ...run.offers, perks: [] } });
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

/** Does signing this player need a release: a full roster, or over the cap? */
export function needsRelease(run, key) {
  const { cards } = rosterCards(run);
  const card = getCardByKey(key);
  return cards.length >= CLIMB.maxRoster || capSal([...cards, card].filter(Boolean)) > run.cap;
}

/** The players of yours (roster keys) whose release makes room to sign `key`, cheapest first. */
export function releaseOptions(run, key) {
  const card = getCardByKey(key);
  if (!card) return [];
  const keys = run.roster ?? [];
  return keys
    .filter(k => {
      const rest = keys.filter(x => x !== k).map(x => getCardByKey(x)).filter(Boolean);
      return rest.length + 1 <= CLIMB.maxRoster && capSal([...rest, card]) <= run.cap;
    })
    .sort((a, b) => (getCardByKey(a)?.salary ?? 0) - (getCardByKey(b)?.salary ?? 0));
}

/**
 * Sign an offered player. When the roster is full or the cap is short
 * (needsRelease), `release` names the player of yours who makes room: they
 * leave the run, with their perks and their fatigue (2026-10-21).
 */
export function pickPlayer(run, key, release = null) {
  if (run.status !== 'reward' || !run.offers?.players.includes(key)) fail('That player is not on offer');
  let roster = [...(run.roster ?? [])];
  let perks = run.perks ?? [];
  let fatigue = run.fatigue ?? {};
  if (release != null) {
    if (!releaseOptions(run, key).includes(release)) fail('Releasing that player does not make room');
    const gone = getCardByKey(release);
    roster = roster.filter(k => k !== release);
    perks = perks.filter(p => p.target !== gone?.id);
    fatigue = Object.fromEntries(Object.entries(fatigue).filter(([id]) => id !== gone?.id));
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
  if (choice === 'rest') return { ...run, fatigue: {} };
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

/** Two-a-Days' practice, taken from the map: one copy to its "+" (2026-10-20). */
export function takeFreePractice(run, cardId) {
  if (run.status !== 'map' || !(run.freePractice > 0)) fail('No Two-a-Days practice to take');
  return { ...applyRest(run, { choice: 'practice', cardId }), freePractice: run.freePractice - 1 };
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
    ...run, act: nextAct, map: generateMap(run.seed, run.mapVersion ?? MAP_VERSION, nextAct),
    at: null, restAt: null, game: null, fatigue: {}, cap: run.cap + CLIMB.capPerFloor,
  };
  const rng = climbRng(run.seed, 'offers', bossId);
  const players = playerOffer(next, rng);
  const perks = perkOffer(next, climbRng(run.seed, 'perks', bossId), rosterCards(next).cards.map(c => c.id));
  // Offered as a Rivalry's are (its third card always rare), at the act's last floor.
  const strats = stratOffer(next, { kind: 'rivalry', floor: FLOORS }, rng, climbRng(run.seed, 'climb-only', bossId));
  return settle({
    ...next,
    status: 'reward',
    extraPicks: Math.max(0, (run.extraPicks ?? 0) - 1),
    offers: { stopId: bossId, strats, picks: 1 + ((run.extraPicks ?? 0) > 0 ? 1 : 0), players, perks },
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
