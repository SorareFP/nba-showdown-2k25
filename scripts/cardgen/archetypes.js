// The original archetype system, modernized — the balancing layer approved
// 2026-09-02 (memory/original_archetype_system.md).
//
// Defensive tiers come from DEF EPM percentiles whose shares mirror the
// recovered 344-player original (Elite ~6%, Great ~6%, Good ~12%, Awful ~7%);
// offense qualifiers come from OFF EPM percentiles. Players below the Good
// tier who carry a real offensive engine are the OVERRIDE group — the
// Kyrie/Booker/Brunson class whose physical profiles the original system
// deliberately reshaped so the matchup game could punish their defense.
//
// Two shaping rules, measured in scripts/analysis/shapingPrototype.mjs
// (defence$-vs-DEF-EPM r: 0.623 baseline → 0.794 with both):
//
//   BUDGET   an override player's Speed+Power total re-ranks on a def-led
//            blend (epmDef + 0.35·epmOff) quantile-mapped onto the pool's
//            existing total distribution. Offense lives in his chart; his
//            body stops being priced off his scoring gravity.
//
//   SPLIT    his speed/power split exaggerates AWAY from balance along the
//            direction the positional/biometric split already leans
//            (72/28), opening the lane the original system opened: the
//            attackable hole. Balance is what let Kawhi/Luka stuff 92% of
//            the league.
//
// Def Boost is untouched here — it stays round(DEF EPM), the neutralize-only
// equalizer, per the rule that only naturally occurring disadvantages can
// affect scoring rolls.

const TIER_SHARES = { elite: 0.058, great: 0.061, good: 0.122, avg: 0.55, slneg: 0.067, bad: 0.075 };
const OFF_SHARES = { elite: 0.05, veryGood: 0.15, aboveAvg: 0.35 };

export const OVERRIDE_OFF_WEIGHT = 0.35;
// The off-axis keeps this share of its unshaped value (floor 1). Measured by
// the box-score realism sim: cutting the TOTAL (the first cut of this rule)
// starved shaped scorers' charts through roll penalties — Cam Thomas landed
// at S4/P2 and produced 16/36 against a real 25. The hole opens on one axis;
// the lean axis keeps its full value so the offense still functions, exactly
// as the original system kept Kyrie's S18.
export const OFF_AXIS_KEEP = 0.45;

function quantileCuts(sorted, shares) {
  const cuts = {};
  let acc = 0;
  for (const [k, s] of Object.entries(shares)) {
    acc += s;
    cuts[k] = sorted[Math.min(sorted.length - 1, Math.floor(acc * sorted.length))];
  }
  return cuts;
}

/**
 * Assigns archetypes across a pool.
 * `rows`: [{ name, epmOff, epmDef }] — one per pool player with EPM data.
 * Returns Map name -> { tier, offense, override }.
 */
export function assignArchetypes(rows) {
  const byDef = rows.map(r => r.epmDef).sort((a, b) => b - a);
  const byOff = rows.map(r => r.epmOff).sort((a, b) => b - a);
  const defCuts = quantileCuts(byDef, TIER_SHARES);
  const offCuts = quantileCuts(byOff, OFF_SHARES);

  const tierOf = d =>
    d >= defCuts.elite ? 'Elite defender'
    : d >= defCuts.great ? 'Great defender'
    : d >= defCuts.good ? 'Good defender'
    : d >= defCuts.avg ? 'Average defender'
    : d >= defCuts.slneg ? 'Slightly negative defender'
    : d >= defCuts.bad ? 'Bad defender'
    : 'Awful defender';
  const offenseOf = o =>
    o >= offCuts.elite ? 'elite offense'
    : o >= offCuts.veryGood ? 'very good offense'
    : o >= offCuts.aboveAvg ? 'above average offense'
    : null;

  const out = new Map();
  for (const r of rows) {
    const tier = tierOf(r.epmDef);
    const offense = offenseOf(r.epmOff);
    const positiveTier = /^(Elite|Great|Good) defender/.test(tier);
    out.set(r.name, {
      tier,
      offense,
      // The balancing targets: real offensive engines without real defense.
      override: !positiveTier && offense !== null,
    });
  }
  return out;
}

/**
 * The def-led budget for override players: their blend re-ranks against the
 * pool and maps onto the pool's own Speed+Power total distribution, so the
 * value SET is unchanged — only who holds which body.
 */
export function overrideBudget({ epmOff, epmDef }, poolBlends, poolTotals) {
  const mine = epmDef + OVERRIDE_OFF_WEIGHT * epmOff;
  let rank = poolBlends.findIndex(v => v >= mine);
  if (rank === -1) rank = poolBlends.length - 1;
  const p = rank / poolBlends.length;
  return poolTotals[Math.min(poolTotals.length - 1, Math.floor(p * poolTotals.length))];
}

/**
 * How concentrated a player's minutes are across the five positions, as a
 * Herfindahl index: 1.0 for someone who plays exactly one spot, ~0.2 for
 * someone spread evenly over all five. Null shares read as fully concentrated,
 * which is the pre-2026-09-03 behaviour.
 */
export function positionConcentration(shares) {
  if (!shares) return 1;
  const vals = Object.values(shares).filter(Number.isFinite);
  const total = vals.reduce((a, b) => a + b, 0);
  if (total <= 0) return 1;
  return vals.reduce((sum, v) => sum + (v / total) ** 2, 0);
}

/**
 * Exaggerates a split away from balance along its existing lean: the
 * positional/biometric center decides WHICH axis is natural; this decides how
 * far the hole opens.
 *
 * VERSATILITY SHALLOWS THE HOLE. A player who genuinely logs minutes at three
 * positions does not HAVE one glaring physical weakness — that is what
 * versatility means — so opening a full hole on him describes someone else.
 * Kawhi Leonard is the case the user raised: a career blend of SG 12 / SF 51 /
 * PF 35 produces a naturally balanced S15/P15, and a flat 0.45 keep then cut
 * it to S15/P7, a card that gets bullied by every four despite his having
 * played a third of his minutes there.
 *
 * The keep fraction therefore interpolates on positional CONCENTRATION: a
 * one-position player (Jokic, 100% centre) keeps OFF_AXIS_KEEP exactly and
 * gets the full hole the archetype system intends, while a spread-out player
 * keeps proportionally more of his off-axis. Nothing about the archetype
 * assignment changes — this only sizes the hole it opens.
 */
export function exaggerateSplit(speed, power, shares = null) {
  const speedLean = speed >= power;
  const lean = Math.max(speed, power);
  const off = Math.min(speed, power);

  // The hole, and therefore the TOTAL, is unchanged from the concentration-
  // blind rule: lean whole, off-axis cut to OFF_AXIS_KEEP. Versatility must
  // not become a budget buff — it only decides how the SAME total is shared.
  const hole = Math.max(1, Math.round(off * OFF_AXIS_KEEP));
  const total = lean + hole;

  // Ratio interpolates between the fully-exaggerated split and the natural
  // balance the positional/biometric layer produced, on concentration: a
  // one-position player lands exactly where the old rule put him, a player
  // spread over three positions keeps most of his natural balance. Kawhi
  // Leonard (SG 12 / SF 51 / PF 35) is the case — a naturally balanced
  // S15/P15 was being cut to S15/P7, a card bullied by every four despite a
  // third of his minutes there.
  const conc = positionConcentration(shares);
  const exagRatio = lean / total;
  const natRatio = speed + power > 0 ? lean / (speed + power) : 0.5;
  const ratio = natRatio + (exagRatio - natRatio) * conc;

  let leanOut = Math.round(total * ratio);
  // The lean axis is the lean axis: never let the hole out-grow it, and never
  // let either side vanish.
  leanOut = Math.min(total - 1, Math.max(Math.ceil(total / 2), leanOut));
  const holeOut = Math.max(1, total - leanOut);
  return speedLean
    ? { speed: leanOut, power: holeOut }
    : { speed: holeOut, power: leanOut };
}
