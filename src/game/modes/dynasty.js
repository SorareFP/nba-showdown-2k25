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
// One of each PERSON. A card on a contract or held under a team's rights is
// out of everyone else's reach; every other card in the league's universe is
// a free agent. Nothing is destroyed — a player let go goes back into the
// market — so contracts + rights + free agents is the universe, always. The
// universe grows only through the draft, whose classes are players with no
// base card at all (the special sets' legends and rookies).
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
import { MAX } from '../teamRules.js';
import { DYNASTY_YEARS } from './prizes.js';
import { createSeason, standings, PHASE } from './season.js';
import { buildAiLeague } from './aiTeams.js';
import { playoffCount } from './schedule.js';
import {
  CAP_DP, APRON_DP, MIN_DP, FA_DAYS, LEFTOVER_DAY, CONTRACT_YEARS,
  fairDp, dealPersonality, floorFor, openingAsk, askFor, preferredYears, newTalk, judgeOffer, rookieScale, toBeat,
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

/** Every card in the league's world: the pool and every draft class that has entered. */
export function universe(d) {
  return [...new Set([...d.pool, ...(d.entered ?? [])])];
}

/** Everyone nobody holds. */
export function freeAgentKeys(d) {
  return universe(d).filter(key => !d.contracts[key] && !d.rights?.[key]);
}

/** What the team asking means to a player: his last team, how that team did, and whether it just let him go. */
export function ctxFor(d, key, teamId) {
  return {
    teamId,
    lastTeamId: d.lastTeam?.[key] ?? null,
    standing: teamOf(d, teamId)?.last ?? null,
    spurnedBy: d.spurned?.[key] ?? null,
  };
}

/** The day of the market: free agency's day, the leftovers after it, else day one. */
export function marketDay(d) {
  if (d.phase === DPHASE.freeAgency) return d.fa?.day ?? 1;
  return d.fa?.day ?? 1;
}

function floorOf(d, key, teamId, years = preferredYears(traitOf(d, key)), day = marketDay(d)) {
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

/** Deal the classes: one per offseason, up to two a team, shuffled. */
function dealClasses(cards, size, rng, years = DYNASTY_YEARS) {
  const deck = shuffle(cards, rng);
  const count = years - 1;
  const per = Math.min(2 * size, Math.floor(deck.length / count));
  return Array.from({ length: count }, (_, i) => ({
    year: i + 2,
    keys: deck.slice(i * per, (i + 1) * per).map(cardKey),
  }));
}

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
  human = {},
  size = 8,
  length = 'regular',
  startMode = 'own',
  rng = Math.random,
} = {}) {
  if (!START_MODES[startMode]) throw new Error(`dynasty: no start mode ${startMode}`);
  if (size < 2) throw new Error('dynasty: a league needs two teams');
  const brought = startMode === 'own' ? (human.roster ?? []) : [];
  if (startMode === 'own' && !brought.length) throw new Error('dynasty: bring a roster');
  if (brought.length > MAX_ROSTER) throw new Error(`dynasty: a roster is at most ${MAX_ROSTER}`);
  if (new Set(brought.map(c => c.id)).size !== brought.length) throw new Error('dynasty: one card per player');

  // Bringing a player takes every card of him out of the league.
  const taken = new Set(brought.map(c => c.id));
  const base = CARDS.filter(c => !taken.has(c.id));
  const poolCards = startMode === 'fantasy-random' ? spreadSample(base, size * RANDOM_POOL_PER_TEAM, rng) : base;
  // The AI franchises. Their rosters are kept only when everyone brings a team;
  // a fantasy league drafts its own.
  const ai = buildAiLeague(size - 1, { cards: startMode === 'own' ? base : CARDS, taken, rng });

  const me = {
    id: HUMAN_ID, name: human.name || 'My Team', human: true, uid: human.uid ?? null,
    abbr: null, logo: null, primary: null, secondary: null, city: null,
    deck: human.deck ?? null, deckName: human.deckName ?? null, last: null,
  };
  const teams = [me, ...ai.map(t => ({
    id: t.id, name: t.name, human: false, uid: null,
    abbr: t.abbr ?? null, logo: t.logo ?? null, primary: t.primary ?? null, secondary: t.secondary ?? null, city: t.city ?? null,
    deck: null, deckName: null, last: null,
  }))];

  const classes = dealClasses(draftClassCards(taken), size, rng);
  const pool = [...poolCards.map(cardKey), ...brought.map(cardKey)];
  const traits = {};
  for (const key of [...pool, ...classes.flatMap(c => c.keys)]) traits[key] = dealPersonality(cardOf(key), rng);

  const contracts = {};
  if (startMode === 'own') {
    // Staggered, so the exclusive window has somebody in it after year one.
    const years = () => CONTRACT_YEARS.min + Math.floor(rng() * 3);
    const put = (c, teamId) => { contracts[cardKey(c)] = { teamId, dp: fairDp(c), years: years(), since: 1, how: 'brought' }; };
    for (const c of brought) put(c, HUMAN_ID);
    for (const t of ai) for (const c of t.roster) put(c, t.id);
  }

  const d = {
    id,
    version: 2,
    createdAt: Date.now(),
    name: name || `${me.name} Dynasty`,
    startMode,
    size,
    length,
    years: DYNASTY_YEARS,
    year: 1,
    phase: DPHASE.preseason,
    humanId: HUMAN_ID,
    pool,
    entered: [],
    classes,
    traits,
    teams,
    contracts,
    rights: {},
    lastTeam: {},
    spurned: {},
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
  if (startMode === 'own') return say(d, 'The league opens. Fill your roster if you like, then start year one.');
  const order = snakeOrder(shuffle(teams.map(t => t.id), rng), FANTASY_ROUNDS);
  return say(
    { ...d, phase: DPHASE.draft, draft: { kind: 'fantasy', order, picks: [], pool: [...pool] } },
    `The fantasy draft: ${FANTASY_ROUNDS} rounds, ${pool.length} players. Draft who you can afford — every pick has to be signed.`,
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
  const verb = how === 'resign' ? 're-signed' : how === 'rookie' ? 'signed his pick' : 'signed';
  const who = how === 'rookie' ? `${card?.name}` : card?.name;
  return how === 'fill' && !team?.human ? next : say(next, `${team?.name} ${verb} ${who} — ${dp} DP × ${years} yr${years === 1 ? '' : 's'}.`);
}

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
    if (!universe(d).includes(key)) throw new Error('dynasty: that player is not in this league');
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
  if (payroll(d, teamId) + scale.dp > APRON_DP) throw new Error(`dynasty: his ${scale.dp} DP would take you past the ${APRON_DP} apron`);
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
    const offers = freeAgentKeys(x)
      .map(key => ({ key, dp: floorOf(x, key, teamId, preferredYears(traitOf(x, key)), day) }))
      .sort((a, b) => a.dp - b.dp || salaryOf(b.key) - salaryOf(a.key));
    const pay = payroll(x, teamId);
    const choice = offers.find(o => pay + o.dp <= CAP_DP) ?? offers.find(o => pay + o.dp <= APRON_DP) ?? offers[0];
    if (!choice) break;
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
  };
  return kind === 'rookie' && clock.round === 1
    ? say(next, `Pick ${clock.n}: ${teamOf(d, teamId)?.name} take ${cardOf(key)?.name}.`)
    : next;
}

/**
 * The AI's pick. A fantasy draft is drafted to a budget — every pick has to
 * be signed under the cap, so it takes the best player whose price still
 * leaves room for the spots after it. A rookie draft takes the best player.
 * A little chance in both, so two drafts are not the same draft.
 */
export function aiDraftChoice(d, teamId, rng = Math.random) {
  const avail = draftAvailable(d).filter(k => cardOf(k));
  if (!avail.length) return null;
  const bySalary = [...avail].sort((a, b) => salaryOf(b) - salaryOf(a));
  if (d.draft.kind !== 'fantasy') return pickWeighted(bySalary.slice(0, 2), [0.65, 0.35], rng);
  const committed = rightsOf(d, teamId, 'draft').reduce((t, k) => t + floorOf(d, k, teamId, undefined, 1), 0);
  const picksLeft = d.draft.order.slice(d.draft.picks.length).filter(t => t === teamId).length;
  const budget = CAP_DP - AI_FA_ROOM - payroll(d, teamId) - committed - (picksLeft - 1) * AI_RESERVE_PER_SPOT;
  const fits = bySalary.filter(k => floorOf(d, k, teamId, undefined, 1) <= budget);
  if (!fits.length) return [...avail].sort((a, b) => floorOf(d, a, teamId, undefined, 1) - floorOf(d, b, teamId, undefined, 1))[0];
  return pickWeighted(fits.slice(0, 3), [0.6, 0.25, 0.15], rng);
}

/** Let the AI pick until a human is on the clock (or, with `all`, to the end). */
export function simDraft(d, { rng = Math.random, all = false } = {}) {
  let x = d;
  for (let guard = 0; guard < 1000; guard += 1) {
    const clock = onClock(x);
    if (!clock) break;
    if (!all && teamOf(x, clock.teamId)?.human) break;
    x = draftPick(x, clock.teamId, aiDraftChoice(x, clock.teamId, rng));
  }
  return x;
}

export const draftDone = d => !onClock(d);

/**
 * Close a finished draft. The fantasy draft goes to signing — the AI signs its
 * draftees where it can — and the rookie draft to signing picks.
 */
export function finishDraft(d, { rng = Math.random } = {}) {
  if (!draftDone(d)) throw new Error('dynasty: the draft is not over');
  const record = { kind: d.draft.kind, picks: d.draft.picks };
  if (d.draft.kind === 'fantasy') {
    let x = { ...d, draft: record, phase: DPHASE.signing, talks: {} };
    for (const team of x.teams.filter(t => !t.human)) {
      for (const key of rightsOf(x, team.id, 'draft')) {
        const years = preferredYears(traitOf(x, key));
        const dp = floorOf(x, key, team.id, years, 1);
        const fits = rosterKeys(x, team.id).length < MAX_ROSTER - AI_OPEN_SPOTS && payroll(x, team.id) + dp <= CAP_DP;
        x = fits ? sign(x, team.id, key, { dp, years, how: 'draft' }) : renounce(x, team.id, key);
      }
    }
    void rng;
    return say(x, 'The draft is done. Sign your draftees — anyone you do not sign goes to free agency.');
  }
  let x = { ...d, draft: record, phase: DPHASE.rookies, talks: {} };
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
  for (const key of rightsOf(x, x.humanId, 'draft')) x = renounce(x, x.humanId, key);
  return openFreeAgency(x, { rng });
}

/** Done signing picks: the unsigned go to free agency, which opens. */
export function closeRookies(d, { rng = Math.random } = {}) {
  if (d.phase !== DPHASE.rookies) throw new Error('dynasty: not signing picks');
  let x = d;
  for (const key of rightsOf(x, x.humanId, 'rookie')) x = renounce(x, x.humanId, key);
  return openFreeAgency(x, { rng });
}

// ── The lottery ─────────────────────────────────────────────────────────────

/**
 * The lottery: every team that missed the playoffs, worst first, with odds
 * falling off linearly — four teams draw 40/30/20/10. It draws the top half
 * of the lottery's picks (four at most); everyone else picks in reverse
 * order of the standings.
 */
export function lotteryOdds(d) {
  const last = d.history[d.history.length - 1];
  if (!last) return { entries: [], draws: 0 };
  const berths = playoffCount(d.teams.length);
  const out = [...last.table].filter(r => r.rank > berths).sort((a, b) => b.rank - a.rank);
  const k = out.length;
  const total = (k * (k + 1)) / 2;
  const entries = out.map((r, i) => ({ teamId: r.id, rank: r.rank, weight: k - i, pct: Math.round(((k - i) / total) * 1000) / 10 }));
  return { entries, draws: k ? Math.min(4, Math.max(1, Math.floor(k / 2))) : 0 };
}

/** This year's class — the players entering the league before season `year`. */
export function classFor(d, year = d.year) {
  return d.classes.find(c => c.year === year)?.keys ?? [];
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
  const winner = teamOf(d, order[0]);
  let x = say({ ...d, lottery }, `${winner?.name} win the lottery and pick first.`);
  if (!cls.length) return openFreeAgency({ ...x, draft: null }, { rng });
  const rounds = Math.min(2, Math.ceil(cls.length / d.teams.length));
  x = {
    ...x,
    phase: DPHASE.rookieDraft,
    entered: [...new Set([...(d.entered ?? []), ...cls])],
    draft: { kind: 'rookie', order: Array.from({ length: rounds }, () => order).flat(), picks: [], pool: [...cls] },
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
  const humans = x.teams.map(t => ({
    id: t.id, name: t.name, uid: t.uid, abbr: t.abbr, logo: t.logo, deck: t.deck, deckName: t.deckName, roster: rosterOf(x, t.id),
  }));
  const season = createSeason({ id: `${x.id}-y${x.year}`, humans, size: x.teams.length, length: x.length, rng });
  season.teams = season.teams.map(t => {
    const dt = teamOf(x, t.id);
    return { ...t, human: Boolean(dt?.human), primary: dt?.primary ?? null, secondary: dt?.secondary ?? null, city: dt?.city ?? null };
  });
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
  if (d.year >= (d.years ?? DYNASTY_YEARS)) return say({ ...x, phase: DPHASE.done }, 'The dynasty is complete.');

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
  return aiResign(x, rng);
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

/** Close the exclusive window: your unsigned go to free agency, and it is lottery time. */
export function closeResign(d) {
  if (d.phase !== DPHASE.resign) throw new Error('dynasty: the window is not open');
  let x = d;
  for (const key of rightsOf(x, x.humanId, 'expiring')) x = renounce(x, x.humanId, key);
  return { ...x, phase: DPHASE.lottery, talks: {}, lottery: { ...lotteryOdds(x), order: null, moved: null } };
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
export function summarizeDynasty(d) {
  const me = d.humanId ?? HUMAN_ID;
  const titles = d.history.filter(h => h.champion === me).length;
  const wins = d.history.reduce((t, h) => t + (h.table.find(r => r.id === me)?.w ?? 0), 0);
  const losses = d.history.reduce((t, h) => t + (h.table.find(r => r.id === me)?.l ?? 0), 0);
  return { year: d.year, years: d.years ?? DYNASTY_YEARS, phase: d.phase, phaseLabel: PHASE_LABEL[d.phase] ?? d.phase, titles, wins, losses };
}
