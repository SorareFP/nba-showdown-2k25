// Game logs for the team-reward SHORTLIST, so candidates can be priced the way
// the cards will actually be built.
//
//   node scripts/cardgen/teamRewardCandidates.js          # shortlist, per-100
//   node scripts/cardgen/fetchTeamRewardCandidateLogs.mjs # logs for the top N
//   node scripts/cardgen/teamRewardCandidates.js --real   # price on real logs
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
//
// Every card in this game gets its chart cut from real game logs — except, for
// a while, the team rewards, which had none fetched and silently fell back to
// per-100 season rates. Rates smooth a chart toward the player's mean instead
// of cutting it from the spread of actual games, and since rebounds and assists
// are spendable currency in playValue.js the smoothing was being paid for in
// salary. Correcting it moved the thirty rewards down by $300-450 apiece.
//
// So the candidate search has to price on real logs too, and that means having
// them. Fetching a log for all 3,148 candidates would be thousands of requests
// at a polite spacing; fetching them for a SHORTLIST is a few hundred.
//
// ── HOW THE SHORTLIST IS DRAWN ──────────────────────────────────────────────
//
// From the per-100 pass, which is cheap and — measured on the 29 picks that
// have both prices — correlates with the real-log price at r = 0.86, fitting
// `real ≈ 104 + 0.621 × per100` with a residual sd of about $103. That is a
// good ranking and a bad estimate: good enough to say "these thirty are the
// plausible ones for this franchise", nowhere near good enough to say which
// band one lands in. Hence shortlist wide here, then price for real.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, readCache, writeCache, politeDelay, DEFAULT_REQUEST_SPACING_MS } from './cache.js';
import { fetchGameLogFull } from './sources/basketballReference.js';
import { OUTPUT_FILE as CANDIDATES_FILE } from './teamRewardCandidates.js';

/** The per-100 → real-log fit, measured on the 29 paired picks. */
export const REAL_FROM_PER100 = { intercept: 104, slope: 0.621 };
export const per100Needed = target =>
  Math.round((target - REAL_FROM_PER100.intercept) / REAL_FROM_PER100.slope);

/** Reach a little below the rare floor, so a franchise short on options has some. */
const FLOOR_TARGET = 650;
const PER_FRANCHISE = 30;

if (!fs.existsSync(CANDIDATES_FILE)) {
  console.error(`No candidate file. Run: node scripts/cardgen/teamRewardCandidates.js`);
  process.exit(1);
}
const { byFranchise } = JSON.parse(fs.readFileSync(CANDIDATES_FILE, 'utf8'));
const floor = per100Needed(FLOOR_TARGET);

const pairs = new Map();
for (const rows of Object.values(byFranchise)) {
  for (const r of rows.filter(x => x.salary >= floor).slice(0, PER_FRANCHISE)) {
    pairs.set(`${r.bbrefId ?? r.name}|${r.season}`, r);
  }
}
console.log(
  `shortlist: ${pairs.size} (player, season) pairs at per-100 >= $${floor} ` +
    `(~$${FLOOR_TARGET} real), max ${PER_FRANCHISE} per franchise`
);

let fetched = 0;
let cached = 0;
const failed = [];
for (const r of pairs.values()) {
  const id = r.bbrefId;
  if (!id) { failed.push(`${r.name} ${r.season}: candidate row carries no bbrefId`); continue; }
  const key = `gamelog-full-${id}-${r.season}`;
  if (readCache(key)) { cached += 1; continue; }
  try {
    writeCache(key, await fetchGameLogFull(id, r.season));
    fetched += 1;
    if (fetched % 25 === 0) console.log(`...${fetched} fetched (${r.name} ${r.season})`);
    await politeDelay(DEFAULT_REQUEST_SPACING_MS);
  } catch (e) {
    failed.push(`${r.name} ${r.season} (${id}): ${e.message}`);
    await politeDelay(DEFAULT_REQUEST_SPACING_MS);
  }
}
fs.writeFileSync(
  path.join(REPO_ROOT, 'card-data', 'generated', 'team-reward-candidate-logs.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), pairs: pairs.size, fetched, cached, failed }, null, 2)}\n`
);
console.log(`done: ${fetched} fetched, ${cached} cached, ${failed.length} failed`);
if (failed.length) console.log('  ' + failed.slice(0, 20).join('\n  '));
