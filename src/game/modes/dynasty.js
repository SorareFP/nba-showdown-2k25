// A DYNASTY — ten seasons on the backs of each other, in a finite league.
//
// The user, 2026-09-07: "multiple seasons on the backs of each other … some
// sort of currency that you need to resign your cards, and there's free
// agency … only one version of each card." And 2026-09-11, the spec this
// module builds: two ways to start (your own team, or a fantasy draft from
// every card or from a random smaller pool), Dynasty Points to sign who you
// drafted, personalities to haggle with, an exclusive window for your own
// free agents, free agency against AI bidders, a lottery draft of players
// from outside the pool, and ten years. The design, with every number:
// docs/plans/2026-09-11-dynasty-design.md. The market — what a player asks,
// what he takes — is dynastyMarket.js; this is the league around it.
//
// ── THE FINITE POOL ─────────────────────────────────────────────────────────
//
// One of each PERSON, in two places (the user, 2026-09-11):
//
//   THE LEAGUE — everyone who has been in it: brought, drafted, signed. A
//     card on a contract or held under a team's rights is out of everyone
//     else's reach; the rest of the league are the FREE AGENTS. Nothing is
//     destroyed, so contracts + rights + free agents is the league, always.
//   THE DRAFT POOL — a queue of everyone who has not: every base card not in
//     play and every special-set player with no base card, plus whoever the
//     fantasy draft left on the board. Each offseason the next ten a team
//     come off the front as the class; two rounds are drafted and the rest go
//     back on the end. A drafted player joins the league.
//
// ── EVERYTHING IS A CARD KEY ────────────────────────────────────────────────
//
// A dynasty mixes sets (a brought Super Season card, a drafted rookie), and a
// card's id is its PERSON, shared across sets — so contracts, rights and
// classes are keyed by cardKey, and uniqueness is checked on card.id.
//
// ── PURE ────────────────────────────────────────────────────────────────────
//
// Every function takes a dynasty and returns a new one; nothing here touches
// storage or the screen. DynastyTab.jsx is the shell.
import { CARDS } from '../cards.js';
import { ALL_CARDS, BASE_SET, cardKey, getCardByKey } from '../cardSets.js';
// Ages for the cards that do not carry one — scripts/dynasty/buildAges.mjs.
import DYNASTY_AGES from '../../../card-data/generated/dynasty-ages.json' with { type: 'json' };
import DYNASTY_CONTRACTS from '../../../card-data/generated/dynasty-contracts.json' with { type: 'json' };
import { MAX } from '../teamRules.js';
import { DYNASTY_YEARS } from './prizes.js';
// seasonCore, not season.js: season.js brings the simulator and the engine,
// and a dynasty with friends runs on the server where neither is shipped.
import { buildSeason, standings, totalRounds, PHASE } from './seasonCore.js';
import { buildAiLeague } from './aiTeams.js';
import { playoffCount } from './schedule.js';
import {
  CAP_DP, APRON_DP, MIN_DP, MAX_DP, FA_DAYS, LEFTOVER_DAY, CONTRACT_YEARS,
  fairDp, dealPersonality, floorFor, openingAsk, askFor, preferredYears, newTalk, judgeOffer, rookieScale, toBeat,
  TRADE, talentValue, contractValue, controlFactor,
} from './dynastyMarket.js';

export { DYNASTY_YEARS };

/** Your team's id — the same id Season mode gives you, so its Dashboard just works. */
export const HUMAN_ID = 'you';
export const MIN_ROSTER = 8;
export const MAX_ROSTER = MAX;
/** A fantasy draft fills a roster. */
export const FANTASY_ROUNDS = MAX;
/** The random pool's size, per team in the league. */
export const RANDOM_POOL_PER_TEAM = 15;
/** What an AI team holds back for each roster spot it still has to fill. */
const AI_RESERVE_PER_SPOT = 5;
/**
 * A fantasy-drafting AI team drafts to a budget this far under the cap and
 * signs one spot short of a full roster, so it has a spot and the DP to bid
 * with in year one's free agency. Drafted to the cap and full, it could not
 * bid at all — the first balance probe (2026-09-11) found zero rival offers.
 */
const AI_FA_ROOM = 12;
const AI_OPEN_SPOTS = 1;
/** Offers an AI team makes a day in free agency, and how far down the market it looks. */
const AI_OFFERS_PER_DAY = 2;
const AI_SHORTLIST = 40;
const NEWS_MAX = 80;

export const START_MODES = {
  own: {
    id: 'own', label: 'Bring your team',
    blurb: 'The roster you built from your own cards, on contracts at their value.',
  },
  'fantasy-full': {
    id: 'fantasy-full', label: 'Fantasy draft',
    blurb: 'Snake-draft from every card in the set, then sign who you drafted.',
  },
  'fantasy-random': {
    id: 'fantasy-random', label: 'Fantasy draft · random pool',
    blurb: `A smaller pool drawn at random — ${RANDOM_POOL_PER_TEAM} cards a team, from every price range.`,
  },
};

export const DPHASE = {
  draft: 'draft',
  signing: 'signing',
  season: 'season',
  resign: 'resign',
  lottery: 'lottery',
  rookieDraft: 'rookie-draft',
  rookies: 'rookies',
  freeAgency: 'free-agency',
  preseason: 'preseason',
  done: 'done',
};
const OFFSEASON = new Set([DPHASE.resign, DPHASE.lottery, DPHASE.rookieDraft, DPHASE.rookies, DPHASE.freeAgency, DPHASE.preseason]);
export const isOffseason = d => OFFSEASON.has(d.phase);

// ── Small tools ─────────────────────────────────────────────────────────────

const cardOf = key => getCardByKey(key) ?? null;
const salaryOf = key => cardOf(key)?.salary ?? 0;

function shuffle(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pickWeighted(items, weights, rng) {
  const total = weights.reduce((t, w) => t + w, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

function omit(obj, key) {
  const { [key]: _gone, ...rest } = obj ?? {};
  return rest;
}

/** File a line in the dynasty's news feed, newest first. */
function say(d, text) {
  return { ...d, news: [{ year: d.year, text }, ...(d.news ?? [])].slice(0, NEWS_MAX) };
}

// ── Reading a dynasty ───────────────────────────────────────────────────────

export const teamOf = (d, teamId) => d.teams.find(t => t.id === teamId) ?? null;
export const humanTeam = d => teamOf(d, d.humanId ?? HUMAN_ID);
/** Every human team — one alone ('you'), one per coach in a dynasty with friends ('h:<uid>'). */
export const humanIds = d => d.humans ?? [d.humanId ?? HUMAN_ID];
export const traitOf = (d, key) => d.traits?.[key] ?? 'easy';

/** The keys a team has under contract. */
export function rosterKeys(d, teamId) {
  return Object.entries(d.contracts).filter(([, k]) => k.teamId === teamId).map(([key]) => key);
}

/** A team's cards, dearest first. */
export function rosterOf(d, teamId) {
  return rosterKeys(d, teamId).map(cardOf).filter(Boolean).sort((a, b) => (b.salary ?? 0) - (a.salary ?? 0));
}

/** A team's contracts with the card attached, dearest first. */
export function contractsOf(d, teamId) {
  return Object.entries(d.contracts)
    .filter(([, k]) => k.teamId === teamId)
    .map(([key, k]) => ({ key, card: cardOf(key), pid: traitOf(d, key), ...k }))
    .filter(k => k.card)
    .sort((a, b) => b.dp - a.dp || (b.card.salary ?? 0) - (a.card.salary ?? 0));
}

/** Dead money still on a team's books for the season ahead. */
export function deadMoney(d, teamId) {
  return (d.dead ?? []).filter(x => x.teamId === teamId && x.through >= d.year).reduce((t, x) => t + x.dp, 0);
}

/** A team's payroll in DP: its contracts and its dead money. */
export function payroll(d, teamId) {
  const live = Object.values(d.contracts).filter(k => k.teamId === teamId).reduce((t, k) => t + k.dp, 0);
  return live + deadMoney(d, teamId);
}

/** The keys a team holds rights to, of one kind or all. */
export function rightsOf(d, teamId, kind = null) {
  return Object.entries(d.rights ?? {})
    .filter(([, r]) => r.teamId === teamId && (!kind || r.kind === kind))
    .sort((a, b) => (a[1].pick ?? 0) - (b[1].pick ?? 0))
    .map(([key]) => key);
}

/** The players who have been in the league — the only ones who can be free agents. */
export const leagueKeys = d => d.league ?? [];

/** Every card the dynasty knows: the league, the draft pool, and a draft board still on the table. */
export function universe(d) {
  const board = d.draft?.pool ? draftAvailable(d) : [];
  return [...new Set([...leagueKeys(d), ...(d.draftPool ?? []), ...board])];
}

/** Everyone in the league nobody holds, and nobody who has retired. */
export function freeAgentKeys(d) {
  const gone = new Set(d.retired ?? []);
  return leagueKeys(d).filter(key => !d.contracts[key] && !d.rights?.[key] && !gone.has(key));
}

/** What the team asking means to a player: his last team, how that team did, and whether it just let him go. */
export function ctxFor(d, key, teamId) {
  return {
    teamId,
    lastTeamId: d.lastTeam?.[key] ?? null,
    standing: teamOf(d, teamId)?.last ?? null,
    spurnedBy: d.spurned?.[key] ?? null,
    // Only an aging dynasty prices age in (dynastyMarket.ageFactor).
    age: d.aging ? ageOf(d, key) : null,
  };
}

// ── Age (the user, 2026-09-11) ──────────────────────────────────────────────
//
// "give each card an age on Jan. 1 of the year the card is from, and every
// new player that enters the draft starts aging the year they are drafted."
// So a player's age is his card's age plus the seasons since he JOINED the
// league — year one for everyone on a starting roster, the draft year for a
// pick — and a player still waiting in the draft pool does not age. Only an
// aging dynasty moves the number; a ten-year one shows the card's age.

/** The age on the card: its own, else the generated table, else a league-median 27. */
/**
 * THE DEAL A PLAYER ARRIVES ON in an own-team start: his real NBA contract,
 * priced in Dynasty Points. The user, 2026-09-12: "all players come in on
 * their current contracts, Wemby included, and there is no signing period...
 * Players who need to be re-signed or are free agents should ask for what
 * their card is worth." So this is ONLY the arriving deal — every negotiation
 * after it prices the card (dynastyMarket.js), which is why a rookie-scale
 * star is a bargain until his deal runs out and then asks for the max.
 *
 * A season's salary is read as a share of the NBA cap and paid as the same
 * share of the DP cap, so a max contract lands on the DP max. Null for anyone
 * with no current deal — a retro, throwback or WNBA card, or a free agent the
 * source has no row for — and the caller falls back to what the card is worth.
 * Keyed by card key, so only the current set matches: a 2015 Curry card is
 * never priced off the 2026 Curry contract.
 */
export function contractFor(key) {
  const row = DYNASTY_CONTRACTS.contracts?.[key];
  if (!row?.usd) return null;
  const dp = Math.round((row.usd / DYNASTY_CONTRACTS.capUsd) * CAP_DP);
  return {
    dp: Math.max(MIN_DP, Math.min(MAX_DP, dp)),
    years: Math.max(CONTRACT_YEARS.min, Math.min(CONTRACT_YEARS.max, row.years || 1)),
  };
}

export function baseAge(key) {
  const card = cardOf(key);
  if (Number.isFinite(card?.age)) return card.age;
  return DYNASTY_AGES[key] ?? 27;
}

/** A player's age in this dynasty's current (or coming) season. */
export function ageOf(d, key) {
  const joined = d.joined?.[key];
  return baseAge(key) + (d.aging && joined ? Math.max(0, d.year - joined) : 0);
}

/** Retirement from 35 — one in six, a sixth more each year — certain at 40. */
export const RETIRE_FROM = 35;
export const RETIRE_BY = 40;
export function retireChance(age) {
  if (!Number.isFinite(age) || age < RETIRE_FROM) return 0;
  if (age >= RETIRE_BY) return 1;
  return (age - RETIRE_FROM + 1) / (RETIRE_BY - RETIRE_FROM + 1);
}

/** The day of the market: free agency's day, the leftovers after it, else day one. */
export function marketDay(d) {
  if (d.phase === DPHASE.freeAgency) return d.fa?.day ?? 1;
  return d.fa?.day ?? 1;
}

/** The least a player signs for from a team, at a length, on a day of the market. Never shown to a player. */
export function floorOf(d, key, teamId, years = preferredYears(traitOf(d, key)), day = marketDay(d)) {
  return floorFor(cardOf(key), traitOf(d, key), ctxFor(d, key, teamId), years, day);
}

/**
 * How far a team may spend on this player: your own expiring players and your
 * own draft picks (Bird rights) up to the apron, everyone else to the cap.
 */
export function limitFor(d, teamId, key) {
  const r = d.rights?.[key];
  return r && r.teamId === teamId && (r.kind === 'expiring' || r.kind === 'rookie') ? APRON_DP : CAP_DP;
}

/** Whether `dp` more fits: a minimum deal always does, up to the apron. */
export function fitsCap(d, teamId, key, dp) {
  const limit = dp <= MIN_DP ? APRON_DP : limitFor(d, teamId, key);
  return payroll(d, teamId) + dp <= limit;
}

/** The standing rival offer on a free agent, when it is someone else's. */
export function rivalFor(d, key, teamId) {
  const r = d.fa?.rivals?.[key];
  return r && r.teamId !== teamId ? r : null;
}

/**
 * Everything the negotiation screen shows about one player, from one team, at
 * one length: his ask now (never his floor), whoever else is bidding, and the
 * room under the cap it has to fit in.
 */
export function quote(d, teamId, key, years = null) {
  const card = cardOf(key);
  const pid = traitOf(d, key);
  const y = years ?? preferredYears(pid);
  const ctx = ctxFor(d, key, teamId);
  const day = marketDay(d);
  const talk = d.talks?.[key] ?? newTalk(pid);
  const rival = rivalFor(d, key, teamId);
  const ask = Math.max(
    askFor(card, pid, ctx, y, { progress: talk.progress, day }),
    toBeat(card, pid, ctx, y, day, rival?.ratio ?? 0),
  );
  const limit = limitFor(d, teamId, key);
  return {
    key, card, pid, years: y, preferred: preferredYears(pid), ask, rival, talk,
    limit, room: limit - payroll(d, teamId), fair: fairDp(card),
  };
}

/** The opening ask a team's draftees will make — the draft room's running total. */
export function projectedPayroll(d, teamId) {
  const asks = rightsOf(d, teamId, 'draft').reduce((t, key) => {
    const pid = traitOf(d, key);
    return t + openingAsk(cardOf(key), pid, ctxFor(d, key, teamId), preferredYears(pid), 1);
  }, 0);
  return payroll(d, teamId) + asks;
}

// ── Creating one ────────────────────────────────────────────────────────────

/** A random pool spread over the salary range, so it keeps its stars and its bargains. */
function spreadSample(cards, n, rng) {
  const sorted = [...cards].sort((a, b) => (b.salary ?? 0) - (a.salary ?? 0));
  if (n >= sorted.length) return sorted;
  const bands = 10;
  const out = [];
  for (let b = 0; b < bands; b += 1) {
    const lo = Math.floor((b * sorted.length) / bands);
    const hi = Math.floor(((b + 1) * sorted.length) / bands);
    const want = Math.round(((b + 1) * n) / bands) - Math.round((b * n) / bands);
    out.push(...shuffle(sorted.slice(lo, hi), rng).slice(0, want));
  }
  return out;
}

/**
 * The draft's raw material: every NBA player with a card in a special set and
 * none in the base set — the legends and the rookies the league has never
 * seen. One card per person, his rookie card when he has one.
 */
export function draftClassCards(excludePersons = new Set()) {
  const base = new Set(CARDS.map(c => c.id));
  const byPerson = new Map();
  for (const c of ALL_CARDS) {
    if (!c.set || c.set === BASE_SET || c.set.startsWith('wnba')) continue;
    if (base.has(c.id) || excludePersons.has(c.id)) continue;
    const prev = byPerson.get(c.id);
    if (!prev || (c.set === 'rookie' && prev.set !== 'rookie')) byPerson.set(c.id, c);
  }
  return [...byPerson.values()];
}

/**
 * The offseason draft (the user, 2026-09-11: "We only need 2 rounds per
 * off-season draft. The fantasy draft is the one that is 10 rounds"): a class
 * of the next ten players a team from the draft pool, two rounds drafted.
 */
export const DRAFT_CLASS_PER_TEAM = 10;
export const ROOKIE_ROUNDS = 2;

function snakeOrder(teamIds, rounds) {
  const order = [];
  for (let r = 0; r < rounds; r += 1) order.push(...(r % 2 === 0 ? teamIds : [...teamIds].reverse()));
  return order;
}

/**
 * Create a dynasty. `human` is `{ name, uid, roster, deck, deckName }`; the
 * roster is only read for the 'own' start. Own starts in the preseason with
 * everyone under contract; a fantasy start in the draft room.
 */
export function createDynasty({
  id = `dynasty-${Date.now()}`,
  name = null,
  // One human (`human`, as 'you'), or several (`humans`, each with its own id —
  // 'h:<uid>' in a dynasty with friends).
  human = {},
  humans = null,
  size = 8,
  length = 'regular',
  startMode = 'own',
  // Best-of per playoff round, first round first, for every year (bracket.js).
  series = null,
  // Players age and retire, and the dynasty runs until you end it.
  aging = false,
  // HOW WELL THE AI TEAMS DRAFT — and deliberately NOT the coach difficulty.
  //
  // The user, 2026-09-14: "I honestly think it makes sense for the AI to draft
  // their teams intelligently regardless of the difficulty setting, but we can
  // add an AI drafting difficulty toggle somewhere if we want."
  //
  // Right, and it is the simpler design as well as the kinder one. A draft is
  // a one-time act that fixes the league's quality for ten years, and someone
  // who turns the coach down for an easier EVENING should not be handed a
  // league of junk teams for a decade. So this defaults to the full search and
  // nothing wires it to the rung; the parameter stays because a drafting
  // toggle is then one line.
  //
  // It also closes the hole that made the rung worth fixing at the door in the
  // first place: draft against Settler so the other teams take junk, then play
  // them at Deity for full coin. That only existed while ONE number did both
  // jobs. Separate them and the in-game rung is free to change whenever the
  // player likes, which is the other half of what was asked for.
  iq = 1,
  rng = Math.random,
} = {}) {
  if (!START_MODES[startMode]) throw new Error(`dynasty: no start mode ${startMode}`);
  if (size < 2) throw new Error('dynasty: a league needs two teams');
  const entrants = (humans?.length ? humans : [{ ...human, id: HUMAN_ID }])
    .map(h => ({ ...h, roster: startMode === 'own' ? (h.roster ?? []) : [] }));
  if (entrants.length > size) throw new Error(`dynasty: ${entrants.length} coaches do not fit in a ${size}-team league`);
  const brought = entrants.flatMap(h => h.roster);
  if (new Set(brought.map(c => c.id)).size !== brought.length) throw new Error('dynasty: one card per player');
  // A FULL TEN to enter (the user, 2026-09-11: "there should just be
  // 10-player rosters to enter. Or just choose a team to enter.").
  for (const h of entrants) {
    if (startMode === 'own' && h.roster.length !== MAX_ROSTER) throw new Error(`dynasty: a dynasty team is ${MAX_ROSTER} players — this one has ${h.roster.length}`);
  }

  // Bringing a player takes every card of him out of the league.
  const taken = new Set(brought.map(c => c.id));
  const base = CARDS.filter(c => !taken.has(c.id));
  const poolCards = startMode === 'fantasy-random' ? spreadSample(base, size * RANDOM_POOL_PER_TEAM, rng) : base;
  // The AI franchises — names, colours and logos. Their rosters are drafted
  // (below), never the franchise-built ones Season mode deals.
  const ai = buildAiLeague(size - entrants.length, { cards: CARDS, taken, rng });

  const mine = entrants.map(h => ({
    id: h.id, name: h.name || 'My Team', human: true, uid: h.uid ?? null,
    abbr: null, logo: null, primary: null, secondary: null, city: null,
    deck: h.deck ?? null, deckName: h.deckName ?? null, last: null,
  }));
  const me = mine[0];
  const teams = [...mine, ...ai.map(t => ({
    id: t.id, name: t.name, human: false, uid: null,
    abbr: t.abbr ?? null, logo: t.logo ?? null, primary: t.primary ?? null, secondary: t.secondary ?? null, city: t.city ?? null,
    deck: null, deckName: null, last: null,
  }))];

  // WHO IS WHERE AT THE START. The league is your ten (own) or nobody yet;
  // the board is what the fantasy draft picks from — with you in it, or the
  // AI teams drafting around your ten. Everyone else waits in the draft pool.
  const board = poolCards.map(cardKey);
  const rostered = brought.map(cardKey);
  const inPlay = new Set([...board, ...rostered]);
  const waiting = shuffle([
    ...draftClassCards(taken).map(cardKey),
    ...base.map(cardKey).filter(k => !inPlay.has(k)),
  ], rng);
  const traits = {};
  for (const key of [...rostered, ...board, ...waiting]) traits[key] = dealPersonality(cardOf(key), rng);

  const contracts = {};
  if (startMode === 'own') {
    // EVERY PLAYER ARRIVES ON HIS REAL CONTRACT — real money, the years he
    // has left, and no signing period (the user, 2026-09-12). A card with no
    // current NBA deal comes in at what the card is worth, on a staggered
    // one-to-three years so the exclusive window has somebody in it.
    const years = () => CONTRACT_YEARS.min + Math.floor(rng() * 3);
    const put = (c, teamId) => {
      const real = contractFor(cardKey(c));
      contracts[cardKey(c)] = { teamId, dp: real?.dp ?? fairDp(c), years: real?.years ?? years(), since: 1, how: 'brought' };
    };
    for (const h of entrants) for (const c of h.roster) put(c, h.id);
  }

  // WHAT THE HUMANS ACTUALLY BROUGHT. An own start lets you field the ten you
  // own on their real contracts with no cap check at the door — the user's own
  // rule, 2026-09-12: come in over the apron and you let people walk or trade
  // them to get under before you can re-sign anyone NEXT season. That is a fine
  // rule; it was only ever applied to one side. The AI teams drafted to the
  // 100-DP cap while a collector's best ten came in at 301, which is a threefold
  // payroll advantage and the whole of a forty-point win
  // (scripts/analysis/runRosterGap.js).
  //
  // So year one is drafted to what the league's richest human brought, and
  // everybody is over the apron together, facing the same reckoning in year two.
  const entryCap = Math.max(
    CAP_DP,
    ...entrants.map(h => (h.roster ?? []).reduce((t, c) => {
      const real = contractFor(cardKey(c));
      return t + (real?.dp ?? fairDp(c));
    }, 0)),
  );

  const d = {
    id,
    version: 3,
    createdAt: Date.now(),
    name: name || `${me.name} Dynasty`,
    startMode,
    iq,
    entryCap,
    size,
    length,
    series: Array.isArray(series) && series.length ? series : null,
    aging: Boolean(aging),
    years: DYNASTY_YEARS,
    year: 1,
    phase: DPHASE.preseason,
    humanId: me.id,
    humans: mine.map(t => t.id),
    league: rostered,
    draftPool: waiting,
    retired: [],
    // The year each player joined the league — where his aging starts.
    joined: Object.fromEntries(rostered.map(k => [k, 1])),
    traits,
    teams,
    contracts,
    rights: {},
    lastTeam: {},
    spurned: {},
    // Only the TRADED picks: pickId → owner. Every other pick is its team's.
    pickOwner: {},
    talks: {},
    dead: [],
    draft: null,
    lottery: null,
    fa: null,
    season: null,
    history: [],
    news: [],
    claimed: {},
  };
  if (startMode === 'own') {
    // THE REST OF THE LEAGUE IS FANTASY-DRAFTED (the user, 2026-09-11: "the
    // rest of the teams, if no fantasy draft is chosen, should be fantasy
    // drafted the same way as if the user was in the draft too"). The AI
    // teams snake-draft the board around your ten, sign what they drafted,
    // and settle a free agency of their leftovers among themselves.
    const aiIds = shuffle(teams.filter(t => !t.human).map(t => t.id), rng);
    let x = { ...d, phase: DPHASE.draft, draft: { kind: 'fantasy', order: snakeOrder(aiIds, FANTASY_ROUNDS), picks: [], pool: board } };
    x = finishDraft(simDraft(x, { rng, all: true }), { rng, real: true });
    // NO SIGNING PERIOD in an own start: everyone, yours and theirs, is
    // already on a contract, so the league opens straight into the preseason.
    x = { ...x, phase: DPHASE.preseason, talks: {} };
    return say({ ...x, news: [] }, 'The league opens: every team on its real contracts. Start year one when you are ready.');
  }
  const order = snakeOrder(shuffle(teams.map(t => t.id), rng), FANTASY_ROUNDS);
  return say(
    { ...d, phase: DPHASE.draft, draft: { kind: 'fantasy', order, picks: [], pool: board } },
    `The fantasy draft: ${FANTASY_ROUNDS} rounds, ${board.length} players. Draft who you can afford — every pick has to be signed.`,
  );
}

// ── Signing, letting go ─────────────────────────────────────────────────────

/** Put a player under contract with a team. Clears his rights, his talks and any rival bid. */
function sign(d, teamId, key, { dp, years, how }) {
  const team = teamOf(d, teamId);
  const card = cardOf(key);
  const next = {
    ...d,
    contracts: { ...d.contracts, [key]: { teamId, dp, years, since: d.year, how } },
    rights: omit(d.rights, key),
    fa: d.fa ? { ...d.fa, rivals: omit(d.fa.rivals, key) } : d.fa,
  };
  const verb = how === 'resign' ? 're-signed' : how === 'rookie' ? 'signed their pick' : 'signed';
  const who = how === 'rookie' ? `${card?.name}` : card?.name;
  return how === 'fill' && !team?.human ? next : say(next, `${team?.name} ${verb} ${who} — ${dp} DP × ${years} yr${years === 1 ? '' : 's'}.`);
}

/**
 * Put a player under contract on terms already agreed — the sealed free
 * agency of a dynasty with friends (dynastyFriends.js), where the player has
 * chosen among the bids before anyone signs. Alone, go through negotiate.
 */
export const signContract = (d, teamId, key, terms) => sign(d, teamId, key, terms);

/**
 * Give up a player a team holds the rights to. He becomes a free agent — and,
 * spurned, asks that team 25% more for the rest of the offseason.
 */
export function renounce(d, teamId, key) {
  const r = d.rights?.[key];
  if (!r || r.teamId !== teamId) throw new Error(`dynasty: ${teamId} holds no rights to ${key}`);
  const next = { ...d, rights: omit(d.rights, key), spurned: { ...(d.spurned ?? {}), [key]: teamId } };
  return r.kind === 'expiring' ? say(next, `${cardOf(key)?.name} leaves ${teamOf(d, teamId)?.name} for free agency.`) : next;
}

/**
 * Waive a player under contract, in the offseason: he is a free agent now,
 * and his DP stays on the books for the coming season as dead money.
 */
export function waive(d, teamId, key) {
  if (!isOffseason(d)) throw new Error('dynasty: moves are made in the offseason');
  const k = d.contracts[key];
  if (!k || k.teamId !== teamId) throw new Error(`dynasty: ${key} is not under contract with ${teamId}`);
  return say({
    ...d,
    contracts: omit(d.contracts, key),
    dead: [...(d.dead ?? []), { teamId, key, dp: k.dp, through: d.year }],
    lastTeam: { ...d.lastTeam, [key]: teamId },
    spurned: { ...(d.spurned ?? {}), [key]: teamId },
  }, `${teamOf(d, teamId)?.name} waived ${cardOf(key)?.name} (${k.dp} DP dead this season).`);
}

/** Which players a team may talk to in the phase the dynasty is in. */
function assertCanTalk(d, teamId, key) {
  const r = d.rights?.[key];
  if (d.phase === DPHASE.signing) {
    if (!r || r.kind !== 'draft' || r.teamId !== teamId) throw new Error('dynasty: that is not one of your draftees');
    return;
  }
  if (d.phase === DPHASE.resign) {
    if (!r || r.kind !== 'expiring' || r.teamId !== teamId) throw new Error('dynasty: that is not one of your free agents');
    return;
  }
  if (d.phase === DPHASE.freeAgency || d.phase === DPHASE.preseason) {
    if (d.contracts[key] || r) throw new Error('dynasty: that player is not a free agent');
    if (!leagueKeys(d).includes(key)) throw new Error('dynasty: that player is not in this league');
    return;
  }
  throw new Error('dynasty: nobody is signing right now');
}

/**
 * Make an offer. Returns `{ dynasty, result: { accepted, mood, ask } }` —
 * signed on the spot when he takes it, else his ask after hearing it.
 * Throws when the offer could not legally be signed at all (a full roster,
 * the cap), because the screen should never have let it be made.
 */
export function negotiate(d, teamId, key, offer) {
  assertCanTalk(d, teamId, key);
  const dp = Math.floor(offer?.dp ?? 0);
  const years = Math.floor(offer?.years ?? 0);
  if (rosterKeys(d, teamId).length >= MAX_ROSTER) throw new Error(`dynasty: your roster is full at ${MAX_ROSTER} — waive someone first`);
  if (!fitsCap(d, teamId, key, dp)) throw new Error(`dynasty: ${dp} DP does not fit under your limit of ${limitFor(d, teamId, key)}`);
  const pid = traitOf(d, key);
  const rival = rivalFor(d, key, teamId);
  const verdict = judgeOffer({
    card: cardOf(key), pid, ctx: ctxFor(d, key, teamId), offer: { dp, years },
    talk: d.talks?.[key] ?? null, day: marketDay(d), rivalRatio: rival?.ratio ?? 0,
  });
  let next = { ...d, talks: { ...(d.talks ?? {}), [key]: verdict.talk } };
  if (verdict.accepted) {
    const how = d.rights?.[key]?.kind === 'expiring' ? 'resign' : d.rights?.[key]?.kind === 'draft' ? 'draft' : 'fa';
    next = sign(next, teamId, key, { dp, years, how });
    return { dynasty: next, result: { accepted: true, mood: 'signed', ask: dp } };
  }
  return { dynasty: next, result: { accepted: false, mood: verdict.mood, ask: quote(next, teamId, key, years).ask } };
}

/** Sign your draft pick at the rookie scale. */
export function signRookie(d, teamId, key) {
  if (d.phase !== DPHASE.rookies) throw new Error('dynasty: picks are signed after the draft');
  const r = d.rights?.[key];
  if (!r || r.kind !== 'rookie' || r.teamId !== teamId) throw new Error('dynasty: that is not your pick');
  if (rosterKeys(d, teamId).length >= MAX_ROSTER) throw new Error(`dynasty: your roster is full at ${MAX_ROSTER} — waive someone first`);
  const scale = rookieScale(cardOf(key));
  if (payroll(d, teamId) + scale.dp > APRON_DP) throw new Error(`dynasty: their ${scale.dp} DP would take you past the ${APRON_DP} apron`);
  return sign(d, teamId, key, { ...scale, how: 'rookie' });
}

/**
 * Fill a roster to `min` with the cheapest free agents — the AI teams' floor,
 * and the human's one-click answer to a short roster. Cheapest first, the
 * better player on a tie, under the cap if possible, the apron if not, and
 * anyone at all rather than a team that cannot take the floor.
 */
export function fillRoster(d, teamId, min = MIN_ROSTER) {
  let x = d;
  for (let guard = 0; guard < MAX_ROSTER; guard += 1) {
    if (rosterKeys(x, teamId).length >= min) break;
    const day = marketDay(x);
    const priced = keys => keys
      .map(key => ({ key, dp: floorOf(x, key, teamId, preferredYears(traitOf(x, key)), day) }))
      .sort((a, b) => a.dp - b.dp || salaryOf(b.key) - salaryOf(a.key));
    const pay = payroll(x, teamId);
    const fits = (o, limit) => pay + o.dp <= limit;
    const free = priced(freeAgentKeys(x));
    // CAMP INVITES: when no free agent fits under the apron — an own-team
    // start opens with no free agents at all — the cheapest players waiting
    // in the draft pool come in on minimum-length deals. My call, 2026-09-11.
    let choice = free.find(o => fits(o, CAP_DP)) ?? free.find(o => fits(o, APRON_DP)) ?? null;
    let invite = false;
    if (!choice) {
      const camp = priced(x.draftPool ?? []);
      choice = camp.find(o => fits(o, CAP_DP)) ?? camp.find(o => fits(o, APRON_DP)) ?? null;
      invite = Boolean(choice);
    }
    choice ??= free[0] ?? null;
    if (!choice) break;
    if (invite) {
      x = {
        ...x,
        draftPool: x.draftPool.filter(k => k !== choice.key),
        league: [...leagueKeys(x), choice.key],
        joined: { ...(x.joined ?? {}), [choice.key]: x.year },
      };
    }
    x = sign(x, teamId, choice.key, { dp: choice.dp, years: 1, how: 'fill' });
  }
  return x;
}

// ── Drafts: the fantasy draft and the rookie draft ──────────────────────────

/** Who is left to pick. */
export function draftAvailable(d) {
  if (!d.draft?.pool) return [];
  const gone = new Set(d.draft.picks.map(p => p.key));
  return d.draft.pool.filter(k => !gone.has(k));
}

/** The pick on the clock, or null when the draft is over. */
export function onClock(d) {
  const dr = d.draft;
  if (!dr?.order || (d.phase !== DPHASE.draft && d.phase !== DPHASE.rookieDraft)) return null;
  const n = dr.picks.length;
  if (n >= dr.order.length || !draftAvailable(d).length) return null;
  return { n: n + 1, teamId: dr.order[n], round: Math.floor(n / d.teams.length) + 1 };
}

/** Make a pick. The player comes with rights, not a contract — he still has to sign. */
export function draftPick(d, teamId, key) {
  const clock = onClock(d);
  if (!clock) throw new Error('dynasty: the draft is over');
  if (clock.teamId !== teamId) throw new Error(`dynasty: ${teamId} is not on the clock`);
  if (!draftAvailable(d).includes(key)) throw new Error(`dynasty: ${key} is not available`);
  const kind = d.draft.kind === 'fantasy' ? 'draft' : 'rookie';
  const next = {
    ...d,
    draft: { ...d.draft, picks: [...d.draft.picks, { n: clock.n, round: clock.round, teamId, key }] },
    rights: { ...d.rights, [key]: { teamId, kind, pick: clock.n } },
    // Drafted is in the league, signed or not — and aging from this year.
    league: [...leagueKeys(d), key],
    joined: { ...(d.joined ?? {}), [key]: d.year },
  };
  return kind === 'rookie' && clock.round === 1
    ? say(next, `Pick ${clock.n}: ${teamOf(d, teamId)?.name} take ${cardOf(key)?.name}.`)
    : next;
}

/** Pass on a pick — the offseason draft only; the fantasy draft fills rosters. */
export function passPick(d, teamId) {
  const clock = onClock(d);
  if (!clock) throw new Error('dynasty: the draft is over');
  if (clock.teamId !== teamId) throw new Error(`dynasty: ${teamId} is not on the clock`);
  if (d.draft.kind === 'fantasy') throw new Error('dynasty: every fantasy pick has to be made');
  return { ...d, draft: { ...d.draft, picks: [...d.draft.picks, { n: clock.n, round: clock.round, teamId, key: null }] } };
}

/**
 * The AI's pick. A fantasy draft is drafted to a budget — every pick has to
 * be signed under the cap, so it takes the best player whose price still
 * leaves room for the spots after it. A rookie draft takes the best player.
 * A little chance in both, so two drafts are not the same draft.
 */
export function aiDraftChoice(d, teamId, rng = Math.random, { iq = 1 } = {}) {
  const avail = draftAvailable(d).filter(k => cardOf(k));
  if (!avail.length) return null;
  // Everyone he would play with: the roster and the picks already made.
  const mine = [...rosterKeys(d, teamId), ...rightsOf(d, teamId)];
  const score = k => talentValue(cardOf(k)) * needFactor(mine, cardOf(k));
  if (d.draft.kind !== 'fantasy') {
    const best = [...avail].sort((a, b) => score(b) - score(a));
    return pickWeighted(best.slice(0, 2), [0.65, 0.35], rng);
  }
  // A FANTASY DRAFT IS DRAFTED TO A CAP (the user, 2026-09-11: "drafting to
  // make a team that fits in the salary cap, not just grabbing the best
  // player"). Every pick has to be signed, so this pick's budget is the cap,
  // less what the picks so far will cost, less room kept for free agency,
  // less what the rest of the roster costs filled as cheaply as it could be;
  // and of those that fit, the best is the one the ROSTER needs — guards,
  // wings and bigs in proportion.
  const floor = k => floorOf(d, k, teamId, undefined, 1);
  const committed = rightsOf(d, teamId, 'draft').reduce((t, k) => t + floor(k), 0);
  const picksLeft = d.draft.order.slice(d.draft.picks.length).filter(t => t === teamId).length;
  const reserve = avail.map(floor).sort((a, b) => a - b).slice(0, Math.max(0, picksLeft - 1))
    .reduce((t, f) => t + Math.max(f, AI_RESERVE_PER_SPOT), 0);
  // The cap this draft is played to: year one of an own start matches what the
  // humans brought (entryCap), every other draft is the ordinary 100.
  const cap = d.phase === DPHASE.draft && d.year === 1 ? (d.entryCap ?? CAP_DP) : CAP_DP;
  const budget = cap - AI_FA_ROOM - payroll(d, teamId) - committed - reserve;
  const fits = avail.filter(k => floor(k) <= budget);
  if (!fits.length) return [...avail].sort((a, b) => floor(a) - floor(b))[0];

  // THE DIFFICULTY RUNG DRAFTS THE TEAM. Settler takes anything it can pay
  // for; Deity drafts on the three things below. `iq` is the chance of doing
  // the considered thing, the same dial misplays() turns everywhere else — and
  // this is the lever with range, because the ladder's four existing ones are
  // worth about seven points between them while the roster is worth forty
  // (scripts/analysis/runRosterGap.js).
  if (iq < 1 && rng() >= iq) return fits[Math.floor(rng() * fits.length)];

  // ── 1. WHAT HE IS WORTH AGAINST WHAT HE COSTS ────────────────────────────
  // talentValue is fairDp convexed — how good the card IS — while floor() is
  // his real contract, and the two are not the same number: Victor Wembanyama
  // is the best card in the set and costs eleven of a hundred on his rookie
  // deal, where Jokic, Curry and Embiid all sit at the 35-DP ceiling. Ranking
  // on talent alone spent a third of the cap on a player an eleven-DP one
  // matches.
  const talent = k => talentValue(cardOf(k));
  const repl = Math.min(...fits.map(talent));
  const perDp = k => (talent(k) - repl) / Math.max(floor(k), 1);

  // ── 2. DP REMAINING, SPREAD OVER THE SPOTS LEFT ──────────────────────────
  // Value for money on its own drafts ten bargains and leaves the cap unspent,
  // which is how the first attempt at this fielded a cheap, bad team. What is
  // actually on offer is `budget` across `picksLeft` spots, so a pick near its
  // share is neither hoarding nor starving the rest. Cards far under the share
  // are not punished — a bargain IS the point — but a pick that eats several
  // spots' worth has to be worth several spots.
  const share = Math.max(1, budget / Math.max(1, picksLeft));
  const affordability = k => (floor(k) <= share ? 1 : share / floor(k));

  // ── 3. THE TEAM'S SPEED AND POWER, NOT ITS POSITIONS ─────────────────────
  // The roll bonus is max(speedAdv, powerAdv) against the man you draw, so a
  // roster that is all one axis gets answered by anyone who covers the other.
  // needFactor sorts G/F/C, which is a PROXY for this and a weak one: it moves
  // the number by at most thirty per cent where price swings by multiples, and
  // a draft ranked on price alone fielded teams with no centre at all.
  //
  // This is the mechanic itself. Five play at once, so what matters is the
  // best five on each axis; a card is worth what it ADDS to those two top-five
  // sums. Once five quick players are in, another adds nothing to the speed
  // side and a big adds everything to the power side — which is the positional
  // balance falling out of the thing positions were standing in for.
  const topFive = (keys, stat) => keys
    .map(k => cardOf(k)?.[stat] ?? 0)
    .sort((a, b) => b - a)
    .slice(0, 5)
    .reduce((t, v) => t + v, 0);
  const nowS = topFive(mine, 'speed');
  const nowP = topFive(mine, 'power');
  const coverage = k => {
    const withHim = [...mine, k];
    return (topFive(withHim, 'speed') - nowS) + (topFive(withHim, 'power') - nowP);
  };
  // Scaled against the best gain on the board, so it is a multiplier in 0..1
  // rather than a number that swamps or is swamped by the two above.
  const bestCover = Math.max(...fits.map(coverage), 1);

  const rank = k => perDp(k)
    * affordability(k)
    * (0.35 + 0.65 * (coverage(k) / bestCover))
    * needFactor(mine, cardOf(k));
  const ranked = [...fits].sort((a, b) => rank(b) - rank(a));
  return pickWeighted(ranked.slice(0, 3), [0.6, 0.25, 0.15], rng);
}

/** Let the AI pick until a human is on the clock (or, with `all`, to the end). */
export function simDraft(d, { rng = Math.random, all = false, iq } = {}) {
  let x = d;
  // The dynasty remembers the rung it was started on; a caller may override.
  const level = iq ?? d.iq ?? 1;
  for (let guard = 0; guard < 1000; guard += 1) {
    const clock = onClock(x);
    if (!clock) break;
    if (!all && teamOf(x, clock.teamId)?.human) break;
    x = draftPick(x, clock.teamId, aiDraftChoice(x, clock.teamId, rng, { iq: level }));
  }
  return x;
}

export const draftDone = d => !onClock(d);

/**
 * Close a finished draft. The fantasy draft goes to signing — the AI signs its
 * draftees where it can — and the rookie draft to signing picks.
 */
export function finishDraft(d, { rng = Math.random, real = false } = {}) {
  if (!draftDone(d)) throw new Error('dynasty: the draft is not over');
  const record = { kind: d.draft.kind, picks: d.draft.picks, origin: d.draft.origin ?? null };
  // Nobody took them: the fantasy draft's leftovers are shuffled into the draft
  // pool, an offseason class's go back on the end of it. Neither is a free agent.
  const undrafted = draftAvailable(d);
  if (d.draft.kind === 'fantasy') {
    let x = { ...d, draft: record, phase: DPHASE.signing, talks: {}, draftPool: shuffle([...(d.draftPool ?? []), ...undrafted], rng) };
    for (const team of x.teams.filter(t => !t.human)) {
      for (const key of rightsOf(x, team.id, 'draft')) {
        // `real`: an own-team start, where the AI's teams arrive on real
        // contracts exactly as the coach's does — no negotiation, and over
        // the apron is allowed, because getting back under is the problem
        // the first offseason sets you (the user, 2026-09-12).
        const deal = real ? contractFor(key) : null;
        const years = deal?.years ?? preferredYears(traitOf(x, key));
        const dp = deal?.dp ?? floorOf(x, key, team.id, years, 1);
        const fits = real || (rosterKeys(x, team.id).length < MAX_ROSTER - AI_OPEN_SPOTS && payroll(x, team.id) + dp <= CAP_DP);
        x = fits ? sign(x, team.id, key, { dp, years, how: real ? 'brought' : 'draft' }) : renounce(x, team.id, key);
      }
    }
    return say(x, 'The draft is done. Sign your draftees — anyone you do not sign goes to free agency.');
  }
  let x = {
    ...d, draft: record, phase: DPHASE.rookies, talks: {}, draftPool: [...(d.draftPool ?? []), ...undrafted],
    // This year's picks are made: their trade records go.
    pickOwner: Object.fromEntries(Object.entries(d.pickOwner ?? {}).filter(([id]) => parsePick(id).year !== d.year)),
  };
  for (const team of x.teams.filter(t => !t.human)) {
    for (const key of rightsOf(x, team.id, 'rookie')) {
      const scale = rookieScale(cardOf(key));
      const fits = rosterKeys(x, team.id).length < MAX_ROSTER && payroll(x, team.id) + scale.dp <= APRON_DP;
      x = fits ? sign(x, team.id, key, { ...scale, how: 'rookie' }) : renounce(x, team.id, key);
    }
  }
  return x;
}

/** Done signing draftees: whoever is unsigned goes to free agency, which opens. */
export function closeSigning(d, { rng = Math.random } = {}) {
  if (d.phase !== DPHASE.signing) throw new Error('dynasty: not signing draftees');
  let x = d;
  for (const h of humanIds(x)) for (const key of rightsOf(x, h, 'draft')) x = renounce(x, h, key);
  return openFreeAgency(x, { rng });
}

/** Done signing picks: the unsigned go to free agency, which opens. */
export function closeRookies(d, { rng = Math.random } = {}) {
  if (d.phase !== DPHASE.rookies) throw new Error('dynasty: not signing picks');
  let x = d;
  for (const h of humanIds(x)) for (const key of rightsOf(x, h, 'rookie')) x = renounce(x, h, key);
  return openFreeAgency(x, { rng });
}

// ── The lottery ─────────────────────────────────────────────────────────────

/**
 * THE LOTTERY, scaled from the NBA's (the user, 2026-09-11: "scale a lottery
 * from the current NBA odds to a smaller league and distribute the odds of
 * picks 1-3 based on fewer teams being in the lottery"). The NBA's fourteen
 * lottery slots, worst first, carry 14 / 14 / 14 / 12.5 / 10.5 / 9 / 7.5 / 6
 * / 4.5 / 3 / 2 / 1.5 / 1 / 0.5 % at #1. A lottery of k teams splits those
 * fourteen slots into k equal shares and gives each team its share's odds:
 * two teams draw 81.5 / 18.5, four draw 48 / 33 / 15 / 4, fourteen the NBA's
 * own. Picks 1–3 are drawn, a winner out of the next draw; everyone else picks
 * in reverse order of the standings.
 */
const NBA_LOTTERY = [140, 140, 140, 125, 105, 90, 75, 60, 45, 30, 20, 15, 10, 5];
export const LOTTERY_DRAWS = 3;

/** The NBA's odds shared out over a lottery of `k` teams, worst first (per 1,000). */
export function lotteryWeights(k) {
  const n = NBA_LOTTERY.length;
  return Array.from({ length: k }, (_, i) => {
    const lo = (i * n) / k;
    const hi = ((i + 1) * n) / k;
    let w = 0;
    for (let s = Math.floor(lo); s < Math.ceil(hi); s += 1) w += NBA_LOTTERY[s] * (Math.min(hi, s + 1) - Math.max(lo, s));
    return w;
  });
}

export function lotteryOdds(d) {
  const last = d.history[d.history.length - 1];
  if (!last) return { entries: [], draws: 0 };
  const berths = playoffCount(d.teams.length);
  const out = [...last.table].filter(r => r.rank > berths).sort((a, b) => b.rank - a.rank);
  const weights = lotteryWeights(out.length);
  const total = weights.reduce((t, w) => t + w, 0);
  const entries = out.map((r, i) => ({ teamId: r.id, rank: r.rank, weight: weights[i], pct: Math.round((weights[i] / total) * 1000) / 10 }));
  return { entries, draws: Math.min(LOTTERY_DRAWS, out.length) };
}

/** The coming class: the next ten a team off the front of the draft pool. */
export function classFor(d) {
  return (d.draftPool ?? []).slice(0, DRAFT_CLASS_PER_TEAM * d.teams.length);
}

/** Draw the lottery and open the draft. */
export function drawLottery(d, { rng = Math.random } = {}) {
  if (d.phase !== DPHASE.lottery) throw new Error('dynasty: not lottery time');
  const odds = lotteryOdds(d);
  const left = [...odds.entries];
  const top = [];
  for (let i = 0; i < odds.draws && left.length; i += 1) {
    const won = pickWeighted(left, left.map(e => e.weight), rng);
    top.push(won);
    left.splice(left.indexOf(won), 1);
  }
  const lotteryIds = [...top, ...left].map(e => e.teamId);
  const last = d.history[d.history.length - 1];
  const rest = [...last.table].sort((a, b) => b.rank - a.rank).map(r => r.id).filter(id => !lotteryIds.includes(id));
  const order = [...lotteryIds, ...rest];
  const moved = odds.entries.map((e, i) => ({ teamId: e.teamId, from: i + 1, to: order.indexOf(e.teamId) + 1 }));
  const cls = classFor(d);
  const lottery = { entries: odds.entries, draws: odds.draws, order, moved };
  // A traded pick is made by whoever owns it, in the slot its original team earned.
  const origin = Array.from({ length: ROOKIE_ROUNDS }, () => order).flat();
  const owners = origin.map((t, i) => pickOwner(d, d.year, Math.floor(i / order.length) + 1, t));
  const winner = teamOf(d, order[0]);
  const via = owners[0] !== order[0] ? ` — the pick belongs to ${teamOf(d, owners[0])?.name}` : ' and pick first';
  let x = say({ ...d, lottery }, `${winner?.name} win the lottery${via}.`);
  if (!cls.length) return openFreeAgency({ ...x, draft: null }, { rng });
  x = {
    ...x,
    phase: DPHASE.rookieDraft,
    draftPool: (d.draftPool ?? []).slice(cls.length),
    draft: { kind: 'rookie', order: owners, origin, picks: [], pool: [...cls] },
  };
  return x;
}

// ── Free agency ─────────────────────────────────────────────────────────────

/**
 * The AI's bids for today. Each AI team with an open spot looks down the top
 * of the market for players who would improve it (anyone, while it is short
 * of eight), bids its floor plus up to 10% for the length he wants, and keeps
 * money back for the spots it still has to fill. A player keeps only his best
 * bid — best meaning best FOR HIM, the DP over his floor for that team.
 */
export function aiRivalOffers(d, rng = Math.random) {
  const day = marketDay(d);
  const rivals = {};
  const market = freeAgentKeys(d).filter(k => cardOf(k)).sort((a, b) => salaryOf(b) - salaryOf(a)).slice(0, AI_SHORTLIST);
  const spent = {};
  const made = {};
  for (const team of shuffle(d.teams.filter(t => !t.human), rng)) {
    const size = rosterKeys(d, team.id).length;
    const open = MAX_ROSTER - size;
    if (open <= 0) continue;
    const limit = Math.min(open, AI_OFFERS_PER_DAY);
    const worst = size ? Math.min(...rosterOf(d, team.id).map(c => c.salary ?? 0)) : 0;
    for (const key of market) {
      if ((made[team.id] ?? 0) >= limit) break;
      if (size >= MIN_ROSTER && salaryOf(key) <= worst) continue;
      const years = preferredYears(traitOf(d, key));
      const floor = floorOf(d, key, team.id, years, day);
      const dp = Math.max(floor, Math.ceil(floor * (1 + rng() * 0.1)));
      const spotsAfter = Math.max(0, MIN_ROSTER - size - (made[team.id] ?? 0) - 1);
      const room = CAP_DP - payroll(d, team.id) - (spent[team.id] ?? 0) - spotsAfter * AI_RESERVE_PER_SPOT;
      if (dp > room && dp > MIN_DP) continue;
      const ratio = dp / floor;
      const cur = rivals[key];
      if (cur && cur.ratio >= ratio) continue;
      if (cur) {
        spent[cur.teamId] -= cur.dp;
        made[cur.teamId] -= 1;
      }
      rivals[key] = { teamId: team.id, dp, years, ratio };
      spent[team.id] = (spent[team.id] ?? 0) + dp;
      made[team.id] = (made[team.id] ?? 0) + 1;
    }
  }
  return rivals;
}

/** Open free agency: day one, fresh talks, the AI's first bids on the table. */
export function openFreeAgency(d, { rng = Math.random } = {}) {
  const x = { ...d, phase: DPHASE.freeAgency, fa: { day: 1, rivals: {} }, talks: {}, draft: d.draft?.pool ? { kind: d.draft.kind, picks: d.draft.picks } : d.draft };
  return say({ ...x, fa: { day: 1, rivals: aiRivalOffers(x, rng) } }, 'Free agency is open. The AI teams have made their first offers.');
}

/** The end of a day: every rival bid still standing — and still affordable — signs. */
function resolveRivals(d) {
  let x = d;
  const free = new Set(freeAgentKeys(d));
  const bids = Object.entries(d.fa?.rivals ?? {}).sort((a, b) => b[1].dp - a[1].dp);
  for (const [key, r] of bids) {
    if (!free.has(key)) continue;
    if (rosterKeys(x, r.teamId).length >= MAX_ROSTER) continue;
    if (payroll(x, r.teamId) + r.dp > (r.dp <= MIN_DP ? APRON_DP : CAP_DP)) continue;
    x = sign(x, r.teamId, key, { dp: r.dp, years: r.years, how: 'fa' });
    free.delete(key);
  }
  return x;
}

/** Next day of free agency; after the last one it closes. */
export function nextFaDay(d, { rng = Math.random } = {}) {
  if (d.phase !== DPHASE.freeAgency) throw new Error('dynasty: free agency is not open');
  const x = resolveRivals(d);
  const day = (d.fa?.day ?? 1) + 1;
  if (day > FA_DAYS) return closeFreeAgency(x);
  const y = { ...x, fa: { day, rivals: {} } };
  return { ...y, fa: { day, rivals: aiRivalOffers(y, rng) } };
}

/** Close free agency: the AI teams fill to eight from what is left, and it is the preseason. */
export function closeFreeAgency(d) {
  let x = { ...d, phase: DPHASE.preseason, fa: { day: LEFTOVER_DAY, rivals: {} }, talks: {} };
  for (const team of x.teams.filter(t => !t.human)) x = fillRoster(x, team.id);
  return say(x, 'Free agency has closed. Whoever is left will sign for less.');
}

// ── The season, and the turn of the year ────────────────────────────────────

/** Why a team cannot start the season, or null. */
export function rosterProblem(d, teamId) {
  const n = rosterKeys(d, teamId).length;
  if (n < MIN_ROSTER) return `${n} of the ${MIN_ROSTER} players a season needs`;
  if (n > MAX_ROSTER) return `${n} players — ${MAX_ROSTER} is the most`;
  return null;
}

/**
 * Start the year's season: the AI teams make sure of eight, and every team
 * plays on its contracts. Every team goes to createSeason as a "human" so it
 * keeps the dynasty's roster instead of being dealt an AI one; who is really
 * human is put back from the dynasty's own records.
 */
export function startSeason(d, { rng = Math.random } = {}) {
  if (d.phase !== DPHASE.preseason) throw new Error('dynasty: the season starts from the preseason');
  let x = d;
  for (const team of x.teams.filter(t => !t.human)) x = fillRoster(x, team.id);
  const short = x.teams.filter(t => rosterProblem(x, t.id));
  if (short.length) throw new Error(`dynasty: ${short.map(t => `${t.name} has ${rosterProblem(x, t.id)}`).join('; ')}`);
  const teams = x.teams.map(t => ({
    id: t.id, name: t.name, human: Boolean(t.human), uid: t.uid ?? null, roster: rosterOf(x, t.id),
    abbr: t.abbr ?? null, logo: t.logo ?? null, deck: t.deck ?? null, deckName: t.deckName ?? null,
    primary: t.primary ?? null, secondary: t.secondary ?? null, city: t.city ?? null,
  }));
  const season = buildSeason({ id: `${x.id}-y${x.year}`, teams, length: x.length, series: x.series ?? null });
  void rng;
  // A new season forgives: nobody is spurned any more.
  return say({ ...x, season, phase: DPHASE.season, fa: null, talks: {}, spurned: {} }, `Year ${x.year} tips off.`);
}

/**
 * Close the season: file it in the history, then turn the year — contracts
 * tick, the expiring become their teams' exclusive rights, the AI decides on
 * its own, and the exclusive window opens. After the tenth season the
 * dynasty is done instead.
 */
export function endSeason(d, { rng = Math.random } = {}) {
  if (d.phase !== DPHASE.season || d.season?.phase !== PHASE.done) throw new Error('dynasty: the season is not finished');
  const s = d.season;
  const table = standings(s);
  const seeds = s.playoffSeeds ?? [];
  const entry = {
    year: d.year,
    champion: s.champion ?? null,
    runnerUp: s.runnerUp ?? null,
    playoffSeeds: [...seeds],
    table: table.map(r => ({ id: r.id, w: r.w, l: r.l, rank: r.rank })),
  };
  const teams = d.teams.map(t => {
    const row = table.find(r => r.id === t.id);
    const st = s.teams.find(x => x.id === t.id);
    return {
      ...t,
      deck: st?.deck ?? t.deck ?? null,
      deckName: st?.deckName ?? t.deckName ?? null,
      last: { w: row?.w ?? 0, l: row?.l ?? 0, rank: row?.rank ?? null, playoffs: seeds.includes(t.id), title: s.champion === t.id },
    };
  });
  const champ = teamOf(d, s.champion);
  let x = say({ ...d, teams, history: [...d.history, entry], season: null }, `🏆 ${champ?.name ?? 'Somebody'} win the Year ${d.year} title.`);
  // A ten-year dynasty ends itself; an aging one runs until it is ended (endDynasty).
  if (!d.aging && d.year >= (d.years ?? DYNASTY_YEARS)) return say({ ...x, phase: DPHASE.done }, 'The dynasty is complete.');

  const year = d.year + 1;
  const contracts = {};
  const rights = { ...(x.rights ?? {}) };
  const lastTeam = { ...(x.lastTeam ?? {}) };
  for (const [key, k] of Object.entries(x.contracts)) {
    const left = k.years - 1;
    lastTeam[key] = k.teamId;
    if (left > 0) contracts[key] = { ...k, years: left };
    else rights[key] = { teamId: k.teamId, kind: 'expiring' };
  }
  x = {
    ...x, year, contracts, rights, lastTeam,
    dead: (x.dead ?? []).filter(m => m.through >= year),
    phase: DPHASE.resign, talks: {}, fa: null, lottery: null,
  };
  // Everyone is a year older now; the old may retire before the window opens.
  return aiResign(retirements(x, rng), rng);
}

/**
 * RETIREMENT, at the turn of the year in an aging dynasty: anyone in the
 * league past 35 may go (retireChance). His contract or rights end with him —
 * no dead money — and he never comes back.
 */
function retirements(d, rng) {
  if (!d.aging) return d;
  let x = d;
  const gone = new Set(x.retired ?? []);
  for (const key of leagueKeys(d)) {
    if (gone.has(key)) continue;
    const age = ageOf(x, key);
    const p = retireChance(age);
    if (!p || rng() >= p) continue;
    const holder = x.contracts[key]?.teamId ?? x.rights?.[key]?.teamId ?? null;
    x = { ...x, contracts: omit(x.contracts, key), rights: omit(x.rights, key), retired: [...(x.retired ?? []), key] };
    gone.add(key);
    if (holder) x = say(x, `${cardOf(key)?.name} retires at ${age}, from ${teamOf(x, holder)?.name}.`);
  }
  return x;
}

/** End an aging dynasty between seasons — it has no tenth-year finish of its own. */
export function endDynasty(d) {
  if (!d.aging) throw new Error('dynasty: a ten-year dynasty ends by itself');
  if (d.phase === DPHASE.season || d.phase === DPHASE.done) throw new Error('dynasty: end it between seasons');
  if (!d.history.length) throw new Error('dynasty: play a season first');
  const n = d.history.length;
  return say({ ...d, phase: DPHASE.done, talks: {}, fa: null }, `The dynasty is retired after ${n} season${n === 1 ? '' : 's'}.`);
}

/**
 * The AI's exclusive window: keep a player at his floor when he fits under
 * the apron and is worth it — at least the team's median salary, or a coin
 * flip — and let him walk otherwise.
 */
export function aiResign(d, rng = Math.random) {
  let x = d;
  for (const team of d.teams.filter(t => !t.human)) {
    const kept = rosterOf(x, team.id).map(c => c.salary ?? 0).sort((a, b) => a - b);
    const median = kept.length ? kept[Math.floor(kept.length / 2)] : 0;
    const expiring = rightsOf(x, team.id, 'expiring').sort((a, b) => salaryOf(b) - salaryOf(a));
    for (const key of expiring) {
      const years = preferredYears(traitOf(x, key));
      const dp = floorOf(x, key, team.id, years, 1);
      const fits = rosterKeys(x, team.id).length < MAX_ROSTER && payroll(x, team.id) + dp <= APRON_DP;
      const wanted = salaryOf(key) >= median || rng() < 0.5;
      x = fits && wanted ? sign(x, team.id, key, { dp, years, how: 'resign' }) : renounce(x, team.id, key);
    }
  }
  return x;
}

/**
 * Close the exclusive window: your unsigned go to free agency, the AI teams
 * make their trades among themselves, and it is lottery time.
 */
export function closeResign(d, { rng = Math.random } = {}) {
  if (d.phase !== DPHASE.resign) throw new Error('dynasty: the window is not open');
  let x = d;
  for (const h of humanIds(x)) for (const key of rightsOf(x, h, 'expiring')) x = renounce(x, h, key);
  x = aiTrades(x, { rng });
  return { ...x, phase: DPHASE.lottery, talks: {}, lottery: { ...lotteryOdds(x), order: null, moved: null } };
}

// ── Trades (the user, 2026-09-11) ───────────────────────────────────────────
//
// "AI trades should consider salary, dynasty point salary and years
// remaining, positional need. Use logic from Bill Simmons' trade-value
// articles … to figure out weights."
//
// One player's value TO ONE TEAM is dynastyMarket's talent (convex), years of
// control and contract; the chance he retires before the deal is out (aging
// dynasties — the only thing age means, since nobody gets better or worse);
// whether the team contends or rebuilds; and its need at his position. Picks
// trade too (below). An AI team takes a deal that wins it a little; two AI
// teams trade when both come out ahead by their own lights. Between seasons
// only; contracts move with the players.

const POS_GROUP = { PG: 'G', SG: 'G', SF: 'F', PF: 'F', C: 'C' };
/** What a ten-man roster wants at each position group. */
const POS_TARGET = { G: 4, F: 4, C: 2 };
const groupOf = key => POS_GROUP[cardOf(key)?.pos] ?? 'F';

/** Short at his position: worth up to 30% more; long: down to 15% less. */
function needFactor(teamKeys, card) {
  const group = POS_GROUP[card?.pos] ?? 'F';
  const gap = POS_TARGET[group] - teamKeys.filter(k => groupOf(k) === group).length;
  if (gap > 0) return Math.min(1.3, 1 + 0.1 * gap);
  if (gap < 0) return Math.max(0.85, 1 + 0.05 * gap);
  return 1;
}

/** Where a team is expected to pick (1 = first): last season's reverse standings, else its roster's talent. */
export function projectedSlot(d, teamId) {
  const last = d.history[d.history.length - 1];
  const worstFirst = last
    ? [...last.table].sort((a, b) => b.rank - a.rank).map(r => r.id)
    : d.teams
      .map(t => ({ id: t.id, v: rosterKeys(d, t.id).reduce((s, k) => s + talentValue(cardOf(k)), 0) }))
      .sort((a, b) => a.v - b.v)
      .map(x => x.id);
  const i = worstFirst.indexOf(teamId);
  return i < 0 ? d.teams.length : i + 1;
}

/** Contending (made the playoffs last year) or rebuilding; before any season, the stronger half contends. */
export function teamDirection(d, teamId) {
  const last = teamOf(d, teamId)?.last;
  if (last) return last.playoffs ? 'contend' : 'rebuild';
  return projectedSlot(d, teamId) > d.teams.length / 2 ? 'contend' : 'rebuild';
}

/**
 * The share of the deal he is expected to play before retiring — 1 unless
 * the dynasty ages. The one thing age means in a trade (the user: "this
 * player is going to retire soon, so I'm going to dump him").
 */
function availability(d, key, years) {
  if (!d.aging) return 1;
  const age = ageOf(d, key);
  const seasons = Math.max(1, years);
  let alive = 1;
  let sum = 0;
  for (let t = 0; t < seasons; t += 1) {
    if (t > 0) alive *= 1 - retireChance(age + t);
    sum += alive;
  }
  return sum / seasons;
}

/**
 * What a player under contract is worth to `teamId`, judged against the
 * roster he would be on (`rosterAfter`; its current roster by default):
 * talent, control and contract, times the share of it he is expected to
 * play — minded twice by a rebuilding team, which is buying seasons it has
 * not played yet — times the team's need at his position.
 */
export function tradeValue(d, key, teamId, rosterAfter = null) {
  const card = cardOf(key);
  if (!card) return 0;
  const k = d.contracts[key];
  const years = k?.years ?? 1;
  const rebuild = teamDirection(d, teamId) === 'rebuild';
  const stays = availability(d, key, years);
  const weight = rebuild ? stays * stays : stays;
  // BUYERS AND SELLERS, the column's other constant: a contender pays for the
  // player now and minds the money less; a rebuilder pays for the years and
  // the savings. That difference is what lets two teams both win a deal.
  const cf = controlFactor(years);
  const control = rebuild ? cf ** 1.5 : 1 + (cf - 1) / 2;
  const money = rebuild ? 1.25 : 0.75;
  const base = (talentValue(card) * control + contractValue(card, k) * money) * weight;
  return base * needFactor(rosterAfter ?? rosterKeys(d, teamId), card);
}

// ── Draft picks ─────────────────────────────────────────────────────────────
//
// The user: "We can make draft picks tradeable too, but I'm not really sure
// on the logic there. More valuable for bad teams?" Every team holds its own
// first- and second-rounder in each draft until it trades one; `pickOwner`
// records only the traded ones, and the next two drafts are on the table. A
// pick is worth the player it is projected to land — the coming class's best
// at the slot its ORIGINAL team is projected to pick in, on the rookie
// scale's cheap control — so a bad team's pick is worth more; less for a
// draft a year further out; more to a rebuilding team, less to a contender.
// The owner makes the pick, in the original team's slot.

export const pickId = (year, round, origin) => `${year}-${round}-${origin}`;
export function parsePick(id) {
  const [year, round, ...rest] = String(id).split('-');
  return { year: Number(year), round: Number(round), origin: rest.join('-') };
}
export const pickOwner = (d, year, round, origin) => d.pickOwner?.[pickId(year, round, origin)] ?? origin;

/** The first draft still to be made: this offseason's until it starts, then next year's. */
export function nextDraftYear(d) {
  return d.phase === DPHASE.resign || d.phase === DPHASE.lottery ? d.year : d.year + 1;
}

/** A pick in words: "Year 3 1st (BOS)". */
export function pickLabel(d, id) {
  const { year, round, origin } = parsePick(id);
  const t = teamOf(d, origin);
  return `Year ${year} ${round === 1 ? '1st' : '2nd'} (${t?.abbr ?? (t?.human ? 'yours' : t?.name ?? origin)})`;
}

/** The picks a team holds in the next two drafts. A ten-year dynasty has none past its last season. */
export function picksOf(d, teamId) {
  const first = nextDraftYear(d);
  const out = [];
  for (const year of [first, first + 1]) {
    if (!d.aging && year > (d.years ?? DYNASTY_YEARS)) continue;
    for (let round = 1; round <= ROOKIE_ROUNDS; round += 1) {
      for (const t of d.teams) if (pickOwner(d, year, round, t.id) === teamId) out.push(pickId(year, round, t.id));
    }
  }
  return out;
}

/** What a pick is worth to `teamId`. */
export function pickValue(d, id, teamId) {
  const { year, round, origin } = parsePick(id);
  const slot = (round - 1) * d.teams.length + projectedSlot(d, origin);
  const board = [...classFor(d)].sort((a, b) => talentValue(cardOf(b)) - talentValue(cardOf(a)));
  const key = board[Math.min(slot, board.length) - 1];
  if (!key) return 0;
  const card = cardOf(key);
  const scale = rookieScale(card);
  const v = talentValue(card) * controlFactor(scale.years) + contractValue(card, scale);
  const later = year > nextDraftYear(d) ? 0.75 : 0.9;
  const want = teamDirection(d, teamId) === 'rebuild' ? 1.25 : 0.85;
  return Math.max(0, v) * later * want;
}

/**
 * THE TRADE DEADLINE (the user, 2026-09-11: "The trade desk should exist
 * throughout the season too, with a deadline about the same % of the way
 * through the year as the real NBA"). The NBA's falls in early February,
 * about 60% of the way through its regular season, so a dynasty's is the end
 * of the round that is 60% of its regular season. Trades are open all
 * offseason and in season until then — never in the playoffs, the fantasy
 * draft or its signing.
 */
export const TRADE_DEADLINE_SHARE = 0.6;
export const tradeDeadlineRound = season => Math.max(1, Math.ceil(totalRounds(season) * TRADE_DEADLINE_SHARE));
export function tradesOpen(d) {
  if (isOffseason(d)) return true;
  if (d.phase !== DPHASE.season || !d.season) return false;
  return d.season.phase === PHASE.regular && d.season.round <= tradeDeadlineRound(d.season);
}

const dpOf = (d, keys) => keys.reduce((t, k) => t + (d.contracts[k]?.dp ?? 0), 0);

/**
 * Why a deal cannot happen, or []. A deal is `{ from, to, give, get }`:
 * `give` goes from → to, `get` comes back. Both rosters end at ten or fewer,
 * and neither payroll may grow past the apron.
 */
export function tradeProblems(d, { from, to, give = [], get = [], givePicks = [], getPicks = [] }) {
  const out = [];
  if (!tradesOpen(d)) out.push(d.phase === DPHASE.season ? 'The trade deadline has passed.' : 'No trades right now.');
  if (!give.length && !get.length && !givePicks.length && !getPicks.length) out.push('Nothing is in the deal yet.');
  if (give.some(k => d.contracts[k]?.teamId !== from)) out.push('Only players under contract with you can be traded.');
  if (get.some(k => d.contracts[k]?.teamId !== to)) out.push('That player is not under contract with them.');
  if (givePicks.length && givePicks.some(id => !picksOf(d, from).includes(id))) out.push('That pick is not yours to trade.');
  if (getPicks.length && getPicks.some(id => !picksOf(d, to).includes(id))) out.push('That pick is not theirs to trade.');
  for (const [team, loses, gains] of [[from, give, get], [to, get, give]]) {
    const size = rosterKeys(d, team).length - loses.length + gains.length;
    if (size > MAX_ROSTER) out.push(`${teamOf(d, team)?.name} would have ${size} players — ${MAX_ROSTER} is the most.`);
    // Mid-season a team still has to take the floor.
    if (d.phase === DPHASE.season && size < MIN_ROSTER) out.push(`${teamOf(d, team)?.name} would have ${size} players — a team in season keeps ${MIN_ROSTER}.`);
    const before = payroll(d, team);
    const after = before - dpOf(d, loses) + dpOf(d, gains);
    if (after > APRON_DP && after > before) out.push(`${teamOf(d, team)?.name} would be at ${after} DP — past the ${APRON_DP} apron.`);
  }
  return out;
}

/**
 * The other side's answer: what it gets, valued on the roster it would have,
 * against what it gives, valued on the roster it has — and it wants to win
 * by TRADE.aiEdge. `verdict` is accept, close (within TRADE.closeBand),
 * reject, or illegal; `short` is the value it is missing.
 */
export function evaluateTrade(d, deal) {
  const problems = tradeProblems(d, deal);
  const { to, give = [], get = [], givePicks = [], getPicks = [] } = deal;
  const after = rosterKeys(d, to).filter(k => !get.includes(k));
  const valueIn = give.reduce((t, k) => t + tradeValue(d, k, to, [...after, ...give]), 0)
    + givePicks.reduce((t, id) => t + pickValue(d, id, to), 0);
  const valueOut = get.reduce((t, k) => t + tradeValue(d, k, to), 0)
    + getPicks.reduce((t, id) => t + pickValue(d, id, to), 0);
  const needed = valueOut + TRADE.aiEdge * Math.abs(valueOut);
  const short = Math.max(0, needed - valueIn);
  const verdict = problems.length ? 'illegal'
    : valueIn >= needed ? 'accept'
      : short <= (1 - TRADE.closeBand) * Math.max(Math.abs(needed), 10) ? 'close' : 'reject';
  return { problems, valueIn, valueOut, needed, short, verdict };
}

/** Make a deal the other side accepts — or, with `force`, one already judged (the AI's own). */
export function makeTrade(d, deal, { force = false } = {}) {
  if (!force) {
    const ev = evaluateTrade(d, deal);
    if (ev.verdict !== 'accept') throw new Error(ev.problems[0] ?? 'dynasty: they turned it down');
  }
  const give = deal.give ?? [];
  const get = deal.get ?? [];
  const contracts = { ...d.contracts };
  for (const k of give) contracts[k] = { ...contracts[k], teamId: deal.to };
  for (const k of get) contracts[k] = { ...contracts[k], teamId: deal.from };
  const owners = { ...(d.pickOwner ?? {}) };
  const move = (id, owner) => {
    if (parsePick(id).origin === owner) delete owners[id];
    else owners[id] = owner;
  };
  for (const id of deal.givePicks ?? []) move(id, deal.to);
  for (const id of deal.getPicks ?? []) move(id, deal.from);
  const names = (keys, picks = []) => [...keys.map(k => cardOf(k)?.name), ...picks.map(id => pickLabel(d, id))].join(' and ') || 'nothing';
  let next = { ...d, contracts, pickOwner: owners };
  // MID-SEASON the live season's rosters move too: the next fixture is played with them.
  if (next.phase === DPHASE.season && next.season) {
    const moved = new Set([deal.from, deal.to]);
    next = { ...next, season: { ...next.season, teams: next.season.teams.map(t => (moved.has(t.id) ? { ...t, roster: rosterOf(next, t.id) } : t)) } };
  }
  return say(
    next,
    `Trade: ${teamOf(d, deal.from)?.name} send ${names(give, deal.givePicks)} to ${teamOf(d, deal.to)?.name} for ${names(get, deal.getPicks)}.`,
  );
}

/**
 * The cheapest single addition of yours — a player or a pick — that would get
 * the deal done: `{ key }` or `{ pick }`, or null when nothing alone does.
 */
export function suggestSweetener(d, deal) {
  const players = rosterKeys(d, deal.from).filter(k => !(deal.give ?? []).includes(k))
    .map(k => ({ key: k, cost: tradeValue(d, k, deal.from), deal: { ...deal, give: [...(deal.give ?? []), k] } }));
  const picks = picksOf(d, deal.from).filter(id => !(deal.givePicks ?? []).includes(id))
    .map(id => ({ pick: id, cost: pickValue(d, id, deal.from), deal: { ...deal, givePicks: [...(deal.givePicks ?? []), id] } }));
  const works = [...players, ...picks].filter(x => evaluateTrade(d, x.deal).verdict === 'accept').sort((a, b) => a.cost - b.cost);
  if (!works.length) return null;
  return { key: works[0].key ?? null, pick: works[0].pick ?? null };
}

/**
 * The AI trading among itself, once an offseason: a handful of one-for-one
 * looks between two AI teams, made only when BOTH come out ahead by their
 * own lights.
 */
export function aiTrades(d, { rng = Math.random, attempts = 24, max = 2 } = {}) {
  if (!isOffseason(d)) return d;
  const ai = d.teams.filter(t => !t.human).map(t => t.id);
  let x = d;
  let made = 0;
  const any = list => list[Math.floor(rng() * list.length)];
  for (let i = 0; i < attempts && made < max && ai.length >= 2; i += 1) {
    const contenders = ai.filter(t => teamDirection(x, t) === 'contend');
    const rebuilders = ai.filter(t => teamDirection(x, t) === 'rebuild');
    let deal;
    let aGains;
    let bGains;
    if (contenders.length && rebuilders.length && rng() < 0.5) {
      // THE BUYER'S DEAL: a contender sends a pick to a rebuilder for a
      // player — each values what it gets over what it gives.
      const a = any(contenders);
      const b = any(rebuilders);
      const pick = any(picksOf(x, a));
      const rb = rosterKeys(x, b);
      if (!pick || !rb.length) continue;
      const kb = any(rb);
      deal = { from: a, to: b, give: [], get: [kb], givePicks: [pick], getPicks: [] };
      bGains = pickValue(x, pick, b) - tradeValue(x, kb, b);
      aGains = tradeValue(x, kb, a, [...rosterKeys(x, a), kb]) - pickValue(x, pick, a);
    } else {
      const a = any(ai);
      const b = any(ai.filter(t => t !== a));
      const ra = rosterKeys(x, a);
      const rb = rosterKeys(x, b);
      if (!ra.length || !rb.length) continue;
      const ka = any(ra);
      const kb = any(rb);
      deal = { from: a, to: b, give: [ka], get: [kb] };
      bGains = tradeValue(x, ka, b, [...rb.filter(k => k !== kb), ka]) - tradeValue(x, kb, b);
      aGains = tradeValue(x, kb, a, [...ra.filter(k => k !== ka), kb]) - tradeValue(x, ka, a);
    }
    if (tradeProblems(x, deal).length || bGains <= 1 || aGains <= 1) continue;
    x = makeTrade(x, deal, { force: true });
    made += 1;
  }
  return x;
}

// ── For the list screen ─────────────────────────────────────────────────────

export const PHASE_LABEL = {
  draft: 'Fantasy draft',
  signing: 'Signing draftees',
  season: 'Season',
  resign: 'Re-signing window',
  lottery: 'Draft lottery',
  'rookie-draft': 'Draft',
  rookies: 'Signing picks',
  'free-agency': 'Free agency',
  preseason: 'Preseason',
  done: 'Complete',
};

/** One line about a dynasty, for its card on the list. */
export function summarizeDynasty(d, teamId = humanIds(d)[0]) {
  const me = teamId;
  const titles = d.history.filter(h => h.champion === me).length;
  const wins = d.history.reduce((t, h) => t + (h.table.find(r => r.id === me)?.w ?? 0), 0);
  const losses = d.history.reduce((t, h) => t + (h.table.find(r => r.id === me)?.l ?? 0), 0);
  return { year: d.year, years: d.aging ? null : (d.years ?? DYNASTY_YEARS), phase: d.phase, phaseLabel: PHASE_LABEL[d.phase] ?? d.phase, titles, wins, losses };
}
