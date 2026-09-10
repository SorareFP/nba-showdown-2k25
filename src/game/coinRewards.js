// src/game/coinRewards.js — what a finished game pays, in one place for two runtimes.
//
// ── WHY THERE ARE TWO HALVES ─────────────────────────────────────────────────
//
// detectMilestones reads the GAME — box scores, who won — and can only run
// where the game is, in the browser. settleGameReward reads a CLAIM — a
// handful of booleans and ids — plus the player's daily counters, and turns
// them into coins. The split is the trust boundary: the server never sees the
// game and never needs to. It sees the claim, prices it from this table, and
// enforces the daily cap and the once-a-day first-win bonus from its own copy
// of the counters.
//
// A client can still claim a game it did not play. It cannot claim more per
// game than this table pays, more milestone coins per day than the cap, or the
// first-win bonus twice; and the server rate-limits claims to fewer than a real
// game could produce. Before this, addCoins() took any integer from anyone.
//
// The browser runs settleGameReward too, for the breakdown on the results
// screen, so both sides show and pay the same numbers from the same code. The
// module is copied to functions/shared by prepare.mjs and MUST STAY FREE OF
// IMPORTS.

export const REWARD = {
  // Base game completion. RAISED from 50/25 (2026-09-03) along with the card
  // market: a collection is a coin goal now, not just a luck goal, so income
  // decides how long the hardest one takes. At the old rate the worst roster
  // was ~175 games even after buying every card outright; at this rate it is
  // ~110. Neither of these is capped per day — only milestones are.
  complete: 75,
  win: 50,
  pvpWin: 75,
  dailyFirstWin: 50,
};

export const DAILY_MILESTONE_CAP = 200;

const MILESTONES = [
  {
    id: 'triple_double',
    name: 'Triple-Double',
    coins: 50,
    check: stats => stats.some(ps => (ps.pts || 0) >= 10 && (ps.reb || 0) >= 10 && (ps.ast || 0) >= 10),
  },
  {
    id: 'fifty_pts',
    name: '50+ pts (single player)',
    coins: 25,
    check: stats => stats.some(ps => (ps.pts || 0) >= 50),
  },
  {
    id: 'kobe_81',
    name: '81+ pts (single player — Kobe)',
    coins: 75,
    check: stats => stats.some(ps => (ps.pts || 0) >= 81),
  },
  {
    id: 'wilt_100',
    name: '100+ pts (single player — Wilt)',
    coins: 100,
    check: stats => stats.some(ps => (ps.pts || 0) >= 100),
  },
];

// Special milestone: 83+ pts with one player = free Bam card (not coins)
const BAM_MILESTONE = {
  id: 'bam_83',
  name: '83+ pts (single player) — Free Bam Adebayo!',
  check: stats => stats.some(ps => (ps.pts || 0) >= 83),
  cardReward: 'Bam_Adebayo',
};

/** Today the way the daily counters have always keyed it: the ISO date. */
export const todayKey = (d = new Date()) => d.toISOString().split('T')[0];

/**
 * Which milestones a finished game hit. Browser-only: needs the box scores.
 *
 * `teamKey` is the HUMAN's team ('A' against the coach, my side in PvP):
 * only that box score counts. It used to read both teams "because self-play
 * is a valid game", which paid the user for the coach's triple-double
 * (2026-09-09: "I got coins for giving up a triple double haha") — the same
 * mistake as the victory bonus in outcome.js. Hotseat passes null: nobody
 * is "you" there, both benches are the same person, so both boxes count.
 */
export function detectMilestones(game, teamKey = null) {
  const stats = teamKey
    ? [(teamKey === 'A' ? game.teamA : game.teamB)?.stats ?? []]
    : [game.teamA.stats ?? [], game.teamB.stats ?? []];
  const milestoneIds = MILESTONES.filter(m => stats.some(s => m.check(s))).map(m => m.id);
  const bam = stats.some(s => BAM_MILESTONE.check(s));
  return { milestoneIds, bam };
}

/**
 * Price a claim against the daily counters. Pure; runs on both sides.
 *
 *   claim  { won, pvp, milestoneIds, bam }   what the client says happened
 *   daily  { date, coins, firstWin }         the counters as stored
 *   today  'YYYY-MM-DD'
 *
 * Returns the payout, the breakdown for the results screen, and the counters
 * as they should be stored afterwards — so the next claim settles against
 * what this one used.
 *
 * Milestones are walked in TABLE order and looked up in the claim, not the
 * other way round: an id the table does not know is worth nothing, and an id
 * repeated in the claim is counted once.
 */
export function settleGameReward(claim, daily, today) {
  const c = claim ?? {};
  const sameDay = daily?.date === today;
  const usedToday = sameDay ? Number(daily.coins) || 0 : 0;
  const firstWinTaken = sameDay ? Boolean(daily.firstWin) : false;

  let coins = REWARD.complete;
  const breakdown = [{ label: 'Game Completed', coins: REWARD.complete }];

  if (c.won) {
    const bonus = c.pvp ? REWARD.pvpWin : REWARD.win;
    coins += bonus;
    breakdown.push({ label: c.pvp ? 'PvP Victory' : 'Victory Bonus', coins: bonus });
  }

  let milestoneCoins = 0;
  const wanted = new Set(Array.isArray(c.milestoneIds) ? c.milestoneIds : []);
  for (const m of MILESTONES) {
    if (!wanted.has(m.id)) continue;
    const room = DAILY_MILESTONE_CAP - usedToday - milestoneCoins;
    const award = Math.min(m.coins, Math.max(0, room));
    if (award > 0) {
      milestoneCoins += award;
      coins += award;
      breakdown.push({ label: m.name, coins: award });
    }
  }

  const firstWin = Boolean(c.won) && !firstWinTaken;
  if (firstWin) {
    coins += REWARD.dailyFirstWin;
    breakdown.push({ label: 'Daily First Win', coins: REWARD.dailyFirstWin });
  }

  const bam = Boolean(c.bam);
  if (bam) breakdown.push({ label: BAM_MILESTONE.name, coins: 0, special: true });

  return {
    coins,
    milestoneCoins,
    firstWin,
    bam,
    // `bamReward` is the name the results screen has always read.
    bamReward: bam,
    bamCardId: bam ? BAM_MILESTONE.cardReward : null,
    breakdown,
    daily: { date: today, coins: usedToday + milestoneCoins, firstWin: firstWinTaken || firstWin },
  };
}

export { MILESTONES, BAM_MILESTONE };

// ── The box score a finished game reports ───────────────────────────────────
//
// One line per card that took the floor for the claimant's team: the input to
// the lifetime tracker (users/{uid}/cardStats/{cardKey}). The server adds the
// lines to the card's running totals and the client shows totals and
// per-game averages on the card. Shared by the Cloud Function and the direct
// route so both accept exactly the same shape.
export const BOX_FIELDS = ['pts', 'reb', 'ast', 'min', 'tpm', 'tpa', 'alw'];
export const MAX_BOX_ROWS = 10;
const BOX_CAP = 200;

/** Shape-check a claim's box: at most ten distinct keys, whole non-negative numbers. */
export function sanitizeBox(box) {
  if (!Array.isArray(box)) return [];
  const out = [];
  const seen = new Set();
  for (const row of box.slice(0, MAX_BOX_ROWS)) {
    const key = typeof row?.key === 'string' ? row.key.slice(0, 80) : null;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const clean = { key };
    for (const f of BOX_FIELDS) {
      const v = Number(row[f]);
      clean[f] = Number.isFinite(v) ? Math.max(0, Math.min(BOX_CAP, Math.round(v))) : 0;
    }
    out.push(clean);
  }
  return out;
}
