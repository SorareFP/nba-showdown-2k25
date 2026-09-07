// A DYNASTY — seasons on the backs of each other, with a finite league.
//
// The user (2026-09-07): "multiple seasons on the backs of each other … some
// sort of currency that you need to resign your cards, and there's free
// agency … only one version of each card, but users could enter with their
// own rosters, and then that removes those players from the rest of the
// player pool. They could start a dynasty with a fantasy draft of all cards
// available in the game, though I think I would want that to nerf the amount
// of coins earned … playing with your own cards should be what drives
// currency income."
//
// ── THE FINITE POOL, WHICH IS THE WHOLE POINT ───────────────────────────────
//
// The user was unsure how this works: "there's a certain amount of cards that
// are entered into the player pool, and then there's one of each and it's
// finite. I don't really know how that would work." Here is the answer this
// module implements, and it is deliberately the simplest one that keeps the
// promise:
//
//   * The pool is EVERY player card in the game, one copy each.
//   * A card on any team's roster is OUT of the pool. Nobody else can have it.
//   * A card on nobody's roster is a FREE AGENT, and free agents are what the
//     draft and free agency deal from.
//   * Nothing is ever destroyed. A released card goes back to free agency, so
//     the pool is conserved: rostered + free agents = the whole set, always.
//
// So the pool does not run out; it circulates. What is scarce is the GOOD end
// of it, which is what makes a re-signing decision cost something.
//
// ── TWO CURRENCIES, ON PURPOSE ──────────────────────────────────────────────
//
// Coins are the real economy and never change hands here. Contracts are paid
// in DYNASTY DOLLARS, which exist only inside one dynasty and never convert.
// A dynasty cannot mint coins and a rich collection cannot buy a dynasty.
import { CARDS } from '../cards.js';
import { CAP } from '../teamRules.js';
import { ROSTER_SIZE } from '../engine.js';
import { dynastyCoinFactor } from './prizes.js';
import { createSeason, standings, PHASE } from './season.js';

/** Roster bounds inside a dynasty: eight to keep a team playable, ten as ever. */
export const MIN_ROSTER = 8;
export const MAX_ROSTER = ROSTER_SIZE;

/** Dynasty Dollars. */
export const DD = {
  perSeason: 1000,
  perWin: 25,
  forTitle: 200,
  /** Re-signing an expiring card: 10% of its salary for each new season. */
  resignRate: 0.10,
  /** Signing a free agent: 5% of its salary for each season of the deal. */
  signRate: 0.05,
};

export const CONTRACT_YEARS = { brought: 2, drafted: 3, minSigned: 1, maxSigned: 3 };

/** What it costs to re-sign a card for `years` more seasons. */
export function resignCost(card, years = 1) {
  return Math.max(1, Math.round((card.salary ?? 0) * DD.resignRate * years));
}

/** What it costs to sign a free agent for `years` seasons. */
export function signCost(card, years = 1) {
  return Math.max(1, Math.round((card.salary ?? 0) * DD.signRate * years));
}

/** A team's cap hit — the printed salaries, the same cap the game uses. */
export function capHit(roster) {
  return roster.reduce((t, c) => t + (c.salary ?? 0), 0);
}

/**
 * Create a dynasty.
 *
 * `startMode` is 'own' (humans bring their collections' rosters) or 'fantasy'
 * (everyone drafts from the whole pool, and coins are halved for it).
 */
export function createDynasty({
  id = `dynasty-${Date.now()}`,
  humans = [],
  size = 8,
  length = 'regular',
  startMode = 'own',
  rng = Math.random,
  cards = CARDS,
} = {}) {
  if (!humans.length) throw new Error('dynasty: needs at least one human team');
  const season = createSeason({ id: `${id}-s1`, humans, size, length, rng, cards });
  const teams = season.teams.map(t => ({
    id: t.id,
    name: t.name,
    human: t.human,
    uid: t.uid ?? null,
    abbr: t.abbr ?? null,
    logo: t.logo ?? null,
    dd: DD.perSeason,
    contracts: t.roster.map(c => ({ cardId: c.id, years: CONTRACT_YEARS.brought })),
  }));
  return {
    id,
    createdAt: Date.now(),
    startMode,
    coinFactor: dynastyCoinFactor(startMode),
    size,
    length,
    year: 1,
    teams,
    // The card ids every team holds; everything else in the set is a free agent.
    rosters: Object.fromEntries(season.teams.map(t => [t.id, t.roster.map(c => c.id)])),
    season,
    history: [],
    phase: 'season',
  };
}

/** Every card id currently on somebody's roster. */
export function rosteredIds(dynasty) {
  return new Set(Object.values(dynasty.rosters).flat());
}

/**
 * The free agents: every card in the set nobody holds. This is the pool the
 * draft and free agency deal from, and it is what makes the league finite.
 */
export function freeAgents(dynasty, cards = CARDS) {
  const held = rosteredIds(dynasty);
  return cards.filter(c => !held.has(c.id));
}

/** Card objects for a team's roster. */
export function rosterOf(dynasty, teamId, cards = CARDS) {
  const byId = new Map(cards.map(c => [c.id, c]));
  return (dynasty.rosters[teamId] ?? []).map(id => byId.get(id)).filter(Boolean);
}

/** A team's contracts, with the card attached. */
export function contractsOf(dynasty, teamId, cards = CARDS) {
  const byId = new Map(cards.map(c => [c.id, c]));
  const team = dynasty.teams.find(t => t.id === teamId);
  return (team?.contracts ?? []).map(k => ({ ...k, card: byId.get(k.cardId) })).filter(k => k.card);
}

/**
 * Close the season out: pay Dynasty Dollars, file the year in the history,
 * and open the off-season. Coins are NOT touched here — those are claimed
 * per game and once for the title, through the season's own rules.
 */
export function endSeason(dynasty) {
  if (dynasty.season.phase !== PHASE.done) throw new Error('dynasty: the season is not finished');
  const table = standings(dynasty.season);
  const teams = dynasty.teams.map(t => {
    const row = table.find(r => r.id === t.id);
    const wins = row?.w ?? 0;
    const title = dynasty.season.champion === t.id;
    const earned = DD.perSeason + wins * DD.perWin + (title ? DD.forTitle : 0);
    return { ...t, dd: t.dd + earned, lastSeason: { wins, losses: row?.l ?? 0, rank: row?.rank ?? null, title } };
  });
  return {
    ...dynasty,
    teams,
    phase: 'offseason',
    history: [...dynasty.history, {
      year: dynasty.year,
      champion: dynasty.season.champion,
      runnerUp: dynasty.season.runnerUp ?? null,
      table: table.map(r => ({ id: r.id, w: r.w, l: r.l, rank: r.rank })),
    }],
  };
}

/**
 * Tick every contract down a year. Cards that run out are EXPIRING: still on
 * the roster, but they leave for free agency unless re-signed.
 */
export function tickContracts(dynasty) {
  const teams = dynasty.teams.map(t => ({
    ...t,
    contracts: t.contracts.map(k => ({ ...k, years: k.years - 1 })),
  }));
  return { ...dynasty, teams };
}

/** The cards whose deals have run out on this team. */
export function expiringOf(dynasty, teamId, cards = CARDS) {
  return contractsOf(dynasty, teamId, cards).filter(k => k.years <= 0);
}

/** Re-sign an expiring card for `years` more seasons, paid in DD. */
export function resign(dynasty, teamId, cardId, years = 2, cards = CARDS) {
  const team = dynasty.teams.find(t => t.id === teamId);
  if (!team) throw new Error(`dynasty: no team ${teamId}`);
  const deal = team.contracts.find(k => k.cardId === cardId);
  if (!deal) throw new Error(`dynasty: ${cardId} is not on ${teamId}`);
  if (deal.years > 0) throw new Error(`dynasty: ${cardId} is still under contract`);
  const card = cards.find(c => c.id === cardId);
  const cost = resignCost(card, years);
  if (team.dd < cost) throw new Error(`dynasty: ${teamId} cannot afford ${cost} DD`);
  const teams = dynasty.teams.map(t => (t.id !== teamId ? t : {
    ...t,
    dd: t.dd - cost,
    contracts: t.contracts.map(k => (k.cardId === cardId ? { ...k, years: Math.min(years, CONTRACT_YEARS.maxSigned) } : k)),
  }));
  return { ...dynasty, teams };
}

/** Let a card go: off the roster, into free agency. */
export function release(dynasty, teamId, cardId) {
  const teams = dynasty.teams.map(t => (t.id !== teamId ? t : { ...t, contracts: t.contracts.filter(k => k.cardId !== cardId) }));
  const rosters = { ...dynasty.rosters, [teamId]: (dynasty.rosters[teamId] ?? []).filter(id => id !== cardId) };
  return { ...dynasty, teams, rosters };
}

/** Everyone still expiring after the re-signing window walks. */
export function releaseExpiring(dynasty, cards = CARDS) {
  let d = dynasty;
  for (const team of dynasty.teams) {
    for (const k of expiringOf(dynasty, team.id, cards)) d = release(d, team.id, k.cardId);
  }
  return d;
}

/** Sign a free agent, paid in DD, cap and roster size permitting. */
export function signFreeAgent(dynasty, teamId, cardId, years = 2, cards = CARDS) {
  const team = dynasty.teams.find(t => t.id === teamId);
  if (!team) throw new Error(`dynasty: no team ${teamId}`);
  if (rosteredIds(dynasty).has(cardId)) throw new Error(`dynasty: ${cardId} is not a free agent`);
  const card = cards.find(c => c.id === cardId);
  if (!card) throw new Error(`dynasty: no card ${cardId}`);
  const roster = rosterOf(dynasty, teamId, cards);
  if (roster.length >= MAX_ROSTER) throw new Error(`dynasty: ${teamId} is full`);
  if (capHit(roster) + (card.salary ?? 0) > CAP) throw new Error(`dynasty: ${cardId} does not fit under the cap`);
  const cost = signCost(card, years);
  if (team.dd < cost) throw new Error(`dynasty: ${teamId} cannot afford ${cost} DD`);
  const teams = dynasty.teams.map(t => (t.id !== teamId ? t : {
    ...t,
    dd: t.dd - cost,
    contracts: [...t.contracts, { cardId, years: Math.min(years, CONTRACT_YEARS.maxSigned) }],
  }));
  const rosters = { ...dynasty.rosters, [teamId]: [...(dynasty.rosters[teamId] ?? []), cardId] };
  return { ...dynasty, teams, rosters };
}

/**
 * The draft order: reverse standings of the season just played, snaking, for
 * `rounds` rounds (default two picks a team).
 */
export function draftOrder(dynasty, rounds = 2) {
  const last = dynasty.history[dynasty.history.length - 1];
  const worstFirst = last
    ? [...last.table].sort((a, b) => b.rank - a.rank).map(r => r.id)
    : dynasty.teams.map(t => t.id);
  const order = [];
  for (let r = 0; r < rounds; r += 1) {
    order.push(...(r % 2 === 0 ? worstFirst : [...worstFirst].reverse()));
  }
  return order;
}

/**
 * Run the draft: each pick takes the best free agent that fits the team's cap
 * and roster. Drafted cards come on three-year deals and cost no DD — the
 * draft is how a bad team gets better without money.
 */
export function runDraft(dynasty, { rounds = 2, cards = CARDS, pick = null } = {}) {
  let d = dynasty;
  for (const teamId of draftOrder(dynasty, rounds)) {
    const roster = rosterOf(d, teamId, cards);
    if (roster.length >= MAX_ROSTER) continue;
    const room = CAP - capHit(roster);
    const available = freeAgents(d, cards).filter(c => (c.salary ?? 0) <= room);
    if (!available.length) continue;
    const choice = pick
      ? pick(teamId, available, d)
      : available.reduce((best, c) => ((c.salary ?? 0) > (best.salary ?? 0) ? c : best), available[0]);
    if (!choice) continue;
    const teams = d.teams.map(t => (t.id !== teamId ? t : {
      ...t,
      contracts: [...t.contracts, { cardId: choice.id, years: CONTRACT_YEARS.drafted }],
    }));
    d = { ...d, teams, rosters: { ...d.rosters, [teamId]: [...(d.rosters[teamId] ?? []), choice.id] } };
  }
  return d;
}

/**
 * Fill every team up to the roster minimum from free agency — what the AI
 * teams do, and the safety net that stops a season starting short-handed.
 */
export function fillRosters(dynasty, { cards = CARDS, min = MIN_ROSTER } = {}) {
  let d = dynasty;
  for (const team of dynasty.teams) {
    for (let guard = 0; guard < 20; guard += 1) {
      const roster = rosterOf(d, team.id, cards);
      if (roster.length >= min) break;
      // CHEAPEST FIRST, and leaving room for the spots after this one. The
      // fill is a league rule, not a shopping trip: a team that spent its
      // draft picks on stars still has to field eight players under the cap,
      // and buying from the top of the market strands it at four.
      const spotsAfter = min - roster.length - 1;
      const pool = freeAgents(d, cards).sort((a, b) => (a.salary ?? 0) - (b.salary ?? 0));
      const reserve = pool.slice(1, spotsAfter + 1).reduce((t, c) => t + (c.salary ?? 0), 0);
      const room = CAP - capHit(roster) - reserve;
      const choice = pool.find(c => (c.salary ?? 0) <= room);
      if (!choice) break;
      // A minimum deal, and a broke team pays what it has — it cannot be left
      // unable to take the floor because free agency outran its budget.
      const current = d.teams.find(t => t.id === team.id);
      const cost = Math.min(signCost(choice, 1), current.dd);
      const teams = d.teams.map(t => (t.id !== team.id ? t : {
        ...t,
        dd: t.dd - cost,
        contracts: [...t.contracts, { cardId: choice.id, years: 1 }],
      }));
      d = { ...d, teams, rosters: { ...d.rosters, [team.id]: [...(d.rosters[team.id] ?? []), choice.id] } };
    }
  }
  return d;
}

/**
 * Start the next season: a new schedule over the same teams and their current
 * rosters. The dynasty's year ticks and the season becomes the live one.
 */
export function startNextSeason(dynasty, { rng = Math.random, cards = CARDS } = {}) {
  const short = dynasty.teams.filter(t => rosterOf(dynasty, t.id, cards).length < MIN_ROSTER);
  if (short.length) throw new Error(`dynasty: ${short.map(t => t.name).join(', ')} ${short.length === 1 ? 'is' : 'are'} below ${MIN_ROSTER} players`);
  const year = dynasty.year + 1;
  const humans = dynasty.teams.map(t => ({
    id: t.id, name: t.name, uid: t.uid, abbr: t.abbr, logo: t.logo, roster: rosterOf(dynasty, t.id, cards),
  }));
  // Every team is passed as a "human" so createSeason keeps the dynasty's own
  // rosters instead of building new AI ones; who is actually human is carried
  // on the dynasty's team records.
  const season = createSeason({ id: `${dynasty.id}-s${year}`, humans, size: dynasty.teams.length, length: dynasty.length, rng, cards });
  const teams = new Map(dynasty.teams.map(t => [t.id, t]));
  season.teams = season.teams.map(t => ({ ...t, human: teams.get(t.id)?.human ?? false }));
  return { ...dynasty, year, season, phase: 'season' };
}

/**
 * The whole off-season, in the order the design fixes: tick, release whoever
 * was not re-signed, draft, then fill from free agency. Re-signing is the
 * human's decision and happens between `tickContracts` and this call — pass
 * the dynasty in after those choices are made.
 */
export function runOffseason(dynasty, { rounds = 2, cards = CARDS } = {}) {
  let d = releaseExpiring(dynasty, cards);
  d = runDraft(d, { rounds, cards });
  d = fillRosters(d, { cards });
  return d;
}
