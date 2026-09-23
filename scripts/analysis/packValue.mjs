// WHAT A PACK PAYS — market value per coin, by simulation through the engine.
//
//   node scripts/analysis/packValue.mjs [packs per type] [pack=price,price,...]
//   node scripts/analysis/packValue.mjs 5000 super_season=300,400,500
//
// The method behind every pack price in PACK_TYPES since 2026-09-09: open a
// pack many times, value the players at MARKET_PRICES for their band and the
// strats at 20x their burn value, and divide by the price. A pack's value per
// coin against the booster's and the Super Booster's is what a premium or a
// discount means. The optional pack=prices argument re-prices one pack at
// several candidate prices on the same pulls.
import { generatePack, PACK_TYPES } from '../../src/game/packEngine.js';
import { getCardByKey } from '../../src/game/cardSets.js';
import { getStrat } from '../../src/game/strats.js';
import { getPlayerRarity, getStratRarity, MARKET_PRICES, STRAT_BURN_VALUES, RARITY_ORDER } from '../../src/game/rarity.js';

const N = Number(process.argv[2] ?? 5000);
const candidates = {};
for (const arg of process.argv.slice(3)) {
  const [pack, prices] = arg.split('=');
  candidates[pack] = prices.split(',').map(Number);
}
const STRAT_MULT = 20;
const atLeast = (r, floor) => RARITY_ORDER.indexOf(r) >= RARITY_ORDER.indexOf(floor);
const optionsFor = def =>
  def.needsTeam ? { team: def.pool === 'wnba' ? 'LVA' : 'BOS' }
    : def.themed === 'conference' ? { conference: 'East' }
      : def.themed === 'division' ? { division: 'Atlantic' }
        : {};

function measure(type, def) {
  let value = 0, players = 0, rarePlus = 0, sr = 0, leg = 0, salary = 0, packsWithLeg = 0;
  for (let i = 0; i < N; i += 1) {
    const pulls = generatePack(type, optionsFor(def));
    let legHere = 0;
    for (const p of pulls) {
      if (p.type === 'player') {
        const card = getCardByKey(p.id);
        if (!card) continue;
        const r = getPlayerRarity(card);
        value += MARKET_PRICES[r] ?? 0;
        salary += card.salary ?? 0;
        players += 1;
        if (atLeast(r, 'rare')) rarePlus += 1;
        if (r === 'super-rare') sr += 1;
        if (r === 'legendary') { leg += 1; legHere += 1; }
      } else {
        const s = getStrat(p.id);
        if (s) value += STRAT_MULT * (STRAT_BURN_VALUES[getStratRarity(s)] ?? 0);
      }
    }
    if (legHere) packsWithLeg += 1;
  }
  return {
    value: value / N,
    salary: salary / N,
    rarePlusPct: players ? (100 * rarePlus) / players : 0,
    sr: sr / N,
    leg: leg / N,
    pLeg: packsWithLeg / N,
  };
}

console.log(`${N} packs a type; players at MARKET_PRICES, strats at ${STRAT_MULT}x burn`);
console.log('pack                          price  E[value]  E[salary]  rare+%  SR/pack  LEG/pack  P(leg)  value/coin  coins/leg');
for (const [type, def] of Object.entries(PACK_TYPES)) {
  if (def.box || def.once) continue;
  const m = measure(type, def);
  const row = price =>
    `${def.name.padEnd(28)} ${String(price).padStart(6)}  ${m.value.toFixed(0).padStart(8)}  ${m.salary.toFixed(0).padStart(9)}  ${m.rarePlusPct.toFixed(1).padStart(6)}  ${m.sr.toFixed(2).padStart(7)}  ${m.leg.toFixed(3).padStart(8)}  ${(100 * m.pLeg).toFixed(1).padStart(5)}%  ${(m.value / price).toFixed(2).padStart(10)}  ${(m.pLeg > 0 ? price / m.pLeg : Infinity).toFixed(0).padStart(9)}`;
  console.log(row(def.price));
  for (const price of candidates[type] ?? []) if (price !== def.price) console.log(row(price));
}
