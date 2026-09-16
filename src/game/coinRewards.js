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
  // PvP's premium no longer lives here. It was 75 — 1.5x on the win bonus
  // alone. Since 2026-09-16 a PvP claim takes PAY_MAX on the whole earned base
  // in settleGameReward, the same way a Deity game does (the user: "I'm
  // honestly fine with it being max to encourage PvP play"), so this equals
  // win and the curve code reads the same as ever.
  pvpWin: 50,
  dailyFirstWin: 50,
};

/**
 * THE WIN BONUS BY THE MARGIN. The user, 2026-09-11: "make win rewards scale
 * with point differential", and close losses pay too.
 *
 * The curve is linear: a 1-point win pays 20, a 50-point win pays 100.
 *
 * It was tuned on 100 simulated games, where the median margin was 17 and a
 * quarter of games were won by 30 or more. Over that spread the AVERAGE win
 * still pays about 50, so the economy stays where it was.
 *
 * PvP no longer scales this curve (pvpWin equals win); its premium is
 * PAY_MAX on the whole earned base, applied in settleGameReward.
 *
 * A claim with no margin (a client older than this) gets the flat bonus it
 * always did.
 */
export const WIN_BY_MARGIN = { min: 20, max: 100, fullAt: 50 };
/** Losing by this much or less — a tie included — pays a consolation. */
export const CLOSE_LOSS = { within: 5, coins: 15 };

/**
 * A GAME INSIDE A DYNASTY PAYS MORE. The user, 2026-09-11, on the small
 * per-game nudge: "Something between the flat +10 and 25%. Maybe 10-20%?" —
 * so 15% on what the game itself paid, on top of the title money the year
 * pays at the end.
 *
 * Milestones are NOT scaled: they come out of a daily cap (DAILY_MILESTONE_CAP)
 * and scaling them would quietly raise it. The bonus rides on the parts a
 * dynasty game earns for being played — completion, the win bonus or a close
 * loss, and the daily first win.
 *
 * The claim's `dynasty` flag is the SERVER'S (functions/index.js), never the
 * browser's: it is set only after reading the player's own dynasty document
 * and finding the live season the game says it belongs to.
 */
export const DYNASTY_GAME_FACTOR = 1.15;

/**
 * WHAT THE RUNG PAYS. The user, 2026-09-14: "make sure we're scaling coin
 * earnings based on difficulty too."
 *
 * ── THE LADDER PAID BACKWARDS ───────────────────────────────────────────────
 *
 * The win bonus already scales with the MARGIN (WIN_BY_MARGIN above): 20 coins
 * at +1, 100 at +50. An easier coach loses by more, so before this table the
 * cheapest opponent was the most profitable one and grinding Settler was the
 * optimal way to earn.
 *
 * MEASURED IN MIRROR MATCHES — the same ten on both benches, so the rung is
 * the only thing that differs; roster strength is a separate lever with its
 * own fix. 1,200 games a rung, scripts/analysis/runDifficultyPay.js:
 *
 *     rung        margin   win%   coins/game   vs Deity
 *     Settler       +7.8    68%       107.1     1.112x
 *     Chieftain     +4.9    63%       103.1     1.070x
 *     Warlord       +2.4    55%        99.7     1.035x
 *     Prince        +0.8    52%        97.8     1.016x
 *     King          -0.1    50%        96.5     1.002x
 *     Deity         -0.7    49%        96.3     1.000x   (control)
 *
 * Monotonic on all four columns, and the control sits within noise of even
 * (1.6 sd on margin at this n, 0.7 on win rate).
 *
 * ── THE FAIR RUNG IS 1x, AND IT IS THE DEFAULT ───────────────────────────────
 *
 * The user, 2026-09-16: "I think the midpoint should be the 1x payout, with
 * Deity being the 1.5x or whatever. Although I think for that, the actual
 * difficulty would be tilted toward losing. i.e. it should be really hard to
 * win on Deity."
 *
 * So the ladder is Civilization's shape (aiLevels.js): below Prince the coach
 * is handicapped and pays under 1x; Prince is a fair game — the full search,
 * an equal roster — at 1x, and it is the default, because 1x is the rate the
 * economy was tuned at (the "~110 games for the hardest collection" number)
 * and the default experience must stay on it; above Prince the coach's TEAM
 * is better, drawn to a richer cap, and a win against it pays more.
 *
 * A PvP game carries no rung and is untouched by this table: two people play
 * on their own logic, and it pays its own flat rate (pvpWin).
 *
 * ── WHAT A BONUS COSTS IN TRUST ─────────────────────────────────────────────
 *
 * The first ladder was penalties only, so a client that lied about its rung
 * could gain nothing. With Deity at 1.5x that property is gone: the rung is
 * client-asserted, and it now buys coins — the same class of trust as the
 * client-asserted margin, which already moves a win between 20 and 100. Two
 * things bound it. The factor is clamped here, so the most a lie can name is
 * PAY_MAX. And a LEAGUE game pays at the lower of the rung the league was
 * created at and the rung it was played at (functions/index.js reads the
 * league's own document): a season or dynasty builds its AI rosters once, to
 * its rung's cap, so being paid for a Deity game inside a Prince league would
 * be paid for opponents that were never on the floor.
 */
// THE RUNG TABLE. Ordered easiest to hardest. The labels, the pay, and the
// two things that make a rung above Prince harder — `cap`, the multiplier on
// the salary or DP cap the coach's rosters are built to, and `samples`, how
// many of the human's possible lineups its placement search weighs — all
// live HERE rather than beside the iq numbers in aiLevels.js, because this
// module is import-free and the server runs it: a friends dynasty is dealt on
// the server, and its AI teams draft to the rung's cap. aiLevels.js reads
// this table; one list of rungs beats two that drift.
//
// `cap` for King and Deity is SET BY MEASUREMENT (scripts/analysis/
// runHandicapLevers.js, 800 games a lever, full-search coach both benches):
// a 10% richer cap won 72.9% (+11.7 a game), a 20% richer cap 86.6% (+21.0),
// with the control at 51.2%. The cap is a strong lever — about a point of
// margin per percent — so the targets (King ~60%, Deity ~75%) sit at 1.05 and
// 1.12. First reading; a rerun at exactly these values is the next check.
export const AI_PAY = {
  settler:   { label: 'Settler',   pay: 0.5,  cap: 1,    samples: 1 },
  chieftain: { label: 'Chieftain', pay: 0.7,  cap: 1,    samples: 4 },
  warlord:   { label: 'Warlord',   pay: 0.85, cap: 1,    samples: 8 },
  prince:    { label: 'Prince',    pay: 1,    cap: 1,    samples: 16 },
  king:      { label: 'King',      pay: 1.25, cap: 1.05, samples: 32 },
  deity:     { label: 'Deity',     pay: 1.5,  cap: 1.12, samples: 64 },
};
/** The multiplier on the cap the coach's rosters are built to at this rung — 1 up to Prince, and for no rung. */
export function capOf(level) {
  const c = AI_PAY[level]?.cap;
  return Number.isFinite(c) && c > 0 ? c : 1;
}
/** How many of the human's possible lineups the coach's placement search weighs at this rung. */
export function samplesOf(level) {
  const n = AI_PAY[level]?.samples;
  return Number.isFinite(n) && n > 0 ? n : 16;
}
/** The most any rung can pay — the clamp a client-asserted rung is held to. */
export const PAY_MAX = 1.5;
/** The pay factor for a rung id. An id this table does not know pays the fair rate. */
export function payFactorOf(level) {
  const f = AI_PAY[level]?.pay;
  return Number.isFinite(f) ? Math.min(PAY_MAX, Math.max(0, f)) : 1;
}
/** The lower of two rungs' pay — what a league game pays when it was played above the rung it was built at. */
export function payFloorOf(created, played) {
  return Math.min(payFactorOf(created), payFactorOf(played));
}

const MAX_MARGIN = 200;

/** A client-sent margin as a whole number of points, or null for none. */
export function sanitizeMargin(m) {
  if (m === null || m === undefined || m === '') return null;
  const n = Number(m);
  if (!Number.isFinite(n)) return null;
  return Math.max(-MAX_MARGIN, Math.min(MAX_MARGIN, Math.round(n)));
}

/** The victory bonus for winning by `margin` (null: the flat bonus). */
export function winBonus(margin, pvp = false) {
  if (margin === null || margin === undefined) return pvp ? REWARD.pvpWin : REWARD.win;
  const { min, max, fullAt } = WIN_BY_MARGIN;
  const m = Math.max(1, margin);
  const base = Math.min(max, Math.round(min + ((max - min) * (m - 1)) / (fullAt - 1)));
  return pvp ? Math.round((base * REWARD.pvpWin) / REWARD.win) : base;
}

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
 *   claim  { won, pvp, margin, milestoneIds, bam }   what the client says happened
 *          (margin: MY score minus theirs; null when nobody is "you")
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

  const margin = sanitizeMargin(c.margin);
  if (c.won) {
    const bonus = winBonus(margin, c.pvp);
    coins += bonus;
    const by = margin !== null ? ` · by ${Math.max(1, margin)}` : '';
    breakdown.push({ label: `${c.pvp ? 'PvP Victory' : 'Victory Bonus'}${by}`, coins: bonus });
  } else if (margin !== null && margin <= 0 && -margin <= CLOSE_LOSS.within) {
    coins += CLOSE_LOSS.coins;
    breakdown.push({ label: margin === 0 ? 'Tie Game' : `Close Loss · by ${-margin}`, coins: CLOSE_LOSS.coins });
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

  // THE TWO MULTIPLIERS, both on everything but the capped milestone coins.
  //
  // Milestones are left out of both: they come out of a daily cap
  // (DAILY_MILESTONE_CAP) and scaling them would quietly move it. What rides
  // here is what the game earns for being played — completion, the win bonus
  // or a close loss, and the daily first win.
  //
  // The rung comes off FIRST, because it says what the game was worth; the
  // dynasty rate then pays its 15% on that. A Settler dynasty game is
  // 0.5 x 1.15, not 1.15 with a discount bolted on after.
  const earned = coins - milestoneCoins;
  // A PvP GAME PAYS THE TOP RATE. The user, 2026-09-16: "I'm honestly fine
  // with it being max to encourage PvP play." So two people are paid what
  // Deity pays — the same multiplier on the same base — and the old separate
  // premium on the win bonus alone (pvpWin) is folded into this.
  const pay = c.pvp ? PAY_MAX : payFactorOf(c.aiLevel);
  if (pay !== 1) {
    const delta = Math.round(earned * pay) - earned;
    if (delta !== 0) {
      coins += delta;
      const label = c.pvp ? 'PvP' : (AI_PAY[c.aiLevel]?.label ?? (pay < 1 ? 'Easier coach' : 'Harder coach'));
      breakdown.push({ label: `${label} · ${Math.round(pay * 100)}% rate`, coins: delta });
    }
  }
  if (c.dynasty) {
    const base = coins - milestoneCoins;
    const extra = Math.floor(base * (DYNASTY_GAME_FACTOR - 1));
    if (extra > 0) {
      coins += extra;
      breakdown.push({ label: `Dynasty Game · +${Math.round((DYNASTY_GAME_FACTOR - 1) * 100)}%`, coins: extra });
    }
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
export const BOX_FIELDS = ['pts', 'reb', 'ast', 'min', 'tpm', 'tpa', 'alw', 'gs', 'fta', 'ftm', 'pnta', 'pntm', 'dca', 'dcm', 'blk', 'onf', 'ona'];
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
