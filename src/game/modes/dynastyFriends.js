// A DYNASTY WITH FRIENDS — what a shared dynasty adds to dynasty.js. Pure: the
// Cloud Functions run it (functions/index.js) and the browser reads it.
//
// The user, 2026-09-11:
//   * drafts are ASYNC ON A CLOCK — a coach picks when it is his turn, from
//     any device; when the clock runs out the AI picks for him, and the
//     commissioner can force it early;
//   * a phase moves on when EVERY COACH IS READY, and the commissioner can
//     force it;
//   * free agency is three advanceable WEEKS OF SEALED BIDS — nobody sees
//     another coach's offer, and at the end of each week every free agent
//     takes the best deal by his own lights, a coach's or an AI team's;
//   * trades between coaches are PROPOSED AND ACCEPTED, and the commissioner
//     can veto.
//
// The dynasty document is readable by every member, so what must stay secret
// — the sealed bids — never goes in it: the server keeps each coach's bids in
// a document only that coach can read, and hands them all to nextFaWeek at
// the week's end.
import {
  DPHASE, humanIds, onClock, draftPick, passPick, aiDraftChoice, simDraft, finishDraft, draftDone,
  closeSigning, closeResign, drawLottery, closeRookies, nextFaDay, fillRoster, startSeason, endSeason,
  freeAgentKeys, rosterKeys, fitsCap, marketDay, tradeProblems, makeTrade, parsePick, pickOwner,
  MAX_ROSTER, teamOf, signContract, floorOf, rosterProblem, tradesOpen,
  createDynasty, negotiate, renounce, signRookie, waive, endDynasty,
  resolveWaivers, claimWaiver, withdrawClaim, signingFits,
  answerOffer, reliefOf, restoreRelief, reliefOnWire, trimOffers, offerProblems, dealSig, OPEN_OFFERS_PER_COACH,
} from './dynasty.js';
import { PHASE } from './seasonCore.js';
import { CONTRACT_YEARS, MIN_DP, MAX_DP } from './dynastyMarket.js';
import { getCardByKey } from '../cardSets.js';

/** How long a coach has to make a draft pick before the AI makes it for him. */
export const PICK_CLOCK_MS = 12 * 60 * 60 * 1000;

const nameOf = key => getCardByKey(key)?.name ?? key;
const news = (d, text) => ({ ...d, news: [{ year: d.year, text }, ...(d.news ?? [])].slice(0, 80) });

// ── Ready, and moving on ────────────────────────────────────────────────────

export function setReady(d, teamId, ready = true) {
  if (!humanIds(d).includes(teamId)) throw new Error('dynasty: only a coach can be ready');
  return { ...d, ready: { ...(d.ready ?? {}), [teamId]: Boolean(ready) } };
}
export const isReady = (d, teamId) => Boolean(d.ready?.[teamId]);
export const allReady = d => humanIds(d).every(h => isReady(d, h));

/**
 * Close the phase the dynasty is in — what "Done" means there, for everyone.
 * A draft is run to its end (the AI picks for anyone still to), a preseason
 * fills any coach short of eight, and free agency turns its week with the
 * sealed `bids`. Everyone is un-readied for the next phase.
 */
export function advancePhase(d, { rng = Math.random, bids = [], now = Date.now() } = {}) {
  let x;
  switch (d.phase) {
    case DPHASE.draft:
    case DPHASE.rookieDraft:
      x = finishDraft(simDraft(d, { rng, all: true }), { rng });
      break;
    case DPHASE.signing: x = closeSigning(d, { rng }); break;
    case DPHASE.resign: x = closeResign(d, { rng }); break;
    case DPHASE.lottery: x = stampClock(simDraft(drawLottery(d, { rng }), { rng }), now); break;
    case DPHASE.rookies: x = closeRookies(d, { rng }); break;
    case DPHASE.freeAgency: x = nextFaWeek(d, bids, { rng }); break;
    case DPHASE.preseason: {
      // The wire resolves BEFORE a short coach is filled (reviewer,
      // 2026-09-18): startSeason resolves it first alone, and filling first
      // let the minimum deal take the seat or the apron room a standing
      // claim needed — the claim failed and the coach got a man he never
      // asked for. startSeason's own resolve then finds the wire empty.
      let y = resolveWaivers(d);
      for (const h of humanIds(y)) if (rosterProblem(y, h)) y = fillRoster(y, h);
      x = startSeason(y, { rng });
      break;
    }
    case DPHASE.season:
      if (d.season?.phase !== PHASE.done) throw new Error('dynasty: the season is still being played');
      x = endSeason(d, { rng });
      break;
    default:
      throw new Error('dynasty: there is nothing to move on to');
  }
  return { ...x, ready: {} };
}

// ── The draft clock ─────────────────────────────────────────────────────────

/** Start the clock for whoever is on it, when it is a new pick. */
export function stampClock(d, now = Date.now()) {
  const c = onClock(d);
  if (!c || d.draft.clockFor === c.n) return d;
  return { ...d, draft: { ...d.draft, clockFor: c.n, clockAt: now } };
}

/** Milliseconds left on the pick clock, or null when no coach is on it. */
export function clockLeft(d, now = Date.now()) {
  const c = onClock(d);
  if (!c || !humanIds(d).includes(c.teamId) || d.draft.clockAt == null) return null;
  return Math.max(0, PICK_CLOCK_MS - (now - d.draft.clockAt));
}

/**
 * Run the draft forward: the AI teams pick at once, and a coach whose clock
 * has run out — or, with `force`, the coach on it now — has the AI pick for
 * him. A finished draft is closed (finishDraft), un-readying everyone.
 */
export function runDraftClock(d, { now = Date.now(), rng = Math.random, force = false } = {}) {
  let x = stampClock(simDraft(d, { rng }), now);
  let forcing = force;
  for (let guard = 0; guard < 500; guard += 1) {
    const c = onClock(x);
    if (!c) break;
    const expired = now - (x.draft.clockAt ?? now) >= PICK_CLOCK_MS;
    if (!forcing && !expired) break;
    const key = aiDraftChoice(x, c.teamId, rng);
    // A rookie pick the books cannot sign is passed, as the AI passes its own (2026-09-17).
    x = key == null
      ? news(passPick(x, c.teamId), `${teamOf(x, c.teamId)?.name}'s clock ran out — nobody on the board fits their books, so the pick is passed.`)
      : news(draftPick(x, c.teamId, key), `${teamOf(x, c.teamId)?.name}'s clock ran out — the AI took ${nameOf(key)} for them.`);
    forcing = false;
    x = stampClock(simDraft(x, { rng }), now);
  }
  if (x.draft && !x.draft.done && draftDone(x) && (x.phase === DPHASE.draft || x.phase === DPHASE.rookieDraft)) {
    x = { ...finishDraft(x, { rng }), ready: {} };
  }
  return x;
}

/** A coach's own pick (or pass, `key` null), then the draft runs on to the next coach. */
export function coachPick(d, teamId, key, { now = Date.now(), rng = Math.random } = {}) {
  const picked = key == null ? passPick(d, teamId) : draftPick(d, teamId, key);
  return runDraftClock(picked, { now, rng });
}

// ── Sealed free agency ──────────────────────────────────────────────────────

/** Why a sealed bid cannot stand, or null. `bid` is { key, dp, years }. */
export function bidProblem(d, teamId, { key, dp, years } = {}) {
  if (d.phase !== DPHASE.freeAgency) return 'Free agency is not open.';
  if (!humanIds(d).includes(teamId)) return 'Only a coach bids.';
  if (!freeAgentKeys(d).includes(key)) return 'That player is not a free agent.';
  if (!Number.isInteger(dp) || dp < MIN_DP || dp > MAX_DP) return `A bid is ${MIN_DP}–${MAX_DP} DP a season.`;
  if (!Number.isInteger(years) || years < CONTRACT_YEARS.min || years > CONTRACT_YEARS.max) return `A bid is for ${CONTRACT_YEARS.min}–${CONTRACT_YEARS.max} years.`;
  if (rosterKeys(d, teamId).length >= MAX_ROSTER) return `Your roster is full at ${MAX_ROSTER}.`;
  if (!fitsCap(d, teamId, key, dp)) return `${dp} DP does not fit under your cap.`;
  return null;
}

/**
 * The end of a week of sealed bids. Every free agent looks at the bids on
 * him — the coaches' `bids` ([{ teamId, key, dp, years }]) and the AI teams'
 * standing offers — and takes the one that is best by his own lights (DP
 * over his floor for that team, at that length) of those that clear his
 * floor. The best players choose first; a bid that no longer fits a roster
 * or a cap by then is passed over for the next. Then the week turns, or free
 * agency closes, exactly as it does alone.
 */
export function nextFaWeek(d0, bids = [], { rng = Math.random } = {}) {
  if (d0.phase !== DPHASE.freeAgency) throw new Error('dynasty: free agency is not open');
  // THE WIRE FIRST (2026-09-18): whoever was waived this week is claimed or
  // freed before the bids are read, as nextFaDay does alone — a claim is a
  // contract the week's signings then have to fit around.
  const d = resolveWaivers(d0);
  const day = marketDay(d);
  const free = new Set(freeAgentKeys(d));
  const offers = new Map();
  const add = (key, o) => offers.set(key, [...(offers.get(key) ?? []), o]);
  for (const b of bids) {
    if (!b || bidProblem(d, b.teamId, b)) continue;
    const floor = floorOf(d, b.key, b.teamId, b.years, day);
    if (b.dp >= floor) add(b.key, { teamId: b.teamId, dp: b.dp, years: b.years, ratio: b.dp / floor });
  }
  for (const [key, r] of Object.entries(d.fa?.rivals ?? {})) if (free.has(key)) add(key, r);
  let x = d;
  const salary = key => getCardByKey(key)?.salary ?? 0;
  for (const key of [...offers.keys()].sort((a, b) => salary(b) - salary(a))) {
    const list = [...offers.get(key)].sort((a, b) => b.ratio - a.ratio);
    for (const o of list) {
      // An AI team's standing bid signs only within its card-salary ceiling
      // too (dynasty.js aiSalaryCap, the user, 2026-09-18) — the same rule as
      // alone; a coach's bid is never held to it (signingFits).
      if (rosterKeys(x, o.teamId).length >= MAX_ROSTER || !fitsCap(x, o.teamId, key, o.dp) || !signingFits(x, o.teamId, key)) continue;
      x = signContract(x, o.teamId, key, { dp: o.dp, years: o.years, how: 'fa' });
      break;
    }
  }
  // Every standing AI offer has had its answer above; the week turns as it does alone.
  return nextFaDay({ ...x, fa: { ...x.fa, rivals: {} } }, { rng });
}

// ── Trades between coaches ──────────────────────────────────────────────────

const clean = deal => ({
  from: deal.from, to: deal.to,
  give: [...(deal.give ?? [])], get: [...(deal.get ?? [])],
  givePicks: [...(deal.givePicks ?? [])], getPicks: [...(deal.getPicks ?? [])],
});

/** Offer another coach a trade. It waits for their answer. */
export function proposeTrade(d, deal, { id, now = Date.now() } = {}) {
  if (!id) throw new Error('dynasty: an offer needs an id');
  const humans = humanIds(d);
  if (!humans.includes(deal.from) || !humans.includes(deal.to) || deal.from === deal.to) throw new Error('dynasty: an offer is from one coach to another');
  const problems = tradeProblems(d, deal);
  if (problems.length) throw new Error(`dynasty: ${problems[0]}`);
  // Open offers are never trimmed and a coach's never lapses, so a coach's
  // are counted (2026-09-18, a review: 200 proposals kept 201 offers in a
  // document Firestore caps at 1 MiB) and the same deal is not made twice.
  const mine = (d.offers ?? []).filter(o => o.status === 'open' && o.from === deal.from);
  if (mine.some(o => dealSig(o) === dealSig(deal))) throw new Error('dynasty: you have already offered them that deal');
  if (mine.length >= OPEN_OFFERS_PER_COACH) throw new Error(`dynasty: you have ${OPEN_OFFERS_PER_COACH} offers waiting — withdraw one first`);
  const offer = { id, ...clean(deal), status: 'open', at: now, year: d.year, phase: d.phase };
  return news({ ...d, offers: trimOffers([...(d.offers ?? []), offer], d) }, `${teamOf(d, deal.from)?.name} made ${teamOf(d, deal.to)?.name} a trade offer.`);
}

function setStatus(d, id, patch) {
  return { ...d, offers: (d.offers ?? []).map(o => (o.id === id ? { ...o, ...patch } : o)) };
}

/**
 * Accept (the trade happens) or decline an offer made to you — a coach's, or
 * an AI team's (2026-09-18), which answerOffer judges again as alone: the
 * rules, and whether the AI still wants it. Either way a side over ten
 * waives its weakest to make room (dynasty.js tradeRelief), and who that was
 * is kept on the offer so a veto can put him back.
 */
export function respondTrade(d, id, teamId, accept, { now = Date.now() } = {}) {
  const offer = (d.offers ?? []).find(o => o.id === id);
  if (!offer || offer.status !== 'open') throw new Error('dynasty: that offer is not open');
  if (offer.to !== teamId) throw new Error('dynasty: that offer is not yours to answer');
  if (offer.ai) return setStatus(answerOffer(d, id, teamId, accept), id, { decidedAt: now });
  if (!accept) return setStatus(d, id, { status: 'declined', decidedAt: now });
  // Judged from the answering coach's side, so the reason reads as theirs.
  const problems = offerProblems(d, offer);
  if (problems.length) throw new Error(`dynasty: ${problems[0]}`);
  const relief = reliefOf(d, offer);
  return setStatus(makeTrade(d, offer, { force: true }), id, {
    status: 'accepted', decidedAt: now, year: d.year, phase: d.phase, ...(relief.length ? { relief } : {}),
  });
}

/** Take back an offer you made, while it is still open. */
export function withdrawTrade(d, id, teamId, { now = Date.now() } = {}) {
  const offer = (d.offers ?? []).find(o => o.id === id);
  if (!offer || offer.status !== 'open') throw new Error('dynasty: that offer is not open');
  if (offer.from !== teamId) throw new Error('dynasty: that offer is not yours to withdraw');
  return setStatus(d, id, { status: 'withdrawn', decidedAt: now });
}

/**
 * Whether an accepted trade can still be undone: every piece is where it put
 * them, in the same phase. Only a deal BETWEEN COACHES (2026-09-18, a review):
 * the veto is the friends' check on each other, and an AI team's offer is
 * no more the commissioner's to strike than a trade made with it at the desk.
 */
export function vetoable(d, offer) {
  if (offer.ai) return false;
  if (offer.status === 'open') return true;
  if (offer.status !== 'accepted' || offer.year !== d.year || offer.phase !== d.phase || !tradesOpen(d)) return false;
  const at = (k, team) => d.contracts[k]?.teamId === team;
  const owns = (id, team) => { const p = parsePick(id); return pickOwner(d, p.year, p.round, p.origin) === team; };
  // A man the trade waived to make room must still be on the wire to come back.
  if (!reliefOnWire(d, offer.relief)) return false;
  return offer.give.every(k => at(k, offer.to)) && offer.get.every(k => at(k, offer.from))
    && offer.givePicks.every(id => owns(id, offer.to)) && offer.getPicks.every(id => owns(id, offer.from));
}

/**
 * The commissioner's veto: an open offer is struck; an accepted trade is
 * reversed, if every piece is still where it put them and it is the same
 * phase. After that it stands.
 */
export function vetoTrade(d, id, { now = Date.now() } = {}) {
  const offer = (d.offers ?? []).find(o => o.id === id);
  if (!offer) throw new Error('dynasty: no such offer');
  if (offer.ai) throw new Error('dynasty: only a trade between coaches can be vetoed');
  if (!vetoable(d, offer)) throw new Error('dynasty: too late to veto that one');
  let x = d;
  if (offer.status === 'accepted') {
    // The relief first (2026-09-18): whoever the trade waived is back on his
    // team, and the reversal cuts nobody new.
    x = restoreRelief(x, offer.relief);
    x = makeTrade(x, { from: offer.to, to: offer.from, give: offer.give, get: offer.get, givePicks: offer.givePicks, getPicks: offer.getPicks }, { force: true, relief: false });
    x = { ...x, news: x.news.slice(1) };   // the reversal is not a trade; the veto line below says what happened
  }
  x = setStatus(x, id, { status: 'vetoed', decidedAt: now });
  return news(x, `The commissioner vetoed ${teamOf(d, offer.from)?.name}'s trade with ${teamOf(d, offer.to)?.name}.`);
}

/** The offers a coach can see waiting on them, and their own still open. */
export function openOffers(d, teamId) {
  const all = (d.offers ?? []).filter(o => o.status === 'open');
  return { toMe: all.filter(o => o.to === teamId), fromMe: all.filter(o => o.from === teamId) };
}

// ── Starting one, and one coach's move ──────────────────────────────────────

/**
 * The dynasty a friends league starts with, built on the server from the
 * lobby: every entrant a coach, under the league's settings. A fantasy draft
 * is run to the first coach's pick, so the room opens on someone's clock.
 */
export function createFriendsDynasty(league, { rng = Math.random, now = Date.now() } = {}) {
  const s = league.settings;
  const humans = league.entrants.map(e => ({
    id: e.id, name: e.name, uid: e.uid, deck: e.deck ?? null, deckName: e.deckName ?? null,
    roster: s.startMode === 'own' ? e.roster.map(k => getCardByKey(k)).filter(Boolean) : [],
  }));
  const d = createDynasty({
    id: league.id, name: league.name, humans, size: s.size, length: s.length,
    startMode: s.startMode, series: s.series ?? null, aging: Boolean(s.aging), rng,
    aiLevel: s.aiLevel ?? null,
  });
  return d.phase === DPHASE.draft ? runDraftClock(d, { now, rng }) : d;
}

const inDraft = d => d.phase === DPHASE.draft || d.phase === DPHASE.rookieDraft;

/** Whether "everyone is ready" can move this phase on: a draft ends by its picks, a season by its games. */
export function canAdvance(d) {
  if (inDraft(d) || d.phase === DPHASE.done) return false;
  if (d.phase === DPHASE.season) return d.season?.phase === PHASE.done;
  return true;
}

/** The moves a coach can make, by name — what the server's dynastyAct accepts. */
export const FRIEND_MOVES = [
  'tick', 'pick', 'pass', 'offer', 'renounce', 'signRookie', 'waive', 'fill', 'ready',
  'force', 'end', 'tradeAi', 'propose', 'respond', 'withdraw', 'veto', 'setDeck',
  // A claim on a waived player (2026-09-18), and taking it back; the wire
  // resolves when the phase, the week or the season's round moves on.
  'claim', 'unclaim',
];

/**
 * One coach's move, as the server makes it. `op` names it and `args` carries
 * it; `isHost` is the commissioner's say-so, `bids` the week's sealed bids
 * (should the week turn), `id` the id a new trade offer takes. The draft clock
 * runs first, so a pick that has run out is the AI's before anything else
 * happens. Returns `{ dynasty, result }` — `result` is a player's answer to
 * an offer, else null.
 */
export function friendsAct(d, teamId, op, args = {}, { now = Date.now(), rng = Math.random, isHost = false, bids = [], id = null } = {}) {
  if (!humanIds(d).includes(teamId)) throw new Error('dynasty: you are not a coach in this dynasty');
  if (d.phase === DPHASE.done) throw new Error('dynasty: this dynasty is over');
  const commissioner = () => { if (!isHost) throw new Error('dynasty: only the commissioner can do that'); };
  const key = () => String(args?.key ?? '');
  let x = inDraft(d) ? runDraftClock(d, { now, rng }) : d;
  let result = null;
  switch (op) {
    case 'tick':
      break;
    case 'pick':
    case 'pass': {
      const c = onClock(x);
      if (!c || c.teamId !== teamId) throw new Error('dynasty: you are not on the clock');
      x = coachPick(x, teamId, op === 'pass' ? null : key(), { now, rng });
      break;
    }
    case 'offer': {
      // Free agency is sealed bids (dynastyBid); the exclusive windows and the
      // leftovers of the preseason are haggled, as alone.
      if (x.phase === DPHASE.freeAgency) throw new Error('dynasty: free agency is sealed bids — bid for them this week');
      const r = negotiate(x, teamId, key(), { dp: Number(args?.dp), years: Number(args?.years) });
      x = r.dynasty;
      result = r.result;
      break;
    }
    case 'renounce': x = renounce(x, teamId, key()); break;
    case 'signRookie': x = signRookie(x, teamId, key()); break;
    case 'waive': x = waive(x, teamId, key()); break;
    case 'claim': x = claimWaiver(x, teamId, key()); break;
    case 'unclaim': x = withdrawClaim(x, teamId, key()); break;
    case 'fill': x = fillRoster(x, teamId); break;
    case 'ready':
      x = setReady(x, teamId, args?.ready !== false);
      if (allReady(x) && canAdvance(x)) x = advancePhase(x, { rng, bids, now });
      break;
    case 'force':
      commissioner();
      if (inDraft(x)) x = runDraftClock(x, { now, rng, force: true });
      else if (canAdvance(x)) x = advancePhase(x, { rng, bids, now });
      else throw new Error('dynasty: the season is still being played');
      break;
    case 'end':
      commissioner();
      x = endDynasty(x);
      break;
    case 'tradeAi': {
      const deal = clean({ ...(args?.deal ?? {}), from: teamId });
      const partner = teamOf(x, deal.to);
      if (!partner) throw new Error('dynasty: no such team');
      if (partner.human) throw new Error('dynasty: a trade with a coach is an offer they answer');
      x = makeTrade(x, deal);
      break;
    }
    case 'propose': x = proposeTrade(x, { ...(args?.deal ?? {}), from: teamId }, { id, now }); break;
    case 'respond': x = respondTrade(x, String(args?.id ?? ''), teamId, args?.accept === true, { now }); break;
    case 'withdraw': x = withdrawTrade(x, String(args?.id ?? ''), teamId, { now }); break;
    case 'veto':
      commissioner();
      x = vetoTrade(x, String(args?.id ?? ''), { now });
      break;
    case 'setDeck': {
      // The deck itself is checked by the server against the strategy cards.
      const deck = args?.deck && typeof args.deck === 'object' ? args.deck : null;
      const deckName = deck ? (String(args?.deckName ?? '').slice(0, 40) || null) : null;
      const put = t => (t.id === teamId ? { ...t, deck, deckName } : t);
      x = { ...x, teams: x.teams.map(put), season: x.season ? { ...x.season, teams: x.season.teams.map(put) } : x.season };
      break;
    }
    default:
      throw new Error(`dynasty: no such move ${op}`);
  }
  return { dynasty: x, result };
}
