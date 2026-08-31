// Runs the matchup matrix over a finished set and reports set balance.
//
//   node scripts/analysis/runMatchupMatrix.js [set]     (default: 2026-27)
//
// Writes card-data/analysis/matchup-matrix-<set>.{csv,json} and prints a
// readable summary. Reads card data only — it never writes a card attribute.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import {
  budgetOnlyNetEdges,
  buildMatchupMatrix,
  crossSetSummary,
  defBoostCredit,
  mean,
  pearson,
  profilePlayer,
  translationResiduals,
} from './matchupMatrix.js';

const ROOT = new URL('../../', import.meta.url);
const readJson = p => JSON.parse(readFileSync(new URL(p, ROOT)));

const SET = process.argv[2] || '2026-27';
const CARD_FILES = {
  '2026-27': 'card-data/generated/cards-2026-27.json',
  'wnba': 'card-data/generated/cards-wnba.json',
  'super-season': 'card-data/generated/cards-super-season.json',
  'rookie': 'card-data/generated/cards-rookie.json',
  'wnba-super-season': 'card-data/generated/cards-wnba-super-season.json',
};

const loadCards = set => {
  const raw = readJson(CARD_FILES[set]);
  return raw.cards ?? raw;
};

const cards = loadCards(SET);
const rows = defBoostCredit(buildMatchupMatrix(cards), cards);

// EPM is what the Speed/Power budget was derived from, so it is the yardstick
// the finished cards are checked against.
const epmByName = new Map(
  readJson('card-data/generated/speed-power-totals-2026.json').map(p => [p.name, p])
);

const withOverall = translationResiduals(rows, epmByName, {
  metric: r => r.netEdge, epmKey: 'epm',
});
const withOff = translationResiduals(rows, epmByName, {
  metric: r => r.offense.meanRollBonus, epmKey: 'epmOff',
});
// Conceding LESS is better defence, so the matchup metric is negated to point
// the same way as defensive EPM before the two are compared.
const withDef = translationResiduals(rows, epmByName, {
  metric: r => -r.defense.meanRollBonus, epmKey: 'epmDef',
});

const enriched = rows.map((r, i) => ({
  ...r,
  epm: epmByName.get(r.name)?.epm ?? null,
  epmOff: epmByName.get(r.name)?.epmOff ?? null,
  epmDef: epmByName.get(r.name)?.epmDef ?? null,
  netEdgeZ: withOverall[i].matchupZ,
  epmZ: withOverall[i].epmZ,
  residual: withOverall[i].residual,
  offResidual: withOff[i].residual,
  defResidual: withDef[i].residual,
}));

// ── Output files ────────────────────────────────────────────────────────────

const OUT_DIR = new URL('card-data/analysis/', ROOT);
mkdirSync(OUT_DIR, { recursive: true });

const allBonuses = new Set();
for (const r of rows) {
  for (const k of Object.keys(r.offense.histogram)) allBonuses.add(Number(k));
  for (const k of Object.keys(r.defense.histogram)) allBonuses.add(Number(k));
}
const bonusCols = [...allBonuses].sort((a, b) => a - b);

const num = v => (v === null || v === undefined ? '' : (typeof v === 'number' ? +v.toFixed(4) : v));
const csvCell = v => {
  const s = String(num(v));
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Column layout mirrors the recovered 2K25 workbook — a roll-bonus histogram
// followed by Total Advantages / Total Disadvantages / Neutral Matchups — and
// then carries the same triple again for the DEFENSIVE direction, which the
// original never computed.
const header = [
  'Player', 'Team', 'Pos', 'Speed', 'Power', 'Speed+Power', 'Def Boost',
  'EPM', 'EPM Off', 'EPM Def',
  ...bonusCols.map(b => `Off ${b >= 0 ? '+' : ''}${b}`),
  'Total Advantages', 'Total Disadvantages', 'Neutral Matchups',
  'Adv by Speed', 'Adv by Power', 'Adv by Both',
  'Off Adv Magnitude', 'Off Dis Magnitude', 'Off Net Magnitude', 'Off Mean Roll Bonus',
  'Off Max', 'Off Min', 'Off Blunted by Opp Def', 'Off Neutralised by Opp Def',
  ...bonusCols.map(b => `Def ${b >= 0 ? '+' : ''}${b}`),
  'Advantages Allowed', 'Penalties Forced', 'Neutrals Allowed',
  'Def Magnitude Allowed', 'Def Net Magnitude', 'Def Mean Allowed',
  'Def Blunted (his Def Boost)', 'Def Neutralised (his Def Boost)',
  'Net Edge', 'Budget Net Edge', 'Def Boost Credit', 'Net Edge z', 'EPM z', 'Residual', 'Off Residual', 'Def Residual',
];

const lines = [header.join(',')];
for (const r of enriched) {
  lines.push([
    r.name, r.team, r.pos, r.speed, r.power, r.speedPower, r.defBoost,
    r.epm, r.epmOff, r.epmDef,
    ...bonusCols.map(b => r.offense.histogram[b] || 0),
    r.offense.advantages, r.offense.disadvantages, r.offense.neutral,
    r.offense.advBySpeed, r.offense.advByPower, r.offense.advByBoth,
    r.offense.advMagnitude, r.offense.disMagnitude, r.offense.netMagnitude, r.offense.meanRollBonus,
    r.offense.maxRollBonus, r.offense.minRollBonus, r.offense.blunted, r.offense.neutralised,
    ...bonusCols.map(b => r.defense.histogram[b] || 0),
    r.defense.advantages, r.defense.disadvantages, r.defense.neutral,
    r.defense.advMagnitude, r.defense.netMagnitude, r.defense.meanRollBonus,
    r.defense.blunted, r.defense.neutralised,
    r.netEdge, r.budgetNetEdge, r.defBoostCredit, r.netEdgeZ, r.epmZ, r.residual, r.offResidual, r.defResidual,
  ].map(csvCell).join(','));
}
writeFileSync(new URL(`matchup-matrix-${SET}.csv`, OUT_DIR), lines.join('\n') + '\n');
writeFileSync(
  new URL(`matchup-matrix-${SET}.json`, OUT_DIR),
  JSON.stringify({ set: SET, cards: cards.length, generatedAt: new Date().toISOString(), rows: enriched }, null, 1) + '\n'
);

// ── Report ──────────────────────────────────────────────────────────────────

const pct = x => (100 * x).toFixed(1) + '%';
const f = (x, d = 2) => (x === null || x === undefined ? 'n/a' : x.toFixed(d));
const sgn = (x, d = 2) => (x >= 0 ? '+' : '') + f(x, d);
const N = cards.length - 1;
const rule = s => console.log('\n' + s + '\n' + '─'.repeat(s.length));

console.log(`\nMATCHUP MATRIX — ${SET} — ${cards.length} cards, ${cards.length * N} ordered matchups`);
console.log(`Rule: calcAdv(off, def) from src/game/engine.js (no strategy cards in play)`);

rule('SET-LEVEL BALANCE');
const advRates = enriched.map(r => r.offense.advantageRate);
const totalAdv = enriched.reduce((s, r) => s + r.offense.advantages, 0);
const totalNeu = enriched.reduce((s, r) => s + r.offense.neutral, 0);
const totalDis = enriched.reduce((s, r) => s + r.offense.disadvantages, 0);
const tot = totalAdv + totalNeu + totalDis;
console.log(`Outcomes across the whole matrix: ${pct(totalAdv / tot)} advantage, ${pct(totalNeu / tot)} neutral, ${pct(totalDis / tot)} disadvantage`);
console.log(`Advantage rate per player: min ${pct(Math.min(...advRates))}, median ${pct(advRates.slice().sort((a, b) => a - b)[Math.floor(advRates.length / 2)])}, max ${pct(Math.max(...advRates))}`);

const beatsAll = enriched.filter(r => r.offense.advantages === N);
const losesAll = enriched.filter(r => r.offense.advantages === 0);
const neverBeaten = enriched.filter(r => r.defense.advantages === 0);
console.log(`Players who hold an advantage over EVERY other card: ${beatsAll.length}${beatsAll.length ? ' — ' + beatsAll.map(r => r.name).join(', ') : ''}`);
console.log(`Players who never hold an advantage over anyone:      ${losesAll.length}${losesAll.length && losesAll.length <= 8 ? ' — ' + losesAll.map(r => r.name).join(', ') : ''}`);
console.log(`Players no one can gain an advantage on:              ${neverBeaten.length}${neverBeaten.length ? ' — ' + neverBeaten.map(r => r.name).join(', ') : ''}`);

// Two cards with the same Speed, Power and EFFECTIVE Def Boost (negatives clamp
// to 0) are the same card at the table, whatever else is printed on them.
const identity = c => `${c.speed}|${c.power}|${Math.max(0, c.defBoost || 0)}`;
const idGroups = new Map();
for (const c of cards) {
  const k = identity(c);
  if (!idGroups.has(k)) idGroups.set(k, []);
  idGroups.get(k).push(c.name);
}
const shared = [...idGroups.values()].filter(g => g.length > 1);
console.log(`\nDistinct mechanical identities: ${idGroups.size} for ${cards.length} cards`);
console.log(`Cards indistinguishable from at least one other: ${shared.reduce((s, g) => s + g.length, 0)}`);
const biggest = shared.sort((a, b) => b.length - a.length)[0];
if (biggest) console.log(`Largest identical group: ${biggest.length} cards — ${biggest.slice(0, 5).join(', ')}${biggest.length > 5 ? ', ...' : ''}`);

// Tail compression: the printed Speed/Power range cannot separate the extremes.
for (const [label, pick] of [['CEILING', Math.max(...enriched.map(r => r.speedPower))],
                             ['FLOOR', Math.min(...enriched.map(r => r.speedPower))]]) {
  const g = enriched.filter(r => r.speedPower === pick).sort((a, b) => b.epm - a.epm);
  const ne = g.map(r => r.netEdge), ep = g.filter(r => r.epm !== null).map(r => r.epm);
  console.log(`\n${label} (S+P ${pick}), ${g.length} cards: Net Edge spread ${f(Math.max(...ne) - Math.min(...ne))} across an EPM spread of ${f(Math.max(...ep) - Math.min(...ep), 1)}`);
  g.slice(0, 6).forEach(r => console.log(`   ${r.name.padEnd(24)} DB ${String(r.defBoost).padStart(2)}  Net Edge ${f(r.netEdge).padStart(6)}  EPM ${f(r.epm, 1).padStart(5)}`));
  if (g.length > 6) console.log(`   ... and ${g.length - 6} more on the same Net Edge`);
}

const sorted = enriched.slice().sort((a, b) => b.netEdge - a.netEdge);
console.log(`\nNet Edge range: ${f(sorted[0].netEdge)} (${sorted[0].name}) down to ${f(sorted.at(-1).netEdge)} (${sorted.at(-1).name})`);
console.log(`Correlation of Net Edge with EPM: r = ${f(pearson(
  enriched.filter(r => r.epm !== null).map(r => r.netEdge),
  enriched.filter(r => r.epm !== null).map(r => r.epm)), 3)}`);
console.log(`Correlation of Off Mean Roll Bonus with EPM Off: r = ${f(pearson(
  enriched.filter(r => r.epmOff !== null).map(r => r.offense.meanRollBonus),
  enriched.filter(r => r.epmOff !== null).map(r => r.epmOff)), 3)}`);
console.log(`Correlation of Def (negated mean allowed) with EPM Def: r = ${f(pearson(
  enriched.filter(r => r.epmDef !== null).map(r => -r.defense.meanRollBonus),
  enriched.filter(r => r.epmDef !== null).map(r => r.epmDef)), 3)}`);

rule('AXIS SPLIT — how advantages are won');
const bySpeed = enriched.reduce((s, r) => s + r.offense.advBySpeed, 0);
const byPower = enriched.reduce((s, r) => s + r.offense.advByPower, 0);
const byBoth = enriched.reduce((s, r) => s + r.offense.advByBoth, 0);
console.log(`Speed only: ${bySpeed} (${pct(bySpeed / totalAdv)})   Power only: ${byPower} (${pct(byPower / totalAdv)})   Both: ${byBoth} (${pct(byBoth / totalAdv)})`);
console.log(`(A DISADVANTAGE is always on both axes — the rule takes max(speed, power),`);
console.log(` so a card leading either axis can never be at a disadvantage.)`);

rule('THE BUDGET IDENTITY — the Speed/Power SPLIT does not matter');
const budgetOnly = budgetOnlyNetEdges(cards);
const flatDev = Math.max(...buildMatchupMatrix(cards.map(c => ({ ...c, defBoost: 0 })))
  .map((r, i) => Math.abs(r.netEdge - budgetOnly[i])));
console.log(`With every Def Boost set to 0, each card's Net Edge equals its Speed+Power`);
console.log(`total minus the field mean, EXACTLY (max deviation ${flatDev.toExponential(1)}).`);
console.log(`Because rollBonus = max(speed, power), the split cancels once both directions`);
console.log(`are counted: adv(X,Y) - adv(Y,X) = (Sx+Px) - (Sy+Py) for any pair.`);
console.log(`=> How a budget is DIVIDED changes WHO a card beats, never how much it wins`);
console.log(`   overall. Def Boost is the only attribute that moves a card off that line.`);

rule('WHAT DEF BOOST IS ACTUALLY WORTH');
const dbGroups = new Map();
for (const r of enriched) {
  if (!dbGroups.has(r.defBoost)) dbGroups.set(r.defBoost, []);
  dbGroups.get(r.defBoost).push(r);
}
console.log('Def Boost   n    mean S+P   mean allowed   blunted/matchup   adv allowed   NET EDGE CREDIT');
for (const db of [...dbGroups.keys()].sort((a, b) => a - b)) {
  const g = dbGroups.get(db);
  console.log(
    `   ${String(db).padStart(2)}     ${String(g.length).padStart(3)}     ${f(mean(g.map(r => r.speedPower)), 1).padStart(5)}      ${f(mean(g.map(r => r.defense.meanRollBonus))).padStart(6)}         ${f(mean(g.map(r => r.defense.blunted / N))).padStart(6)}         ${f(mean(g.map(r => r.defense.advantages)), 0).padStart(4)}          ${f(mean(g.map(r => r.defBoostCredit))).padStart(6)}`
  );
}
console.log(`\nCREDIT = Net Edge above what Speed+Power alone predicts. It is zero-sum across`);
console.log(`the set, and it is NOT monotonic in Def Boost: a boost only pays when someone`);
console.log(`could otherwise beat you, so the strongest cards earn almost nothing from a big one.`);
const boosted = enriched.filter(r => r.defBoost > 0).sort((a, b) => b.defBoostCredit - a.defBoostCredit);
console.log(`\nBiggest earners:  ${boosted.slice(0, 5).map(r => `${r.name} (DB${r.defBoost}, S+P ${r.speedPower}) ${sgn(r.defBoostCredit)}`).join('\n                  ')}`);
console.log(`\nWorst earners:    ${boosted.slice(-5).reverse().map(r => `${r.name} (DB${r.defBoost}, S+P ${r.speedPower}) ${sgn(r.defBoostCredit)} — only ${r.defense.advantages} attackers could beat him anyway`).join('\n                  ')}`);

// Marginal exchange rate, measured by perturbation against the real field.
const median = enriched.slice().sort((a, b) => a.speedPower - b.speedPower)[Math.floor(enriched.length / 2)];
const base = profilePlayer(median, cards);
const plusDb = profilePlayer({ ...median, defBoost: (median.defBoost ?? 0) + 1 }, cards);
const plusSp = profilePlayer({ ...median, speed: median.speed + 1 }, cards);
const plusPw = profilePlayer({ ...median, power: median.power + 1 }, cards);
console.log(`\nMarginal value against the real field, measured on ${median.name} (S${median.speed} P${median.power} D${median.defBoost}):`);
console.log(`  +1 Def Boost -> Net Edge ${f(base.netEdge)} -> ${f(plusDb.netEdge)}  (${f(plusDb.netEdge - base.netEdge)})`);
console.log(`  +1 Speed     -> Net Edge ${f(base.netEdge)} -> ${f(plusSp.netEdge)}  (${f(plusSp.netEdge - base.netEdge)})`);
console.log(`  +1 Power     -> Net Edge ${f(base.netEdge)} -> ${f(plusPw.netEdge)}  (${f(plusPw.netEdge - base.netEdge)})`);

const negDb = enriched.filter(r => r.defBoost < 0);
console.log(`\nCards printed with a NEGATIVE Def Boost: ${negDb.length}`);
console.log(`engine.js:160 clamps with Math.max(0, def.defBoost || 0), so all ${negDb.length} play as Def Boost 0.`);
console.log(`Verified: re-profiling them at defBoost 0 changes Net Edge by ${f(Math.max(...negDb.map(r =>
  Math.abs(profilePlayer({ ...r, defBoost: 0 }, cards).netEdge - r.netEdge))), 6)} at most.`);

rule('THE NAMED DESIGN-INTENT PLAYERS');
const NAMED = ['Chet Holmgren', 'Zach Edey', 'Ausar Thompson', 'Matisse Thybulle', 'Ty Jerome', 'Jamal Murray', 'Trae Young'];
console.log('Player               S+P  DB   OffMean  DefAllow  NetEdge   EPM   NEz   EPMz  Resid');
for (const n of NAMED) {
  const r = enriched.find(x => x.name === n);
  if (!r) { console.log(`${n.padEnd(20)} — not in the ${SET} set`); continue; }
  console.log(
    `${r.name.padEnd(20)} ${String(r.speedPower).padStart(3)} ${String(r.defBoost).padStart(3)}   ${f(r.offense.meanRollBonus).padStart(6)}   ${f(r.defense.meanRollBonus).padStart(6)}   ${f(r.netEdge).padStart(6)} ${f(r.epm, 1).padStart(5)} ${f(r.netEdgeZ, 1).padStart(5)} ${f(r.epmZ, 1).padStart(5)}  ${f(r.residual, 2).padStart(5)}`
  );
}

rule('OUTLIERS — cards whose matchup profile misrepresents their EPM');
const rated = enriched.filter(r => r.residual !== null);
const over = rated.slice().sort((a, b) => b.residual - a.residual).slice(0, 12);
const under = rated.slice().sort((a, b) => a.residual - b.residual).slice(0, 12);
const line = r => `  ${r.name.padEnd(24)} S+P ${String(r.speedPower).padStart(2)}  DB ${String(r.defBoost).padStart(2)}  NetEdge ${f(r.netEdge).padStart(6)} (z ${f(r.netEdgeZ, 1).padStart(5)})  EPM ${f(r.epm, 1).padStart(5)} (z ${f(r.epmZ, 1).padStart(5)})  resid ${f(r.residual, 2).padStart(5)}`;
console.log(`\nOVERRATED by the card — matchup standing exceeds EPM (nerf candidates):`);
over.forEach(r => console.log(line(r)));
console.log(`\nUNDERRATED by the card — EPM exceeds matchup standing (buff candidates):`);
under.forEach(r => console.log(line(r)));
console.log(`\n${rated.filter(r => Math.abs(r.residual) > 1.5).length} of ${rated.length} cards sit more than 1.5 z off their EPM.`);

rule('CROSS-SET SANITY');
for (const other of Object.keys(CARD_FILES).filter(s => s !== SET)) {
  const oc = loadCards(other);
  const aVsB = crossSetSummary(cards, oc);
  const bVsA = crossSetSummary(oc, cards);
  const spA = mean(cards.map(c => c.speed + c.power));
  const spB = mean(oc.map(c => c.speed + c.power));
  console.log(`${SET} vs ${other.padEnd(18)} mean S+P ${f(spA, 1)} vs ${f(spB, 1)} | ${SET} attacking: adv ${pct(aVsB.advantageRate)}, mean bonus ${f(aVsB.meanRollBonus)} | ${other} attacking: adv ${pct(bVsA.advantageRate)}, mean bonus ${f(bVsA.meanRollBonus)}`);
}

console.log(`\nWrote card-data/analysis/matchup-matrix-${SET}.csv and .json\n`);
