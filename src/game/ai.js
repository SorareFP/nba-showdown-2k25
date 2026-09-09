// src/game/ai.js
// NBA Showdown 2026 — AI Decision Engine
// Pure functions: takes game state + team key, returns an action object.
// No React, no side effects. Used by tutorial, solo mode, sim-to-end.

import { getTeam, getOpp, getPS, calcAdv, getFatigue, fatigueForMinutes, restMinutes, SPEND_COSTS, clutchAvailable, clutchEligible, burnedSlots, satOutLast, canRollSlot, extraRollPending, checkNeed, crunchSearchOptions } from './engine.js';
import { lookupChart } from './cards.js';
import { canPlayCard, helpTargets, staggerPair } from './canPlay.js';
import { getStrat, STRATS, CRUNCH_CARDS } from './strats.js';

/**
 * AI action types:
 *   { type: 'draft_pick', playerId }
 *   { type: 'set_matchups', matchups: [defIdx, ...] }
 *   { type: 'play_card', cardId, opts }
 *   { type: 'pass' }
 *   { type: 'roll', playerIdx }
 *   { type: 'end_section' }
 *   { type: 'spend_assist', spendType, playerIdx }
 *   { type: 'spend_rebound', rebType, playerIdx }
 */

// ── Draft Decision ──────────────────────────────────────────────────────────
//
// ── WHAT A LINEUP PICK IS WORTH ─────────────────────────────────────────────
//
// The old score was raw attributes with a flat fatigue deduction. A star's
// attributes run to forty-odd, so a star at −6 still beat a fresh bench player
// on paper and the AI played Kawhi through it. A −6 on a d20 is a third of the
// die; on most charts it is a whole tier.
//
// So a pick is valued by what the CHART pays at the roll the player would
// carry — fatigue and markers summed exactly as doRoll sums them, so three hot
// markers cancel a −6 here as they do there. Output alone is not enough,
// though: calibrated against real cards, a star at −6 still out-produces a
// $350 bench player THIS section. What a coach weighs is the next one too.
// Play him now and he is at −12 next section; rest him now and he is fresh —
// but resting clears his hot markers, which the engine does on the bench. So
// the score carries half of that difference. Against real cards that lands the
// cadence the minute maths was built for: a star plays at 0, 4 and (barely) 8
// minutes, rests at 12, and plays at 12 if he is carrying three hot markers.
//
// Attributes still count, at a small fraction: speed and power decide matchup
// advantage, which is a roll bonus the chart cannot see because the opponent's
// lineup is not known yet.

/** Average points a card pays over a d20 carrying `mod`; rebounds and assists at half. */
export function expectedOutput(card, mod = 0) {
  if (!Array.isArray(card?.chart) || card.chart.length === 0) return 0;
  let total = 0;
  for (let die = 1; die <= 20; die += 1) {
    const t = lookupChart(card, die + mod);
    total += (t.pts || 0) + 0.5 * (t.reb || 0) + 0.5 * (t.ast || 0);
  }
  return total / 20;
}

const SECTION_MINUTES = 4;
const HORIZON = 0.5;
/** Points a section charged per point of fatigue penalty beyond −6 — see lineupValue. */
const WORN_PER_POINT = 0.15;
/** How far a card's value can wobble before the sort — see aiScoringDecision. */
const CARD_JITTER = 0.3;
/** Expected points a spend check is worth taking at once (a 30% three), and at a doubled surplus — see aiSpendDecision. */
const SPEND_GOOD = 0.9;
const SPEND_FLOOR = 0.45;
/** What the cards that spend assists need — the coach keeps that much back. */
const ASSIST_COST = { cross_court_dime: 3, pick_and_pop: 2, anticipate_pass: 1, crash_and_kick: 1, three_point_barrage: 1 };

/** The pick's score: this section's output, half of next section's swing, a little body. */
export function lineupValue(player, ps) {
  const min = ps?.minutes || 0;
  const markers = ps ? ((ps.hot || 0) - (ps.cold || 0)) * 2 : 0;

  const now = expectedOutput(player, fatigueForMinutes(min) + markers);
  const nextIfPlayed = expectedOutput(player, fatigueForMinutes(min + SECTION_MINUTES) + markers);
  const nextIfRested = expectedOutput(player, fatigueForMinutes(restMinutes(min))); // markers gone

  const body = 0.05 * (player.speed + player.power + (player.defBoost || 0));
  const shoot = 0.1 * ((player.threePtBoost || 0) + (player.paintBoost || 0));

  // A COLD MARKER DOES NOT WEAR OFF; ONLY THE BENCH CLEARS IT. Fatigue is a
  // curve the next section moves along, but a cold player stays cold for
  // every section he keeps playing, so the swing between "play him" and "rest
  // him" is not half of one section, it is at least a whole one. Jalen Suggs
  // took the floor at -2 and cold when a section on the bench would have
  // cleared both (the user, 2026-09-07: "resting would have ... likely been a
  // longer-term smart play"). Weighting the lookahead fully when a cold marker
  // is on him is what makes the pick see that.
  // DEEP FATIGUE IS A COST THE CHART CANNOT SHOW. Past −12 a d20 lands on
  // the chart's bottom row almost every time, so `now`, `nextIfPlayed` and
  // `nextIfRested` all sit on the same floor and the swing reads as nothing
  // — one more section looked free, and a star's attributes (`body`,
  // `shoot`) kept him on the floor for a whole half (the user, 2026-09-09:
  // "Giannis has played the entire 20 minutes … the AI keeps playing him").
  // Two answers: the lookahead is weighted in full once he is that tired,
  // as it is for a cold marker, and every point of penalty beyond −6 is
  // charged directly, so the deeper he goes the more a fresh body wins.
  const fatNow = fatigueForMinutes(min);
  const horizon = (ps?.cold || 0) > 0 || fatNow <= -12 ? 1 : HORIZON;
  const worn = WORN_PER_POINT * Math.max(0, -fatNow - 6);
  return now + horizon * (nextIfPlayed - nextIfRested) + body + shoot - worn;
}

export function aiDraftPick(game, teamKey) {
  const pool = teamKey === 'A' ? game.draft.aPool : game.draft.bPool;
  if (!pool || pool.length === 0) return null;

  const scored = pool.map(player => ({
    player,
    score: lineupValue(player, getPS(game, teamKey, player.id)),
  }));
  scored.sort((a, b) => b.score - a.score);
  return { type: 'draft_pick', playerId: scored[0].player.id };
}

// ── Matchup Assignment ──────────────────────────────────────────────────────
// Assign defenders to minimize opponent's total roll bonus.
// Greedy: for each opponent starter, assign the best available defender.
/**
 * ASSIGN THE DEFENCE — every assignment scored by what it actually does.
 *
 * ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
 *
 * The old version ranked the opponent by threat and, for each, took the
 * defender with the best `speed + power + 3·defBoost`. The opponent's own
 * numbers were subtracted in the score but were the same for every candidate
 * defender, so they never changed the choice: it was a sorted pairing, best
 * remaining body onto biggest remaining threat, blind to FIT. A fast guard and
 * a slow centre with the same total were interchangeable to it. And when a
 * draft leaves both rosters in rough strength order, sorted pairing IS the
 * identity — which is why the AI looked like it never moved anyone.
 *
 * ── WHAT THIS DOES ──────────────────────────────────────────────────────────
 *
 * `calcAdv` is the engine's own verdict on one attacker against one defender:
 * the die modifier that roll will carry, temporary boosts on both sides
 * included. Five against five is 120 assignments, cheap enough to score every
 * one and keep the best — the one that gives the opponent the smallest total
 * modifier, weighted by salary so a +2 handed to their star costs more than a
 * +2 handed to their twelfth man. A penalty (negative modifier) is a gain.
 * Ties break toward the smaller worst case, so two equal totals prefer the
 * one without a blowout.
 *
 * Returns `matchups[i]` = index of MY starter guarding THEIR attacker in slot
 * i, the shape applyMatchups writes and doRoll reads.
 */
export function aiSetMatchups(game, teamKey) {
  const myT = getTeam(game, teamKey);
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const oppT = getTeam(game, oppKey);

  const attackers = oppT?.starters || [];
  const defenders = myT?.starters || [];
  const n = Math.min(attackers.length, defenders.length);
  if (n === 0) return null;

  const tempEff = game.tempEff?.[oppKey] || {};
  const tempDefEff = game.tempDefEff?.[teamKey] ?? null;
  const meanSal = attackers.reduce((t, p) => t + (p?.salary || 0), 0) / n || 1;

  // cost[a][d]: what attacker a gets against defender d, star-weighted.
  const cost = attackers.slice(0, n).map((att, a) =>
    defenders.slice(0, n).map((def, d) => {
      if (!att || !def) return 0;
      const adv = calcAdv(att, def, tempEff, a, tempDefEff, d);
      const weight = 0.5 + 0.5 * ((att.salary || meanSal) / meanSal);
      return adv.rollBonus * weight;
    })
  );

  let best = null;
  let bestTotal = Infinity;
  let bestWorst = Infinity;
  const perm = new Array(n);
  const used = new Array(n).fill(false);
  const walk = (a, total, worst) => {
    if (a === n) {
      if (total < bestTotal - 1e-9 || (Math.abs(total - bestTotal) < 1e-9 && worst < bestWorst)) {
        best = perm.slice();
        bestTotal = total;
        bestWorst = worst;
      }
      return;
    }
    for (let d = 0; d < n; d += 1) {
      if (used[d]) continue;
      used[d] = true;
      perm[a] = d;
      walk(a + 1, total + cost[a][d], Math.max(worst, cost[a][d]));
      used[d] = false;
    }
  };
  walk(0, 0, -Infinity);

  return { type: 'set_matchups', matchups: best };
}

// ── Placement: which player takes the floor next ────────────────────────────
//
// THE SNAKE IS A SMALL GAME AND THE AI PLAYS IT OUT. Ten placements,
// A-B-B-A-A-B-B-A-A-B, and the row a player lands in is the pairing he
// keeps all section. The old pick scored one row at a time — its edge minus
// theirs in roll bonus — and so answered a scrub with its best defender if
// that pairing scored highest, leaving the star that came next to whoever was
// left. It also valued a +3 the same on every chart, when a +3 is worth a
// point a section to a star and next to nothing to a bench body.
//
// Now every remaining way the rows can fall is searched: the AI picks to
// maximise the sum of pairValue over the five rows, the opponent is assumed
// to pick to minimise it, and what a pairing is worth is POINTS — each side's
// chart read at the roll it would carry, fatigue and markers included. At
// most one row is ever open (the snake alternates lead and answer), so the
// state is two bitmasks and the open player: a few hundred positions, memoised.

/** The roll a player carries into this section from fatigue and markers, as doRoll adds them. */
function carriedMod(game, teamKey, player) {
  const ps = getPS(game, teamKey, player?.id);
  const min = ps?.minutes || 0;
  const markers = ps ? ((ps.hot || 0) - (ps.cold || 0)) * 2 : 0;
  return fatigueForMinutes(min) + markers;
}

/**
 * What one row is worth to `myKey`, in points a section: my player's chart at
 * the bonus he carries against theirs, less their chart at the bonus they
 * carry against mine. A hair of the raw bonus difference breaks ties between
 * flat charts — the bonus also gates cards (Mismatch Hunter, Unethical Hoops)
 * and decides the shot-check contest, which the chart cannot show.
 */
export function pairValue(game, myKey, mine, theirs, tempEff = {}, myIdx = 0) {
  if (!mine || !theirs) return 0;
  const oppKey = myKey === 'A' ? 'B' : 'A';
  const myAdv = calcAdv(mine, theirs, tempEff, myIdx);
  const theirAdv = calcAdv(theirs, mine, {}, 0);
  const myPts = expectedOutput(mine, myAdv.rollBonus + carriedMod(game, myKey, mine));
  const theirPts = expectedOutput(theirs, theirAdv.rollBonus + carriedMod(game, oppKey, theirs));
  return myPts - theirPts + 0.05 * (myAdv.rollBonus - theirAdv.rollBonus);
}

const DEFAULT_ORDER = ['A', 'B', 'B', 'A', 'A', 'B', 'B', 'A', 'A', 'B'];

/**
 * Every remaining placement for `teamKey`, scored by the search: the value of
 * the whole snake from here if this player takes the floor now and both
 * sides play the rest out. Sorted best first. Exported so the tutorial can
 * say why the coach chose what it chose.
 */
export function placementChoices(game, teamKey) {
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const myT = getTeam(game, teamKey);
  const oppT = getTeam(game, oppKey);
  const remainingFor = key => {
    const t = getTeam(game, key);
    const picks = key === 'A' ? game.draft?.aPicks ?? [] : game.draft?.bPicks ?? [];
    const placed = new Set((t.starters || []).map(pl => pl.id));
    return picks.filter(id => !placed.has(id)).map(id => (t.roster || []).find(r => r.id === id)).filter(Boolean);
  };
  const mine = remainingFor(teamKey);
  if (!mine.length) return [];
  const theirs = remainingFor(oppKey);
  const order = game.placementOrder || DEFAULT_ORDER;
  const step = game.placementStep ?? (myT.starters.length + oppT.starters.length);
  // The steps after this one. The first must be mine for the scores to mean
  // "if I place this now"; a caller asking out of turn is scored as if it were.
  const ahead = order.slice(step);
  const steps = ahead.length && ahead[0] === teamKey ? ahead.slice(1) : ahead;

  // Pairing values, from my chair, for every remaining pair — and for the
  // row the opponent has already led, if they are a player ahead of me.
  const val = mine.map(m => theirs.map(o => pairValue(game, teamKey, m, o)));
  const openOpp = oppT.starters.length > myT.starters.length ? oppT.starters[myT.starters.length] : null;
  const openVal = openOpp ? mine.map(m => pairValue(game, teamKey, m, openOpp)) : null;

  const memo = new Map();
  const bits = mask => { const out = []; for (let i = 0; mask >> i; i += 1) if (mask & (1 << i)) out.push(i); return out; };
  const solve = (si, mMask, oMask, open) => {
    if (si >= steps.length) return 0;
    const key = `${si}|${mMask}|${oMask}|${open ? open.side + open.idx : '-'}`;
    if (memo.has(key)) return memo.get(key);
    const mover = steps[si];
    let best;
    if (mover === teamKey) {
      const cands = bits(mMask);
      if (!cands.length) best = solve(si + 1, mMask, oMask, open);
      else {
        best = -Infinity;
        for (const m of cands) {
          const answering = open && open.side === 'opp';
          const gain = answering ? (open.idx === -1 ? openVal[m] : val[m][open.idx]) : 0;
          const v = gain + solve(si + 1, mMask & ~(1 << m), oMask, answering ? null : { side: 'me', idx: m });
          if (v > best) best = v;
        }
      }
    } else {
      const cands = bits(oMask);
      if (!cands.length) best = solve(si + 1, mMask, oMask, open);
      else {
        best = Infinity;
        for (const o of cands) {
          const answering = open && open.side === 'me';
          const gain = answering ? val[open.idx][o] : 0;
          const v = gain + solve(si + 1, mMask, oMask & ~(1 << o), answering ? null : { side: 'opp', idx: o });
          if (v < best) best = v;
        }
      }
    }
    memo.set(key, best);
    return best;
  };

  const mMask0 = (1 << mine.length) - 1;
  const oMask0 = (1 << theirs.length) - 1;
  const answering = Boolean(openOpp);
  const out = mine.map((player, m) => {
    const gain = answering ? openVal[m] : 0;
    const v = gain + solve(0, mMask0 & ~(1 << m), oMask0, answering ? null : { side: 'me', idx: m });
    return { player, value: v, rowValue: answering ? openVal[m] : null, answering };
  });
  out.sort((a, b) => b.value - a.value);
  return out;
}

/**
 * `iq` (0..1, default 1) is the difficulty's first lever (aiLevels.js): the
 * chance this placement is the search's best answer; otherwise it is any
 * remaining player. Math.random, so the sims' seeded rng reproduces it.
 */
export function aiPlacementPick(game, teamKey, { iq = 1 } = {}) {
  const choices = placementChoices(game, teamKey);
  if (!choices.length) return null;
  const pick = iq >= 1 || Math.random() < iq
    ? choices[0]
    : choices[Math.floor(Math.random() * choices.length)];
  return { type: 'place_player', playerId: pick.player.id, value: pick.value, best: pick === choices[0] };
}

// ── Conversion spends ───────────────────────────────────────────────────────
//
// The sim harness proved the value (the conversion channel is ~10% of all
// scoring) and the live AI never touched it — no spendAssist caller existed
// anywhere in this file. One decision per call, greedy: threes ahead of paint
// by the best boost in the lineup, rebound paint-checks when the section
// published one. The caller loops until null.
export function aiSpendDecision(game, teamKey) {
  const team = getTeam(game, teamKey);
  if (!team?.starters?.length) return null;
  // Any player may take a spend check now (2026-09-09); the AI nominates the
  // best CHANCE on the floor — checkNeed's reading of bonus, contest and
  // markers against the Shot Line — and spends only when the check is
  // worth the currency: about a point of expected scoring per five spent.
  const bestChance = type => {
    let out = null;
    team.starters.forEach((p, i) => {
      if (!p) return;
      const n = checkNeed(game, teamKey, i, type);
      if (!out || n.pHit > out.pHit) out = { idx: i, pHit: n.pHit };
    });
    return out;
  };
  // ASSISTS ARE WORTH NOTHING IN THE BANK. The first cut of this spent only
  // on a ≥30% three or a ≥45% paint check; against real lineups the paint
  // bar was never met and a third of lineups never met the three bar, so a
  // coach with poor shooters sat on eleven assists all game (the user,
  // 2026-09-09). Now: the best check by expected points, taken whenever it
  // is worth a modest floor — and at twice the cost, taken regardless. An
  // assist to spare beyond the cost is banked as a +1 on that player first.
  // BUT ASSISTS FUND CARDS TOO. Cross-Court Dime costs three, Pick-and-Pop
  // two, Anticipate the Pass, Crash and Kick and Three-Point Barrage's extra
  // check one each — and a 600-game duel of a spend-everything policy lost
  // 45% to the hoarder, because those plays are worth more per assist than
  // a weak check. So: keep what the cards in hand need, and spend what is
  // left in tiers — a good check at once, a fair one when the surplus is
  // twice the cost, anything at three times, so nothing sits forever.
  const ast = team.assists ?? 0;
  const reserve = Math.max(0, ...(team.hand || []).map(id => ASSIST_COST[id] || 0));
  const surplus = ast - reserve;
  const three = bestChance('3pt');
  const paint = bestChance('paint');
  const choices = [];
  if (three) choices.push({ spendType: '3pt', idx: three.idx, ev: three.pHit * 3, cost: SPEND_COSTS.assistThree });
  if (paint) choices.push({ spendType: 'paint', idx: paint.idx, ev: paint.pHit * 2, cost: SPEND_COSTS.assistPaint });
  choices.sort((a, b) => b.ev - a.ev);
  const best = choices.find(c => ast >= c.cost);
  if (best) {
    const floor = surplus >= 3 * best.cost ? 0 : surplus >= 2 * best.cost ? SPEND_FLOOR : SPEND_GOOD;
    if (surplus >= best.cost && best.ev >= floor) return { type: 'spend_assist', spendType: best.spendType, playerIdx: best.idx };
  }
  const bonuses = game.reboundBonuses?.[teamKey];
  if ((team.rebounds ?? 0) >= SPEND_COSTS.reboundPaint && bonuses?.paintCheck && paint) {
    // The rebound check is a reward for winning the glass: always worth taking.
    return { type: 'spend_rebound', rebType: 'paint_check', playerIdx: paint.idx };
  }
  return null;
}

// ── Scoring Phase: Card or Pass ─────────────────────────────────────────────
// Evaluate all playable cards in hand, score them, play the best one or pass.
export function aiScoringDecision(game, teamKey, opts = {}) {
  const team = getTeam(game, teamKey);
  const hand = team.hand || [];

  // Find all playable cards with their value
  const playable = [];

  for (const cardId of hand) {
    const check = canPlayCard(game, teamKey, cardId);
    if (!check.canPlay) continue;

    const strat = getStrat(cardId);
    if (!strat) continue;

    // Only consider cards for the current game context
    const value = evaluateCard(game, teamKey, cardId, strat, opts);
    if (value > 0) {
      playable.push({ cardId, value, strat });
    }
  }

  if (playable.length === 0) return { type: 'pass' };

  // A MIXED STRATEGY. evaluateCard is very nearly a fixed table, so with a
  // straight sort the AI played the same card from the same hand every time
  // and a player could read its whole sequence after two games (the user,
  // 2026-09-07: "playing cards in the same order no matter what"). Each value
  // is jittered by up to ±15% before the sort: cards within a few points of
  // each other trade places game to game, a clearly better card still wins.
  // Math.random here is the same stream the sim harness seeds, so audits stay
  // reproducible.
  for (const c of playable) c.value *= 1 + (Math.random() - 0.5) * CARD_JITTER;
  playable.sort((a, b) => b.value - a.value);
  const best = playable[0];

  // Build opts for the chosen card
  const cardOpts = aiBuildCardOpts(game, teamKey, best.cardId);

  return { type: 'play_card', cardId: best.cardId, opts: cardOpts };
}

// ── Card Value Evaluation ───────────────────────────────────────────────────
/**
 * Would Switch Everything actually MOVE anybody? The AI sets its defence at
 * the start of every section (aiSetMatchups), so the "best" assignment the
 * card would apply is usually the one already on the floor — and the card's
 * cost, doubling every opponent advantage, is paid either way. The 600-game
 * audit had it played 400 times, nearly all for nothing. It is worth playing
 * only when the opponent's screen or a mid-section boost has left the current
 * assignment behind.
 */
export function switchEverythingChanges(game, teamKey) {
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const best = aiSetMatchups(game, teamKey)?.matchups;
  if (!best) return false;
  const now = game.offMatchups?.[oppKey] || [0, 1, 2, 3, 4];
  return best.some((d, i) => d !== now[i]);
}

/**
 * THE SCREEN AND ITS CANCELLERS ARE JUDGED IN POINTS, not from a table.
 *
 * High Screen & Roll used to be a flat 6 with a fallback swap of slots 0 and
 * 1 when no swap gained — the AI played a switch against itself. Go Under,
 * Fight Over and Veer Switch were a flat 7/6/6 whenever the opponent had
 * switched at all, so the coach cancelled switches that had cost it nothing
 * and paid Go Under's free three for the privilege. Both now read the
 * pairings before and after through pairValue's arithmetic:
 *
 *   bestScreen        the swap of two of MY attackers' defenders that gains
 *                     the most points a section; nothing → the card is not
 *                     worth a turn
 *   switchCancelValue what THEIR screen bought them, and what each canceller
 *                     would take back net of its price (Fight Over's +2 to
 *                     the faster attacker, Go Under's 3PT check at +2,
 *                     Veer's keep-or-trade)
 *
 * `opts.demo` (the tutorial) makes a canceller always worth playing, so the
 * lesson that shows one lands every time.
 */
const CANCELLERS = ['go_under', 'fight_over', 'veer_switch'];
/** Points a section a switch (or its cancel) must be worth before a card goes on it. */
const SWITCH_FLOOR = 0.4;
const pointsFor = (game, offKey, p, slot, def, extra = 0) => {
  if (!p || !def) return 0;
  const eff = game.tempEff?.[offKey] || {};
  return expectedOutput(p, calcAdv(p, def, eff, slot).rollBonus + carriedMod(game, offKey, p) + extra);
};

/** My best High Screen & Roll: the two of my attackers whose defenders, traded, pay most. */
export function bestScreen(game, teamKey) {
  const myT = getTeam(game, teamKey);
  const oppT = getOpp(game, teamKey);
  const starters = myT.starters || [];
  const mu = game.offMatchups?.[teamKey] || [0, 1, 2, 3, 4];
  let best = null;
  for (let i = 0; i < starters.length; i += 1) {
    for (let j = i + 1; j < starters.length; j += 1) {
      const di = mu[i] ?? i, dj = mu[j] ?? j;
      const now = pointsFor(game, teamKey, starters[i], i, oppT.starters[di]) + pointsFor(game, teamKey, starters[j], j, oppT.starters[dj]);
      const swapped = pointsFor(game, teamKey, starters[i], i, oppT.starters[dj]) + pointsFor(game, teamKey, starters[j], j, oppT.starters[di]);
      const delta = swapped - now;
      if (!best || delta > best.delta) best = { i, j, delta };
    }
  }
  return best;
}

/**
 * The 3PT check Go Under hands the offence — and THE OFFENCE CHOOSES who
 * takes it (2026-09-09), so its price to the defence is the BETTER shooter's
 * expected points. The check is at +2 less the restored defender's contest.
 * Returns the offence's best slot and what it is worth.
 */
export function goUnderPrice(game, offKey, slots, defs) {
  const offT = getTeam(game, offKey);
  let best = null;
  slots.forEach((slot, k) => {
    const p = offT.starters[slot];
    if (!p) return;
    const def = defs[k];
    const contest = Math.max(0, (def?.defBoost || 0)) + ((def?.defBoost || 0) > 0 && game.crunch?.active ? 1 : 0);
    const ps = getPS(game, offKey, p.id);
    const bonus = 2 - contest + (p.threePtBoost || 0) + (ps ? ((ps.hot || 0) - (ps.cold || 0)) * 2 : 0);
    const need = (p.shotLine || 99) - bonus;             // the die it takes
    const pHit = Math.min(1, Math.max(0, (21 - need) / 20));
    const pts = 3 * pHit;
    if (!best || pts > best.pts) best = { slot, pts };
  });
  return best ?? { slot: slots[0], pts: 0 };
}

/** The offence's answer to a waiting Go Under: the shooter with the best chance, by checkNeed. */
export function aiGoUnderChoice(game, teamKey) {
  const pc = game.pendingChoice;
  if (!pc || pc.kind !== 'go_under' || pc.teamKey !== teamKey) return null;
  let best = null;
  for (const slot of pc.slots) {
    const n = checkNeed(game, teamKey, slot, '3pt');
    const pHit = Math.min(1, Math.max(0, (21 - (n.need - pc.extra)) / 20));
    if (!best || pHit > best.pHit) best = { slot, pHit };
  }
  return best ? best.slot : pc.slots[0];
}

/**
 * From the defence's chair: what the offence's screen bought them (`gain`)
 * and what this canceller takes back net of its price (`saved`), both in
 * points a section. Zero when there is nothing to answer.
 */
export function switchCancelValue(game, teamKey, cardId) {
  const lc = game.lastMatchupCard;
  if (!lc?.opts || lc.teamKey === teamKey) return { gain: 0, saved: 0 };
  const offKey = lc.teamKey;
  const offT = getTeam(game, offKey);
  const myT = getTeam(game, teamKey);
  const { swapSlot1: s1, swapSlot2: s2, origD1: d1, origD2: d2 } = lc.opts;
  const p1 = offT.starters[s1], p2 = offT.starters[s2];
  const D1 = myT.starters[d1], D2 = myT.starters[d2];
  if (!p1 || !p2 || !D1 || !D2) return { gain: 0, saved: 0 };
  const before = pointsFor(game, offKey, p1, s1, D1) + pointsFor(game, offKey, p2, s2, D2);   // as placed
  const after = pointsFor(game, offKey, p1, s1, D2) + pointsFor(game, offKey, p2, s2, D1);    // after their screen
  const gain = after - before;
  let left = before;
  if (cardId === 'fight_over') {
    const fast = (p1.speed || 0) >= (p2.speed || 0) ? [p1, s1, D1] : [p2, s2, D2];
    left = before - pointsFor(game, offKey, ...fast) + pointsFor(game, offKey, ...fast, 2);
  } else if (cardId === 'go_under') {
    left = before + goUnderPrice(game, offKey, [s1, s2], [D1, D2]).pts;
  } else if (cardId === 'veer_switch') {
    left = Math.min(before, after);
  }
  return { gain, saved: after - left };
}

function evaluateCard(game, teamKey, cardId, strat, opts = {}) {
  const phase = game.phase;
  if (cardId === 'switch_everything' && !switchEverythingChanges(game, teamKey)) return 0;
  if (cardId === 'high_screen_roll') {
    if (phase !== 'matchup_strats') return 0;
    const sc = bestScreen(game, teamKey);
    return sc && sc.delta >= SWITCH_FLOOR ? Math.min(10, 3 + 2 * sc.delta) : 0;
  }
  if (CANCELLERS.includes(cardId)) {
    if (opts.demo) return 7;
    const { saved } = switchCancelValue(game, teamKey, cardId);
    return saved >= SWITCH_FLOOR ? Math.min(10, 3 + 2 * saved) : 0;
  }
  // COACH'S CHALLENGE RE-ROLLS THE OTHER SIDE'S LAST CHECK. A re-roll of a
  // miss can only turn it into a make (the user, 2026-09-09: "AI played
  // coach's challenge on my miss, which converted into a make"). Only a make
  // is worth challenging, and a three more than a two.
  if (cardId === 'coaches_challenge') {
    const lsc = game.lastShotCheck;
    if (!lsc || lsc.teamKey === teamKey || !lsc.result?.hit) return 0;
    return 4 + (lsc.pts || 0);
  }

  // Phase gating — matchup cards only in matchup phase, etc.
  if (strat.phase === 'matchup' && phase !== 'matchup_strats') return 0;
  if (strat.phase === 'scoring' && phase !== 'scoring') return 0;
  if (strat.phase === 'pre_roll' && phase !== 'scoring') return 0;
  if (strat.phase === 'post_roll' && phase !== 'scoring') return 0;
  if (strat.phase === 'reaction') {
    // Reactions are ordinary plays on your own turn when their state
    // condition holds (canPlayCard already said yes before this runs) — the
    // old hard zero here is why the audit found the entire canceller economy
    // dead even after switch cards came alive.
    const reactionValues = {
      go_under: 7, fight_over: 6, veer_switch: 6, burned_switch: 5,
      offensive_foul: 5, cold_spell: 6, anticipate_pass: 5, overhelp: 5,
      offensive_board: 5, rebound_tap_out: 5, coaches_challenge: 6, close_out: 6,
      // Wave one (2026-09-06)
      find_the_open_man: 7, putback_specialist: 6, rim_protector: 7, drop_coverage: 5,
      smothering_defense: 5, denial: 4, hustle_play: 5, glass_cleaner: 6, box_out: 6,
      help_defender: 7,
    };
    return reactionValues[cardId] ?? 4;
  }

  // Base values by card type
  const values = {
    // Matchup phase
    high_screen_roll: 6,
    stagger_action: 7,
    second_wind: 5,
    chip_on_shoulder: 6,
    defensive_stopper: 7,
    pick_up_full_court: 5,

    // Pre-roll
    ghost_screen: 5,
    you_stand_over_there: 7,
    putback_dunk: 8,
    pin_down_screen: 6,
    turnover: 4,

    // Scoring
    green_light: 8,
    from_way_downtown: 4,
    catch_and_shoot: 5,
    elevator_doors: 6,
    bully_ball: 7,
    power_move: 4,
    and_one: 6,
    rimshaker: 7,
    drive_the_lane: 5,
    uncontested_layup: 8,
    back_to_basket: 5,
    cross_court_dime: 7,
    energy_injection: 4,
    crowd_favorite: 4,   // fires now (was 5+ with no reader)
    switch_everything: 6,
    this_is_my_house: 8,
    delayed_slip: 4,
    double_team: 6,

    // Crunch Time (canPlay gates them to the window; riders to the timeout)
    desperation_press: 8,
    second_closer: 7,
    ato_masterpiece: 8,
    fresh_legs: 6,
    ice_the_hot_hand: 7,
    reset: 6,

    // Wave one (2026-09-06)
    spain_pick_roll: 6, mismatch_hunter: 6, strength_in_numbers: 8, energizer: 5,
    defensive_identity: 6, defensive_anchor: 6, swarming_defense: 5,
    five_out: 6, hammer_set: 4, iso_heavy: 5, three_point_barrage: 8, crash_and_kick: 5,
    pick_and_pop: 5, extra_pass: 4, lob_city: 8, stretch_five: 6, post_domination: 6,
    unsung_hero: 6, transition_outlet: 5,
    // Wave two (2026-09-07). Outside Pick costs a card, so it is priced under
    // the free threes; Maestro is high because a 5+ mismatch is the best paint
    // check in the game; Inside-Out is a free three off a bucket you already
    // have; Short-Roll is a slow burn that only pays if the big scores inside.
    outside_pick: 6, pick_and_roll_maestro: 8, inside_out: 7, short_roll_playmaker: 5,
    // The standing pair are worth more than one play, because they are not one
    // play — they come back every period until a big sits down.
    run_the_floor: 9, twin_towers: 9,
    // Two near-certain points in the section that decides the game.
    unethical_hoops: 8,
    // Post-roll
    heat_check: 7,
    burst_of_momentum: 6,
    flare_screen: 7,

    // Defensive scoring
    dogged: 4,
    offensive_board: 5,
    rebound_tap_out: 5,
  };

  // A called timeout exists FOR its riders: while your own window is open
  // they outrank everything else in hand, or the window closes unspent.
  if (game.timeoutActive === teamKey
    && ['ato_masterpiece', 'fresh_legs', 'ice_the_hot_hand', 'reset'].includes(cardId)) {
    return (values[cardId] || 3) + 4;
  }
  return values[cardId] || 3;
}

// ── Build Card Options ──────────────────────────────────────────────────────
// For cards that need player selection, pick the best target.
export function aiBuildCardOpts(game, teamKey, cardId) {
  const myT = getTeam(game, teamKey);
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const oppT = getOpp(game, teamKey);
  const starters = myT.starters || [];
  const rolls = game.rollResults[teamKey] || [];
  // A shut-out slot (This Is My House) is never a target for a roll-replacer.
  const blocked = game.blockedRolls?.[teamKey] || {};

  if (!starters.length) return {};

  switch (cardId) {
    case 'high_screen_roll': {
      // THE OPTS CONTRACT IS swapSlot1/swapSlot2 — playerIdx was a drift that
      // made every AI attempt fail at execCard, which is why the audit found
      // the game's flagship switch card at zero plays and the whole
      // canceller economy dead behind it. And rather than blindly swapping
      // the two worst matchups, evaluate every pair: the swap that gains the
      // most total roll bonus is the one a coach would call.
      // The swap is chosen in POINTS (bestScreen) — the same reading that
      // decided the card was worth playing. If nothing gains, evaluateCard
      // already priced the card at zero; the fallback here is for a caller
      // that forces it.
      const best = bestScreen(game, teamKey);
      if (!best || best.delta <= 0) return { swapSlot1: 0, swapSlot2: 1 };
      return { swapSlot1: best.i, swapSlot2: best.j };
    }

    case 'go_under':
      // The offence names the shooter now (resolveGoUnder); nothing to pick here.
      return {};

    case 'stagger_action': {
      // The pair canPlay found: a Speed-13 player and a DIFFERENT positive
      // shooter (the "Murray & Murray" and the "Brunson as a shooter" cases
      // both came from fallbacks here). No pair, no play — execCard refuses.
      const pair = staggerPair(starters);
      if (!pair) return { playerIdx: 0, player2Idx: 0 };
      return { playerIdx: pair.fast, player2Idx: pair.shooter };
    }

    case 'veer_switch': {
      // Keep the pair or trade it — the only two arrangements the card allows.
      // Trade when it lowers what the two screened attackers get, in total.
      const lc = game.lastMatchupCard;
      if (!lc?.opts) return {};
      const offT = getOpp(game, teamKey);
      const a1 = offT.starters[lc.opts.swapSlot1];
      const a2 = offT.starters[lc.opts.swapSlot2];
      const d1 = starters[lc.opts.origD1];
      const d2 = starters[lc.opts.origD2];
      if (!a1 || !a2 || !d1 || !d2) return {};
      // In points, not bonus: what the two attackers would score kept as
      // placed against traded — trade only when it holds them lower.
      const keep = pointsFor(game, lc.teamKey, a1, lc.opts.swapSlot1, d1) + pointsFor(game, lc.teamKey, a2, lc.opts.swapSlot2, d2);
      const trade = pointsFor(game, lc.teamKey, a1, lc.opts.swapSlot1, d2) + pointsFor(game, lc.teamKey, a2, lc.opts.swapSlot2, d1);
      return { veerSwap: trade < keep };
    }

    case 'overhelp': {
      // The +3 goes to the best attacker still to roll; salary is the price
      // the game puts on a chart, so it is the ranking used here.
      const rolled = game.rollResults?.[teamKey] || [];
      let best = -1;
      let bestSal = -1;
      starters.forEach((p, i) => {
        if (rolled[i] == null && (p?.salary || 0) > bestSal) { best = i; bestSal = p?.salary || 0; }
      });
      return { playerIdx: best >= 0 ? best : 0 };
    }

    case 'burned_switch': {
      // The slot the switch actually burned — the engine refuses any other.
      return { playerIdx: burnedSlots(game, game.lastDefSwitch)[0] ?? 0 };
    }

    case 'second_wind': {
      const worst = starters.reduce((best, p, i) => {
        const fat = getFatigue(game, teamKey, i);
        return fat < (best.fat || 0) ? { idx: i, fat } : best;
      }, { idx: 0, fat: 0 });
      return { playerIdx: worst.idx };
    }

    case 'chip_on_shoulder': {
      const cheapIdx = starters.findIndex(p => p.salary <= 250);
      return { playerIdx: cheapIdx >= 0 ? cheapIdx : 0 };
    }

    case 'defensive_stopper': {
      const freshIdx = starters.findIndex(p => satOutLast(game, teamKey, p));
      return { playerIdx: freshIdx >= 0 ? freshIdx : 0 };
    }

    case 'ghost_screen': {
      // Pick a Speed 12+ player with the worst penalty who hasn't rolled
      const candidates = starters.map((p, i) => {
        if (rolls[i] != null) return null;
        if (p.speed < 12) return null;
        const di = (game.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[di];
        if (!dp) return null;
        const adv = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
        if (!adv.hasPenalty) return null;
        return { idx: i, penalty: adv.rollBonus };
      }).filter(Boolean).sort((a, b) => a.penalty - b.penalty);
      return { playerIdx: candidates.length ? candidates[0].idx : 0 };
    }

    case 'green_light':
    case 'you_stand_over_there':
    case 'from_way_downtown':
    case 'catch_and_shoot':
    case 'elevator_doors': {
      // Pick best 3PT shooter who hasn't rolled — and is not shut out.
      const best = starters.reduce((b, p, i) => {
        if (rolls[i] != null && !rolls[i]?.isReplaced) return b;
        if (blocked[i]) return b;
        const tpb = p.threePtBoost || 0;
        return tpb > (b.boost || -99) ? { idx: i, boost: tpb } : b;
      }, { idx: 0, boost: -99 });
      return { playerIdx: best.idx };
    }

    case 'bully_ball': {
      // execCard re-checks the CHOSEN player's power ADVANTAGE, so picking by
      // raw power can nominate a star who is out-muscled in his matchup and
      // fail at the door (canPlay only asks whether SOMEONE has an edge).
      const best = starters.reduce((b, p, i) => {
        const di = (game.offMatchups?.[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[di];
        if (!dp) return b;
        const adv = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
        return adv.powerAdv > (b.adv || 0) ? { idx: i, adv: adv.powerAdv } : b;
      }, { idx: 0, adv: 0 });
      return { playerIdx: best.idx };
    }

    case 'back_to_basket': {
      // execCard needs the chosen player at Power 13+ WITH a Paint Bonus.
      const cand = starters.findIndex((p, i) => (rolls[i] == null && !blocked[i]) && p.power >= 13 && (p.paintBoost || 0) > 0);
      if (cand >= 0) return { playerIdx: cand };
      const any = starters.findIndex(p => p.power >= 13 && (p.paintBoost || 0) > 0);
      return { playerIdx: any >= 0 ? any : 0 };
    }

    case 'power_move': {
      // Pure buff, no exec gate — highest power still waiting to roll.
      const best = starters.reduce((b, p, i) => {
        if (rolls[i] != null) return b;
        return p.power > (b.pwr || 0) ? { idx: i, pwr: p.power } : b;
      }, { idx: 0, pwr: 0 });
      return { playerIdx: best.idx };
    }

    case 'and_one': {
      // Pick player with biggest advantage
      const best = starters.reduce((b, p, i) => {
        const di = (game.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[di];
        if (!dp) return b;
        const adv = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
        const maxAdv = Math.max(adv.speedAdv, adv.powerAdv);
        return maxAdv > (b.adv || 0) ? { idx: i, adv: maxAdv } : b;
      }, { idx: 0, adv: 0 });
      return { playerIdx: best.idx };
    }

    case 'drive_the_lane': {
      const best = starters.reduce((b, p, i) => {
        const di = (game.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[di];
        if (!dp) return b;
        const adv = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
        return adv.speedAdv > (b.adv || 0) ? { idx: i, adv: adv.speedAdv } : b;
      }, { idx: 0, adv: 0 });
      return { playerIdx: best.idx };
    }

    case 'uncontested_layup': {
      const candidate = starters.findIndex((p, i) => {
        const di = (game.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[di];
        if (!dp) return false;
        const adv = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
        return adv.speedAdv >= 2 && adv.powerAdv >= 2;
      });
      return { playerIdx: candidate >= 0 ? candidate : 0 };
    }

    case 'rimshaker': {
      const hotPwr = starters.findIndex(p => {
        const ps = getPS(game, teamKey, p.id);
        return p.power >= 13 && (ps?.hot || 0) > 0;
      });
      return { playerIdx: hotPwr >= 0 ? hotPwr : 0 };
    }

    case 'heat_check': {
      const topRoller = rolls.findIndex(r => r?.isTop);
      return { playerIdx: topRoller >= 0 ? topRoller : 0 };
    }

    case 'burst_of_momentum': {
      const topBig = rolls.findIndex(r => r?.isTop && (r?.pts || 0) >= 5);
      return { playerIdx: topBig >= 0 ? topBig : 0 };
    }

    case 'flare_screen': {
      const nat20 = rolls.findIndex(r => r?.die === 20);
      return { playerIdx: nat20 >= 0 ? nat20 : 0 };
    }

    case 'energy_injection': {
      const cheap = starters.reduce((acc, p, i) => {
        if (p.salary < 400) acc.push(i);
        return acc;
      }, []);
      return { playerIdx: cheap[0] || 0, player2Idx: cheap[1] || 1 };
    }

    case 'cross_court_dime': {
      // Best shooter overall
      const best = starters.reduce((b, p, i) => {
        const val = (p.threePtBoost || 0) + (p.paintBoost || 0);
        return val > (b.val || 0) ? { idx: i, val } : b;
      }, { idx: 0, val: 0 });
      return { playerIdx: best.idx };
    }

    case 'crowd_favorite': {
      const cheapIdx = starters.findIndex(p => p.salary <= 350);
      return { playerIdx: cheapIdx >= 0 ? cheapIdx : 0 };
    }

    case 'switch_everything': {
      // Use the matchup AI to figure out best defense
      const result = aiSetMatchups(game, teamKey);
      return result ? { assignments: result.matchups } : {};
    }

    case 'this_is_my_house': {
      // Find a defender who has higher Speed AND Power than their offensive matchup
      const oppMatchups = game.offMatchups[oppKey] || [];
      for (let oi = 0; oi < (oppT.starters || []).length; oi++) {
        const offP = oppT.starters[oi];
        const di = oppMatchups[oi] ?? oi;
        const defP = myT.starters[di];
        if (offP && defP && defP.speed > offP.speed && defP.power > offP.power) {
          return { playerIdx: oi }; // target the offensive player to block
        }
      }
      return { playerIdx: 0 };
    }

    case 'dogged': {
      const oppStarters = oppT.starters || [];
      const fatigued = oppStarters.findIndex((_, i) => getFatigue(game, oppKey, i) < 0);
      return { playerIdx: fatigued >= 0 ? fatigued : 0 };
    }

    case 'pin_down_screen': {
      // Discard worst card, pick best 3PT shooter
      const bestShooter = starters.reduce((b, p, i) => {
        return (p.threePtBoost || 0) > (b.boost || -99) ? { idx: i, boost: p.threePtBoost || 0 } : b;
      }, { idx: 0, boost: -99 });
      return { playerIdx: bestShooter.idx, discardIdx: 0 };
    }

    case 'putback_dunk': {
      const pwr14 = starters.findIndex(p => p.power >= 14);
      return { playerIdx: pwr14 >= 0 ? pwr14 : 0 };
    }

    case 'delayed_slip': {
      const eligible = starters.findIndex((p, i) => {
        if ((p.speed || 0) < 12 || (p.power || 0) < 10) return false;
        const di = (game.offMatchups[teamKey] || [])[i] ?? i;
        const dp = oppT.starters[di];
        if (!dp) return false;
        const adv = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
        return adv.rollBonus <= 0 && !adv.hasPenalty;
      });
      return { playerIdx: eligible >= 0 ? eligible : 0 };
    }

    case 'offensive_board': {
      // The second roll goes to the rolled player whose chart pays most at −2
      // against his defender — a steep chart, not the biggest body.
      let best = null;
      starters.forEach((p, i) => {
        if (!p || (rolls[i] == null && !blocked[i]) || extraRollPending(game, teamKey, i)) return;
        const dp = oppT.starters[(game.offMatchups?.[teamKey] || [])[i] ?? i];
        const bonus = dp ? calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i).rollBonus : 0;
        const v = expectedOutput(p, bonus + carriedMod(game, teamKey, p) - 2);
        if (!best || v > best.v) best = { idx: i, v };
      });
      return { playerIdx: best ? best.idx : 0 };
    }

    case 'rebound_tap_out': {
      const tpIdx = starters.findIndex(p => (p.threePtBoost || 0) > 0);
      return { playerIdx: tpIdx >= 0 ? tpIdx : 0 };
    }

    case 'turnover': {
      // Just needs to be played — targets cold opponent automatically
      return {};
    }

    case 'ato_masterpiece': {
      // Best converter, best channel: 3PT beats paint when both boosts exist.
      let bestAto = { i: 0, v: -99, type: '3pt' };
      starters.forEach((p, i) => {
        const t3 = (p.threePtBoost || 0) * 3;
        const tp = (p.paintBoost || 0) * 2;
        const v = Math.max(t3, tp);
        if (v > bestAto.v) bestAto = { i, v, type: t3 >= tp ? '3pt' : 'paint' };
      });
      return { playerIdx: bestAto.i, checkType: bestAto.type };
    }

    case 'fresh_legs': {
      const byMin = starters
        .map((p, i) => ({ i, min: getPS(game, teamKey, p.id)?.minutes || 0 }))
        .sort((a, b) => b.min - a.min);
      return { playerIdx: byMin[0]?.i ?? 0, player2Idx: byMin[1]?.i };
    }

    case 'ice_the_hot_hand': {
      let bestIce = { i: 0, hot: -1 };
      (oppT.starters || []).forEach((p, i) => {
        const hot = getPS(game, oppKey, p.id)?.hot || 0;
        if (hot > bestIce.hot) bestIce = { i, hot };
      });
      return { targetIdx: bestIce.i };
    }

    case 'reset': {
      let bestReset = { i: 0, cold: -1 };
      starters.forEach((p, i) => {
        const cold = getPS(game, teamKey, p.id)?.cold || 0;
        if (cold > bestReset.cold) bestReset = { i, cold };
      });
      return { playerIdx: bestReset.i };
    }

    case 'desperation_press':
    case 'second_closer': {
      return {};
    }

    case 'pick_up_full_court': {
      // Hound the star with the most tired legs: minutes weigh double so the
      // press pushes someone over a fatigue threshold, chart ceiling breaks ties.
      let best = { i: 0, score: -1 };
      (oppT.starters || []).forEach((p, i) => {
        if (!p) return;
        const ps = getPS(game, oppKey, p.id);
        const min = ps?.minutes || 0;
        const top = p.chart?.length ? p.chart[p.chart.length - 1].pts : 0;
        const score = min * 2 + top;
        if (score > best.score) best = { i, score };
      });
      return { targetIdx: best.i };
    }

    case 'double_team': {
      // Trap the biggest remaining threat — chart ceiling plus the roll
      // bonus they carry right now. The open man is the opponent's to find.
      const oppRolls = game.rollResults[oppKey] || [];
      const myMu = game.offMatchups?.[oppKey] || [];
      let best = { i: 0, threat: -99 };
      (oppT.starters || []).forEach((p, i) => {
        if (!p || oppRolls[i] != null) return;
        const dIdx = myMu[i] ?? i;
        const myDef = (getTeam(game, teamKey).starters || [])[dIdx];
        const rb = myDef ? calcAdv(p, myDef, game.tempEff?.[oppKey] || {}, i).rollBonus : 0;
        const top = p.chart?.length ? p.chart[p.chart.length - 1].pts : 0;
        if (top + rb > best.threat) best = { i, threat: top + rb };
      });
      return { targetIdx: best.i };
    }

    case 'coaches_challenge': {
      // Target opponent's highest-scoring roll
      const oppRolls = game.rollResults[oppKey] || [];
      let bestIdx = 0, bestPts = 0;
      oppRolls.forEach((r, i) => {
        if (r && (r.pts || 0) > bestPts) { bestPts = r.pts; bestIdx = i; }
      });
      return { playerIdx: bestIdx };
    }

    case 'anticipate_pass': {
      return {};
    }

    case 'cold_spell': {
      const oppRolls = game.rollResults[oppKey] || [];
      const target = oppRolls.findIndex(r => r && (r.die === 1 || r.die === 2) && !r.coldSpellUsed);
      return { playerIdx: target >= 0 ? target : 0 };
    }

    // ═══ WAVE ONE (2026-09-06) — pick the player the engine will accept ═══════
    case 'spain_pick_roll': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => {
        const dp = oppT.starters[(game.offMatchups?.[teamKey] || [])[i] ?? i];
        return p && dp && p.speed > dp.speed;
      }).sort((u, v) => v.p.speed - u.p.speed);
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'mismatch_hunter': {
      const best = starters.reduce((b, p, i) => {
        const dp = oppT.starters[(game.offMatchups?.[teamKey] || [])[i] ?? i];
        if (!p || !dp) return b;
        const a = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
        const m = Math.max(a.speedAdv, a.powerAdv);
        return m > b.m ? { idx: i, m } : b;
      }, { idx: 0, m: -99 });
      return { playerIdx: best.idx };
    }
    case 'energizer': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p }) => p && (p.salary || 0) < 250)
        .sort((u, v) => ((v.p.defBoost || 0) - (u.p.defBoost || 0)));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'defensive_anchor': {
      // The anchor with the biggest bonus, guarding the attacker with the
      // largest positive matchup bonus if there is one.
      const guards = game.offMatchups?.[oppKey] || [];
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p }) => (p?.defBoost || 0) >= 1);
      const scored = cand.map(({ p, i }) => {
        const offSlot = guards.indexOf(i);
        const off = oppT.starters[offSlot];
        const rb = off ? calcAdv(off, p, game.tempEff?.[oppKey] || {}, offSlot).rollBonus : 0;
        return { i, rb };
      }).sort((u, v) => v.rb - u.rb);
      return { playerIdx: scored[0]?.i ?? cand[0]?.i ?? 0 };
    }
    case 'five_out': {
      const cand = starters.map((p, i) => ({ p, i }))
        .filter(({ p, i }) => p && (rolls[i] == null && !blocked[i]) && (p.threePtBoost || 0) > 0)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.threePtBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.threePtBoost || 0)));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'hammer_set': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => {
        if (!p || (p.threePtBoost || 0) > 0) return false;
        const dp = oppT.starters[(game.offMatchups?.[teamKey] || [])[i] ?? i];
        return dp && calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i).speedAdv > 0;
      }).sort((u, v) => (u.p.shotLine ?? 18) - (v.p.shotLine ?? 18));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'iso_heavy': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => p && (rolls[i] == null && !blocked[i]))
        .sort((u, v) => expectedOutput(v.p) - expectedOutput(u.p));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'three_point_barrage': {
      // The extra check goes to the best shooter if an assist is spare.
      const shooters = starters.map((p, i) => ({ p, i })).filter(({ p }) => p && (p.threePtBoost || 0) > 0)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.threePtBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.threePtBoost || 0)));
      return myT.assists >= 2 && shooters[0] ? { extraShooterIdx: shooters[0].i } : {};
    }
    case 'crash_and_kick': case 'extra_pass': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p }) => p)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.threePtBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.threePtBoost || 0)));
      return { playerIdx: cand[0]?.i ?? 0, checkType: '3pt' };
    }
    case 'pick_and_pop': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p }) => p && (p.threePtBoost || 0) > 0)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.threePtBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.threePtBoost || 0)));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'lob_city': case 'denial': {
      const others = (myT.hand || []).filter(id => id !== cardId);
      return { discardId: others[others.length - 1] };
    }

    // ═══ WAVE TWO (2026-09-07) ═══════════════════════════════════════════════
    case 'outside_pick': {
      // The best shooter takes it; the cheapest card in hand pays for it.
      const shooters = starters.map((p, i) => ({ p, i })).filter(({ p }) => p)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.threePtBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.threePtBoost || 0)));
      const others = (myT.hand || []).filter(id => id !== cardId);
      return { playerIdx: shooters[0]?.i ?? 0, discardId: others[others.length - 1] };
    }
    case 'short_roll_playmaker': {
      // Of the players who clear 8/8, the one most likely to score inside.
      const cand = starters.map((p, i) => ({ p, i }))
        .filter(({ p }) => p && (p.speed || 0) >= 8 && (p.power || 0) >= 8)
        .sort((u, v) => ((v.p.paintBoost || 0) - (u.p.paintBoost || 0)) || (v.p.power - u.p.power));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'pick_and_roll_maestro': {
      // The fastest qualifying handler, then the swap that buys the biggest
      // gap — the card is that choice, so the AI makes it properly.
      const mu = game.offMatchups?.[teamKey] || [];
      const fast = starters.map((p, i) => ({ p, i })).filter(({ p }) => p && (p.speed || 0) >= 14)
        .sort((u, v) => v.p.speed - u.p.speed);
      const who = fast[0];
      if (!who) return { playerIdx: 0 };
      const mate = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => p && i !== who.i)
        .map(({ i }) => ({ i, gap: (who.p.speed || 0) - (oppT.starters[mu[i] ?? i]?.speed || 0) }))
        .sort((u, v) => v.gap - u.gap);
      return { playerIdx: who.i, player2Idx: mate[0]?.i ?? (who.i === 0 ? 1 : 0) };
    }
    case 'unethical_hoops': {
      // The biggest edge on the floor takes the free throws.
      const mu = game.offMatchups?.[teamKey] || [];
      const best = starters.map((p, i) => ({ p, i })).filter(({ p }) => p)
        .map(({ p, i }) => { const dp = oppT.starters[mu[i] ?? i]; const a = dp ? calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i) : null; return { i, edge: a ? Math.max(a.speedAdv, a.powerAdv) : -99 }; })
        .sort((u, v) => v.edge - u.edge)[0];
      return { playerIdx: best?.i ?? 0 };
    }
    case 'inside_out': {
      // Anyone but the man who just scored inside; the best shooter of them.
      const scorer = game.lastPaintScore?.playerIdx;
      const mates = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => p && i !== scorer)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.threePtBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.threePtBoost || 0)));
      return { playerIdx: scorer ?? 0, player2Idx: mates[0]?.i ?? 0 };
    }
    case 'stretch_five': {
      const big = starters.map((p, i) => ({ p, i })).find(({ p }) => p && String(p.pos || '').split(/[-/]/).some(t => t === 'C' || t === 'PF') && ((p.shotLine ?? 18) - (p.threePtBoost || 0)) <= 14);
      const mate = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => p && i !== big?.i)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.paintBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.paintBoost || 0)));
      return { playerIdx: big?.i ?? 0, player2Idx: mate[0]?.i ?? 1 };
    }
    case 'post_domination': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p }) => (p?.power || 0) >= 15)
        .sort((u, v) => expectedOutput(v.p) - expectedOutput(u.p));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'unsung_hero': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => p && (rolls[i] == null && !blocked[i]) && (p.salary || 0) <= 400)
        .sort((u, v) => expectedOutput(v.p) - expectedOutput(u.p));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'transition_outlet': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => {
        const dp = oppT.starters[(game.offMatchups?.[teamKey] || [])[i] ?? i];
        return p && dp && calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i).speedAdv > 0;
      }).sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.threePtBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.threePtBoost || 0)));
      return { playerIdx: cand[0]?.i ?? 0, checkType: '3pt' };
    }
    case 'help_defender': {
      // Send help at the worst mismatch, from the defender guarding the
      // attacker with least to gain — the man you leave open should be the
      // one who punishes it least.
      const targets = helpTargets(game, teamKey);
      if (!targets.length) return {};
      const worst = targets.reduce((b, t) => (t.adv > b.adv ? t : b), targets[0]);
      const guards = game.offMatchups?.[oppKey] || [];
      const cost = starters
        .map((p, i) => ({ i, slot: guards.indexOf(i) }))
        .filter(({ i, slot }) => i !== worst.defIdx && slot >= 0)
        .map(({ i, slot }) => ({ i, value: expectedOutput(oppT.starters[slot]) }))
        .sort((u, v) => u.value - v.value);
      return { targetIdx: worst.offSlot, helperIdx: cost[0]?.i ?? starters.findIndex((_, i) => i !== worst.defIdx) };
    }

    case 'find_the_open_man': {
      const dt = game.lastDoubleTeam;
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p, i }) => p && (rolls[i] == null && !blocked[i]) && i !== dt?.targetIdx)
        .sort((u, v) => expectedOutput(v.p) - expectedOutput(u.p));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'putback_specialist': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p }) => p)
        .sort((u, v) => ((u.p.shotLine ?? 18) - (u.p.paintBoost || 0)) - ((v.p.shotLine ?? 18) - (v.p.paintBoost || 0)));
      return { playerIdx: cand[0]?.i ?? 0 };
    }
    case 'hustle_play': {
      const cand = starters.map((p, i) => ({ p, i })).filter(({ p }) => p && (p.salary || 0) < 400 && (p.defBoost || 0) > 0)
        .sort((u, v) => (v.p.defBoost || 0) - (u.p.defBoost || 0));
      return { playerIdx: cand[0]?.i ?? 0 };
    }

    default:
      return {};
  }
}

// ── Rolling Decision ────────────────────────────────────────────────────────
// Pick the next player to roll, prioritizing best matchups first.
export function aiRollDecision(game, teamKey) {
  const myT = getTeam(game, teamKey);
  const oppT = getOpp(game, teamKey);
  const rolls = game.rollResults[teamKey] || [];
  const blocked = game.blockedRolls?.[teamKey] || {};

  const candidates = (myT.starters || []).map((p, i) => {
    if (!canRollSlot(game, teamKey, i)) return null;
    const di = (game.offMatchups[teamKey] || [])[i] ?? i;
    const dp = oppT.starters[di];
    if (!dp) return { idx: i, bonus: 0 };
    const adv = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
    const fat = getFatigue(game, teamKey, i);
    const ps = getPS(game, teamKey, p.id) || {};
    const mrkB = ((ps.hot || 0) - (ps.cold || 0)) * 2;
    return { idx: i, bonus: adv.rollBonus + fat + mrkB };
  }).filter(Boolean);

  if (candidates.length === 0) return null;

  // Roll best matchups first
  candidates.sort((a, b) => b.bonus - a.bonus);
  const pick = candidates[0];

  // CLUTCH POSSESSION: in crunch, spend it on the best remaining chart —
  // extra dice are worth most where the top tiers are worth most — as long
  // as that player is the one rolling now and his legs allow it.
  if (clutchAvailable(game, teamKey) > 0) {
    const ceiling = i => {
      const ch = myT.starters[i]?.chart;
      return ch?.length ? ch[ch.length - 1].pts + (game.clutchDice?.[myT.starters[i].id] || 0) * 2 : 0;
    };
    const bestCeiling = Math.max(...candidates.map(c => ceiling(c.idx)));
    if (ceiling(pick.idx) >= bestCeiling && clutchEligible(game, teamKey, pick.idx)) {
      return { type: 'roll', playerIdx: pick.idx, clutch: true };
    }
  }
  return { type: 'roll', playerIdx: pick.idx };
}

/**
 * The Crunch Time timeout brain: call the one timeout when the moment is
 * right — trailing, or a rider in hand worth the stoppage — then the caller
 * re-sets the defense, plays the best rider, and resumes.
 */
export function aiCrunchDecision(game, teamKey) {
  if (!game.crunch?.active || game.phase !== 'scoring') return null;
  if (game.crunch.timeoutUsed?.[teamKey] || game.timeoutActive) return null;
  const team = getTeam(game, teamKey);
  const opp = getOpp(game, teamKey);
  const riders = ['ato_masterpiece', 'fresh_legs', 'ice_the_hot_hand', 'reset'];
  const holdsRider = (team.hand || []).some(id => riders.includes(id));
  const trailing = team.score < opp.score;
  // The search (2026-09-09): a crunch card still in the deck is reason enough.
  const canSearch = (team.deck || []).some(id => CRUNCH_CARDS.includes(id));
  if (trailing || holdsRider || canSearch) return { type: 'timeout' };
  return null;
}

/**
 * What to search the deck for during our timeout: the crunch card the open
 * window values most (riders carry the timeout's +4), or null when there is
 * nothing to take.
 */
export function aiCrunchSearch(game, teamKey) {
  const options = crunchSearchOptions(game, teamKey);
  if (!options.length) return null;
  let best = null;
  for (const id of options) {
    const strat = getStrat(id);
    if (!strat) continue;
    const v = evaluateCard(game, teamKey, id, strat);
    if (!best || v > best.v) best = { id, v };
  }
  return best ? best.id : options[0];
}

// ── Reaction Card Decision ──────────────────────────────────────────────────
// Check if AI should play a reaction card in response to opponent's action.
export function aiReactionDecision(game, teamKey, trigger) {
  const team = getTeam(game, teamKey);
  const hand = team.hand || [];

  // An announced shot check: one answer, the strongest legal one. Paint
  // checks have their own answers (Rim Protector, Drop Coverage); Close Out
  // is the three-point one; the rest answer either.
  if (trigger === 'shot_check') {
    const psc = game.pendingShotCheck;
    if (!psc || psc.reacted) return null;
    const order = psc.type === 'paint'
      ? ['rim_protector', 'drop_coverage', 'smothering_defense', 'hustle_play', 'denial']
      : ['close_out', 'smothering_defense', 'hustle_play', 'denial'];
    for (const cardId of order) {
      if (!hand.includes(cardId)) continue;
      if (canPlayCard(game, teamKey, cardId).canPlay) {
        return { type: 'play_card', cardId, opts: aiBuildCardOpts(game, teamKey, cardId) };
      }
    }
  }

  // Cold Spell: always play on natural 1-2
  if (trigger === 'cold_roll' && hand.includes('cold_spell')) {
    const check = canPlayCard(game, teamKey, 'cold_spell');
    if (check.canPlay) {
      const opts = aiBuildCardOpts(game, teamKey, 'cold_spell');
      return { type: 'play_card', cardId: 'cold_spell', opts };
    }
  }

  // Screen reactions: the canceller that takes back the most, if any is worth it.
  if (trigger === 'screen_card') {
    let best = null;
    for (const cardId of CANCELLERS) {
      if (!hand.includes(cardId) || !canPlayCard(game, teamKey, cardId).canPlay) continue;
      const { saved } = switchCancelValue(game, teamKey, cardId);
      if (saved >= SWITCH_FLOOR && (!best || saved > best.saved)) best = { cardId, saved };
    }
    if (best) return { type: 'play_card', cardId: best.cardId, opts: aiBuildCardOpts(game, teamKey, best.cardId) };
  }

  // Coach's Challenge: only a make is worth re-rolling
  if (trigger === 'opp_scored' && hand.includes('coaches_challenge') && game.lastShotCheck?.result?.hit && game.lastShotCheck.teamKey !== teamKey) {
    const check = canPlayCard(game, teamKey, 'coaches_challenge');
    if (check.canPlay) {
      const opts = aiBuildCardOpts(game, teamKey, 'coaches_challenge');
      return { type: 'play_card', cardId: 'coaches_challenge', opts };
    }
  }

  return null; // No reaction
}

// ── Master AI Turn ──────────────────────────────────────────────────────────
// Given the current game state, decide what action to take.
// Returns an action object or null if no action needed.
export function aiTurn(game, teamKey, opts = {}) {
  const phase = game.phase;

  if (phase === 'draft') {
    return aiDraftPick(game, teamKey);
  }

  if (phase === 'matchup_strats') {
    // THE PLACEMENT SNAKE IS THE MATCHUP ASSIGNMENT. Row by row, A places and
    // B answers in the same row (or the other way round), and the pairing
    // that leaves is the matchup — the AI's defensive choice is made in
    // aiPlacementPick, when it counters what just took the floor. Only a
    // switching card (or the crunch-time timeout re-set) moves anyone after
    // that. For four days the AI also re-dealt every pairing here through
    // aiSetMatchups; the user, reading the log on 2026-09-06: "the AI is just
    // setting the defense after the matchups have been laid down... Only
    // switching cards can change that." aiSetMatchups stays for the cards.
    //
    // A matchup card, otherwise pass.
    return aiScoringDecision(game, teamKey, opts);
  }

  if (phase === 'scoring') {
    const scoringPasses = game.scoringPasses || 0;
    const rollingOpen = scoringPasses >= 99;

    if (rollingOpen) {
      // In rolling phase — roll next player
      return aiRollDecision(game, teamKey);
    }

    // In card-play phase — play a card or pass
    if (game.scoringTurn === teamKey) return aiScoringDecision(game, teamKey, opts);
  }

  return null;
}
