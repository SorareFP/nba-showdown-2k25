// A BPM EQUIVALENT FOR A LEAGUE THAT HAS NO BPM.
//
// ── THE PROBLEM ─────────────────────────────────────────────────────────────
//
// Every other card set in this repo is ordered by a plus/minus estimate. The
// base set uses dunksandthrees' EPM; the Super Season and Rookie sets use
// Basketball-Reference's BPM, because EPM does not exist for past seasons.
// Basketball-Reference's WNBA pages carry NEITHER — no BPM, no OBPM, no DBPM,
// no VORP, no plus/minus estimate of any kind. What they do carry is PER, Win
// Shares (OWS/DWS/WS/WS-per-40), ORtg/DRtg, the usual rate percentages, and a
// complete per-100-possession box score.
//
// The user's stated preference was PER plus a minority of Win Shares, with
// ORtg/DRtg splitting it into offensive and defensive halves — "3 would be
// awesome" meaning a real BPM equivalent, "if you can pull 3 off, hell yeah."
//
// ── WHAT THIS DOES INSTEAD, AND WHY IT IS SOUND ─────────────────────────────
//
// BPM is not a mystery. It is a LINEAR FUNCTION of a player's per-100 box
// score, a position/role estimate, and a team adjustment — that is its
// published definition. So the honest way to get a BPM equivalent is not to
// invent a blend, it is to FIT BPM where BPM exists and carry the coefficients
// across:
//
//   1. Take fifteen NBA seasons where BOTH the inputs and true BPM/OBPM/DBPM
//      are published.
//   2. Keep ONLY the inputs the WNBA pages also carry. Anything the NBA has
//      and the WNBA does not is thrown away before fitting, so the fitted model
//      is one the WNBA can actually evaluate.
//   3. Express every input as a deviation from ITS OWN LEAGUE-SEASON's
//      minutes-weighted mean. This is the step that makes the transfer legal:
//      BPM is defined as points per 100 possessions ABOVE LEAGUE AVERAGE, so
//      its zero point is by construction the league it was computed in. A WNBA
//      player's +4 TS% above the WNBA mean enters the model exactly where an
//      NBA player's +4 above the NBA mean does.
//   4. Fit, hold players out, and report the out-of-sample R².
//   5. Apply the same coefficients to the WNBA's league-centred inputs.
//
// ── WHAT THE WNBA PAGE LACKS THAT REAL BPM USES, EXACTLY ────────────────────
//
// Stated rather than glossed, because every one of these is a reason the
// transfer is approximate:
//
//   THE TEAM ADJUSTMENT. The single biggest one. Real BPM's last step forces a
//   team's players' BPM to sum to that team's actual efficiency margin per 100
//   possessions, which is how a player on a genuinely good team is credited for
//   the wins the box score cannot see. Nothing here reproduces that step, and
//   the model has no access to team results at all. What it does have is the
//   player's own ORtg and DRtg, which carry team context (DRtg especially is
//   largely a team number), so the term is proxied rather than absent — but the
//   unexplained variance this leaves is most of the residual below.
//
//   DRB% — the WNBA advanced page carries ORB% and TRB% only. Recovered in
//   per-100 form instead (`drb100 = trb100 - orb100`, exact by definition), so
//   the information is there in a different unit; the PERCENTAGE, which knows
//   about available rebounds, is not.
//
//   BBRef'S OWN POSITION AND OFFENSIVE-ROLE ESTIMATES, which it computes from
//   the box score per player and feeds into BPM. Only the LISTED position is
//   available, and the WNBA lists it as G / F / C (with hyphenated pairs), so
//   the NBA's five slots are collapsed to three on both sides of the fit —
//   deliberately, so the model never sees a distinction the WNBA cannot make.
//
//   PERSONAL FOULS drawn, shot location, and everything else that is not in a
//   season table. Real BPM does not use these either; noted so the list reads
//   as complete.
//
// ── AND THE LEAGUE-CONTEXT QUESTION, WHICH DOES NOT GO AWAY ─────────────────
//
// Centring makes the ZERO point right in both leagues. It does not make the
// SLOPES right. A coefficient fitted on the NBA says "a point of TS% above the
// NBA mean is worth this much NBA BPM"; applied to the WNBA it assumes the same
// exchange rate holds in a league with a different possession value (WNBA
// offensive rating runs about 101 against the NBA's 114), a different
// three-point rate and a different distribution of size. That assumption is
// UNTESTABLE from inside this data — there is no WNBA BPM to check against —
// and it is the honest limit of the whole exercise. What the out-of-sample R²
// does establish is the other half: that these inputs determine BPM at all,
// and how much of it they miss.
//
// Deliberately NOT z-scored per league, only centred. Scaling by each league's
// own standard deviation would additionally assume that the SPREAD of talent is
// the same width in both leagues, which is a second and much stronger claim; it
// would also stretch a WNBA feature's units away from points per 100. The
// fitting below standardises internally for conditioning and converts the
// coefficients back to raw units before storing them, so nothing about the
// WNBA's spread ever enters the model.

/** Minutes in a game, per league — the denominator of the minutes share. */
export const GAME_MINUTES = { nba: 48, wnba: 40 };

/**
 * FEATURES. Each is a function of one joined `{ advanced, perPoss }` row, and
 * every one of them is readable from the WNBA pages — that is the entry
 * requirement, not a preference.
 *
 * Rows arrive already normalised into one flat shape by `featureRow` in the
 * fitting script and by the WNBA generator, so this map is the only place the
 * two leagues have to agree.
 */
export const FEATURES = {
  // ── The all-in-one metrics the WNBA does have ────────────────────────────
  per: r => r.per,
  // Win Shares as a RATE, per full game of playing time: WS/48 in the NBA and
  // WS/40 in the WNBA. Not interchangeable numbers and exactly interchangeable
  // QUANTITIES — both league-average to 0.100 by construction, because league
  // total Win Shares is league total wins and league total minutes is
  // teams x games x five players x game length, in either league.
  wsRate: r => r.wsRate,
  owsRate: r => r.owsRate,
  dwsRate: r => r.dwsRate,
  // ── Efficiency and role ──────────────────────────────────────────────────
  tsPct: r => r.tsPct,
  efg: r => r.efg,
  fg3aRate: r => r.fg3aRate,
  ftRate: r => r.ftRate,
  usgPct: r => r.usgPct,
  // ── Box-score rate percentages. NO drb_pct: the WNBA page has none. ──────
  orbPct: r => r.orbPct,
  trbPct: r => r.trbPct,
  astPct: r => r.astPct,
  stlPct: r => r.stlPct,
  blkPct: r => r.blkPct,
  tovPct: r => r.tovPct,
  // ── Team context, the only proxy for BPM's team adjustment ───────────────
  offRtg: r => r.offRtg,
  defRtg: r => r.defRtg,
  // ── The per-100 box score. BPM's real inputs, in BPM's own units. ────────
  pts100: r => r.pts100,
  fga100: r => r.fga100,
  fg3a100: r => r.fg3a100,
  fta100: r => r.fta100,
  orb100: r => r.orb100,
  drb100: r => r.drb100,
  ast100: r => r.ast100,
  stl100: r => r.stl100,
  blk100: r => r.blk100,
  tov100: r => r.tov100,
  pf100: r => r.pf100,
  // ── Volume and position ──────────────────────────────────────────────────
  // Share of the team's available minutes. League-relative by centring, which
  // matters here more than anywhere: a 30-minute WNBA starter is at 0.75 of a
  // 40-minute game and a 30-minute NBA starter at 0.625 of a 48-minute one, so
  // the raw values are not the same quantity and the centred ones are.
  minShare: r => r.minShare,
  // THREE POSITIONS, NOT FIVE, because the WNBA lists three. Forward is the
  // reference level. Collapsing the NBA to match is what stops the model
  // learning a PG/SG distinction it can never evaluate on a WNBA row.
  isGuard: r => (r.posGroup === 'G' ? 1 : 0),
  isCenter: r => (r.posGroup === 'C' ? 1 : 0),
};

/**
 * The candidate feature sets, compared on held-out NBA players by the fitting
 * script. `full` is the one that ships unless the report says otherwise.
 */
/** The three Win Shares rates, named once so a set can be built without them. */
export const WIN_SHARE_FEATURES = ['wsRate', 'owsRate', 'dwsRate'];

/**
 * The only two features that carry anything about the player's TEAM.
 *
 * ── DO NOT "DE-TEAM" defRtg. IT WAS MEASURED, AND IT DOES NOT DO WHAT IT LOOKS
 *    LIKE IT DOES ───────────────────────────────────────────────────────────
 *
 * The observation that starts this every time: WNBA Def Boost, aggregated to
 * team means, correlates with team defensive rating at r = -0.926 across the
 * fifteen teams. It looks like proof that the card is printing the team.
 *
 * IT IS NOT DIAGNOSTIC, and the NBA is the control that shows why. The NBA set
 * builds Def Boost from DEF EPM — the metric explicitly engineered to isolate
 * one player's contribution from his team's — and on the identical test it
 * scores r = -0.912. A team's defensive rating IS its players' defence summed;
 * a perfect individual metric would still correlate with it at about -0.9.
 * The test cannot separate "the card is contaminated" from "good defenders
 * play on good defences", so it should not be used to claim either.
 *
 * THE MEASURE THAT DOES SEPARATE THEM is the between-team share of variance
 * (`betweenTeamShare` below) — of all the spread in a metric, how much is
 * between teams rather than between team-mates. Measured on 2026:
 *
 *     real BBRef DBPM, NBA, 500+ min, minutes-weighted   38.3%   <- benchmark
 *     this model's dbpmHat, WNBA, 400+ min, weighted     37.8%
 *
 * The fitted WNBA output is no more team-bound than the published NBA DBPM it
 * is imitating. There is no excess to remove.
 *
 * AND THE TWO OBVIOUS FIXES DO NOT WORK, because `defRtg` is not the team term
 * — it is HALF of a team term. Between-team share of the inputs themselves:
 *
 *     defRtg   62.0%        dwsRate  61.7%       (WNBA 2026, 400+ min)
 *     defRtg   67.0%        dwsRate  67.1%       (NBA  2026, 500+ min)
 *
 * Defensive Win Shares is built on individual Defensive Rating, so it is a team
 * stat wearing a player's name to exactly the same degree. Refitting with
 * `defRtg` made team-relative, or dropped outright, moves its weight onto
 * `dwsRate` — which is already the largest coefficient in the DBPM fit — and
 * changes almost nothing while costing accuracy against real DBPM:
 *
 *     shipped (full)              held-out-season R² 0.876   Mabrey -2.72
 *     defRtg -> team-relative                     0.871      Mabrey -2.56
 *     defRtg dropped                              0.870      Mabrey -2.58
 *     defRtg AND dwsRate dropped                  0.804      Mabrey -1.86
 *
 * Only the last one moves a card, and it over-corrects: it drives the
 * between-team share to 17.1%, less than half the 38.3% that real DBPM carries,
 * for seven points of R². A WNBA card would then be LESS team-aware than the
 * NBA cards it is played against.
 *
 * So the team term stays. `betweenTeamShare` and the tests over the shipped
 * card files are what stop a future edit from "fixing" this into being wrong.
 */
export const TEAM_CONTEXT_FEATURES = ['offRtg', 'defRtg'];

/**
 * The candidate feature sets, compared on held-out NBA players by the fitting
 * script. Each one exists to ANSWER A QUESTION, not to pad the table:
 *
 *   perWinShares   the user's own proposal — PER and Win Shares split by
 *                  ORtg/DRtg — as the declared fallback, so the report can say
 *                  what the non-fitted path would have produced.
 *   boxScore       a pure box score with NO team information at all. Its gap to
 *                  boxScoreTeam is a direct measurement of what BPM's team
 *                  adjustment is worth, which is the largest single thing the
 *                  WNBA pages cannot supply.
 *   boxScoreTeam   the same plus ORtg/DRtg — the proxy actually available.
 *   noWinShares    everything EXCEPT Win Shares. The user removed Win Shares
 *                  from the NBA special sets as team-dependent, and that
 *                  objection does not evaporate here; this set is what says how
 *                  much keeping it actually buys.
 *   advancedOnly   what the advanced page alone can do, no per-100 box score.
 *   full           everything the WNBA carries.
 */
export const FEATURE_SETS = {
  perWinShares: ['per', 'wsRate', 'owsRate', 'dwsRate', 'offRtg', 'defRtg', 'minShare'],
  boxScore: [
    'pts100', 'fga100', 'fg3a100', 'fta100', 'orb100', 'drb100', 'ast100', 'stl100',
    'blk100', 'tov100', 'pf100', 'tsPct', 'minShare', 'isGuard', 'isCenter',
  ],
  boxScoreTeam: [
    'pts100', 'fga100', 'fg3a100', 'fta100', 'orb100', 'drb100', 'ast100', 'stl100',
    'blk100', 'tov100', 'pf100', 'tsPct', 'minShare', 'isGuard', 'isCenter',
    'offRtg', 'defRtg',
  ],
  advancedOnly: [
    'per', 'wsRate', 'owsRate', 'dwsRate', 'tsPct', 'efg', 'fg3aRate', 'ftRate', 'usgPct',
    'orbPct', 'trbPct', 'astPct', 'stlPct', 'blkPct', 'tovPct', 'offRtg', 'defRtg',
    'minShare', 'isGuard', 'isCenter',
  ],
  noWinShares: Object.keys(FEATURES).filter(k => !WIN_SHARE_FEATURES.includes(k)),
  full: Object.keys(FEATURES),
};

/** Collapses any source's position spelling to the three the WNBA lists. */
export function positionGroup(pos) {
  const first = String(pos ?? '').trim().split(/[-/,]/)[0].trim().toUpperCase();
  if (first === 'C') return 'C';
  if (first === 'PG' || first === 'SG' || first === 'G') return 'G';
  return 'F';
}

/** Minutes-weighted mean of a field, ignoring rows that do not carry it. */
export function weightedMean(rows, of, weightOf = r => r.minutes ?? 0) {
  let sw = 0;
  let sx = 0;
  for (const r of rows) {
    const v = of(r);
    const w = weightOf(r);
    if (!Number.isFinite(v) || !Number.isFinite(w) || w <= 0) continue;
    sw += w;
    sx += v * w;
  }
  return sw > 0 ? sx / sw : 0;
}

/**
 * Of all the spread in a quantity, how much sits BETWEEN groups rather than
 * within them. 0 means team-mates differ as much as teams do; 1 means every
 * team-mate is identical and only the team badge matters.
 *
 * This is the honest measure of "is this a player stat or a team stat", and the
 * reason it is here rather than in a scratch script is that the correlation
 * everyone reaches for instead is not diagnostic — see TEAM_CONTEXT_FEATURES.
 *
 * Weighted, and by minutes wherever the rows carry them, for the same reason
 * `centringBasis` is: a league table's replacement-level rows are noise, and
 * they would otherwise dominate the within-group half and flatter the metric.
 * Pass `() => 1` for an unweighted share over a set of finished cards, which is
 * what the card-level tests use — a card has no minutes on it.
 */
export function betweenTeamShare(rows, valueOf, groupOf, weightOf = r => r.minutes ?? 1) {
  const use = rows.filter(
    r => Number.isFinite(valueOf(r)) && groupOf(r) != null && weightOf(r) > 0
  );
  if (use.length === 0) return 0;
  const total = use.reduce((a, r) => a + weightOf(r), 0);
  const grand = use.reduce((a, r) => a + valueOf(r) * weightOf(r), 0) / total;
  const groups = new Map();
  for (const r of use) {
    const g = groupOf(r);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  let between = 0;
  let within = 0;
  for (const [, members] of groups) {
    const w = members.reduce((a, r) => a + weightOf(r), 0);
    const mean = members.reduce((a, r) => a + valueOf(r) * weightOf(r), 0) / w;
    between += w * (mean - grand) ** 2;
    for (const r of members) within += weightOf(r) * (valueOf(r) - mean) ** 2;
  }
  const spread = between + within;
  // A quantity with no spread at all is not "all team" — it is nothing, and 0
  // is the answer that keeps a constant column from reading as maximal bias.
  return spread > 1e-12 ? between / spread : 0;
}

/**
 * Each feature's LEAGUE-SEASON centre — the value that becomes zero.
 *
 * Minutes-weighted on purpose: an unweighted mean over a league table is
 * dominated by its two hundred ten-minute cups of coffee, whose rate stats are
 * noise, and the league "average" a plus/minus metric is defined against is the
 * average MINUTE, not the average name on the roster.
 */
export function centringBasis(rows, keys = Object.keys(FEATURES)) {
  const basis = {};
  for (const key of keys) basis[key] = weightedMean(rows, FEATURES[key]);
  return basis;
}

/** One row's features, centred on its own league-season. Missing reads as centre. */
export function centredFeatures(row, basis, keys) {
  return keys.map(key => {
    const v = FEATURES[key](row);
    return Number.isFinite(v) ? v - (basis[key] ?? 0) : 0;
  });
}

/**
 * Weighted ridge regression, fitted in STANDARDISED space and returned in RAW
 * units.
 *
 * Ridge rather than plain least squares because the feature set is openly
 * collinear — PER, USG%, points per 100 and FGA per 100 all describe the same
 * thing from different angles — and an unpenalised normal-equation solve on
 * that either blows up or hands back enormous cancelling coefficients that
 * generalise badly. λ is small (see RIDGE_LAMBDA); the fitting script reports
 * out-of-sample R² across a sweep so the choice is visible.
 *
 * STANDARDISING INTERNALLY AND CONVERTING BACK IS THE POINT. A ridge penalty is
 * scale-dependent, so it must be applied to comparable columns, and every
 * column here is in different units (points per 100, percentages, a 0-1 share).
 * But the STORED model must be in raw units, because applying a standardised
 * model to the WNBA would divide WNBA features by NBA standard deviations —
 * quietly importing an assumption that the two leagues' talent spreads are the
 * same width. Fitting standardised and storing raw keeps the conditioning
 * benefit and leaves that assumption out.
 */
/**
 * λ = 0.1, and it is a CHOICE BETWEEN TWO RISKS rather than the sweep's argmax.
 *
 * Measured on held-out NBA seasons (fitBpmModel.js prints the whole sweep):
 *
 *     λ=0     R² 0.956   sum|coef| 70.1
 *     λ=0.01  R² 0.951   sum|coef| 55.2
 *     λ=0.1   R² 0.945   sum|coef| 40.1     <- shipped
 *     λ=1     R² 0.892   sum|coef| 33.9
 *     λ=10    R² 0.539   sum|coef| 14.3
 *
 * Unpenalised scores best and is the worst thing to carry across a league
 * boundary. The design is near-singular by construction — `trb100` is
 * `orb100 + drb100` to within Basketball-Reference's rounding decimal, and `ws`
 * is `ows + dws` the same way — so λ=0 buys its extra accuracy with enormous
 * coefficients that cancel each other. They cancel reliably in the league they
 * were fitted on. λ=0.1 gives up a tenth of a point of R² to halve them.
 */
export const RIDGE_LAMBDA = 0.1;

export function fitRidge(X, y, weights, lambda = RIDGE_LAMBDA) {
  const n = X.length;
  if (n === 0) return null;
  const k = X[0].length;
  const w = weights ?? X.map(() => 1);
  const totalW = w.reduce((a, b) => a + b, 0);

  const mean = new Array(k).fill(0);
  for (let j = 0; j < k; j += 1) {
    let s = 0;
    for (let i = 0; i < n; i += 1) s += w[i] * X[i][j];
    mean[j] = s / totalW;
  }
  const sd = new Array(k).fill(0);
  for (let j = 0; j < k; j += 1) {
    let s = 0;
    for (let i = 0; i < n; i += 1) s += w[i] * (X[i][j] - mean[j]) ** 2;
    sd[j] = Math.sqrt(s / totalW) || 1;
  }
  let yMean = 0;
  for (let i = 0; i < n; i += 1) yMean += w[i] * y[i];
  yMean /= totalW;

  // Normal equations on the standardised, centred design, with λ on the
  // diagonal. The intercept is handled by centring y, so it is never penalised.
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const b = new Array(k).fill(0);
  for (let i = 0; i < n; i += 1) {
    const z = new Array(k);
    for (let j = 0; j < k; j += 1) z[j] = (X[i][j] - mean[j]) / sd[j];
    const dy = y[i] - yMean;
    for (let a = 0; a < k; a += 1) {
      b[a] += w[i] * z[a] * dy;
      for (let c = 0; c < k; c += 1) A[a][c] += w[i] * z[a] * z[c];
    }
  }
  for (let j = 0; j < k; j += 1) A[j][j] += lambda * totalW;

  const beta = solve(A, b);
  if (!beta) return null;

  // Back to raw units: y = intercept + Σ (beta_j / sd_j) * x_j
  const coef = beta.map((v, j) => v / sd[j]);
  const intercept = yMean - coef.reduce((s, c, j) => s + c * mean[j], 0);
  return { intercept, coef };
}

/** Gauss-Jordan with partial pivoting. Null on a singular system. */
function solve(A, b) {
  const k = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < k; i += 1) {
    let pivot = i;
    for (let r = i + 1; r < k; r += 1) if (Math.abs(M[r][i]) > Math.abs(M[pivot][i])) pivot = r;
    if (Math.abs(M[pivot][i]) < 1e-12) return null;
    [M[i], M[pivot]] = [M[pivot], M[i]];
    for (let r = 0; r < k; r += 1) {
      if (r === i) continue;
      const f = M[r][i] / M[i][i];
      for (let c = i; c <= k; c += 1) M[r][c] -= f * M[i][c];
    }
  }
  // `row[i]` is this row's pivot and `row[k]` its right-hand side: after full
  // Gauss-Jordan the matrix is diagonal, so each unknown is one division.
  return M.map((row, i) => row[k] / row[i]);
}

/** A fitted model applied to one feature vector. */
export function predict(model, features) {
  return model.intercept + model.coef.reduce((s, c, i) => s + c * (features[i] ?? 0), 0);
}

/**
 * Weighted R². Reported OUT OF SAMPLE, against the held-out mean, so a model
 * that merely memorised the training set scores what it deserves.
 */
export function rSquared(actual, predicted, weights) {
  const w = weights ?? actual.map(() => 1);
  const totalW = w.reduce((a, b) => a + b, 0);
  if (!(totalW > 0)) return 0;
  const mean = actual.reduce((s, v, i) => s + w[i] * v, 0) / totalW;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < actual.length; i += 1) {
    ssRes += w[i] * (actual[i] - predicted[i]) ** 2;
    ssTot += w[i] * (actual[i] - mean) ** 2;
  }
  return ssTot > 1e-12 ? 1 - ssRes / ssTot : 0;
}

/** Root mean squared error, weighted the same way — R²'s units-carrying twin. */
export function rmse(actual, predicted, weights) {
  const w = weights ?? actual.map(() => 1);
  const totalW = w.reduce((a, b) => a + b, 0);
  if (!(totalW > 0)) return 0;
  let s = 0;
  for (let i = 0; i < actual.length; i += 1) s += w[i] * (actual[i] - predicted[i]) ** 2;
  return Math.sqrt(s / totalW);
}

/**
 * The fitted model, applied to a whole league-season.
 *
 * `rows` are one league-season's flat feature rows; the centring basis is
 * measured from THEM, which is what makes the output league-relative. Returns
 * one `{ bpm, obpm, dbpm }` per row, in the same order.
 *
 * `basisRows` exists for the case the WNBA generator needs: the centring must
 * be measured over the WHOLE LEAGUE, not over the 108 players being carded,
 * because "league average" means the league. Pass the full table there and the
 * pool here.
 */
export function applyModel(model, rows, { basisRows } = {}) {
  const keys = model.features;
  const basis = centringBasis(basisRows ?? rows, keys);
  return rows.map(row => {
    const x = centredFeatures(row, basis, keys);
    return {
      bpm: predict(model.targets.bpm, x),
      obpm: predict(model.targets.obpm, x),
      dbpm: predict(model.targets.dbpm, x),
    };
  });
}
