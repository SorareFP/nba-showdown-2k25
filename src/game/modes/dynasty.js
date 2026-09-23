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
//     fantasy draft left on the board. Each offseason a CLASS is drawn from
//     it by rarity (buildDraftClass, 2026-09-17); two rounds are drafted and
//     the rest go back on the end. A drafted player joins the league.
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
import { ALL_CARDS, BASE_SET, cardKey, getCardByKey, baseKey, copyKey } from '../cardSets.js';
import { fitDeck } from '../deckFit.js';
// payFactorOf, not aiLevels.js's payOf: this file runs on the server too
// (functions/prepare.mjs copies it), and coinRewards.js is what is shared.
import { capOf, payFactorOf } from '../coinRewards.js';
import { getPlayerRarity } from '../rarity.js';

// THE AI'S CAP AND APRON AT THIS LEAGUE'S RUNG (2026-09-16). Above Prince the
// coach's teams are richer: the DP cap and the AI's OWN apron (dynastyMarket
// AI_APRON_DP, 115 — not the human's 130), multiplied by the rung's cap
// (coinRewards.js capOf). Every AI-side check reads these — the draft budget,
// signing the draftees, re-signing, the rookie scale, free-agency room and
// bids, filling a roster, its side of a trade. A HUMAN team's limits
// (limitFor, fitsCap, CAP_DP / APRON_DP) never do: a rung makes the
// opposition better, never the player's own books tighter.
//
// The user, 2026-09-17: "The AI should be able to go over that cap to the
// same apron as humans, but they should not bring in a team over that cap."
// So an AI team ARRIVES at or under aiCapDp whatever the humans brought
// (aiDraftChoice, finishDraft), and grows past it only afterwards — through
// re-signings, its picks and free agency — never past aiApronDp.
export const aiCapDp = d => Math.round(CAP_DP * capOf(d.aiLevel));
export const aiApronDp = d => Math.round(AI_APRON_DP * capOf(d.aiLevel));
/** A team's cap and apron: the human's fixed numbers, or the AI's at this rung. */
const capFor = (d, teamId) => (teamOf(d, teamId)?.human ? CAP_DP : aiCapDp(d));
// A coach's apron can carry a Luxury Apron (staff, 2026-09-23) — apronOf.
const apronFor = (d, teamId) => apronOf(d, teamId);

// ── THE AI'S CARD-SALARY CEILING (the user, 2026-09-18) ─────────────────────
//
// The user asked "Are dynasty opponents still bound to the $5500 salary cap?
// The second year of dynasty is HARD." They were not: DP was the only limit,
// and DP stopped converting to card salary at $55 a DP once real contracts,
// the slot scale and the hidden floor came in. A read-only investigation
// (2026-09-18) measured fantasy-start AI rosters at $4,898 of card salary in
// year one, $5,615, $6,289, $6,852 by year four; an own start's AI teams
// arrived at ~$8,800 on real contracts against the human's $5,500 ten, and
// the human won 0.4% of head-to-heads. The user chose, from four options:
// "AI $5,500×rung ceiling — AI rosters must ALSO fit a card-salary cap
// ($5,500 × the rung's cap, e.g. ×1.12 at Deity) on top of DP, on every AI
// path: draft, re-sign, rookies, FA, trades, claims. You stay on DP only —
// never a worse you."
//
// So an AI team's CONTRACTED roster, summed on each card record's `salary`
// field (the Team Builder's number — getCardByKey(key).salary, a second copy
// read as its card), may never END a step above aiSalaryCap: $5,500 (the
// Team Builder's CAP, teamRules.js — the cap the human's own ten was built
// under) × the rung's cap (coinRewards.js capOf: 1 to Prince, 1.05 King,
// 1.12 Deity). DP still binds as well; this is a second limit, not a new
// currency. Every AI acquisition reads salaryFits: the fantasy and own-start
// draft (aiDraftChoice, finishDraft), re-signing (aiResign), the rookie draft
// and its signings and deadline shed (aiDraftChoice, rookieProblem,
// aiSignRookies), free agency (aiRivalOffers, resolveRivals, a friends week's
// nextFaWeek), the fill (fillRoster), waiver claims (fitProblem) and every
// trade's AI side (tradeProblems — which the AI's own search, its offers to
// a coach, a coach's offer to it and a coach accepting its offer all go
// through). A coach's team is NEVER bound by it (salaryFits is true for a
// human team): the user, "You stay on DP only — never a worse you".
//
// AN OLDER SAVE ALREADY OVER IT IS NOT BROKEN: nothing is cut. A team above
// the ceiling simply cannot add card salary until it is back under — a step
// may leave it where it was or lower (a trade that sends out more than it
// takes, a man who walks), never higher. The one case a team may end above
// the ceiling is the floor: an AI team always fields MIN_ROSTER, and when no
// player fits, the fill signs the cheapest card there is (fillRoster).
//
// SO THAT THE FLOOR IS RARELY NEEDED, EVERY PATH KEEPS ROOM (2026-09-19,
// after a verifier's step trace): a cheap card's worth for each seat the step
// leaves the team short of eight (seatsHeld — picks, trades, claims, the fill
// itself, re-signing and free agency alike), its unsigned picks' cards, and in
// re-signing and the trades before the draft the cards its coming picks will
// carry (draftReserve's `salary`).
export const aiSalaryCap = d => Math.round(CARD_CAP * capOf(d.aiLevel));
/** The card salary of a team's contracted roster — the card record's `salary`, summed. */
export function aiSalaryOf(d, teamId) {
  let t = 0;
  for (const [key, k] of Object.entries(d.contracts)) if (k.teamId === teamId) t += salaryOf(key);
  return t;
}
/** The card salary of these keys. */
const salaryOfKeys = keys => keys.reduce((t, k) => t + salaryOf(k), 0);
/**
 * Whether a team may take `add` on (and let `drop` go) and still be within its
 * card-salary ceiling: always, for a coach; for an AI team, when the roster
 * ends at or under aiSalaryCap — or, a team already over it (an older save),
 * no dearer than it is now. `held` is card salary the team has spoken for
 * without a contract yet (its unsigned picks), counted on top.
 */
export function salaryFits(d, teamId, add = [], drop = [], held = 0) {
  const team = teamOf(d, teamId);
  if (!team || team.human) return true;
  const now = aiSalaryOf(d, teamId);
  const after = now + held + salaryOfKeys(add) - salaryOfKeys(drop);
  return after <= Math.max(aiSalaryCap(d), now);
}
/** What an AI team's unsigned picks will carry in card salary — the room they reserve, as rookieCommitted is in DP. */
const rookieSalaryHeld = (d, teamId) => salaryOfKeys(rightsOf(d, teamId, 'rookie'));
/**
 * Whether a free agent's card fits a team's ceiling at signing, its unsigned
 * picks held back — the AI's bids signing alone (resolveRivals) and in a
 * friends week (dynastyFriends nextFaWeek). Always, for a coach.
 */
export const signingFits = (d, teamId, key) => salaryFits(d, teamId, [key], [], rookieSalaryHeld(d, teamId));
/**
 * Card salary an AI team holds back for each seat it is still short of
 * MIN_ROSTER, so the seat can be filled under the ceiling: a cheap card, and
 * the pool always has them (the draft pool's camp invites run to $30).
 */
const AI_SALARY_PER_SPOT = 150;
/**
 * The card salary an AI team keeps back for the seats a step would still
 * leave it short of MIN_ROSTER, `seatsAfter` being its seats once the step is
 * done (0 for a coach, who is never bound). EVERY AI acquisition holds it
 * (2026-09-19): the first build held it only in re-signing and free agency,
 * and a verifier's step trace found the other paths spending the eighth
 * seat's room while the team was short — a rookie signing took a 6-man
 * Memphis to $5,500 on Zubac, a trade took a 6-man San Antonio from $5,190
 * to $6,110 — so the fill then had to sign past the ceiling: 22 of 2,240 AI
 * team-seasons tipped off over it, 16 of them in year four.
 */
function seatsHeld(d, teamId, seatsAfter) {
  if (teamOf(d, teamId)?.human) return 0;
  return Math.max(0, MIN_ROSTER - seatsAfter) * AI_SALARY_PER_SPOT;
}
// Ages for the cards that do not carry one — scripts/dynasty/buildAges.mjs.
import DYNASTY_AGES from '../../../card-data/generated/dynasty-ages.json' with { type: 'json' };
import DYNASTY_CONTRACTS from '../../../card-data/generated/dynasty-contracts.json' with { type: 'json' };
// CAP: the Team Builder's $5,500 — the AI's card-salary ceiling's base (aiSalaryCap).
import { MAX, CAP as CARD_CAP } from '../teamRules.js';
import { DYNASTY_YEARS, ownGamesPlayed } from './prizes.js';
// seasonCore, not season.js: season.js brings the simulator and the engine,
// and a dynasty with friends runs on the server where neither is shipped.
import { buildSeason, standings, totalRounds, PHASE } from './seasonCore.js';
import { buildAiLeague } from './aiTeams.js';
import { playoffCount } from './schedule.js';
import {
  CAP_DP, APRON_DP, AI_APRON_DP, MIN_DP, MAX_DP, FA_DAYS, LEFTOVER_DAY, CONTRACT_YEARS,
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
/** One coach, and it is this device's player — not a dynasty with friends (2026-09-18, the share-played count). */
export const isSoloDynasty = d => (d.humanId ?? HUMAN_ID) === HUMAN_ID && humanIds(d).length === 1;
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

/**
 * Everyone in the league nobody holds, and nobody who has retired — nor
 * anyone on waivers (2026-09-18), who is a free agent only once the wire
 * resolves with nobody claiming him.
 */
export function freeAgentKeys(d) {
  const gone = new Set(d.retired ?? []);
  for (const w of d.waivers ?? []) gone.add(w.key);
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
  // 2026-09-18: a join year of 0 is a real join, so test for a number, not
  // truthiness. The engine starts at year 1 and writes d.year, so it never
  // writes 0 itself, but a test (or a hand-built save) that back-dates a join
  // to year 0 was being read as "never joined" and the man did not age.
  return baseAge(key) + (d.aging && Number.isFinite(joined) ? Math.max(0, d.year - joined) : 0);
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
  return r && r.teamId === teamId && (r.kind === 'expiring' || r.kind === 'rookie') ? apronOf(d, teamId) : CAP_DP;
}

/** Whether `dp` more fits: a minimum deal always does, up to the apron. */
export function fitsCap(d, teamId, key, dp) {
  const limit = dp <= MIN_DP ? apronOf(d, teamId) : limitFor(d, teamId, key);
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
  // Hometown Discount (staff, 2026-09-23): a coach's own expiring player asks
  // 10% less of him, and negotiate judges the offer on the same footing.
  const discount = discountFor(d, teamId, key);
  const ask = Math.max(MIN_DP, Math.ceil(Math.max(
    askFor(card, pid, ctx, y, { progress: talk.progress, day }),
    toBeat(card, pid, ctx, y, day, rival?.ratio ?? 0),
  ) * discount));
  const limit = limitFor(d, teamId, key);
  return {
    key, card, pid, years: y, preferred: preferredYears(pid), ask, rival, talk, discount,
    limit, room: limit - payroll(d, teamId), fair: fairDp(card),
    // Read the Room (staff): the floor, for the coach who has paid to see it.
    floor: staffTier(d, teamId, 'cap') >= 1 ? Math.max(MIN_DP, Math.ceil(floorOf(d, key, teamId, y, day) * discount)) : null,
  };
}

/** A pick's contract on the rookie scale: his slot in this league's draft (dynastyMarket.rookieScale). */
export function rookieTerms(d, key) {
  const { dp, years } = rookieScale(d.rights?.[key]?.pick ?? 1, d.teams.length);
  return { dp, years };
}

/** What a team's unsigned picks would cost on the scale — the room they reserve. */
export function rookieCommitted(d, teamId) {
  return rightsOf(d, teamId, 'rookie').reduce((t, key) => t + rookieTerms(d, key).dp, 0);
}

/**
 * The draft room's running total: the opening asks of a team's fantasy
 * draftees, and the scale of the picks it holds the rights to.
 */
export function projectedPayroll(d, teamId) {
  const asks = rightsOf(d, teamId, 'draft').reduce((t, key) => {
    const pid = traitOf(d, key);
    return t + openingAsk(cardOf(key), pid, ctxFor(d, key, teamId), preferredYears(pid), 1);
  }, 0);
  return payroll(d, teamId) + asks + rookieCommitted(d, teamId);
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
 * off-season draft. The fantasy draft is the one that is 10 rounds"): two
 * rounds drafted from a class of two a team plus four.
 */
export const ROOKIE_ROUNDS = 2;
export const DRAFT_CLASS_EXTRA = 4;
/** How big a class is in a league of `teams` teams. */
export const classSize = teams => ROOKIE_ROUNDS * teams + DRAFT_CLASS_EXTRA;

// ── THE CLASS IS BUILT BY RARITY, NOT SLICED (the user, 2026-09-17) ─────────
//
// The second run's verdict: the draft class was "way way way too good". It
// was a slice of ten a team off a shuffled pool that held every undrafted
// base card — the stars nobody could afford — and averaged five legendaries
// and twelve super-rares in an eight-team class. Now the class is DRAWN, band
// by band, from the same universe (the special-set persons plus the base
// leftovers — the user: "a small chance of a legendary in the pool"):
//
//   legendary   one, with probability 0.15 — never two;
//   super-rare  one at 0.60, and a second only after the first — at 0.25,
//               so that TWO super-rares land in 15% of ALL classes
//               (0.60 × 0.25). The user, 2026-09-18, confirming they meant
//               15% of classes, not 15% of the classes that already had one:
//               the roll was 0.15 until then, two in about 9% of classes;
//   rare        ONE GUARANTEED, then a further one at 0.60, 0.35 and 0.15 —
//               cascading, each roll only after the one before it landed;
//   the rest    uncommon or common, a coin flip a seat.
//
// A band the pool cannot supply falls to the band below it. The class is
// decided ONCE a year and stored on d.draftClass (withClass) so the trade
// desk's pick values, the lottery room, the draft room, the AI and
// finishDraft all see the same players.
const CLASS_ODDS = {
  legendary: [0.15],
  'super-rare': [0.6, 0.25],
  rare: [1, 0.6, 0.35, 0.15],
};
const CLASS_BANDS = ['legendary', 'super-rare', 'rare', 'uncommon', 'common'];

/**
 * Draw a class of classSize(teams) keys from `d.draftPool` with `rng`. Pure:
 * the pool is not touched — drawLottery takes the class out of it.
 */
export function buildDraftClass(d, rng = Math.random) {
  const want = classSize(d.teams.length);
  const byBand = Object.fromEntries(CLASS_BANDS.map(b => [b, []]));
  for (const key of d.draftPool ?? []) {
    const card = cardOf(key);
    if (card) byBand[getPlayerRarity(card)].push(key);
  }
  for (const b of CLASS_BANDS) byBand[b] = shuffle(byBand[b], rng);
  const out = [];
  // A seat in `band`, or the first band below it with anyone left in it.
  // `upward`: a filler seat in a pool with nothing left below it takes the
  // nearest band ABOVE instead — else a pool of only rares and better would
  // never fill its class (it looped forever until 2026-09-18). Only the
  // uncommon/common seats go up; the odds' own seats never do.
  const seat = (band, upward = false) => {
    if (out.length >= want) return;
    const at = CLASS_BANDS.indexOf(band);
    const order = [...CLASS_BANDS.slice(at), ...(upward ? CLASS_BANDS.slice(0, at).reverse() : [])];
    for (const b of order) {
      const key = byBand[b].shift();
      if (key) { out.push(key); return; }
    }
  };
  for (const band of ['legendary', 'super-rare', 'rare']) {
    for (const p of CLASS_ODDS[band]) {
      if (rng() >= p) break;
      seat(band);
    }
  }
  while (out.length < want && CLASS_BANDS.some(b => byBand[b].length)) seat(rng() < 0.5 ? 'uncommon' : 'common', true);
  return out;
}

/**
 * The class's deterministic rng, seeded from the dynasty and the draft year.
 *
 * MIXED BEFORE IT SEEDS (2026-09-18). The raw FNV-1a hash of `${id}:${year}`
 * went straight into the LCG, and ids that differ only in their last
 * character (own1, own2, … — or dynasty-<n>) hash to seeds a small multiple
 * of the FNV prime apart, so their first rolls moved in lock-step: over 150
 * such ids the year-two class had a super-rare 47% of the time against the
 * 60% the user set. murmur3's fmix32 finalizer spreads every input bit over
 * the whole word, and the LCG's first few outputs are thrown away besides.
 * This changes which class a given dynasty draws — harmless: a save stores
 * its class once drawn (withClass), and only one with none stored redraws.
 */
function classRng(d, year) {
  let s = 2166136261;
  for (const ch of `${d.id}:${year}`) s = Math.imul(s ^ ch.charCodeAt(0), 16777619) >>> 0;
  s ^= s >>> 16;
  s = Math.imul(s, 0x85ebca6b);
  s ^= s >>> 13;
  s = Math.imul(s, 0xc2b2ae35);
  s ^= s >>> 16;
  s >>>= 0;
  const next = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  for (let i = 0; i < 4; i += 1) next();
  return next;
}

/**
 * Draw the class of the next draft still to be made and store it, once: a
 * class already stored for that year is kept. It is drawn the moment the one
 * before it leaves the pool — the lottery's draw (drawLottery), or the fantasy
 * draft's close for year two — so from then until its own draft every pick
 * is valued on the players who will really be in it. Until 2026-09-18 a
 * preview priced the picks all season and closeResign threw it away for a
 * fresh draw: a trade was valued on a class nobody drafted. The seed is the
 * dynasty and the year, so the class is the same however the game got there.
 * `classFor` reads the same draw for a save that has none stored yet.
 */
function withClass(d, year = nextDraftYear(d)) {
  if (d.draftClass?.keys && d.draftClass.year === year) return d;
  return { ...d, draftClass: { year, keys: buildDraftClass(d, classRng(d, year)) } };
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
  // THE LEAGUE'S RUNG (2026-09-16, the reshaped ladder). Above Prince the
  // coach's teams are BETTER: they draft to a DP budget multiplied by the
  // rung's cap (coinRewards.js capOf — this module runs on the server, and
  // coinRewards is the import-free table it can read). The rung is remembered
  // so a game in this league pays at the lower of the league's rung and the
  // rung it was played at (payFloorOf): turn the coach down whenever you like,
  // but you are not paid for opponents that were never drafted. null is Prince.
  aiLevel = null,
  rng = Math.random,
} = {}) {
  if (!START_MODES[startMode]) throw new Error(`dynasty: no start mode ${startMode}`);
  if (size < 2) throw new Error('dynasty: a league needs two teams');
  const entrants = (humans?.length ? humans : [{ ...human, id: HUMAN_ID }])
    .map(h => ({ ...h, roster: startMode === 'own' ? (h.roster ?? []) : [] }));
  if (entrants.length > size) throw new Error(`dynasty: ${entrants.length} coaches do not fit in a ${size}-team league`);
  const brought = entrants.flatMap(h => h.roster);
  // ONE OF EACH PLAYER PER TEAM — not per league. Two coaches may bring the
  // same player (the user, 2026-09-16); the second copy takes a suffixed key
  // (cardSets.js copyKey) so contracts and history can tell them apart, and
  // getCardByKey reads both as the one card.
  for (const h of entrants) {
    if (new Set(h.roster.map(c => c.id)).size !== h.roster.length) throw new Error('dynasty: one card per player');
  }
  const seenKey = {};
  const keyed = entrants.map(h => ({
    ...h,
    keys: h.roster.map(c => {
      const base = cardKey(c);
      seenKey[base] = (seenKey[base] ?? 0) + 1;
      return copyKey(base, seenKey[base]);
    }),
  }));
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
  const rostered = keyed.flatMap(h => h.keys);
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
    const put = (c, key, teamId) => {
      const real = contractFor(cardKey(c));
      contracts[key] = { teamId, dp: real?.dp ?? fairDp(c), years: real?.years ?? years(), since: 1, how: 'brought' };
    };
    for (const h of keyed) h.roster.forEach((c, i) => put(c, h.keys[i], h.id));
  }

  // WHAT THE HUMANS ACTUALLY BROUGHT. An own start lets you field the ten you
  // own on their real contracts with no cap check at the door — the user's own
  // rule, 2026-09-12: come in over the apron and you let people walk or trade
  // them to get under before you can re-sign anyone NEXT season. For a few
  // days (2026-09-14 to 2026-09-17) the AI teams were drafted to what the
  // richest human brought (`entryCap`), so a 301-DP collector's ten faced
  // 166-243-DP opponents. The user ended that on 2026-09-17: "they should not
  // bring in a team over that cap." The AI teams draft to aiCapDp whatever
  // the humans brought; the human's payroll advantage is year one's, and the
  // apron is the reckoning that takes it back. Old saves still carry an
  // `entryCap` field; nothing reads it.

  const d = {
    id,
    version: 3,
    createdAt: Date.now(),
    name: name || `${me.name} Dynasty`,
    startMode,
    iq,
    aiLevel,
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
    // The staff each coach has hired (staff, 2026-09-23), and the one player
    // each has protected from this year's retirement roll.
    staff: {},
    protected: {},
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
    // `real`: this draft signs on REAL contracts (finishDraft), so the AI
    // budgets its picks on those numbers, not on what the cards would ask.
    let x = { ...d, phase: DPHASE.draft, draft: { kind: 'fantasy', real: true, order: snakeOrder(aiIds, FANTASY_ROUNDS), picks: [], pool: board } };
    x = finishDraft(simDraft(x, { rng, all: true }), { rng, real: true });
    // NO SIGNING PERIOD in an own start: everyone, yours and theirs, is
    // already on a contract, so the league opens straight into the preseason.
    x = { ...x, phase: DPHASE.preseason, talks: {} };
    // The preseason is the first turn: the AI may already have an offer for you.
    return aiOfferTurn(say({ ...x, news: [] }, 'The league opens: every team on its real contracts. Start year one when you are ready.'));
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
  const merged = mergeDuplicate(next, key, teamId);
  if (merged) return merged;
  return r.kind === 'expiring' ? say(next, `${cardOf(key)?.name} leaves ${teamOf(d, teamId)?.name} for free agency.`) : next;
}

/** The person a key names, whatever set the card is from and whichever copy it is. */
const personOf = key => baseKey(key).split(':').pop();

/**
 * A SECOND COPY DOES NOT BECOME A FREE AGENT — IT LEAVES.
 *
 * The user, 2026-09-16: "User 1 and User 2 both have Saniya Rivers on their
 * roster. User 1 re-signs Rivers in the off-season and User 2 does not.
 * Instead of the Rivers duplicate going into the free-agency pool, that card
 * is removed."
 *
 * Called the moment a key stops being held (renounce, waive). If any OTHER key
 * for the same person is still under contract or rights anywhere in the
 * league, this one is struck from the league entirely — no free agent, no
 * rights, nothing to sign — and the log says so. If this was the last copy,
 * nothing happens here and the player hits the market as ever. Returns the
 * merged dynasty, or null when there was nothing to merge.
 */
function mergeDuplicate(d, key, teamId) {
  const person = personOf(key);
  const stillHeld = [...Object.keys(d.contracts ?? {}), ...Object.keys(d.rights ?? {})]
    .some(k => k !== key && personOf(k) === person);
  if (!stillHeld) return null;
  const drop = obj => omit(obj ?? {}, key);
  return say({
    ...d,
    league: leagueKeys(d).filter(k => k !== key),
    contracts: drop(d.contracts),
    rights: drop(d.rights),
    traits: drop(d.traits),
    joined: drop(d.joined),
    lastTeam: drop(d.lastTeam),
    spurned: drop(d.spurned),
  }, `${cardOf(key)?.name}'s second card leaves the league — another team already has ${cardOf(key)?.name}.`)
    ;
}

/**
 * Waive a player under contract, in the offseason. His DP goes on the books
 * for the coming season as dead money and he goes ON WAIVERS (below): until
 * the league next moves on, any other team may claim him, and a claim takes
 * his contract as it stands and takes the dead money off the waiving team's
 * books. Unclaimed, the dead money stays and he is a free agent — which is
 * all a waive did until 2026-09-18.
 */
export function waive(d, teamId, key) {
  if (!isOffseason(d)) throw new Error('dynasty: moves are made in the offseason');
  return release(d, teamId, key);
}

/**
 * The waive itself, in any phase. A coach waives in the offseason (waive); a
 * TRADE'S ROSTER RELIEF (tradeRelief, 2026-09-18) waives in season too, up
 * to the deadline, and its man sits on the wire until the next round turns
 * (seasonTurn) exactly as an offseason waive waits for the next phase.
 */
function release(d, teamId, key) {
  const k = d.contracts[key];
  if (!k || k.teamId !== teamId) throw new Error(`dynasty: ${key} is not under contract with ${teamId}`);
  const cut = {
    ...d,
    contracts: omit(d.contracts, key),
    dead: [...(d.dead ?? []), { teamId, key, dp: k.dp, through: d.year }],
    lastTeam: { ...d.lastTeam, [key]: teamId },
    spurned: { ...(d.spurned ?? {}), [key]: teamId },
  };
  // The dead money stays — that was the price of waiving — but a second copy
  // of a player another team still holds does not hit the market, and so is
  // not on waivers either: it leaves the league as it did before waivers.
  const merged = mergeDuplicate(say(cut, `${teamOf(d, teamId)?.name} waived ${cardOf(key)?.name} (${k.dp} DP dead this season).`), key, teamId);
  if (merged) return merged;
  const wire = { key, from: teamId, dp: k.dp, years: k.years, year: d.year, claims: [] };
  return say(
    { ...cut, waivers: [...waiverList(d), wire] },
    `${teamOf(d, teamId)?.name} waived ${cardOf(key)?.name} — on waivers until the league moves on. A claim takes his ${k.dp} DP × ${k.years} off their books; unclaimed, it stays as dead money this season.`,
  );
}

// ── WAIVERS (the user, 2026-09-18) ──────────────────────────────────────────
//
// "If they are claimed, that money would come off the cap." A waived player
// sits ON WAIVERS until the dynasty next moves on — the next phase turn, the
// next day of free agency, or in season the next round — and then the wire
// RESOLVES (resolveWaivers): the teams are asked in waiver priority, the
// worst record of the most recent regular season first (waiverOrder), never
// the team that waived him.
//
//   An AI team claims when his contract fits under its apron (aiApronDp) with
//     a roster spot, and the contract is worth having — contractValue > 0,
//     the same number its trades weigh: underpaid, not overpaid.
//   A HUMAN team claims only if its coach put in a claim during the window
//     (claimWaiver), and only while it fits the human's apron (130) and
//     roster.
//
// The first team that qualifies takes the contract as it stands — the DP and
// the years left — and THE WAIVING TEAM'S DEAD MONEY FOR HIM IS REMOVED.
// Nobody qualifies: the dead money stays and he is a free agent, as before.
// The AI's own deadline sheds (aiSignRookies) go through the wire too, so a
// shed that somebody claims clears the shedding team's books.
//
// d.waivers is `[{ key, from, dp, years, year, claims: [teamId] }]`, oldest
// first. A save from before 2026-09-18 has no list and reads as an empty one.

/** The waiver wire: every player waived since the league last moved on. */
export const waiverList = d => d.waivers ?? [];
/** Whether a player is on waivers right now — not under contract, and not a free agent yet. */
export const onWaivers = (d, key) => waiverList(d).some(w => w.key === key);

/**
 * WAIVER PRIORITY: every team, worst regular-season record first — the most
 * recent season in the history (its table's ranks are the regular season's).
 * Before a season has been played there are no standings, so the order is
 * SEEDED from the dynasty's id (the class seed, keyed 'waivers'): fixed for
 * the whole of year one and the same on every device and on the server.
 */
export function waiverOrder(d) {
  const last = d.history?.[d.history.length - 1];
  const ids = d.teams.map(t => t.id);
  if (last?.table?.length) {
    const ranked = [...last.table].sort((a, b) => b.rank - a.rank).map(r => r.id).filter(id => ids.includes(id));
    return [...ranked, ...ids.filter(id => !ranked.includes(id))];
  }
  return shuffle(ids, classRng(d, 'waivers'));
}

/** Seats a team's roster has taken: its contracts, and for an AI team its unsigned picks, each holding his seat (aiRivalOffers). */
const seatsTaken = (d, teamId) => rosterKeys(d, teamId).length + (teamOf(d, teamId)?.human ? 0 : rightsOf(d, teamId, 'rookie').length);

/** Why `teamId` cannot take this player off waivers right now, or null. */
export function claimProblem(d, teamId, key) {
  const w = waiverList(d).find(x => x.key === key);
  if (!w) return 'that player is not on waivers';
  return fitProblem(d, teamId, w);
}

/** Why `teamId` cannot take the waiver `w` — his seat and his DP on its books — or null. */
function fitProblem(d, teamId, w) {
  if (w.from === teamId) return 'you waived him';
  if (!teamOf(d, teamId)) return 'no such team';
  if (seatsTaken(d, teamId) >= MAX_ROSTER) return `your roster is full at ${MAX_ROSTER} — waive someone first`;
  const apron = apronFor(d, teamId);
  // An AI team keeps the scale of its unsigned picks back, as it does in free agency.
  const booked = payroll(d, teamId) + (teamOf(d, teamId)?.human ? 0 : rookieCommitted(d, teamId));
  if (booked + w.dp > apron) return `his ${w.dp} DP would take you past the ${apron} apron`;
  // An AI team's claim fits its card-salary ceiling too, its unsigned picks
  // counted as their DP is above (aiSalaryCap, the user, 2026-09-18), and a
  // cheap card kept back for each seat still short of eight (seatsHeld).
  const held = rookieSalaryHeld(d, teamId) + seatsHeld(d, teamId, seatsTaken(d, teamId) + 1);
  if (!salaryFits(d, teamId, [w.key], [], held)) return `his $${salaryOf(w.key)} card would take them past the $${aiSalaryCap(d)} salary ceiling`;
  return null;
}

/** A coach's claim on a waived player, standing until the wire resolves. */
export function claimWaiver(d, teamId, key) {
  if (!teamOf(d, teamId)?.human) throw new Error('dynasty: only a coach puts in a claim');
  const problem = claimProblem(d, teamId, key);
  if (problem) throw new Error(`dynasty: ${problem}`);
  return {
    ...d,
    waivers: waiverList(d).map(w => (w.key === key && !w.claims.includes(teamId) ? { ...w, claims: [...w.claims, teamId] } : w)),
  };
}

/** Take a claim back while the window is still open. */
export function withdrawClaim(d, teamId, key) {
  if (!onWaivers(d, key)) throw new Error('dynasty: that player is not on waivers');
  return { ...d, waivers: waiverList(d).map(w => (w.key === key ? { ...w, claims: w.claims.filter(t => t !== teamId) } : w)) };
}

/** Whether `teamId` takes `w` when its turn in the order comes. */
function claims(d, teamId, w) {
  // The wire is emptied as it resolves, so the entry itself is checked.
  if (fitProblem(d, teamId, w)) return false;
  if (teamOf(d, teamId)?.human) return w.claims.includes(teamId);
  return contractValue(cardOf(w.key), { dp: w.dp, years: w.years }) > 0;
}

/**
 * Put the live season's rosters back in step with the contracts for these
 * teams — a claim in season is on the claimant's roster for the next
 * fixture (makeTrade does the same). A season stored with its rosters as
 * keys (a friends league's document, seasonPack.js) keeps them as keys.
 */
function syncSeasonRosters(d, teamIds) {
  if (!d.season?.teams) return d;
  const moved = new Set(teamIds);
  const asKeys = d.season.teams.some(t => typeof t.roster?.[0] === 'string');
  const teams = d.season.teams.map(t => {
    if (!moved.has(t.id)) return t;
    const cards = rosterOf(d, t.id);
    return { ...t, roster: asKeys ? cards.map(cardKey) : cards };
  });
  return { ...d, season: { ...d.season, teams } };
}

/**
 * THE WIRE RESOLVES — oldest waiver first, each against the rosters and
 * payrolls the claims before it left. Run at the start of every step that
 * moves the league on (closeResign, drawLottery, finishDraft, closeRookies,
 * nextFaDay, closeFreeAgency, startSeason, endSeason, a friends week, a
 * season's round — seasonTurn), so a player waived during a step (a
 * deadline shed) waits on the wire for the step after it.
 */
export function resolveWaivers(d) {
  const list = waiverList(d);
  if (!list.length) return d;
  let x = { ...d, waivers: [] };
  const touched = new Set();
  for (const w of list) {
    // Nothing else can take him off the wire, but a hand-edited save could.
    if (x.contracts[w.key] || x.rights?.[w.key] || (x.retired ?? []).includes(w.key)) continue;
    const from = teamOf(x, w.from);
    const taker = waiverOrder(x).filter(id => id !== w.from).find(id => claims(x, id, w));
    const name = cardOf(w.key)?.name;
    if (!taker) {
      x = say(x, `Nobody claimed ${name} — he is a free agent, and his ${w.dp} DP stays on ${from?.name}'s books this season.`);
      continue;
    }
    // His dead money on the waiving team, the one entry THIS waive booked
    // (reviewer, 2026-09-18): the same man can be waived twice in one
    // offseason — unclaimed at 35 DP, back on 1 DP, waived again — and the
    // first match cleared the 35 while the claimant took the 1, so 34 DP left
    // the league. Only the waive on the wire now can be claimed, and its
    // entry is the latest for him at his DP; two at the same DP are the same
    // money whichever goes.
    const at = (x.dead ?? []).findLastIndex(m => m.teamId === w.from && m.key === w.key && m.through === w.year && m.dp === w.dp);
    x = {
      ...x,
      contracts: { ...x.contracts, [w.key]: { teamId: taker, dp: w.dp, years: w.years, since: x.year, how: 'waivers' } },
      dead: at < 0 ? (x.dead ?? []) : x.dead.filter((_, i) => i !== at),
    };
    touched.add(taker);
    x = say(x, `${teamOf(x, taker)?.name} claimed ${name} off waivers — his salary comes off ${from?.name}'s books.`);
  }
  return touched.size ? syncSeasonRosters(x, [...touched]) : x;
}

/**
 * The live season after a result: in season the wire resolves when a ROUND
 * turns (or the regular season gives way to the playoffs), the season's own
 * "the league moves on". Every shell that saves a season into a dynasty goes
 * through this — DynastyTab alone, league.js applyResult with friends.
 */
// ── FRANCHISE POINTS, AND THE DECK ─────────────────────────────────────────
//
// The user (2026-09-18): "I think there should be a way to bring in players
// in your collection that were not there prior to the dynasty starting, at
// some sort of price. Dynasty points perhaps? And maybe dynasty points are
// rewarded for season finish, weighted for difficulty, as well as playoff
// series wins and championships?" — "Yes on your ideas" (built 2026-09-22).
//
// A dynasty's own currency, never coins: EARNED when a year closes (endSeason)
// by the regular-season finish (first of N is FP_FINISH_MAX, last is 0),
// FP_PER_SERIES for each playoff series won and FP_TITLE for the title, all
// times the rung's pay factor (payFactorOf: Prince 1x, King 1.25x, Deity
// 1.5x, the easier rungs less; a rung the table does not know pays 1x) — so a Deity champion of eight banks about 44 a year
// and a Prince fourth-place first-round loser about 6. SPENT in the offseason
// on a card the coach OWNS that is not in the league: its rarity's price
// (FP_IMPORT_COST — a mid-table year buys a rare, a title year a legendary),
// then the player signs at his value (fairDp) for IMPORT_YEARS under the cap.
// AI teams never import. Old saves read `fp` as {}.
export const FP_FINISH_MAX = 10;
export const FP_PER_SERIES = 3;
export const FP_TITLE = 10;
export const FP_IMPORT_COST = { common: 2, uncommon: 4, rare: 8, 'super-rare': 16, legendary: 32 };
export const IMPORT_YEARS = 2;

const nth = n => (n == null ? '?' : `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] ?? 'th'}`);

/** Playoff series a team won this season — every bracket match it is the winner of. */
export function playoffSeriesWins(season, teamId) {
  return (season?.bracket?.matches ?? []).filter(m => m.winner === teamId).length;
}

/** First of N is FP_FINISH_MAX, last is 0, straight between. */
export function fpFinishPoints(rank, n) {
  if (!(rank >= 1) || !(n > 1)) return 0;
  return Math.round(FP_FINISH_MAX * (n - rank) / (n - 1));
}

/** What a finished season earns one team, and why — the number endSeason banks. */
export function fpEarned(d, season, teamId, table = standings(season)) {
  const row = table.find(r => r.id === teamId);
  const n = d.teams.length;
  const finish = fpFinishPoints(row?.rank, n);
  const series = playoffSeriesWins(season, teamId);
  const title = season?.champion === teamId;
  const factor = payFactorOf(d.aiLevel);
  const points = Math.round((finish + FP_PER_SERIES * series + (title ? FP_TITLE : 0)) * factor);
  const parts = [`${nth(row?.rank)} of ${n}`];
  if (series) parts.push(`${series} playoff series won`);
  if (title) parts.push('the title');
  const why = parts.join(', ') + (factor !== 1 ? ` × ${factor} for ${d.aiLevel}` : '');
  return { points, finish, series, title, factor, why };
}

/** A team's Franchise Points in hand. */
export const fpOf = (d, teamId) => Number(d.fp?.[teamId]) || 0;

/** What bringing a card in costs, by its rarity. */
export const importCost = card => FP_IMPORT_COST[getPlayerRarity(card)] ?? FP_IMPORT_COST.legendary;

/** Why a coach cannot bring this card in right now, or null. `owned` is the caller's word (the server checks it). */
export function importProblem(d, teamId, key, { owned = true } = {}) {
  const t = teamOf(d, teamId);
  if (!t?.human) return 'Only a coach brings players in';
  const open = d.phase === DPHASE.signing || d.phase === DPHASE.resign || d.phase === DPHASE.freeAgency || d.phase === DPHASE.preseason;
  if (!open) return 'Players come in during the offseason — after the draft and before the season';
  const card = cardOf(key);
  if (!card) return 'No such card';
  if (!owned) return 'You do not own that card';
  const taken = leagueKeys(d).includes(key) || (d.draftPool ?? []).includes(key) || (d.draftClass?.keys ?? []).includes(key)
    || waiverList(d).some(w => w.key === key) || (d.imports ?? []).some(i => i.key === key);
  if (taken) return `${card.name} is already in this league`;
  if (rosterKeys(d, teamId).length >= MAX_ROSTER) return `Your roster is full (${MAX_ROSTER})`;
  const cost = importCost(card);
  if (fpOf(d, teamId) < cost) return `That takes ${cost} Franchise Points — you have ${fpOf(d, teamId)}`;
  const dp = fairDp(card);
  if (!fitsCap(d, teamId, key, dp)) return `${card.name} signs at ${dp} DP, and that does not fit under the ${CAP_DP} cap`;
  return null;
}

/** The coach's owned cards not in the league, best first, each with its price and what stops it. */
export function importCandidates(d, teamId, collection) {
  const inLeague = new Set([...leagueKeys(d), ...(d.draftPool ?? []), ...(d.draftClass?.keys ?? []), ...waiverList(d).map(w => w.key)]);
  return Object.entries(collection ?? {})
    .filter(([key, v]) => (v?.count ?? 0) > 0 && !inLeague.has(key))
    .map(([key]) => ({ key, card: cardOf(key) }))
    .filter(({ card }) => card)
    .map(({ key, card }) => ({ key, card, cost: importCost(card), dp: fairDp(card), problem: importProblem(d, teamId, key) }))
    .sort((a, b) => (b.card.salary ?? 0) - (a.card.salary ?? 0) || a.card.name.localeCompare(b.card.name));
}

/** Bring an owned card into the league on the coach's roster: the points spent, the player signed at his value. */
export function importCard(d, teamId, key, opts = {}) {
  const problem = importProblem(d, teamId, key, opts);
  if (problem) throw new Error(`dynasty: ${problem}`);
  const card = cardOf(key);
  const cost = importCost(card);
  const dp = fairDp(card);
  let x = {
    ...d,
    league: [...leagueKeys(d), key],
    fp: { ...(d.fp ?? {}), [teamId]: fpOf(d, teamId) - cost },
    imports: [...(d.imports ?? []), { year: d.year, teamId, key, cost, dp }],
  };
  x = sign(x, teamId, key, { dp, years: IMPORT_YEARS, how: 'imported' });
  return say(x, `${teamOf(d, teamId)?.name} bring in ${card.name} from their collection — ${cost} Franchise Points, ${dp} DP × ${IMPORT_YEARS}.`);
}

// ── Staff (the user, 2026-09-23) ────────────────────────────────────────────
//
// "I'm thinking something like the way dynasty points are used for support
// staff in College Football 27." Three roles, three tiers each, bought with
// FRANCHISE POINTS in order and kept for the dynasty — the three the user
// liked of the five drafted (docs/plans/2026-09-23-dynasty-staff-design.md);
// the on-court and front-office roles wait on him. Priced 3 / 6 / 12 against
// imports at 2–32, so a full role costs a legendary and nobody staffs
// everything. AI teams hire nobody: the rung's cap is their edge. Old saves
// read `staff` and `protected` as {}.
export const STAFF_ROLES = {
  scout: {
    name: 'Head Scout',
    tiers: [
      { name: 'Scouting Department', cost: 3, blurb: 'The class is graded before the lottery, and the AI\'s board shows as a mock draft.' },
      { name: 'Ping-Pong Balls', cost: 6, blurb: 'Your lottery weight is +25%.' },
      { name: 'Second-Round Steal', cost: 12, blurb: 'Once a draft, after the last pick, take one player nobody drafted.' },
    ],
  },
  cap: {
    name: 'Cap Strategist',
    tiers: [
      { name: 'Read the Room', cost: 3, blurb: 'Every free agent\'s personality and floor show before you haggle.' },
      { name: 'Hometown Discount', cost: 6, blurb: 'Your own expiring players re-sign 10% under their ask.' },
      { name: 'Luxury Apron', cost: 12, blurb: 'Your apron rises 115 to 125 DP.' },
    ],
  },
  science: {
    name: 'Sports Science',
    aging: true,
    tiers: [
      { name: 'Load Management', cost: 3, blurb: 'Your players\' retirement risk starts a year later.' },
      { name: 'Prime Extension', cost: 6, blurb: 'Name one player a season: he skips that year\'s retirement roll.' },
      { name: 'Fountain of Youth', cost: 12, blurb: 'The whole retirement window shifts two years for your team.' },
    ],
  },
};
export const STAFF_ORDER = ['scout', 'cap', 'science'];
export const LOTTERY_BOOST = 1.25;
export const HOMETOWN_DISCOUNT = 0.9;
export const LUXURY_APRON = 10;

/** A team's tier in a role, 0 to 3. */
export const staffTier = (d, teamId, role) => Number(d.staff?.[teamId]?.[role]) || 0;
/** Every role's tier for a team. */
export const staffOf = (d, teamId) => Object.fromEntries(STAFF_ORDER.map(r => [r, staffTier(d, teamId, r)]));

/** Why a coach cannot hire the next tier of this role now, or null. */
export function hireProblem(d, teamId, role) {
  if (!teamOf(d, teamId)?.human) return 'Only a coach hires staff';
  const spec = STAFF_ROLES[role];
  if (!spec) return 'No such role';
  if (spec.aging && !d.aging) return `${spec.name} needs an aging dynasty — nobody retires in a ten-year one`;
  if (d.phase === DPHASE.done) return 'The dynasty is over';
  const tier = staffTier(d, teamId, role);
  if (tier >= spec.tiers.length) return `${spec.name} is fully staffed`;
  const cost = spec.tiers[tier].cost;
  if (fpOf(d, teamId) < cost) return `That takes ${cost} Franchise Points — you have ${fpOf(d, teamId)}`;
  return null;
}

/** Hire the next tier of a role: the points spent, the perk in effect from now on. */
export function hireStaff(d, teamId, role) {
  const problem = hireProblem(d, teamId, role);
  if (problem) throw new Error(`dynasty: ${problem}`);
  const spec = STAFF_ROLES[role];
  const tier = staffTier(d, teamId, role);
  const next = spec.tiers[tier];
  const x = {
    ...d,
    fp: { ...(d.fp ?? {}), [teamId]: fpOf(d, teamId) - next.cost },
    staff: { ...(d.staff ?? {}), [teamId]: { ...(d.staff?.[teamId] ?? {}), [role]: tier + 1 } },
    hires: [...(d.hires ?? []), { year: d.year, teamId, role, tier: tier + 1, cost: next.cost }],
  };
  return say(x, `${teamOf(d, teamId)?.name} hire ${next.name} — ${spec.name}, tier ${tier + 1}, ${next.cost} Franchise Points.`);
}

/** A coach's apron: the fixed number, ten more with a Luxury Apron; the AI's at its rung. */
export const apronOf = (d, teamId) => (teamOf(d, teamId)?.human
  ? APRON_DP + (staffTier(d, teamId, 'cap') >= 3 ? LUXURY_APRON : 0)
  : aiApronDp(d));

/** Hometown Discount: a coach's own expiring player, with a tier-2 Cap Strategist. */
export const discountFor = (d, teamId, key) => {
  const r = d.rights?.[key];
  return r?.kind === 'expiring' && r.teamId === teamId && staffTier(d, teamId, 'cap') >= 2 ? HOMETOWN_DISCOUNT : 1;
};

/** How many years later a team's players' retirement risk starts (Sports Science). */
export const retireShift = (d, teamId) => {
  if (!teamId) return 0;
  const tier = staffTier(d, teamId, 'science');
  return tier >= 3 ? 2 : tier >= 1 ? 1 : 0;
};

/** Why a coach cannot protect this player from the year's retirement roll, or null. */
export function protectProblem(d, teamId, key) {
  if (!teamOf(d, teamId)?.human) return 'Only a coach protects a player';
  if (!d.aging) return 'Nobody retires in a ten-year dynasty';
  if (staffTier(d, teamId, 'science') < 2) return 'Prime Extension takes Sports Science at tier 2';
  if (d.phase === DPHASE.done) return 'The dynasty is over';
  const mine = d.contracts?.[key]?.teamId === teamId || d.rights?.[key]?.teamId === teamId;
  if (!mine) return 'He is not yours';
  return null;
}

/** Name the one player who skips this year's retirement roll. Replaceable until the year turns. */
export function protectPlayer(d, teamId, key) {
  const problem = protectProblem(d, teamId, key);
  if (problem) throw new Error(`dynasty: ${problem}`);
  const x = { ...d, protected: { ...(d.protected ?? {}), [teamId]: key } };
  return say(x, `${teamOf(d, teamId)?.name} protect ${cardOf(key)?.name} — no retirement roll at the turn of this year.`);
}

/** Why a coach cannot steal this undrafted player after the last pick, or null. */
export function stealProblem(d, teamId, key) {
  if (!teamOf(d, teamId)?.human) return 'Only a coach steals a pick';
  if (staffTier(d, teamId, 'scout') < 3) return 'Second-Round Steal takes a Head Scout at tier 3';
  if (d.phase !== DPHASE.rookieDraft || !d.draft || d.draft.kind === 'fantasy') return 'The steal comes at the end of a rookie draft';
  if (!draftDone(d)) return 'Wait for the last pick';
  if (d.draft.stolen?.[teamId]) return 'One steal a draft';
  if (!draftAvailable(d).includes(key)) return 'He was drafted';
  if (rosterKeys(d, teamId).length + rightsOf(d, teamId).length >= MAX_ROSTER) return `Your roster is full (${MAX_ROSTER})`;
  return null;
}

/** Take one undrafted player after the last pick — a rookie's rights at the last slot's scale. */
export function stealPick(d, teamId, key) {
  const problem = stealProblem(d, teamId, key);
  if (problem) throw new Error(`dynasty: ${problem}`);
  const dr = d.draft;
  const n = dr.picks.length + 1;
  const x = {
    ...d,
    draft: { ...dr, picks: [...dr.picks, { n, round: ROOKIE_ROUNDS, teamId, key, steal: true }], stolen: { ...(dr.stolen ?? {}), [teamId]: key } },
    rights: { ...d.rights, [key]: { teamId, kind: 'rookie', pick: dr.order.length } },
    league: [...leagueKeys(d), key],
    joined: { ...(d.joined ?? {}), [key]: d.year },
  };
  return say(x, `${teamOf(d, teamId)?.name} steal ${cardOf(key)?.name} after the last pick — the Head Scout's find.`);
}

/**
 * THE DECK IS NEVER FROZEN (the user, 2026-09-18: "Strategy decks chosen for
 * dynasty games should not be frozen at the start of the dynasty the way that
 * players are"). A coach's fifty changes whenever they like — the offseason
 * screens and the season dashboard both call this — on the team and, when a
 * season is live, on the season's copy the fixtures read. A null deck is the
 * default fifty. The server cleans the deck itself before it gets here.
 */
export function setTeamDeck(d, teamId, deck, deckName = null) {
  const clean = deck && typeof deck === 'object' ? deck : null;
  const name = clean ? (String(deckName ?? '').slice(0, 40) || null) : null;
  const put = t => (t.id === teamId ? { ...t, deck: clean, deckName: name } : t);
  return { ...d, teams: d.teams.map(put), season: d.season ? { ...d.season, teams: d.season.teams.map(put) } : d.season };
}

export function seasonTurn(d, season) {
  const before = d.season;
  const next = { ...d, season };
  const turned = !before || before.round !== season?.round || before.phase !== season?.phase;
  if (!turned) return next;
  // A round turning is a turn for the AI's offers too (2026-09-18): the
  // open ones lapse and, up to the deadline, new ones are made.
  return aiOfferTurn(waiverList(next).length ? resolveWaivers(next) : next);
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
    if (onWaivers(d, key)) throw new Error('dynasty: that player is on waivers — put in a claim instead');
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
  // Hometown Discount: the player weighs the coach's offer as if it were 10%
  // bigger; the deal signs at what was actually offered.
  const discount = discountFor(d, teamId, key);
  const verdict = judgeOffer({
    card: cardOf(key), pid, ctx: ctxFor(d, key, teamId), offer: { dp: Math.round(dp / discount), years },
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

/**
 * THE RIGHTS WINDOW (the user, 2026-09-17). A drafted player is his team's
 * RIGHTS from the pick until the preseason closes, and signs at the scale at
 * any point in the signing, re-signing, free-agency and preseason phases while
 * he fits under the team's apron. Nothing renounces a pick at the draft;
 * whatever is still unsigned lapses once, when the season starts.
 */
const RIGHTS_WINDOW = new Set([DPHASE.rookies, DPHASE.signing, DPHASE.resign, DPHASE.freeAgency, DPHASE.preseason]);

/**
 * A SHORT-HANDED AI TEAM DRAFTS AND SIGNS PAST ITS APRON (2026-09-18). An AI
 * team whose roster — `held`: its contracts, plus the rights it holds when
 * it is drafting — is below MIN_ROSTER cannot take the floor, and fillRoster
 * already signs "anyone at all rather than a team that cannot take the
 * floor", past the apron if it must. Before this, the draft passed that very
 * team's picks for money and then fillRoster brought in a free agent over the
 * apron anyway: a verifier's own-start run found 55 passes from teams below
 * the floor, and all nine AI team-seasons that tipped off over the apron came
 * from them (ORL, seed 7, passed picks 1 and 9 and signed two free agents to
 * 126 DP). A pick on the rookie scale — 2 to 10 DP — is the better and
 * usually the cheaper way to fill that seat. The user asked that "teams
 * drafting that player need a chance to sign him". A human team gets no such
 * exception: the human's apron is their own hard line (the user, 2026-09-17),
 * and a human short of the floor fills it themselves.
 *
 * It is fillRoster's exception exactly, so it opens only where fillRoster's
 * would: when `room` under the apron cannot fill the seats still short even
 * on minimum deals. A team of seven with seven DP of room fills its eighth
 * seat on a 1-DP deal and stays under the apron — the user: AI teams "should
 * not bring in a team over that cap" — rather than draft an 8-DP pick past
 * it (the first probe of this rule tipped two teams off at 116).
 */
const shortHanded = (d, teamId, held, room) => !teamOf(d, teamId)?.human && held < MIN_ROSTER
  && room < (MIN_ROSTER - held) * MIN_DP;

/** Why a team cannot sign its pick right now, or null. */
export function rookieProblem(d, teamId, key) {
  const r = d.rights?.[key];
  if (!r || r.kind !== 'rookie' || r.teamId !== teamId) return 'that is not your pick';
  if (!RIGHTS_WINDOW.has(d.phase)) return 'picks are signed between the draft and the season';
  const size = rosterKeys(d, teamId).length;
  if (size >= MAX_ROSTER) return `your roster is full at ${MAX_ROSTER} — waive someone first`;
  const apron = apronFor(d, teamId);
  const { dp } = rookieTerms(d, key);
  // Signing, the seat he fills is one of the contracts short of the floor —
  // the pick itself is not counted, so a team of six at its apron signs two
  // picks past it.
  const room = apron - payroll(d, teamId);
  if (dp > room && !shortHanded(d, teamId, size, room)) return `their ${dp} DP would take you past the ${apron} apron`;
  // An AI team's pick also fits its card-salary ceiling (aiSalaryCap,
  // 2026-09-18) — short-handed or not: a seat the ceiling will not pay for
  // is the fill's, at the cheap end. Never a coach's (salaryFits). A team
  // still short of eight once he signs keeps a cheap card's room for each
  // seat left (seatsHeld, 2026-09-19), or the fill signs past the ceiling.
  // Its other unsigned picks count as seats — the draft kept their cards'
  // room (aiDraftChoice) — so two picks into a five-man roster keep $150.
  const seatsAfter = size + rightsOf(d, teamId, 'rookie').length;
  if (!salaryFits(d, teamId, [key], [], seatsHeld(d, teamId, seatsAfter))) return `his $${salaryOf(key)} card would take them past the $${aiSalaryCap(d)} salary ceiling`;
  return null;
}

/** Sign your draft pick at the rookie scale, any time in the rights window. */
export function signRookie(d, teamId, key) {
  const problem = rookieProblem(d, teamId, key);
  if (problem) throw new Error(`dynasty: ${problem}`);
  return sign(d, teamId, key, { ...rookieTerms(d, key), how: 'rookie' });
}

/**
 * The man an AI team sheds for a pick: the one whose loss costs it least
 * TALENT, the contract worth least over its years (contractValue) only
 * breaking a tie. Until 2026-09-18 it was the worst-value contract alone, and
 * the pick was weighed against HIM — usually an overpaid star, not the
 * weakest player — so a full lottery team with money passed a first-overall
 * super-rare (talent 75.8) while carrying a 4.7-talent player, because its
 * worst-value deal was a 128-talent star (a verifier's fantasy start, seed 6,
 * year 2). The shed buys a seat, never money (waive keeps the DP this season
 * as dead money), so the seat to give up is the weakest man's.
 */
function shedCandidate(d, teamId) {
  return weakestOf(d, rosterKeys(d, teamId));
}

/** The weakest of these players: the least talent, then the worst contract. A trade's roster relief waives him too (tradeRelief). */
function weakestOf(d, keys) {
  if (!keys.length) return null;
  const talent = k => talentValue(cardOf(k));
  const value = k => contractValue(cardOf(k), d.contracts[k]);
  return keys.reduce((w, k) => (talent(k) < talent(w) || (talent(k) === talent(w) && value(k) < value(w)) ? k : w));
}

/**
 * THE AI SIGNS ITS PICKS WHENEVER THEY FIT (the user, 2026-09-17: "AI rookie
 * signing happens whenever it fits during the window, not only at
 * finishDraft"). Run at every turn of the window — the draft's close, each
 * week of free agency, its close, and the season's start. Best pick first, so
 * the room goes to the better player. At the `deadline` an AI team that drafted
 * a player it could only sign after SHEDDING ONE CONTRACT sheds it: it waives
 * its weakest man (shedCandidate; dead money as waive books it) when the
 * pick's talent beats his, and otherwise lets the pick lapse.
 */
function aiSignRookies(d, { deadline = false } = {}) {
  let x = d;
  for (const team of d.teams.filter(t => !t.human)) {
    const held = rightsOf(x, team.id, 'rookie').sort((a, b) => talentValue(cardOf(b)) - talentValue(cardOf(a)));
    // ONE contract a team, the user's word — a second pick that needs a shed lapses.
    let shedOne = false;
    for (const key of held) {
      if (!rookieProblem(x, team.id, key)) { x = sign(x, team.id, key, { ...rookieTerms(x, key), how: 'rookie' }); continue; }
      if (!deadline || shedOne) continue;
      // Waived as waive books it: the DP stays this season as dead money, so
      // what a shed buys is the ROSTER SPOT — it never makes money room. (He
      // goes on waivers, 2026-09-18, and a claim clears the dead money after
      // the fact; the decision here cannot count on one.) So
      // only the full roster's refusal is answered with a shed (a verifier,
      // 2026-09-18): a team of eight refused for money used to waive down to
      // seven, and seven is short-handed, so the pick then signed past the
      // apron — a team that could take the floor waived a 20-DP starter and
      // tipped off at 125 against a 115 apron. The user: AI teams "should not
      // bring in a team over that cap".
      if (rosterKeys(x, team.id).length < MAX_ROSTER) continue;
      const worst = shedCandidate(x, team.id);
      if (!worst || talentValue(cardOf(key)) <= talentValue(cardOf(worst))) continue;
      const shed = waive(x, team.id, worst);
      if (rookieProblem(shed, team.id, key)) continue;
      x = sign(shed, team.id, key, { ...rookieTerms(shed, key), how: 'rookie' });
      shedOne = true;
    }
  }
  return x;
}

/** The deadline: every pick still unsigned, on any team, lapses to free agency. */
function lapseRookies(d) {
  let x = d;
  for (const team of d.teams) {
    for (const key of rightsOf(x, team.id, 'rookie')) {
      x = say(renounce(x, team.id, key), `${team.name}'s rights to ${cardOf(key)?.name} lapse unsigned — he is a free agent.`);
    }
  }
  return x;
}

/**
 * Fill a roster to `min` with the cheapest free agents — the AI teams' floor,
 * and the human's one-click answer to a short roster. Cheapest first, the
 * better player on a tie, under the team's cap if possible, its apron if not
 * (the human's 130, the AI's 115 at the rung), and anyone at all rather than
 * a team that cannot take the floor — one of the two ways past the apron, the
 * other being a short-handed AI team signing its own picks (shortHanded,
 * 2026-09-18), which runs first so a pick takes the seat before a free agent.
 */
export function fillRoster(d, teamId, min = MIN_ROSTER) {
  let x = d;
  const cap = capFor(d, teamId);
  const apron = apronFor(d, teamId);
  for (let guard = 0; guard < MAX_ROSTER; guard += 1) {
    if (rosterKeys(x, teamId).length >= min) break;
    const day = marketDay(x);
    const priced = keys => keys
      .map(key => ({ key, dp: floorOf(x, key, teamId, preferredYears(traitOf(x, key)), day) }))
      .sort((a, b) => a.dp - b.dp || salaryOf(b.key) - salaryOf(a.key));
    const pay = payroll(x, teamId);
    // An AI team's fill fits its card-salary ceiling as well as its books
    // (aiSalaryCap, 2026-09-18); a coach's always does (salaryFits).
    // First with a cheap card's room kept for each seat after this one
    // (seatsHeld, 2026-09-19): the fill is cheapest by DP, and a $400 card on
    // the cheapest deal could leave the eighth seat nothing under the ceiling.
    const later = seatsHeld(x, teamId, rosterKeys(x, teamId).length + 1);
    const fits = (o, limit, held = later) => pay + o.dp <= limit && salaryFits(x, teamId, [o.key], [], held);
    const tiers = (list, held) => list.find(o => fits(o, cap, held)) ?? list.find(o => fits(o, apron, held)) ?? null;
    const free = priced(freeAgentKeys(x));
    // CAMP INVITES: when no free agent fits under the apron — an own-team
    // start opens with no free agents at all — the cheapest players waiting
    // in the draft pool come in on minimum-length deals. My call, 2026-09-11.
    let choice = tiers(free, later);
    let invite = false;
    let camp = [];
    if (!choice) {
      // Never a member of the class drawn for the next draft (d.draftClass,
      // 2026-09-17) — the class is the lottery's, not camp's. Stored first,
      // so an older save's class cannot reshuffle when camp takes a player.
      x = withClass(x);
      const drawn = new Set(x.draftClass.keys);
      camp = priced((x.draftPool ?? []).filter(k => !drawn.has(k)));
      choice = tiers(camp, later);
      invite = Boolean(choice);
      // Nothing leaves the seats after it their room: the tiers as they
      // were, free agents first, before the floor's last resorts below.
      if (!choice && later) {
        choice = tiers(free, 0);
        if (!choice) { choice = tiers(camp, 0); invite = Boolean(choice); }
      }
    }
    // THE FLOOR BEATS THE LIMITS. An AI team nothing fits for still takes the
    // floor: on the cheapest DEAL whose card fits its salary ceiling (past
    // the apron, fillRoster's old last resort), else — the ceiling and the
    // floor colliding (2026-09-18) — on the CHEAPEST CARD there is, free agent
    // or camp, so it ends as little past the ceiling as it can. That is the
    // one way an AI team ends a step above its ceiling, and it is rare (the
    // phase-3 measure). A coach keeps the old last resort: the cheapest deal.
    if (!choice && !teamOf(x, teamId)?.human) {
      const all = [...free, ...camp];
      choice = all.filter(o => salaryFits(x, teamId, [o.key])).sort((a, b) => a.dp - b.dp || salaryOf(a.key) - salaryOf(b.key))[0]
        ?? [...all].sort((a, b) => salaryOf(a.key) - salaryOf(b.key) || a.dp - b.dp)[0]
        ?? null;
      invite = Boolean(choice) && !free.includes(choice);
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
 * leaves room for the spots after it. A rookie draft takes the best player
 * IT CAN SIGN, or null to pass. A little chance in both, so two drafts are
 * not the same draft.
 */
export function aiDraftChoice(d, teamId, rng = Math.random, { iq = 1 } = {}) {
  const avail = draftAvailable(d).filter(k => cardOf(k));
  if (!avail.length) return null;
  // Everyone he would play with: the roster and the picks already made.
  const mine = [...rosterKeys(d, teamId), ...rightsOf(d, teamId)];
  const score = k => talentValue(cardOf(k)) * needFactor(mine, cardOf(k));
  if (d.draft.kind !== 'fantasy') {
    // THE AI DRAFTS WHAT IT CAN SIGN (the user, 2026-09-17). This slot's
    // scale has to fit under the team's apron with its payroll and the scale
    // of the picks it already holds, and there has to be a roster spot once
    // those picks are counted. Among the players who fit — every player costs
    // the same at a slot, so either they all do or none does — the best is
    // talent for the roster's need, the top two at 65/35.
    const teams = d.teams.length;
    const clock = onClock(d);
    const { dp } = rookieScale(clock?.n ?? 1, teams);
    const room = apronFor(d, teamId) - payroll(d, teamId) - rookieCommitted(d, teamId);
    const spots = MAX_ROSTER - mine.length;
    const best = [...avail].sort((a, b) => score(b) - score(a));
    // An AI team below the floor with its picks counted, and no room to fill
    // those seats under the apron, drafts whatever the money says
    // (shortHanded, 2026-09-18): the seat has to be filled, and a scale pick
    // fills it better and cheaper than the free agent fillRoster would
    // otherwise sign past the apron.
    const fits = dp <= room || shortHanded(d, teamId, mine.length, room);
    // A waive leaves its DP on this season's books as dead money, so no shed
    // makes money room: a slot that does not fit the books is passed.
    if (!fits) return null;
    // AND ONLY A PLAYER ITS CARD-SALARY CEILING HAS ROOM FOR (aiSalaryCap,
    // the user, 2026-09-18), beside the picks it already holds: the slot
    // costs every player the same DP, but not the same card salary, so here
    // the players differ. None fits: the pick is passed, as for money. A
    // coach's side is never bound (salaryFits).
    // Held back too: a cheap card for each seat still short of eight once
    // this pick is counted (seatsHeld, 2026-09-19), as rookieProblem will
    // hold it when he signs — else the AI drafts a man it cannot sign.
    const held = rookieSalaryHeld(d, teamId) + seatsHeld(d, teamId, mine.length + 1);
    const signable = best.filter(k => salaryFits(d, teamId, [k], [], held));
    if (spots > 0) return signable.length ? pickWeighted(signable.slice(0, 2), [0.65, 0.35], rng) : null;
    // The books fit but the roster is full: the FULL ROSTER'S way to a pick.
    // It takes the best player when shedding ONE contract frees the seat —
    // its weakest man (shedCandidate), waived as aiSignRookies will waive him
    // at the deadline — and only for a player better than that man. Weighed
    // against the worst-value contract until 2026-09-18, which passed
    // first-overall picks for the sake of 4-talent benchwarmers.
    if (spots + 1 <= 0) return null;
    const worst = teamOf(d, teamId)?.human ? null : shedCandidate(d, teamId);
    // The shed takes his card salary off the roster, so the ceiling is read without him.
    const top = worst ? best.find(k => salaryFits(d, teamId, [k], [worst], held)) : null;
    if (!top || talentValue(cardOf(top)) <= talentValue(cardOf(worst))) return null;
    return top;
  }
  // A FANTASY DRAFT IS DRAFTED TO A CAP (the user, 2026-09-11: "drafting to
  // make a team that fits in the salary cap, not just grabbing the best
  // player"). Every pick has to be signed, so this pick's budget is the cap,
  // less what the picks so far will cost, less room kept for free agency,
  // less what the rest of the roster costs filled as cheaply as it could be;
  // and of those that fit, the best is the one the ROSTER needs — guards,
  // wings and bigs in proportion.
  // THE NUMBER HE WILL SIGN AT. A draft that signs on real contracts (an
  // own-team start, `draft.real`) budgets on the real deal, and only a card
  // with no current NBA deal on what it would ask — the same fallback
  // finishDraft signs him at. Any other draft prices the card.
  const real = Boolean(d.draft.real);
  const floor = k => floorOf(d, k, teamId, undefined, 1);
  const cost = k => (real ? contractFor(k)?.dp : null) ?? floor(k);
  const committed = rightsOf(d, teamId, 'draft').reduce((t, k) => t + cost(k), 0);
  const picksLeft = d.draft.order.slice(d.draft.picks.length).filter(t => t === teamId).length;
  const reserve = avail.map(cost).sort((a, b) => a - b).slice(0, Math.max(0, picksLeft - 1))
    .reduce((t, f) => t + Math.max(f, AI_RESERVE_PER_SPOT), 0);
  // The cap this draft is played to is the AI's cap at the league's rung —
  // WHATEVER THE HUMANS BROUGHT (the user, 2026-09-17: "they should not bring
  // in a team over that cap"). A richer league's AI teams draft to a richer
  // budget — the rung's cap multiplier on the DP cap. Better players, the
  // same rules. Room for free agency is kept back only when there is a
  // free agency to bid in: an own start has no signing period and no
  // year-one market, so the AI spends the cap on the ten it drafts.
  const cap = aiCapDp(d);
  const budget = cap - (real ? 0 : AI_FA_ROOM) - payroll(d, teamId) - committed - reserve;
  // AND TO THE CARD-SALARY CEILING (the user, 2026-09-18: "AI rosters must
  // ALSO fit a card-salary cap … on every AI path: draft"). The same shape
  // as the DP budget: the ceiling, less the cards on the roster and the ones
  // drafted so far, less a price held back for each pick after this one. That
  // price is NOT the cheapest card on the board: every team fills its last
  // seats from the cheap end at once, and the first build of this, holding
  // back the very cheapest, left its last two picks $230-250 with $180 of
  // room (own start, seed 2). So it is the card at the rank the whole draft
  // still has to make — cards that cheap will still be there — but never
  // more than an even tenth of the ceiling, or a small pool (fantasy-random)
  // would hold back everything. A coach is never bound by it — the pick the
  // AI makes for a coach whose clock ran out (dynastyFriends runDraftClock)
  // drafts to DP alone.
  const human = Boolean(teamOf(d, teamId)?.human);
  let salBudget = Infinity;
  if (!human) {
    const cheap = avail.map(salaryOf).sort((a, b) => a - b);
    const remaining = d.draft.order.length - d.draft.picks.length;
    const perSpot = Math.min(cheap[Math.min(remaining, cheap.length) - 1] ?? 0, Math.round(aiSalaryCap(d) / MAX_ROSTER));
    salBudget = aiSalaryCap(d) - aiSalaryOf(d, teamId) - salaryOfKeys(rightsOf(d, teamId, 'draft'))
      - Math.max(0, picksLeft - 1) * perSpot;
  }
  const affordable = avail.filter(k => cost(k) <= budget && salaryOf(k) <= salBudget);
  // Nothing fits both: every fantasy pick has to be made, so the cheapest
  // deal — for an AI team among the cards the ceiling still has room for
  // first, else the cheapest card (a draftee it cannot sign under the
  // ceiling walks at finishDraft). A coach's clock-run-out pick: the cheapest deal, as ever.
  if (!affordable.length) {
    if (human) return [...avail].sort((a, b) => cost(a) - cost(b))[0];
    const room = k => (salaryOf(k) <= salBudget ? 0 : 1);
    return [...avail].sort((a, b) => room(a) - room(b) || (room(a) ? salaryOf(a) - salaryOf(b) : cost(a) - cost(b)))[0];
  }
  // THE POSITIONAL FLOOR, the money reserve's twin (2026-09-17): a ten is
  // not left without two guards, two forwards and a centre. Once the picks
  // left are no more than the spots those floors still need, this pick comes
  // from a group that is short. needFactor below only LEANS the ranking, and
  // a ranking that pays for talent (it does now) out-leans it — one seed
  // fielded a single forward.
  const have = g => mine.filter(k => groupOf(k) === g).length;
  const shortGroups = Object.keys(POS_FLOOR).filter(g => have(g) < POS_FLOOR[g]);
  const stillNeed = shortGroups.reduce((t, g) => t + POS_FLOOR[g] - have(g), 0);
  const floored = stillNeed >= picksLeft ? affordable.filter(k => shortGroups.includes(groupOf(k))) : [];
  const fits = floored.length ? floored : affordable;

  // THE DIFFICULTY RUNG DRAFTS THE TEAM. Settler takes anything it can pay
  // for; Deity drafts on the three things below. `iq` is the chance of doing
  // the considered thing, the same dial misplays() turns everywhere else — and
  // this is the lever with range, because the ladder's four existing ones are
  // worth about seven points between them while the roster is worth forty
  // (scripts/analysis/runRosterGap.js).
  if (iq < 1 && rng() >= iq) return fits[Math.floor(rng() * fits.length)];

  // ── 1. WHAT HE IS WORTH OVER THE MAN THE MONEY WOULD OTHERWISE BUY ──────
  // talentValue is fairDp convexed — how good the card IS — and cost() is
  // what he signs for, and the two are not the same number on a real
  // contract: Victor Wembanyama is the best card in the set and costs eleven
  // of a hundred on his rookie deal, where Jokic, Curry and Embiid all sit at
  // the 35-DP ceiling. The price is charged ONCE, by the affordability below.
  // Until 2026-09-17 it was charged twice — talent per DP here, then the
  // share over the price again — and the moment the draft was priced on real
  // contracts the AI took ten rookie deals and left two-thirds of its cap
  // unspent (payrolls of 22-41 DP, rosters worth ~110 by fairDp). Priced
  // once, the same draft spends 94-100 and fields ~150 with a best five of
  // ~90 — bargains first, then stars with the room they leave, then fillers.
  const talent = k => talentValue(cardOf(k));
  const repl = Math.min(...fits.map(talent));
  const over = k => talent(k) - repl;

  // ── 2. DP REMAINING, SPREAD OVER THE SPOTS LEFT ──────────────────────────
  // What is actually on offer is `budget` across `picksLeft` spots, so a
  // pick near its share is neither hoarding nor starving the rest. Cards
  // under the share are not punished — a bargain IS the point — but a pick
  // that eats several spots' worth has to be worth several spots. Above the
  // share this is talent over price, and talent is convex, so of two dear
  // players the better one wins; a pick that costs the share is judged on
  // talent alone, so a bargain star beats a full-price one.
  const share = Math.max(1, budget / Math.max(1, picksLeft));
  const affordability = k => (cost(k) <= share ? 1 : share / cost(k));

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

  const rank = k => over(k)
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
    const key = aiDraftChoice(x, clock.teamId, rng, { iq: level });
    // A rookie pick nobody on the books can sign is passed (aiDraftChoice).
    x = key == null ? passPick(x, clock.teamId) : draftPick(x, clock.teamId, key);
  }
  return x;
}

export const draftDone = d => !onClock(d);

/**
 * Close a finished draft. The fantasy draft goes to signing — the AI signs its
 * draftees where it can — and the rookie draft to signing picks.
 */
export function finishDraft(d0, { rng = Math.random, real = Boolean(d0.draft?.real) } = {}) {
  if (!draftDone(d0)) throw new Error('dynasty: the draft is not over');
  // The league moves on: whoever was waived during the draft is resolved first.
  const d = resolveWaivers(d0);
  const record = { kind: d.draft.kind, picks: d.draft.picks, origin: d.draft.origin ?? null };
  // Nobody took them: the fantasy draft's leftovers are shuffled into the draft
  // pool, an offseason class's go back on the end of it. Neither is a free agent.
  const undrafted = draftAvailable(d);
  if (d.draft.kind === 'fantasy') {
    let x = { ...d, draft: record, phase: DPHASE.signing, talks: {}, draftPool: shuffle([...(d.draftPool ?? []), ...undrafted], rng) };
    for (const team of x.teams.filter(t => !t.human)) {
      for (const key of rightsOf(x, team.id, 'draft')) {
        // `real`: an own-team start, where the AI's teams arrive on real
        // contracts exactly as the coach's does — no negotiation, and every
        // spot filled, but NEVER past the AI's cap (the user, 2026-09-17:
        // "they should not bring in a team over that cap"). A draftee who
        // would take the team over it walks, and the roster is filled from
        // the cheap end at the season's start. Only the coach's own ten may
        // arrive over the cap — that is the reckoning the first offseason
        // sets THEM (the user, 2026-09-12).
        const deal = real ? contractFor(key) : null;
        const years = deal?.years ?? preferredYears(traitOf(x, key));
        const dp = deal?.dp ?? floorOf(x, key, team.id, years, 1);
        // ...nor past its card-salary ceiling (aiSalaryCap, the user,
        // 2026-09-18): the own start's AI teams arrived on real contracts at
        // ~$8,800 of card salary against the coach's $5,500 ten.
        const fits = salaryFits(x, team.id, [key]) && (real
          ? payroll(x, team.id) + dp <= aiCapDp(x)
          : rosterKeys(x, team.id).length < MAX_ROSTER - AI_OPEN_SPOTS && payroll(x, team.id) + dp <= aiCapDp(x));
        x = fits ? sign(x, team.id, key, { dp, years, how: real ? 'brought' : 'draft' }) : renounce(x, team.id, key);
      }
    }
    // Year two's class is drawn now, from the pool with the leftovers in it.
    return aiOfferTurn(say(withClass(x), 'The draft is done. Sign your draftees — anyone you do not sign goes to free agency.'));
  }
  const x = {
    ...d, draft: record, phase: DPHASE.rookies, talks: {}, draftPool: [...(d.draftPool ?? []), ...undrafted],
    // d.draftClass is already NEXT year's (drawn at the lottery); the
    // undrafted go back into the pool for the class after it.
    // This year's picks are made: their trade records go.
    pickOwner: Object.fromEntries(Object.entries(d.pickOwner ?? {}).filter(([id]) => parsePick(id).year !== d.year)),
  };
  // The AI signs what fits now; the rest stay its rights until the season starts.
  return aiOfferTurn(aiSignRookies(x));
}

/** Done signing draftees: whoever is unsigned goes to free agency, which opens. */
export function closeSigning(d, { rng = Math.random } = {}) {
  if (d.phase !== DPHASE.signing) throw new Error('dynasty: not signing draftees');
  let x = resolveWaivers(d);
  for (const h of humanIds(x)) for (const key of rightsOf(x, h, 'draft')) x = renounce(x, h, key);
  return openFreeAgency(x, { rng });
}

/**
 * Done with the picks screen: free agency opens. Nobody is renounced here —
 * an unsigned pick stays the team's rights, signable at the scale through
 * free agency and the preseason, and lapses only when the season starts
 * (the user, 2026-09-17).
 */
export function closeRookies(d, { rng = Math.random } = {}) {
  if (d.phase !== DPHASE.rookies) throw new Error('dynasty: not signing picks');
  return openFreeAgency(resolveWaivers(d), { rng });
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
  // Ping-Pong Balls (staff, 2026-09-23): a coach's weight, and only his, +25%.
  const weights = lotteryWeights(out.length).map((w, i) => w * (staffTier(d, out[i].id, 'scout') >= 2 ? LOTTERY_BOOST : 1));
  const total = weights.reduce((t, w) => t + w, 0);
  const entries = out.map((r, i) => ({ teamId: r.id, rank: r.rank, weight: weights[i], pct: Math.round((weights[i] / total) * 1000) / 10 }));
  return { entries, draws: Math.min(LOTTERY_DRAWS, out.length) };
}

/** classFor's remembered draws for a save with no class stored, by the pool array they were drawn from. */
const UNSTORED = new WeakMap();

/**
 * The class of the next draft still to be made (nextDraftYear): the one
 * stored on d.draftClass (withClass) — what a pick's trade value, the lottery
 * room and the draw all read, from the day it is drawn to its draft. During
 * the rookie draft that is already NEXT year's; the class being drafted is
 * d.draft.pool.
 */
export function classFor(d) {
  const c = d.draftClass;
  const year = nextDraftYear(d);
  if (c?.keys && c.year === year) return c.keys;
  // A save with no class stored for that year (before 2026-09-17 there was
  // none) reads the very draw withClass will store — same seed, same pool —
  // and the next step that moves the pool stores it first. Remembered per
  // pool: pickValue asks on every trade the AI weighs, and the pool array is
  // replaced, never mutated, when it changes.
  const tag = `${d.id}:${year}:${d.teams.length}`;
  const pool = d.draftPool ?? [];
  const hit = UNSTORED.get(pool);
  if (hit?.tag === tag) return hit.keys;
  const keys = buildDraftClass(d, classRng(d, year));
  UNSTORED.set(pool, { tag, keys });
  return keys;
}

/** Draw the lottery and open the draft. */
export function drawLottery(d0, { rng = Math.random } = {}) {
  if (d0.phase !== DPHASE.lottery) throw new Error('dynasty: not lottery time');
  const d = resolveWaivers(d0);
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
  // The class the window drew — only those still waiting in the pool.
  const waiting = new Set(d.draftPool ?? []);
  const cls = classFor(d).filter(k => waiting.has(k));
  const lottery = { entries: odds.entries, draws: odds.draws, order, moved };
  // A traded pick is made by whoever owns it, in the slot its original team earned.
  const origin = Array.from({ length: ROOKIE_ROUNDS }, () => order).flat();
  const owners = origin.map((t, i) => pickOwner(d, d.year, Math.floor(i / order.length) + 1, t));
  const winner = teamOf(d, order[0]);
  const via = owners[0] !== order[0] ? ` — the pick belongs to ${teamOf(d, owners[0])?.name}` : ' and pick first';
  let x = say({ ...d, lottery }, `${winner?.name} win the lottery${via}.`);
  // This year's class leaves the pool for the draft room, and next year's is
  // drawn from what is left (withClass) — decided once, a year ahead.
  if (!cls.length) return openFreeAgency(withClass({ ...x, phase: DPHASE.rookies, draft: null }), { rng });
  const taken = new Set(cls);
  x = {
    ...x,
    phase: DPHASE.rookieDraft,
    draftPool: (d.draftPool ?? []).filter(k => !taken.has(k)),
    draft: { kind: 'rookie', order: owners, origin, picks: [], pool: [...cls] },
  };
  return aiOfferTurn(withClass(x));
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
  const spentSal = {};
  const made = {};
  for (const team of shuffle(d.teams.filter(t => !t.human), rng)) {
    const size = rosterKeys(d, team.id).length;
    // A pick still to sign holds his roster spot and his scale (2026-09-17).
    const open = MAX_ROSTER - size - rightsOf(d, team.id, 'rookie').length;
    if (open <= 0) continue;
    const reserved = rookieCommitted(d, team.id);
    const limit = Math.min(open, AI_OFFERS_PER_DAY);
    const worst = size ? Math.min(...rosterOf(d, team.id).map(c => c.salary ?? 0)) : 0;
    for (const key of market) {
      if ((made[team.id] ?? 0) >= limit) break;
      if (size >= MIN_ROSTER && salaryOf(key) <= worst) continue;
      const years = preferredYears(traitOf(d, key));
      const floor = floorOf(d, key, team.id, years, day);
      const dp = Math.max(floor, Math.ceil(floor * (1 + rng() * 0.1)));
      const spotsAfter = Math.max(0, MIN_ROSTER - size - (made[team.id] ?? 0) - 1);
      const booked = payroll(d, team.id) + (spent[team.id] ?? 0);
      const room = aiCapDp(d) - booked - reserved - spotsAfter * AI_RESERVE_PER_SPOT;
      // The human's own rule (fitsCap): a real deal fits under the cap, a
      // minimum deal anywhere under the apron — and nothing past it.
      if (dp > room && !(dp <= MIN_DP && booked + dp <= aiApronDp(d))) continue;
      // AND THE CARD-SALARY CEILING (aiSalaryCap, the user, 2026-09-18): the
      // cards it already bid on today, its unsigned picks and a cheap card
      // for each seat still short of eight are held back, as the DP is above.
      const salHeld = rookieSalaryHeld(d, team.id) + (spentSal[team.id] ?? 0) + spotsAfter * AI_SALARY_PER_SPOT;
      if (!salaryFits(d, team.id, [key], [], salHeld)) continue;
      const ratio = dp / floor;
      const cur = rivals[key];
      if (cur && cur.ratio >= ratio) continue;
      if (cur) {
        spent[cur.teamId] -= cur.dp;
        spentSal[cur.teamId] -= salaryOf(key);
        made[cur.teamId] -= 1;
      }
      rivals[key] = { teamId: team.id, dp, years, ratio };
      spent[team.id] = (spent[team.id] ?? 0) + dp;
      spentSal[team.id] = (spentSal[team.id] ?? 0) + salaryOf(key);
      made[team.id] = (made[team.id] ?? 0) + 1;
    }
  }
  return rivals;
}

/** Open free agency: day one, fresh talks, the AI's first bids on the table. */
export function openFreeAgency(d, { rng = Math.random } = {}) {
  const x = { ...d, phase: DPHASE.freeAgency, fa: { day: 1, rivals: {} }, talks: {}, draft: d.draft?.pool ? { kind: d.draft.kind, picks: d.draft.picks } : d.draft };
  return aiOfferTurn(say({ ...x, fa: { day: 1, rivals: aiRivalOffers(x, rng) } }, 'Free agency is open. The AI teams have made their first offers.'));
}

/** The end of a day: every rival bid still standing — and still affordable — signs. */
function resolveRivals(d) {
  let x = d;
  const free = new Set(freeAgentKeys(d));
  const bids = Object.entries(d.fa?.rivals ?? {}).sort((a, b) => b[1].dp - a[1].dp);
  for (const [key, r] of bids) {
    if (!free.has(key)) continue;
    if (rosterKeys(x, r.teamId).length >= MAX_ROSTER) continue;
    if (payroll(x, r.teamId) + r.dp > (r.dp <= MIN_DP ? aiApronDp(x) : aiCapDp(x))) continue;
    // The ceiling is read again at signing (aiSalaryCap, 2026-09-18): a
    // claim or a trade since the bid may have taken the room.
    if (!signingFits(x, r.teamId, key)) continue;
    x = sign(x, r.teamId, key, { dp: r.dp, years: r.years, how: 'fa' });
    free.delete(key);
  }
  return x;
}

/** Next day of free agency; after the last one it closes. */
export function nextFaDay(d, { rng = Math.random } = {}) {
  if (d.phase !== DPHASE.freeAgency) throw new Error('dynasty: free agency is not open');
  // The wire first (a claim is a contract the day's bids have to fit
  // around); then a pick that fits by now — a trade or a claim took money
  // off the books — signs.
  const x = aiSignRookies(resolveRivals(resolveWaivers(d)));
  const day = (d.fa?.day ?? 1) + 1;
  if (day > FA_DAYS) return closeFreeAgency(x);
  const y = { ...x, fa: { day, rivals: {} } };
  return aiOfferTurn({ ...y, fa: { day, rivals: aiRivalOffers(y, rng) } });
}

/** Close free agency: the AI teams fill to eight from what is left, and it is the preseason. */
export function closeFreeAgency(d) {
  // Picks first — a signed pick counts toward the eight — then the fill.
  let x = aiSignRookies({ ...resolveWaivers(d), phase: DPHASE.preseason, fa: { day: LEFTOVER_DAY, rivals: {} }, talks: {} });
  // The AI's second trading point of the offseason (2026-09-18): after the
  // market, before the fill — a team short of eight may trade for a man first.
  x = aiTrades(x);
  for (const team of x.teams.filter(t => !t.human)) x = fillRoster(x, team.id);
  return aiOfferTurn(say(x, 'Free agency has closed. Whoever is left will sign for less.'));
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
  // THE RIGHTS WINDOW CLOSES HERE (the user, 2026-09-17): the AI signs what
  // fits, sheds one contract for a pick worth it, and every pick still
  // unsigned — on any team — lapses to free agency. Then the AI fills to eight.
  // An older save stores its next class here, before camp can take from the pool.
  // The wire resolves before the deadline; the deadline's own sheds wait on
  // it for the season's first round to turn (seasonTurn).
  // The AI's last trading point of the offseason (2026-09-18) comes first,
  // so a pick a trade makes room for signs before the deadline.
  let x = withClass(lapseRookies(aiSignRookies(aiTrades(resolveWaivers(d)), { deadline: true })));
  for (const team of x.teams.filter(t => !t.human)) x = fillRoster(x, team.id);
  const short = x.teams.filter(t => rosterProblem(x, t.id));
  if (short.length) throw new Error(`dynasty: ${short.map(t => `${t.name} has ${rosterProblem(x, t.id)}`).join('; ')}`);
  const teams = x.teams.map(t => ({
    id: t.id, name: t.name, human: Boolean(t.human), uid: t.uid ?? null, roster: rosterOf(x, t.id),
    abbr: t.abbr ?? null, logo: t.logo ?? null,
    // An AI team's fifty is fitted to the ten it drafted (deckFit.js) every
    // season, since the roster moves between them; a human's is their own.
    // The roster as it tips off — its picks signed at the deadline and its
    // fill included (it read the preseason's `d` until 2026-09-18).
    deck: t.human ? (t.deck ?? null) : fitDeck(rosterOf(x, t.id)),
    deckName: t.deckName ?? null,
    primary: t.primary ?? null, secondary: t.secondary ?? null, city: t.city ?? null,
  }));
  const season = buildSeason({ id: `${x.id}-y${x.year}`, teams, length: x.length, series: x.series ?? null });
  void rng;
  // A new season forgives: nobody is spurned any more.
  return aiOfferTurn(say({ ...x, season, phase: DPHASE.season, fa: null, talks: {}, spurned: {} }, `Year ${x.year} tips off.`));
}

/**
 * Close the season: file it in the history, then turn the year — contracts
 * tick, the expiring become their teams' exclusive rights, the AI decides on
 * its own, and the exclusive window opens. After the tenth season the
 * dynasty is done instead.
 */
export function endSeason(d0, { rng = Math.random } = {}) {
  if (d0.phase !== DPHASE.season || d0.season?.phase !== PHASE.done) throw new Error('dynasty: the season is not finished');
  // Anyone still on the wire (a season whose rounds were never turned
  // through seasonTurn) is resolved before the year closes.
  const d = resolveWaivers(d0);
  const s = d.season;
  const table = standings(s);
  const seeds = s.playoffSeeds ?? [];
  const entry = {
    year: d.year,
    champion: s.champion ?? null,
    runnerUp: s.runnerUp ?? null,
    playoffSeeds: [...seeds],
    table: table.map(r => ({ id: r.id, w: r.w, l: r.l, rank: r.rank })),
    // THE SHARE THE COACH PLAYED (2026-09-18): the user, "title/year money is
    // multiplied by the share of your own games you actually played (simmed
    // ones don't count)". Counted now, while the season's results still
    // exist; prizes.js dynastyYearEarnings reads it. A solo dynasty only (its
    // one coach is HUMAN_ID; a friends dynasty's are h:<uid>) — one with
    // friends keeps its own rules, and its entries carry no count.
    ...(isSoloDynasty(d) ? { own: ownGamesPlayed(s.results, HUMAN_ID) } : {}),
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
  // FRANCHISE POINTS (2026-09-22): every coach banks the year's points here,
  // and the entry keeps what each earned, for the years table.
  const fpNow = { ...(d.fp ?? {}) };
  const fpLines = [];
  for (const h of humanIds(d)) {
    const e = fpEarned(d, s, h, table);
    entry.fp = { ...(entry.fp ?? {}), [h]: e.points };
    fpNow[h] = (Number(fpNow[h]) || 0) + e.points;
    fpLines.push(`⭐ ${teamOf(d, h)?.name} earn ${e.points} Franchise Points — ${e.why}.`);
  }
  let x = say({ ...d, teams, fp: fpNow, history: [...d.history, entry], season: null }, `🏆 ${champ?.name ?? 'Somebody'} win the Year ${d.year} title.`);
  for (const line of fpLines) x = say(x, line);
  // A ten-year dynasty ends itself; an aging one runs until it is ended (endDynasty).
  if (!d.aging && d.year >= (d.years ?? DYNASTY_YEARS)) return aiOfferTurn(say({ ...x, phase: DPHASE.done }, 'The dynasty is complete.'));

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
  return aiOfferTurn(aiResign(retirements(x, rng), rng));
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
    const holder = x.contracts[key]?.teamId ?? x.rights?.[key]?.teamId ?? null;
    // Sports Science (staff, 2026-09-23): a coach's players start their risk
    // a year or two later, and the one he protected skips this year's roll.
    if (holder && x.protected?.[holder] === key) {
      if (retireChance(age) > 0) x = say(x, `${cardOf(key)?.name} is protected this year — no retirement roll at ${age}.`);
      continue;
    }
    const p = retireChance(age - retireShift(x, holder));
    if (!p || rng() >= p) continue;
    x = { ...x, contracts: omit(x.contracts, key), rights: omit(x.rights, key), retired: [...(x.retired ?? []), key] };
    gone.add(key);
    if (holder) x = say(x, `${cardOf(key)?.name} retires at ${age}, from ${teamOf(x, holder)?.name}.`);
  }
  // A protection is for one turn of the year, used or not.
  return { ...x, protected: {} };
}

/** End an aging dynasty between seasons — it has no tenth-year finish of its own. */
export function endDynasty(d) {
  if (!d.aging) throw new Error('dynasty: a ten-year dynasty ends by itself');
  if (d.phase === DPHASE.season || d.phase === DPHASE.done) throw new Error('dynasty: end it between seasons');
  if (!d.history.length) throw new Error('dynasty: play a season first');
  const n = d.history.length;
  return aiOfferTurn(say({ ...resolveWaivers(d), phase: DPHASE.done, talks: {}, fa: null }, `The dynasty is retired after ${n} season${n === 1 ? '' : 's'}.`));
}

/**
 * WHAT AN AI TEAM HOLDS BACK FOR THE DRAFT AHEAD (2026-09-18): the rookie
 * scale of every pick it holds in the coming draft — its own and any it
 * traded for — and how many seats those picks will fill. A pick is priced at
 * the slot its original team is projected to pick in (projectedSlot), except
 * that a lottery team's first-rounder is priced as the FIRST pick: any team
 * in the lottery can win it, and a team that reserved for pick four and drew
 * pick one would be the two DP short that passes a first-overall pick.
 * `year` prices a later draft the same way, on today's standings — the best
 * guess there is a year out (aiResign's look ahead).
 *
 * AND THE CARD SALARY THOSE PICKS WILL CARRY (`salary`, 2026-09-19). The
 * ceiling holds card salary where the scale holds DP, and re-signing with
 * only the scale held back spent the salary room the picks needed: a
 * reviewer's probe had the AI passing 56% of its rookie picks with the
 * ceiling (19% without), 4 of 54 first-overall picks among them — the bug
 * above, in salary. So each pick holds the card at its projected overall
 * slot in the class already drawn for it (classFor), the class ranked by
 * talent as the AI drafts it; the lottery's first-rounder the class's best.
 * Only the coming draft has a class, so a later `year` holds no salary.
 * `held` prices a pick list other than the team's own (a trade's).
 */
function draftReserve(d, teamId, year = nextDraftYear(d), held = picksOf(d, teamId)) {
  const teams = d.teams.length;
  const lottery = new Set(lotteryOdds(d).entries.map(e => e.teamId));
  const ranked = year === nextDraftYear(d) ? rankedClass(d) : [];
  let dp = 0;
  let picks = 0;
  let salary = 0;
  for (const id of held) {
    const { year: y, round, origin } = parsePick(id);
    if (y !== year) continue;
    const at = round === 1 && lottery.has(origin) ? 1 : projectedSlot(d, origin);
    const slot = (round - 1) * teams + at;
    dp += rookieScale(slot, teams).dp;
    if (ranked.length) salary += salaryOf(ranked[Math.min(slot, ranked.length) - 1]);
    picks += 1;
  }
  return { dp, picks, salary };
}

/** The coming draft's class, best first by talent — the order the AI takes it in. */
function rankedClass(d) {
  const cls = classFor(d);
  const hit = RANKED.get(cls);
  if (hit) return hit;
  const ranked = cls.filter(k => cardOf(k)).sort((a, b) => talentValue(cardOf(b)) - talentValue(cardOf(a)));
  RANKED.set(cls, ranked);
  return ranked;
}
/** rankedClass, remembered per class array (a stored class is never mutated, only replaced). */
const RANKED = new WeakMap();

/**
 * The AI's exclusive window: keep a player at his floor when he fits under
 * the AI's apron (aiApronDp — it read the human's APRON_DP until 2026-09-17)
 * and is worth it — at least the team's median salary, or a coin flip — and
 * let him walk otherwise.
 *
 * IT BUDGETS FOR ITS PICKS FIRST (2026-09-18). The user: "AI should draft
 * players based on what they can fit in their dynasty points" and "teams
 * drafting that player need a chance to sign him". Re-signing up to the apron
 * with nothing held back left no room for the team's own picks: a verifier's
 * own-start run passed 21 of 30 first-overall picks, most for money. So
 * before anyone is kept, the window holds back the scale of the team's picks
 * in the coming draft (draftReserve) and AI_RESERVE_PER_SPOT for every seat
 * still short of MIN_ROSTER once those re-signings and picks are counted. The
 * apron itself does not move; a team that has to choose keeps the same
 * players in the same order and simply stops sooner.
 *
 * AND A DEAL THAT RUNS PAST THIS YEAR LOOKS A YEAR AHEAD (2026-09-18). The
 * reserve above covers the coming draft only, so a multi-year re-sign could
 * spend NEXT year's room: a verifier's stacked start (seed 23, LAL, year 3)
 * passed a legendary first-overall pick at 109 DP with nothing to re-sign —
 * its books were a year-two re-sign of 21 DP and year two's picks. So a deal
 * of two years or more also has to fit the apron next season beside every
 * contract that will still be running then (years ≥ 2), the coming draft's
 * picks (three-year scale deals) and next year's picks at their scale. The
 * player who does not fit on his terms walks, as any other who does not fit.
 */
export function aiResign(d, rng = Math.random) {
  let x = d;
  for (const team of d.teams.filter(t => !t.human)) {
    const kept = rosterOf(x, team.id).map(c => c.salary ?? 0).sort((a, b) => a - b);
    const median = kept.length ? kept[Math.floor(kept.length / 2)] : 0;
    const expiring = rightsOf(x, team.id, 'expiring').sort((a, b) => salaryOf(b) - salaryOf(a));
    const reserve = draftReserve(x, team.id);
    const ahead = draftReserve(x, team.id, nextDraftYear(x) + 1);
    // What is already on next season's books: contracts with a year to run
    // after this one. Signing adds to it, so it is read every time.
    const running = () => Object.values(x.contracts).filter(k => k.teamId === team.id && k.years >= 2).reduce((t, k) => t + k.dp, 0);
    for (const key of expiring) {
      const years = preferredYears(traitOf(x, key));
      const dp = floorOf(x, key, team.id, years, 1);
      const after = rosterKeys(x, team.id).length + 1;
      const short = Math.max(0, MIN_ROSTER - after - reserve.picks);
      const held = reserve.dp + short * AI_RESERVE_PER_SPOT;
      const nextYear = years < 2 || running() + dp + reserve.dp + ahead.dp <= aiApronDp(x);
      // And his card fits the ceiling (aiSalaryCap, the user, 2026-09-18),
      // with a cheap card held back for each seat still short of eight — and
      // the cards the coming picks will carry (draftReserve's salary,
      // 2026-09-19), so the ceiling passes no more picks than the apron does.
      const salHeld = short * AI_SALARY_PER_SPOT + reserve.salary;
      const fits = after <= MAX_ROSTER && payroll(x, team.id) + dp + held <= aiApronDp(x) && nextYear
        && salaryFits(x, team.id, [key], [], salHeld);
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
  // The class was drawn a year ago (withClass) and the trades below are
  // valued on it; an older save with none stored stores the same draw now.
  let x = withClass(resolveWaivers(d));
  for (const h of humanIds(x)) for (const key of rightsOf(x, h, 'expiring')) x = renounce(x, h, key);
  x = aiTrades(x);
  return aiOfferTurn({ ...x, phase: DPHASE.lottery, talks: {}, lottery: { ...lotteryOdds(x), order: null, moved: null } });
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
/** The least a drafted ten is left with at each group (aiDraftChoice). */
const POS_FLOOR = { G: 2, F: 2, C: 1 };
const groupOf = key => POS_GROUP[cardOf(key)?.pos] ?? 'F';

/** Short at his position: worth up to 30% more; long: down to 15% less. */
function needFactor(teamKeys, card) {
  const group = POS_GROUP[card?.pos] ?? 'F';
  return needAt(group, teamKeys.filter(k => groupOf(k) === group).length);
}

/** needFactor from the count a roster has at the group — how a search reads it (valuerFor). */
function needAt(group, count) {
  const gap = POS_TARGET[group] - count;
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
  return baseTradeValue(d, key, teamId) * needFactor(rosterAfter ?? rosterKeys(d, teamId), card);
}

/** tradeValue before the need at his position — the part a search can remember (valuerFor). */
function baseTradeValue(d, key, teamId, direction = teamDirection(d, teamId)) {
  const card = cardOf(key);
  if (!card) return 0;
  const k = d.contracts[key];
  const years = k?.years ?? 1;
  const rebuild = direction === 'rebuild';
  const stays = availability(d, key, years);
  const weight = rebuild ? stays * stays : stays;
  // BUYERS AND SELLERS, the column's other constant: a contender pays for the
  // player now and minds the money less; a rebuilder pays for the years and
  // the savings. That difference is what lets two teams both win a deal.
  const cf = controlFactor(years);
  const control = rebuild ? cf ** 1.5 : 1 + (cf - 1) / 2;
  const money = rebuild ? 1.25 : 0.75;
  return (talentValue(card) * control + contractValue(card, k) * money) * weight;
}

/**
 * ONE STATE'S TRADE VALUES, REMEMBERED (2026-09-18). The directed AI search
 * (aiTrades) and the AI's proposals to a coach (aiProposals) weigh tens of
 * thousands of deals against one unchanged dynasty, and every tradeValue
 * re-derived the team's direction (in year one a talent ranking of the whole
 * league) and every pickValue re-sorted the class. This holds each team's
 * direction, roster, payroll and picks, each player's value before need and
 * each pick's value, for ONE state — the numbers are tradeValue's and
 * pickValue's own, so a deal judged here is judged exactly as evaluateTrade
 * judges it. Never keep one across a change to the dynasty.
 */
function valuerFor(d) {
  // One map per kind of number, keyed by team then key: a search asks tens of
  // thousands of times, and building a string key per ask was its hot spot.
  const memo = () => {
    const byTeam = new Map();
    return (t, id, make) => {
      let m = byTeam.get(t);
      if (!m) byTeam.set(t, (m = new Map()));
      if (!m.has(id)) m.set(id, make());
      return m.get(id);
    };
  };
  const team = memo();
  const bases = memo();
  const pickMemo = memo();
  const groups = new Map();
  const group = key => {
    if (!groups.has(key)) groups.set(key, cardOf(key) ? (POS_GROUP[cardOf(key).pos] ?? 'F') : null);
    return groups.get(key);
  };
  const direction = t => team(t, 'dir', () => teamDirection(d, t));
  const roster = t => team(t, 'roster', () => rosterKeys(d, t));
  const base = (key, t) => bases(t, key, () => baseTradeValue(d, key, t, direction(t)));
  return {
    direction,
    roster,
    /** A player's position group ('F' for a card without one), or null when there is no card. */
    group,
    pay: t => team(t, 'pay', () => payroll(d, t)),
    /** Its roster's card salary (aiSalaryOf) — the AI ceiling's reading. */
    salary: t => team(t, 'sal', () => aiSalaryOf(d, t)),
    picks: t => team(t, 'picks', () => picksOf(d, t)),
    player(key, t, after = null) {
      const card = cardOf(key);
      if (!card) return 0;
      return base(key, t) * needFactor(after ?? roster(t), card);
    },
    pick: (id, t) => pickMemo(t, id, () => pickValue(d, id, t)),
    /** A roster's count at each position group. */
    counts: t => team(t, 'counts', () => {
      const c = { G: 0, F: 0, C: 0 };
      for (const k of roster(t)) c[groupOf(k)] += 1;
      return c;
    }),
    /** tradeValue on a roster given by its counts at each group, not its keys — the same number, without building the roster. */
    playerAt(key, t, counts) {
      const g = group(key);
      return g ? base(key, t) * needAt(g, counts[g]) : 0;
    },
    /** The roster weakest first, as weakestOf ranks it (a stable sort keeps its tie order). */
    weakOrder: t => team(t, 'weak', () => {
      const talent = new Map(roster(t).map(k => [k, talentValue(cardOf(k))]));
      const value = new Map(roster(t).map(k => [k, contractValue(cardOf(k), d.contracts[k])]));
      return [...roster(t)].sort((p, q) => talent.get(p) - talent.get(q) || value.get(p) - value.get(q));
    }),
  };
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
  // The slot prices the deal (2026-09-17): a top pick costs more and lands more.
  const scale = rookieScale(slot, d.teams.length);
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
 * SALARY MATCHING (the user, 2026-09-17: cap and apron in the NBA's
 * proportions, and the NBA's rule with them): a team OVER ITS CAP after a
 * deal may take back at most this share of the DP it sends out. Under the
 * cap after it, no matching — it has the room.
 */
export const TRADE_MATCH = 1.25;

// ── ROSTER RELIEF (2026-09-18) ──────────────────────────────────────────────
//
// The user's decision, 2026-09-17, as recorded: "trades: receiving side may
// auto-waive its CHEAPEST for roster room". What is built waives its WEAKEST
// (shedCandidate's pick: least talent, then worst contract), because the
// lead's phase-2 brief (2026-09-18) asked for shedCandidate — the two
// differ, and which the user meant is put to them (open as of 2026-09-18);
// weakestOf/v.weakOrder is the one place to change. Every roster is ten in year one,
// so before this no two-for-one and no salary dump could ever be legal (a
// probe, 2026-09-18: 0 of 3,150 human→AI two-for-ones). Now a side that would
// end ABOVE MAX_ROSTER waives its weakest man — never one coming in, never
// one going out — as part of the deal. He goes ON WAIVERS like any waive, so
// a claim takes his contract and his DP off that side's books; until then
// his DP stays as dead money, which is why relief leaves a side's payroll —
// and so its apron check — exactly where the trade puts it. One man a side:
// a deal that would need two cuts is still too many players. A coach sees
// the cut in the deal before saying yes ("to make room, X is waived"); an AI
// side takes a deal with a cut only when it still wins after losing him —
// evaluateTrade counts him in what that side gives up.
export const TRADE_RELIEF = 1;

/** Who each side of a deal waives to make room: `{ [teamId]: [key] }`, empty when nobody has to. */
export function tradeRelief(d, { from, to, give = [], get = [] }, v = null) {
  const relief = {};
  for (const [team, loses, gains] of [[from, give, get], [to, get, give]]) {
    const size = (v ? v.roster(team) : rosterKeys(d, team)).filter(k => !loses.includes(k)).length;
    const over = size + gains.length - MAX_ROSTER;
    if (over <= 0 || over > TRADE_RELIEF) continue;
    // A search reads the same order off its valuer: weakestOf, ranked once.
    if (v) {
      relief[team] = v.weakOrder(team).filter(k => !loses.includes(k)).slice(0, over);
      continue;
    }
    let staying = rosterKeys(d, team).filter(k => !loses.includes(k));
    const cut = [];
    for (let i = 0; i < over; i += 1) {
      const worst = weakestOf(d, staying);
      if (!worst) break;
      cut.push(worst);
      staying = staying.filter(k => k !== worst);
    }
    relief[team] = cut;
  }
  return relief;
}

/**
 * A deal's relief as it will be undone if it must be (a commissioner's veto,
 * dynastyFriends.js): each man's team, key and contract as it stood.
 */
export function reliefOf(d, deal) {
  return Object.entries(tradeRelief(d, deal)).flatMap(([teamId, keys]) => keys.map(key => ({ teamId, key, contract: { ...d.contracts[key] } })));
}

/**
 * Put a trade's relief back while each man is still on the wire — a vetoed
 * trade is undone whole (dynastyFriends.js vetoTrade). His dead money goes,
 * his wire entry goes, his contract returns as it stood.
 */
export function restoreRelief(d, entries = []) {
  let x = d;
  for (const { teamId, key, contract } of entries) {
    const w = waiverList(x).find(e => e.key === key && e.from === teamId);
    if (!w) throw new Error('dynasty: a player that trade waived has left the waiver wire');
    const at = (x.dead ?? []).findLastIndex(m => m.teamId === teamId && m.key === key && m.through === w.year && m.dp === w.dp);
    x = {
      ...x,
      waivers: waiverList(x).filter(e => e !== w),
      contracts: { ...x.contracts, [key]: contract },
      dead: at < 0 ? (x.dead ?? []) : x.dead.filter((_, i) => i !== at),
      spurned: omit(x.spurned, key),
    };
  }
  return x;
}

/** Whether a trade's relief can still be undone: every man it waived is still on the wire. */
export const reliefOnWire = (d, entries = []) => entries.every(({ teamId, key }) => waiverList(d).some(e => e.key === key && e.from === teamId));

/**
 * Why a deal cannot happen, or []. A deal is `{ from, to, give, get }`:
 * `give` goes from → to, `get` comes back. Both rosters end at ten or fewer
 * — after a side's roster relief (tradeRelief), one man at most; a side over
 * its cap after the deal takes back at most TRADE_MATCH of what it sends;
 * and neither payroll may grow past its apron — the human's 130, an AI
 * team's 115 at the rung (aiApronDp). The man relief waives stays on the
 * books as dead money, so he counts against that apron. A payroll already
 * past its apron may still come DOWN through a trade (the user, 2026-09-12:
 * trade them to get under) — an AI team only down, a coach down or even. `v` is a
 * valuerFor(d) a search passes to share its rosters and payrolls.
 */
export function tradeProblems(d, deal, v = null) {
  const { from, to, give = [], get = [], givePicks = [], getPicks = [] } = deal;
  const out = [];
  const rosterOfTeam = t => (v ? v.roster(t) : rosterKeys(d, t));
  const picksOfTeam = t => (v ? v.picks(t) : picksOf(d, t));
  if (!tradesOpen(d)) out.push(d.phase === DPHASE.season ? 'The trade deadline has passed.' : 'No trades right now.');
  if (!give.length && !get.length && !givePicks.length && !getPicks.length) out.push('Nothing is in the deal yet.');
  if (give.some(k => d.contracts[k]?.teamId !== from)) out.push('Only players under contract with you can be traded.');
  if (get.some(k => d.contracts[k]?.teamId !== to)) out.push('That player is not under contract with them.');
  if (givePicks.length && givePicks.some(id => !picksOfTeam(from).includes(id))) out.push('That pick is not yours to trade.');
  if (getPicks.length && getPicks.some(id => !picksOfTeam(to).includes(id))) out.push('That pick is not theirs to trade.');
  const relief = tradeRelief(d, deal, v);
  for (const [team, loses, gains] of [[from, give, get], [to, get, give]]) {
    const size = rosterOfTeam(team).length - loses.length + gains.length;
    if (size - (relief[team]?.length ?? 0) > MAX_ROSTER) {
      out.push(`${teamOf(d, team)?.name} would have ${size} players — ${MAX_ROSTER} is the most, and a trade waives at most ${TRADE_RELIEF} to make room.`);
    }
    // Mid-season a team still has to take the floor.
    if (d.phase === DPHASE.season && size < MIN_ROSTER) out.push(`${teamOf(d, team)?.name} would have ${size} players — a team in season keeps ${MIN_ROSTER}.`);
    // Relief moves a man's DP from his contract to dead money: the payroll is the trade's alone.
    const before = v ? v.pay(team) : payroll(d, team);
    const sent = dpOf(d, loses);
    const taken = dpOf(d, gains);
    const after = before - sent + taken;
    const apron = apronFor(d, team);
    // An AI TEAM past its apron trades only DOWN (2026-09-18): taking any DP
    // back, it must send out more. An even swap kept one at 117 of its 115
    // (the phase-2 measure) — still over after a trade and no nearer under.
    // A coach keeps the NBA's even swap (the user, 2026-09-12: trade them to
    // get under — and the measure's 300-DP start lost a quarter of its legal
    // one-for-ones when the rule was both sides'). A picks-only deal or a dump
    // takes nothing back.
    const evenIsUp = taken > 0 && after === before && !teamOf(d, team)?.human;
    if (after > apron && after > before) out.push(`${teamOf(d, team)?.name} would be at ${after} DP — past the ${apron} apron.`);
    else if (after > apron && evenIsUp) {
      out.push(`${teamOf(d, team)?.name} are already past their ${apron} apron at ${before} DP — they only trade down: taking any DP back, they must send out more.`);
    }
    else if (after > capFor(d, team) && taken > sent * TRADE_MATCH) {
      out.push(`${teamOf(d, team)?.name} would be over the cap taking back ${taken} DP for ${sent} — over the cap a team takes back at most ${Math.round(TRADE_MATCH * 100)}% of what it sends out.`);
    }
    // AN AI SIDE ENDS WITHIN ITS CARD-SALARY CEILING (aiSalaryCap, the user,
    // 2026-09-18) — whoever proposed the deal: the AI's own search, its offer
    // to a coach, or a coach's offer to it. The man its relief waives leaves
    // the roster, so his card leaves the sum. A team already over the ceiling
    // (an older save) may trade level or down, never up. A coach's side is
    // never held to it — "never a worse you".
    //
    // And room kept (2026-09-19) as every other AI path keeps it: its
    // unsigned picks' cards (as fitProblem); before the draft (the re-sign
    // window's and the lottery's trades, closeResign aiTrades) the cards the
    // picks it will hold after the deal are projected to carry
    // (draftReserve); and a cheap card for each seat, those picks counted,
    // still short of eight (seatsHeld). A verifier's step trace had
    // closeResign's trades take short-handed AI teams to the ceiling, and the
    // fill then sign past it.
    if (!teamOf(d, team)?.human) {
      const salNow = v ? v.salary(team) : aiSalaryOf(d, team);
      const salAfter = salNow - salaryOfKeys(loses) - salaryOfKeys(relief[team] ?? []) + salaryOfKeys(gains);
      const ceiling = aiSalaryCap(d);
      const unsigned = rightsOf(d, team, 'rookie');
      const beforeDraft = d.phase === DPHASE.resign || d.phase === DPHASE.lottery;
      const heldFor = (players, picks) => {
        let seats = players + unsigned.length;
        let h = salaryOfKeys(unsigned);
        if (beforeDraft) {
          const coming = draftReserve(d, team, nextDraftYear(d), picks);
          h += coming.salary;
          seats += coming.picks;
        }
        return h + seatsHeld(d, team, seats);
      };
      const [outP, inP] = team === from ? [givePicks, getPicks] : [getPicks, givePicks];
      const picksAfter = [...picksOfTeam(team).filter(id => !outP.includes(id)), ...inP];
      const held = heldFor(size - (relief[team]?.length ?? 0), picksAfter);
      // What it needs is what is measured against the ceiling, before and
      // after: a LEVEL two-for-one that leaves a team one short of eight
      // still spends the eighth seat's room. The second build compared the
      // salary alone, and closeFreeAgency's trades took a New York at $5,490
      // from eight men to seven, level, and the fill then signed past the
      // ceiling (the 2026-09-19 re-measure, 2 of 2,240 team-seasons).
      // Both are read: the roster's own salary may not rise past the ceiling
      // (sending out a pick lowers the need, never the salary on the books).
      const needNow = salNow + heldFor(rosterOfTeam(team).length, picksOfTeam(team));
      if ((salAfter > ceiling && salAfter > salNow) || (salAfter + held > ceiling && salAfter + held > needNow)) {
        out.push(salAfter > ceiling
          ? `${teamOf(d, team)?.name} would carry $${salAfter} of card salary — past the AI's $${ceiling} ceiling at this league's rung.`
          : `${teamOf(d, team)?.name} would carry $${salAfter} of card salary and need $${held} more for their picks and empty seats — past the AI's $${ceiling} ceiling at this league's rung.`);
      }
    }
  }
  return out;
}

/** One side of a deal, as that side sees it: what comes in, what goes out, and whom it waives to make room. */
function sideOf(deal, team, relief) {
  const cut = relief[team] ?? [];
  return team === deal.to
    ? { ins: deal.give ?? [], outs: deal.get ?? [], inPicks: deal.givePicks ?? [], outPicks: deal.getPicks ?? [], cut }
    : { ins: deal.get ?? [], outs: deal.give ?? [], inPicks: deal.getPicks ?? [], outPicks: deal.givePicks ?? [], cut };
}

/**
 * What a side gets, valued on the roster it would have, against what it
 * gives, valued on the roster it has — and the man its relief waives counts
 * as given up: his talent, never less than nothing (his DP is dead money
 * whether he goes or not).
 */
function sideValues(v, team, { ins, outs, inPicks, outPicks, cut }) {
  // The roster it would have, by its count at each position (needFactor's only reading of it).
  const after = { ...v.counts(team) };
  for (const k of outs) after[v.group(k) ?? 'F'] -= 1;
  for (const k of cut) after[v.group(k) ?? 'F'] -= 1;
  for (const k of ins) after[v.group(k) ?? 'F'] += 1;
  const valueIn = ins.reduce((t, k) => t + v.playerAt(k, team, after), 0)
    + inPicks.reduce((t, id) => t + v.pick(id, team), 0);
  const valueOut = outs.reduce((t, k) => t + v.player(k, team), 0)
    + outPicks.reduce((t, id) => t + v.pick(id, team), 0)
    + cut.reduce((t, k) => t + Math.max(0, v.player(k, team)), 0);
  return { valueIn, valueOut };
}

/** What the AI wants back for what it gives: its value out plus TRADE.aiEdge. */
const neededFor = valueOut => valueOut + TRADE.aiEdge * Math.abs(valueOut);
/** By how much a side clears the AI's edge (negative: it would not take the deal). */
const margin = s => s.valueIn - neededFor(s.valueOut);

/**
 * The other side's answer: what it gets, valued on the roster it would have,
 * against what it gives (and the man it waives to make room), valued on the
 * roster it has — and it wants to win by TRADE.aiEdge. `verdict` is accept,
 * close (within TRADE.closeBand), reject, or illegal; `short` is the value it
 * is missing; `relief` is who each side waives to make room (tradeRelief).
 */
export function evaluateTrade(d, deal, v = valuerFor(d)) {
  const problems = tradeProblems(d, deal, v);
  const relief = tradeRelief(d, deal, v);
  const { valueIn, valueOut } = sideValues(v, deal.to, sideOf(deal, deal.to, relief));
  const needed = neededFor(valueOut);
  const short = Math.max(0, needed - valueIn);
  const verdict = problems.length ? 'illegal'
    : valueIn >= needed ? 'accept'
      : short <= (1 - TRADE.closeBand) * Math.max(Math.abs(needed), 10) ? 'close' : 'reject';
  return { problems, valueIn, valueOut, needed, short, verdict, relief };
}

/**
 * Make a deal the other side accepts — or, with `force`, one already judged
 * (the AI's own, an offer a coach accepted). A side over ten waives its
 * relief man as part of it; `relief: false` is a veto's reversal, which puts
 * the relief back itself (restoreRelief) and must not cut anyone new.
 */
export function makeTrade(d, deal, { force = false, relief = true } = {}) {
  if (!force) {
    const ev = evaluateTrade(d, deal);
    if (ev.verdict !== 'accept') throw new Error(ev.problems[0] ?? 'dynasty: they turned it down');
  }
  const cut = relief ? tradeRelief(d, deal) : {};
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
  const cuts = [];
  for (const [team, keys] of Object.entries(cut)) {
    for (const k of keys) {
      next = release(next, team, k);
      cuts.push(`${teamOf(d, team)?.name} waive ${cardOf(k)?.name} to make room`);
    }
  }
  // MID-SEASON the live season's rosters move too: the next fixture is played with them.
  if (next.phase === DPHASE.season && next.season) next = syncSeasonRosters(next, [deal.from, deal.to]);
  return say(
    next,
    `Trade: ${teamOf(d, deal.from)?.name} send ${names(give, deal.givePicks)} to ${teamOf(d, deal.to)?.name} for ${names(get, deal.getPicks)}${cuts.length ? `; ${cuts.join('; ')}` : ''}.`,
  );
}

/**
 * The cheapest single addition of yours — a player or a pick — that would get
 * the deal done: `{ key }` or `{ pick }`, or null when nothing alone does.
 */
export function suggestSweetener(d, deal) {
  const v = valuerFor(d);
  const players = rosterKeys(d, deal.from).filter(k => !(deal.give ?? []).includes(k))
    .map(k => ({ key: k, cost: v.player(k, deal.from), deal: { ...deal, give: [...(deal.give ?? []), k] } }));
  const picks = picksOf(d, deal.from).filter(id => !(deal.givePicks ?? []).includes(id))
    .map(id => ({ pick: id, cost: v.pick(id, deal.from), deal: { ...deal, givePicks: [...(deal.givePicks ?? []), id] } }));
  const works = [...players, ...picks].filter(x => evaluateTrade(d, x.deal, v).verdict === 'accept').sort((a, b) => a.cost - b.cost);
  if (!works.length) return null;
  return { key: works[0].key ?? null, pick: works[0].pick ?? null };
}

// ── THE DEALS A TEAM'S SITUATION CALLS FOR (2026-09-18) ─────────────────────
//
// The approved design, for the AI trading among itself and for its offers to
// a coach alike — every deal `a` could send `b`:
//   (a) a team OVER ITS CAP sheds DP: a player for nothing, or a player and a
//       pick to take him; a team SHORT OF THE FLOOR fills a seat with a pick;
//   (b) a CONTENDER sends picks to a REBUILDER for a player (and, `mirror`, a
//       rebuilder sends a player to a contender for its picks);
//   (c) one-for-one and two-for-one swaps (and, `mirror`, one-for-two), which
//       need at a position (needFactor) and direction (tradeValue) make worth
//       doing for both sides.
// The AI's search over its own teams runs both orders of every pair, so it
// needs no mirror; an offer to a coach runs one order only, so it does.

function* pairsOf(list) {
  for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) yield [list[i], list[j]];
}

function* dealShapes(d, v, a, b, { mirror = false } = {}) {
  const ra = v.roster(a);
  const rb = v.roster(b);
  const pa = v.picks(a);
  const pb = v.picks(b);
  const deal = (give, get, givePicks = [], getPicks = []) => ({ from: a, to: b, give, get, givePicks, getPicks });
  // (c) swaps
  for (const x of ra) for (const y of rb) yield deal([x], [y]);
  for (const two of pairsOf(ra)) for (const y of rb) yield deal(two, [y]);
  if (mirror) for (const x of ra) for (const two of pairsOf(rb)) yield deal([x], two);
  // (b) picks for a player
  const buys = v.direction(a) === 'contend' && v.direction(b) === 'rebuild';
  if (buys || ra.length < MIN_ROSTER) {
    for (const p of pa) for (const y of rb) yield deal([], [y], [p]);
    for (const two of pairsOf(pa)) for (const y of rb) yield deal([], [y], two);
  }
  if (mirror && v.direction(a) === 'rebuild' && v.direction(b) === 'contend') {
    for (const x of ra) for (const q of pb) yield deal([x], [], [], [q]);
    for (const x of ra) for (const two of pairsOf(pb)) yield deal([x], [], [], two);
  }
  // (a) over the cap: shed a contract, with a pick to take it if it must
  if (v.pay(a) > capFor(d, a)) {
    for (const x of ra) {
      yield deal([x], []);
      for (const p of pa) yield deal([x], [], [p]);
    }
  }
  // ...and the other side over ITS cap, shedding onto `a` — a coach over the
  // apron is who most needs a taker (the user, 2026-09-12: "trade them to
  // get under").
  if (mirror && v.pay(b) > capFor(d, b)) {
    for (const y of rb) {
      yield deal([], [y]);
      for (const q of pb) yield deal([], [y], [], [q]);
    }
  }
}

// ── THE AI TRADING AMONG ITSELF: A DIRECTED SEARCH (2026-09-18) ─────────────
//
// The user, 2026-09-17: the AI should trade — with the other teams and with
// you. Until today aiTrades drew 24 random pairs once a year and made a deal
// only when both sides gained: three trades in forty seeded dynasties. Now,
// at each offseason point where the AI teams already act (closeResign,
// closeFreeAgency, startSeason), every AI team weighs every deal its
// situation calls for (dealShapes) with every other AI team. A deal is made
// only when BOTH sides would take it by their own lights — each clears the
// edge the AI asks of a coach (TRADE.aiEdge, evaluateTrade's rule, from each
// side) — and it passes every rule (tradeProblems: rosters and relief,
// aprons, matching). The best deal league-wide goes first, best meaning the
// SMALLER of the two sides' margins, so a deal both like beats one that
// fleeces; a team makes one deal a point; AI_TRADES_PER_OFFSEASON across the
// whole offseason, counted in d.aiDeals ({ year, n }). No dice: the same
// dynasty makes the same deals, on the server and alone.
export const AI_TRADES_PER_OFFSEASON = 3;

/** The best deal between two AI teams neither in `skip`, or null. */
function bestAiDeal(d, skip) {
  const v = valuerFor(d);
  const ai = d.teams.filter(t => !t.human && !skip.has(t.id)).map(t => t.id);
  let best = null;
  for (const a of ai) {
    for (const b of ai) {
      if (a === b) continue;
      for (const deal of dealShapes(d, v, a, b)) {
        const relief = tradeRelief(d, deal, v);
        const sa = sideValues(v, a, sideOf(deal, a, relief));
        const ma = margin(sa);
        if (ma < 0 || sa.valueIn - sa.valueOut <= 1) continue;
        const sb = sideValues(v, b, sideOf(deal, b, relief));
        const mb = margin(sb);
        if (mb < 0 || sb.valueIn - sb.valueOut <= 1) continue;
        const score = Math.min(ma, mb);
        if (best && score <= best.score) continue;
        if (tradeProblems(d, deal, v).length) continue;
        best = { deal, score };
      }
    }
  }
  return best?.deal ?? null;
}

/** AI-to-AI deals made so far this offseason. */
const aiDealsMade = d => (d.aiDeals?.year === d.year ? d.aiDeals.n : 0);

export function aiTrades(d, { max = AI_TRADES_PER_OFFSEASON } = {}) {
  if (!isOffseason(d)) return d;
  let x = d;
  const traded = new Set();
  for (let left = Math.min(max, AI_TRADES_PER_OFFSEASON - aiDealsMade(d)); left > 0; left -= 1) {
    const deal = bestAiDeal(x, traded);
    if (!deal) break;
    x = makeTrade(x, deal, { force: true });
    x = { ...x, aiDeals: { year: x.year, n: aiDealsMade(x) + 1 } };
    traded.add(deal.from);
    traded.add(deal.to);
  }
  return x;
}

// ── THE AI PROPOSES TO YOU (2026-09-18) ─────────────────────────────────────
//
// The user, 2026-09-17: the AI should "propose trades". At every turn of the
// dynasty while trades are open — each offseason phase, each day (week, with
// friends) of free agency, the preseason, and each round of the regular
// season up to the deadline — every AI team weighs the deals its situation
// calls for (dealShapes, both ways round) with every coach, and keeps a deal
// only when:
//   * it is LEGAL now (tradeProblems) — no offer is ever posted illegal;
//   * the AI would take it itself: its own side clears TRADE.aiEdge, the
//     same rule it answers a coach's offer by;
//   * it does not insult: the coach's side, valued by the coach's own
//     direction and needs, gets back at least OFFER_FAIRNESS of what it
//     gives (the relief man counted as given up);
//   * the coach has not already turned it down (or let it lapse) this year.
// Its best — the smaller of the two sides' margins again — is its ONE offer;
// the AI_OFFERS_PER_TURN best offers league-wide are posted in d.offers, the
// shape a coach's proposal takes (dynastyFriends.js proposeTrade) with `ai:
// true`. An offer lapses at the next turn. Accepting one runs the rules again
// (answerOffer): the world may have moved since it was made. No dice here
// either, so a dynasty with friends — the server running the same turns —
// posts exactly the offers a dynasty alone would.
export const AI_OFFERS_PER_TURN = 3;
export const OFFER_FAIRNESS = 0.9;
/** Offers kept on the dynasty once decided, newest last; open ones are always kept. */
export const OFFERS_KEPT = 40;
/**
 * The most offers one coach may have open at once (2026-09-18). A coach's
 * offer to another coach never lapses, and open offers are never trimmed, so
 * without this a friends league's document — which Firestore caps at 1 MiB —
 * grew with every proposal (a review: 200 proposals, 201 offers kept).
 */
export const OPEN_OFFERS_PER_COACH = 10;

const cleanDeal = deal => ({
  from: deal.from, to: deal.to,
  give: [...(deal.give ?? [])], get: [...(deal.get ?? [])],
  givePicks: [...(deal.givePicks ?? [])], getPicks: [...(deal.getPicks ?? [])],
});
/** One string per deal, the same whichever order its pieces were picked in. */
export const dealSig = o => [o.from, o.to, [...(o.give ?? [])].sort(), [...(o.get ?? [])].sort(), [...(o.givePicks ?? [])].sort(), [...(o.getPicks ?? [])].sort()].join('|');

/** The turn a dynasty is on — a new one lapses the AI's open offers and asks for new ones. */
const turnOf = d => [d.year, d.phase, d.fa?.day ?? 0, d.season?.phase ?? '', d.season?.round ?? 0].join(':');

/**
 * Trim the offers a dynasty keeps. Always kept: every open offer (each
 * coach has at most OPEN_OFFERS_PER_COACH, the AI at most AI_OFFERS_PER_TURN
 * a turn) and — given `d` — a trade between coaches accepted this phase,
 * which the commissioner can still veto (a review, 2026-09-18: the trim
 * could drop one mid-phase and the veto threw "no such offer"). Of the rest,
 * OFFERS_KEPT stay: an AI team's decided offers go first, oldest first, since
 * a busy year expires up to three a turn; then the coaches', oldest first.
 */
export function trimOffers(offers = [], d = null) {
  const standing = o => o.status === 'open'
    || (d && o.status === 'accepted' && !o.ai && o.year === d.year && o.phase === d.phase);
  const decided = offers.filter(o => !standing(o));
  const over = decided.length - OFFERS_KEPT;
  if (over <= 0) return offers;
  const drop = new Set([...decided.filter(o => o.ai), ...decided.filter(o => !o.ai)].slice(0, over));
  return offers.filter(o => !drop.has(o));
}

/**
 * The deals the coaches turned down or let lapse this year, which the AI
 * does not offer again until the next (the docs promise it). Kept apart
 * from d.offers (2026-09-18, a review): that list is trimmed, and a year of
 * up to three lapses a turn outgrew it, so an old refusal could come back.
 */
const refusalsOf = d => new Set([
  ...(d.offerRefusals?.year === d.year ? d.offerRefusals.sigs : []),
  // An older save kept them only on the offers themselves.
  ...(d.offers ?? []).filter(o => o.ai && o.year === d.year && (o.status === 'declined' || o.status === 'expired')).map(dealSig),
]);
function refuse(d, offers) {
  const sigs = d.offerRefusals?.year === d.year ? d.offerRefusals.sigs : [];
  const add = offers.map(dealSig).filter(s => !sigs.includes(s));
  return add.length ? { ...d, offerRefusals: { year: d.year, sigs: [...sigs, ...add] } } : d;
}

/**
 * Why an offer made TO `offer.to` cannot be accepted now, worded for the
 * coach answering it, or []. The rules are tradeProblems' with the deal
 * turned round to the answering side (they are the same both ways but for
 * their words: a review, 2026-09-18, found "Only players under contract
 * with you" said to a coach about the AI's own player). An AI team's offer
 * is also off when that team no longer clears its edge on it.
 */
export function offerProblems(d, offer) {
  const turned = {
    from: offer.to, to: offer.from,
    give: offer.get ?? [], get: offer.give ?? [], givePicks: offer.getPicks ?? [], getPicks: offer.givePicks ?? [],
  };
  const v = valuerFor(d);
  const out = tradeProblems(d, turned, v);
  if (!out.length && offer.ai && margin(sideValues(v, offer.from, sideOf(offer, offer.from, tradeRelief(d, offer, v)))) < 0) {
    out.push(`${teamOf(d, offer.from)?.name} have thought better of it — the deal is off.`);
  }
  return out;
}

/** How a coach's side of an AI offer looks to the coach: `{ valueIn, valueOut }`, relief included. */
export function offerValue(d, offer, teamId = offer.to) {
  const v = valuerFor(d);
  return sideValues(v, teamId, sideOf(offer, teamId, tradeRelief(d, offer, v)));
}

/** The deals the AI teams would offer the coaches right now, best first — one an AI team, AI_OFFERS_PER_TURN in all. */
export function aiProposals(d) {
  if (!tradesOpen(d)) return [];
  const v = valuerFor(d);
  const humans = humanIds(d).filter(h => teamOf(d, h));
  const refused = refusalsOf(d);
  const best = [];
  for (const a of d.teams.filter(t => !t.human).map(t => t.id)) {
    let top = null;
    for (const h of humans) {
      for (const deal of dealShapes(d, v, a, h, { mirror: true })) {
        const relief = tradeRelief(d, deal, v);
        const mine = sideValues(v, a, sideOf(deal, a, relief));
        const ma = margin(mine);
        if (ma < 0) continue;
        const theirs = sideValues(v, h, sideOf(deal, h, relief));
        if (theirs.valueIn < OFFER_FAIRNESS * theirs.valueOut) continue;
        const score = Math.min(ma, theirs.valueIn - theirs.valueOut);
        if (top && score <= top.score) continue;
        if (tradeProblems(d, deal, v).length || refused.has(dealSig(deal))) continue;
        top = { deal, score };
      }
    }
    if (top) best.push(top);
  }
  return best.sort((x, y) => y.score - x.score).slice(0, AI_OFFERS_PER_TURN).map(b => cleanDeal(b.deal));
}

/**
 * A TURN OF THE DYNASTY, for the AI's offers: the open ones lapse, and while
 * trades are open the best new ones are posted, each with a line on the
 * wire. Called at the end of every transition that moves the dynasty on and
 * at each round of a season (seasonTurn); a second call on the same turn
 * does nothing, so a transition built of others posts once.
 */
export function aiOfferTurn(d) {
  const turn = turnOf(d);
  if (d.offerTurn === turn) return d;
  const lapsed = (d.offers ?? []).filter(o => o.ai && o.status === 'open');
  let x = { ...d, offerTurn: turn };
  // A lapse is a refusal for the year, kept where no trim reaches it — but
  // only within the year it was made: the turn into a new year forgives.
  if (lapsed.length) {
    x = { ...x, offers: d.offers.map(o => (o.ai && o.status === 'open' ? { ...o, status: 'expired' } : o)) };
    x = refuse(x, lapsed.filter(o => o.year === x.year));
  }
  const deals = aiProposals(x);
  if (!deals.length) return lapsed.length ? { ...x, offers: trimOffers(x.offers, x) } : x;
  const names = (keys, picks) => [...keys.map(k => cardOf(k)?.name), ...picks.map(id => pickLabel(x, id))].join(' and ') || 'nothing';
  for (const deal of deals) {
    const offer = { id: `ai-${turn}-${deal.from}-${deal.to}`, ...deal, status: 'open', ai: true, year: x.year, phase: x.phase };
    x = say(
      { ...x, offers: [...(x.offers ?? []), offer] },
      `${teamOf(x, deal.from)?.name} offer ${teamOf(x, deal.to)?.name} ${names(deal.give, deal.givePicks)} for ${names(deal.get, deal.getPicks)}.`,
    );
  }
  return { ...x, offers: trimOffers(x.offers, x) };
}

/**
 * A coach's answer to an AI team's offer. Declined, it is marked and will not
 * be made again this year. Accepted, it is judged AGAIN, now — the rules
 * (tradeProblems) and the AI's own edge — because the world may have moved
 * since it was posted (a signing, a trade, a claim); a deal that no longer
 * stands is refused, and one that does is made, relief and all.
 */
export function answerOffer(d, id, teamId, accept) {
  const offer = (d.offers ?? []).find(o => o.id === id);
  if (!offer || offer.status !== 'open') throw new Error('dynasty: that offer is not open');
  if (offer.to !== teamId) throw new Error('dynasty: that offer is not yours to answer');
  const mark = (x, patch) => ({ ...x, offers: (x.offers ?? []).map(o => (o.id === id ? { ...o, ...patch } : o)) });
  if (!accept) return mark(offer.ai ? refuse(d, [offer]) : d, { status: 'declined' });
  // Judged from the answering coach's side, so the reason reads as theirs.
  const problems = offerProblems(d, offer);
  if (problems.length) throw new Error(`dynasty: ${problems[0]}`);
  const relief = reliefOf(d, offer);
  const x = makeTrade(d, offer, { force: true });
  return mark(
    say(x, `${teamOf(d, teamId)?.name} accepted ${teamOf(d, offer.from)?.name}'s offer.`),
    { status: 'accepted', year: d.year, phase: d.phase, ...(relief.length ? { relief } : {}) },
  );
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
