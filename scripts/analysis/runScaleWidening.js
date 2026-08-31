// Measures what each candidate Speed+Power scale would cost in scoring.
//
//   node scripts/analysis/runScaleWidening.js
//
// Writes card-data/analysis/scale-widening-2026-27.json and prints the table.
// Reads card data only — it never writes a card attribute, and it does not
// change the shipped scale. Flipping to a candidate is a change to
// WIDENING in scripts/cardgen/speedPower.js.
//
// THE SHIPPED SCALE IS ONE OF THESE ROWS — `spread x1.25, 6-30`, which takes its
// options straight from WIDENING so the two cannot drift.
//
// THE BASELINE ROW IS THE SCALE THE SET WAS ACTUALLY ON BEFORE, which is
// per-pool 10-28: the pre-archive calibration AND the pre-widening range. Both
// changed together, so measuring the widening from an archive-calibrated 10-28
// would hide half the move. The two are separable in the table — `absolute
// 10-28` is the recalibration with no widening at all — and separating them is
// the point: the recalibration alone buys +5 identities and +7 pts/team/game on
// a cap-legal field, and the widening is chosen to give that back.
//
// Each candidate is re-mapped from the COMMITTED composites in
// speed-power-totals-2026.json through the production `mapToReferenceScale`,
// then re-split and RE-PRICED, so every row is what the generator would
// actually produce at that scale — including the salary rise that makes a
// widened star harder to fit under the cap.
//
// CAP-LEGAL SCORING IS NOT SMOOTH IN THE SCALE and the table should not be read
// as if it were. A candidate moves cards across salary steps, and a step decides
// whether a ten-man roster can still afford its second star; neighbouring
// candidates can therefore differ by six points. Measured across five seeds the
// sampling error is about 0.3, so the dips are real rather than noise — which
// means a scale should be chosen from a FLAT neighbourhood, not from whichever
// single row reads best.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { mapToReferenceScale, REFERENCE_TOTALS, WIDENING } from '../cardgen/speedPower.js';
import { requireArchive } from '../cardgen/epmArchive.js';
import {
  SALARY_MAX,
  POSITION_SIZE,
  POSITION_SPEED_SHARE,
  SIZE_SPEED_SHARE,
  splitSpeedPower,
} from '../cardgen/attributes.js';
import { indexBiometrics, loadBiometrics } from '../cardgen/biometrics.js';
import { normalizeName } from '../cardgen/resolveTeams.js';
import {
  SCORING_ROLLS_PER_GAME,
  bonusExchangeRate,
  bonusPointsCurve,
  chartExpectedValues,
  respec,
  sampledGameScoring,
  scoringProfile,
  widenReference,
} from './scaleWidening.js';

const ROOT = new URL('../../', import.meta.url);
const readJson = p => JSON.parse(readFileSync(new URL(p, ROOT)));

const cards = (j => j.cards ?? j)(readJson('card-data/generated/cards-2026-27.json'));
const budgets = readJson('card-data/generated/speed-power-totals-2026.json');
const calibration = readJson('card-data/generated/card-calibration.json');
const shares = calibration.positionSpeedShare ?? POSITION_SPEED_SHARE;
const salaryModel = calibration.salary.model;

// The SAME split rule generateCards.js uses, size included. A candidate scale
// has to be measured against the set as it is actually printed — split by
// position AND size — or the "current" row would not be the shipped set and
// every delta below would be measured from somewhere the set has never been.
const biometrics = indexBiometrics(loadBiometrics());
const sizeOptions = {
  positionSize: calibration.positionSize ?? POSITION_SIZE,
  sizeModel: calibration.sizeSpeedShare ?? SIZE_SPEED_SHARE,
};
const sizes = cards.map(c => biometrics.get(normalizeName(c.name)) ?? null);

const compositeByName = new Map(budgets.map(b => [b.name, b.composite]));
const composites = cards.map(c => compositeByName.get(c.name));
const chartEvs = cards.map(chartExpectedValues);

/**
 * How many cap-legal drafts the game-scoring figure averages over, and the seeds.
 *
 * Every candidate is sampled with the SAME seeds, so the drafts differ only
 * because the salaries and budgets differ — which is the comparison being made.
 *
 * FIVE SEEDS RATHER THAN ONE, AND 1200 DRAFTS RATHER THAN 400, because the
 * decision this table informs turns on differences of a few tenths of a point
 * and one 400-draft sample cannot resolve those. Measured across seeds, one
 * sample of 400 carries about 0.4 of standard error and 1200 about 0.25; five of
 * those averaged brings it near 0.1, which is finally smaller than the
 * acceptance band. `seedSd` is reported per row so the number stays checkable
 * rather than merely tighter.
 */
const DRAFT_SAMPLES = 1200;
const DRAFT_SEEDS = [0x5eed, 0x5eed + 7919, 0x5eed + 15838, 0x5eed + 23757, 0x5eed + 31676];

/** The mean of `sampledGameScoring` over the seeds, plus the spread across them. */
function averagedGameScoring(set) {
  const runs = DRAFT_SEEDS.map(seed => sampledGameScoring(set, { samples: DRAFT_SAMPLES, seed }));
  const mean = key => runs.reduce((a, r) => a + r[key], 0) / runs.length;
  const points = runs.map(r => r.pointsPerGame);
  const m = mean('pointsPerGame');
  return {
    samples: runs.reduce((a, r) => a + r.samples, 0),
    seeds: DRAFT_SEEDS.length,
    pointsPerGame: m,
    seedSd: Math.sqrt(points.reduce((a, v) => a + (v - m) ** 2, 0) / points.length),
    meanRollBonus: mean('meanRollBonus'),
    meanStarterBudget: mean('meanStarterBudget'),
    meanStarterSalary: mean('meanStarterSalary'),
  };
}

/**
 * The candidates.
 *
 * `sdScale` is the dial that buys resolution; `min`/`max` only release cards the
 * clamp was flattening. Both are varied so the report can separate them — the
 * user's question is specifically about the two ends, and the answer turns out
 * to depend on neither of them very much.
 */
export const CANDIDATES = [
  // THE BASELINE. `perPool: true` drops `calibrateOn`, which is the pre-archive
  // behaviour exactly — the scale the shipped 350 cards were on before this
  // change. Every delta in the report is measured from here.
  { id: 'before', label: 'BEFORE: per-pool 10-28', opts: {}, perPool: true },
  // The recalibration on its own, so its cost is separable from the widening's.
  { id: 'absolute', label: 'absolute 10-28 (no widening)', opts: {} },
  { id: 'ceiling-32', label: 'ceiling only 10-32', opts: { max: 32 } },
  { id: 'ceiling-34', label: 'ceiling only 10-34', opts: { max: 34 } },
  { id: 'ends-8-30', label: 'both ends 8-30 (clamp only)', opts: { min: 8, max: 30 } },
  { id: 'wide-8-30', label: 'spread x1.2, 8-30', opts: { min: 8, max: 30, sdScale: 1.2 } },
  { id: 'wide-6-30-12', label: 'spread x1.2, 6-30', opts: { min: 6, max: 30, sdScale: 1.2 } },
  // The shipped scale, straight from the production constant.
  { id: 'wide-6-30', label: '>> SHIPPED spread x1.25, 6-30', opts: WIDENING },
  { id: 'wide-6-31', label: 'spread x1.25, 6-31', opts: { min: 6, max: 31, sdScale: 1.25 } },
  { id: 'wide-6-32', label: 'spread x1.25, 6-32', opts: { min: 6, max: 32, sdScale: 1.25 } },
  { id: 'wide-6-30b', label: 'spread x1.3, 6-30', opts: { min: 6, max: 30, sdScale: 1.3 } },
  { id: 'wide-8-31b', label: 'spread x1.3, 8-31 (was approved)', opts: { min: 8, max: 31, sdScale: 1.3 } },
  { id: 'wide-6-30c', label: 'spread x1.35, 6-30', opts: { min: 6, max: 30, sdScale: 1.35 } },
  { id: 'wide-8-34', label: 'spread x1.3, 8-34', opts: { min: 8, max: 34, sdScale: 1.3 } },
  { id: 'wide-4-36', label: 'spread x1.75, 4-36', opts: { min: 4, max: 36, sdScale: 1.75 } },
];

// The absolute basis, exactly as the generator uses it. Measuring a candidate
// against the pool's own spread instead would price it on a scale the shipped
// set is not on any more, and the tail — where every candidate differs — is the
// part that would be wrong.
const archive = requireArchive();

function buildCandidate({ opts, perPool }) {
  const reference = widenReference(REFERENCE_TOTALS, opts);
  const totals = mapToReferenceScale(
    composites,
    reference,
    perPool ? {} : { calibrateOn: archive.composites }
  );
  return cards.map((c, i) =>
    respec(c, splitSpeedPower(totals[i], c.pos, shares, { ...sizeOptions, size: sizes[i] }), {
      salaryModel,
      chartEv: chartEvs[i],
    })
  );
}

const rows = CANDIDATES.map(cand => {
  const set = buildCandidate(cand);
  const full = scoringProfile(set);
  const game = averagedGameScoring(set);
  const totals = set.map(c => c.speed + c.power);
  const salaries = set.map(c => c.salary);
  // The drafted starter's budget expressed as a percentile of THIS candidate's
  // own scale, so the number is comparable across candidates: a 29.5 on a 4-36
  // scale is not a bigger card than a 25.3 on a 6-30 one.
  const ascending = totals.slice().sort((a, b) => a - b);
  const starterPercentile =
    ascending.filter(t => t < game.meanStarterBudget).length / ascending.length;
  return {
    starterPercentile,
    ...cand,
    min: Math.min(...totals),
    max: Math.max(...totals),
    full,
    game,
    topSalary: Math.max(...salaries),
    // Cards pinned to SALARY_MAX. A scale that pushes several cards onto the
    // clamp has stopped pricing them apart, which is the roster-construction
    // tradeoff (design philosophy point 8) quietly failing.
    salaryClamped: salaries.filter(v => v >= SALARY_MAX).length,
    medianSalary: salaries.slice().sort((a, b) => a - b)[Math.floor(salaries.length / 2)],
    starSalary: Math.round(
      set
        .slice()
        .sort((a, b) => b.speed + b.power - (a.speed + a.power))
        .slice(0, 10)
        .reduce((s, c) => s + c.salary, 0) / 10
    ),
    ceiling: set
      .slice()
      .sort((a, b) => b.speed + b.power - (a.speed + a.power))
      .slice(0, 6)
      .map(c => `${c.name} ${c.speed + c.power}`),
    floor: set
      .slice()
      .sort((a, b) => a.speed + a.power - (b.speed + b.power))
      .slice(0, 6)
      .map(c => `${c.name} ${c.speed + c.power}`),
  };
});

const OUT_DIR = new URL('card-data/analysis/', ROOT);
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  new URL('scale-widening-2026-27.json', OUT_DIR),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      note:
        'Candidate Speed+Power scales, measured. This script applies nothing; the shipped scale ' +
        'is WIDENING applied to REFERENCE_TOTALS in scripts/cardgen/speedPower.js, and the row ' +
        'marked SHIPPED is that scale. Deltas are measured from the BEFORE row, which is the ' +
        'per-pool 10-28 scale the set was on before both the archive recalibration and the ' +
        'widening; the absolute 10-28 row separates the two.',
      scoringRollsPerGame: SCORING_ROLLS_PER_GAME,
      reference: REFERENCE_TOTALS,
      shipped: WIDENING,
      rows,
    },
    null,
    1
  )}\n`
);

// ── Report ──────────────────────────────────────────────────────────────────

const f = (x, d = 2) => x.toFixed(d);
const pct = x => `${(100 * x).toFixed(1)}%`;
const base = rows[0];

console.log(`\nSPEED+POWER SCALE — WHAT WIDENING COSTS — ${cards.length} cards`);
console.log(`Rule: calcAdv + lookupChart from src/game/, ${SCORING_ROLLS_PER_GAME} chart rolls per team per game`);
console.log(`(12 sections x 5 starters; shot checks bought with AST/REB take no roll bonus and are excluded)\n`);

console.log(
  'candidate                     range   ids   mean bonus   pts/game (all 350)   pts/game (cap-legal 5v5)   top $'
);
console.log('-'.repeat(118));
for (const r of rows) {
  const dIds = r.full.identities - base.full.identities;
  const dFull = r.full.pointsPerGame - base.full.pointsPerGame;
  const dGame = r.game.pointsPerGame - base.game.pointsPerGame;
  console.log(
    `${r.label.padEnd(28)} ${`${r.min}-${r.max}`.padStart(6)} ${String(r.full.identities).padStart(5)}` +
      ` ${(dIds ? `+${dIds}` : '  0').padStart(5)}` +
      `   ${f(r.full.meanRollBonus, 3).padStart(6)} ${(dGame === 0 ? '' : '')}` +
      `   ${f(r.full.pointsPerGame, 1).padStart(6)} ${signed(dFull, 1).padStart(6)}` +
      `        ${f(r.game.pointsPerGame, 1).padStart(6)} ${signed(dGame, 1).padStart(6)}` +
      `        ${String(r.topSalary).padStart(4)}`
  );
}

function signed(x, d = 2) {
  if (Math.abs(x) < 0.05 ** d) return ' 0.0';
  return `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;
}

console.log('\nAXIS MIX — how advantages are won');
console.log('candidate                     speed    power     both     advantage rate');
for (const r of rows) {
  console.log(
    `${r.label.padEnd(28)} ${pct(r.full.axisSpeed).padStart(6)}  ${pct(r.full.axisPower).padStart(6)}` +
      `  ${pct(r.full.axisBoth).padStart(6)}     ${pct(r.full.advantageRate).padStart(6)}`
  );
}

console.log('\nWHY THE COST IS SO SMALL — the chart is an S in the roll bonus');
console.log('bonus   pts/roll   pts/team/game   marginal pts/game per +1 bonus');
const curve = bonusPointsCurve(cards);
for (const p of curve.filter(p => p.bonus % 2 === 0)) {
  const prev = curve.find(q => q.bonus === p.bonus - 1);
  const next = curve.find(q => q.bonus === p.bonus + 1);
  const slope =
    prev && next ? ((next.pointsPerGame - prev.pointsPerGame) / 2).toFixed(2) : '   -';
  console.log(
    `${String(p.bonus).padStart(5)}   ${f(p.ptsPerRoll, 3).padStart(8)}   ${f(p.pointsPerGame, 1).padStart(13)}   ${String(slope).padStart(6)}`
  );
}
console.log(
  `\nExchange rate at the field's operating point (bonus ~+2): +1 mean roll bonus = ` +
    `${f(bonusExchangeRate(cards), 1)} pts/team/game.`
);
console.log(
  'Convex below ~+1 (the roll clamps at 1 and the bottom bands are 0), concave above ~+2\n' +
    '(318 of 350 charts open their last tier at roll 20, so bonus past that buys nothing).\n' +
    'Widening moves the SPREAD of roll bonuses much more than the mean, and spreading across a\n' +
    'curve that is convex on one side and concave on the other is close to a wash.'
);

console.log('\nSALARY, AND WHAT A CAP-LEGAL TEAM ACTUALLY FIELDS');
console.log(
  'candidate                     top card   median   top-10 mean   starter S+P (pctile)    $     mean bonus'
);
for (const r of rows) {
  // "1500 *2" — two cards pinned to SALARY_MAX. A scale that puts several cards
  // on the clamp has stopped pricing its best cards apart, which is the
  // roster-construction tradeoff (design philosophy point 8) quietly failing.
  const top = r.salaryClamped ? `${r.topSalary} *${r.salaryClamped}` : String(r.topSalary);
  console.log(
    `${r.label.padEnd(28)} ${top.padStart(8)} ${String(r.medianSalary).padStart(8)}` +
      `   ${String(r.starSalary).padStart(11)}` +
      `   ${`${f(r.game.meanStarterBudget, 1)} (${pct(r.starterPercentile)})`.padStart(20)}` +
      ` ${f(r.game.meanStarterSalary, 0).padStart(6)}   ${f(r.game.meanRollBonus, 2).padStart(10)}`
  );
}
console.log(
  '\nSalary is a linear function of Speed+Power (attributes.js salaryFeatures), so a wider scale\n' +
    'prices its own stars up and the cap buys slightly fewer of them. That is a real second-order\n' +
    'brake, but the S-curve above is the reason the headline cost is near zero.'
);

console.log('\nTHE ENDS OF THE SCALE');
for (const r of rows) {
  console.log(`${r.label}`);
  console.log(`   ceiling: ${r.ceiling.join(', ')}`);
  console.log(`   floor:   ${r.floor.join(', ')}`);
}

console.log(`\nWrote card-data/analysis/scale-widening-2026-27.json\n`);
