// Matchup Matrix — the balance instrument.
//
// The original 2K25 set DERIVED Speed/Power from a matrix like this one
// (card-data/source-recovered/NBA_Showdown_2K25_Final_Compiled_Data.csv keeps
// the output: a roll-bonus histogram per player plus Total Advantages /
// Total Disadvantages / Neutral Matchups). The 2026-27 budgets instead come
// from EPM, so this module runs the matrix in the opposite direction: it CHECKS
// the budgets rather than producing them, and it never writes a card attribute.
//
// The matchup rule itself is NOT reimplemented here. `calcAdv` in
// src/game/engine.js is the game's own rule and is imported and called
// directly, so an answer this module gives is by construction the answer the
// table would give. Everything below is classification and counting on top of
// calcAdv's return value.

import { calcAdv } from '../../src/game/engine.js';

/**
 * The neutral baseline passed to `calcAdv`.
 *
 * calcAdv's full signature is (off, def, tempEff, idx, tempDefEff, defIdx).
 * The last four exist only to carry in-game strategy-card effects:
 *   - tempEff[`s${idx}`] / tempEff[`p${idx}`] are per-slot Speed/Power swings
 *     from offensive strategy cards,
 *   - tempDefEff[defIdx] is the Defensive Stopper family's +speed/+power.
 * A balance audit wants the card as printed, with no cards played and no slot
 * context, so all four take their own defaults: `{}` and `0` make both tempEff
 * lookups `|| 0`, and `null`/`null` skip the tempDefEff block entirely. That
 * leaves exactly `off.speed - def.speed`, `off.power - def.power` and the
 * defender's printed Def Boost — the intrinsic matchup between two cards.
 *
 * Calling `calcAdv(off, def)` and letting the defaults apply is therefore the
 * correct baseline, and is what evaluateMatchup does.
 */
export const NEUTRAL_CALL_NOTE =
  'calcAdv(off, def) — tempEff={}, idx=0, tempDefEff=null, defIdx=null (no strategy cards in play)';

/** Outcome buckets, from the attacker's point of view. */
export const ADVANTAGE = 'advantage';
export const NEUTRAL = 'neutral';
export const DISADVANTAGE = 'disadvantage';

/**
 * Evaluate one ordered matchup: `off` attacking `def`.
 *
 * Returns calcAdv's own numbers plus the classification this module adds.
 *
 * `rawBonus` is the roll bonus the attacker would have received against the
 * same defender with no Def Boost. It is `Math.max(rawSpeedDiff, rawPowerDiff)`
 * in BOTH of calcAdv's branches:
 *   - penalty branch (both diffs <= 0): Def Boost never applies, so calcAdv
 *     already returns exactly that max;
 *   - advantage branch: at least one diff is positive, so clamping each at zero
 *     before taking the max cannot change which value wins.
 * `blunted = rawBonus - rollBonus` is then the roll-bonus points the defender's
 * Def Boost actually removed, which is the only direct measure of what a Def
 * Boost is mechanically worth.
 */
export function evaluateMatchup(off, def) {
  const adv = calcAdv(off, def);
  const { speedAdv, powerAdv, rawSpeedDiff, rawPowerDiff, db, rollBonus, hasPenalty } = adv;

  const rawBonus = Math.max(rawSpeedDiff, rawPowerDiff);
  const blunted = rawBonus - rollBonus;

  let outcome;
  if (rollBonus > 0) outcome = ADVANTAGE;
  else if (rollBonus < 0) outcome = DISADVANTAGE;
  else outcome = NEUTRAL;

  // Axis attribution is only meaningful for an advantage.
  //
  // A disadvantage is definitionally "behind on BOTH axes": calcAdv only takes
  // the penalty branch when rawSpeed <= 0 AND rawPower <= 0, and the penalty is
  // the MAX of the two, so a negative roll bonus requires both diffs negative.
  // There is no such thing as losing a matchup on Speed alone. That asymmetry
  // is a property of the rule, not of this analysis.
  let axis = null;
  if (outcome === ADVANTAGE) {
    if (speedAdv > 0 && powerAdv > 0) axis = 'both';
    else if (speedAdv > 0) axis = 'speed';
    else axis = 'power';
  }

  // A neutral that only exists because Def Boost ate a real advantage.
  const neutralisedByDef = outcome === NEUTRAL && rawBonus > 0;

  return {
    outcome,
    axis,
    rollBonus,
    rawBonus,
    blunted,
    neutralisedByDef,
    speedAdv,
    powerAdv,
    rawSpeedDiff,
    rawPowerDiff,
    db,
    hasPenalty,
  };
}

const emptyProfile = () => ({
  matchups: 0,
  advantages: 0,
  disadvantages: 0,
  neutral: 0,
  advBySpeed: 0,
  advByPower: 0,
  advByBoth: 0,
  advMagnitude: 0,   // sum of positive roll bonuses
  disMagnitude: 0,   // sum of |negative roll bonuses|
  netMagnitude: 0,   // sum of all roll bonuses, signed
  blunted: 0,        // roll-bonus points removed by Def Boost
  neutralised: 0,    // matchups turned from advantage to neutral by Def Boost
  maxRollBonus: -Infinity,
  minRollBonus: Infinity,
  histogram: new Map(),
});

function record(profile, m) {
  profile.matchups += 1;
  profile.blunted += m.blunted;
  profile.netMagnitude += m.rollBonus;
  if (m.rollBonus > profile.maxRollBonus) profile.maxRollBonus = m.rollBonus;
  if (m.rollBonus < profile.minRollBonus) profile.minRollBonus = m.rollBonus;
  profile.histogram.set(m.rollBonus, (profile.histogram.get(m.rollBonus) || 0) + 1);

  if (m.outcome === ADVANTAGE) {
    profile.advantages += 1;
    profile.advMagnitude += m.rollBonus;
    if (m.axis === 'speed') profile.advBySpeed += 1;
    else if (m.axis === 'power') profile.advByPower += 1;
    else profile.advByBoth += 1;
  } else if (m.outcome === DISADVANTAGE) {
    profile.disadvantages += 1;
    profile.disMagnitude += -m.rollBonus;
  } else {
    profile.neutral += 1;
    if (m.neutralisedByDef) profile.neutralised += 1;
  }
}

function finalise(profile) {
  const n = profile.matchups || 1;
  return {
    ...profile,
    meanRollBonus: profile.netMagnitude / n,
    advantageRate: profile.advantages / n,
    disadvantageRate: profile.disadvantages / n,
    maxRollBonus: profile.matchups ? profile.maxRollBonus : 0,
    minRollBonus: profile.matchups ? profile.minRollBonus : 0,
    histogram: Object.fromEntries([...profile.histogram].sort((a, b) => a[0] - b[0])),
  };
}

/**
 * Run the full ordered matrix over one set of cards.
 *
 * Self-matchups are excluded, so each player has `cards.length - 1` matchups in
 * each direction. Returns a per-player row carrying BOTH profiles:
 *
 *   offense — this player attacking everyone else. How often, on which axis and
 *             by how much he wins his own matchup.
 *   defense — everyone else attacking this player. How often he concedes an
 *             advantage, how much roll bonus he gives up, and how much his Def
 *             Boost removes. This is the half Def Boost lives in.
 *
 * `netEdge = offense.meanRollBonus - defense.meanRollBonus` is the player's
 * average two-way edge in roll-bonus points: what he generates with the ball
 * minus what he concedes without it.
 */
export function buildMatchupMatrix(cards) {
  const off = cards.map(emptyProfile);
  const def = cards.map(emptyProfile);

  for (let a = 0; a < cards.length; a++) {
    for (let d = 0; d < cards.length; d++) {
      if (a === d) continue;
      const m = evaluateMatchup(cards[a], cards[d]);
      record(off[a], m);
      record(def[d], m);
    }
  }

  return cards.map((card, i) => {
    const offense = finalise(off[i]);
    const defense = finalise(def[i]);
    return {
      id: card.id,
      name: card.name,
      team: card.team,
      pos: card.pos,
      speed: card.speed,
      power: card.power,
      speedPower: card.speed + card.power,
      defBoost: card.defBoost ?? 0,
      offense,
      defense,
      netEdge: offense.meanRollBonus - defense.meanRollBonus,
    };
  });
}

/**
 * The Net Edge each card would have from its Speed+Power BUDGET alone.
 *
 * This is not an approximation — with every Def Boost at zero it is an exact
 * identity, and the difference between a card's real Net Edge and this value is
 * therefore precisely what its Def Boost is worth (see defBoostCredit).
 *
 * Why it holds. For cards X and Y put a = Xspeed - Yspeed and b = Xpower -
 * Ypower. With no Def Boost the rule gives
 *     adv(X,Y) = max(a, b)
 *     adv(Y,X) = max(-a, -b) = -min(a, b)
 * so the two-way difference for that pair is
 *     adv(X,Y) - adv(Y,X) = max(a, b) + min(a, b) = a + b = SP(X) - SP(Y)
 * The max() that makes a single matchup depend on the SPLIT cancels the moment
 * both directions are counted. Averaging over the field leaves
 *     netEdge(X) = SP(X) - mean(SP of the other cards)
 *
 * The consequence for balance work is the point: how a budget is DIVIDED
 * between Speed and Power has no effect whatsoever on a card's two-way matchup
 * standing. It changes who a card beats, never how much it wins overall. Def
 * Boost is the only attribute that moves a card off this line.
 */
export function budgetOnlyNetEdges(cards) {
  const n = cards.length - 1;
  const sum = cards.reduce((s, c) => s + c.speed + c.power, 0);
  return cards.map(c => {
    const sp = c.speed + c.power;
    return n > 0 ? sp - (sum - sp) / n : 0;
  });
}

/**
 * What each card's Def Boost is actually worth, in Net Edge points.
 *
 * `credit = netEdge - budgetOnlyNetEdge`. It is NOT a function of the Def Boost
 * number alone: a boost only pays when an attacker would otherwise have had an
 * advantage, so a card the field cannot beat anyway earns almost nothing from a
 * large one, while a mid-budget card earns a lot from a small one.
 */
export function defBoostCredit(rows, cards) {
  const baseline = budgetOnlyNetEdges(cards);
  return rows.map((r, i) => ({ ...r, budgetNetEdge: baseline[i], defBoostCredit: r.netEdge - baseline[i] }));
}

/**
 * Profile a single card against a field, in both directions.
 *
 * Same arithmetic buildMatchupMatrix does for one row, but it accepts a card
 * that is not a member of `opponents`. That makes it the tool for counterfactuals
 * — "what would this player's standing be with one more point of Def Boost?" —
 * which is how the marginal value of an attribute is measured: perturb one
 * field, re-profile against the unchanged field, and read the change in netEdge.
 *
 * A card sharing an `id` with an opponent is skipped, so passing a real member
 * of the set reproduces its matrix row exactly.
 */
export function profilePlayer(card, opponents) {
  const off = emptyProfile();
  const def = emptyProfile();
  for (const opp of opponents) {
    if (opp.id === card.id) continue;
    record(off, evaluateMatchup(card, opp));
    record(def, evaluateMatchup(opp, card));
  }
  const offense = finalise(off);
  const defense = finalise(def);
  return { offense, defense, netEdge: offense.meanRollBonus - defense.meanRollBonus };
}

/**
 * Cross-set matrix: every `attackers` card against every `defenders` card.
 *
 * Used to answer whether a WNBA or Super Season card meets an NBA base card on
 * sane terms. No self-matchup exclusion — the two lists are different sets, and
 * a name appearing in both is a genuinely different card.
 */
export function crossSetSummary(attackers, defenders) {
  let matchups = 0, advantages = 0, disadvantages = 0, neutral = 0;
  let net = 0, blunted = 0;
  for (const a of attackers) {
    for (const d of defenders) {
      const m = evaluateMatchup(a, d);
      matchups += 1;
      net += m.rollBonus;
      blunted += m.blunted;
      if (m.outcome === ADVANTAGE) advantages += 1;
      else if (m.outcome === DISADVANTAGE) disadvantages += 1;
      else neutral += 1;
    }
  }
  return {
    matchups,
    advantages,
    disadvantages,
    neutral,
    meanRollBonus: matchups ? net / matchups : 0,
    advantageRate: matchups ? advantages / matchups : 0,
    blunted,
  };
}

// ── Statistics helpers ──────────────────────────────────────────────────────

export function mean(xs) {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

export function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** z-scores of `xs` against their own pool. A flat pool yields all zeros. */
export function zScores(xs) {
  const m = mean(xs);
  const sd = stdev(xs);
  if (!sd) return xs.map(() => 0);
  return xs.map(x => (x - m) / sd);
}

export function pearson(xs, ys) {
  const zx = zScores(xs), zy = zScores(ys);
  if (!zx.length || !stdev(xs) || !stdev(ys)) return 0;
  return zx.reduce((s, x, i) => s + x * zy[i], 0) / (xs.length - 1);
}

/**
 * Compare each player's matchup standing against the EPM the budget was
 * derived from, on a common z-scale, and return the residual.
 *
 * `residual = z(matchupMetric) - z(epmMetric)`. Positive means the card is
 * stronger in matchup terms than the player's EPM justifies; negative means the
 * card under-delivers on what EPM says the player is. A residual near zero
 * means the translation from EPM to card held.
 *
 * Rows without a finite EPM value are returned with `residual: null` rather
 * than being silently dropped, so a caller can see the coverage gap.
 */
export function translationResiduals(rows, epmByName, { metric, epmKey }) {
  const paired = rows.filter(r => Number.isFinite(epmByName.get(r.name)?.[epmKey]));
  const mz = zScores(paired.map(metric));
  const ez = zScores(paired.map(r => epmByName.get(r.name)[epmKey]));
  const scored = new Map(
    paired.map((r, i) => [r.name, { matchupZ: mz[i], epmZ: ez[i], residual: mz[i] - ez[i] }])
  );
  return rows.map(r => ({
    ...r,
    matchupZ: scored.get(r.name)?.matchupZ ?? null,
    epmZ: scored.get(r.name)?.epmZ ?? null,
    residual: scored.get(r.name)?.residual ?? null,
  }));
}
