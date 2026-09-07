// How hard is a collection to finish, measured rather than guessed.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
//
// Two things downstream need to rank collections by difficulty: the coins a
// goal pays, and the QUALITY OF THE CARD it hands over. Both were guessing.
// The coin payout used buy-out cost as a stand-in and the card reward used
// nothing at all — every franchise handed back the same rare-band player, so
// finishing Oklahoma City and finishing Sacramento paid the same card despite
// a sixfold gap in what they cost to finish.
//
// ── WHY NOT JUST COUNT CARDS ────────────────────────────────────────────────
//
// Because roster size ranks the league almost backwards. Washington holds the
// most cards (16) and sits mid-table; the Lakers hold the fewest (9) and are
// among the hardest, because a legendary and a super-rare drag the tail out
// further than seven extra commons ever could. Difficulty is dominated by the
// RAREST card in the set, not by how many cards there are.
//
// ── THE MEASURE ─────────────────────────────────────────────────────────────
//
// Expected packs to see every card at least once — the coupon-collector
// problem with unequal probabilities, which has no closed form but a clean
// integral:
//
//   E[T] = ∫₀^∞ ( 1 − Π_i (1 − e^{−pᵢt}) ) dt
//
// where pᵢ is the chance one pack contains card i. Integrated numerically.
// This is the honest answer to "number of cards PLUS how hard each is to get":
// every card contributes, and a single 0.3% card dominates the total the way
// it actually does in play.
//
// ── WHICH PACK ──────────────────────────────────────────────────────────────
//
// The TEAM pack, because that is the path a collector actually walks. Ranking
// by booster would describe a route nobody takes once a targeted pack exists,
// and would flatten the field: from a 348-card pool every roster looks nearly
// impossible and the differences between them wash out.
//
// The market is deliberately NOT modelled. Buying is a way to convert coins
// into any specific card at a fixed rate, so folding it in would collapse the
// measure back into buy-out cost and erase the pull-luck tail that is the
// actual difficulty.
import { CARD_SETS, BASE_SET, cardKey } from './cardSets.js';
import { getPlayerRarity, PACK_WEIGHTS } from './rarity.js';
import { PACK_TYPES } from './packEngine.js';
import { GOALS, TEAM_ROSTERS, WNBA_ROSTERS, WNBA_SET } from './collections.js';

/** Player slots in the pack a collector would target this goal with. */
const TEAM_PACK_PULLS = PACK_TYPES.team_pack.players;

/**
 * Chance a single pull lands on one specific card, given the pool it competes in.
 *
 * A pull picks a RARITY BAND first and then a card uniformly inside it, so a
 * card's odds depend on how many others share its band — which is why a rare on
 * a rare-heavy roster is easier to hit than a rare on a roster where it is the
 * only one.
 */
function pullOdds(cards) {
  const bandSize = {};
  for (const card of cards) {
    const r = getPlayerRarity(card);
    bandSize[r] = (bandSize[r] ?? 0) + 1;
  }
  // Bands with no card in this pool can not be drawn, so their weight is
  // redistributed. Without this a 9-card roster holding no legendary would be
  // scored as though 0.3% of its pulls simply vanished.
  const live = Object.keys(bandSize).reduce((sum, r) => sum + PACK_WEIGHTS[r], 0);
  return cards.map(card => {
    const r = getPlayerRarity(card);
    return PACK_WEIGHTS[r] / live / bandSize[r];
  });
}

/**
 * Expected packs to collect every card, by numeric integration.
 *
 * `step` and the bail-out are tuned together: the integrand falls off
 * exponentially, so once the chance of still missing something is under 1e-12
 * the remaining area is far below the rounding this feeds.
 */
export function expectedPacks(perPackOdds, { step = 0.25, maxPacks = 500000 } = {}) {
  if (perPackOdds.length === 0) return 0;
  let area = 0;
  for (let t = step / 2; t < maxPacks; t += step) {
    let haveAll = 1;
    for (const p of perPackOdds) {
      haveAll *= 1 - Math.exp(-p * t);
      if (haveAll === 0) break;
    }
    const missing = 1 - haveAll;
    area += missing * step;
    if (missing < 1e-12) break;
  }
  return area;
}

/**
 * Expected packs to finish one goal's card list.
 *
 * The odds are computed against the goal's OWN cards because a team pack draws
 * only from that team. For the conference and set tiers the "pack" is the whole
 * pool, which is exactly right: there is no targeted pack for those.
 */
export function goalDifficulty(requires, { pulls = TEAM_PACK_PULLS } = {}) {
  const cards = requires.map(key => CARD_INDEX[key]).filter(Boolean);
  if (cards.length === 0) return 0;
  const odds = pullOdds(cards).map(p => 1 - (1 - p) ** pulls);
  return expectedPacks(odds);
}

const CARD_INDEX = Object.fromEntries(
  Object.values(CARD_SETS).flat().map(card => [cardKey(card), card])
);

/** `goalId -> expected packs`, every goal in the ladder. */
export const GOAL_DIFFICULTY = Object.fromEntries(
  GOALS.map(g => [g.id, goalDifficulty(g.requires)])
);

/**
 * Franchise difficulty as a 0-1 position within its own league's field.
 *
 * Ranked rather than scaled, because the raw packs number has a long right
 * tail — one roster can sit three times further out than the gap between all
 * the others — and a tail like that would put twenty-eight teams in the bottom
 * tier and call it a ladder. A rank says what the ladder needs to know: where
 * this franchise stands against the ones it is being compared to.
 */
function rankWithin(ids) {
  const sorted = [...ids].sort((a, b) => GOAL_DIFFICULTY[a] - GOAL_DIFFICULTY[b]);
  return Object.fromEntries(
    sorted.map((id, i) => [id, sorted.length < 2 ? 0 : i / (sorted.length - 1)])
  );
}

const NBA_TEAM_GOALS = Object.keys(TEAM_ROSTERS).map(t => `nba-team-${t}`);
const WNBA_TEAM_GOALS = Object.keys(WNBA_ROSTERS).map(t => `wnba-team-${t}`);

export const TEAM_DIFFICULTY_RANK = {
  ...rankWithin(NBA_TEAM_GOALS),
  ...rankWithin(WNBA_TEAM_GOALS),
};

/**
 * The reward band a franchise has earned.
 *
 * ── WHY THREE TIERS AND WHY THESE CUTS ──────────────────────────────────────
 *
 * The ladder has to be legible from the collection screen — a player should be
 * able to see that some rosters are worth more before they start one — and
 * three named bands the game already uses do that where a continuous salary
 * curve would not. The cuts are at the thirds, so ten NBA franchises sit in
 * each: an even ladder rather than one tier holding everything.
 *
 * ── WHY THE TOP TIER IS LEGENDARY, HAVING ARGUED IT SHOULD NOT BE ───────────
 *
 * The original rule was that no reward should be meta-defining, and it held
 * every pick to the rare band for that reason. That rule was written when every
 * team paid the same card, and it bought its safety by making the hardest
 * collection in the game pay exactly what the easiest did. Ten legendary cards
 * that each cost a full roster — the top tier averages around six times the
 * packs of the bottom — are not a power creep problem: they are rarer to obtain
 * than the pack-pulled legendaries already in circulation, and slower.
 */
export const REWARD_BANDS = [
  { band: 'rare', minRank: 0, salary: [700, 899] },
  { band: 'super-rare', minRank: 1 / 3, salary: [900, 1199] },
  { band: 'legendary', minRank: 2 / 3, salary: [1200, Infinity] },
];

export function rewardBandFor(goalId) {
  const rank = TEAM_DIFFICULTY_RANK[goalId];
  if (rank === undefined) return null;
  return [...REWARD_BANDS].reverse().find(b => rank >= b.minRank - 1e-9) ?? REWARD_BANDS[0];
}

/** Franchise code -> its earned band, for the NBA reward set. */
export function nbaRewardBands() {
  return Object.fromEntries(
    Object.keys(TEAM_ROSTERS).map(team => [team, rewardBandFor(`nba-team-${team}`)])
  );
}

export { WNBA_SET, BASE_SET };
